"""Exact coins/step gearset optimizer — Coins objective on the shared engine.

coins/step = coin_value_per_action / expected_steps_per_action. The denominator
is the SAME shared steps() the XP objective uses; only the numerator differs.

Empirically verified against util.coin_value.compute_coin_targets_for_activity
(the coins ground truth the UI displays): coin value per action is

    (1 + double_rewards) * ( C0 + Σ_findaxis  find_stat * k_findaxis )

— multiplicative in double_rewards, LINEAR in every find axis (chest_finding,
find_gems, find_bird_nests, fine_material_finding, and ItemFindingCategory.*),
with non-negative coefficients. That makes the objective monotone in every coin
axis, so the admissible numerator_bound is just the same expression with each
axis raised by its suffix reserve.

C0 and the per-axis marginals k are activity-specific, so they're probed once
per activity in prepare() by evaluating the real coin function at basis points.
(Only the gearset RANKING matters here; the worker recomputes the displayed
coins/1k via calculate_gearset_metrics, so a constant scale on the numerator is
irrelevant.)
"""
import math

from util.exact_gearset_optimizer import ExactGearsetOptimizer

_EXACT_NODE_BUDGET = 5_000_000
last_run_budget_exhausted = False

# MITM (meet-in-the-middle) for the coins objective. The coins numerator is
# monotone in dr + every find axis (all MAX_AXES) and decreasing in the step
# axes (MIN_AXES), so the same Pareto-collapse MITM used for XP is exact here.
# Enabled with side-by-side B&B validation: _run runs BOTH, uses MITM only when
# it matches the B&B, else falls back to B&B (and logs [MITM] / [MITM-BAIL]).
# Coins has more axes than XP, so larger frontiers may bail to B&B more often —
# the validation + bail make that safe (never worse than B&B).
_MITM_ENABLED = True
_DEDUP_RING_ORDER = True
_SLOT_ORDER_STRATEGY = "tools_first"
# MITM-only: skip the side-by-side B&B (it's ~20s/activity for coins and just
# validates). MITM is proven exact for the coins objective (aggregated A_coins
# axis), so use it directly; the B&B still runs only as a bail fallback when a
# frontier exceeds the combine cap. This is where the coins speedup lands.
_MITM_VALIDATE = False

# Additive (linear) coin find axes always considered; ItemFindingCategory.*
# axes present on the character's gear are discovered per-activity in prepare().
_NAMED_FIND_AXES = ("chest_finding", "find_gems", "find_bird_nests", "fine_material_finding")
_PROBE = 0.10   # probe delta for measuring each axis's marginal coin value


class ExactCoinsOptimizer(ExactGearsetOptimizer):
    """Maximize coins/step. Steps axes are shared with the engine; the coin
    numerator axes (double_rewards + find axes) are added per-activity."""

    def __init__(self, include_chests=True):
        super().__init__()
        self.include_chests = include_chests
        self._C0 = 0.0
        self._k = {}
        # Instance axis model — extended in prepare() with the coin axes.
        self.AXES = ("W", "S_add", "S_pct", "B", "dr")
        self.MAX_AXES = ("W", "B", "dr")
        self.MIN_AXES = ("S_add", "S_pct")
        self.CAP_AXIS = "W"
        self.AXIS_MAP = {"work_efficiency": "W", "steps_add": "S_add",
                         "steps_percent": "S_pct", "double_action": "B",
                         "double_rewards": "dr"}

    def prepare(self, activity, character, skill, location, X0, S0, kappa, WE_level):
        from util.coin_value import compute_coin_targets_for_activity, COIN_TARGET, COIN_NO_CHESTS_TARGET
        target_key = COIN_TARGET if self.include_chests else COIN_NO_CHESTS_TARGET

        def coins_step(sd):
            try:
                dr_rates = activity.get_expected_drop_rate(
                    sd, location=location, target_item=None, character=character,
                    include_collectibles_from_character=False)
                ct = compute_coin_targets_for_activity(activity, dr_rates, stats=sd)
                spc = ct.get(target_key)
                return (1.0 / spc) if (spc and spc > 0 and spc != float("inf")) else 0.0
            except Exception:
                return 0.0

        # Discover ItemFindingCategory.* axes that actually appear on owned gear
        # for this skill/location (named find axes are always candidates).
        if_axes = set()
        try:
            for it in character.items:
                if not hasattr(it, "get_stats_for_skill"):
                    continue
                try:
                    st = it.get_stats_for_skill(skill=skill, location=location, character=character)
                except Exception:
                    continue
                for k in st:
                    if k.startswith("ItemFindingCategory."):
                        if_axes.add(k)
        except Exception:
            pass

        C0 = coins_step({})
        self._C0 = C0
        k = {}
        for ax in list(_NAMED_FIND_AXES) + sorted(if_axes):
            v = coins_step({ax: _PROBE})
            kv = (v - C0) / _PROBE
            if kv > 1e-12:            # keep only coin-positive, monotone axes
                k[ax] = kv
        self._k = k

        # Collapse ALL linear find-axes into ONE aggregated Pareto axis, A_coins
        # (= sum_a k[a]*s[a]). The coins numerator depends on the find-axes ONLY
        # through this weighted sum, so Pareto-dominance on
        # (W, S_add, S_pct, B, dr, A_coins) is EXACT — while keeping the MITM
        # per-group frontiers XP-sized. Adding each find axis as its own
        # dimension (~12+) exploded the frontiers past the MITM combine cap,
        # forcing a bail to the (slow, ~30s/activity) B&B. Find stats are
        # deliberately NOT added to AXIS_MAP — _vec() folds them into A_coins
        # with their k[a] weights.
        self.AXES = ("W", "S_add", "S_pct", "B", "dr", "A_coins")
        self.MAX_AXES = ("W", "B", "dr", "A_coins")

    def _vec(self, stats):
        # Base step/dr axes via AXIS_MAP, then fold the linear find-axes into a
        # single aggregated coin axis A_coins = sum_a k[a]*s[a]. Keeps the axis
        # count at 6 (XP-like) so MITM frontiers stay small and exact.
        v = super()._vec(stats)
        acoins = 0.0
        for a, kv in self._k.items():
            val = stats.get(a)
            if val:
                acoins += kv * float(val)
        v["A_coins"] = acoins
        return v

    def numerator(self, X0, s):
        return (1.0 + s["dr"]) * (self._C0 + s.get("A_coins", 0.0))

    def numerator_bound(self, X0, s, R):
        # Monotone: raise dr and the aggregated coin axis by their reserves.
        return (1.0 + s["dr"] + R.get("dr", 0.)) * (
            self._C0 + s.get("A_coins", 0.0) + R.get("A_coins", 0.0))

    def _combine_best(self, FG, FA, reqs, X0, S0, kappa, WE_level, base_stats):
        """Inlined coins FG × FA combine. Bit-identical to the base reference
        (same float association: dr_tot/ac_tot summed before the outer op), but
        hoists the gear-side scalars out of the inner loop and inlines the
        numerator ((1+dr)*(C0+A_coins)) and the steps args — no per-pair
        dict(zip(...)) rebuild, no numerator() method call. ~1.9x on the combine,
        which is the dominant cost for tool/consumable-heavy coins activities."""
        AXES = self.AXES
        s0 = {a: float(base_stats.get(a, 0.)) for a in AXES}
        s0v = tuple(s0[a] for a in AXES)
        iW = AXES.index("W"); iSa = AXES.index("S_add"); iSp = AXES.index("S_pct")
        iB = AXES.index("B"); idr = AXES.index("dr"); iAc = AXES.index("A_coins")
        C0 = self._C0
        s0W = s0v[iW]; s0Sa = s0v[iSa]; s0Sp = s0v[iSp]; s0B = s0v[iB]
        s0dr = s0v[idr]; s0Ac = s0v[iAc]
        FGv = [(tuple(g["v"][a] for a in AXES), g["kw"], g["comp"]) for g in FG]
        FAv = [(tuple(a["v"][ax] for ax in AXES), a["kw"], a["comp"]) for a in FA]
        step_cache = {}
        def _steps(w, sa, sp, b):
            key = (w, sa, sp, b)
            st = step_cache.get(key)
            if st is None:
                eff = min(WE_level + w, kappa)
                stp = max(math.ceil((S0 / (1.0 + eff)) * (1.0 + sp) + sa), self.STEP_FLOOR)
                st = stp / (1.0 + b)
                step_cache[key] = st
            return st
        reqs_items = list(reqs.items())
        has_reqs = bool(reqs_items)
        best_r = float("-inf"); best_nfill = None; best_load = None
        best_gv = None; best_av = None
        for gv, kG, cG in FGv:
            gW = s0W + gv[iW]; gSa = s0Sa + gv[iSa]; gSp = s0Sp + gv[iSp]; gB = s0B + gv[iB]
            gdr = s0dr + gv[idr]; gAc = s0Ac + gv[iAc]
            nG = len(cG)
            for av, kA, cA in FAv:
                if has_reqs:
                    ok = True
                    for k, t in reqs_items:
                        if kG[k] + kA[k] < t:
                            ok = False
                            break
                    if not ok:
                        continue
                dr_tot = gdr + av[idr]           # == sv[idr] (same association)
                ac_tot = gAc + av[iAc]           # == sv[iAc]
                r = ((1.0 + dr_tot) * (C0 + ac_tot)) / _steps(
                    gW + av[iW], gSa + av[iSa], gSp + av[iSp], gB + av[iB])
                nfill = -(nG + len(cA))
                if best_load is None or (r, nfill) > (best_r, best_nfill):
                    best_r = r; best_nfill = nfill
                    best_load = list(cG) + list(cA)
                    best_gv = gv; best_av = av
        if best_load is None:
            return float("-inf"), None, None
        rng = range(len(AXES))
        bsv = tuple(s0v[j] + best_gv[j] + best_av[j] for j in rng)
        return best_r, best_load, dict(zip(AXES, bsv))


def exact_coins_optimize(activity, character, skill=None, location=None, base_stats=None,
                         pets=None, consumables=None, input_item=None, include_chests=True):
    """Return {slot: Item|None} maximizing coins/step, or None to fall back."""
    opt = ExactCoinsOptimizer(include_chests=include_chests)
    opt.NODE_BUDGET = _EXACT_NODE_BUDGET
    opt._MITM_ENABLED = _MITM_ENABLED
    opt.DEDUP_RING_ORDER = _DEDUP_RING_ORDER
    opt.SLOT_ORDER_STRATEGY = _SLOT_ORDER_STRATEGY
    opt._MITM_VALIDATE = _MITM_VALIDATE
    result = opt.optimize(activity, character, skill=skill, location=location,
                          base_stats=base_stats, pets=pets, consumables=consumables,
                          input_item=input_item)
    globals()["last_run_budget_exhausted"] = opt.last_run_budget_exhausted
    return result
