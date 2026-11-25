"""Phase 0: per-skill *service frontier* for the goals-report crafting optimizer.

WHAT THIS SOLVES
----------------
Every artisan skill in WalkScape is one of two shapes:

  1. **Serviceless** — the skill's recipes need no crafting station. Nothing to
     pick; the per-recipe/per-step solve is used as-is (like crafting chest).
     `service_frontier_for_skill` returns an empty list for these.

  2. **One service type, many instances** — the skill uses a single station
     *type* (e.g. a loom), available as tiered instances (**basic / advanced /
     spectral(cursed)**) scattered across regions. A recipe may require a
     particular tier/specialization, but the *type* is fixed per skill.

Today the solver greedily picks the single highest-work_efficiency unlocked
service per recipe node (`crafting_tree._resolve_best_service_for_recipe`),
re-resolving it on every item/variant/quality. That (a) wastes work and (b) is
a WE-proxy that can miss a worse-service / better-region-gear combo — most
notably a **cursed/spectral station** whose region unlocks cursed gear bonuses
that outweigh the station's own penalty.

This module computes, ONCE per run per skill, the small set of
*non-dominated* (service, region) candidates. Phase 1 (separate change) then
runs the real gearset B&B only for the survivors and picks by actual
steps/craft — the cursed loom gets a fair shot iff it survives here.

ONLY STEPS-AFFECTING STATS MATTER
---------------------------------
`crafting_tree._calculate_steps_per_action` →
    steps = ceil( base/(1+min(WE, cap)) * (1+steps_percent) + steps_add ), then
double_action / double_rewards / no_materials_consumed / quality_outcome fold
in (`util/exact_craft_steps_optimizer`). So the only stats that move
steps/craft are:

    work_efficiency, double_action, double_rewards, no_materials_consumed
      (higher = better)
    steps_add, steps_percent
      (lower  = better)
    quality_outcome
      (higher = better; relevant ONLY when a quality tier is targeted)

WE is monotone-good, so the `max_efficiency` cap never flips a dominance
direction (more WE is never worse) — the cap only decides whether a WE edge is
*meaningful*, which the real solve in Phase 1 handles. Everything else (xp,
find-axes) is irrelevant and excluded.

DOMINANCE RULE (why Kallaheim dies but the cursed loom lives)
-------------------------------------------------------------
Each candidate carries two normalized ("higher = better") vectors over the
relevant axes:

  * `svc`  — the service's own stat bonuses.
  * `ceil` — the *region-conditional gear ceiling*: the best extra stat the
             character's OWNED gear can contribute **only in that region**
             (an item's stats at the region's location minus its stats at a
             neutral location, max per axis). Region-neutral gear is identical
             everywhere and cancels, so it is excluded.

A candidate A **dominates** B iff `svc_A ≥ svc_B` on every axis AND
`ceil_A ≥ ceil_B` on every axis (ties de-duplicated). Consequences:

  * Same region → identical `ceil`, so it reduces to a pure service-stat
    compare. The sawmill of Barbantok dominates Kallaheim and prunes it —
    exactly, no gear solve needed.
  * Cross region → the cursed/ghostly station's `ceil` carries cursed-gear
    bonuses the better station's region lacks, so `ceil_better ≥ ceil_cursed`
    is FALSE and the cursed station is NEVER pruned. It survives to Phase 1,
    where the real solve decides if cursed gear actually wins.

This only ever prunes an EXPLICITLY dominated candidate (≤ on every axis of
both vectors). Genuine trade-offs ("A better WE, B better steps_add", or a
unique region bonus) are always kept — soundly: whatever gearset B could field
in its region, A can field the same region-neutral gear + an at-least-as-good
region bonus + an at-least-as-good service, so A's best ≥ B's best.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

# Steps-affecting axes and their "good" direction. Normalization flips the
# lower-is-better axes so every stored value is "higher = better".
_AXES_UP = ("work_efficiency", "double_action", "double_rewards",
            "no_materials_consumed")
_AXES_DOWN = ("steps_add", "steps_percent")
_QUALITY_AXIS = "quality_outcome"

_EPS = 1e-9


def normalize_relevant(stats: Optional[Dict[str, Any]],
                       include_quality: bool) -> Dict[str, float]:
    """Project a raw stat dict onto the steps-affecting axes, sign-normalized so
    higher is always better. Lower-is-better axes (steps_add/steps_percent) are
    negated. quality_outcome is included only when a quality tier is targeted.
    Zero/absent values are dropped so comparisons treat them as 0."""
    out: Dict[str, float] = {}
    s = stats or {}
    for a in _AXES_UP:
        v = float(s.get(a, 0.0) or 0.0)
        if abs(v) > _EPS:
            out[a] = v
    for a in _AXES_DOWN:
        v = float(s.get(a, 0.0) or 0.0)
        if abs(v) > _EPS:
            out[a] = -v
    if include_quality:
        v = float(s.get(_QUALITY_AXIS, 0.0) or 0.0)
        if abs(v) > _EPS:
            out[_QUALITY_AXIS] = v
    return out


def _ge_all(a: Dict[str, float], b: Dict[str, float]) -> bool:
    """True iff a >= b on every axis present in either (missing treated as 0)."""
    for k in set(a) | set(b):
        if a.get(k, 0.0) < b.get(k, 0.0) - _EPS:
            return False
    return True


def _eq_all(a: Dict[str, float], b: Dict[str, float]) -> bool:
    for k in set(a) | set(b):
        if abs(a.get(k, 0.0) - b.get(k, 0.0)) > _EPS:
            return False
    return True


class FrontierCandidate:
    """One (service, region) option. `svc`/`ceil` are normalized relevant
    vectors (see module docstring); `payload` is opaque to the dominance core."""
    __slots__ = ("key", "region", "svc", "ceil", "payload")

    def __init__(self, key, region, svc, ceil, payload=None):
        self.key = key
        self.region = region
        self.svc = svc
        self.ceil = ceil
        self.payload = payload


def prune_frontier(cands: List[FrontierCandidate]) -> List[FrontierCandidate]:
    """Return the non-dominated candidates (pure, side-effect-free core).

    A dominates B iff svc_A >= svc_B AND ceil_A >= ceil_B on every axis. Exact
    duplicates (identical svc AND ceil) are collapsed to the earliest index.
    Order is preserved for the survivors."""
    survivors: List[FrontierCandidate] = []
    for i, b in enumerate(cands):
        dominated = False
        for j, a in enumerate(cands):
            if j == i:
                continue
            if _ge_all(a.svc, b.svc) and _ge_all(a.ceil, b.ceil):
                identical = _eq_all(a.svc, b.svc) and _eq_all(a.ceil, b.ceil)
                if not identical:
                    dominated = True
                    break
                if j < i:          # identical duplicate — keep the earliest
                    dominated = True
                    break
        if not dominated:
            survivors.append(b)
    return survivors


# ── real-data wiring (lazy crafting_tree imports; safe to import this module
#    without pulling the heavy crafting_tree graph until a frontier is built) ──

def _svc_skill_name(svc) -> str:
    c = getattr(svc, "category", None)
    if c is None:
        return ""
    return str(getattr(c, "value", None) or c).lower()


def _location_name(loc) -> Optional[str]:
    if loc is None:
        return None
    return getattr(loc, "name", None) or (str(loc) if loc else None)


def _region_of(loc) -> Optional[str]:
    if loc is None:
        return None
    reg = getattr(loc, "region", None)
    if reg is not None:
        return str(getattr(reg, "value", None) or getattr(reg, "name", None) or reg).lower()
    return _location_name(loc)


def _default_is_available(session_data) -> Callable[[Any], bool]:
    """Availability predicate mirroring _resolve_best_service_for_recipe's
    region/location-unlock filter. Best-effort; on import failure, allow all."""
    try:
        from ui.crafting_tree import (_is_location_in_unlocked_region,
                                       _is_location_locked)
    except Exception:
        return lambda _svc: True
    region_unlocks = set((session_data or {}).get("region_unlocks", []) or [])
    if not region_unlocks:
        # The stored character config usually has NO explicit 'region_unlocks'
        # key — unlocks are derived at runtime via detect_unlocked_regions (the
        # same detector the worker / column-3 path uses). Falling back to a
        # hardcoded {'jarvonia'} silently marked every GATED-region station
        # (e.g. Saw-in-half mill in Halfling Campgrounds, with its +DA/+DR)
        # unavailable, so the service frontier dropped genuinely-better
        # services and picked a worse base-region station -> inflated steps.
        # Derive the real unlocks instead. (fc-preopt service-frontier bugfix)
        try:
            from optimize_travel_gearsets import detect_unlocked_regions
            _info = detect_unlocked_regions(session_data or {})
            if isinstance(_info, dict):
                region_unlocks = {k for k, v in _info.items() if v}
            else:
                region_unlocks = set(_info or [])
        except Exception:
            region_unlocks = set()
        if not region_unlocks:
            region_unlocks = {"jarvonia"}

    def _ok(svc) -> bool:
        loc = getattr(svc, "location", None)
        if loc is None:
            return True
        try:
            if not _is_location_in_unlocked_region(loc, region_unlocks):
                return False
            loc_name = _location_name(loc)
            if _is_location_locked(loc_name, session_data):
                return False
        except Exception:
            return True
        return True

    return _ok


def _resolve_owned_equipment(session_data) -> List[Any]:
    """Unique owned equipment Item objects (dedup by base export name)."""
    if not session_data:
        return []
    owned = session_data.get("owned_items", []) or []
    try:
        from util.autogenerated.export_names import get_item_from_export_name
    except Exception:
        return []
    items, seen = [], set()
    for export_name in owned:
        base = export_name
        for suffix in ("_common", "_uncommon", "_rare", "_epic",
                       "_legendary", "_ethereal"):
            if export_name.endswith(suffix):
                base = export_name[: -len(suffix)]
                break
        if base in seen:
            continue
        seen.add(base)
        try:
            item = get_item_from_export_name(base, item_type="equipment")
        except Exception:
            item = None
        if item is not None:
            items.append(item)
    return items


def _char_ctx_and_ap(session_data):
    ap = None
    ctx = None
    try:
        from ui.crafting_tree import _CTCharacterContext
        if isinstance(session_data, dict):
            ap = session_data.get("achievement_points")
            ctx = _CTCharacterContext(session_data)
    except Exception:
        pass
    return ctx, ap


def _service_stats(svc, skill_name, session_data) -> Dict[str, float]:
    try:
        from ui.crafting_tree import _resolve_service_stats
        return _resolve_service_stats(svc, skill_name, session_data) or {}
    except Exception:
        return {}


def _region_gear_ceiling(owned_items, skill_name, loc, session_data,
                         include_quality) -> Dict[str, float]:
    """Max per-axis region-conditional contribution the character's OWNED gear
    can add in `loc`'s region: for each item, (stats at loc) − (stats neutral),
    normalized, kept where positive. Region-neutral gear contributes 0 (it
    cancels). Returns a normalized ("higher = better") ceiling vector."""
    if loc is None or not owned_items:
        return {}
    ctx, ap = _char_ctx_and_ap(session_data)
    ceil: Dict[str, float] = {}
    for item in owned_items:
        try:
            at_loc = item.get_stats_for_skill(skill_name, location=loc,
                                              achievement_points=ap,
                                              character=ctx) or {}
            at_neu = item.get_stats_for_skill(skill_name, location=None,
                                              achievement_points=ap,
                                              character=ctx) or {}
        except Exception:
            continue
        raw_delta = {k: float(at_loc.get(k, 0.0) or 0.0) - float(at_neu.get(k, 0.0) or 0.0)
                     for k in set(at_loc) | set(at_neu)}
        nd = normalize_relevant(raw_delta, include_quality)
        for k, v in nd.items():
            if v > ceil.get(k, 0.0):
                ceil[k] = v
    return ceil


def service_frontier_for_skill(
    skill_name: str,
    game_data: Dict[str, Any],
    session_data: Optional[Dict[str, Any]] = None,
    *,
    include_quality: bool = True,
    run_memo: Optional[Dict[Any, Any]] = None,
    is_available: Optional[Callable[[Any], bool]] = None,
    service_stats_fn: Optional[Callable[[Any], Dict[str, float]]] = None,
    region_ceiling_fn: Optional[Callable[[Any], Dict[str, float]]] = None,
    owned_items: Optional[List[Any]] = None,
) -> List[Dict[str, Any]]:
    """Compute the non-dominated (service, region) candidates for `skill_name`.

    Returns a list of payload dicts: {service, location, tier, region,
    svc_stats, region_ceiling}. Empty for a serviceless skill. Memoized per
    (skill, include_quality) in `run_memo` when supplied, so one pass serves
    every item/variant/quality of the skill in a run.

    The *_fn / owned_items hooks are injection points for unit tests; in
    production they default to the real crafting_tree wiring.
    """
    skill_key = str(skill_name).lower()
    memo_key = (skill_key, bool(include_quality))
    if run_memo is not None and memo_key in run_memo:
        return run_memo[memo_key]

    services = (game_data or {}).get("services", {}) or {}
    skill_svcs = [(sid, s) for sid, s in services.items()
                  if _svc_skill_name(s) == skill_key]

    if is_available is None:
        is_available = _default_is_available(session_data)
    if owned_items is None:
        owned_items = _resolve_owned_equipment(session_data)

    cands: List[FrontierCandidate] = []
    for service_id, s in skill_svcs:
        try:
            if not is_available(s):
                continue
        except Exception:
            pass
        loc = getattr(s, "location", None)
        loc_name = _location_name(loc)
        raw_svc = (service_stats_fn(s) if service_stats_fn
                   else _service_stats(s, skill_name, session_data))
        raw_ceil = (region_ceiling_fn(s) if region_ceiling_fn
                    else _region_gear_ceiling(owned_items, skill_name, loc,
                                              session_data, include_quality))
        # region_ceiling_fn is expected to return a normalized vector already;
        # the default _region_gear_ceiling does too. service stats are raw.
        svc_vec = normalize_relevant(raw_svc, include_quality)
        ceil_vec = dict(raw_ceil or {})
        cands.append(FrontierCandidate(
            key=(service_id, loc_name),
            region=_region_of(loc),
            svc=svc_vec,
            ceil=ceil_vec,
            payload={
                "service": s,
                "service_id": service_id,
                "service_name": getattr(s, "name", None),
                "tier": getattr(s, "tier", None),
                "location": loc_name,
                "region": _region_of(loc),
                "svc_stats": svc_vec,
                "region_ceiling": ceil_vec,
            },
        ))

    survivors = [c.payload for c in prune_frontier(cands)]
    if run_memo is not None:
        run_memo[memo_key] = survivors
    return survivors


def frontier_survivors_for_recipe(
    recipe,
    game_data: Dict[str, Any],
    session_data: Optional[Dict[str, Any]] = None,
    *,
    include_quality: bool = True,
    run_memo: Optional[Dict[Any, Any]] = None,
    service_valid_fn: Optional[Callable[[Any, Any], bool]] = None,
) -> List[Dict[str, Any]]:
    """Phase-1 entry point: the non-dominated service survivors VALID for one
    recipe. Serviceless recipes -> [] (caller keeps its no-service path). The
    per-skill frontier is computed once (memoized) then filtered to the tier /
    specialization this recipe demands via `service_valid_fn` (defaults to
    crafting_tree._service_valid_for_recipe). Returns survivor payload dicts."""
    svc_req = getattr(recipe, "service", None)
    if not svc_req or str(svc_req).lower() == "none":
        return []
    skill = getattr(recipe, "skill", None)
    if not skill:
        return []
    survivors = service_frontier_for_skill(
        skill, game_data, session_data,
        include_quality=include_quality, run_memo=run_memo)
    if service_valid_fn is None:
        try:
            from ui.crafting_tree import _service_valid_for_recipe as service_valid_fn
        except Exception:
            service_valid_fn = None
    if service_valid_fn is None:
        return survivors
    out = []
    for p in survivors:
        try:
            if service_valid_fn(p.get("service"), recipe):
                out.append(p)
        except Exception:
            continue
    return out
