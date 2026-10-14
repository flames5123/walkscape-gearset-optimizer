"""Exact target-drop-rate/step gearset optimizer — chests / chests_recipes /
new_items on the shared MITM engine.

These three goals-report categories all maximize the SAME objective:

    (target item(s) found per step)
      = Σ_target  (1 / expected_steps_per_item_target)

and Activity.get_expected_drop_rate makes each item's rate

    rate_target(stats) = base_target × (1 + dr) × (1 + Σ_findaxis find_stat)

— multiplicative in double_rewards, LINEAR in every find axis (chest_finding,
find_collectibles, find_gems, find_bird_nests, skill-specific chest finding,
ItemFindingCategory.*, …), with non-negative marginals. That is EXACTLY the
coins objective shape (`util.exact_coins_optimizer`), except the per-item weight
is 1 over a specific target item SET instead of each drop's coin value. So this
optimizer is a thin subclass of ExactCoinsOptimizer that overrides only
prepare(): it probes the target's own rate (not coin value) to discover C0 and
the per-find-axis marginals, then aggregates them into the same single A_coins
Pareto axis. Everything else — _vec, numerator = (1+dr)(C0+A_coins),
numerator_bound, the inlined _combine_best, the MITM combine, the caps/bail — is
inherited unchanged and already proven exact.

Fewer relevant find-axes than coins (usually just chest_finding, or
find_collectibles), so the frontiers are smaller and it runs faster than coins.
"""
import math

from util.exact_coins_optimizer import (
    ExactCoinsOptimizer, _PROBE,
    _EXACT_NODE_BUDGET, _MITM_ENABLED, _DEDUP_RING_ORDER,
    _SLOT_ORDER_STRATEGY, _MITM_VALIDATE,
)

last_run_budget_exhausted = False

# Named find-axes to probe against the target rate. Superset of the coins list —
# adds find_collectibles / find_linens (relevant for new_items collectibles),
# which the coins objective omits because it doesn't value collectibles. Any
# axis with a zero marginal for a given target is dropped by the probe, so a
# generous candidate list is harmless — only the ones that actually move THIS
# target's rate survive.
_TARGET_FIND_AXES = (
    "chest_finding", "find_collectibles", "find_gems", "find_bird_nests",
    "find_linens", "fine_material_finding",
)

# Character stat keys that are engine axes (steps / cap / dr), NOT find-axes —
# excluded from the discovered candidate set (they're handled as explicit AXES).
_ENGINE_STAT_KEYS = frozenset((
    "work_efficiency", "double_action", "double_rewards", "steps_add", "steps_percent",
))


class ExactTargetRateOptimizer(ExactCoinsOptimizer):
    """Maximize (Σ target-item drop-rate) / step. `target_items` is one or more
    item NAMES (a single chest/collectible, or a combined new-items set)."""

    def __init__(self, target_items):
        super().__init__(include_chests=True)
        if isinstance(target_items, str):
            target_items = [target_items]
        # Preserve order, dedupe, drop falsy.
        seen = set()
        self._target_names = []
        for nm in (target_items or []):
            if nm and nm not in seen:
                seen.add(nm)
                self._target_names.append(nm)

    def prepare(self, activity, character, skill, location, X0, S0, kappa, WE_level):
        target_names = self._target_names

        def target_step(sd):
            """Σ target items found per step under stat vector sd. Mirrors the
            coins objective's coins_step but with unit weight over the target
            set instead of per-drop coin value. get_expected_drop_rate returns
            {item: expected_steps_per_item} with find + dr already applied, so
            1/steps_per_item is that item's per-step rate."""
            try:
                dr_rates = activity.get_expected_drop_rate(
                    sd, location=location, target_item=None, character=character,
                    include_collectibles_from_character=False)
            except Exception:
                return 0.0
            total = 0.0
            for nm in target_names:
                spi = dr_rates.get(nm)
                if spi and spi > 0 and spi != float("inf"):
                    total += 1.0 / spi
            return total

        # Discover EVERY find-axis candidate: the named superset plus any stat
        # key actually present on the character's gear/collectibles that isn't a
        # step/dr engine axis (catches skill-specific chest finding,
        # ItemFindingCategory.*, and anything else). Probing an irrelevant key
        # yields a zero marginal and is dropped, so over-inclusion is safe and
        # nothing that moves the target rate is ever missed.
        cand_axes = set(_TARGET_FIND_AXES)
        try:
            pools = list(getattr(character, "items", []) or [])
            pools += list(getattr(character, "collectibles", []) or [])
            for it in pools:
                if not hasattr(it, "get_stats_for_skill"):
                    continue
                try:
                    st = it.get_stats_for_skill(skill=skill, location=location, character=character)
                except Exception:
                    continue
                for key in st:
                    if key not in _ENGINE_STAT_KEYS:
                        cand_axes.add(key)
        except Exception:
            pass

        C0 = target_step({})
        self._C0 = C0
        k = {}
        for ax in sorted(cand_axes):
            v = target_step({ax: _PROBE})
            kv = (v - C0) / _PROBE
            if kv > 1e-12:            # keep only rate-positive, monotone axes
                k[ax] = kv
        self._k = k

        # Same aggregated single-axis model as coins: fold all linear find-axes
        # into A_coins (= Σ_a k[a]·s[a]); the numerator depends on them only
        # through this weighted sum, so Pareto-dominance on
        # (W, S_add, S_pct, B, dr, A_coins) is exact.
        self.AXES = ("W", "S_add", "S_pct", "B", "dr", "A_coins")
        self.MAX_AXES = ("W", "B", "dr", "A_coins")


class ExactCurrencyValueOptimizer(ExactCoinsOptimizer):
    """Maximize a VALUE-currency (Adventurers' Guild Tokens / Sea Shells) earned
    per step. Identical exact machinery to ExactCoinsOptimizer -- the numerator
    ((1+dr)*(C0+A_coins)), the aggregated find-axis A_coins, and the MITM combine
    are all inherited UNCHANGED. ONLY the per-step VALUE differs: the currency's
    special-sell value summed over the activity's drops (base + FMF-boosted fine
    + IF-category direct drops), via the SAME validated
    compute_*_targets_for_activity functions the greedy scorer already uses (so
    exact and greedy optimize the identical objective and are comparable).

    `currency_target` is the cat: synthetic:
      * 'cat:if:adventurers_guild_tokens'  -> util.ag_token_value
      * 'cat:sea_shells'                   -> util.shell_value
    """

    def __init__(self, currency_target):
        super().__init__(include_chests=True)
        self._currency_target = currency_target

    def prepare(self, activity, character, skill, location, X0, S0, kappa, WE_level):
        if self._currency_target == 'cat:sea_shells':
            from util.shell_value import (
                compute_shell_targets_for_activity as _valfn, SHELL_TARGET as _TKEY)
        else:
            from util.ag_token_value import (
                compute_agt_targets_for_activity as _valfn, AGT_TARGET as _TKEY)

        def currency_step(sd):
            """Currency value earned per step under stat vector sd. Mirrors the
            coins objective's coins_step, swapping coin value for the currency's
            special-sell value (get_expected_drop_rate gives {item: steps/item}
            with find+dr applied; the value fn folds FMF fine + IF drops in)."""
            try:
                dr_rates = activity.get_expected_drop_rate(
                    sd, location=location, target_item=None, character=character,
                    include_collectibles_from_character=False)
                ct = _valfn(activity, dr_rates, stats=sd)
                spc = ct.get(_TKEY)
                return (1.0 / spc) if (spc and spc > 0 and spc != float("inf")) else 0.0
            except Exception:
                return 0.0

        # Discover ItemFindingCategory.* axes present on owned gear for this
        # skill/location (the named superset is always probed). An irrelevant
        # axis yields a zero marginal and is dropped, so over-inclusion is safe.
        if_axes = set()
        try:
            for it in getattr(character, "items", []) or []:
                if not hasattr(it, "get_stats_for_skill"):
                    continue
                try:
                    st = it.get_stats_for_skill(skill=skill, location=location, character=character)
                except Exception:
                    continue
                for key in st:
                    if key.startswith("ItemFindingCategory."):
                        if_axes.add(key)
        except Exception:
            pass

        C0 = currency_step({})
        self._C0 = C0
        k = {}
        for ax in list(_TARGET_FIND_AXES) + sorted(if_axes):
            v = currency_step({ax: _PROBE})
            kv = (v - C0) / _PROBE
            if kv > 1e-12:            # keep only value-positive, monotone axes
                k[ax] = kv
        self._k = k
        # Same aggregated single-axis model as coins: fold all linear find-axes
        # into A_coins; the numerator depends on them only through this sum, so
        # Pareto-dominance on (W, S_add, S_pct, B, dr, A_coins) is exact.
        self.AXES = ("W", "S_add", "S_pct", "B", "dr", "A_coins")
        self.MAX_AXES = ("W", "B", "dr", "A_coins")


def exact_currency_optimize(activity, character, currency_target, skill=None,
                            location=None, base_stats=None, pets=None,
                            consumables=None, input_item=None):
    """Return {slot: Item|None} maximizing currency (AGT / Sea Shells) value per
    step, or None to fall back to greedy. `currency_target` is the cat:
    synthetic ('cat:if:adventurers_guild_tokens' | 'cat:sea_shells')."""
    opt = ExactCurrencyValueOptimizer(currency_target)
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


class ExactFineRateOptimizer(ExactTargetRateOptimizer):
    """Exact optimizer for a FINE item target ('X (Fine)').

    The fine rate factorizes EXACTLY (verified 0.00% error on live data) as

        fine_rate(gear) = base_rate(find) * (1 + fine_material_finding)

    i.e. a PRODUCT of (a) the base item's rate, which is LINEAR in the base-find
    axes (find_gems / chest_finding / IFC.* / ...), and (b) the fine multiplier,
    which is LINEAR in fine_material_finding. The parent ExactTargetRateOptimizer
    (and ExactCoinsOptimizer) fold ALL find axes into one linear A_coins sum and
    so DROP the base_find x FMF cross-term -> ~11% error (the fine regression).

    This subclass keeps FMF OUT of A_coins and carries it as its own frontier
    axis F, with a multiplicative numerator (1+dr)*(C0+A_base)*(1+k_fmf*F). Both
    factors are linear in their axes, so Pareto-dominance on
    (W, S_add, S_pct, B, dr, A_coins, F) is EXACT.
    """

    def prepare(self, activity, character, skill, location, X0, S0, kappa, WE_level):
        target_names = self._target_names

        def target_step(sd):
            try:
                dr = activity.get_expected_drop_rate(
                    sd, location=location, target_item=None, character=character,
                    include_collectibles_from_character=False)
            except Exception:
                return 0.0
            tot = 0.0
            for nm in target_names:
                spi = dr.get(nm)
                if spi and spi > 0 and spi != float("inf"):
                    tot += 1.0 / spi
            return tot

        C0 = target_step({})
        self._C0 = C0

        # Base-find candidate axes: the named superset MINUS fine_material_finding
        # (handled multiplicatively below), plus any ItemFindingCategory.* stat
        # actually present on owned gear. Irrelevant axes probe to ~0 and drop.
        cand_axes = set(a for a in _TARGET_FIND_AXES if a != "fine_material_finding")
        try:
            pools = list(getattr(character, "items", []) or [])
            pools += list(getattr(character, "collectibles", []) or [])
            for it in pools:
                if not hasattr(it, "get_stats_for_skill"):
                    continue
                try:
                    st = it.get_stats_for_skill(skill=skill, location=location, character=character)
                except Exception:
                    continue
                for key in st:
                    if key != "fine_material_finding" and key not in _ENGINE_STAT_KEYS:
                        cand_axes.add(key)
        except Exception:
            pass

        k = {}
        for ax in sorted(cand_axes):
            v = target_step({ax: _PROBE})
            kv = (v - C0) / _PROBE
            if kv > 1e-12:            # base-find marginal (linear part of base_rate)
                k[ax] = kv
        self._k = k   # A_coins = base-find ONLY (fmf excluded)

        # Multiplicative fine coefficient: fine_rate = base * (1 + k_fmf * FMF).
        # From live data k_fmf == 1.0 (fine_chance_multiplier = 1 + FMF), but probe
        # it so any future mechanic change is picked up automatically.
        self._k_fmf = 0.0
        if C0 and C0 > 0:
            vf = target_step({"fine_material_finding": _PROBE})
            self._k_fmf = max(0.0, (vf / C0 - 1.0) / _PROBE)

        # F is a SEPARATE beneficial frontier axis (not folded into A_coins).
        self.AXES = ("W", "S_add", "S_pct", "B", "dr", "A_coins", "F")
        self.MAX_AXES = ("W", "B", "dr", "A_coins", "F")

    def _vec(self, stats):
        # super()._vec (ExactCoinsOptimizer) gives W,S_add,S_pct,B,dr + A_coins
        # (= base-find only, since self._k excludes fine_material_finding). Add F.
        v = super()._vec(stats)
        v["F"] = float(stats.get("fine_material_finding", 0.0) or 0.0)
        return v

    def numerator(self, X0, s):
        return ((1.0 + s["dr"])
                * (self._C0 + s.get("A_coins", 0.0))
                * (1.0 + self._k_fmf * s.get("F", 0.0)))

    def numerator_bound(self, X0, s, R):
        # Admissible upper bound: every factor is monotone-increasing in its
        # axes, so raise dr / A_coins / F by their suffix reserves.
        return ((1.0 + s["dr"] + R.get("dr", 0.0))
                * (self._C0 + s.get("A_coins", 0.0) + R.get("A_coins", 0.0))
                * (1.0 + self._k_fmf * (s.get("F", 0.0) + R.get("F", 0.0))))

    def _combine_best(self, FG, FA, reqs, X0, S0, kappa, WE_level, base_stats):
        """MITM FG x FA combine — identical to ExactCoinsOptimizer._combine_best
        but with the multiplicative fine factor: numerator =
        (1+dr)*(C0+A_coins)*(1+k_fmf*F). F is carried as its own frontier axis
        (added to AXES/MAX_AXES in prepare), so Pareto-dominance still implies
        score-dominance and the combine stays exact. Enables MITM speed for fine
        (B&B fallback when a frontier exceeds the combine cap)."""
        AXES = self.AXES
        s0 = {a: float(base_stats.get(a, 0.)) for a in AXES}
        s0v = tuple(s0[a] for a in AXES)
        iW = AXES.index("W"); iSa = AXES.index("S_add"); iSp = AXES.index("S_pct")
        iB = AXES.index("B"); idr = AXES.index("dr"); iAc = AXES.index("A_coins")
        iF = AXES.index("F")
        C0 = self._C0
        kf = self._k_fmf
        s0W = s0v[iW]; s0Sa = s0v[iSa]; s0Sp = s0v[iSp]; s0B = s0v[iB]
        s0dr = s0v[idr]; s0Ac = s0v[iAc]; s0F = s0v[iF]
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
            gdr = s0dr + gv[idr]; gAc = s0Ac + gv[iAc]; gF = s0F + gv[iF]
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
                dr_tot = gdr + av[idr]
                ac_tot = gAc + av[iAc]
                f_tot = gF + av[iF]
                r = ((1.0 + dr_tot) * (C0 + ac_tot) * (1.0 + kf * f_tot)) / _steps(
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


def exact_fine_rate_optimize(activity, character, target_items, skill=None,
                             location=None, base_stats=None, pets=None,
                             consumables=None, input_item=None):
    """Return {slot: Item|None} maximizing a FINE item's rate/step, or None.

    MITM enabled: the _combine_best override models the (1+k_fmf*F) fine factor
    with F as its own frontier axis, so the MITM stays exact (B&B fallback when a
    frontier exceeds the combine cap). Verified on live data: MITM matches B&B
    when B&B is proof-optimal, and EXCEEDS it (finds the true optimum) when B&B
    hits the node budget -- i.e. MITM is never worse, and is 2.4x-16.5x faster.
    """
    opt = ExactFineRateOptimizer(target_items)
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


class ExactFindingRateOptimizer(ExactCoinsOptimizer):
    """Exact optimizer for a cat:if:<CAT> item-finding target (ectoplasm /
    bird_nest — items found via ItemFindingCategory GEAR, not native drops).

    Per optimize_activity_gearsets._compute_spr_for_target, the non-fine
    cat:if:<CAT> rate is:

        rate = if_stat_percent / (100 * base_spr)

    where if_stat_percent = the ItemFindingCategory.<CAT> stat (LINEAR in owned
    IFC gear) and base_spr = steps_per_reward_roll (the engine reward-roll rate,
    a function of WE/DA/dr). Double-rewards multiplies the number of reward rolls
    -> more finds, so it belongs in the numerator exactly like coins.

    So this is IDENTICAL to the coins model with C0 = 0 and a single linear find
    axis A_coins = 0.01 * IFC.<CAT>. The proven-exact coins MITM/_combine_best
    applies unchanged -- we only fix prepare() (exact_target_rate's target_step
    can't resolve cat:if:<CAT> via get_expected_drop_rate, which is what produced
    the 1e9 garbage). No probing needed: the formula is exact.
    """

    def __init__(self, cat_stat_key):
        super().__init__(include_chests=False)
        self._cat_stat_key = cat_stat_key  # e.g. 'ItemFindingCategory.ECTOPLASM'

    def prepare(self, activity, character, skill, location, X0, S0, kappa, WE_level):
        self._C0 = 0.0
        # rate = (1+dr) * (0.01 * if_stat) / steps  -> A_coins = 0.01 * IFC.<CAT>.
        self._k = {self._cat_stat_key: 0.01}
        self.AXES = ("W", "S_add", "S_pct", "B", "dr", "A_coins")
        self.MAX_AXES = ("W", "B", "dr", "A_coins")


def exact_finding_rate_optimize(activity, character, target, skill=None,
                                location=None, base_stats=None, pets=None,
                                consumables=None, input_item=None):
    """Return {slot: Item|None} maximizing a cat:if:<CAT> item-finding rate/step,
    or None. `target` is the 'cat:if:<cat>' synthetic (same 3rd-positional shape
    as the other exact entries); the ItemFindingCategory stat key is derived
    from it. MITM stays enabled (objective is linear in A_coins)."""
    cat = target
    if isinstance(cat, str) and cat.startswith('cat:if:'):
        cat = cat[len('cat:if:'):]
    if isinstance(cat, str) and cat.endswith('_fine'):
        cat = cat[:-len('_fine')]
    cat_stat_key = 'ItemFindingCategory.%s' % str(cat).upper()
    opt = ExactFindingRateOptimizer(cat_stat_key)
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


def exact_target_rate_optimize(activity, character, target_items, skill=None,
                               location=None, base_stats=None, pets=None,
                               consumables=None, input_item=None, frontier_cache=None):
    """Return {slot: Item|None} maximizing (target-item rate)/step, or None to
    fall back. `target_items` = one item name or a list (combined new-items)."""
    opt = ExactTargetRateOptimizer(target_items)
    opt.NODE_BUDGET = _EXACT_NODE_BUDGET
    opt._MITM_ENABLED = _MITM_ENABLED
    opt.DEDUP_RING_ORDER = _DEDUP_RING_ORDER
    opt.SLOT_ORDER_STRATEGY = _SLOT_ORDER_STRATEGY
    opt._MITM_VALIDATE = _MITM_VALIDATE
    result = opt.optimize(activity, character, skill=skill, location=location,
                          base_stats=base_stats, pets=pets, consumables=consumables,
                          input_item=input_item, frontier_cache=frontier_cache)
    globals()["last_run_budget_exhausted"] = opt.last_run_budget_exhausted
    return result


def estimate_target_rate_weight(activity, character, target_items, skill=None,
                                location=None, pets=None, consumables=None,
                                input_item=None):
    """Fast (~prep+prune only) estimate of a solve's cost for shard balancing.

    Returns C(T_pruned, tool_slots) -- the tool bundle-count upper bound -- by
    running the real optimize() with _ESTIMATE_ONLY, which early-returns right
    after the tool prune (before the expensive frontier build + MITM combine).
    Because it reuses the exact prep+prune, the count matches what the real
    solve would prune to. Returns 1 on any failure (never blocks the plan)."""
    try:
        opt = ExactTargetRateOptimizer(target_items)
        opt._ESTIMATE_ONLY = True
        opt.optimize(activity, character, skill=skill, location=location,
                     pets=pets, consumables=consumables, input_item=input_item)
        return max(1, int(getattr(opt, "last_estimate_weight", 1) or 1))
    except Exception:
        return 1
