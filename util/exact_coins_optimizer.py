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
from util.exact_gearset_optimizer import ExactGearsetOptimizer

_EXACT_NODE_BUDGET = 5_000_000
last_run_budget_exhausted = False

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

        # Extend the axis model with the additive find axes (all more-is-better).
        add_axes = tuple(k.keys())
        self.AXES = ("W", "S_add", "S_pct", "B", "dr") + add_axes
        self.MAX_AXES = ("W", "B", "dr") + add_axes
        for ax in add_axes:
            self.AXIS_MAP[ax] = ax    # find stat name is its own axis

    def numerator(self, X0, s):
        return (1.0 + s["dr"]) * (self._C0 + sum(self._k[a] * s.get(a, 0.) for a in self._k))

    def numerator_bound(self, X0, s, R):
        # Monotone: raise dr and every find axis by their suffix reserves.
        return (1.0 + s["dr"] + R.get("dr", 0.)) * (
            self._C0 + sum(self._k[a] * (s.get(a, 0.) + R.get(a, 0.)) for a in self._k))


def exact_coins_optimize(activity, character, skill=None, location=None, base_stats=None,
                         pets=None, consumables=None, input_item=None, include_chests=True):
    """Return {slot: Item|None} maximizing coins/step, or None to fall back."""
    opt = ExactCoinsOptimizer(include_chests=include_chests)
    opt.NODE_BUDGET = _EXACT_NODE_BUDGET
    result = opt.optimize(activity, character, skill=skill, location=location,
                          base_stats=base_stats, pets=pets, consumables=consumables,
                          input_item=input_item)
    globals()["last_run_budget_exhausted"] = opt.last_run_budget_exhausted
    return result
