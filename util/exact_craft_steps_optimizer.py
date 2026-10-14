"""PROTOTYPE — exact per-node crafting-tree gearset optimizer (downstream-weighted
steps-to-output objective) on the shared ExactGearsetOptimizer B&B engine.

Gated behind the `exact_tree` crafting-tree setting (see
ui/crafting_tree_optimize.py driver). NOT wired into the default path.

Objective (recipe node, children already resolved bottom-up):

    total_steps_per_output(g) =
        { engine_steps(g)/(output_qty + IF)              # this node's own craft steps
          + (1 - NMC(g)) * M0/output_qty }               # downstream material steps
        / [ (1 + DR(g)) * quality_prob(QO(g)) ]          # yield multipliers

    where M0 = Σ_child  base_req_c * child_cumulative_steps_per_material.

We MINIMIZE total, i.e. MAXIMIZE 1/total, which is exactly the engine's
`numerator / steps` ratio with:

    numerator(g) = (1 + DR(g)) * quality_prob(QO(g))
    steps(g)     = engine_steps(g)/(oq+IF) + (1 - NMC(g)) * (M0/oq)      # augmented denom

engine_steps(g) is the base engine's steps() (= steps_per_action / (1+DA), with
WE cap + steps_add/pct), so it matches ui/crafting_tree._calculate_steps_per_action
when the adapter carries base_steps, max_efficiency and skill_requirements={skill:
recipe.level}. Every axis is monotone in the objective (W, B/DA, DR, NMC, QO more
is better; S_add, S_pct less is better), so Pareto dominance — hence the B&B —
stays exact. MITM is left OFF (the inlined MITM combine assumes the coins/xp
numerator shape); pure B&B is used, which the spike measured at ~3-12s per recipe
(vs the whole heuristic tree timing out at 2m+).

For LEAF (activity/gather) nodes the existing util.exact_target_rate_optimizer
already computes exact steps/target — the driver uses that directly and this
module is recipe-only.
"""
import math

from util.exact_gearset_optimizer import ExactGearsetOptimizer

# QUALITY_TIERS ordering must match ui/crafting_tree (Normal .. Eternal ascending).
QUALITY_TIERS = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']


def quality_prob_for(recipe_level, qo_effective, target_quality, use_fine=False,
                     has_equipment_input=False):
    """P(rolled quality >= target_quality) — mirrors calculate_node_metrics."""
    if not target_quality or target_quality == 'Normal':
        return 1.0
    try:
        from util.quality_outcome import calculate_quality_weights
        qw = calculate_quality_weights(recipe_level, qo_effective, use_fine=use_fine,
                                       has_equipment_input=has_equipment_input)
        pct = qw.get('percentages', {})
        ti = QUALITY_TIERS.index(target_quality) if target_quality in QUALITY_TIERS else 0
        p = sum(pct.get(q, 0.0) / 100.0 for q in QUALITY_TIERS[ti:])
        return max(p, 1e-5)
    except Exception:
        return 1.0


class RecipeAdapter:
    """Minimal activity-shaped adapter so a recipe can drive the exact engine.

    The steps-to-output numerator never needs drop tables, so
    get_expected_drop_rate returns {} (kept only so the base engine's optional
    baseline probe can't blow up)."""
    __slots__ = ('name', 'base_xp', 'base_steps', 'max_efficiency', 'primary_skill',
                 'skill_requirements', 'locations', 'one_time', 'input_items',
                 'output_item', 'we_level_override', 'step_floor', 'requirements')

    def __init__(self, recipe, skill, location, service=None):
        self.name = getattr(recipe, 'name', 'recipe')
        self.base_xp = float(getattr(recipe, 'base_xp', 0.0) or 0.0)
        self.base_steps = int(getattr(recipe, 'base_steps', 0) or 0)
        self.max_efficiency = float(getattr(recipe, 'max_efficiency', 0.0) or 0.0)
        self.primary_skill = skill
        # skill_requirements drives the engine's WE_level (level bonus), matching
        # _calculate_steps_per_action's `activity_level = recipe.level`.
        self.skill_requirements = {skill: int(getattr(recipe, 'level', 1) or 1)}
        self.locations = [location] if location is not None else []
        self.one_time = False
        self.input_items = []
        self.output_item = getattr(recipe, 'output_item', '') or ''
        self.we_level_override = None
        # crafting_tree._calculate_steps_per_action floors at 10 — match it
        # (the engine's recipe default of 1 would diverge on floor-bound crafts).
        self.step_floor = 10
        # Carry the crafting service's keyword requirements (e.g. an underwater
        # kitchen's {'diving gear': 3}) so the base engine enforces them exactly
        # like an activity's requirements. The engine reads
        # requirements['keyword_counts'] in optimize() to build its `reqs`
        # feasibility set; without this a service-pinned recipe node ignored the
        # requirement entirely and produced a gearset missing the required
        # diving pieces (bug c1ab7499). Empty when no service is bound.
        _kc = {}
        if service is not None:
            _kc = dict((getattr(service, 'requirements', {}) or {}).get('keyword_counts', {}) or {})
        self.requirements = {'keyword_counts': _kc}

    def get_expected_drop_rate(self, *a, **k):
        return {}


class ExactCraftStepsOptimizer(ExactGearsetOptimizer):
    """Minimize total steps to one output item (this node + downstream materials).

    Construct with the resolved-per-node params, then call optimize() with the
    RecipeAdapter + character exactly like the other exact optimizers."""

    def __init__(self, *, output_qty, if_bonus, m0, recipe_level, level_bonus_qo,
                 target_quality, use_fine, has_equipment_input, apply_quality):
        super().__init__()
        # Bounded B&B: best-first finds the optimum (or within <1%) early; the
        # remaining millions of nodes only PROVE optimality on the Eternal/DR/NMC
        # plateau. The spike showed the incumbent is stable well before this cap
        # (~0.8-4s/node) while an unbounded solve takes 10-26s. Prototype trades
        # a proof-of-optimality certificate for ~5x speed; still returns the
        # best-first incumbent (near-always the true optimum). Tunable per call.
        self.NODE_BUDGET = 400_000
        self._oq = max(1e-9, float(output_qty))
        self._oq_plus_if = max(1e-9, float(output_qty) + float(if_bonus))
        self._mat_per_output0 = float(m0) / self._oq          # M0/output_qty (>=0)
        self._recipe_level = int(recipe_level)
        self._level_bonus_qo = float(level_bonus_qo)
        self._target_quality = target_quality
        self._use_fine = bool(use_fine)
        self._has_equipment_input = bool(has_equipment_input)
        self._apply_quality = bool(apply_quality)
        # Axis model: base step axes + double_rewards / no_materials_consumed.
        # The quality_outcome ('qo') axis is included ONLY for quality-target
        # nodes (root equipment). For material nodes quality_prob==1, so 'qo'
        # has zero effect on the objective and would only inflate the B&B
        # Pareto frontier (a pure plateau-expander) — drop it there.
        base_axes = ["W", "S_add", "S_pct", "B", "dr", "nmc"]
        base_max = ["W", "B", "dr", "nmc"]
        axis_map = {"work_efficiency": "W", "steps_add": "S_add",
                    "steps_percent": "S_pct", "double_action": "B",
                    "double_rewards": "dr", "no_materials_consumed": "nmc"}
        if self._apply_quality:
            base_axes.append("qo")
            base_max.append("qo")
            axis_map["quality_outcome"] = "qo"
        self.AXES = tuple(base_axes)
        self.MAX_AXES = tuple(base_max)
        self.MIN_AXES = ("S_add", "S_pct")
        self.CAP_AXIS = "W"
        self.AXIS_MAP = axis_map
        self._MITM_ENABLED = False   # custom objective — pure B&B only.

    # ── quality helper ────────────────────────────────────────────────────
    def _qp(self, qo_axis):
        if not self._apply_quality:
            return 1.0
        return quality_prob_for(self._recipe_level, float(qo_axis) + self._level_bonus_qo,
                                self._target_quality, use_fine=self._use_fine,
                                has_equipment_input=self._has_equipment_input)

    # ── numerator = (1+DR) * quality_prob(QO) ─────────────────────────────
    def numerator(self, X0, s):
        dr = min(1.0, max(0.0, s.get("dr", 0.0)))
        return (1.0 + dr) * self._qp(s.get("qo", 0.0))

    def numerator_bound(self, X0, s, R):
        dr = min(1.0, max(0.0, s.get("dr", 0.0) + R.get("dr", 0.0)))
        return (1.0 + dr) * self._qp(s.get("qo", 0.0) + R.get("qo", 0.0))

    # ── steps = engine_steps/(oq+IF) + (1-NMC)*M0/oq (material-augmented) ──
    def steps(self, S0, kappa, WE_level, s):
        base = super().steps(S0, kappa, WE_level, s)          # = steps_per_action/(1+DA)
        nmc = min(0.99, max(0.0, s.get("nmc", 0.0)))
        return base / self._oq_plus_if + (1.0 - nmc) * self._mat_per_output0

    def steps_lower_bound(self, S0, kappa, WE_level, s, R):
        base_lb = super().steps_lower_bound(S0, kappa, WE_level, s, R)
        # Max reachable NMC -> smallest material term -> admissible lower bound.
        nmc_hi = min(0.99, max(0.0, s.get("nmc", 0.0) + R.get("nmc", 0.0)))
        return base_lb / self._oq_plus_if + (1.0 - nmc_hi) * self._mat_per_output0


def exact_craft_steps_optimize(recipe, character, *, skill, location,
                               output_qty, if_bonus, m0, recipe_level,
                               level_bonus_qo, target_quality, use_fine,
                               has_equipment_input, apply_quality,
                               pets=None, consumables=None, node_budget=None,
                               service=None, base_stats_extra=None):
    """Return {slot: Item|None} for a recipe node (the exact steps-to-output
    gearset), or None on failure. The caller computes the authoritative
    total_steps_per_output by re-running the tree's own calculate_node_metrics
    with this gearset (that keeps the exact pick and the displayed value in
    lockstep and doubles as a correctness check).

    When `service` is provided (the node's pinned crafting service), its
    keyword requirements (e.g. an underwater kitchen's {'diving gear': 3}) are
    enforced by the engine and its stat bonuses are folded in via base_stats,
    so the exact pick matches the service the user chose (bug c1ab7499).

    `base_stats_extra` is an additive stat overlay (e.g. the stats of a pinned
    consumable / pet the user locked into the node) folded into the engine
    baseline so EVERY candidate gearset is scored with those stats active. This
    keeps the gear decision — and the displayed QO — correct when a pinned
    consumable carries QO that neither candidate gear item does (bug cccc3581 /
    1f19d6da: pinned Sweet carrot pie's +QO was dropped, so the gourd/bandolier
    back-slot pick flipped and QO flickered 242<->237 across the swap)."""
    opt = ExactCraftStepsOptimizer(
        output_qty=output_qty, if_bonus=if_bonus, m0=m0, recipe_level=recipe_level,
        level_bonus_qo=level_bonus_qo, target_quality=target_quality,
        use_fine=use_fine, has_equipment_input=has_equipment_input,
        apply_quality=apply_quality)
    if node_budget:
        opt.NODE_BUDGET = int(node_budget)
    adapter = RecipeAdapter(recipe, skill, location, service=service)
    # Fold the service's stat bonuses (work_efficiency, steps_add, …) into the
    # engine baseline so the gearset is scored against the chosen service —
    # mirrors optimize_craft_gearsets' `service.get_stats_for_skill(...)`. Only
    # when a service is bound; auto / no-service recipe nodes are unchanged.
    base_stats = None
    if service is not None:
        try:
            base_stats = service.get_stats_for_skill(
                skill, location=location, character=character)
        except Exception:
            base_stats = None
    # Overlay the pinned consumable / pet stats (bug cccc3581 / 1f19d6da). The
    # overlay is additive and applied to every candidate, so it never changes
    # which gear item is relatively best on its OWN axes but it does restore the
    # correct QO/DR/… baseline the engine divides the objective by.
    if base_stats_extra:
        merged = dict(base_stats or {})
        for _k, _v in base_stats_extra.items():
            try:
                merged[_k] = merged.get(_k, 0.0) + float(_v)
            except (TypeError, ValueError):
                continue
        base_stats = merged
    return opt.optimize(adapter, character, skill=skill, location=location,
                        base_stats=base_stats, pets=pets, consumables=consumables)
