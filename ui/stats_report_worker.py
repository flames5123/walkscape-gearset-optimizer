#!/usr/bin/env python3
"""
Stats Report Worker

Background subprocess that runs bulk optimization across multiple categories
and skills. Follows the same subprocess pattern as optimize_worker.py.

CLI Usage:
    python3 stats_report_worker.py \\
        --session-uuid <uuid> \\
        --run-id <uuid> \\
        --db-path <path> \\
        --categories '["xp","new_items","chests","coins"]' \\
        --skills '["Mining","Fishing"]' \\
        --notify true \\
        --mode fresh|merge

The worker communicates exclusively through the database — no shared memory.
"""

import sys
import os
import json
import uuid
import time
import argparse
import signal
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import List, Optional, Dict, Any

# Add parent directory to path so we can import util.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ============================================================================
# CONFIGURATION
# ============================================================================

STATS_REPORT_WORKER_CONCURRENCY = 1  # Serialized via _OPTIMIZER_LOCK below
                                      # — keeping >1 was wasted CPU contention.
DB_WRITE_RETRIES = 3                  # Retry attempts for DB writes
DB_WRITE_RETRY_DELAY = 1.0            # Seconds between retries

# 2026-05-22: optimizer module-global lock.
#
# `optimize_activity_gearsets` exposes its per-call configuration as
# MODULE-LEVEL globals (TARGET_ITEM, SORTING_PRIORITY, SORTING_WEIGHTS,
# ACTIVITY, INCLUDE_PETS, CONSUMABLE_ITEMS, etc. — ~15 of them). Each
# stats-report job mutates those globals before invoking the optimizer.
#
# With STATS_REPORT_WORKER_CONCURRENCY=4 ThreadPoolExecutor threads,
# multiple jobs setting/reading those globals concurrently produces a
# classic race condition:
#
#   Thread A: sets TARGET_ITEM='Bird nest' (chest job)
#   Thread B: sets TARGET_ITEM='cat:coins' (coins job)  ← clobbers A
#   Thread A: calls calculate_gearset_metrics → reads TARGET_ITEM →
#             sees 'cat:coins' → builds composite key for the wrong
#             target → A's metrics dict has no entry for 'Bird nest' →
#             worker falls back to bare steps_per_reward_roll (~12.81)
#             instead of steps_per_chest (~1918).
#
# Same race produces wrong gearsets too: the optimizer's local search
# scores against the WRONG TARGET if another thread has clobbered the
# global. So the user sees both wrong values AND suboptimal gear.
#
# Fix: hold this lock across the entire job's "configure globals →
# greedy → local search → final calculate_gearset_metrics" critical
# section so jobs effectively serialize through the optimizer.
# Concurrency drops to 1 for the optimizer-bound portion of each job
# but the rest (DB writes, log writes) stays parallel. CPython's GIL
# already serializes pure-Python work anyway, so the wall-clock cost
# is minor.
#
# Long-term fix is to refactor optimize_activity_gearsets to take the
# config as parameters instead of module globals — out of scope for
# this CR.
_OPTIMIZER_LOCK = threading.Lock()

# Run-scoped MITM frontier cache for recipe-chest exact solves. The tool/gear/
# ring Pareto frontiers depend only on (character, skill, location, reqs, pools)
# — not on the recipe's base_steps/kappa — so all recipes of a skill at the same
# service reuse one build (~4-5x for tool-heavy skills). Cleared at the start of
# each worker run so a different character/run never reuses a stale frontier.
_RECIPE_FRONTIER_CACHE = {}

# Per-run memoization for the stale-detection write (_write_stats_report_result_row).
# That function runs once per job; without these caches it (a) rebuilt the
# IDENTICAL character snapshot from the full session (a large inventory JSON
# parse) for every job, and (b) recomputed compute_effective_owned_bitmap — a
# per-owned-item SQL scan — even though the bitmap depends only on
# (skill, location, service, quality_mode), which many scopes share. For a
# 231-job chest-recipe greedy run this duplicated work was the dominant cost
# (~3.4s/job, ETA ~14m) and made greedy no faster than full. The snapshot is
# constant for the run, and there are only a handful of distinct scope keys, so
# caching collapses 231 heavy computations to one snapshot + a few bitmaps.
# The worker runs a single run per process, so these are run-scoped; the lock
# keeps them safe if STATS_REPORT_WORKER_CONCURRENCY is ever raised above 1.
_STALE_MEMO_LOCK = threading.Lock()
_STALE_SNAPSHOT_CACHE = {}   # session_uuid -> CharacterStateSnapshot
_STALE_BITMAP_CACHE = {}     # (skill, location, service, quality_mode) -> bytes
_STALE_RECIPE_CTX_CACHE = {} # session_uuid -> (unlocked_regions, locked_locations, services_by_name)
# 2026-08-31 (jwbail): run-level "Always use active applicable pet ability"
# flag. Set by run_worker() (server) / optimize-local-worker.js (browser) at
# the start of a run; read by _extract_pet_consumable_meta to mark the chosen
# pet's slot with useAbility so Equip checks column-2's per-pet ability box.
_USE_PET_ABILITY = False
# When True, consumables the user hid (column-1 hide) are still considered by
# the goals-report optimizer (still subject to the fine + min-owned rules).
# Set per-run in run_worker; the local Pyodide path sets it directly.
_USE_HIDDEN_CONSUMABLES = False
# "Include unavailable" dimensions. Each dimension, when True, un-hides
# activities the goals report would normally exclude because they are gated
# ONLY by that dimension (union semantics: an activity gated by several
# dimensions appears only when EVERY gating dimension is enabled). Set per-run
# in run_worker from the EFFECTIVE flags (includeUnavailable && unavailBy<Dim>);
# the local Pyodide path sets srw._INCL_UNAVAIL directly. The default (no flags
# passed) reproduces the pre-feature behavior exactly: inputs included-with-
# warning, everything else excluded.
_INCL_UNAVAIL = {'level': False, 'location': False, 'gear': False,
                 'inputs': True, 'other': False}


def _normalize_incl_unavail(d):
    """Normalize an include-unavailable flag dict to the full 5-key shape.

    Returns {'level','location','gear','inputs','other'} booleans. ``inputs``
    defaults True and every other dimension defaults False when the input is
    None or omits the key — this is the legacy/no-flags behavior (inputs
    included-with-warning, all other unavailable activities hidden)."""
    base = {'level': False, 'location': False, 'gear': False,
            'inputs': True, 'other': False}
    if isinstance(d, dict):
        for k in base:
            if k in d:
                base[k] = bool(d[k])
    return base


def _incl(dim):
    """True if the given include-unavailable dimension is enabled this run.

    inputs defaults True, every other dimension defaults False — so a worker
    invoked without any flags reproduces today's behavior."""
    cfg = globals().get('_INCL_UNAVAIL')
    if isinstance(cfg, dict) and dim in cfg:
        return bool(cfg[dim])
    return dim == 'inputs'


def _sr_effective_ignored(hidden_items):
    """IGNORED_ITEMS for the goals-report optimizer. Strips hidden CONSUMABLES
    (items with a ``duration`` attr) when "Use hidden consumables" is on, so
    they can actually be picked; hidden gear/tools stay ignored."""
    ig = set(hidden_items) if hidden_items else set()
    if ig and globals().get('_USE_HIDDEN_CONSUMABLES', False):
        ig = {x for x in ig if not hasattr(x, 'duration')}
    return ig
# (run_id, activity_name, location, fast) -> (gearset, budget_exhausted). Chests
# of one activity share the optimal gearset, so solve once and reuse.
_CHEST_SOLVE_CACHE = {}

# target_items exact-solve reuse. Key includes a find-SIGNATURE so only
# (item, activity) scopes whose applicable find-gear is identical share a
# solve. See _ti_find_signature. Cleared per run (also keyed by run_id).
_TI_SOLVE_CACHE = {}
# Memoized reverse map: item_ref -> frozenset('ItemFindingCategory.<CAT>').
# Built at runtime from util.autogenerated.item_finding so a game-data regen
# (new IF categories / new member items) flows in with NO code change.
_TI_ITEM_IFC_MAP = None


def _reapply_character_thread_local_globals(character):
    """Re-apply the character's thread-local walkscape_globals in THIS thread.

    util/walkscape_globals.py stores achievement_points / total_skill_level /
    custom_stats / total_collectibles in threading.local(). Character.__init__
    writes them in whichever thread loaded the character (the main request
    thread), but ThreadPoolExecutor workers get a DIFFERENT threading.local()
    whose values fall back to defaults (0 / 0 / {} / 0). The optimizer reads
    these via walkscape_globals.get_*() during stat aggregation, so any global
    left at its default silently strips the corresponding bonuses on every
    piece of gear evaluated in the worker thread.

    Symptoms this guards against:
      * total_skill_level=0 → level-multiplier + total-skill-gated set bonuses
        (e.g. Treasure hunter set's per-piece find_collectibles) are stripped
        (original 2026-05-25 fix).
      * total_collectibles=0 (bug feaa0b46) → CollectibleOwned-gated gear (the
        item collection ring) resolves to EMPTY stats, is filtered out by
        has_activity_relevant_stats, and the optimizer picks a strictly
        dominated ring (e.g. Great gold jade ring over the collection ring).
        The "regular" optimizer runs in the request thread where the global is
        set, hence the user-reported divergence.

    Mirrors util/character_export_util.py's Character load, which is the single
    source of truth for how each global is derived from the character.
    """
    import util.walkscape_globals as _wg
    _ap = getattr(character, 'achievement_points', None)
    if _ap is not None:
        _wg.set_achievement_points(_ap)
    _tsl = getattr(character, '_total_skill_level', None)
    if _tsl is not None:
        _wg.set_total_skill_level(_tsl)
    _cs = getattr(character, 'custom_stats', None)
    if _cs is not None:
        _wg.set_custom_stats(_cs)
    # Prefer the raw export list length (matches character_export_util) so
    # brand-new/unknown collectibles still count; fall back to the parsed list.
    _cr = getattr(character, '_collectibles_raw', None)
    if _cr is None:
        _cr = getattr(character, 'collectibles', None)
    if _cr is not None:
        _wg.set_total_collectibles(len(_cr))


def _reset_stale_memo():
    """Clear the per-run stale-detection memo caches. Called at run_worker start."""
    with _STALE_MEMO_LOCK:
        _STALE_SNAPSHOT_CACHE.clear()
        _STALE_BITMAP_CACHE.clear()
        _STALE_RECIPE_CTX_CACHE.clear()
    # Chest-solve reuse cache: an activity's chests share one optimal gearset
    # (chest_finding is universal), so we solve once per (run, activity,
    # location) and reuse across its chests. Cleared per run (also keyed by
    # run_id, so cross-run collisions are impossible even if a clear is missed).
    _CHEST_SOLVE_CACHE.clear()
    _TI_SOLVE_CACHE.clear()


def _scoped_owned_bitmap(snapshot, skill, loc, quality_mode, req_kw, conn):
    """Compute the effective-owned dominance bitmap, memoized ON THE SNAPSHOT
    instance instead of a module-global.

    History (bug 8990f0e4 / the 2026-09-01 bitmap disable): the memo used to be
    the module-global ``_STALE_BITMAP_CACHE`` keyed only by
    ``(skill, loc, quality_mode, req_kw)`` and guarded by ``_STALE_MEMO_LOCK``.
    Under the threaded worker two different characters' runs share the process,
    so a run that cached a bitmap for e.g. ``(mining, ..., activity)`` could hand
    that SAME bitmap to another character's write for the identical scope key --
    storing a bitmap for the WRONG owned set. The stored bitmap then never
    matched the correct recompute, so the bitmap comparison produced a 100%
    false-positive re-optimize loop that never cleared -- which is why it was
    disabled and only the metric hash was compared. But the metric hash does not
    capture owned gear, so gaining a better gear piece (e.g. the Heavy pick
    handle for an Ore target scope) stopped re-flagging anything.

    Scoping the cache to the snapshot instance (one per session per state)
    removes the cross-contamination at the root, so the bitmap signal can be
    re-enabled safely. The snapshot is a frozen dataclass; the cache is stashed
    as a non-field attr (does not affect ``__eq__`` / prev!=curr comparisons),
    the same pattern effective_bitmap uses for ``_owned_unlocked_cache``.

    Returns b"" on any error (fail-open: the caller treats an empty bitmap as
    "no signal" and falls back to the metric hash, never false-flagging).
    """
    if not skill:
        return b""
    from util.stats_report.effective_bitmap import compute_effective_owned_bitmap
    key = (skill, loc, quality_mode, frozenset(req_kw or ()))
    cache = None
    try:
        cache = snapshot.__dict__.get("_stale_bitmap_cache")
        if cache is None:
            cache = {}
            object.__setattr__(snapshot, "_stale_bitmap_cache", cache)
    except Exception:
        cache = None
    if cache is not None and key in cache:
        return cache[key]
    try:
        bm = compute_effective_owned_bitmap(
            snapshot, skill, loc, "NONE", quality_mode, db=conn,
            required_keywords=(req_kw or None),
        )
    except Exception:
        bm = b""
    # Cache SUCCESSES only, so a transient failure can be retried.
    if bm and cache is not None:
        cache[key] = bm
    return bm or b""


def _recipe_loc_ctx(session_uuid, db, snapshot):
    """Return (snapshot, unlocked_regions, locked_locations, services_by_name)
    for chests_recipes location derivation via representative_recipe_service_location.

    unlocked_regions/locked_locations are computed with the SAME function the
    enumerator uses (applicable_sources._resolve_accessibility) from the same
    session char_config, and services come from the same SERVICES_BY_NAME, so the
    worker's recipe location key matches the enumerator's by construction. The
    accessibility + service catalog are constant per run, so cache them per
    session_uuid (cleared at run start by _reset_stale_memo). `snapshot` is the
    per-call current state (identical across callers — both from_char_config of
    the same session)."""
    with _STALE_MEMO_LOCK:
        cached = _STALE_RECIPE_CTX_CACHE.get(session_uuid)
    if cached is None:
        try:
            cc = (db.get_session(session_uuid) or {}).get('character_config') or {}
        except Exception:
            cc = {}
        try:
            from util.stats_report.applicable_sources import _resolve_accessibility
            ur, ll = _resolve_accessibility(cc)
        except Exception:
            ur, ll = None, set()
        try:
            from util.autogenerated.services import SERVICES_BY_NAME
        except Exception:
            SERVICES_BY_NAME = {}
        cached = (ur, ll, SERVICES_BY_NAME)
        with _STALE_MEMO_LOCK:
            _STALE_RECIPE_CTX_CACHE[session_uuid] = cached
    ur, ll, svc_map = cached
    return (snapshot, ur, ll, svc_map)


# ============================================================================
# JOB DATACLASS
# ============================================================================

@dataclass
class ReportJob:
    """A single optimization job within a stats report run."""
    job_id: str
    run_id: str
    session_uuid: str
    category: str           # 'xp' | 'new_items' | 'chests' | 'coins' | 'chests_recipes'
    activity: Any           # ActivityInfo object (or _RecipeShim for chests_recipes)
    skill_name: Optional[str] = None
    chest_name: Optional[str] = None
    # For chests_recipes: name of the recipe (also stored on the shim's
    # .name for back-compat, but this field is the canonical lookup key
    # for RECIPES_BY_NAME without depending on shim attribute presence).
    recipe_name: Optional[str] = None
    # For new_items: pre-computed weighted score (no optimizer needed)
    precomputed_metric: Optional[float] = None
    precomputed_metric_name: Optional[str] = None
    # 2026-05-24: free-form bag of category-specific metadata that the
    # job builder wants to plumb into the result row's metrics_json.
    # Currently used by build_new_items_jobs to carry the best-drop
    # info (item_name, item_ref, kind) so the frontend can render the
    # item icon and wire the column-3 drop popover.
    extras: Optional[Dict[str, Any]] = None


# ============================================================================
# JOB BUILDERS
# ============================================================================

def _activity_first_accessible_location(activity):
    """Return the first location of the activity that the character can access.

    Reads `_UNLOCKED_REGIONS` and `_LOCKED_LOCATIONS` populated in
    run_worker. A location is accessible iff:
      - At least one of its regions is in _UNLOCKED_REGIONS, AND
      - Its name is NOT in _LOCKED_LOCATIONS.

    Returns the first matching Location object, or None if every
    location of the activity is gated. When _UNLOCKED_REGIONS is None
    (precompute failed) we fall back to the activity's first listed
    location (preserving prior behavior — no filtering).

    The pre-existing build_*_jobs path used `activity.locations[0]`
    directly, which surfaced inaccessible activities in coin/xp/chest
    sections (user-reported: 'Mine gold ore at Crown of Cinders'
    showing for a character without Charter of the Drowned). This
    helper fixes that without changing how single-location activities
    are handled.
    """
    locs = getattr(activity, "locations", None) or []
    if not locs:
        return None
    unlocked = globals().get('_UNLOCKED_REGIONS')
    locked = globals().get('_LOCKED_LOCATIONS') or set()
    if unlocked is None:
        # Fallback when precompute failed — preserve old behavior
        return locs[0]
    for loc in locs:
        loc_name = loc if isinstance(loc, str) else getattr(loc, 'name', '')
        if loc_name in locked:
            continue
        regions = getattr(loc, 'regions', None) if not isinstance(loc, str) else None
        if regions is None:
            # Strings or locations missing regions — keep them so we
            # don't accidentally drop activities with non-standard
            # location data.
            return loc
        if any(r in unlocked for r in regions):
            return loc
    return None


def _activity_accessible_locations(activity):
    """All accessible locations for an activity (multi-location coverage).

    Same accessibility rule as `_activity_first_accessible_location`, but returns
    EVERY matching Location (deduped by name) instead of just the first. Returns
    [] when none are accessible. When `_UNLOCKED_REGIONS` is None (precompute
    failed) returns the single fallback `[locations[0]]` to preserve prior
    single-location behavior exactly.
    """
    locs = getattr(activity, "locations", None) or []
    if not locs:
        return []
    unlocked = globals().get('_UNLOCKED_REGIONS')
    locked = globals().get('_LOCKED_LOCATIONS') or set()
    if unlocked is None:
        return [locs[0]]
    out = []
    seen = set()
    for loc in locs:
        loc_name = loc if isinstance(loc, str) else getattr(loc, 'name', '')
        if loc_name in locked:
            continue
        regions = getattr(loc, 'regions', None) if not isinstance(loc, str) else None
        if regions is None:
            if loc_name not in seen:
                seen.add(loc_name); out.append(loc)
            continue
        if any(r in unlocked for r in regions):
            if loc_name not in seen:
                seen.add(loc_name); out.append(loc)
    return out


def _service_location_accessible(service) -> bool:
    """Return True if the service's location is in an unlocked, non-locked region.

    Mirrors `_activity_first_accessible_location` for crafting services.
    `ServiceInstance.is_unlocked()` only checks skill / reputation / coins /
    keyword requirements and DELIBERATELY ignores region & item gating (see
    services.py — it tolerates item/"Region Access" entries, deferring region
    gating to "elsewhere"). For recipe services that "elsewhere" never existed,
    so a service in a locked region (e.g. Heatstroke Metalworks in Myriadian
    Arc, gated by the Charter of the Drowned) passed is_unlocked() for everyone
    and got recommended even though the character can't reach it.

    Reads `_UNLOCKED_REGIONS` / `_LOCKED_LOCATIONS` populated in run_worker.
    When `_UNLOCKED_REGIONS` is None (precompute failed) we don't filter
    (preserve prior behavior). Services with no location are not gated.
    """
    loc = getattr(service, 'location', None)
    if loc is None:
        return True
    loc_name = loc if isinstance(loc, str) else getattr(loc, 'name', '')
    locked = globals().get('_LOCKED_LOCATIONS') or set()
    if loc_name and loc_name in locked:
        return False
    unlocked = globals().get('_UNLOCKED_REGIONS')
    if unlocked is None:
        return True  # no filter when accessibility data is unavailable
    regions = getattr(loc, 'regions', None) if not isinstance(loc, str) else None
    if regions is None:
        # String location or missing regions — don't drop (consistent with
        # the activity helper's handling of non-standard location data).
        return True
    return any(r in unlocked for r in regions)


def _activity_required_gear_owned(activity, character) -> bool:
    """Necessary-condition gear feasibility gate for the goals/stats report.

    Returns False ONLY when the character provably cannot satisfy the
    activity's `keyword_counts` gear requirement from OWNED items — e.g. the
    Casbrant's Grave underwater activities require `advanced diving gear: 3`
    (Wreck Diving, Sea fishing (Spear)); a character owning zero diving gear
    can never build a valid gearset, so the optimizer returns "0/0
    optimizations" and the row is a dead end (bug: goals report recommended
    them anyway).

    Why the report needs this: build_*_jobs gate on `activity.is_unlocked(
    character=character)`, but ActivityInfo.is_unlocked only enforces
    keyword_counts when a GEARSET is passed (see activities.py). With no
    gearset the diving-gear requirement is skipped, so region-unlocked +
    skill-met underwater activities surface even with no diving gear owned.

    Conservative by construction — it counts total owned QUANTITY of items
    carrying each required keyword (an OVER-count of real equip capacity,
    since slot conflicts are ignored), so it only returns False when the
    requirement is literally un-equippable; it never hides an activity the
    player could actually gear for. Owned-but-custom-stat-locked gear still
    counts as owned (per the "hide when NOT owned" policy), so the existing
    required-but-locked toast — not this gate — surfaces that case.

    Keywords the activity's input_items can supply (e.g. 'arrows' for
    Alligator hunting) are credited 1, mirroring
    optimization_utils.meets_activity_requirements' input pre-satisfaction, so
    input-driven activities are never wrongly hidden.
    """
    reqs = getattr(activity, 'requirements', None) or {}
    keyword_counts = reqs.get('keyword_counts', {}) if isinstance(reqs, dict) else {}
    if not keyword_counts:
        return True
    try:
        from util.optimization_utils import item_satisfies_required_keyword
    except Exception:
        # Can't evaluate the requirement -> be permissive (don't hide).
        return True

    # Keywords the activity's input_items can pre-satisfy (credit 1 each),
    # matching meets_activity_requirements' "no input selected -> pre-satisfy
    # from activity.input_items definitions" behavior.
    input_kw = set()
    for ii in (getattr(activity, 'input_items', None) or []):
        if getattr(ii, 'type', '') == 'keyword':
            ref = (getattr(ii, 'reference', '') or '').lower()
            if ref:
                input_kw.add(ref)

    owned = getattr(character, 'items', None) or {}
    if not isinstance(owned, dict):
        return True

    for keyword, required_count in keyword_counts.items():
        try:
            required = int(required_count or 0)
        except (TypeError, ValueError):
            required = 0
        needed = required - (1 if str(keyword).lower() in input_kw else 0)
        if needed <= 0:
            continue
        capacity = 0
        for item, qty in owned.items():
            if item is None:
                continue
            try:
                q = int(qty or 0)
            except (TypeError, ValueError):
                q = 0
            if q <= 0:
                continue
            try:
                if item_satisfies_required_keyword(item, keyword, activity):
                    capacity += q
                    if capacity >= needed:
                        break
            except Exception:
                # Unevaluable item -> be permissive for this keyword.
                capacity = needed
                break
        if capacity < needed:
            return False
    return True


def _skill_display_name(skill):
    """Best-effort display-cased skill name from a skill key/object."""
    s = skill if isinstance(skill, str) else getattr(skill, 'name', '') or str(skill)
    return s.capitalize() if s and s.islower() else s


def _activity_unlock_dims(activity, character):
    """Why does ``activity.is_unlocked(character=character)`` fail?

    Mirrors (in order) the non-gearset checks in ActivityInfo.is_unlocked and
    attributes the failure to an include-unavailable dimension:

      * skill-level requirement unmet -> 'level' (+ missing_level reason)
      * reputation / achievement-point / completion gate unmet -> 'other'
        (+ missing_other reason)

    Returns ``(dims, reasons, hard)`` where ``dims`` is a subset of
    {'level','other'}, ``reasons`` is a dict of metrics_breakdown keys to merge,
    and ``hard`` is True for a permanent lock (a done single-completion activity)
    which must stay excluded regardless of any include-unavailable toggle."""
    # Permanent lock: a completed single-completion activity can never recur.
    try:
        if getattr(activity, 'single_completion', False):
            key = activity.name.lower().replace(' ', '_')
            cs = getattr(character, 'custom_stats', None)
            if not cs:
                try:
                    from util.walkscape_globals import get_custom_stats
                    cs = get_custom_stats()
                except Exception:
                    cs = None
            if cs and cs.get(key) is True:
                return set(), {}, True
    except Exception:
        pass

    dims = set()
    reasons = {}
    # Skill level.
    try:
        for skill, required_level in (getattr(activity, 'skill_requirements', {}) or {}).items():
            try:
                have = character.get_skill_level(str(skill).lower())
            except Exception:
                have = 0
            if have < required_level:
                dims.add('level')
                reasons['missing_level'] = {
                    'skill': _skill_display_name(skill),
                    'level': int(required_level),
                }
                break
    except Exception:
        pass
    # Reputation / achievement points (everything is_unlocked gates that is NOT
    # a skill level is bucketed under 'other').
    try:
        reqs = getattr(activity, 'requirements', {}) or {}
        _rep_lc = {str(k).lower(): v for k, v in (getattr(character, 'reputation', None) or {}).items()}
        for faction, required_amount in (reqs.get('reputation', {}) or {}).items():
            if _rep_lc.get(str(faction).lower(), 0) < required_amount:
                dims.add('other')
                reasons.setdefault('missing_other', {
                    'kind': 'reputation',
                    'detail': f'{faction} reputation {required_amount}',
                })
                break
    except Exception:
        pass
    try:
        reqs = getattr(activity, 'requirements', {}) or {}
        required_ap = reqs.get('achievement_points', 0) or 0
        if required_ap > 0 and 'missing_other' not in reasons:
            try:
                from util.walkscape_globals import ACHIEVEMENT_POINTS
                _have_ap = ACHIEVEMENT_POINTS
            except Exception:
                _have_ap = None
            if _have_ap is not None and _have_ap < required_ap:
                dims.add('other')
                reasons['missing_other'] = {
                    'kind': 'achievement',
                    'detail': f'{required_ap} achievement points',
                }
    except Exception:
        pass
    return dims, reasons, False


def _activity_location_reason(activity):
    """Build a missing_location reason for an activity with no accessible
    location. Names the first listed location; omits the optional hint."""
    locs = getattr(activity, 'locations', None) or []
    name = ''
    if locs:
        first = locs[0]
        name = first if isinstance(first, str) else getattr(first, 'name', '') or ''
    return {'name': name}


def _keyword_level_min(activity, keyword):
    """Minimum tool skill-level required for ``keyword`` on this activity, from
    keyword_level_requirements (0 if none)."""
    try:
        reqs = getattr(activity, 'requirements', {}) or {}
        kw = str(keyword).lower()
        for r in (reqs.get('keyword_level_requirements', []) or []):
            if str(r.get('keyword', '')).lower() == kw:
                return int(r.get('level', 0) or 0)
    except Exception:
        pass
    return 0


def _activity_gear_unmet(activity, character):
    """Describe the unmet gear/tool keyword requirement(s) for an activity whose
    ``_activity_required_gear_owned`` returned False.

    Returns a reasons dict that may contain:
      * 'missing_gear' + 'gear_gated'=True  for a gear-keyword requirement
        (count >= 2, e.g. "advanced diving gear: 3") — these rows move to the
        bottom "Possible with more gear" section.
      * 'missing_tool'                       for a tool-slot keyword requirement
        (count == 1, e.g. a hatchet / net) — rendered inline, slot left empty.

    See the module docstring note: the gear-vs-tool split is heuristic — a
    required_count >= 2 is treated as a gear-keyword bundle (can't be a single
    tool slot) and a required_count == 1 as a tool slot. Flagged for review."""
    reasons = {}
    reqs = getattr(activity, 'requirements', None) or {}
    keyword_counts = reqs.get('keyword_counts', {}) if isinstance(reqs, dict) else {}
    if not keyword_counts:
        return reasons
    try:
        from util.optimization_utils import item_satisfies_required_keyword
    except Exception:
        item_satisfies_required_keyword = None

    input_kw = set()
    for ii in (getattr(activity, 'input_items', None) or []):
        if getattr(ii, 'type', '') == 'keyword':
            ref = (getattr(ii, 'reference', '') or '').lower()
            if ref:
                input_kw.add(ref)

    owned = getattr(character, 'items', None) or {}
    if not isinstance(owned, dict):
        owned = {}

    for keyword, required_count in keyword_counts.items():
        try:
            required = int(required_count or 0)
        except (TypeError, ValueError):
            required = 0
        needed = required - (1 if str(keyword).lower() in input_kw else 0)
        if needed <= 0:
            continue
        capacity = 0
        if item_satisfies_required_keyword is not None:
            for item, qty in owned.items():
                if item is None:
                    continue
                try:
                    q = int(qty or 0)
                except (TypeError, ValueError):
                    q = 0
                if q <= 0:
                    continue
                try:
                    if item_satisfies_required_keyword(item, keyword, activity):
                        capacity += q
                        if capacity >= needed:
                            break
                except Exception:
                    capacity = needed
                    break
        if capacity >= needed:
            continue
        kw_display = str(keyword).replace('_', ' ').strip()
        if required >= 2:
            reasons['gear_gated'] = True
            reasons['missing_gear'] = {
                'keyword': str(keyword),
                'keyword_display': kw_display,
                'count': required,
                'owned': capacity,
            }
        else:
            reasons.setdefault('missing_tool', {
                'keyword': str(keyword),
                'keyword_display': kw_display,
                'min_level': _keyword_level_min(activity, keyword),
            })
    return reasons


def _sr_gate_activity(activity, character):
    """Combined include-unavailable gate for an activity in the job enumerators.

    Evaluates the three enumerator guards (is_unlocked, location accessibility,
    required-gear-owned) and applies union semantics against the per-run
    ``_INCL_UNAVAIL`` dimensions.

    Returns ``(include, unmet)``:
      * include False  -> exclude the activity (``continue``)
      * include True, unmet == {} -> fully available today (render normally)
      * include True, unmet != {} -> included-because-unavailable; ``unmet`` is
        the dict of metrics_breakdown keys to attach (missing_level /
        missing_location / missing_gear(+gear_gated) / missing_tool /
        missing_other).

    When every include-unavailable dimension is at its default (all off except
    inputs), any gated activity returns include=False — byte-identical to the
    pre-feature guards."""
    dims = set()
    unmet = {}

    try:
        unlocked = activity.is_unlocked(character=character)
    except Exception:
        unlocked = True
    if not unlocked:
        udims, ureasons, hard = _activity_unlock_dims(activity, character)
        if hard:
            return False, {}
        if not udims:
            # is_unlocked failed for a reason we can't attribute (e.g. an
            # activity-completion gate). Bucket under 'other' so it is only
            # surfaced when the user opts into unavailable-by-other.
            udims = {'other'}
            ureasons.setdefault('missing_other', {'kind': 'other', 'detail': 'Locked'})
        dims |= udims
        unmet.update(ureasons)

    try:
        loc_gated = _activity_first_accessible_location(activity) is None
    except Exception:
        loc_gated = False
    if loc_gated:
        dims.add('location')
        unmet['missing_location'] = _activity_location_reason(activity)

    try:
        gear_ok = _activity_required_gear_owned(activity, character)
    except Exception:
        gear_ok = True
    if not gear_ok:
        dims.add('gear')
        unmet.update(_activity_gear_unmet(activity, character))

    if not dims:
        return True, {}
    if all(_incl(d) for d in dims):
        return True, unmet
    return False, {}


def _sr_job_location(activity):
    """First accessible location, or a fallback to the activity's first listed
    location when none is accessible (used when an activity is surfaced via the
    include-unavailable 'location' dimension)."""
    loc = _activity_first_accessible_location(activity)
    if loc is not None:
        return loc
    locs = getattr(activity, 'locations', None) or []
    return locs[0] if locs else None


def build_xp_jobs(run_id: str, session_uuid: str, selected_skills: List[str],
                  character) -> List[ReportJob]:
    """Build one job per (activity, granted_skill) for selected skills.

    For multi-skill activities (e.g. Cave diving grants Mining + Foraging +
    Agility XP), this emits one job PER granted skill so the row appears
    in EVERY relevant XP-section — even if the user only has one of those
    skills selected in the WTO.

    Selection semantic: an activity is included iff ANY of its granted
    skills (primary + secondary_xp keys) is in selected_skills. Once
    included, a job is emitted for every granted skill regardless of
    selection (the user expects to see Cave diving under Foraging when
    they look at the Foraging section, even if they ticked only Mining).

    Filters to only unlocked activities using the same is_unlocked check
    as the crafting tree spoiler-protection system.
    """
    from util.autogenerated.activities import ACTIVITIES_BY_SKILL, ACTIVITIES_BY_NAME

    jobs = []
    # 2026-05-20 polish: empty selected_skills now means "no skills" (the
    # frontend defaults to ALL skills selected and lets the user deselect
    # individual chips). Older clients that still send None get the legacy
    # "all skills" fallback so a stale page doesn't suddenly produce zero
    # results.
    if selected_skills is None:
        selected_set = set(s.lower() for s in ACTIVITIES_BY_SKILL.keys())
    else:
        selected_set = set((s or '').lower() for s in selected_skills)

    if not selected_set:
        return jobs

    # 2026-06-02 (jwbail v2): iterate by activity, not by selected skill.
    # The previous version iterated `selected_skills` and used
    # `ACTIVITIES_BY_SKILL[skill_name]` (keyed by skill_requirements).
    # That meant Cave diving's Foraging row ONLY emitted if the user had
    # Foraging in the WTO — selecting just Mining would silently drop
    # the Foraging + Agility rows. Now we iterate the activity catalog,
    # check if ANY granted skill is selected, and (when selected) emit
    # one job per granted skill. This guarantees multi-skill activities
    # appear in every XP-granting section regardless of which single
    # skill the user toggled.
    #
    # 2026-09-28 (jwbail [fix:termite-effort]): a level>=4 Termite's "Terminate"
    # ability converts logs -> Carpentry XP while Woodcutting, so a Carpentry
    # row must appear for every log-cutting activity when the character owns one.
    # Carpentry is NOT in those activities' static secondary_xp, so add it to the
    # granted set here (ownership-gated, computed once). run_optimizer_for_job
    # computes the actual Carpentry XP/step. Gate the emission on the activity
    # actually dropping a convertible logs-keyword material so we never emit a
    # Carpentry row that would resolve to 0 (or worse, fall back to Woodcutting XP).
    try:
        from ui.pet_effort import owned_termite_level, activity_has_logs_drop
        _termite_carpentry_owned = owned_termite_level(character) is not None
    except Exception:
        _termite_carpentry_owned = False
        activity_has_logs_drop = None

    for activity in ACTIVITIES_BY_NAME.values():
        primary = (getattr(activity, 'primary_skill', '') or '').lower()
        sec_xp = getattr(activity, 'secondary_xp', None) or {}
        granted = set()
        if primary:
            granted.add(primary)
        if isinstance(sec_xp, dict):
            for sec in sec_xp.keys():
                sec_str = (sec if isinstance(sec, str) else getattr(sec, 'name', '')).lower()
                if sec_str:
                    granted.add(sec_str)
        # Termite Terminate -> informational Carpentry on log-cutting activities.
        if (_termite_carpentry_owned and primary == 'woodcutting'
                and activity_has_logs_drop is not None
                and activity_has_logs_drop(activity)):
            granted.add('carpentry')
        if not granted:
            continue
        # Activity included iff at least one of its granted XP skills is
        # selected. Activities that grant XP only for skills the user
        # doesn't care about are skipped entirely.
        if not (granted & selected_set):
            continue
        # 2026-06-19 (jwbail): one-time activities (Repair the bank, the
        # Ventures, Emergency escapes, Run for your life) grant their XP
        # exactly once and cannot be farmed repeatably, so a "fastest XP per
        # step" ranking for them is meaningless and misleading. Once unlocked
        # they also ghosted into the XP section as a newly-available source
        # (user report 2026-06-19: "Repair the bank shows up in XP"). Skip
        # them in the XP category. (new_items still surfaces their one-off
        # chest/collectible drops via build_new_items_jobs.)
        if getattr(activity, 'one_time', False):
            continue
        # Include-unavailable gate: evaluates the locked / inaccessible-location
        # / required-gear guards together and honors the per-run _INCL_UNAVAIL
        # dimensions. With all dimensions at default (off) this excludes every
        # gated activity exactly like the prior three sequential guards.
        _inc, _unmet = _sr_gate_activity(activity, character)
        if not _inc:
            continue

        # Emit one job per granted skill. skill_name uses the display
        # case from the activity (matches xp_per_step_by_skill keys
        # used in run_optimizer_for_job to look up the per-section
        # metric value). Map lowered → display.
        skill_display = {}
        if getattr(activity, 'primary_skill', None):
            ps = activity.primary_skill
            ps_str = ps if isinstance(ps, str) else getattr(ps, 'name', '')
            if ps_str:
                skill_display[ps_str.lower()] = ps_str
        if isinstance(sec_xp, dict):
            for sec in sec_xp.keys():
                ss = sec if isinstance(sec, str) else getattr(sec, 'name', '')
                if ss:
                    skill_display[ss.lower()] = ss
        # Termite-injected Carpentry section (see granted-set note above).
        if 'carpentry' in granted:
            skill_display.setdefault('carpentry', 'Carpentry')

        for sk_lower in granted:
            sk_display = skill_display.get(sk_lower, sk_lower.capitalize())
            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='xp',
                activity=activity,
                skill_name=sk_display,
                extras=({'unmet': dict(_unmet)} if _unmet else None),
            ))

    return jobs


def build_new_items_jobs(run_id: str, session_uuid: str, character,
                         owned_item_names: set) -> List[ReportJob]:
    """Build one job per activity that has unowned drops.

    2026-05-21: filters drops to only the categories the user wants
    surfaced as "new items":
      * Item.*        — equipment / loot items
      * Collectible.* — collectibles
      * Egg.*         — pet eggs (only counted as "new" if the user
                        has no pet of that species AND no available
                        egg of it)

    Excluded outright (do not contribute to numerator OR denominator):
      * Material.*    — base materials
      * Consumable.*  — consumables
      * Container.*   — chests (already covered by chest farming)
      * Currency.*    — coins (already covered by coin farming)

    Calculates weighted steps-per-new-item using the character's
    current gear stats (no optimizer — this category prioritizes
    breadth over per-activity gear tuning).

    weighted_score = steps_per_reward_roll / missing_fraction
    where missing_fraction = unowned_relevant / total_relevant
    """
    from util.autogenerated.activities import Activity, ACTIVITIES_BY_SKILL
    import optimize_activity_gearsets
    import math

    jobs = []

    INCLUDED_PREFIXES = ('Item.', 'Collectible.', 'Egg.')

    # Caller (run_worker) passes the legacy `owned_item_names` set
    # for backward compatibility, but we use the richer per-category
    # ownership lookup stashed at module level. Falls back gracefully
    # if it wasn't populated for some reason.
    ownership = globals().get('_NEW_ITEMS_OWNERSHIP') or {
        'items': owned_item_names or set(),
        'collectibles': set(),
        'pet_species': set(),
        'eggs': set(),
    }

    # Get all activities. Some activities (e.g. Cliff foraging, Cave
    # diving) appear in MULTIPLE skill buckets in ACTIVITIES_BY_SKILL
    # because they grant XP to several skills — without deduplication
    # we'd process the same activity 2-3 times and emit duplicate
    # rows for the same (activity, kind) pair (jwbail bug 2026-05-25:
    # "Feather cape | Cliff foraging | Frostbite Mountain" appearing
    # at ranks 8 AND 9 with identical 25,133 steps/item). Use a
    # name-keyed set to keep only one ActivityInfo per activity.
    all_activities = []
    seen_activity_names = set()
    for skill_activities in ACTIVITIES_BY_SKILL.values():
        for act in skill_activities:
            name = getattr(act, 'name', None)
            if not name or name in seen_activity_names:
                continue
            seen_activity_names.add(name)
            all_activities.append(act)

    for activity in all_activities:
        # Include-unavailable gate (locked / inaccessible location / required
        # gear). Default (all dimensions off) keeps the prior three guards.
        _inc, _unmet = _sr_gate_activity(activity, character)
        if not _inc:
            continue

        # Get all drops for this activity
        all_drops = list(activity.drop_table) + list(activity.secondary_drop_table)
        if not all_drops:
            continue

        # Keep only Item / Collectible / Egg drops with a real name.
        # Materials / consumables / chests / currency are dropped here
        # so they don't pollute either the missing_fraction numerator
        # or denominator.
        relevant_drops = []
        for d in all_drops:
            ref = d.item_ref or ''
            if not d.item_name or d.item_name == 'Nothing':
                continue
            if not any(ref.startswith(p) for p in INCLUDED_PREFIXES):
                continue
            relevant_drops.append(d)
        if not relevant_drops:
            continue

        # Filter to ones the user does NOT own.
        unowned = []
        for d in relevant_drops:
            ref = d.item_ref or ''
            name_id = _normalize_item_id(d.item_name)
            if ref.startswith('Item.'):
                # Equipment — owned if it's in items / inventory / bank.
                if name_id in ownership.get('items', set()):
                    continue
            elif ref.startswith('Collectible.'):
                if name_id in ownership.get('collectibles', set()):
                    continue
            elif ref.startswith('Egg.'):
                # "Tiger egg" → species id "tiger" (drop the trailing
                # _egg suffix). Skip if user already has a pet of that
                # species or an available egg of it.
                species_id = name_id.replace('_egg', '').strip('_')
                if (species_id in ownership.get('pet_species', set())
                        or name_id in ownership.get('eggs', set())):
                    continue
            unowned.append(d)
        if not unowned:
            continue  # all relevant drops already owned

        missing_fraction = len(unowned) / len(relevant_drops)

        # Calculate steps per reward roll using current gear (no optimizer)
        try:
            skill_level = 1
            if activity.primary_skill and character:
                skill_level = character.get_skill_level(activity.primary_skill.lower())

            # Use empty stats (no gear optimization for this category)
            empty_stats = {'we': 0.0, 'da': 0.0, 'dr': 0.0, 'flat': 0, 'pct': 0.0}
            from util.activity_metrics import calculate_activity_metrics
            metrics = calculate_activity_metrics(
                base_steps=activity.base_steps,
                base_xp=activity.base_xp,
                max_efficiency=activity.max_efficiency,
                total_stats=empty_stats,
            )
            steps_per_reward = metrics.get('steps_per_reward_roll', activity.base_steps)
        except Exception:
            steps_per_reward = activity.base_steps

        # T17: bucket unowned drops by KIND (gear / tools / eggs / collectibles)
        # and emit one job per (activity, kind). skill_name is overloaded to
        # carry the kind label so the existing frontend grouping-by-skill
        # path renders 4 subcategories under "Fastest New Item Activities"
        # without rewriting the read side.
        kind_buckets = _bucket_unowned_drops_by_kind_for_jobs(unowned)
        if not kind_buckets:
            continue

        for kind, kind_drops in kind_buckets.items():
            # 2026-05-24 fix (jwbail): the metric used to be
            #   steps_per_reward / kind_missing_fraction
            # which collapsed every activity to ~base_steps regardless of
            # how rare the unowned items actually are. The user's column-3
            # drops popover correctly shows ~11k steps/Parkour gloves
            # while this section showed 53. Bug.
            #
            # New formula: for each unowned drop in this kind bucket,
            # compute the true steps_per_item using its chance_percent
            # and avg quantity (same arithmetic as
            # drops-section.js calculateDropRates → addEquipmentDrops):
            #   steps_per_item = steps_per_reward / (chance_prob * avg_qty)
            # then pick the drop with the LOWEST steps (= the one the
            # player will obtain first). The metric and displayed item
            # name both come from this best drop.
            #
            # We use empty gear stats (same as steps_per_reward above) —
            # the user's chest_finding / find_collectibles bonuses can
            # reduce the displayed value further, but we don't load the
            # user's combined stats here. The order of magnitude is still
            # correct, which is what makes the "53 → 11k" bug go away.
            best_drop = None
            best_steps = None
            # 2026-07-19: collect every unowned drop's per-item steps so the
            # row can report COMBINED "steps to any new <kind>" odds in the
            # headline AND an expandable per-item breakdown. denom =
            # prob·qty·multi (base rates, no gear); steps_per_item =
            # steps_per_reward / denom.
            sum_denom = 0.0
            entry_items = []  # [(steps_nogear, item_name, item_ref)]
            for d in kind_drops:
                pct = float(getattr(d, 'chance_percent', 0) or 0)
                if pct <= 0:
                    continue
                chance_prob = pct / 100.0
                qty = getattr(d, 'quantity', None)
                qmin = getattr(qty, 'min_qty', 1) if qty is not None else 1
                qmax = getattr(qty, 'max_qty', 1) if qty is not None else 1
                try:
                    avg_qty = (float(qmin or 1) + float(qmax or 1)) / 2.0
                except (TypeError, ValueError):
                    avg_qty = 1.0
                if avg_qty <= 0:
                    avg_qty = 1.0
                multi = int(getattr(d, 'multi_roll_count', 0) or 0)
                if multi > 1:
                    denom = multi * chance_prob * avg_qty
                else:
                    denom = chance_prob * avg_qty
                if denom <= 0:
                    continue
                sum_denom += denom
                spi = steps_per_reward / denom
                if d.item_name:
                    entry_items.append((spi, d.item_name, d.item_ref or ''))
                if best_steps is None or spi < best_steps:
                    best_steps = spi
                    best_drop = d

            if best_drop is None or best_steps is None:
                # Every drop in the bucket has zero/invalid chance — skip
                # the bucket entirely rather than emit a misleading row.
                continue

            best_drop_name = best_drop.item_name
            best_drop_ref = best_drop.item_ref or ''

            # 2026-07-19 (bug 276fbd0a + follow-up): the player cares about
            # obtaining ANY still-missing item of this kind, and every reward
            # roll can yield any of the unowned drops. Showing only the single
            # fastest item understates the true rate (the more you're missing,
            # the faster you get "a new one"). Emit COMBINED odds for the row
            # headline:
            #   steps to any new <kind> = steps_per_reward / Σ denom
            # plus a per-item breakdown (steps to each specific item) for the
            # expandable list. The combined/best and per-item/best ratios are
            # gear-independent — steps_per_reward is per-activity (cancels) and
            # find_collectibles scales every collectible uniformly (also
            # cancels) — so the read side scales these no-gear values by
            # gear_best/best_steps to stay accurate with the optimizer's
            # gearset. Applies to ALL kinds (gear / tools / eggs / collectibles)
            # per user request.
            row_metric = best_steps
            extras = {
                'best_drop': {
                    'item_name': best_drop_name,
                    'item_ref': best_drop_ref,
                    'kind': kind,
                },
            }
            if _unmet:
                extras['unmet'] = dict(_unmet)
            if sum_denom > 0 and best_steps:
                combined_steps = steps_per_reward / sum_denom
                entry_items.sort(key=lambda t: t[0])  # fastest first
                items_meta = [
                    {'item_name': nm, 'item_ref': rf, 'steps': st}
                    for (st, nm, rf) in entry_items
                ]
                row_metric = combined_steps
                extras['combined'] = {
                    'kind': kind,
                    'count': len(items_meta),
                    'best_steps': best_steps,
                    'combined_steps': combined_steps,
                    'items': items_meta,
                }

            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='new_items',
                activity=activity,
                skill_name=kind,  # OVERLOADED: kind label (gear/tools/eggs/collectibles)
                precomputed_metric=row_metric,
                # 2026-05-24: keep the item name in the metric_name so the
                # row-level metric_name carries the ITEM the value refers
                # to. The frontend now renders the item name as the row
                # title (no more "Steps/new gear (X)" subtitle), and
                # parses metric_name + metrics_json.best_drop to drive
                # the drop popover wiring.
                precomputed_metric_name=best_drop_name,
                # Stash the best-drop item_ref + name (and, for
                # collectibles, the combined-odds metadata) in metrics_json
                # so the frontend can derive the item icon path, wire the
                # column-3 drop popover, and render the combined row.
                extras=extras,
            ))

    return jobs


# Base probability that a regular material drop rolls its "(Fine)" variant.
# Mirrors util/autogenerated/activities.py `base_fine_chance = 0.01`. Used to
# scale a fine leaf's steps/item up from its base item's steps/item. The
# target_items report is gear-independent, so the Fine-Material-Finding
# multiplier is 1.0 and this flat base chance is the divisor.
_TI_BASE_FINE_CHANCE = 0.01


def _ti_owned_ifc_items(character) -> list:
    """Owned, equippable items that carry ANY of the 5 target
    ItemFindingCategory stats (in any quality/skill/location scope).

    These are the candidate finding-gear pieces (e.g. the Adoring fan statue
    TOOL for AGT, or ectoplasm-finding gear). Whether each ACTUALLY applies to a
    given activity is resolved per-activity via get_stats_for_skill(skill,
    location, character) — the stat can be location/skill-gated (e.g. ectoplasm
    gear only works in Ghostly locations), so a raw stat presence is not enough.
    (2026-08-13 jwbail)
    """
    IFC_KEYS = {
        'ItemFindingCategory.BIRD_NEST', 'ItemFindingCategory.ECTOPLASM',
        'ItemFindingCategory.GOLD_NUGGET', 'ItemFindingCategory.ADVENTURERS_GUILD_TOKENS',
        'ItemFindingCategory.SEA_SHELLS',
    }

    def _has_ifc(stats):
        if not isinstance(stats, dict):
            return False
        for k, v in stats.items():
            if isinstance(v, dict):
                if _has_ifc(v):
                    return True
            elif k in IFC_KEYS:
                return True
        return False

    out = []
    try:
        owned = getattr(character, 'items', {}) or {}
    except Exception:
        owned = {}
    for item, qty in owned.items():
        try:
            if not qty or qty <= 0:
                continue
            if hasattr(item, 'is_unlocked') and not item.is_unlocked(character, ignore_gear_requirements=True):
                continue
        except Exception:
            pass
        if _has_ifc(getattr(item, '_stats', None)):
            out.append(item)
    return out


# Maps the expandable target categories to their ItemFindingCategory stat key
# and the optimizer target ref used to score them.
# 2026-08-14 (jwbail): gold_nugget dropped from the IFC finding-gear expansion —
# it is now a plain 'Nugget' material (native mining drops only), matching
# Silver nugget which has no IFC expansion.
_TI_IFC_STAT = {
    'bird_nest': 'ItemFindingCategory.BIRD_NEST',
    'ectoplasm': 'ItemFindingCategory.ECTOPLASM',
    'adventurers_guild_tokens': 'ItemFindingCategory.ADVENTURERS_GUILD_TOKENS',
    'sea_shells': 'ItemFindingCategory.SEA_SHELLS',
}
_TI_IFC_TARGET = {
    'bird_nest': 'cat:if:bird_nest',
    'ectoplasm': 'cat:if:ectoplasm',
    'adventurers_guild_tokens': 'cat:if:adventurers_guild_tokens',
    'sea_shells': 'cat:sea_shells',
}


def build_target_items_jobs(run_id: str, session_uuid: str, character,
                            include_fine: bool = False,
                            target_groups: 'Optional[List[str]]' = None) -> 'List[ReportJob]':
    """Build jobs for the v2 keyword-based target-items grouping.

    Material + finding items: one job per item leaf (min steps/item across
    activities). Currency groups (AGT, sea_shells): one job per currency
    (best units/1k-steps across activities).

    Key: ('target_items', group_slug, leaf_slug, 'NONE', 'NONE')
    """
    from util.autogenerated.activities import ACTIVITIES_BY_SKILL
    from util.activity_metrics import calculate_activity_metrics
    from util.stats_report.target_items import (
        classify_drop_entry_all, get_item_keywords_for_drop,
        classify_item, _get_keywords_for_drop, _has_fine_material,
        CURRENCY_GROUPS, FINDING_GROUPS, keyword_to_slug,
    )
    from util.ag_token_value import get_drop_ag_token_value, get_drop_fine_ag_token_value
    from util.shell_value import get_drop_shell_value, get_drop_fine_shell_value
    import math

    jobs = []

    # Dedup activities by name (multi-skill activities appear in multiple buckets)
    all_activities = []
    seen_activity_names = set()
    for skill_activities in ACTIVITIES_BY_SKILL.values():
        for act in skill_activities:
            name = getattr(act, 'name', None)
            if not name or name in seen_activity_names:
                continue
            seen_activity_names.add(name)
            all_activities.append(act)

    # ── One job per (item, activity) pair (v3 gear-aware) ─────────────────
    ti_pairs = []       # material/finding: per-(item,activity) records
    ti_currency = []    # currency: per-(currency,activity) records
    _seen_ti = set()    # dedup (item_slug, activity, is_fine) — an item in BOTH
                        # the primary and secondary drop table would otherwise
                        # emit two identical jobs (578 vs 507 count mismatch).
    _ti_unmet_by_activity = {}  # activity.name -> include-unavailable reasons

    for activity in all_activities:
        # Include-unavailable gate (locked / inaccessible location / required
        # gear). Default (all dimensions off) keeps the prior three guards.
        _inc, _unmet = _sr_gate_activity(activity, character)
        if not _inc:
            continue
        if _unmet:
            _ti_unmet_by_activity[activity.name] = dict(_unmet)

        # First accessible location (falls back to the first listed location
        # when the activity is surfaced only via the 'location' dimension).
        loc = _sr_job_location(activity)
        if loc is None:
            continue

        # Get all drops
        all_drops = list(getattr(activity, 'drop_table', None) or []) + \
                    list(getattr(activity, 'secondary_drop_table', None) or [])
        if not all_drops:
            continue

        # Calculate steps_per_reward_roll with empty stats (gear-independent)
        try:
            empty_stats = {'we': 0.0, 'da': 0.0, 'dr': 0.0, 'flat': 0, 'pct': 0.0}
            metrics = calculate_activity_metrics(
                base_steps=activity.base_steps,
                base_xp=activity.base_xp,
                max_efficiency=activity.max_efficiency,
                total_stats=empty_stats,
            )
            steps_per_reward = metrics.get('steps_per_reward_roll', activity.base_steps)
        except Exception:
            steps_per_reward = activity.base_steps

        loc_name = loc if isinstance(loc, str) else getattr(loc, 'name', str(loc))

        # ── Accumulate currency value per activity ────────────────────────
        agt_per_step = 0.0
        shells_per_step = 0.0

        for d in all_drops:
            item_name = getattr(d, 'item_name', '') or ''
            item_ref = getattr(d, 'item_ref', '') or ''
            if not item_name or item_name == 'Nothing' or not item_ref:
                continue

            # Compute items_per_step for this drop
            pct = float(getattr(d, 'chance_percent', 0) or 0)
            if pct <= 0:
                continue
            chance_prob = pct / 100.0
            qty = getattr(d, 'quantity', None)
            qmin = getattr(qty, 'min_qty', 1) if qty is not None else 1
            qmax = getattr(qty, 'max_qty', 1) if qty is not None else 1
            try:
                avg_qty = (float(qmin or 1) + float(qmax or 1)) / 2.0
            except (TypeError, ValueError):
                avg_qty = 1.0
            if avg_qty <= 0:
                avg_qty = 1.0
            multi = int(getattr(d, 'multi_roll_count', 0) or 0)
            if multi > 1:
                denom = multi * chance_prob * avg_qty
            else:
                denom = chance_prob * avg_qty
            if denom <= 0:
                continue
            steps_per_item = steps_per_reward / denom
            items_per_step = 1.0 / steps_per_item if steps_per_item > 0 else 0.0

            # Currency accumulation
            agt_val = get_drop_ag_token_value(d)
            if agt_val > 0:
                agt_per_step += items_per_step * agt_val
            shell_val = get_drop_shell_value(d)
            if shell_val > 0:
                shells_per_step += items_per_step * shell_val

            # Fine currency contribution (when include_fine is ON)
            if include_fine and _has_fine_material(d):
                # Fine items drop at a reduced rate; approximate via the fine
                # drop rate entries. For currency, we use the fine sell value
                # helpers which look up the _FINE variant's special_sell.
                fine_agt = get_drop_fine_ag_token_value(d)
                if fine_agt > 0:
                    # Fine drop rate is handled by the fine DropEntry in the
                    # drop table; for currency aggregation, use the base
                    # items_per_step * fine_material_finding adjustment.
                    # Simplified: fine items appear in the drop table as separate
                    # entries with is_fine=True. We handle them when we encounter
                    # them. For items whose fine appears as a separate table entry,
                    # the fine DropEntry will be iterated separately. For the
                    # currency value aggregation, just check if the current drop
                    # IS a fine entry.
                    pass  # Fine AGT handled via separate fine drop entries below
                fine_shell = get_drop_fine_shell_value(d)
                if fine_shell > 0:
                    pass  # Same — handled via fine entries

            # ── Material/finding items classification ─────────────────────
            # Only emit fine leaves when include_fine is ON
            classifications = classify_drop_entry_all(d, include_fine=include_fine)
            if not classifications:
                continue

            item_keywords = get_item_keywords_for_drop(d)

            for classification in classifications:
                group_slug, item_slug, display_name, c_item_ref, is_fine = classification

                # Fine variant: rare ~1% roll on the base drop -> ~100x steps
                # (no-gear fallback; execute_job recomputes gear-aware).
                eff_steps = steps_per_item
                if is_fine and steps_per_item not in (None, float('inf')):
                    eff_steps = steps_per_item / _TI_BASE_FINE_CHANCE
                if eff_steps <= 0 or math.isinf(eff_steps):
                    continue

                _gl = FINDING_GROUPS.get(group_slug, group_slug)
                _res = classify_item(
                    getattr(d, 'item_name', '') or '',
                    getattr(d, 'item_ref', '') or '',
                    _get_keywords_for_drop(d),
                )
                if _res:
                    _gl = _res[1]

                # v3: one record per (item, activity) — EVERY drop-applicable
                # activity, not just the best. execute_job runs a gear-aware
                # optimizer per record; the report lists all activities under
                # each item.
                _pk = (item_slug, activity.name, is_fine)
                if _pk in _seen_ti:
                    continue
                _seen_ti.add(_pk)
                ti_pairs.append({
                    'item_slug': item_slug,
                    'activity': activity,
                    'location': loc_name,
                    'item_name': display_name,
                    'item_ref': c_item_ref,
                    'group_slug': group_slug,
                    'group_label': _gl,
                    'is_fine': is_fine,
                    'item_keywords': item_keywords,
                    'eff_steps': eff_steps,
                })

        # After processing all drops for this activity, emit per-(currency,
        # activity) records so the report lists EVERY activity under AGT /
        # Sea Shells. Value already = drops x sell value (incl. fine multiplier
        # from util/shell_value.py + util/ag_token_value.py, not hardcoded).
        agt_per_1k = agt_per_step * 1000.0
        if agt_per_1k > 0:
            ti_currency.append({
                'currency_slug': 'adventurers_guild_tokens',
                'units_per_1k': agt_per_1k,
                'activity': activity,
                'location': loc_name,
            })
        shells_per_1k = shells_per_step * 1000.0
        if shells_per_1k > 0:
            ti_currency.append({
                'currency_slug': 'sea_shells',
                'units_per_1k': shells_per_1k,
                'activity': activity,
                'location': loc_name,
            })

    # ── Emit material/finding jobs ────────────────────────────────────────
    # chest_name is OVERLOADED with item_slug so the write identity
    # (category, activity_name, skill_name=group, chest_name=item_slug) is
    # UNIQUE per (item, activity) — otherwise many items in the same
    # group+activity collapse onto one scope (the 179/214 collapse, now on
    # the activity axis).
    for p in ti_pairs:
        group_slug = p['group_slug']
        group_kind = 'finding' if group_slug in FINDING_GROUPS else (
            'other' if group_slug == 'other' else 'material')
        extras = {
            'item_name': p['item_name'],
            'item_ref': p['item_ref'],
            'item_slug': p['item_slug'],
            'group_slug': group_slug,
            'group_label': p['group_label'],
            'group_kind': group_kind,
            'item_keywords': p['item_keywords'],
            'activity_name': p['activity'].name,
            'location': p['location'],
            'is_fine': p['is_fine'],
            'metric_kind': 'steps_per_item',
            # gear-aware optimizer target: steps_per_reward_roll::<target>
            'target_ref': p['item_name'],
            # legacy compat
            'target_category': group_slug,
            'target_category_label': p['group_label'],
        }
        jobs.append(ReportJob(
            job_id=str(uuid.uuid4()),
            run_id=run_id,
            session_uuid=session_uuid,
            category='target_items',
            activity=p['activity'],
            skill_name=group_slug,        # OVERLOADED: group_slug
            chest_name=p['item_slug'],    # OVERLOADED: item leaf (write uniqueness)
            precomputed_metric=p['eff_steps'],
            precomputed_metric_name=p['item_name'],
            extras=extras,
        ))

    # ── Emit currency jobs: one per (currency, activity) ──────────────────
    for c in ti_currency:
        currency_slug = c['currency_slug']
        label = CURRENCY_GROUPS.get(currency_slug, currency_slug)
        extras = {
            'item_slug': currency_slug,
            'group_slug': currency_slug,
            'group_label': label,
            'group_kind': 'currency',
            'metric_kind': 'per_1k',
            # Optimizer target so the gearset is optimized for THIS currency
            # (optimize_activity_gearsets supports these synthetics:
            # cat:if:adventurers_guild_tokens and cat:sea_shells).
            'target_ref': ('cat:if:adventurers_guild_tokens'
                           if currency_slug == 'adventurers_guild_tokens' else 'cat:sea_shells'),
            'activity_name': c['activity'].name,
            'location': c['location'],
            'units_per_1k': c['units_per_1k'],
            'is_fine': False,
            # Legacy compat
            'target_category': currency_slug,
            'target_category_label': label,
            'item_name': label,
            'item_ref': '',
            'item_keywords': [],
        }
        jobs.append(ReportJob(
            job_id=str(uuid.uuid4()),
            run_id=run_id,
            session_uuid=session_uuid,
            category='target_items',
            activity=c['activity'],
            # (activity_name, skill_name=currency_slug) is already unique per
            # (currency, activity); chest_name left None.
            skill_name=currency_slug,
            precomputed_metric=c['units_per_1k'],
            precomputed_metric_name=label,
            extras=extras,
        ))

    # ── Global item-finding (IF) expansion — location-aware ───────────────
    # Ectoplasm / Gold Nugget / Bird Nest (finding) and AGT / Sea Shells
    # (currency) can be found on activities via ItemFindingCategory.<CAT> gear/
    # tools. The stat is often gated (e.g. ectoplasm gear only applies while in
    # Ghostly locations), so applicability is resolved PER-ACTIVITY at the same
    # (skill, location) the optimizer scores at — we emit a job only where the
    # owned gear's IFC.<cat> actually resolves > 0. This ranks every genuinely-
    # findable activity without emitting impossible-penalty rows. Native-drop /
    # sellable activities are already covered above, so skip those pairs.
    # (2026-08-13 jwbail)
    _ifc_items = _ti_owned_ifc_items(character)
    if _ifc_items:
        _native_find_pairs = {(p['group_slug'], p['activity'].name)
                              for p in ti_pairs if p['group_slug'] in FINDING_GROUPS}
        _native_cur_pairs = {(c['currency_slug'], c['activity'].name) for c in ti_currency}
        _gif_count = 0
        for activity in all_activities:
            _inc, _unmet = _sr_gate_activity(activity, character)
            if not _inc:
                continue
            if _unmet:
                _ti_unmet_by_activity[activity.name] = dict(_unmet)
            loc = _sr_job_location(activity)
            if loc is None:
                continue
            loc_name = loc if isinstance(loc, str) else getattr(loc, 'name', str(loc))
            # Resolve stats at the SAME location the optimizer uses: the accessible
            # Location object, else activity.locations[0] (mirrors SELECTED_LOCATION).
            _locs = getattr(activity, 'locations', None) or []
            loc_obj = loc if (loc is not None and not isinstance(loc, str)) else (_locs[0] if _locs else None)
            skill = (getattr(activity, 'primary_skill', '') or '').lower()
            # Sum each target IFC stat across the owned finding gear at this
            # activity+location — >0 means the find applies here.
            applic = {}
            for it in _ifc_items:
                try:
                    st = it.get_stats_for_skill(skill, location=loc_obj, character=character)
                except Exception:
                    st = None
                if not isinstance(st, dict):
                    continue
                for cat, key in _TI_IFC_STAT.items():
                    val = st.get(key)
                    if isinstance(val, (int, float)) and val > 0:
                        applic[cat] = applic.get(cat, 0.0) + val
            if not applic:
                continue
            for cat in applic:
                if cat in CURRENCY_GROUPS:
                    if (cat, activity.name) in _native_cur_pairs:
                        continue
                    label = CURRENCY_GROUPS.get(cat, cat)
                    jobs.append(ReportJob(
                        job_id=str(uuid.uuid4()), run_id=run_id, session_uuid=session_uuid,
                        category='target_items', activity=activity,
                        skill_name=cat, precomputed_metric=0.0, precomputed_metric_name=label,
                        extras={
                            'item_slug': cat, 'group_slug': cat, 'group_label': label,
                            'group_kind': 'currency', 'metric_kind': 'per_1k',
                            'target_ref': _TI_IFC_TARGET[cat], 'activity_name': activity.name,
                            'location': loc_name, 'units_per_1k': 0.0, 'is_fine': False,
                            'target_category': cat, 'target_category_label': label,
                            'item_name': label, 'item_ref': '', 'item_keywords': [],
                            'global_if': True,
                        }))
                    _gif_count += 1
                else:
                    if (cat, activity.name) in _native_find_pairs:
                        continue
                    label = FINDING_GROUPS.get(cat, cat)
                    jobs.append(ReportJob(
                        job_id=str(uuid.uuid4()), run_id=run_id, session_uuid=session_uuid,
                        category='target_items', activity=activity,
                        skill_name=cat, chest_name=cat,  # OVERLOADED: item leaf = category (write uniqueness)
                        precomputed_metric=None, precomputed_metric_name=label,
                        extras={
                            'item_name': label, 'item_ref': '', 'item_slug': cat,
                            'group_slug': cat, 'group_label': label, 'group_kind': 'finding',
                            'item_keywords': [], 'activity_name': activity.name,
                            'location': loc_name, 'is_fine': False,
                            'metric_kind': 'steps_per_item', 'target_ref': _TI_IFC_TARGET[cat],
                            'target_category': cat, 'target_category_label': label,
                            'global_if': True,
                        }))
                    _gif_count += 1

    # ── Filter by target_groups if provided ───────────────────────────────
    if target_groups:
        _tg_set = set(target_groups)
        jobs = [j for j in jobs if (j.skill_name or '') in _tg_set]

    # Attach include-unavailable reasons to each per-activity job whose
    # activity was surfaced only because an unavailable dimension is enabled.
    if _ti_unmet_by_activity:
        for j in jobs:
            an = getattr(j.activity, 'name', None) if j.activity else None
            if an and an in _ti_unmet_by_activity:
                if not isinstance(j.extras, dict):
                    j.extras = {}
                j.extras['unmet'] = dict(_ti_unmet_by_activity[an])

    return jobs


def _extract_best_drop(row):
    """Pull the {item_name, item_ref, kind} best_drop dict off a cached
    new_items result row.

    Read-path rows (get_stats_report_results_latest_per_scope) carry it in
    a JSON `metrics_json` string; results-v2 rows carry it under `extras`.
    Returns the dict or None.
    """
    if not isinstance(row, dict):
        return None
    mj = row.get('metrics_json')
    if isinstance(mj, str):
        try:
            mj = json.loads(mj)
        except Exception:
            mj = None
    if isinstance(mj, dict) and isinstance(mj.get('best_drop'), dict):
        return mj['best_drop']
    ex = row.get('extras')
    if isinstance(ex, dict) and isinstance(ex.get('best_drop'), dict):
        return ex['best_drop']
    return None


def new_items_drop_is_owned(best_drop, ownership) -> bool:
    """Return True if a new_items row's targeted drop is already owned.

    Uses the EXACT same matching build_new_items_jobs applies when it
    decides to skip a drop, so the read-path filter and the job-generation
    filter agree: a drop the worker would refuse to regenerate is the same
    drop we hide from the cached "fastest to obtain" list.
    """
    if not isinstance(best_drop, dict) or not isinstance(ownership, dict):
        return False
    ref = best_drop.get('item_ref') or ''
    name = best_drop.get('item_name') or ''
    name_id = _normalize_item_id(name)
    if not name_id:
        return False
    if ref.startswith('Item.'):
        return name_id in ownership.get('items', set())
    if ref.startswith('Collectible.'):
        return name_id in ownership.get('collectibles', set())
    if ref.startswith('Egg.'):
        # "Tiger egg" -> species id "tiger"; owned if a pet of that
        # species exists or the egg itself is on hand.
        species_id = name_id.replace('_egg', '').strip('_')
        return (species_id in ownership.get('pet_species', set())
                or name_id in ownership.get('eggs', set()))
    # Unknown/blank ref prefix: be conservative and check the two name
    # buckets so a row with a stripped ref still filters when owned.
    return (name_id in ownership.get('items', set())
            or name_id in ownership.get('collectibles', set()))


def filter_owned_new_items(results, ownership):
    """Drop new_items result rows whose targeted item the user now owns.

    Fixes bug 0e1a28e6: after obtaining an item (e.g. Seahorse fossil),
    re-running the goals optimizer left it at the top of the "fastest to
    obtain" list until a full reset. Root cause: once an item is owned,
    build_new_items_jobs stops generating a job for it, so the stale cached
    row is never overwritten OR deleted — only a reset (which wipes the
    whole cache) cleared it. Filtering on read makes the list correct
    regardless of what's cached, and self-heals without a reset.

    `results` is the {category: [rows]} map from
    get_stats_report_results_latest_per_scope. Mutates and returns it.
    """
    if not isinstance(results, dict):
        return results
    rows = results.get('new_items')
    if not rows:
        return results
    results['new_items'] = [
        row for row in rows
        if not new_items_drop_is_owned(_extract_best_drop(row), ownership)
    ]
    return results


_SINGLE_COMPLETION_KEYS_CACHE = None


def _single_completion_keys():
    """Return {completion_stat_key: activity_display_name} for every
    single-completion activity (e.g. {'repair_the_bank': 'Repair the bank'}).

    The completion key is derived exactly like Activity.is_unlocked does
    (name.lower().replace(' ', '_')) so a custom-stat toggle matches. Cached
    module-side — the activity catalog is static per process.
    """
    global _SINGLE_COMPLETION_KEYS_CACHE
    if _SINGLE_COMPLETION_KEYS_CACHE is not None:
        return _SINGLE_COMPLETION_KEYS_CACHE
    out = {}
    try:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
        for name, act in ACTIVITIES_BY_NAME.items():
            if getattr(act, 'single_completion', False):
                out[str(name).lower().replace(' ', '_')] = name
    except Exception:
        out = {}
    _SINGLE_COMPLETION_KEYS_CACHE = out
    return out


def _row_activity_name(row):
    """Extract a result row's activity display name (dict or object shape)."""
    if isinstance(row, dict):
        return row.get('activity_name')
    return getattr(row, 'activity_name', None)


def filter_completed_single_completion_activities(results, custom_stats):
    """Drop every result row whose activity is a single-completion activity
    the user has flagged complete via custom_stats.

    Mirrors filter_owned_new_items (bug 0e1a28e6) for single-completion
    activities (report fee0a91e). Once the player checks e.g.
    custom_stats['repair_the_bank']=True, Activity.is_unlocked() returns
    False, so build_*_jobs stop emitting jobs for that activity — but its
    stale cached rows (coins / chests / new_items) linger until a full
    reset. Filtering on read hides them immediately, with no rerun, exactly
    like an owned new item disappears from "fastest to obtain".
    detect_stale_scopes already stops flagging these via
    enumerate_applicable_sources' single-completion gate, so no (!) remains
    either.

    `results` is the {category: [rows]} map from
    get_stats_report_results_latest_per_scope. Mutates and returns it.
    """
    if not isinstance(results, dict) or not isinstance(custom_stats, dict):
        return results
    done_names = {
        name for key, name in _single_completion_keys().items()
        if custom_stats.get(key) is True
    }
    if not done_names:
        return results
    for cat, rows in list(results.items()):
        if not rows:
            continue
        results[cat] = [
            row for row in rows
            if _row_activity_name(row) not in done_names
        ]
    return results


def filter_ungeared_activities(results, character):
    """Drop cached result rows whose activity's required gear the player
    doesn't own — the read-path mirror of the build_*_jobs gate
    `_activity_required_gear_owned`.

    Same lingering-cache problem as filter_owned_new_items (bug 0e1a28e6) and
    filter_completed_single_completion_activities (report fee0a91e): the build
    gate stops EMITTING jobs for ungeared activities (e.g. Casbrant's Grave
    Wreck Diving / Sea fishing (Spear) require `advanced diving gear: 3`), but
    rows written BEFORE the gate existed — or before the player lost/never had
    the gear — linger in the cache until a full reset, still showing a dead-end
    row whose Optimize returns "0/0 optimizations". Filtering on read hides them
    immediately, with no rerun, and self-heals if the player later acquires the
    gear (the gate then re-admits the activity and it reappears).

    Conservative by construction: only rows whose activity_name resolves in
    ACTIVITIES_BY_NAME AND provably can't meet its keyword_counts from owned
    gear are dropped. Recipe rows (chests_recipes — activity_name is a recipe
    name) and any unresolvable activity name are kept untouched. Owned-but-
    custom-stat-locked gear counts as owned (matches the build gate). Mutates
    and returns `results`.
    """
    if not isinstance(results, dict) or character is None:
        return results
    try:
        import util.walkscape_constants  # noqa: F401  (populate the catalog)
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
    except Exception:
        return results

    # Evaluate each distinct activity once — many rows share an activity_name.
    _verdict = {}

    def _keep(activity_name):
        if not activity_name:
            return True
        if activity_name in _verdict:
            return _verdict[activity_name]
        act = ACTIVITIES_BY_NAME.get(activity_name)
        if act is None:
            # Recipe shim / unknown name — not gear-gated here; keep it.
            _verdict[activity_name] = True
            return True
        try:
            v = _activity_required_gear_owned(act, character)
        except Exception:
            v = True  # be permissive on any evaluation error
        _verdict[activity_name] = v
        return v

    for cat, rows in list(results.items()):
        if not rows:
            continue
        results[cat] = [row for row in rows
                        if _keep(_row_activity_name(row))
                        or _row_included_as_unavailable(row)]
    return results


def _row_metrics_json(row):
    """Return a result row's metrics_json as a dict (parsing a JSON string if
    needed), or {} when absent/unparseable."""
    mj = row.get('metrics_json') if isinstance(row, dict) else getattr(row, 'metrics_json', None)
    if isinstance(mj, str):
        try:
            mj = json.loads(mj)
        except Exception:
            return {}
    return mj if isinstance(mj, dict) else {}


def _row_included_as_unavailable(row):
    """True if a result row was deliberately surfaced by the include-unavailable
    feature (it carries a gear/tool/level/location/other reason). Such rows must
    survive the read-path ungeared filter — the run that produced them opted in,
    and the markers are recorded in metrics_json so no run-config lookup is
    needed on read."""
    mj = _row_metrics_json(row)
    if not mj:
        return False
    return bool(mj.get('gear_gated') or mj.get('missing_gear')
                or mj.get('missing_tool') or mj.get('missing_level')
                or mj.get('missing_location') or mj.get('missing_other'))


def _drop_kind(drop):
    """Classify a drop into 'gear', 'tools', 'eggs', or 'collectibles'."""
    ref = drop.item_ref or ''
    if 'Egg.' in ref:
        return 'eggs'
    if 'Collectible.' in ref:
        return 'collectibles'
    if 'Item.' in ref:
        # Differentiate gear vs tools by item slot
        try:
            import util.walkscape_constants  # noqa: F401
            from util.autogenerated.equipment import Item
            slug = str(drop.item_name or '').lower().replace(' ', '_').replace("'", "")
            item_obj = getattr(Item, slug.upper(), None)
            slot = (getattr(item_obj, 'slot', '') or '').lower() if item_obj else ''
            return 'tools' if slot.startswith('tool') else 'gear'
        except Exception:
            return 'gear'
    return None


def _bucket_unowned_drops_by_kind_for_jobs(unowned_drops):
    """Bucket unowned drops by kind for per-(activity, kind) job emission."""
    out = {}
    for d in unowned_drops:
        kind = _drop_kind(d)
        if kind:
            out.setdefault(kind, []).append(d)
    return out


def build_chest_jobs(run_id: str, session_uuid: str, character, category: str = 'chests') -> List[ReportJob]:
    """Build one job per (chest type, activity) that can drop that chest.

    2026-05-21: deduplicate activities so an activity with multi-skill
    requirements (e.g. Firewood making with both Carpentry and Agility
    requirements) doesn't appear twice in the same chest section. The
    old code iterated ACTIVITIES_BY_SKILL.values() which yields the
    same activity once per skill in its skill_requirements.

    Uses drop_table to find activities that drop chest items.
    """
    from util.autogenerated.activities import ACTIVITIES_BY_SKILL

    # Collect all chest-dropping activities grouped by chest name —
    # dedup by activity name within each chest bucket.
    chest_activities: Dict[str, Dict[str, Any]] = {}
    _chest_unmet_by_activity: Dict[str, dict] = {}

    for skill_activities in ACTIVITIES_BY_SKILL.values():
        for activity in skill_activities:
            _inc, _unmet = _sr_gate_activity(activity, character)
            if not _inc:
                continue
            if _unmet:
                _chest_unmet_by_activity[activity.name] = dict(_unmet)

            all_drops = list(activity.drop_table) + list(activity.secondary_drop_table)
            for drop in all_drops:
                name = drop.item_name or ''
                # Identify chest drops by ref prefix first (most reliable),
                # fall back to the old name-substring heuristic for any
                # drops missing a ref.
                ref = drop.item_ref or ''
                is_chest = ref.startswith('Container.') or 'chest' in name.lower()
                if not is_chest:
                    continue
                if name not in chest_activities:
                    chest_activities[name] = {}
                # Key by activity NAME so duplicate iterations from
                # multi-skill activities collapse to one entry.
                chest_activities[name][activity.name] = activity

    jobs = []
    for chest_name, activities_by_name in chest_activities.items():
        for activity in activities_by_name.values():
            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='chests',
                activity=activity,
                skill_name=activity.primary_skill,
                chest_name=chest_name,
                extras=({'unmet': dict(_chest_unmet_by_activity[activity.name])}
                        if activity.name in _chest_unmet_by_activity else None),
            ))

    return jobs


def build_chests_recipes_jobs(run_id: str, session_uuid: str, character) -> List[ReportJob]:
    """Build one job per (chest type, recipe) that can drop that chest.

    2026-05-21 rewrite: previously chests_recipes called build_chest_jobs
    with category='chests_recipes', which produced ACTIVITY-based jobs
    just relabeled. The user reported it was showing the same activities
    as Best Chest Farming for Activities — that's why.

    Now we iterate RECIPES_BY_NAME, find recipes whose drop_table
    contains a Container.* (chest) drop, and emit a precomputed-metric
    job per (recipe, chest_name). The metric is recipe.base_steps /
    (chance_percent / 100) — pure base-steps × probability inversion,
    no gear optimization (matches the new_items category's approach
    since recipe-gear optimization needs a different optimizer path).

    2026-05-22 update: this NO LONGER pre-computes the metric — it now
    emits jobs that go through the recipe optimizer (optimize_craft_gearsets)
    so users get correct gear-aware values plus working Equip/Save/Gear
    buttons (the buttons rendered conditionally on gearset_export, which
    was always None on the precomputed path). The recipe optimizer is
    invoked from execute_job's chests_recipes branch — see
    run_recipe_optimizer_for_job.
    """
    try:
        from util.autogenerated.recipes import RECIPES_BY_NAME
    except ImportError:
        return []

    jobs = []
    # Pre-resolve services so we can skip recipes whose required service
    # the user can't access (e.g. an Erdwise-only forge for someone
    # without Charter of the Drowned). Mirrors the location-accessibility
    # filter applied to activity-based job builders.
    try:
        from util.autogenerated.services import SERVICES_BY_NAME as _SERVICES_BY_NAME
    except ImportError:
        _SERVICES_BY_NAME = {}

    def _recipe_has_unlocked_service(recipe):
        # Recipes with no service need no service check — they can be
        # done anywhere.
        # 2026-05-29: recipe.service can be the *string* 'None' (autogen
        # quirk in recipes.py) instead of Python None. The truthy string
        # then fell through to the SERVICES_BY_NAME loop, found no
        # matching service, and the recipe got silently dropped — so
        # every basic crafting/carpentry recipe (Make a basic hatchet,
        # Craft a bag of rocks, etc.) had no chests_recipes row written.
        # enumerate_applicable_sources DOES treat the string as
        # no-service, so those recipes ghosted as REASON_NEWLY_UNLOCKED
        # on every stale-check.
        svc = getattr(recipe, 'service', None)
        if not svc or svc in ('None', 'NONE', ''):
            return True
        for svc_obj in _SERVICES_BY_NAME.values():
            try:
                if (svc_obj.is_valid_for_recipe(recipe)
                        and svc_obj.is_unlocked(character)
                        and _service_location_accessible(svc_obj)):
                    return True
            except Exception:
                continue
        return False

    for recipe_name, recipe in RECIPES_BY_NAME.items():
        # 2026-05-22 fix: skip recipes whose service the user can't
        # access. Without this, locked-region recipes (e.g. those at
        # Erdwise services for a character without the Charter of the
        # Drowned) generated jobs that the optimizer could not satisfy
        # — wasted optimizer cycles + N/A rows in the section.
        if not _recipe_has_unlocked_service(recipe):
            continue
        # 2026-05-22: skip recipes whose required skill level the user
        # doesn't meet. Mirrors enumerate_applicable_sources._recipe_applicable
        # in util/stats_report/applicable_sources.py — without this, the
        # stale-only filter would drop those over-leveled recipes (worker
        # job key never matches enum's applicable set, since enum filters
        # them out at enumeration time). User-visible symptom: 'after
        # reset 755 then immediately drops to 688' — those 67 jobs were
        # high-level recipes the user can't actually craft yet.
        recipe_skill = (getattr(recipe, 'skill', '') or '').lower()
        recipe_level = int(getattr(recipe, 'level', None) or 1)
        try:
            char_level = character.get_skill_level(recipe_skill)
        except Exception:
            char_level = 1
        if (char_level or 1) < recipe_level:
            continue
        drops = getattr(recipe, 'drop_table', None) or []
        for drop in drops:
            # drop_table on RecipeInstance is a list of dicts.
            if not isinstance(drop, dict):
                continue
            chest_name = drop.get('item_name', '')
            ref = drop.get('item_ref', '') or ''
            is_chest = ref.startswith('Container.') or 'chest' in chest_name.lower()
            if not is_chest:
                continue
            try:
                chance_pct = float(drop.get('chance_percent') or 0)
            except (TypeError, ValueError):
                chance_pct = 0.0
            if chance_pct <= 0:
                continue
            base_steps = getattr(recipe, 'base_steps', None) or 0
            if base_steps <= 0:
                continue

            # We don't have an Activity to pass — synthesize a thin
            # shim so downstream code (which dereferences activity.name
            # for display + activity.primary_skill for grouping) keeps
            # working. The shim mirrors enough of ActivityInfo for
            # render purposes.
            class _RecipeShim:
                __slots__ = ('name', 'primary_skill')
                def __init__(self, n, s):
                    self.name = n
                    self.primary_skill = s
            shim = _RecipeShim(recipe_name, getattr(recipe, 'skill', None))

            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='chests_recipes',
                activity=shim,
                skill_name=getattr(recipe, 'skill', None),
                chest_name=chest_name,
                recipe_name=recipe_name,
                # No precomputed_metric — execute_job's chests_recipes
                # branch will run the recipe optimizer to compute a
                # gear-aware steps_per_chest_recipe value.
            ))

    return jobs


def build_coins_jobs(run_id: str, session_uuid: str, selected_skills: List[str],
                     character) -> List[ReportJob]:
    """Build one job per (skill, activity) for selected skills, optimizing for coins/1k steps."""
    from util.autogenerated.activities import ACTIVITIES_BY_SKILL

    jobs = []
    # See build_xp_jobs for rationale: empty list = no skills selected
    # (intentional), None = legacy fallback for stale clients.
    if selected_skills is None:
        skills_to_check = list(ACTIVITIES_BY_SKILL.keys())
    else:
        skills_to_check = list(selected_skills)

    for skill_name in skills_to_check:
        activities = ACTIVITIES_BY_SKILL.get(skill_name, [])
        for activity in activities:
            # 2026-05-22 fix (same reasoning as build_xp_jobs): only
            # include the activity under its primary_skill. Without this,
            # ACTIVITIES_BY_SKILL groups by skill_requirements (every
            # required skill) and a single activity got duplicated jobs
            # under each required skill. enumerate_applicable_sources
            # only emits coins under primary_skill, so the duplicates
            # were filtered out by stale-only.
            primary = (getattr(activity, 'primary_skill', '') or '')
            if primary.lower() != (skill_name or '').lower():
                continue
            _inc, _unmet = _sr_gate_activity(activity, character)
            if not _inc:
                continue

            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='coins',
                activity=activity,
                skill_name=skill_name,
                extras=({'unmet': dict(_unmet)} if _unmet else None),
            ))

    return jobs


# ============================================================================
# JOB EXECUTION
# ============================================================================

def _fine_variant_of(item):
    """Return the Material *_FINE variant of an input item instance, or None.

    Used by the goals-report "Use fine inputs" setting (R2): when on, a hunting
    activity's input slot projects the Fine variant of its input material (e.g.
    arrows) when one exists — mirroring the crafting tree's use_fine_inputs. Only
    MaterialInstance inputs have fine variants; Items return None (keep base).
    """
    try:
        from util.autogenerated.materials import Material, MaterialInstance
    except ImportError:
        return None
    if not isinstance(item, MaterialInstance):
        return None
    try:
        if not item.has_fine_material():
            return None
        enum_name = (item.name.upper().replace(" ", "_").replace("(", "")
                     .replace(")", "").replace("-", "_").replace("'", ""))
        return getattr(Material, enum_name + '_FINE', None)
    except Exception:
        return None


def _auto_pick_input_item_for_activity(activity, character, use_fine_inputs=False):
    """Pick the best-scoring owned input item for the activity's input slot.

    Mirrors ui/app.py:_auto_pick_input_items_for_activity but works directly
    with Item/Material instances from character.items() rather than the
    UI-shaped owned_items export-name set, so the worker doesn't need a
    request/session_data dict.

    Activities like Alligator hunting declare:
        input_items=[InputItem(type='keyword', reference='arrows', ...)]
    Without selecting an INPUT_ITEM the optimizer has no arrows in the
    gearset, the keyword-counts requirement fails, and the score drops to
    a baseline that doesn't reflect any arrow-derived stats. The crafting
    tree solves this by auto-picking the best-scoring owned item that
    satisfies each input keyword; we mirror that here.

    Returns: an Item/Material instance or None.
    """
    if not activity or not getattr(activity, 'input_items', None):
        return None

    skill_lower = (getattr(activity, 'primary_skill', '') or '').lower()

    def _score(item):
        stats = getattr(item, '_stats', None) or getattr(item, 'stats', None) or {}
        total = 0.0
        for sk, locs in (stats or {}).items():
            if sk.lower() != skill_lower and sk.lower() != 'global':
                continue
            for stat_vals in (locs or {}).values():
                if not isinstance(stat_vals, dict):
                    continue
                for v in stat_vals.values():
                    try:
                        total += abs(float(v))
                    except (TypeError, ValueError):
                        continue
        return total

    try:
        # character.items is a @property returning {item_obj: qty}, not
        # a method. Calling it as items() raises 'dict not callable'.
        owned = character.items if hasattr(character, 'items') else {}
        if not isinstance(owned, dict):
            owned = {}
    except Exception:
        owned = {}

    # Worker-side auto-pick handles the FIRST input_items entry (the
    # optimizer's INPUT_ITEM global is single-valued anyway).
    for ii in activity.input_items:
        input_type = getattr(ii, 'type', '')
        reference = getattr(ii, 'reference', '') or ''
        min_level = getattr(ii, 'level', None) or 0

        if input_type == 'keyword':
            kw = reference.lower().replace('_', ' ')
            best = None
            best_score = -1.0
            for item in owned.keys():
                if item is None:
                    continue
                kws = [k.lower() for k in (getattr(item, 'keywords', []) or [])]
                if not any(k.replace('_', ' ') == kw for k in kws):
                    continue
                if min_level > 0:
                    reqs = getattr(item, 'requirements', []) or []
                    skill_req = next(
                        (r for r in reqs
                         if (r.get('type') if isinstance(r, dict) else getattr(r, 'type', None)) == 'skill'),
                        None,
                    )
                    if skill_req is not None:
                        level = skill_req.get('level') if isinstance(skill_req, dict) else getattr(skill_req, 'level', 0)
                        if (level or 0) < min_level:
                            continue
                s = _score(item)
                if s > best_score:
                    best_score = s
                    best = item
            if best is not None:
                return (_fine_variant_of(best) if use_fine_inputs else None) or best

        elif input_type == 'material':
            try:
                from util.autogenerated.materials import Material, MaterialInstance
            except ImportError:
                return None
            ref_attr = reference.split('.', 1)[-1] if '.' in reference else reference
            mat = getattr(Material, ref_attr, None)
            if mat is not None and isinstance(mat, MaterialInstance):
                return (_fine_variant_of(mat) if use_fine_inputs else None) or mat

    return None


def _extract_pet_consumable_meta(final_gearset):
    """Pull the optimizer's chosen pet + consumable out of a Gearset dict.

    encode_gearset() only serializes gear/tool/ring slots — without this,
    the worker's pet/consumable picks are silently dropped when the
    frontend re-decodes the export string at Equip time. The user reported
    bog_fishing_net showing 3.20 XP/step in the stats report but 3.039
    when equipped (a ~5% pet-XP delta).

    Returns ({pet_meta} or None, {consumable_meta} or None) — shape matches
    what crafting tree's Equip flow consumes (see _equipNode in
    components/crafting-tree-view.js + loadGearSetFromExport's extraSlots
    overlay). Variant defaults to 'normal' since the stats report runs
    pool-wide; if a user has a Shiny variant it'll be detected by the
    frontend's catalog enrichment when the meta is rehydrated.
    """
    if not isinstance(final_gearset, dict):
        return None, None
    sel_pet = None
    sel_cons = None
    pet_obj = final_gearset.get('pet')
    if pet_obj is not None:
        try:
            pet_name = getattr(pet_obj, 'name', '') or ''
            if pet_name:
                sel_pet = {
                    'name': pet_name,
                    'itemId': pet_name.lower().replace(' ', '_'),
                    'level': int(getattr(pet_obj, 'level', 1) or 1),
                    'variant': 'normal',
                    'rarity': 'common',
                    'type': 'pet',
                    # 2026-08-31 (jwbail): mark useAbility so the Equip path
                    # checks column-2's per-pet "use ability" box (and applies
                    # the ability stats) — but ONLY when the run had the
                    # "Always use active applicable pet ability" toggle on AND
                    # this pet actually has an ability at its (adult) level.
                    # A juvenile pet has no `abilities`, so it stays unchecked.
                    'useAbility': bool(
                        globals().get('_USE_PET_ABILITY', False)
                        and getattr(pet_obj, 'abilities', None)
                    ),
                }
        except Exception:
            sel_pet = None
    cons_obj = final_gearset.get('consumable')
    if cons_obj is not None:
        try:
            cons_name = getattr(cons_obj, 'name', '') or ''
            if cons_name:
                # Mirror ui/optimize_worker.py:_extract_pet_consumable_meta —
                # detect Fine variant by suffix, strip parens for itemId so
                # it matches catalog id (ItemCatalog._name_to_id). Without
                # this, Fine consumables get an empty icon_path on equip.
                is_fine = cons_name.endswith('(Fine)') or cons_name.endswith(' (Fine)')
                base_name = cons_name.replace(' (Fine)', '').replace('(Fine)', '').strip()
                cons_id = (
                    base_name.lower()
                    .replace(' ', '_')
                    .replace('(', '')
                    .replace(')', '')
                    .replace('-', '_')
                    .replace("'", '')
                )
                cons_icon = (
                    '/assets/icons/items/consumables/'
                    f"{base_name.replace(' ', '_').lower()}.svg"
                )
                sel_cons = {
                    'name': cons_name,
                    'itemId': cons_id,
                    'id': getattr(cons_obj, 'id', None),
                    'is_fine': is_fine,
                    'icon_path': cons_icon,
                    'rarity': 'fine' if is_fine else 'common',
                    'type': 'consumable',
                }
        except Exception:
            sel_cons = None
    return sel_pet, sel_cons


def run_optimizer_for_job(job: ReportJob, character,
                          pet_items_pool=None, consumable_items_pool=None,
                          hidden_items=None, force_location=None) -> Dict[str, Any]:
    """Run the greedy local search optimizer for a single job.

    Returns a dict with metric_value, metric_name, gearset_export.

    pet_items_pool / consumable_items_pool: lists prepared by run_worker
    when the user toggled "Include pets" / "Include consumables" on.
    Empty/None lists keep the previous gear-only behavior.

    hidden_items: set of Item/Material/Consumable objects the user flagged
    hidden — fed to the optimizer as IGNORED_ITEMS and filtered out of the
    consumable pool so the goals report never recommends hidden gear/items/
    collectibles/eggs/consumables. None = no hide filtering (legacy).
    """
    import optimize_activity_gearsets
    from util.gearset_utils import encode_gearset
    from util.walkscape_constants import Sorting, SortingEntry

    # 2026-05-25 (jwbail): re-apply the character's thread-local globals
    # in THIS worker thread. util/walkscape_globals.py stores
    # achievement_points / total_skill_level / custom_stats in
    # threading.local() — Character.__init__ writes them in whichever
    # thread loaded the character (main thread for run_worker), but
    # ThreadPoolExecutor workers get DIFFERENT threading.local() values
    # (defaults: 0 / 0 / {}). The optimizer reads these via
    # walkscape_globals.get_*() during stat aggregation (level bonuses,
    # achievement-gated stats, custom-stat gates), so a zeroed total
    # skill level silently strips level-multiplier bonuses on every
    # piece of gear. Result: worker-thread optimizer picks gear with
    # the highest RAW stats (e.g. Spikescale tunic with WE=18%) over
    # gear with set bonuses that depend on level (e.g. Treasure hunter
    # set's per-piece find_collectibles). The user-visible symptom was
    # 33615 vs 28426 for Cut willow trees → Weeping willow tear (~9% gap)
    # because find_collectibles gear was never picked.
    _reapply_character_thread_local_globals(character)

    activity = job.activity

    # ── Multi-location coverage (Feature 1) ──────────────────────────────────
    # An activity doable at several accessible locations can have a DIFFERENT
    # optimal gearset per location (gear is region-scoped via locationHasKeywords).
    # Today only the first accessible location was optimized. Here we optimize
    # EACH accessible location (recursing with force_location), keep the best as
    # the row, group locations that yield the IDENTICAL gearset ("Nomad Woods or
    # Disenchanted Forest"), and stash the distinct-set alternatives in
    # metrics_json['alt_locations'] for the frontend's Alternative Locations
    # section. Scoped to target-rate categories (chests/new_items) where lower
    # metric_value = fewer steps = better. force_location set => single-location
    # base case (no recursion), so this runs exactly once per location.
    _cat0 = getattr(job, 'category', None)
    if force_location is None and _cat0 in ('chests', 'new_items', 'xp', 'coins', 'target_items') and activity is not None:
        _acc = _activity_accessible_locations(activity)
        if len(_acc) > 1:
            # Dedup locations by region-tag set: for the SAME activity, two
            # locations with identical region tags scope gear identically, so
            # they produce the IDENTICAL optimization — solve ONCE per distinct
            # region profile and reuse. This cuts the multi-location cost from
            # #locations to #distinct-region-profiles (e.g. Azurazera+Frusenholm,
            # both [jarvonia,snowy], collapse to one solve). Exact: same activity
            # => same base_steps/target; only region-scoped gear varies, fully
            # captured by the region tags.
            _by_profile = {}   # region-tag frozenset -> [location names]
            _rep = {}          # profile -> representative location object
            for _loc in _acc:
                _regs = (frozenset([_loc]) if isinstance(_loc, str)
                         else frozenset(getattr(_loc, 'regions', None) or []))
                _lname = _loc if isinstance(_loc, str) else getattr(_loc, 'name', '')
                if _regs not in _by_profile:
                    _by_profile[_regs] = []
                    _rep[_regs] = _loc
                _by_profile[_regs].append(_lname)
            _per = []   # ([location names sharing this profile], result)
            for _prof, _lnames in _by_profile.items():
                try:
                    _r = run_optimizer_for_job(job, character, pet_items_pool,
                                               consumable_items_pool, hidden_items,
                                               force_location=_rep[_prof])
                except Exception as _mle:
                    print(f"[MULTILOC] {getattr(activity,'name','?')} loc-optimize failed: {_mle}", flush=True)
                    continue
                _per.append((_lnames, _r))
            _valid = [(lns, r) for (lns, r) in _per
                      if r and isinstance(r.get('metric_value'), (int, float))
                      and r.get('metric_value') > 0 and r.get('metric_value') != float('inf')]
            if _valid:
                # Direction-aware: chests/new_items are steps-based (LOWER
                # metric_value = fewer steps = better -> ascending, best first);
                # xp (xp/step) and coins (coins/1k) are HIGHER-is-better ->
                # descending so the best location is the primary row. (2026-07-30)
                _higher_better = _cat0 in ('xp', 'coins')
                _valid.sort(key=lambda t: t[1]['metric_value'], reverse=_higher_better)
                # Group locations by (metric, gearset export) so each group is a
                # set of TRULY equivalent locations — same result AND same gear.
                # Keying on export alone was wrong: region-scoped gear (e.g.
                # Linden leaf shorts, GDTE-only) makes the SAME export score a
                # DIFFERENT metric in another region, so those locations were
                # incorrectly folded into the primary "X or Y" name with one
                # (wrong) step count. The lowest-metric group is the primary row;
                # every other group becomes a grouped alternative-locations entry
                # (locations sharing a metric+export merged into one "A or B").
                def _grp_key(r):
                    mv = r.get('metric_value')
                    mv = round(float(mv), 6) if isinstance(mv, (int, float)) else mv
                    return (mv, r.get('gearset_export'))
                _groups = {}
                _order = []
                for lns, r in _valid:
                    k = _grp_key(r)
                    if k not in _groups:
                        _groups[k] = {'locations': list(lns), 'result': r}
                        _order.append(k)
                    else:
                        _groups[k]['locations'].extend(lns)
                _best = _groups[_order[0]]['result']
                _best_locs = _groups[_order[0]]['locations']
                _alts = []
                for k in _order[1:]:
                    g = _groups[k]
                    _aentry = {'location': ' or '.join(g['locations']),
                               'locations': g['locations'],
                               'metric_value': g['result'].get('metric_value'),
                               'gearset_export': g['result'].get('gearset_export')}
                    # Surface the alt's own chosen consumable/pet (not carried in
                    # the encoded export) so the alt gear preview shows them
                    # in-slot — the displayed metric already includes them. Each
                    # per-location result already computed these into its
                    # metrics_json (see _extract_pet_consumable_meta above).
                    _amj = g['result'].get('metrics_json')
                    if isinstance(_amj, dict):
                        if _amj.get('optimized_consumable'):
                            _aentry['optimized_consumable'] = _amj['optimized_consumable']
                        if _amj.get('optimized_pet'):
                            _aentry['optimized_pet'] = _amj['optimized_pet']
                    _alts.append(_aentry)
                _mj = _best.get('metrics_json')
                if isinstance(_mj, dict):
                    _mj['primary_location'] = _best_locs[0]
                    _mj['same_set_locations'] = _best_locs[1:]
                    _mj['alt_locations'] = _alts
                return _best
            # no valid multi-location result -> fall through to single-location path


    # Filter the ambient pet/consumable pool down to ones whose stats
    # actually scope to this job's primary skill (or a skill group
    # containing it). Mirrors column-2's _filter_pet_consumable_candidates_
    # by_skill EXACTLY by importing and calling it — the prior
    # _filter_pet_consumable_for_activity helper used a tighter direct-skill
    # match that excluded pets/consumables scoped to skill groups
    # (e.g. 'artisan' contains crafting/cooking/smithing). Result:
    # stats report had fewer candidates than column-3 and the optimizer
    # found a worse local optimum (user-reported 33616 vs 30823 for
    # Cut birch trees → Weeping willow tear).
    from ui.optimize_worker import _filter_pet_consumable_candidates_by_skill
    primary_skill = (getattr(activity, 'primary_skill', '') or '').lower()
    pet_pool = list(pet_items_pool or [])
    consumable_pool = list(consumable_items_pool or [])
    # Drop hidden consumables (pets are already filtered at pool build) unless
    # the user enabled "Use hidden consumables".
    if hidden_items and not globals().get('_USE_HIDDEN_CONSUMABLES', False):
        consumable_pool = [c for c in consumable_pool if c not in hidden_items]
    # target_items (bug 2026-08-12 "include pets on, none included"): a pet that
    # boosts the TARGET item's find rate is relevant even when its stat isn't
    # scoped to the activity's primary skill and isn't in the default
    # _GLOBAL_FIND_STATS allowlist — notably ItemFindingCategory.* for currency /
    # cat:if:* targets (AGT, Sea Shells, Gold Nugget). Feed those target-relevant
    # finding stats to the pre-filter so those pets survive to the optimizer,
    # which then scores them and keeps only the ones that actually help.
    _extra_find = None
    if getattr(job, 'category', None) == 'target_items':
        try:
            from optimize_activity_gearsets import finding_stats_for_if_target
            _extra_find = finding_stats_for_if_target(
                (job.extras or {}).get('target_ref') or '') or None
        except Exception as _e:
            print(f"[stats_report_worker] TI-PET extra-find resolve failed: {_e}", flush=True)
            _extra_find = None
    _pet_in = len(pet_pool)
    if primary_skill:
        pet_pool = _filter_pet_consumable_candidates_by_skill(
            pet_pool, primary_skill, item_kind='pet', extra_find_stats=_extra_find)
        consumable_pool = _filter_pet_consumable_candidates_by_skill(
            consumable_pool, primary_skill, item_kind='consumable')

    # ── BEGIN optimizer critical section ──────────────────────────────
    # 2026-05-22: serialize this block per-thread because the optimizer
    # uses module-level globals (TARGET_ITEM, SORTING_PRIORITY, ACTIVITY,
    # etc.) that race when multiple worker threads hit the optimizer at
    # the same time. See _OPTIMIZER_LOCK comment at module top for the
    # full failure mode (composite-key misses → user sees bare SPR
    # instead of steps/chest, e.g. 12.81 instead of 1918 for Bird nest).
    # Lock is held only for the global-mutating + optimizer + final-
    # metrics window. Everything after (DB writes, log writes, metric
    # extraction from local final_metrics) runs lock-free.
    with _OPTIMIZER_LOCK:
        # Configure optimizer for this job's category.
        # Full deep local search: greedy + 1-swap + 2-swap + 4-swap, 100 iterations.
        # On Pi hardware this is ~20-40s per activity — that's correct, not a bug.
        # Quality of recommendations > test speed.
        optimize_activity_gearsets.ACTIVITY = activity
        optimize_activity_gearsets.TARGET_ITEM = None
        optimize_activity_gearsets.TARGET_DROP_RATE = 0
        optimize_activity_gearsets.VERBOSE = False
        optimize_activity_gearsets.IGNORED_ITEMS = _sr_effective_ignored(hidden_items)
        optimize_activity_gearsets.INCLUDE_CONSUMABLES = bool(consumable_pool)
        optimize_activity_gearsets.CONSUMABLE_ITEMS = list(consumable_pool)
        optimize_activity_gearsets.INCLUDE_PETS = bool(pet_pool)
        optimize_activity_gearsets.PET_ITEMS = list(pet_pool)
        optimize_activity_gearsets.LOCKED_SLOTS = {}
        # 2026-05-25 (jwbail): set SELECTED_LOCATION explicitly to the
        # activity's first accessible location instead of None. Column-3
        # always sets a real location (user-selected), so location-gated
        # gear stats apply correctly during optimization. With None the
        # fallback _get_location returns activity.locations[0] which
        # works for single-location activities but ignores accessibility
        # filtering and skips multi-location ranking. Setting the
        # accessible location explicitly aligns with the column-3 path.
        _selected_loc = force_location if force_location is not None else _activity_first_accessible_location(activity)
        # _activity_first_accessible_location may return a string when
        # activity.locations holds string IDs; the optimizer expects a
        # Location object or None. Pass through if it's a Location, else
        # let _get_location's fallback handle it (None).
        if _selected_loc is not None and not isinstance(_selected_loc, str):
            optimize_activity_gearsets.SELECTED_LOCATION = _selected_loc
        else:
            optimize_activity_gearsets.SELECTED_LOCATION = None
        # 2026-06-16 (jwbail): diagnostic for "chest-farming-for-activities shows
        # an inaccessible location" (e.g. Myriadian Arc). build_chest_jobs keeps
        # an activity if it has ANY accessible location, but the row is optimized
        # at SELECTED_LOCATION — and when the accessible-location helper returns a
        # STRING (or None), SELECTED_LOCATION becomes None and _get_location falls
        # back to activity.locations[0], which may be the LOCKED first location.
        # Log the decision so a bug report captures the divergence.
        if getattr(job, 'category', None) == 'chests':
            try:
                _locs = getattr(activity, 'locations', None) or []
                _loc_names = [l if isinstance(l, str) else getattr(l, 'name', str(l)) for l in _locs]
                _acc = _selected_loc if isinstance(_selected_loc, str) else getattr(_selected_loc, 'name', None)
                _fellback = optimize_activity_gearsets.SELECTED_LOCATION is None
                print(f"[stats_report_worker][chest-loc] activity={getattr(activity, 'name', '?')!r} "
                      f"chest={job.chest_name!r} accessible_loc={_acc!r} "
                      f"accessible_type={type(_selected_loc).__name__} "
                      f"used={'locations[0]=' + (_loc_names[0] if _loc_names else 'None') if _fellback else _acc!r} "
                      f"all_locations={_loc_names} "
                      f"unlocked_regions={sorted(globals().get('_UNLOCKED_REGIONS') or [])} "
                      f"locked_locations={sorted(globals().get('_LOCKED_LOCATIONS') or [])}",
                      flush=True)
            except Exception as _e:
                print(f"[stats_report_worker][chest-loc] log failed: {_e}", flush=True)
        # Auto-pick an INPUT_ITEM for activities that declare input_items
        # (e.g. arrows for Alligator hunting). Without this the optimizer
        # leaves INPUT_ITEM=None, the gearset has no arrows, and the score
        # bakes in the keyword-counts failure. Mirrors crafting tree's
        # auto-pick (ui/app.py:_auto_pick_input_items_for_activity).
        #
        # 2026-05-25 (jwbail): also detect when the activity declares an
        # input_items requirement but the user owns nothing matching.
        # Surface that as `missing_input` in metrics_json so the frontend
        # can render a warning badge on the row ("you can't actually do
        # this without owning a hunting net"). Returns the keyword name
        # + min level so the user knows what to acquire.
        _picked_input = _auto_pick_input_item_for_activity(
            activity, character, use_fine_inputs=globals().get('_USE_FINE_INPUTS', False))
        optimize_activity_gearsets.INPUT_ITEM = _picked_input
        _missing_input = None
        if _picked_input is None and getattr(activity, 'input_items', None):
            try:
                _ii = activity.input_items[0]
                _kw = (getattr(_ii, 'reference', '') or getattr(_ii, 'name', '') or '').strip()
                _kw_display = _kw.replace('_', ' ').strip()
                if _kw_display:
                    _missing_input = {
                        'keyword': _kw,
                        'keyword_display': _kw_display,
                        'min_level': int(getattr(_ii, 'level', 0) or 0),
                        'input_type': getattr(_ii, 'type', '') or '',
                    }
            except Exception:
                _missing_input = None
        optimize_activity_gearsets.ENABLE_2_SWAP = True
        # 2026-05-23 fast mode: skip local-search refinement. MAX_ITERATIONS=0
        # makes local_search_refine's `while improved and iteration <
        # max_iterations:` loop exit immediately, returning the greedy
        # initial gearset unchanged. ENABLE_2_SWAP/4_SWAP also gated for
        # explicitness — the outer loop already guards them, but this
        # makes the intent clear.
        _fast = globals().get('_FAST_MODE', False)
        optimize_activity_gearsets.ENABLE_2_SWAP = not _fast
        optimize_activity_gearsets.ENABLE_4_SWAP = not _fast
        optimize_activity_gearsets.MAX_ITERATIONS = 0 if _fast else 100
        optimize_activity_gearsets.DEBUG_TOOL_KEYWORDS = []
        optimize_activity_gearsets.DEBUG_2_SWAP = False

        if job.category == 'xp':
            optimize_activity_gearsets.SORTING_PRIORITY = [Sorting.XP_PER_STEP]
            optimize_activity_gearsets.SORTING_WEIGHTS = {Sorting.XP_PER_STEP: 100}
        elif job.category == 'coins':
            # 2026-05-21: TARGET_ITEM='cat:coins' makes the optimizer score
            # by the synthetic coin target injected into drop_rates by
            # calculate_gearset_metrics (compute_coin_targets_for_activity
            # writes drop_rates['cat:coins'] = steps_per_coin). Without
            # this, the worker was scoring by general 'steps_per_reward_roll'
            # — which is steps to ANY drop including no-value collectibles
            # — so an activity that drops 1 collectible/action read as
            # ~1.32 steps/reward → 757 'coins'/1k_steps even when the
            # activity literally produces no coins.
            #
            # 2026-05-25 (jwbail): same SortingEntry-with-target fix as
            # collectibles — the bare Sorting.STEPS_PER_REWARD_ROLL enum
            # made the comparator look up the bare metric key (raw_rewards
            # SPR), so the optimizer was scoring by general reward-roll
            # throughput, NOT by steps-per-coin. Now the SortingEntry
            # carries target='cat:coins' so the comparator reads
            # `metrics['steps_per_reward_roll::cat:coins']` (the coin-
            # specific synthetic computed by compute_coin_targets_for_activity).
            optimize_activity_gearsets.SORTING_PRIORITY = [
                SortingEntry(sort=Sorting.STEPS_PER_REWARD_ROLL,
                             target='cat:coins', weight=100),
            ]
            optimize_activity_gearsets.SORTING_WEIGHTS = {Sorting.STEPS_PER_REWARD_ROLL: 100}
            optimize_activity_gearsets.TARGET_ITEM = 'cat:coins'
        elif job.category in ('chests', 'chests_recipes'):
            # 2026-05-25 (jwbail): same SortingEntry-with-target fix as
            # collectibles — bare enum made the comparator score by raw
            # reward roll (general drop throughput), not by steps-to-this-
            # specific-chest. Result: chest_finding gear was never preferred
            # over generic action-speed gear. Now the SortingEntry carries
            # the chest name so the comparator reads
            # `metrics['steps_per_reward_roll::<chest_name>']`, which IS
            # chest_finding-aware (activity.get_expected_drop_rate applies
            # chest_finding to chest drops at the drop_rates dict level).
            if job.chest_name:
                optimize_activity_gearsets.SORTING_PRIORITY = [
                    SortingEntry(sort=Sorting.STEPS_PER_REWARD_ROLL,
                                 target=job.chest_name, weight=100),
                ]
                optimize_activity_gearsets.TARGET_ITEM = job.chest_name
            else:
                optimize_activity_gearsets.SORTING_PRIORITY = [Sorting.STEPS_PER_REWARD_ROLL]
            optimize_activity_gearsets.SORTING_WEIGHTS = {Sorting.STEPS_PER_REWARD_ROLL: 100}
        elif job.category == 'new_items':
            # 2026-05-24 fix (jwbail): the new_items metric used to be
            # the no-gear precomputed score, which mismatched what the
            # user saw in column-3 drops (5,974 with optimized gear,
            # 11,904 in the report). Setting TARGET_ITEM to the
            # builder-picked best drop makes the optimizer write
            # `steps_per_reward_roll::<item_name>` into final_metrics,
            # gear-aware and matching the column-3 calculation.
            #
            # 2026-05-25 fix (jwbail): SORTING_PRIORITY MUST be a
            # SortingEntry carrying the target — bare Sorting.STEPS_
            # PER_REWARD_ROLL has no target so the comparator looks up
            # `metrics['steps_per_reward_roll']` (the bare/raw_rewards
            # value), and the optimizer ends up scoring by reward-roll
            # count instead of by steps-to-this-collectible. Result:
            # find_collectibles gear is never picked for collectible
            # rows. User-reported: "collectibles is just optimizing for
            # steps/reward rolls, not for steps/target item".
            #
            # The fix mirrors column-3's path
            # (ui/optimize_worker.py:_resolve_category_target_in_priority_entry
            # which resolves 'cat:collectibles' to the first collectible
            # NAME in the drop table, then puts that name as the
            # SortingEntry's target). The comparator then looks up
            # `metrics['steps_per_reward_roll::<name>']` which IS find_
            # collectibles-aware because activity.get_expected_drop_rate
            # applies find_collectibles to collectible drops at the
            # drop_rates dict level.
            #
            # GEAR/TOOLS/EGGS likewise score by the per-name SPR, so
            # the optimizer picks gear that minimizes time-to-this-drop
            # for that kind too. There is no `find_items` stat on gear,
            # so the per-name SPR for gear/tools is just steps/reward-
            # roll / drop_chance — still correct.
            best_drop_meta = (job.extras or {}).get('best_drop') or {}
            best_drop_name = best_drop_meta.get('item_name')
            if best_drop_name:
                optimize_activity_gearsets.SORTING_PRIORITY = [
                    SortingEntry(sort=Sorting.STEPS_PER_REWARD_ROLL,
                                 target=best_drop_name, weight=100),
                ]
                optimize_activity_gearsets.TARGET_ITEM = best_drop_name
            else:
                optimize_activity_gearsets.SORTING_PRIORITY = [Sorting.STEPS_PER_REWARD_ROLL]
            optimize_activity_gearsets.SORTING_WEIGHTS = {Sorting.STEPS_PER_REWARD_ROLL: 100}
        elif job.category == 'target_items':
            # 2026-08-12 (jwbail) v3 gear-aware: optimize the gearset that
            # minimizes steps to THIS target item at THIS activity. extras
            # ['target_ref'] is the item's display name; the comparator reads
            # steps_per_reward_roll::<target>, which is find/FMF/double-reward
            # aware via activity.get_expected_drop_rate — same mechanism as the
            # new_items / chests targeted branches above.
            _ti_target = (job.extras or {}).get('target_ref') or job.precomputed_metric_name
            if _ti_target:
                optimize_activity_gearsets.SORTING_PRIORITY = [
                    SortingEntry(sort=Sorting.STEPS_PER_REWARD_ROLL,
                                 target=_ti_target, weight=100),
                ]
                optimize_activity_gearsets.TARGET_ITEM = _ti_target
            else:
                optimize_activity_gearsets.SORTING_PRIORITY = [Sorting.STEPS_PER_REWARD_ROLL]
            optimize_activity_gearsets.SORTING_WEIGHTS = {Sorting.STEPS_PER_REWARD_ROLL: 100}
        else:
            optimize_activity_gearsets.SORTING_PRIORITY = [Sorting.STEPS_PER_REWARD_ROLL]
            optimize_activity_gearsets.SORTING_WEIGHTS = {Sorting.STEPS_PER_REWARD_ROLL: 100}

        # Run greedy + local search.
        # 2026-05-23: in fast mode, skip local_search_refine entirely. The
        # function has a tiebreak pass that runs unconditionally after
        # the for loop, and with max_iterations=0 some part of that
        # tiebreak path raises silently — every xp/coins/chests job
        # FAILED in user-reported testing while new_items + chests_recipes
        # (which take different paths) succeeded. Skipping
        # local_search_refine and using the greedy gearset directly
        # avoids the broken path and is what 'greedy only' should mean
        # anyway.
        # [EXACT XP optimizer -- feature-gated] On the gated path, the exact
        # branch-and-bound REPLACES greedy + local_search_refine (the slow
        # 2/3/4-swap hill climb). Exact is provably optimal over the XP/step
        # decision variables (gear/tool/ring/pet/consumable + input offset), so
        # it is >= any local-search result, and it is far cheaper (measured
        # ~7.7x faster on gathering activities). Falls back to full greedy+refine
        # only if exact is infeasible or errors. Never breaks the report.
        _exact_used = False
        _exact_cat = getattr(job, 'category', None)
        _target_rate_cats = ('chests', 'chests_recipes', 'new_items', 'target_items')
        _tr_target = None
        if globals().get('_EXACT_XP_MODE', False) and _exact_cat in (('xp', 'coins') + _target_rate_cats):
            _ex_gear = None
            try:
                _oag = optimize_activity_gearsets
                if _exact_cat == 'coins':
                    from util.exact_coins_optimizer import exact_coins_optimize as _exact_fn
                elif _exact_cat == 'xp':
                    from util.exact_activity_xp_optimizer import exact_xp_optimize as _exact_fn
                else:
                    # chests / chests_recipes / new_items all maximize the same
                    # objective — the target item(s)'s drop-rate per step — via
                    # the shared target-rate exact optimizer (a coins subclass
                    # with unit item weights). Target = the chest name, or the
                    # builder-picked best-drop item (the SAME target the greedy
                    # path scores against), so exact and greedy are comparable.
                    from util.exact_target_rate_optimizer import exact_target_rate_optimize as _exact_fn
                    if _exact_cat in ('chests', 'chests_recipes'):
                        _tr_target = getattr(job, 'chest_name', None)
                    elif _exact_cat == 'target_items':
                        # Material scopes maximize steps_per_reward_roll::<item>
                        # (the exact target-rate objective). Currency scopes
                        # (metric_kind 'per_1k') are a VALUE aggregate (AGT / Sea
                        # Shells) -> the exact currency-value optimizer. FINDING
                        # groups (ectoplasm / bird_nest / gold_nugget) are found
                        # via ItemFindingCategory GEAR, not a native drop-table
                        # rate exact_target_rate can score (cat:if:X targets
                        # return a degenerate ~0 rate -> garbage), so they stay on
                        # greedy. 2026-08-14: prod-vs-testing diff showed exact
                        # regressed finding badly; gate it out here.
                        _ti_ex = getattr(job, 'extras', None) or {}
                        _ti_mk = _ti_ex.get('metric_kind')
                        _ti_gk = _ti_ex.get('group_kind')
                        if _ti_gk == 'finding':
                            # ectoplasm/bird_nest are found via ItemFindingCategory
                            # GEAR. The cat:if:<CAT> rate = if_stat/(100*base_spr)
                            # (linear in IFC.<CAT>) -> the exact finding-rate
                            # optimizer (coins model, C0=0, A_coins=0.01*IFC.<CAT>)
                            # solves it exactly and fixes the 1e9 garbage
                            # exact_target_rate produced on cat:if targets. Only
                            # route cat:if:<CAT> non-fine scopes (target/SORTING/
                            # display all consistent on cat:if); fine-finding stays
                            # greedy pending the multiplicative-FMF finding variant.
                            _tref = _ti_ex.get('target_ref') or ''
                            if _tref.startswith('cat:if:') and not _ti_ex.get('is_fine'):
                                _tr_target = _tref
                                from util.exact_target_rate_optimizer import (
                                    exact_finding_rate_optimize as _exact_fn)
                        elif _ti_mk == 'steps_per_item':
                            _tr_target = _ti_ex.get('target_ref') or None
                            # FINE variants factorize as base_rate*(1+FMF) — the
                            # base_find x FMF cross-term the linear A_coins model
                            # drops (~11% error). Route them to the multiplicative
                            # ExactFineRateOptimizer (proven 0.00% model error).
                            if _tr_target and _ti_ex.get('is_fine'):
                                from util.exact_target_rate_optimizer import (
                                    exact_fine_rate_optimize as _exact_fn)
                        elif _ti_mk == 'per_1k':
                            _tr_target = _ti_ex.get('target_ref') or None
                            if _tr_target:
                                from util.exact_target_rate_optimizer import (
                                    exact_currency_optimize as _exact_fn)
                    else:
                        _tr_target = ((getattr(job, 'extras', None) or {}).get('best_drop') or {}).get('item_name')
                if _exact_cat in _target_rate_cats:
                    if _tr_target:
                        # Chests: the optimal gearset is chest-type-independent
                        # (chest_finding/WE/DA/dr scale every chest equally, so
                        # argmax is identical for all chests at an activity+
                        # location). Solve ONCE per (run, activity, location) and
                        # reuse across the activity's chests; the per-chest metric
                        # still recomputes downstream from the reused gearset.
                        _ck = None
                        _solve_cache = None
                        if _exact_cat == 'chests' and activity is not None:
                            _ck = (job.run_id, getattr(activity, 'name', None),
                                   getattr(_oag, 'SELECTED_LOCATION', None),
                                   bool(globals().get('_FAST_MODE', False)))
                            _solve_cache = _CHEST_SOLVE_CACHE
                        elif _exact_cat == 'target_items' and activity is not None:
                            # Cache the exact solve per (run, activity, location,
                            # fast, TARGET ITEM). It MUST be keyed on the specific
                            # target item (_tr_target), NOT just the find-signature.
                            # Unlike chests -- whose argmax is chest-type-independent
                            # because chest_finding/WE/DA/dr scale every chest
                            # equally -- a target-item RATE optimum depends on that
                            # item's own base rate (C0) and per-axis find marginals.
                            # Items sharing a find-signature (e.g. every RANDOM_GEM
                            # fine gem: Rough topaz / Rough jade / Rough star pearl /
                            # Rough wrentmarine ...) can have DIFFERENT optimal
                            # gearsets, because the FMF-vs-gem-find trade-off shifts
                            # with C0 (verified: topaz+wrentmarine -> Royal troubadour
                            # capesuit, jade+star pearl -> Conservationist shirt).
                            # Reusing one gearset across the signature let whichever
                            # sibling solved first win the cache key -> the fine/base
                            # rough_topaz @ Antique market assessor regression. The
                            # find-signature stays in the key (harmless, still
                            # distinguishes find profiles); _tr_target is the fix.
                            _ck = (job.run_id, getattr(activity, 'name', None),
                                   getattr(_oag, 'SELECTED_LOCATION', None),
                                   bool(globals().get('_FAST_MODE', False)),
                                   _tr_target,
                                   _ti_find_signature(job))
                            _solve_cache = _TI_SOLVE_CACHE
                        _cached = (_solve_cache.get(_ck)
                                   if (_ck is not None and _solve_cache is not None) else None)
                        if _cached is not None:
                            _ex_gear, _cached_be = _cached
                            try:
                                import util.exact_target_rate_optimizer as _exmod0
                                _exmod0.last_run_budget_exhausted = _cached_be
                            except Exception:
                                pass
                        else:
                            _ex_gear = _exact_fn(
                                activity, character, _tr_target,
                                skill=getattr(activity, 'primary_skill', None),
                                location=getattr(_oag, 'SELECTED_LOCATION', None),
                                pets=getattr(_oag, 'PET_ITEMS', None),
                                consumables=getattr(_oag, 'CONSUMABLE_ITEMS', None),
                                input_item=getattr(_oag, 'INPUT_ITEM', None))
                            if _ck is not None and _solve_cache is not None and _ex_gear:
                                try:
                                    import util.exact_target_rate_optimizer as _exmod0
                                    _be = getattr(_exmod0, 'last_run_budget_exhausted', False)
                                except Exception:
                                    _be = False
                                _solve_cache[_ck] = (_ex_gear, _be)
                    # else: no resolvable target -> leave _ex_gear None -> greedy fallback
                else:
                    _ex_gear = _exact_fn(
                        activity, character,
                        skill=getattr(activity, 'primary_skill', None),
                        location=getattr(_oag, 'SELECTED_LOCATION', None),
                        pets=getattr(_oag, 'PET_ITEMS', None),
                        consumables=getattr(_oag, 'CONSUMABLE_ITEMS', None),
                        input_item=getattr(_oag, 'INPUT_ITEM', None))
            except Exception as _exc:
                import traceback
                print(f"[EXACT_XP] ERROR {getattr(activity, 'name', '?')}: {_exc}")
                traceback.print_exc()
            if _ex_gear:
                if _exact_cat == 'coins':
                    import util.exact_coins_optimizer as _exmod
                elif _exact_cat == 'xp':
                    import util.exact_activity_xp_optimizer as _exmod
                else:
                    import util.exact_target_rate_optimizer as _exmod
                # 2026-08-14 (jwbail): ALWAYS run the greedy-comparison valve for
                # target_items, even when the exact solve is "proven optimal" on
                # ITS objective. The exact objective (get_expected_drop_rate rate
                # / currency value) can diverge from the report's DISPLAY metric
                # for fine variants and currency aggregates, so a proven-optimal
                # exact gearset was landing WORSE than greedy on the shown metric
                # (the prod-vs-testing regression). Forcing the valve + scoring
                # _xps on the true display metric keeps exact ONLY when it beats
                # greedy on what the user sees. Other categories keep the fast path.
                # 2026-08-14 (jwbail): force the greedy-comparison valve ONLY for
                # target_items CURRENCY (AGT/Sea Shells) — its value model is still
                # a linear approximation (the AGT regression) pending the per-drop
                # fine extension. MATERIAL scopes (fine now via the exact
                # multiplicative-FMF optimizer, non-fine via exact_target_rate) are
                # exact and trust the proven-optimal fast path; they only fall to
                # the standard budget-cut valve if the B&B exhausts its node budget
                # (same safety net every exact category uses). Finding stays greedy
                # (gated above). No forced greedy for material.
                _ti_force_valve = (_exact_cat == 'target_items'
                                   and (getattr(job, 'extras', None) or {}).get('metric_kind') == 'per_1k')
                if (not _ti_force_valve) and (
                        getattr(_exmod, '_USE_DINKELBACH', False)
                        or not getattr(_exmod, 'last_run_budget_exhausted', False)):
                    # Proven global optimum -> use it directly.
                    # (Dinkelbach mode: trust the engine result even if a
                    # subproblem hit the node budget, so we can measure the raw
                    # Dinkelbach behavior on never-saturating activities instead
                    # of masking it with the greedy+refine valve.)
                    final_gearset = _ex_gear
                    _exact_used = True
                else:
                    # Budget-cut: the exact result is a best-first INCUMBENT, not
                    # proven optimal. Also run greedy + 1/2/3/4-swap local search
                    # and keep whichever is better by XP/step, so we are never
                    # worse than the hill-climb. Log every comparison so we can
                    # later prove whether the incumbent ever loses (and drop the
                    # hill-climb if it never does).
                    _init = optimize_activity_gearsets.get_greedy_initial_solution(activity, character)
                    if globals().get('_FAST_MODE', False):
                        _refine = _init
                    else:
                        _refine = optimize_activity_gearsets.local_search_refine(
                            _init, activity, character, optimize_activity_gearsets.MAX_ITERATIONS)

                    def _xps(_g):
                        try:
                            _m, _ts = optimize_activity_gearsets.calculate_gearset_metrics(_g, activity, character)
                            # target_items CURRENCY: score on the value/step the
                            # report actually shows (units/1k via compute_*_targets),
                            # NOT the item-rate SPR — otherwise the valve compares
                            # on the wrong axis and can keep a lower-value gearset
                            # (the AGT regression the prod diff surfaced).
                            if (getattr(job, 'category', None) == 'target_items'
                                    and (getattr(job, 'extras', None) or {}).get('metric_kind') == 'per_1k'
                                    and _tr_target):
                                _cloc = getattr(optimize_activity_gearsets, 'SELECTED_LOCATION', None)
                                _dr = activity.get_expected_drop_rate(
                                    _ts or {}, location=_cloc, target_item=None, character=character,
                                    include_collectibles_from_character=False)
                                if _tr_target == 'cat:sea_shells':
                                    from util.shell_value import compute_shell_targets_for_activity as _vf, SHELL_TARGET as _tk
                                else:
                                    from util.ag_token_value import compute_agt_targets_for_activity as _vf, AGT_TARGET as _tk
                                _spv = _vf(activity, _dr, stats=_ts or {}).get(_tk)
                                return (1.0 / _spv) if (_spv and _spv > 0 and _spv != float('inf')) else float('-inf')
                            if _exact_cat in _target_rate_cats and _tr_target:
                                # rolls-per-step of the target (higher better);
                                # mirrors the worker's own steps_per_reward_roll
                                # metric for this target so exact-incumbent and
                                # hill-climb are compared on the true objective.
                                _spr = _m.get(f'steps_per_reward_roll::{_tr_target}')
                                return (1.0 / _spr) if (_spr and _spr > 0 and _spr != float('inf')) else float('-inf')
                            if getattr(job, 'category', None) == 'coins':
                                from util.coin_value import compute_coin_targets_for_activity, COIN_TARGET
                                _dr = activity.get_expected_drop_rate(
                                    _ts or {}, location=getattr(optimize_activity_gearsets, 'SELECTED_LOCATION', None),
                                    target_item=None, character=character,
                                    include_collectibles_from_character=False)
                                _spc = compute_coin_targets_for_activity(activity, _dr, stats=_ts or {}).get(COIN_TARGET)
                                return (1.0 / _spc) if (_spc and _spc > 0 and _spc != float('inf')) else float('-inf')
                            return float(_m.get('primary_xp_per_step')
                                         or _m.get('total_xp_per_step') or 0.0)
                        except Exception:
                            return float('-inf')
                    _r_exact = _xps(_ex_gear)
                    _r_refine = _xps(_refine)
                    if _r_exact >= _r_refine:
                        final_gearset = _ex_gear; _exact_used = True; _winner = 'exact_incumbent'
                    else:
                        final_gearset = _refine; _winner = 'hill_climb'
            else:
                initial_gearset = optimize_activity_gearsets.get_greedy_initial_solution(activity, character)
                if globals().get('_FAST_MODE', False):
                    final_gearset = initial_gearset
                else:
                    final_gearset = optimize_activity_gearsets.local_search_refine(
                        initial_gearset, activity, character, optimize_activity_gearsets.MAX_ITERATIONS)
                print(f"[EXACT_XP] {getattr(activity, 'name', '?')} exact=None -> greedy+refine fallback")
        else:
            initial_gearset = optimize_activity_gearsets.get_greedy_initial_solution(activity, character)
            if globals().get('_FAST_MODE', False):
                final_gearset = initial_gearset
            else:
                final_gearset = optimize_activity_gearsets.local_search_refine(
                    initial_gearset, activity, character, optimize_activity_gearsets.MAX_ITERATIONS)
        # Fill any EMPTY slot with a metric-neutral utility item (never-worse)
        # via the shared dumb-upgrade pass, so activity categories (xp/coins/
        # chests/new_items) fill empties like the greedy calculator and the
        # recipe path. Activities aren't crafting -> include_nmc=False. The pass
        # rejects any candidate that lowers a stat, so the primary metric can't
        # regress; it skips pet/consumable slots. (Thread 2026-07-29.)
        try:
            from util.dumb_upgrade_pass import apply_dumb_stat_upgrade as _apply_du
            _du_reqs = getattr(activity, 'requirements', None) or {}
            _du_req_kw = (set((_du_reqs.get('keyword_counts', {}) or {}).keys())
                          if isinstance(_du_reqs, dict) else set())
            _du_req_names = ({n.lower() for n in (_du_reqs.get('item_requirements', []) or [])
                             if isinstance(n, str)} if isinstance(_du_reqs, dict) else set())
            final_gearset = _apply_du(
                final_gearset, character,
                skill=(getattr(activity, 'primary_skill', '') or 'agility').lower(),
                location=getattr(optimize_activity_gearsets, 'SELECTED_LOCATION', None),
                include_nmc=False,
                required_keywords=_du_req_kw,
                required_item_names=_du_req_names,
                # Use the FULL owned pet pool (not optimize_activity_gearsets.
                # PET_ITEMS, which is skill-filtered): the pet skill filter drops
                # pets whose only relevant stat is global inventory_space (e.g.
                # Reindeer on a fishing activity), so the dumb-fill never saw the
                # better inventory pet and left the optimizer's Camel in place.
                # The never-worse dominance check keeps this safe. Matches the
                # recipe path, which already passes the full pool. (2026-07-30)
                pet_candidates=(list(pet_items_pool) if pet_items_pool else None),
                # Also UPGRADE an occupied gear/ring slot to a strictly-dominant
                # inventory/FMF item (e.g. Collection ring over an equal-FC Gold
                # jade ring). The goals report runs in FAST mode, which skips
                # local_search_refine (and its own dumb-upgrade that already
                # opts in), so this worker pass is the ONLY dumb-upgrade that
                # runs for activity rows -- it must opt in too or the occupied
                # ring is never upgraded (bug feaa0b46). Safe: the never-worse
                # check runs first, so the swap is always a strict Pareto win.
                allow_occupied_tier3_swap=True,
                verbose=False)
        except Exception as _du_exc:
            print(f"[activity-dumb-fill] skipped: {_du_exc!r}", flush=True)
        final_metrics, total_stats = optimize_activity_gearsets.calculate_gearset_metrics(
            final_gearset, activity, character, final=True
        )
        if _exact_used:
            _es = final_metrics.get('expected_steps_per_action') or 0
            _xa = final_metrics.get('primary_xp_per_action') or 0
            print(f"[EXACT_XP] {getattr(activity, 'name', '?')} "
                  f"skill={getattr(activity, 'primary_skill', '?')} "
                  f"exact-only xp/step={(_xa / _es) if _es > 0 else 0:.5f}")
        # 2026-06-05 (jwbail): compute slot alternatives HERE, inside the
        # optimizer lock, where the module globals (TARGET_ITEM,
        # SELECTED_LOCATION, INPUT_ITEM, SORTING_PRIORITY, INSTANT_ACTIONS,
        # …) and the real final_gearset (incl. the optimizer's pet +
        # consumable) are all intact. The on-demand /slot-alternatives
        # endpoint cannot faithfully reproduce this environment from the
        # stored export (export omits pet/consumable; several globals are
        # unset), so its baseline diverged from the row metric (e.g. 4494
        # vs the row's 2828 on Horseshoe making / Smithing chest) and it
        # surfaced false-positive upgrades. Computing here guarantees the
        # alternatives' old_value == the row metric and the ranking matches
        # the normal optimizer. Cheap (~0.5s/job). Stored in metrics_json
        # as _slot_alternatives / _slot_locked_alternatives; the frontend
        # reads them directly for the unedited gearset.
        # 2026-07-08 (jwbail): slot alternatives are now computed ON-DEMAND by
        # the /api/stats-report/slot-alternatives endpoint (which resolves the
        # row's accessible location + input item so its ranking matches this
        # optimizer). Dropped the in-lock precompute for ALL paths — it added a
        # flat ~1.4s/row on the server, and on the local (Pyodide) batch it had
        # to be skipped via _SKIP_SLOT_ALTS anyway to avoid WASM MemoryErrors.
        # Empty maps make the frontend fall through to the on-demand endpoint
        # (stats-report-page.js _storedRowAlternatives returns null when the
        # stored maps are empty).
        _slot_alts, _slot_locked, _slot_hidden = ({}, {}, {})
    # ── END optimizer critical section ────────────────────────────────
    export_string = encode_gearset(final_gearset)

    # Build a metrics breakdown blob the frontend can use for:
    #   * "Steps to next level" calc (needs displayed_steps_per_action AND
    #     expected_steps_per_action separately so it can apply the
    #     "min one displayed action's worth" floor described in the spec).
    #   * Secondary XP popover for activities that grant XP to multiple
    #     skills per action (e.g. Treasure hunt).
    #
    # Secondary XP per action is computed here from total_stats's bonus
    # multipliers because the optimizer's metrics dict only stores the
    # primary skill's XP. Formula matches util/activity_metrics.py:
    #   xp_per_action = base × (1 + bonus_xp_percent) + bonus_xp_add
    bonus_xp_pct = float(total_stats.get('bonus_xp_percent', 0.0)) if total_stats else 0.0
    bonus_xp_add = float(total_stats.get('bonus_xp_add', 0.0)) if total_stats else 0.0
    secondary_xp_base = getattr(activity, 'secondary_xp', None) or {}
    secondary_xp_per_action = {
        skill: float(base) * (1.0 + bonus_xp_pct) + bonus_xp_add
        for skill, base in secondary_xp_base.items()
        if base
    }
    expected_steps = final_metrics.get('expected_steps_per_action') or 0
    primary_xp_per_action = final_metrics.get('primary_xp_per_action') or 0
    primary_xp_per_step = final_metrics.get('primary_xp_per_step') or 0
    # Per-skill XP/step map: primary skill + every secondary skill, all
    # divided by the same expected_steps_per_action so totals add up.
    primary_skill = getattr(activity, 'primary_skill', None)
    xp_per_step_by_skill = {}
    if primary_skill and expected_steps > 0:
        xp_per_step_by_skill[primary_skill] = primary_xp_per_action / expected_steps
    for skill, xp_per_action in secondary_xp_per_action.items():
        if expected_steps > 0:
            xp_per_step_by_skill[skill] = xp_per_action / expected_steps
    # Termite "Terminate" -> Carpentry XP (informational). On a Woodcutting
    # activity, if the character OWNS a level>=4 Termite, the ability converts a
    # 15% share of found logs into Carpentry XP (= material effort * 0.5). Surface
    # it as a Carpentry secondary stream so the goals report shows it on every
    # log-cutting activity. Ownership-keyed (not equipped-pet-keyed) to match the
    # product intent and the owned_pets staleness fingerprint. The XP is a fixed
    # effort*modifier and is intentionally NOT bonus-XP scaled; the drop yields it
    # is derived from already reflect the optimized gearset's find/double bonuses.
    _termite_carpentry = None
    try:
        from ui.pet_effort import compute_report_termite_carpentry
        _termite_carpentry = compute_report_termite_carpentry(
            activity, total_stats,
            getattr(optimize_activity_gearsets, 'SELECTED_LOCATION', None),
            character)
    except Exception:
        _termite_carpentry = None
    if _termite_carpentry and _termite_carpentry.get('per_step'):
        _carp = _termite_carpentry['skill'].capitalize()  # 'Carpentry'
        xp_per_step_by_skill[_carp] = (
            xp_per_step_by_skill.get(_carp, 0.0) + _termite_carpentry['per_step'])
        _cpa = _termite_carpentry.get('per_action')
        if _cpa:
            secondary_xp_per_action[_carp] = (
                secondary_xp_per_action.get(_carp, 0.0) + _cpa)
    total_xp_per_step = sum(xp_per_step_by_skill.values())

    metrics_breakdown = {
        'primary_skill': primary_skill,
        'displayed_steps_per_action': final_metrics.get('displayed_steps_per_action'),
        'expected_steps_per_action': expected_steps,
        'primary_xp_per_action': primary_xp_per_action,
        'primary_xp_per_step': primary_xp_per_step,
        'secondary_xp_per_action': secondary_xp_per_action,
        # New: per-skill XP/step (primary + secondaries) — used by the
        # frontend so a row appearing under the Fishing section for an
        # activity whose primary is Mining can show Fishing's XP/step
        # rather than Mining's. Keys are display-cased skill names
        # ('Mining', 'Fishing') matching activity.primary_skill /
        # secondary_xp dict keys.
        'xp_per_step_by_skill': xp_per_step_by_skill,
        # Sum of every skill's XP/step on this activity. Frontend shows
        # this as 'Total: 1.354 XP/step' next to the section-skill value.
        'total_xp_per_step': total_xp_per_step,
        # Informational Termite Terminate -> Carpentry stream (or None). Present
        # so the frontend can label the Carpentry row as a pet-derived stream.
        'termite_carpentry': _termite_carpentry,
        'bonus_xp_percent': bonus_xp_pct,
        'bonus_xp_add': bonus_xp_add,
    }

    # Extract the primary metric for this category. For XP jobs that
    # surface under a non-primary skill section (e.g. Gold panning's
    # primary is Mining but it ALSO gives Fishing XP, so it appears in
    # the Fishing section too via ACTIVITIES_BY_SKILL keying off
    # skill_requirements), the metric_value should reflect the SECTION's
    # skill — not the activity's primary skill. Otherwise the user sees
    # Mining XP/step in the Fishing section, which is misleading and
    # makes ranking-within-Fishing wrong.
    if job.category == 'xp':
        section_skill = job.skill_name
        # Prefer the per-skill XP/step for the section's skill.
        if section_skill and section_skill in xp_per_step_by_skill:
            metric_value = xp_per_step_by_skill[section_skill]
        elif section_skill and section_skill.lower() == 'carpentry':
            # Termite-injected Carpentry section but no Carpentry XP was computed
            # for this gearset (e.g. the ability didn't apply / no logs yield) ->
            # 0, never the activity's PRIMARY (Woodcutting) XP.
            metric_value = 0.0
        else:
            metric_value = primary_xp_per_step
        metric_name = 'XP/step'
    elif job.category == 'coins':
        # 2026-05-21: read the coin-specific composite key. The optimizer
        # scored using TARGET_ITEM='cat:coins' (see above) which writes
        # `steps_per_reward_roll::cat:coins` = steps per coin. Convert
        # to coins per 1000 steps for display (matches the JS label
        # 'Coins/1k steps' and the CategoryMetricLabels mapping).
        spc = final_metrics.get('steps_per_reward_roll::cat:coins')
        if spc and spc > 0 and spc != float('inf'):
            metric_value = 1000.0 / spc
        else:
            metric_value = 0.0
        metric_name = 'Coins/1k steps'
    elif job.category == 'target_items':
        # 2026-08-12 (jwbail): gear-aware metric from final_metrics (matches the
        # column-3 drops table once the optimized gearset is equipped). The
        # optimizer scored with TARGET_ITEM=extras['target_ref'] (the item name,
        # or cat:sea_shells / cat:if:adventurers_guild_tokens for currency), so
        # final_metrics carries steps_per_reward_roll::<target_ref>.
        _tr = (job.extras or {}).get('target_ref') or job.precomputed_metric_name or ''
        _spr = final_metrics.get(f'steps_per_reward_roll::{_tr}')
        _is_currency = bool(job.extras and (job.extras.get('metric_kind') == 'per_1k'
                                            or job.extras.get('group_kind') == 'currency'))
        if _is_currency:
            # value-weighted units per 1000 steps (higher = better). cat:sea_shells
            # / cat:if:adventurers_guild_tokens already fold in the fine ×10 sell
            # multiplier via util/shell_value.py / util/ag_token_value.py.
            if _spr and _spr > 0 and _spr != float('inf'):
                metric_value = 1000.0 / _spr
            else:
                metric_value = job.precomputed_metric or 0.0
            metric_name = '/1k steps'
        else:
            metric_value = (_spr if (_spr is not None and _spr > 0 and _spr != float('inf'))
                            else job.precomputed_metric)
            metric_name = 'Steps/item'
    elif job.category in ('chests', 'chests_recipes'):
        # 2026-05-21: read the chest-specific composite key. The
        # bare 'steps_per_reward_roll' is the activity's first
        # headline target (often raw_rewards / cat:chests etc.) —
        # showing that for an Agility chest under Firewood making
        # gave 15 steps when the actual Agility-chest rate is
        # ~2500. The optimizer already evaluates per-target via
        # _effective_targets_for_scoring (TARGET_ITEM was set above)
        # and writes "steps_per_reward_roll::<chest_name>" to the
        # metrics dict. Read that explicitly.
        target_name = job.chest_name or ''
        composite_key = f'steps_per_reward_roll::{target_name}'
        metric_value = final_metrics.get(composite_key)
        if metric_value is None or not (metric_value > 0):
            metric_value = final_metrics.get('steps_per_reward_roll', activity.base_steps)
        metric_name = f'Steps/chest ({target_name or "chest"})'

        # 2026-06-03 (jwbail): build the per-chest map for the "Total
        # steps/all chests" line on the row. User direction: when an
        # activity drops 2+ chest types (e.g. via treasure_grabber gear
        # adding Treasure chest drops on top of the activity's native
        # chest), show an aggregated steps/any-chest value with an (i)
        # popover that lists each chest's contribution — same shape as
        # the multi-skill XP "Total" line.
        #
        # The optimizer's TARGET_ITEM was set to job.chest_name above so
        # final_metrics has steps_per_reward_roll::<that_chest>. For OTHER
        # chest types the same gearset drops, _effective_targets_for_scoring
        # ALSO emits steps_per_reward_roll::<each_target> under the same
        # gear evaluation — so we can pull them all from final_metrics
        # without re-running the optimizer. Iterate all chest-type drops
        # on the activity (Container.* ref or 'chest' in name) and read
        # the composite key for each.
        chests_per_chest: Dict[str, float] = {}
        try:
            all_drops = list(getattr(activity, 'drop_table', None) or []) + \
                        list(getattr(activity, 'secondary_drop_table', None) or [])
            for drop in all_drops:
                cname = getattr(drop, 'item_name', '') or ''
                cref = getattr(drop, 'item_ref', '') or ''
                if not (cref.startswith('Container.') or 'chest' in cname.lower()):
                    continue
                spc = final_metrics.get(f'steps_per_reward_roll::{cname}')
                if spc is None or not isinstance(spc, (int, float)) or spc <= 0:
                    continue
                if spc == float('inf'):
                    continue
                chests_per_chest[cname] = float(spc)
        except Exception:
            chests_per_chest = {}
        # Harmonic aggregate: 1 / Σ(1/spc). Same arithmetic the user
        # cares about — "if I farm this activity, on average how many
        # steps do I take per chest of ANY type drop". A chest with
        # 1500 steps + a chest with 3000 steps gives 1000 steps/any.
        steps_per_any_chest = None
        if chests_per_chest:
            inv_sum = sum(1.0 / v for v in chests_per_chest.values() if v > 0)
            if inv_sum > 0:
                steps_per_any_chest = 1.0 / inv_sum
        metrics_breakdown['chests_per_chest'] = chests_per_chest
        metrics_breakdown['steps_per_any_chest'] = steps_per_any_chest
    elif job.category == 'new_items':
        # 2026-05-24 fix (jwbail): same trick as chests — the optimizer
        # was told to target the best-drop item_name above, so the
        # gear-aware "steps_per_reward_roll::<item_name>" key is in
        # final_metrics. Reading it makes the report value match
        # column-3 drops once the user equips the optimized gearset.
        # Falls back to the builder's no-gear precomputed_metric if
        # the composite key is missing for any reason (defensive).
        #
        # 2026-05-25 fix: use the per-name composite key for ALL kinds
        # including collectibles. The previous 'collectible' synthetic
        # used a default 1% base rate which produced wildly wrong
        # metrics (1,179 vs 30-39k actual). Reading the per-name key
        # gives the find_collectibles-aware steps already baked in by
        # activity.get_expected_drop_rate.
        best_drop_meta = (job.extras or {}).get('best_drop') or {}
        best_drop_name = best_drop_meta.get('item_name') or ''
        composite_key = f'steps_per_reward_roll::{best_drop_name}'
        metric_value = final_metrics.get(composite_key)
        gear_best = metric_value if (metric_value is not None and metric_value > 0
                                     and metric_value != float('inf')) else None
        combined_meta = (job.extras or {}).get('combined') or {}
        # 2026-07-19 (bug 276fbd0a + follow-up): the composite key is the
        # gear-aware value for the single fastest drop. Convert to COMBINED
        # "any new <kind>" odds, and build the gear-aware per-item breakdown
        # for the expandable list. Both use gear_scale = gear_best/best_steps
        # (no-gear); steps_per_reward and the uniform find_collectibles
        # multiplier cancel, so the scale is a single per-activity factor.
        if combined_meta and combined_meta.get('best_steps'):
            base_best = combined_meta['best_steps']  # no-gear steps to fastest
            gear_scale = (gear_best / base_best) if (gear_best and base_best) else 1.0
            combined_nogear = combined_meta.get('combined_steps') or job.precomputed_metric or 0.0
            metric_value = combined_nogear * gear_scale
            scaled_items = [
                {'item_name': it.get('item_name'),
                 'item_ref': it.get('item_ref'),
                 'steps': (it.get('steps') or 0.0) * gear_scale}
                for it in combined_meta.get('items', [])
            ]
            metrics_breakdown['new_items_combined'] = {
                'kind': combined_meta.get('kind'),
                'count': combined_meta.get('count', len(scaled_items)),
                'items': scaled_items,
            }
        elif gear_best is not None:
            metric_value = gear_best
        else:
            # No usable gear-aware value and no combined meta — fall back to
            # the builder's no-gear precomputed_metric.
            metric_value = job.precomputed_metric
        metric_name = best_drop_name or (job.precomputed_metric_name or 'Steps/item')
    else:
        metric_value = final_metrics.get('steps_per_reward_roll', activity.base_steps)
        metric_name = 'Steps/reward'

    # Persist optimizer's chosen pet/consumable so the frontend Equip path
    # can apply them via loadGearSetFromExport's extraSlots overlay. Without
    # this, encode_gearset only carries gear slots and the equipped XP
    # silently drops by the pet-bonus % (bog_fishing_net 3.20 → 3.039 case).
    sel_pet, sel_cons = _extract_pet_consumable_meta(final_gearset)
    if sel_pet:
        metrics_breakdown['optimized_pet'] = sel_pet
    if sel_cons:
        metrics_breakdown['optimized_consumable'] = sel_cons

    # Persist auto-picked input item (e.g. arrows for hunting). The optimizer
    # used this in its score; the frontend may want to surface it so the
    # user knows which input item the report assumed.
    auto_input = optimize_activity_gearsets.INPUT_ITEM
    if auto_input is not None:
        try:
            metrics_breakdown['optimized_input'] = {
                'name': getattr(auto_input, 'name', '') or '',
                'itemId': (
                    getattr(auto_input, 'export_name', None)
                    or (getattr(auto_input, 'name', '') or '').lower()
                       .replace(' ', '_').replace("'", '')
                       .replace('(', '').replace(')', '')
                ),
                'rarity': getattr(auto_input, 'rarity', 'common') or 'common',
                'keywords': list(getattr(auto_input, 'keywords', []) or []),
                'is_fine': '(Fine)' in (getattr(auto_input, 'name', '') or ''),
                'type': 'input',
            }
        except Exception:
            pass
    elif _missing_input is not None:
        # Activity declares an input_items requirement but user owns
        # nothing matching the keyword. Surface this so the frontend
        # can render a warning ("Requires Hunting net (input)") on
        # the row — the metric value is still calculated but assumes
        # the user can perform the activity, which they currently
        # can't. User-reported 2026-05-25: drift net hunting suggested
        # for dolphin egg without indicating the hunting net dependency.
        metrics_breakdown['missing_input'] = _missing_input

    # Include-unavailable reasons: merge the per-dimension unmet markers the
    # job builder attached (missing_level / missing_location / missing_gear
    # (+gear_gated) / missing_tool / missing_other) into metrics_breakdown so
    # the frontend can render the warning badges and partition gear_gated rows
    # into the bottom "Possible with more gear" section. gear_gated lands as a
    # top-level key by design.
    _unmet = (job.extras or {}).get('unmet') if isinstance(getattr(job, 'extras', None), dict) else None
    if isinstance(_unmet, dict):
        for _k, _v in _unmet.items():
            metrics_breakdown[_k] = _v

    # 2026-06-05 (jwbail): stash the worker-computed slot alternatives so
    # the frontend can render them directly (correct-axis, no on-demand
    # re-scoring). Keys mirror the column-2 _alternatives convention.
    if _slot_alts:
        metrics_breakdown['_slot_alternatives'] = _slot_alts
    if _slot_locked:
        metrics_breakdown['_slot_locked_alternatives'] = _slot_locked
    if _slot_hidden:
        metrics_breakdown['_slot_hidden_alternatives'] = _slot_hidden

    return {
        'metric_value': metric_value,
        'metric_name': metric_name,
        'gearset_export': export_string,
        'metrics_json': metrics_breakdown,
    }


# ============================================================================
# RECIPE OPTIMIZER (for chests_recipes category)
# ============================================================================

def _resolve_service_for_recipe(recipe, character):
    """Find an unlocked service that can perform the recipe.

    Mirrors ui/optimize_worker.py's auto-pick logic: iterate
    SERVICES_BY_NAME and return the first service that's both
    valid_for_recipe and is_unlocked for the character. Returns None for
    recipes that don't need a service (recipe.service is empty/None) and
    for recipes whose service can't be found in the catalog.
    """
    services = _resolve_services_for_recipe(recipe, character)
    return services[0] if services else None


def _resolve_services_for_recipe(recipe, character):
    """Return ALL valid+unlocked services that can perform the recipe.

    2026-06-02 (jwbail): added so the recipe optimizer can iterate
    service candidates and pick the one with the best score, instead of
    locking in alphabetically-first match. User-reported example:
    Fletch copper arrows showed 2,375 steps at Basic Sawmill (Everhaven)
    but the user has Saw-in-Half Mill unlocked which gives 2,210
    steps — the location-scoped gear bonuses at Halfling Campgrounds
    beat the basic-tier service at Everhaven for that recipe. Returning
    a list lets run_recipe_optimizer_for_job iterate candidates same way
    it iterates locations for serviceless recipes.

    Treats string 'None'/'NONE'/'' as no service required, matching
    _recipe_has_unlocked_service. Returns empty list in that case so
    the caller falls into the no-service location-iteration branch.
    """
    try:
        from util.autogenerated.services import SERVICES_BY_NAME
    except ImportError:
        return []
    svc = getattr(recipe, 'service', None)
    if not svc or svc in ('None', 'NONE', ''):
        return []
    matches = []
    for s in SERVICES_BY_NAME.values():
        try:
            if (s.is_valid_for_recipe(recipe)
                    and s.is_unlocked(character)
                    and _service_location_accessible(s)):
                matches.append(s)
        except Exception:
            continue
    return matches


class _RecipeExactAdapter:
    """Presents a crafting recipe as an 'activity' so the exact target-rate
    optimizer can maximize chest-drops-per-craft-step. The exact greedy metric
    is steps_per_chest = expected_steps_per_item / (0.004 * (1 + chest_finding))
    (base_chest_rate=0.004 flat; DR already baked into expected_steps_per_item,
    so it appears exactly once). Reuses calculate_crafting_metrics so the exact
    numbers match the greedy displayed value by construction (validated). Service
    buffs are injected via the optimizer's base_stats; gear is scoped at the
    service's location (passed as `location`)."""
    _BASE_CHEST_RATE = 0.004

    def __init__(self, recipe, chest_name, skill, location):
        self.recipe = recipe
        self.chest_name = chest_name
        self.name = getattr(recipe, 'name', 'recipe')
        self.primary_skill = skill
        self.base_xp = float(getattr(recipe, 'base_xp', 0.0) or 0.0)
        self.base_steps = int(getattr(recipe, 'base_steps', 1) or 1)
        self.max_efficiency = float(getattr(recipe, 'max_efficiency', 0.0) or 0.0)
        self.skill_requirements = {}
        self.requirements = getattr(recipe, 'requirements', {}) or {}
        self.input_items = getattr(recipe, 'input_items', []) or []
        self.locations = [location] if location is not None else []
        # Crafting step floor is 10 — the SAME as activities (game rule: no
        # action costs fewer than 10 steps). Tells the exact engine to use
        # max(ceil(...), 10), matching calculate_crafting_metrics so the linear
        # proxy the engine optimizes stays consistent with the real crafting
        # metric (bug c61d7623: was 1, which over-credited step-reduction gear).
        self.step_floor = 10

    def get_expected_drop_rate(self, stats, location=None, target_item=None,
                               verbose=False, character=None, consumable=None,
                               input_item=None, include_collectibles_from_character=True):
        from util.activity_metrics import calculate_crafting_metrics
        try:
            m = calculate_crafting_metrics(
                base_steps=self.base_steps, base_xp=self.base_xp,
                max_efficiency=self.max_efficiency, total_stats=dict(stats or {}))
            espi = m.get('expected_steps_per_item') or self.base_steps
        except Exception:
            espi = self.base_steps
        cf = (stats or {}).get('chest_finding', 0.0)
        denom = self._BASE_CHEST_RATE * (1.0 + cf)
        spc = (espi / denom) if denom > 0 else float('inf')
        return {self.chest_name: spc}


def _exact_recipe_chest_solve(recipe, service, character, chest_name, location):
    """Exact gearset for a (recipe, service/location) chest solve. Returns a
    {slot: Item} gearset or None to fall back to greedy."""
    from util.exact_target_rate_optimizer import exact_target_rate_optimize as _EX
    import optimize_craft_gearsets as _ocg
    skill = _ocg._stat_scope_skill(recipe)
    base_stats = {}
    if service is not None:
        try:
            base_stats = dict(service.get_stats_for_skill(
                skill=skill, location=location, character=character))
        except Exception:
            base_stats = {}
    adapter = _RecipeExactAdapter(recipe, chest_name, skill, location)
    # Feed the engine the CRAFTING innate work-efficiency (skill-level bonus +
    # collectibles), which differs from the engine's default ACTIVITY level-WE
    # rule. Matches calculate_craft_metrics' aggregate_gearset_stats(items=[])
    # work_efficiency; service WE stays in base_stats (added as gear-side stats),
    # so this covers only the non-gear, non-service innate. Without this the
    # engine over-credits innate WE and picks DA-heavy gearsets the real metric
    # rates worse (Carpentry L62: engine 0.25 vs real 0.125). (Thread 2026-07-27.)
    try:
        from util.gearset_utils import aggregate_gearset_stats as _ags
        _innate = _ags(items=[], skill=skill, location=location, character=character,
                       include_level_bonus=True, include_collectibles=True,
                       activity_level=getattr(recipe, 'level', None))
        adapter.we_level_override = float((_innate or {}).get('work_efficiency', 0.0) or 0.0)
    except Exception:
        adapter.we_level_override = None
    # Feed the SERVICE's keyword requirements (e.g. underwater loom needs
    # {'diving gear': 3}) into the exact engine as hard constraints. The recipe's
    # own `requirements` do NOT include the service's, so without this the engine
    # can drop the required gear (e.g. the diving set) for higher-stat gear and
    # return an INVALID gearset that can't be crafted at that service (bug:
    # Tailor a kelp diving mask @ underwater loom returned proper-gear, 0 diving).
    try:
        _svc_kc = (getattr(service, 'requirements', None) or {}).get('keyword_counts', {}) or {}
        if _svc_kc:
            _merged = dict(adapter.requirements or {})
            _kc = dict(_merged.get('keyword_counts', {}) or {})
            for _k, _v in _svc_kc.items():
                _kc[str(_k)] = max(int(_kc.get(str(_k), 0) or 0), int(_v or 0))
            _merged['keyword_counts'] = _kc
            adapter.requirements = _merged
    except Exception:
        pass
    # Pets / consumables: run_recipe_optimizer_for_job stashed the (skill-
    # filtered) pools on optimize_craft_gearsets before the solve loop. Pass
    # them into the exact optimizer so recipe chest gearsets can include a pet /
    # consumable -- they were silently ignored before (not applied AND not shown
    # on the row). None keeps the gear-only behavior.
    _pets = list(getattr(_ocg, 'PET_ITEMS', None) or []) if getattr(_ocg, 'INCLUDE_PETS', False) else None
    _cons = list(getattr(_ocg, 'CONSUMABLE_ITEMS', None) or []) if getattr(_ocg, 'INCLUDE_CONSUMABLES', False) else None
    # Reuse the tool/gear/ring frontiers across recipes sharing this (character,
    # skill, location, reqs, pools) — the frontiers are pool-only, so building
    # them once per skill+location and reusing them for every recipe of that
    # skill is the ~4-5x win for tool-heavy skills (Trinketry/Cooking/Smithing).
    # Run-scoped (cleared per run) so character identity never collides.
    return _EX(adapter, character, chest_name, skill=skill, location=location,
               base_stats=base_stats or None, pets=_pets, consumables=_cons,
               frontier_cache=_RECIPE_FRONTIER_CACHE)


def _recipe_solve(recipe, service, character, chest_name):
    """Exact-first recipe-chest solve, falling back to greedy optimize_for_service.
    Returns (gearset, metrics, iters) in the SAME shape as optimize_for_service,
    so all downstream service/location grouping + metrics_json are unchanged.
    Gated on the exact-optimizer FAC (_EXACT_XP_MODE); the greedy path is the
    exact fallback and the non-FAC default."""
    import optimize_craft_gearsets as _ocg
    _loc = service.location if service else getattr(_ocg, 'SELECTED_LOCATION', None)

    def _spc(_metrics):
        """Real displayed steps/chest for this recipe/chest target (lower is
        better). Reads the composite target key the UI displays, falling back to
        the bare key. Missing/zero -> +inf so it never wins a comparison."""
        if not _metrics:
            return float('inf')
        v = _metrics.get('steps_per_chest_recipe::cat:chests')
        if v is None or not (v > 0):
            v = _metrics.get('steps_per_chest_recipe')
        return v if (v and v > 0) else float('inf')

    if globals().get('_EXACT_XP_MODE', False) and chest_name:
        try:
            _gear = _exact_recipe_chest_solve(recipe, service, character, chest_name, _loc)
            if _gear:
                # The exact engine (with W-cap fix and step_floor) returns a
                # near-optimal gearset. Run a COMPLETE real-metric local search
                # over ALL slots to convergence, using calculate_craft_metrics as
                # the objective. This guarantees the returned gearset is a local
                # optimum of the real metric — it can only improve, never regress.
                _gear = _refine_recipe_gearset(_gear, recipe, service, character)
                _m, _ = _ocg.calculate_craft_metrics(
                    _gear, recipe, service, character, 'Normal', 1)
                return _gear, _m, 0
        except Exception as _e:
            print(f"[recipe-exact] {getattr(recipe, 'name', '?')} exact failed, "
                  f"greedy fallback: {type(_e).__name__}: {_e}", flush=True)
    return _ocg.optimize_for_service(recipe, service, character)



def _refine_recipe_gearset(gearset, recipe, service, character):
    """Complete real-metric local search over ALL gear+tool slots, seeded from
    the exact engine output. Uses calculate_craft_metrics as the objective with
    FULL validation (keyword uniqueness, uuid uniqueness, service/diving-gear
    requirements). Converges to a local optimum of the real metric — can only
    improve, never regress. Replaces the old _refine_recipe_tools tool-only
    hill-climb. (Thread 2026-07-27.)"""
    import optimize_craft_gearsets as _ocg
    from util.optimization_utils import filter_items_by_quality, validate_tool_keywords
    from util.walkscape_constants import EXCLUDED_TOOL_KEYWORDS

    # Identify all mutable slots
    tool_slots = sorted([s for s in gearset if isinstance(s, str) and s.startswith('tool')])
    gear_slots = [s for s in ['head', 'cape', 'back', 'chest', 'hands', 'legs',
                              'feet', 'neck', 'ring1', 'ring2', 'pet', 'consumable']
                  if s in gearset]
    all_slots = gear_slots + tool_slots

    # Build candidate pools per slot type
    cand_by_slot = {}
    for it, qty in character.items.items():
        if not qty or not hasattr(it, 'get_stats_for_skill') or not hasattr(it, 'slot'):
            continue
        slot = getattr(it, 'slot', None)
        if slot is None:
            continue
        if hasattr(it, 'is_unlocked'):
            try:
                if not it.is_unlocked(character, ignore_gear_requirements=True):
                    continue
            except Exception:
                pass
        if slot == 'ring':
            cand_by_slot.setdefault('ring1', []).append(it)
            cand_by_slot.setdefault('ring2', []).append(it)
        elif slot == 'tools':
            for ts in tool_slots:
                cand_by_slot.setdefault(ts, []).append(it)
        else:
            cand_by_slot.setdefault(slot, []).append(it)

    # Quality-filter: keep best quality per base item
    for sl in list(cand_by_slot.keys()):
        try:
            cand_by_slot[sl] = filter_items_by_quality(cand_by_slot[sl], keep_highest_only=True)
        except Exception:
            pass

    def _spc(gd):
        m, _ = _ocg.calculate_craft_metrics(gd, recipe, service, character, 'Normal', 1)
        v = m.get('steps_per_chest_recipe::cat:chests')
        if v is None or not (v > 0):
            v = m.get('steps_per_chest_recipe')
        return v if (v and v > 0) else float('inf')

    def _tool_id(it):
        if it is None:
            return None
        base = getattr(it, 'uuid', None) or getattr(it, 'name', None) or id(it)
        return (base, getattr(it, 'name', None))

    def _item_id(it):
        if it is None:
            return None
        base = getattr(it, 'uuid', None) or getattr(it, 'name', None) or id(it)
        return (base, getattr(it, 'name', None))

    # Service/diving-gear validation: some services require specific gear
    # Service keyword requirements (e.g. underwater loom -> {'diving gear': 3}).
    # The refinement MUST keep these satisfied, or the best-improvement search
    # can swap the required gear (e.g. the diving set) out for higher-stat gear
    # and return an INVALID gearset. Stored as {keyword_lower: min_count}.
    _svc_kw_reqs = {}
    if service is not None:
        _reqs = getattr(service, 'requirements', None) or {}
        for _kw, _cnt in (_reqs.get('keyword_counts', {}) or {}).items():
            try:
                _c = int(_cnt or 0)
                if _c > 0:
                    _svc_kw_reqs[str(_kw).lower()] = _c
            except Exception:
                pass

    def _is_valid(gd):
        # Tool keyword uniqueness
        tools = [gd.get(s) for s in tool_slots]
        if not validate_tool_keywords(tools, EXCLUDED_TOOL_KEYWORDS):
            return False
        # UUID uniqueness for non-ring slots (tools can't duplicate)
        seen_tools = set()
        for s in tool_slots:
            it = gd.get(s)
            if it is not None:
                tid = _tool_id(it)
                if tid in seen_tools:
                    return False
                seen_tools.add(tid)
        # Ring uuid check: same ring can't exceed owned qty
        r1 = gd.get('ring1')
        r2 = gd.get('ring2')
        if r1 is not None and r2 is not None:
            if _item_id(r1) == _item_id(r2):
                # Check owned qty >= 2
                qty = 0
                for it, q in character.items.items():
                    if _item_id(it) == _item_id(r1):
                        qty = q
                        break
                if qty < 2:
                    return False
        # Enforce service keyword requirements (e.g. 3x diving gear at an
        # underwater loom). Count equipped items providing each required
        # keyword; reject if under. Consistent with the exact engine's reqs
        # constraint, so a valid engine seed passes and the search stays valid.
        if _svc_kw_reqs:
            for _rk, _rc in _svc_kw_reqs.items():
                _have = 0
                for _it in gd.values():
                    if _it is not None and hasattr(_it, 'keywords'):
                        if any(_rk == str(_x).lower() for _x in (_it.keywords or [])):
                            _have += 1
                if _have < _rc:
                    return False
        return True

    cur = dict(gearset)
    cur_spc = _spc(cur)

    # BEST-IMPROVEMENT hill-climb: each pass, evaluate every candidate swap
    # across ALL slots with the real metric and apply only the SINGLE globally
    # best one, then repeat. This escapes the order-dependent trap of a
    # first-improvement-per-slot climb: from the engine seed (e.g. Upcycle trash
    # circlet+pocketwatch) a per-slot climb greedily swaps the head first, which
    # then makes the pocketwatch->screwdriver swap look worse and stalls at a
    # suboptimal gearset; best-improvement takes the larger pocketwatch->
    # screwdriver swap first and lands in the correct basin (1908->1737 vs the
    # per-slot climb's 1809). Only one swap per pass, so allow more passes.
    # (Thread 2026-07-27.)
    for _pass in range(60):
        best_spc = cur_spc
        best_slot = None
        best_item = None  # an Item, or 'EMPTY' sentinel
        for slot in all_slots:
            for cand in cand_by_slot.get(slot, []):
                if cur.get(slot) is cand:
                    continue
                test = dict(cur)
                test[slot] = cand
                if not _is_valid(test):
                    continue
                sp = _spc(test)
                if sp < best_spc - 1e-9:
                    best_spc = sp
                    best_slot = slot
                    best_item = cand
            # Also try emptying the slot
            if cur.get(slot) is not None:
                test = dict(cur)
                test[slot] = None
                if _is_valid(test):
                    sp = _spc(test)
                    if sp < best_spc - 1e-9:
                        best_spc = sp
                        best_slot = slot
                        best_item = 'EMPTY'
        if best_slot is None:
            break  # converged: no single swap improves the real metric
        cur[best_slot] = None if best_item == 'EMPTY' else best_item
        cur_spc = best_spc

    # Fill any slot the refinement left EMPTY with a metric-neutral utility
    # item (inventory space, keyword/find bonuses, etc.) via the shared
    # dumb-upgrade pass. It rejects any candidate that lowers a stat
    # (sign-aware), so it is never-worse on the real metric by construction,
    # and it skips the pet/consumable slots. The exact+refine path otherwise
    # leaves empties the greedy calculator would have filled. (Thread 2026-07-29.)
    try:
        from util.dumb_upgrade_pass import apply_dumb_stat_upgrade
        import optimize_craft_gearsets as _ocg_du
        _du_loc = (getattr(service, 'location', None) if service is not None
                   else getattr(_ocg_du, 'SELECTED_LOCATION', None))
        _du_req_kw = set()
        _du_req_names = set()
        if service is not None and hasattr(service, 'requirements'):
            _svc_req = getattr(service, 'requirements', None) or {}
            _du_req_kw = set((_svc_req.get('keyword_counts', {}) or {}).keys())
            _du_req_names = {n.lower() for n in (_svc_req.get('item_requirements', []) or [])
                             if isinstance(n, str)}
        cur = apply_dumb_stat_upgrade(
            cur, character,
            skill=_ocg_du._stat_scope_skill(recipe),
            location=_du_loc,
            include_nmc=True,
            required_keywords=_du_req_kw,
            required_item_names=_du_req_names,
            pet_candidates=(list(getattr(_ocg_du, 'PET_ITEMS', None) or [])
                            if getattr(_ocg_du, 'INCLUDE_PETS', False) else None),
            allow_occupied_tier3_swap=True,
            verbose=False)
    except Exception as _du_exc:
        print(f"[recipe-dumb-fill] skipped: {_du_exc!r}", flush=True)
    return cur


# Region display names + icons for SERVICE-LESS recipes (craftable in any
# accessible region). Mirrors ui/app.py REGION_CONFIG; replicated here because
# the browser (Pyodide) worker cannot import ui.app. If regions change, update
# both (small, static config).
_RECIPE_REGION_CONFIG = {
    'gdte': {'name': 'Grand Duchy of Trellin-Erdwise', 'icon': '/assets/icons/regions/gdte.svg'},
    'jarvonia': {'name': 'Jarvonia', 'icon': '/assets/icons/regions/jarvonia.svg'},
    'syrenthia': {'name': 'Syrenthia', 'icon': '/assets/icons/regions/syrenthia.svg'},
    'wallisia': {'name': 'Wallisia', 'icon': '/assets/icons/regions/wallisia.svg'},
    'wrentmark': {'name': 'Wrentmark', 'icon': '/assets/icons/regions/wrentmark.svg'},
}


def _recipe_region_of(loc):
    """First accessible (unlocked) region tag of a location, for service-less
    recipe region display. Falls back to the first listed region."""
    if loc is None:
        return None
    regs = getattr(loc, 'regions', None) or []
    ur = globals().get('_UNLOCKED_REGIONS')
    for r in regs:
        if not ur or str(r).lower() in {str(x).lower() for x in ur}:
            return str(r).lower()
    return str(regs[0]).lower() if regs else None


def _recipe_region_display(region_tag):
    cfg = _RECIPE_REGION_CONFIG.get((region_tag or '').lower())
    return cfg['name'] if cfg else (region_tag or '').replace('_', ' ').title()


def _recipe_region_icon(region_tag):
    cfg = _RECIPE_REGION_CONFIG.get((region_tag or '').lower())
    return cfg['icon'] if cfg else None


def _recipe_service_stats_payload(svc):
    """Full nested service stats + gated stats for the row's service (i) popover.

    Matches the /api/services payload shape the column-3 service popover
    consumes ({stats:{skill:{loc:{stat:val}}}, gated_stats:{reputation,
    skill_level}}), so the stats-report (i) renders identically via the shared
    service-stats-popover.js module. Previously the row only carried an intrinsic
    *diff* (service_extras / alt 'extras'), which is why the (i) showed partial,
    mis-formatted stats. Returns None when the service has no stats to show.
    """
    if svc is None:
        return None
    try:
        _st = getattr(svc, '_stats', None)
        if _st is None:
            _st = getattr(svc, 'stats', None) or {}
        _gt = getattr(svc, 'gated_stats', None) or {}
        if not _st and not _gt:
            return None
        return {'stats': _st, 'gated_stats': _gt}
    except Exception:
        return None


def _alt_service_icon(svc):
    """Service icon path for a recipe service alt (e.g. Tidal Workshop), so the
    alt row renders the service icon like the primary row rather than a location
    icon derived from the location name. Returns '' on any failure."""
    if svc is None:
        return ''
    try:
        from ui.crafting_tree import _get_service_icon_path
        return _get_service_icon_path(svc) or ''
    except Exception:
        return ''


def _recipe_service_loc_id(svc):
    """Location id (lowercased tag) of a service, for popover condition
    suppression (matches the location keys inside the service stat blocks)."""
    if svc is None:
        return ''
    _l = getattr(svc, 'location', None)
    if isinstance(_l, str):
        return _l.lower()
    return (getattr(_l, 'id', '') or '').lower()


def run_recipe_optimizer_for_job(job: ReportJob, character,
                                  pet_items_pool=None, consumable_items_pool=None,
                                  hidden_items=None):
    """Run the recipe optimizer (optimize_craft_gearsets) for a chests_recipes job.

    Mirrors run_optimizer_for_job's structure but uses the crafting
    optimizer instead of the activity optimizer. Scores by
    `steps_per_chest_recipe::cat:chests` so the optimizer picks gear
    that minimizes steps to produce one chest of the target type.

    Returns the same result dict shape as run_optimizer_for_job:
    {metric_value, metric_name, gearset_export, metrics_json}.

    metrics_json is augmented with service info (service_id, service_name,
    service_location, service_icon) so the frontend can render the row
    with the recipe's service alongside it — recipe rows don't have an
    activity-style location, the service is the equivalent display piece.
    """
    import optimize_craft_gearsets
    from util.gearset_utils import encode_gearset
    from util.walkscape_constants import Sorting, SortingEntry
    from util.autogenerated.recipes import RECIPES_BY_NAME

    # 2026-05-25 (jwbail): re-apply character's thread-local globals — see
    # detailed note in run_optimizer_for_job. Same ThreadPoolExecutor +
    # threading.local() interaction affects recipe jobs too.
    _reapply_character_thread_local_globals(character)

    recipe_name = job.recipe_name or (getattr(job.activity, 'name', None) if job.activity else None)
    if not recipe_name:
        print(f'[stats_report_worker] ZERO-WRITE chests_recipes: job {job.job_id[:8] if job.job_id else "?"} '
              f'has no recipe_name (chest={job.chest_name!r}) — storing metric 0', flush=True)
        return {
            'metric_value': 0,
            'metric_name': f'Steps/chest ({job.chest_name or "?"})',
            'gearset_export': None,
            'metrics_json': None,
        }
    recipe = RECIPES_BY_NAME.get(recipe_name)
    if recipe is None:
        print(f'[stats_report_worker] ZERO-WRITE chests_recipes: recipe {recipe_name!r} '
              f'not in RECIPES_BY_NAME (chest={job.chest_name!r}) — storing metric 0', flush=True)
        return {
            'metric_value': 0,
            'metric_name': f'Steps/chest ({job.chest_name or "?"})',
            'gearset_export': None,
            'metrics_json': None,
        }

    service_candidates = _resolve_services_for_recipe(recipe, character)
    # Pick first as a default for the no-iteration fast path; the
    # branching below either uses this directly (single candidate) or
    # iterates over ALL candidates to find the lowest-score one.
    service = service_candidates[0] if service_candidates else None
    # Retain every candidate service's optimized result so we can, after
    # picking the best, group the services that yield the IDENTICAL optimal
    # gearset (the "Alternative Service Locations" naming) and flag any whose
    # only difference is an objective-irrelevant stat (e.g. +XP) with an (i).
    # Populated only in the multi-candidate branch below.
    _cand_records = []
    _loc_records = None  # service-less: per-region [(loc, gearset, score)] for grouping

    pet_pool = list(pet_items_pool or [])
    consumable_pool = list(consumable_items_pool or [])
    # Drop hidden consumables (pets are already filtered at pool build) unless
    # the user enabled "Use hidden consumables".
    if hidden_items and not globals().get('_USE_HIDDEN_CONSUMABLES', False):
        consumable_pool = [c for c in consumable_pool if c not in hidden_items]
    # Same lock the activity optimizer uses — both modules expose their
    # config as module globals, so the SAME thread-safety invariant
    # applies. Holding the lock across both kinds of optimizer calls
    # means at most one optimizer (activity OR craft) is running at a
    # time across all 4 worker threads. That's correct, and the perf
    # cost is small because CPython's GIL was already serializing the
    # pure-Python heavy lifting anyway.
    with _OPTIMIZER_LOCK:
        # Configure crafting optimizer
        optimize_craft_gearsets.RECIPE = recipe
        optimize_craft_gearsets.SERVICE = service
        # Chests don't have quality. Target 'Normal' is the safe default
        # that doesn't filter to a specific quality variant of a crafted
        # output. The chest drops are unaffected by TARGET_QUALITY.
        optimize_craft_gearsets.TARGET_QUALITY = 'Normal'
        optimize_craft_gearsets.TARGET_QUALITY_QUANTITY = 1
        optimize_craft_gearsets.VERBOSE = False
        optimize_craft_gearsets.IGNORED_ITEMS = _sr_effective_ignored(hidden_items)
        optimize_craft_gearsets.INCLUDE_CONSUMABLES = bool(consumable_pool)
        optimize_craft_gearsets.CONSUMABLE_ITEMS = consumable_pool
        optimize_craft_gearsets.INCLUDE_PETS = bool(pet_pool)
        optimize_craft_gearsets.PET_ITEMS = pet_pool
        optimize_craft_gearsets.LOCKED_SLOTS = {}
        optimize_craft_gearsets.BUDGET_MATERIALS = 0
        optimize_craft_gearsets.BUDGET_TARGET = 0
        # 2026-05-23 fast mode: skip local-search loop. See activity
        # optimizer for context.
        optimize_craft_gearsets.MAX_ITERATIONS = 0 if globals().get('_FAST_MODE', False) else 100
        optimize_craft_gearsets.CHILD_INPUT_SPECS = []
        optimize_craft_gearsets.INSTANT_ACTIONS = False
        optimize_craft_gearsets.FORCED_PET = None

        # Score by steps-per-chest with a duplicable target. The
        # composite metric key is `steps_per_chest_recipe::cat:chests`,
        # which is what we'll read after optimization.
        optimize_craft_gearsets.SORTING_PRIORITY = [
            SortingEntry(sort=Sorting.STEPS_PER_CHEST_RECIPE,
                         target='cat:chests', weight=100),
        ]
        optimize_craft_gearsets.SORTING_WEIGHTS = {
            Sorting.STEPS_PER_CHEST_RECIPE: 100,
        }

        try:
            if service is not None and len(service_candidates) > 1:
                # 2026-06-02 (jwbail): multiple unlocked services can
                # perform this recipe. Iterate them and pick the lowest
                # steps_per_chest_recipe — the previous "first match"
                # logic locked in alphabetical-first (e.g. Basic Sawmill
                # Everhaven for Carpentry recipes) even when the user
                # had Saw-in-Half Mill at Halfling Campgrounds with
                # better location-scoped gear bonuses (user-reported:
                # 2,375 vs 2,210 for Fletch copper arrows).
                best_score = None
                best_gearset = None
                best_metrics = None
                best_service = None
                # Dedup service candidates by SOLVE IDENTITY before solving.
                # Many candidates are the SAME service at different locations
                # (e.g. Kitchen at ~13 locations) that scope gear identically
                # (same region set) AND fold identical service base stats, so
                # they produce a bit-identical exact solve. Solving each was the
                # dominant recipe cost (profiled: Fry a carp = 13 solves but only
                # 3 distinct frontiers -> 18s). Group by (region-scope,
                # base_stats) and solve ONE representative per group; members
                # reuse its (gearset, score). The downstream (metric, gearset)
                # alt-location grouping then merges members into one "A or B or C"
                # entry exactly as before. Exact: identical (region-scope,
                # base_stats) => identical frontier => identical gearset + score.
                # Mirrors the activity multi-location _by_profile dedup.
                _skill_k = optimize_craft_gearsets._stat_scope_skill(recipe)
                _svc_groups = {}
                _svc_group_order = []
                for cand_svc in service_candidates:
                    _cloc = getattr(cand_svc, 'location', None)
                    if isinstance(_cloc, str):
                        _regk = frozenset([_cloc.lower()])
                    else:
                        _regk = frozenset(str(r).lower() for r in (getattr(_cloc, 'regions', None) or []))
                    try:
                        _bs = cand_svc.get_stats_for_skill(skill=_skill_k, location=_cloc, character=character)
                        _bsk = tuple(sorted((str(k), round(float(v), 6)) for k, v in (_bs or {}).items()))
                        _key = (_regk, _bsk)
                    except Exception:
                        # Can't prove identity -> unique key so it's solved on its own.
                        _key = (_regk, None, id(cand_svc))
                    if _key not in _svc_groups:
                        _svc_groups[_key] = []
                        _svc_group_order.append(_key)
                    _svc_groups[_key].append(cand_svc)
                for _key in _svc_group_order:
                    _members = _svc_groups[_key]
                    _rep = _members[0]
                    try:
                        cg, cm, _ = _recipe_solve(recipe, _rep, character, job.chest_name)
                    except Exception as _cand_e:
                        print(f'[stats_report_worker] recipe candidate failed {recipe_name} '
                              f'svc={getattr(_rep, "name", _rep)!r}: '
                              f'{type(_cand_e).__name__}: {_cand_e}', flush=True)
                        continue
                    cand_score = cm.get('steps_per_chest_recipe::cat:chests')
                    if cand_score is None or not (cand_score > 0):
                        cand_score = cm.get('steps_per_chest_recipe', float('inf'))
                    if cand_score is None or cand_score == 0:
                        cand_score = float('inf')
                    # Every member shares this identical solve — record all so the
                    # alt-location grouping surfaces each location.
                    for _msvc in _members:
                        _cand_records.append((_msvc, cg, cand_score))
                        if best_score is None or cand_score < best_score:
                            best_score = cand_score
                            best_gearset = cg
                            best_metrics = cm
                            best_service = _msvc
                if best_gearset is None:
                    raise RuntimeError(
                        f'no service candidate produced a result for {recipe_name}'
                    )
                gearset = best_gearset
                metrics = best_metrics
                service = best_service  # so service_icon/location pick this one
                chosen_loc_obj = None  # service supplies its own location
            elif service is not None:
                gearset, metrics, _iter = _recipe_solve(recipe, service, character, job.chest_name)
                chosen_loc_obj = None  # service supplies its own location
            else:
                # 2026-06-02 (jwbail): serviceless recipes don't have a
                # built-in location, so the crafting tree iterates
                # accessible regions and picks the one whose gear
                # bonuses give the best score. Mirror that here so the
                # row can display a real location (was just blank
                # before) and the metric reflects realistic gear stats.
                # Mirrors the no-service branch of
                # ui/optimize_worker.py around line 4090.
                from util.autogenerated.locations import Location, LocationInfo
                # Use the run-scoped unlocked-regions set populated by
                # run_worker() at start. _UNLOCKED_REGIONS is None when
                # the precompute failed — in that case we don't filter
                # and let every location candidate through.
                unlocked_regions = globals().get('_UNLOCKED_REGIONS') or set()
                locked_locations = globals().get('_LOCKED_LOCATIONS') or set()
                seen_regions = set()
                candidate_locations = [None]  # location-less baseline
                for attr_name in dir(Location):
                    if attr_name.startswith('_'):
                        continue
                    loc = getattr(Location, attr_name)
                    if not isinstance(loc, LocationInfo):
                        continue
                    # NOTE: do NOT blanket-skip underwater locations. Every
                    # Syrenthia crafting spot (Vastalume, Kelp Forest, Darktide
                    # Trench, Underwater Cave, …) is underwater, so skipping them
                    # meant Syrenthia could NEVER surface as a service-less recipe
                    # region — even though SERVICE recipes happily recommend
                    # underwater services (Tidal Workshop @ Vastalume). Region
                    # access is already gated by `unlocked_regions` below (the
                    # same check `_service_location_accessible` uses for the
                    # service path), so underwater regions the character hasn't
                    # unlocked are still excluded there. (Fix: thread 2026-07-27.)
                    if locked_locations and loc.name in locked_locations:
                        continue
                    loc_regions = getattr(loc, 'regions', []) or []
                    if unlocked_regions:
                        if loc_regions and not any(
                            r.lower() in {r2.lower() for r2 in unlocked_regions}
                            for r in loc_regions
                        ):
                            continue
                    region_key = None
                    for r in loc_regions:
                        rl = r.lower()
                        if not unlocked_regions or rl in {r2.lower() for r2 in unlocked_regions}:
                            region_key = rl
                            break
                    if region_key is None:
                        region_key = f'__loc__{loc.name}'
                    if region_key in seen_regions:
                        continue
                    seen_regions.add(region_key)
                    candidate_locations.append(loc)

                best_loc = None
                best_gearset = None
                best_metrics = None
                best_score = None
                _loc_records = []   # [(loc, gearset, score)] for per-region grouping
                for cand in candidate_locations:
                    optimize_craft_gearsets.SELECTED_LOCATION = cand
                    try:
                        cg, cm, _ci = _recipe_solve(recipe, None, character, job.chest_name)
                    except Exception as _loc_e:
                        print(f'[stats_report_worker] recipe candidate failed {recipe_name} '
                              f'loc={getattr(cand, "name", cand)!r}: '
                              f'{type(_loc_e).__name__}: {_loc_e}', flush=True)
                        continue
                    cand_score = cm.get('steps_per_chest_recipe::cat:chests')
                    if cand_score is None or not (cand_score > 0):
                        cand_score = cm.get('steps_per_chest_recipe', float('inf'))
                    if cand_score is None or cand_score == 0:
                        cand_score = float('inf')
                    _loc_records.append((cand, cg, cand_score))
                    if best_score is None or cand_score < best_score:
                        best_score = cand_score
                        best_loc = cand
                        best_gearset = cg
                        best_metrics = cm
                # Fallback: if the no-location baseline tied, prefer the
                # first real candidate so the row gets a visible location.
                if best_gearset is not None and best_loc is None:
                    first_real = next((c for c in candidate_locations if c is not None), None)
                    if first_real is not None:
                        optimize_craft_gearsets.SELECTED_LOCATION = first_real
                        try:
                            rerun = _recipe_solve(recipe, None, character, job.chest_name)
                            best_loc = first_real
                            best_gearset, best_metrics, _ = rerun
                        except Exception:
                            pass
                if best_gearset is None:
                    raise RuntimeError(
                        f'no candidate location produced a result for {recipe_name}'
                    )
                gearset = best_gearset
                metrics = best_metrics
                chosen_loc_obj = best_loc
                # Restore module global so subsequent jobs aren't affected.
                optimize_craft_gearsets.SELECTED_LOCATION = None
        except Exception as e:
            print(f'[stats_report_worker] recipe optimizer failed for {recipe_name}: {e}',
                  flush=True)
            return {
                'metric_value': 0,
                'metric_name': f'Steps/chest ({job.chest_name or "?"})',
                'gearset_export': None,
                'metrics_json': None,
            }

        # Pull the per-target steps value first; fall back to the bare
        # key if the target write didn't land for any reason.
        metric_value = metrics.get('steps_per_chest_recipe::cat:chests')
        if metric_value is None or not (metric_value > 0):
            metric_value = metrics.get('steps_per_chest_recipe', 0)
        # 2026-06-18 (jwbail): write-side diagnostic. A recipe job that
        # resolves to metric_value <= 0 stores a degenerate "0 Steps/chest"
        # row (the self-heal in _filter_jobs_to_stale_only will later force
        # it to recompute, but we want to catch WHY it happened the first
        # time). Log which metric keys were present and the upstream inputs
        # so we can tell apart: missing keys vs steps_per_craft==0 vs
        # chest_rate==0 vs the 999999 sentinel collapsing.
        if metric_value is None or metric_value <= 0:
            print(
                f'[stats_report_worker] ZERO-WRITE chests_recipes: {recipe_name!r} '
                f'resolved metric_value={metric_value!r}. '
                f"cat:chests={metrics.get('steps_per_chest_recipe::cat:chests')!r} "
                f"bare={metrics.get('steps_per_chest_recipe')!r} "
                f"expected_steps_per_item={metrics.get('expected_steps_per_item')!r} "
                f"materials_per_craft={metrics.get('materials_per_craft')!r} "
                f"chest_rate_with_bonus={metrics.get('chest_rate_with_bonus')!r} "
                f"service={getattr(service, 'name', None)!r} "
                f"metric_keys={sorted(k for k in metrics.keys() if 'steps_per_chest_recipe' in k)}",
                flush=True,
            )
        export_string = encode_gearset(gearset)

        # 2026-06-05 (jwbail): compute slot alternatives inside the lock,
        # in the exact environment that produced `gearset`/`metrics`, so
        # the frontend renders correct-axis alternatives instead of the
        # on-demand endpoint's mismatched reconstruction. Set
        # SELECTED_LOCATION to the chosen location (serviceless recipes
        # restored it to None above; the service case supplies its own).
        # 2026-07-08 (jwbail): slot alternatives are now computed ON-DEMAND by
        # the /api/stats-report/slot-alternatives endpoint. Dropped the in-lock
        # precompute (flat ~1.4s/row on the server; skipped on the local batch
        # anyway). Empty maps make the frontend fall through to the on-demand
        # endpoint when a slot picker is opened.
        _slot_alts, _slot_locked, _slot_hidden = ({}, {}, {})

    # ── outside the lock — pure local-data work ────────────────────────
    # Service info for frontend rendering. Recipe rows don't have an
    # activity location to display; the service slot fills that role.
    service_id = ''
    service_name = ''
    service_location = ''
    service_icon = ''
    if service is not None:
        try:
            service_name = getattr(service, 'name', '') or ''
            loc = getattr(service, 'location', None)
            if loc is not None:
                service_location = (
                    loc if isinstance(loc, str) else getattr(loc, 'name', '') or ''
                )
                # 2026-06-02 (jwbail): defer to crafting_tree's helper so
                # both code paths emit the same filenames. The previous
                # `tier`-only slug ('advanced_loom') 404'd for every
                # named service ('Cursed Loom', 'Heatstroke Metalworks',
                # etc.) — actual files are 'cursed_loom_(advanced).svg'.
                # Service icons live under /assets/icons/services/<slug>.svg.
                try:
                    from ui.crafting_tree import _get_service_icon_path as _svc_icon
                    service_icon = _svc_icon(service)
                except Exception:
                    service_icon = ''
            service_id = service_name.lower().replace(' ', '_').replace("'", '')
        except Exception:
            pass

    # 2026-06-02 (jwbail): pass recipe output info so the frontend can
    # render the row's main icon as the OUTPUT item (the thing being
    # crafted) instead of the chest container icon. e.g. "Cut a birch
    # plank" shows the birch-plank icon, "Make a basic hatchet" shows
    # the basic-hatchet icon. "Upcycle trash" → trash icon.
    output_item_ref = getattr(recipe, 'output_item', '') or ''
    output_item_name = ''
    try:
        out_obj = recipe.get_output_item_object()
        if out_obj is not None:
            output_item_name = getattr(out_obj, 'name', '') or ''
    except Exception:
        pass
    # Special case per user direction 2026-06-02: "Upcycle trash" outputs
    # Wood scrap, but the visually meaningful icon is the trash input
    # being upcycled. Use the input ref instead of the output for this
    # named recipe.
    if recipe_name == 'Upcycle trash':
        output_item_ref = 'Material.TRASH'
        output_item_name = 'Trash'

    # 2026-06-02 (jwbail): for serviceless recipes the location-iter loop
    # picked a best location — surface it via service_location so the
    # row gets a location pill. Frontend treats service_location as the
    # "where to perform" piece regardless of whether a service is set.
    if service is None and chosen_loc_obj is not None:
        service_location = getattr(chosen_loc_obj, 'name', '') or ''

    # ── Alternative Service Locations grouping (increment 2) ─────────────────
    # Group candidate services whose optimized gearset is IDENTICAL to the
    # chosen best (same encoded set = same solve) and list their locations
    # together; surface objective-irrelevant-stat services (e.g. a +XP bench for
    # a chest run) via (i), sorted first. Uses ONLY already-computed candidate
    # results — exact, no extra optimizer runs. Stored as NEW fields; existing
    # service_name/service_location rendering is unchanged (the alt-locations UI
    # increment consumes these).
    _service_grouped_name = service_name
    _service_alt_locations = []
    _service_extras = []
    _service_alternatives = []
    _service_type_groups = []   # per-service-type lines for the same-set group
    _region_lines = []          # per-region lines (display + icon) for service-less recipes
    if _cand_records and service is not None and export_string:
        try:
            from util.service_dedup import (
                service_intrinsic_stats, irrelevant_intrinsic, grouped_name)
            _skill_key = (getattr(recipe, 'skill', '') or '').lower()

            def _loc_name(s):
                _l = getattr(s, 'location', None)
                return _l if isinstance(_l, str) else (getattr(_l, 'name', '') or '')

            _primary_score = None
            for _svc, _cg, _sc in _cand_records:
                if _svc is service:
                    _primary_score = _sc
                    break

            def _score_close(a, b):
                if a is None or b is None:
                    return False
                return abs(a - b) <= max(0.5, abs(b) * 1e-4)

            _same = [service]  # chosen best is always in its own group
            for _svc, _cg, _sc in _cand_records:
                if _svc is service:
                    continue
                try:
                    # Fold a service into the primary group ONLY when it yields
                    # the SAME gearset AND the SAME metric. Services with the
                    # same gear but different intrinsic stats (e.g. a Cursed
                    # loom's -20% WE) score DIFFERENTLY, so they must not be
                    # merged into the primary "A or B" name showing the primary's
                    # (better) step count -- they surface as their own
                    # alternative with their own number below.
                    if (encode_gearset(_cg) == export_string
                            and _score_close(_sc, _primary_score)):
                        _same.append(_svc)
                except Exception:
                    continue
            _same_ids = {id(s) for s in _same}
            # irrelevant-stat services first (they carry the (i) tooltip)
            _same.sort(key=lambda s: (
                0 if irrelevant_intrinsic(service_intrinsic_stats(s, _skill_key)) else 1,
                _loc_name(s)))
            for s in _same:
                _ln = _loc_name(s)
                if _ln and _ln not in _service_alt_locations:
                    _service_alt_locations.append(_ln)
                _irr = irrelevant_intrinsic(service_intrinsic_stats(s, _skill_key))
                if _irr:
                    _service_extras.append(
                        {'name': getattr(s, 'name', ''), 'location': _ln, 'stats': _irr})
            if _service_alt_locations:
                _service_grouped_name = grouped_name(
                    getattr(service, 'name', service_name) or service_name,
                    _service_alt_locations)

            # Split the same-set group by SERVICE TYPE. The group can mix
            # service types that happen to yield the identical solve (e.g.
            # Alight Kitchen @ Azurazera + Basic Kitchen @ several locs), so
            # labeling every location with the primary service's name+icon was
            # wrong ("Alight Kitchen (Azurazera, Blackspell Harbour, ...)" where
            # only Azurazera is the Alight Kitchen). Emit one entry per distinct
            # service type — icon + name + its OWN locations — so the row can
            # render them on separate lines. (Thread 2026-07-29.)
            _type_map = {}
            for s in _same:
                _tn = getattr(s, 'name', '') or service_name
                _tl = _loc_name(s)
                _tg = _type_map.setdefault(_tn, {'name': _tn, 'rep': s, 'locs': []})
                if _tl and _tl not in _tg['locs']:
                    _tg['locs'].append(_tl)
            _primary_type = getattr(service, 'name', service_name) or service_name
            for _tn, _tg in _type_map.items():
                _service_type_groups.append({
                    'name': _tn,
                    'icon': _alt_service_icon(_tg['rep']),
                    'locations': _tg['locs'],
                    'grouped_name': grouped_name(_tn, _tg['locs']),
                    'location_id': _recipe_service_loc_id(_tg['rep']),
                    'service_stats': _recipe_service_stats_payload(_tg['rep']),
                })
            # Primary service type first, then alphabetical.
            _service_type_groups.sort(
                key=lambda g: (0 if g['name'] == _primary_type else 1, g['name']))

            # Different-set alternatives: candidate services whose optimized
            # gearset DIFFERS from the chosen best. Group by encoded gearset
            # (each distinct set = one alternative), grouped-name each, carry the
            # (i) extras, and sort best-first (fewer steps). Inline for the
            # alt-section UI. Uses only already-computed candidate results.
            _by_set = {}
            for _svc, _cg, _sc in _cand_records:
                if id(_svc) in _same_ids:
                    continue  # already folded into the primary group
                try:
                    _ex = encode_gearset(_cg)
                except Exception:
                    continue
                # Key on (metric, gearset): a same-gear/different-metric service
                # (different intrinsic stats) is its OWN alternative with its OWN
                # step count, never merged with a service that scores differently.
                _key = (round(_sc, 3) if isinstance(_sc, (int, float)) else None, _ex)
                _grp = _by_set.setdefault(_key, {'svcs': [], 'score': None, 'ex': _ex, 'cg': _cg})
                _grp['svcs'].append(_svc)
                if _sc is not None and (_grp['score'] is None or _sc < _grp['score']):
                    _grp['score'] = _sc
            for _key, _grp in _by_set.items():
                _svcs = _grp['svcs']
                _ex = _grp['ex']
                # Extract the alt's own chosen pet/consumable (not carried in the
                # encoded export) so the alt gear preview shows them in-slot — the
                # displayed metric already includes them (user report: "the number
                # is with the consumable, we just don't know what it is").
                _apet, _acons = _extract_pet_consumable_meta(_grp.get('cg'))
                # Split this same-gearset alt group by SERVICE TYPE. Different
                # service TYPES can share the identical gearset+metric (e.g.
                # Alight Kitchen @ Azurazera + Basic Kitchen @ many locations,
                # or Sawmill of Barbantok @ Barbantok + Basic Sawmill @
                # Kallaheim), but labeling them all with the first service's
                # name is wrong — only Azurazera is Alight Kitchen; Kallaheim is
                # a Basic Sawmill, not "Sawmill of Barbantok". Emit ONE alt entry
                # per distinct service type (icon + name + its OWN locations) so
                # each renders on its own line. (Thread 2026-07-30.)
                _alt_by_type = {}
                for s in _svcs:
                    _tn = getattr(s, 'name', '') or service_name
                    _t = _alt_by_type.setdefault(_tn, {'name': _tn, 'rep': s, 'locs': []})
                    _ln = _loc_name(s)
                    if _ln and _ln not in _t['locs']:
                        _t['locs'].append(_ln)
                # Primary/objective-irrelevant service type first, then alpha.
                _alt_types = sorted(
                    _alt_by_type.values(),
                    key=lambda t: (
                        0 if irrelevant_intrinsic(service_intrinsic_stats(t['rep'], _skill_key)) else 1,
                        t['name']))
                for _t in _alt_types:
                    _rep = _t['rep']
                    _tlocs = _t['locs']
                    _airr = irrelevant_intrinsic(service_intrinsic_stats(_rep, _skill_key))
                    _alt_extras = ([{'name': _t['name'],
                                     'location': (_tlocs[0] if _tlocs else ''),
                                     'stats': _airr}] if _airr else [])
                    _alt_entry = {
                        'grouped_name': grouped_name(_t['name'], _tlocs),
                        'locations': _tlocs,
                        'metric_value': _grp['score'],
                        'gearset_export': _ex,
                        'extras': _alt_extras,
                        # Full nested stats of this service type's representative,
                        # so the alt (i) matches column 3.
                        'service_stats': _recipe_service_stats_payload(_rep),
                        'location_id': _recipe_service_loc_id(_rep),
                        # The SERVICE icon for this alt (e.g. Basic Sawmill), so
                        # each service-type line shows its own icon.
                        'service_icon': _alt_service_icon(_rep),
                        # Raw service name + a concrete location so the alt Equip
                        # button can select the right service/location in column 3.
                        'service_name': _t['name'],
                        'service_location': (_tlocs[0] if _tlocs else ''),
                    }
                    if _apet:
                        _alt_entry['optimized_pet'] = _apet
                    if _acons:
                        _alt_entry['optimized_consumable'] = _acons
                    _service_alternatives.append(_alt_entry)
            _service_alternatives.sort(
                key=lambda a: (a['metric_value'] if a['metric_value'] is not None else float('inf')))
        except Exception:
            pass

    # ── Service-less recipes: group by ACCESSIBLE REGION (craftable anywhere) ──
    # Region-scoped gear can change the optimal set per region, so each candidate
    # region was solved above; group by (metric, gearset) -> primary region +
    # alternative regions, and surface the REGION (name + icon), not a location.
    # Mirrors the service grouping but keyed on regions.
    _is_region = False
    _region_icon = None
    _region_location_id = ''
    if service is None and _loc_records and export_string:
        try:
            _reg_groups = {}
            for _lc, _cg, _sc in _loc_records:
                _rt = _recipe_region_of(_lc)
                if not _rt:
                    continue
                try:
                    _rex = encode_gearset(_cg)
                except Exception:
                    continue
                _rkey = (round(_sc, 3) if isinstance(_sc, (int, float)) else None, _rex)
                _rg = _reg_groups.setdefault(_rkey, {'regions': [], 'score': _sc, 'ex': _rex, 'tag': _rt, 'region_tags': {}, 'loc_by_region': {}})
                _rd = _recipe_region_display(_rt)
                if _rd not in _rg['regions']:
                    _rg['regions'].append(_rd)
                _rg['region_tags'][_rd] = _rt
                # First concrete location id seen in this region — so alt region
                # equip can select a real location IN the region (the col-3
                # dropdown needs a location id, not the region name). (2026-07-31)
                _lc_id = (getattr(_lc, 'id', '') or '')
                if not _lc_id:
                    _lc_nm = (getattr(_lc, 'name', '') or (_lc if isinstance(_lc, str) else '') or '')
                    _lc_id = _lc_nm.replace(' ', '_').replace("'", '')
                if _lc_id:
                    _rg['loc_by_region'].setdefault(_rd, _lc_id.lower())
                if _sc is not None and (_rg['score'] is None or _sc < _rg['score']):
                    _rg['score'] = _sc
            _ordered = sorted(
                _reg_groups.values(),
                key=lambda g: (g['score'] if g['score'] is not None else float('inf')))
            if _ordered:
                _is_region = True
                _prim = _ordered[0]
                _prim_tag = _recipe_region_of(best_loc) if best_loc is not None else None
                # The optimizer's chosen best_loc lives in the primary region;
                # surface its id so Equip picks a concrete location in that region
                # (user: "equip for a non-service recipe should select the first
                # location in that region", not leave the location blank).
                if best_loc is not None:
                    _bl_id = (getattr(best_loc, 'id', '') or '')
                    if not _bl_id:
                        # best_loc may be a location NAME (string) or an object
                        # without an .id -- slugify the name so Equip still gets a
                        # concrete location id in the chosen region (was empty for
                        # every service-less recipe -> region equip did nothing).
                        # (2026-07-30)
                        _bl_name = (getattr(best_loc, 'name', '')
                                    or (best_loc if isinstance(best_loc, str) else '') or '')
                        _bl_id = _bl_name.replace(' ', '_').replace("'", '')
                    _region_location_id = _bl_id.lower()
                if _prim_tag:
                    service_location = _recipe_region_display(_prim_tag)
                    _region_icon = _recipe_region_icon(_prim_tag)
                elif _prim['regions']:
                    service_location = _prim['regions'][0]
                _service_grouped_name = ' or '.join(_prim['regions']) if _prim['regions'] else service_location
                _service_alt_locations = list(_prim['regions'][1:])
                # Per-region lines so the row can render each region on its own
                # line with its OWN icon (user: 3 regions -> 3 lines + 3 icons).
                _region_lines = [
                    {'display': _d, 'icon': _recipe_region_icon((_prim.get('region_tags') or {}).get(_d))}
                    for _d in _prim['regions']
                ]
                _service_extras = []
                _service_alternatives = []
                for _rg in _ordered[1:]:
                    _rtags = _rg.get('region_tags') or {}
                    # Split each tied-region group into ONE alt entry PER region
                    # so the Alternative Service Locations render each region on
                    # its own line with its OWN icon (was "Jarvonia or Grand Duchy
                    # of Trellin-Erdwise or Wallisia" jammed onto one line).
                    # Mirrors the primary region_lines split. (2026-07-30)
                    for _rd in _rg['regions']:
                        _service_alternatives.append({
                            'grouped_name': _rd,
                            'locations': [_rd],
                            'metric_value': _rg['score'],
                            'gearset_export': _rg['ex'],
                            'extras': [],
                            # Per-region icon so each region alt shows its own badge.
                            'region_icon': _recipe_region_icon(_rtags.get(_rd) or _rg.get('tag')),
                            # A concrete location id IN this region so Equip
                            # selects a real location in the col-3 dropdown (not
                            # the region name, which isn't a location). (2026-07-31)
                            'region_location_id': (_rg.get('loc_by_region') or {}).get(_rd, ''),
                        })
        except Exception as _rge:
            print(f"[recipe-region] service-less region grouping failed {recipe_name}: "
                  f"{type(_rge).__name__}: {_rge}", flush=True)

    metrics_json = {
        'recipe_name': recipe_name,
        # Service info — frontend reads these to render the recipe row's
        # location-equivalent line (icon + service name + location).
        'service_id': service_id,
        'service_name': service_name,
        'service_location': service_location,
        'service_icon': service_icon,
        # Full nested service stats for the row's service (i) popover, rendered
        # identically to column 3 via utils/service-stats-popover.js. service_skill
        # + service_location_id drive the same redundant-condition suppression.
        'service_stats': _recipe_service_stats_payload(service),
        'service_skill': (getattr(recipe, 'skill', '') or ''),
        'service_location_id': _recipe_service_loc_id(service),
        # Alternative Service Locations (increment 2): same-set services grouped
        # for display + (i)-tooltip data for objective-irrelevant-stat services.
        'service_grouped_name': _service_grouped_name,
        'service_alt_locations': _service_alt_locations,
        'service_extras': _service_extras,
        'service_alternatives': _service_alternatives,
        # Per-service-type lines for the same-set group (icon + name + its own
        # locations), and per-region lines for service-less recipes (display +
        # own icon). Frontend renders these multi-line when >1. (2026-07-29.)
        'service_type_groups': _service_type_groups,
        'region_lines': _region_lines,
        # Service-less recipes: is_region True => frontend renders the REGION
        # icon (not a service/location icon); grouped name is a region set.
        'is_region': _is_region,
        'region_icon': _region_icon,
        # Concrete location id inside the primary region (service-less recipes),
        # so Equip selects a real location rather than leaving it blank.
        'region_location_id': _region_location_id,
        # Recipe output (Item.BIRCH_PLANK / Material.PINE_LOGS / etc.).
        # Frontend uses resolveItemIcon() on this ref to pick the icon.
        'recipe_output_ref': output_item_ref,
        'recipe_output_name': output_item_name,
    }

    # Persist optimizer's chosen pet/consumable so Equip can re-apply them
    # (parallel to the activity optimizer path — see _extract_pet_consumable_meta).
    sel_pet, sel_cons = _extract_pet_consumable_meta(gearset)
    if sel_pet:
        metrics_json['optimized_pet'] = sel_pet
    if sel_cons:
        metrics_json['optimized_consumable'] = sel_cons

    # 2026-06-05 (jwbail): worker-computed slot alternatives (correct-axis).
    if _slot_alts:
        metrics_json['_slot_alternatives'] = _slot_alts
    if _slot_locked:
        metrics_json['_slot_locked_alternatives'] = _slot_locked
    if _slot_hidden:
        metrics_json['_slot_hidden_alternatives'] = _slot_hidden

    # Merge include-unavailable reasons (missing_level / missing_location /
    # missing_tool / missing_other / gear_gated+missing_gear) attached to the
    # recipe job by the enumerators, mirroring run_optimizer_for_job's merge so
    # target_items / chests_recipes rows carry the same warnings + bottom-section
    # gear flag as activity rows.
    _unmet = (job.extras or {}).get('unmet') if isinstance(getattr(job, 'extras', None), dict) else None
    if isinstance(_unmet, dict):
        for _k, _v in _unmet.items():
            metrics_json[_k] = _v

    return {
        'metric_value': metric_value,
        'metric_name': f'Steps/chest ({job.chest_name or "chest"})',
        'gearset_export': export_string,
        'metrics_json': metrics_json,
    }


def execute_job(job: ReportJob, character, db_path: str,
                pet_items_pool=None, consumable_items_pool=None,
                scope_sink=None, hidden_items=None) -> bool:
    """Execute a single job, write result to DB, return success.

    When ``scope_sink`` is provided (client-side / Pyodide path), the computed
    scope is handed to the callback instead of being written to the DB here —
    the server-side per-scope ingest endpoint persists it. The server path
    (scope_sink=None) is unchanged.
    """
    from ui.database import DatabaseManager

    # Log job start with a stable identifier so we can correlate stalls
    # against specific (category, source) pairs in the log file.
    _job_id_short = job.job_id[:8] if job.job_id else '?'
    _src = job.activity.name if job.activity else (getattr(job, 'recipe_name', None) or '?')
    print(f'[stats_report_worker] [{_job_id_short}] START {job.category}/{job.skill_name or job.chest_name or "?"}/{_src}', flush=True)
    _t_start = time.time()
    try:
        # 2026-05-22: chests_recipes goes through the recipe optimizer
        # (gear-aware steps_per_chest_recipe). Was previously using
        # job.precomputed_metric (gear-agnostic base_steps / drop_chance),
        # which produced wildly wrong values, no gearset_export (so no
        # Equip/Save/Gear buttons), and no service info for the row's
        # location-equivalent line.
        if job.category == 'chests_recipes':
            result = run_recipe_optimizer_for_job(
                job, character,
                pet_items_pool=pet_items_pool,
                consumable_items_pool=consumable_items_pool,
                hidden_items=hidden_items,
            )
        # 2026-05-23: new_items now ALSO runs the activity optimizer, but
        # the metric_value stays the precomputed weighted score (which is
        # category-specific — steps-per-new-item weighted by missing-
        # fraction). The optimizer call is just to get a real
        # gearset_export so the Equip/Save/Gear buttons render and the
        # user can see optimal pets/consumables in the gear preview.
        # User-reported: "Fastest new item activities STILL isn't showing
        # the buttons on the actual calculated things."
        elif job.category == 'new_items' and job.precomputed_metric is not None:
            try:
                opt_result = run_optimizer_for_job(
                    job, character,
                    pet_items_pool=pet_items_pool,
                    consumable_items_pool=consumable_items_pool,
                    hidden_items=hidden_items,
                )
                gearset_export = opt_result.get('gearset_export')
                metrics_json = opt_result.get('metrics_json')
                # 2026-05-24 fix: use the optimizer's gear-aware
                # steps_per_reward_roll::<best_drop> (computed in
                # run_optimizer_for_job's new_items branch) — that
                # value matches what the column-3 drops popover
                # shows once the optimizer's gearset is equipped.
                # Without this, the row showed the no-gear
                # precomputed value (e.g. 11,904) which mismatched
                # column 3's gear-aware value (e.g. 5,974).
                opt_metric = opt_result.get('metric_value')
                if opt_metric is not None and opt_metric > 0 and opt_metric != float('inf'):
                    final_metric = opt_metric
                else:
                    final_metric = job.precomputed_metric
            except Exception as _e:
                # Fall back to no-gearset behavior if the optimizer
                # fails — preserves prior new_items behavior.
                print(f'[stats_report_worker] new_items optimizer fallback: {_e}',
                      flush=True)
                gearset_export = None
                metrics_json = None
                final_metric = job.precomputed_metric
            result = {
                'metric_value': final_metric,
                'metric_name': job.precomputed_metric_name or 'Steps/reward',
                'gearset_export': gearset_export,
                'metrics_json': metrics_json,
            }
            # 2026-05-24: merge best-drop metadata (item_name/item_ref/kind)
            # built in build_new_items_jobs into metrics_json so the frontend
            # can render the item icon and wire the column-3 drop popover
            # from these rows. Done as a merge (not assignment) so the
            # optimizer's metrics keys are preserved.
            if job.extras and isinstance(result.get('metrics_json'), dict):
                if 'best_drop' in job.extras and job.extras['best_drop']:
                    result['metrics_json']['best_drop'] = job.extras['best_drop']
                # If the optimizer path didn't already build the gear-aware
                # per-item breakdown (new_items_combined), synthesize a
                # no-gear one from the builder's combined meta so the
                # expandable list still renders.
                if (job.extras.get('combined')
                        and 'new_items_combined' not in result['metrics_json']):
                    _c = job.extras['combined']
                    result['metrics_json']['new_items_combined'] = {
                        'kind': _c.get('kind'),
                        'count': _c.get('count', len(_c.get('items', []))),
                        'items': _c.get('items', []),
                    }
            elif job.extras and not result.get('metrics_json'):
                # Optimizer fallback path returned None — still surface
                # best_drop (and the no-gear combined breakdown) so the
                # row + expandable list render.
                result['metrics_json'] = {'best_drop': job.extras.get('best_drop')}
                if job.extras.get('combined'):
                    _c = job.extras['combined']
                    result['metrics_json']['new_items_combined'] = {
                        'kind': _c.get('kind'),
                        'count': _c.get('count', len(_c.get('items', []))),
                        'items': _c.get('items', []),
                    }
        # target_items: currency (AGT/Sea Shells) is a value-weighted units/1k
        # metric that is gear-independent here -> precomputed passthrough.
        # Material/finding items run the optimizer targeting THIS item so gear
        # (FMF / double-rewards / work-efficiency) is chosen to minimize its
        # steps/item, producing a real gearset_export (Equip/Save/Gear buttons)
        # and a gear-aware metric -- mirrors new_items. (2026-08-12 jwbail)
        elif job.category == 'target_items':
            _ti_extras = dict(job.extras) if job.extras else {}
            _ti_is_currency = (_ti_extras.get('metric_kind') == 'per_1k'
                               or _ti_extras.get('group_kind') == 'currency')
            if job.activity is None:
                result = {
                    'metric_value': job.precomputed_metric,
                    'metric_name': job.precomputed_metric_name or 'Steps/item',
                    'gearset_export': None,
                    'metrics_json': _ti_extras,
                }
            else:
                try:
                    _opt = run_optimizer_for_job(
                        job, character,
                        pet_items_pool=pet_items_pool,
                        consumable_items_pool=consumable_items_pool,
                        hidden_items=hidden_items,
                    )
                    _omj = _opt.get('metrics_json')
                    _omj = {**_ti_extras, **_omj} if isinstance(_omj, dict) else _ti_extras
                    # Gear-aware metric from the optimizer (currency = units/1k
                    # higher-better, material = steps/item lower-better — both
                    # computed in run_optimizer_for_job's target_items branch).
                    _om = _opt.get('metric_value')
                    _ofinal = (_om if (_om is not None and _om > 0 and _om != float('inf'))
                               else job.precomputed_metric)
                    result = {
                        'metric_value': _ofinal,
                        'metric_name': _opt.get('metric_name') or job.precomputed_metric_name or 'Steps/item',
                        'gearset_export': _opt.get('gearset_export'),
                        'metrics_json': _omj,
                    }
                except Exception as _tie:
                    print(f'[stats_report_worker] target_items optimizer fallback: {_tie}',
                          flush=True)
                    result = {
                        'metric_value': job.precomputed_metric,
                        'metric_name': job.precomputed_metric_name or 'Steps/item',
                        'gearset_export': None,
                        'metrics_json': _ti_extras,
                    }
        # For precomputed jobs without a category-specific gearset path,
        # no optimizer is run — use the precomputed metric directly.
        elif job.precomputed_metric is not None:
            result = {
                'metric_value': job.precomputed_metric,
                'metric_name': job.precomputed_metric_name or 'Steps/reward',
                'gearset_export': None,
            }
        else:
            result = run_optimizer_for_job(job, character,
                                           pet_items_pool=pet_items_pool,
                                           consumable_items_pool=consumable_items_pool,
                                           hidden_items=hidden_items)

        # Include-unavailable "inputs" gate. A row whose activity declares an
        # input requirement the user can't satisfy (missing_input) is shown
        # with a warning ONLY when the inputs dimension is enabled — which is
        # the default, so this reproduces today's behavior exactly. When the
        # user turns the inputs sub-toggle off, drop the row (count it as done
        # so progress still completes, but write no result).
        _mj_check = result.get('metrics_json') if isinstance(result, dict) else None
        if (isinstance(_mj_check, dict) and _mj_check.get('missing_input')
                and not _incl('inputs')):
            print(f'[stats_report_worker] [{_job_id_short}] DROP input-gated '
                  f'{job.category}/{_src} (inputs dimension off)', flush=True)
            if scope_sink is None:
                try:
                    DatabaseManager(db_path).update_stats_report_progress(
                        job.run_id, success=True)
                except Exception:
                    pass
            return True

        # Client-side (Pyodide) path: hand the scope to the caller (browser)
        # instead of writing to the DB here. The server-side per-scope ingest
        # endpoint persists it, including the stale-detection row which it
        # re-derives server-side from the run params + job identity.
        if scope_sink is not None:
            scope_sink({
                'result_id': job.job_id,
                'run_id': job.run_id,
                'session_uuid': job.session_uuid,
                'category': job.category,
                'activity_name': job.activity.name if job.activity else None,
                'skill_name': job.skill_name,
                'chest_name': job.chest_name,
                'metric_value': result['metric_value'],
                'metric_name': result['metric_name'],
                'gearset_export': result['gearset_export'],
                'metrics_json': result.get('metrics_json'),
                # 2026-08-12 (jwbail): carry the target_items leaf identity so
                # the local-scope path (_find_local_job) can match the exact
                # item — (category, skill_name, chest_name, activity_name) is
                # shared by many items in the same group+activity and collapses
                # ~35 items onto one scope key otherwise (bug 1db9384e, 179/214).
                'item_slug': (job.extras or {}).get('item_slug') if job.extras else None,
                'group_slug': (job.extras or {}).get('group_slug') if job.extras else None,
                'job_status': 'complete',
            })
            return True

        # Write result to DB with retry
        for attempt in range(DB_WRITE_RETRIES):
            try:
                db = DatabaseManager(db_path)
                db.create_stats_report_gearset(
                    result_id=job.job_id,
                    run_id=job.run_id,
                    session_uuid=job.session_uuid,
                    category=job.category,
                    activity_name=job.activity.name if job.activity else None,
                    skill_name=job.skill_name,
                    chest_name=job.chest_name,
                    metric_value=result['metric_value'],
                    metric_name=result['metric_name'],
                    gearset_export=result['gearset_export'],
                    metrics_json=result.get('metrics_json'),
                    job_status='complete',
                )

                # Dual-write: also write the new schema row for stale-detection.
                # See .kiro/specs/stats-report-stale-detection/ for design.
                try:
                    _write_stats_report_result_row(db, job, character, result)
                except Exception as _e:
                    # Don't fail the run if stale-detection write fails — legacy
                    # path stays the source of truth until cleanup CR removes it.
                    print(f"[stats_report worker] stale-detection write failed: {_e}")

                db.update_stats_report_progress(job.run_id, success=True)
                # 2026-05-23: self-terminate check. If the run row was
                # deleted (user clicked Reset, or this worker is an
                # orphan from before a deploy that the user already
                # re-ran), exit gracefully instead of continuing to
                # waste CPU on an abandoned run. os._exit hard-exits
                # the whole process — sys.exit raises SystemExit which
                # the ThreadPoolExecutor would just swallow into the
                # task's Future. Reading the run row is cheap relative
                # to the optimizer cost we just paid.
                if db.get_stats_report_run(job.run_id) is None:
                    print(f'[stats_report_worker] run {job.run_id} no longer exists '
                          f'in DB — self-terminating', flush=True)
                    os._exit(0)
                _t_elapsed = time.time() - _t_start
                if _t_elapsed > 30:
                    print(f'[stats_report_worker] [{_job_id_short}] SLOW {_src}: {_t_elapsed:.1f}s', flush=True)
                else:
                    print(f'[stats_report_worker] [{_job_id_short}] OK {_src}: {_t_elapsed:.1f}s', flush=True)
                return True
            except Exception as e:
                if attempt < DB_WRITE_RETRIES - 1:
                    time.sleep(DB_WRITE_RETRY_DELAY)
                else:
                    raise e

    except Exception as e:
        # 2026-05-23: log the actual exception + traceback so diagnostics
        # of fast-mode failures aren't blocked on guessing. Without this,
        # FAILED jobs only carried error_message=str(e) into the DB row,
        # which gets wiped on Reset before we can inspect it.
        print(f'[stats_report_worker] [{_job_id_short}] exception in execute_job: {e!r}', flush=True)
        traceback.print_exc()
        # Write failure record
        for attempt in range(DB_WRITE_RETRIES):
            try:
                db = DatabaseManager(db_path)
                db.create_stats_report_gearset(
                    result_id=job.job_id,
                    run_id=job.run_id,
                    session_uuid=job.session_uuid,
                    category=job.category,
                    activity_name=job.activity.name if job.activity else None,
                    skill_name=job.skill_name,
                    chest_name=job.chest_name,
                    metric_value=None,
                    metric_name=None,
                    gearset_export=None,
                    job_status='failed',
                    error_message=str(e),
                )
                db.update_stats_report_progress(job.run_id, success=False)
                break
            except Exception:
                if attempt < DB_WRITE_RETRIES - 1:
                    time.sleep(DB_WRITE_RETRY_DELAY)
        return False


# ============================================================================
# PUSH NOTIFICATION
# ============================================================================

def send_push_notification_sync(session_uuid: str, db_path: str, run_id: str):
    """Send a push notification to all subscribed devices for the session.

    Uses pywebpush directly (no async needed in subprocess context).

    Returns a (sent_count, failed_count) tuple so the caller can log the
    real outcome instead of an unconditional 'sent' message.
    """
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        print('[stats_report_worker] pywebpush not installed — skipping push')
        return (0, 0)

    sent = 0
    failed = 0
    try:
        from ui.database import DatabaseManager
        import os

        db = DatabaseManager(db_path)
        subscriptions = db.get_push_subscriptions_for_session(session_uuid)
        if not subscriptions:
            print(f'[stats_report_worker] No push subscriptions for session {session_uuid}')
            return (0, 0)

        vapid_private_key = os.environ.get('VAPID_PRIVATE_KEY', '')
        if not vapid_private_key:
            print('[stats_report_worker] VAPID_PRIVATE_KEY env var empty — skipping push')
            return (0, len(subscriptions))
        # Mirror ui/app.py's env-var decode: the value may be raw PEM,
        # base64-encoded PEM, or PEM with literal '\n' escapes (Docker env
        # files commonly produce the latter two).
        if not vapid_private_key.startswith('-----BEGIN'):
            try:
                import base64 as _b64
                decoded = _b64.b64decode(vapid_private_key + '==').decode('utf-8')
                if decoded.startswith('-----BEGIN'):
                    vapid_private_key = decoded
                else:
                    vapid_private_key = vapid_private_key.replace('\\n', '\n')
            except Exception:
                vapid_private_key = vapid_private_key.replace('\\n', '\n')
        # Now parse to a Vapid instance — pywebpush accepts both raw PEM
        # and a Vapid object, but raw PEM goes through pywebpush's
        # internal parser which rejects valid keys py_vapid handles
        # (bug b0a8629e: 'ASN.1 parsing error: invalid length' on the
        # exact PEM that app.py loads successfully via Vapid.from_file).
        # Mirror app.py's tempfile + Vapid.from_file dance for parity.
        import tempfile as _tempfile
        try:
            from py_vapid import Vapid
        except ImportError:
            print('[stats_report_worker] py_vapid not installed — skipping push')
            return (0, len(subscriptions))
        _vapid_key_file = _tempfile.NamedTemporaryFile(
            mode='w', suffix='.pem', delete=False
        )
        try:
            _vapid_key_file.write(vapid_private_key)
            _vapid_key_file.close()
            vapid_instance = Vapid.from_file(_vapid_key_file.name)
        except Exception as e:
            print(f'[stats_report_worker] Vapid key parse failed: {e}')
            try:
                os.unlink(_vapid_key_file.name)
            except Exception:
                pass
            return (0, len(subscriptions))
        vapid_claims = {'sub': os.environ.get('VAPID_SUBJECT', 'mailto:admin@example.com')}

        payload = json.dumps({
            'title': 'Goals report complete',
            'body': 'Your optimization report is ready to view',
            'session_uuid': session_uuid,
            'stats_report_run_id': run_id,
        })

        for sub in subscriptions:
            try:
                # DB helper returns keys 'p256dh' / 'auth' (no _key suffix).
                # Bug 4612741f: this code was reading sub['p256dh_key'] which
                # raised KeyError on every subscription, so 0 pushes ever
                # delivered for stats-report-complete despite the run row
                # having notify_on_complete=1. app.py's broadcast path uses
                # the correct keys — that's why global pushes work.
                subscription_info = {
                    'endpoint': sub['endpoint'],
                    'keys': {
                        'p256dh': sub['p256dh'],
                        'auth': sub['auth'],
                    }
                }
                webpush(
                    subscription_info=subscription_info,
                    data=payload,
                    vapid_private_key=vapid_instance,
                    vapid_claims=vapid_claims,
                )
                sent += 1
            except WebPushException as e:
                failed += 1
                print(f'[stats_report_worker] Push failed for subscription: {e}')
            except Exception as e:
                failed += 1
                print(f'[stats_report_worker] Push error: {e}')

    except Exception as e:
        print(f'[stats_report_worker] Failed to send push notifications: {e}')
    # Clean up the tempfile we wrote the PEM to. Wrapped in try/except in
    # case parse failed before _vapid_key_file existed.
    try:
        os.unlink(_vapid_key_file.name)
    except Exception:
        pass
    return (sent, failed)


# ============================================================================
# MAIN WORKER LOGIC
# ============================================================================

def load_character(session_uuid: str, db_path: str):
    """Load character from DB using session UUID.

    The stored character_config does NOT contain raw inventory/bank/gear
    dicts (it stores simplified owned_items lists instead). We must
    reconstruct a minimal export dict that Character.__init__ can parse,
    using all_items_raw (the full {export_name: qty} map stored separately).
    """
    from ui.database import DatabaseManager
    from util.character_export_util import Character

    db = DatabaseManager(db_path)
    session = db.get_session(session_uuid)
    if not session:
        raise ValueError(f'Session not found: {session_uuid}')

    char_config = session.get('character_config')
    if not char_config:
        raise ValueError(f'No character config for session: {session_uuid}')

    if isinstance(char_config, str):
        char_config = json.loads(char_config)

    # Reconstruct a minimal export dict that Character.__init__ expects.
    # The key fields are: inventory (export_name→qty), skills (skill→xp),
    # reputation, achievement_points, steps, name, collectibles, gear, pets.
    all_items_raw_str = session.get('all_items_raw')
    all_items_raw = {}
    if all_items_raw_str:
        if isinstance(all_items_raw_str, str):
            all_items_raw = json.loads(all_items_raw_str)
        elif isinstance(all_items_raw_str, dict):
            all_items_raw = all_items_raw_str

    # 2026-06-15 (jwbail): apply per-item QUALITY overrides from column 1.
    # all_items_raw is the IMPORTED inventory and carries every owned quality
    # variant (e.g. golden_cutting_mat _common/_uncommon/_epic). Dumping it
    # straight into the optimizer's inventory makes it pick the best imported
    # variant and IGNORE the user's column-1 quality choice, so changing
    # Excellent->Perfect had no effect ("activities still say Excellent" —
    # user-reported). Mirror the main optimizer (optimize_worker Steps 1-3)
    # and from_char_config: for an item with a `quality` override, drop its
    # other quality variants and keep only the chosen quality. Rings are
    # skipped (their per-instance qualities use item_qualities + ring1/ring2,
    # not this single 'quality' field).
    try:
        _ui = session.get('ui_config') or {}
        if isinstance(_ui, str):
            _ui = json.loads(_ui)
        _overrides = ((_ui.get('user_overrides') or {}).get('items') or {})
        _ring_slugs = set(char_config.get('item_qualities') or {})
        _q2suffix = {
            'normal': '_common', 'good': '_uncommon', 'great': '_rare',
            'excellent': '_epic', 'perfect': '_legendary', 'eternal': '_ethereal',
            'common': '_common', 'uncommon': '_uncommon', 'rare': '_rare',
            'epic': '_epic', 'legendary': '_legendary', 'ethereal': '_ethereal',
        }
        _all_suffixes = ('_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal')
        for _slug, _st in _overrides.items():
            if not isinstance(_st, dict):
                continue
            _q = _st.get('quality')
            if not _q or _slug in _ring_slugs:
                continue
            _suffix = _q2suffix.get(str(_q).lower())
            if not _suffix:
                continue
            _variants = [k for k in list(all_items_raw)
                         if k == _slug or any(k == _slug + s for s in _all_suffixes)]
            if not _variants:
                continue  # not in the imported inventory — nothing to swap
            for _k in _variants:
                all_items_raw.pop(_k, None)
            all_items_raw[_slug + _suffix] = 1
    except Exception as _e:
        print(f'[stats_report_worker] load_character quality-override apply failed: {_e}', flush=True)

    # 2026-06-16 (jwbail): apply column-1 user_overrides + the custom-stats
    # toggle to the character the OPTIMIZER builds, mirroring the main
    # optimize-gearset path (app.py) and the character export builder so the
    # goals report scores with the SAME character the rest of the app does.
    # Previously load_character read imported skills only and pulled
    # custom_stats from char_config, so:
    #   * a column-1 skill LEVEL override (e.g. Crafting 49->50 unlocking a
    #     level-gated item stat like the screwdriver's +4% DR) was ignored, and
    #   * the CUSTOM-STATS toggle (e.g. screwdriver WE+9%) lives in
    #     ui_config.custom_stats — not char_config — so deselecting it had no
    #     effect on the optimizer's step counts.
    _ui_cfg = session.get('ui_config') or {}
    if isinstance(_ui_cfg, str):
        try:
            _ui_cfg = json.loads(_ui_cfg)
        except Exception:
            _ui_cfg = {}
    _uo = _ui_cfg.get('user_overrides') or {}

    # Use skills_xp (XP values) for Character, which converts to levels internally
    from util.walkscape_constants import level_to_xp
    skills_xp = dict(char_config.get('skills_xp', {}) or {})
    # Fallback: if skills_xp not available, convert levels back to XP (approximate)
    if not skills_xp:
        skills_xp = {skill: level_to_xp(lvl) for skill, lvl in (char_config.get('skills', {}) or {}).items()}
    # Apply column-1 LEVEL overrides (user_overrides.skills are levels) into
    # skills_xp (what Character actually consumes); explicit skills_xp overrides
    # win over derived ones. Mirrors the main optimizer's skills/skills_xp merge.
    for _s, _lvl in (_uo.get('skills') or {}).items():
        try:
            skills_xp[_s] = level_to_xp(int(_lvl))
        except Exception:
            pass
    for _s, _xp in (_uo.get('skills_xp') or {}).items():
        skills_xp[_s] = _xp

    # 2026-09-28 (jwbail [fix:termite-effort]): apply column-1 PET overrides
    # (level + has) so the Character the optimizer builds matches the pet roster
    # that from_char_config (stale detection / enumerate_applicable_sources)
    # sees. The column-1 pet level slider writes ui_config.user_overrides.items
    # [species].level (and .has for an un-owned pet). from_char_config applies
    # these into its owned_pets, but load_character previously passed the RAW
    # char_config['pets'] straight through — so setting a Termite to level 4 via
    # the slider made enumerate emit ('xp','carpentry',...) scopes (the "Newly
    # unlocked activities" popup) while owned_termite_level(character) still saw
    # the imported (lower) level and build_xp_jobs emitted ZERO Carpentry jobs.
    # Net: the report showed N newly-unlocked Carpentry activities that could
    # never be optimized (0/0 on every run, (!) never cleared). Mirror
    # from_char_config's pet-override logic here so the optimizer's pet level
    # (and thus its level-gated stats + the Terminate ability gate) is correct.
    _pets_list = [dict(p) for p in (char_config.get('pets') or []) if isinstance(p, dict)]
    try:
        from util.autogenerated.pets import PETS_BY_NAME as _PBN
        from util.stats_report.normalize import normalize_item_id as _norm_pet
        _known_species = {_norm_pet(str(s)) for s in _PBN.keys()}
        _ov_items = _uo.get('items') if isinstance(_uo.get('items'), dict) else {}
        _pet_ov_level = {}
        _pet_has_add = {}
        for _oid, _st in _ov_items.items():
            if not isinstance(_st, dict):
                continue
            _sp = _norm_pet(str(_oid))
            if _sp not in _known_species:
                continue
            try:
                _lvl = int(_st.get('level') or 0)
            except (TypeError, ValueError):
                _lvl = 0
            if _lvl > 0:
                _pet_ov_level[_sp] = _lvl
                if _st.get('has'):
                    _pet_has_add[_sp] = _lvl
        _seen_pet = set()
        for _p in _pets_list:
            _sp = _norm_pet(str(_p.get('species') or _p.get('name') or ''))
            _seen_pet.add(_sp)
            if _sp in _pet_ov_level:
                _p['level'] = _pet_ov_level[_sp]
                # A slider-set level implies the pet is at that stage; clear an
                # 'egg' stage so _parse_pets resolves the adult ability/stats.
                if not _p.get('stage') or str(_p.get('stage')).lower() == 'egg':
                    _p['stage'] = 'adult'
        for _sp, _lvl in _pet_has_add.items():
            if _sp not in _seen_pet:
                _pets_list.append({'species': _sp, 'level': _lvl, 'stage': 'adult'})
    except Exception as _pe:
        print(f'[stats_report_worker] load_character pet-override apply failed: {_pe}', flush=True)

    minimal_export = {
        'name': char_config.get('name', 'Unknown'),
        'game_version': char_config.get('game_version', 'Unknown'),
        'steps': char_config.get('steps', 0),
        'achievement_points': char_config.get('achievement_points', 0),
        'coins': char_config.get('coins', 0),
        'skills': skills_xp,
        'reputation': char_config.get('reputation', {}),
        'inventory': all_items_raw,  # Full {export_name: qty} map
        'bank': {},
        'gear': {},
        'collectibles': char_config.get('collectibles', []),
        'pets': _pets_list,
        # Custom-stats toggle state lives in ui_config.custom_stats (same source
        # the main character export uses); fall back to char_config for older
        # sessions. This is what makes deselecting a custom stat actually lower
        # the optimizer's effective stats.
        'custom_stats': _ui_cfg.get('custom_stats', char_config.get('custom_stats', None)),
    }

    return Character(json.dumps(minimal_export))


def get_owned_item_names(session_uuid: str, db_path: str) -> set:
    """Get the set of owned item names for a session.

    Kept for backward compatibility — returns just the item-id set
    from character_config.items. New callers should prefer
    `get_ownership_lookup` which also covers collectibles + pet
    species + available eggs.
    """
    from ui.database import DatabaseManager

    db = DatabaseManager(db_path)
    session = db.get_session(session_uuid)
    if not session:
        return set()

    char_config = session.get('character_config') or {}
    items = char_config.get('items', {})

    owned = set()
    for item_id, item_data in items.items():
        if isinstance(item_data, dict) and item_data.get('has', False):
            # Try to resolve item name from ID
            owned.add(item_id)

    # 2026-05-24 fix: same problem as get_ownership_lookup — most live
    # characters store their roster in `owned_items` / `owned_quantities`,
    # not in the legacy `items` map. Mirror the fix here so the
    # backward-compat fallback path doesn't silently mis-report.
    _RING_RARITY_SUFFIXES = (
        '_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal',
    )
    for export_name in (char_config.get('owned_items') or []):
        if not isinstance(export_name, str) or not export_name:
            continue
        owned.add(export_name)
        for suffix in _RING_RARITY_SUFFIXES:
            if export_name.endswith(suffix):
                owned.add(export_name[:-len(suffix)])
                break
    for slug, qty in (char_config.get('owned_quantities') or {}).items():
        try:
            if int(qty) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        if not isinstance(slug, str) or not slug:
            continue
        owned.add(slug)
        for suffix in _RING_RARITY_SUFFIXES:
            if slug.endswith(suffix):
                owned.add(slug[:-len(suffix)])
                break

    return owned


def _normalize_item_id(name: str) -> str:
    """Convert a display name like 'Old copper ring' to its lowercase
    snake-case id ('old_copper_ring'). Mirrors the convention the
    UI uses for keys in character_config.items.

    Delegates to util.stats_report.normalize.normalize_item_id — the SINGLE
    SOURCE OF TRUTH shared with the enumerator (applicable_sources /
    state_snapshot). Keeping one implementation prevents the normalization
    drift that left collectible (!) badges stuck forever (report 2316c608:
    '99-year-old wine' normalized differently on each side)."""
    from util.stats_report.normalize import normalize_item_id
    return normalize_item_id(name)


def get_ownership_lookup(session_uuid: str, db_path: str) -> Dict[str, set]:
    """Build the ownership maps the new_items category needs.

    Returns a dict with four sets, all keyed by normalized item ids
    (snake_case lowercase) so the caller can do quick `in` checks
    against drop names normalized the same way.

      - items:        every Item.* the user has (from items map +
                      inventory + bank).
      - collectibles: every Collectible.* the user has obtained.
      - pet_species:  every species the user has a pet of (active or
                      available_pets).
      - eggs:         every available egg the user has (from
                      available_eggs).

    Materials and consumables are intentionally NOT tracked here —
    they're filtered out of new_items entirely (see
    build_new_items_jobs).
    """
    from ui.database import DatabaseManager
    db = DatabaseManager(db_path)
    session = db.get_session(session_uuid) or {}
    char_config = session.get('character_config') or {}
    # 2026-05-24: also pick up ui_config.user_overrides.items.<id>.hide
    # so items the user has marked Hidden (via the column-1 checkbox or
    # the new_items "Hide" button) are excluded from new_items as if
    # they were already owned. Same path optimize_worker uses to build
    # its `hidden_items` set.
    ui_config = session.get('ui_config') or {}
    if isinstance(ui_config, str):
        try:
            ui_config = json.loads(ui_config)
        except Exception:
            ui_config = {}

    items = set()
    for item_id, item_data in (char_config.get('items') or {}).items():
        if isinstance(item_data, dict) and item_data.get('has', False):
            items.add(_normalize_item_id(item_id))
    # inventory + bank may carry equipment by export name; include them
    # so a freshly-imported character that hasn't toggled the items map
    # still reads as owning the items in their inventory.
    for src in ('inventory', 'bank'):
        for export_name, qty in (char_config.get(src) or {}).items():
            try:
                if int(qty) > 0:
                    items.add(_normalize_item_id(export_name))
            except (TypeError, ValueError):
                pass

    # 2026-05-24 fix: most live characters store their gear roster in
    # `owned_items` (flat list of export names) and `owned_quantities`
    # (dict of qty by snake-case slug) — NOT in items/inventory/bank.
    # The legacy three buckets above are empty for any character imported
    # via the WalkScape Tools API path. Without this branch, the
    # new_items section reports already-owned items as "new" (e.g. user
    # has 13× birch_skis but cut_birch_trees still surfaces "Birch skis"
    # as new gear at 35 steps/item).
    #
    # Rings are stored with a rarity suffix (gold_ruby_ring_legendary).
    # Drops come without a suffix (Item.BIRCH_SKIS → birch_skis), so we
    # strip the trailing rarity tag and add the base form too. Crafted
    # equipment qualities (Normal/Fine/Good/.../Eternal) are tracked
    # separately in item_qualities, not as slug suffixes, so the slug
    # itself is already the base form for non-ring items.
    _RING_RARITY_SUFFIXES = (
        '_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal',
    )
    for export_name in (char_config.get('owned_items') or []):
        if not isinstance(export_name, str) or not export_name:
            continue
        norm = _normalize_item_id(export_name)
        if not norm:
            continue
        items.add(norm)
        for suffix in _RING_RARITY_SUFFIXES:
            if norm.endswith(suffix):
                items.add(norm[:-len(suffix)])
                break
    for slug, qty in (char_config.get('owned_quantities') or {}).items():
        try:
            if int(qty) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        if not isinstance(slug, str) or not slug:
            continue
        norm = _normalize_item_id(slug)
        if not norm:
            continue
        items.add(norm)
        for suffix in _RING_RARITY_SUFFIXES:
            if norm.endswith(suffix):
                items.add(norm[:-len(suffix)])
                break

    collectibles = set()
    for c in (char_config.get('collectibles') or []):
        if isinstance(c, str):
            collectibles.add(_normalize_item_id(c))

    pet_species = set()
    for p in (char_config.get('pets') or []):
        if isinstance(p, dict):
            sp = p.get('species') or ''
            if sp:
                pet_species.add(_normalize_item_id(sp))
        elif isinstance(p, str):
            pet_species.add(_normalize_item_id(p))
    for sp in (char_config.get('available_pets') or []):
        if isinstance(sp, str):
            pet_species.add(_normalize_item_id(sp))
        elif isinstance(sp, dict):
            sp_name = sp.get('species') or sp.get('name') or ''
            if sp_name:
                pet_species.add(_normalize_item_id(sp_name))

    eggs = set()
    for egg in (char_config.get('available_eggs') or []):
        if isinstance(egg, str):
            eggs.add(_normalize_item_id(egg))

    # 2026-05-24: items marked hide=true via column 1 checkbox or the
    # new_items "Hide" button get added to the items set so the new_items
    # filter treats them as owned (= won't surface them as new). Same
    # behavior as optimize_worker's hidden_items set, kept unified so the
    # user only has to manage one source of truth.
    ui_items = ui_config.get('items') or {}
    user_override_items = (ui_config.get('user_overrides') or {}).get('items') or {}
    merged_overrides = {**ui_items, **user_override_items}

    def _mark_owned(item_id):
        """Add a manually-owned/hidden override id to every new_items
        ownership bucket. The override (ui_config.user_overrides.items.<id>)
        doesn't tell us the drop KIND, so we add the normalized id to items,
        collectibles AND eggs — a slug only matches drops of its real kind,
        so cross-adding is harmless. Item ids are drop-name-compatible
        slugs (catalog uses _name_to_id, same convention as
        _normalize_item_id), so 'seahorse_fossil' matches the
        Collectible.SEAHORSE_FOSSIL drop's normalized name."""
        norm = _normalize_item_id(item_id)
        if not norm:
            return
        forms = {norm}
        # Rings carry a rarity suffix in the slug; drops come without it.
        for suffix in ('_common', '_uncommon', '_rare', '_epic',
                       '_legendary', '_ethereal'):
            if norm.endswith(suffix):
                forms.add(norm[:-len(suffix)])
                break
        items.update(forms)
        collectibles.update(forms)
        eggs.update(forms)

    for item_id, state in merged_overrides.items():
        if not isinstance(state, dict):
            continue
        # 2026-07-17 (bug 0e1a28e6 follow-up): honor the column-1 "owned"
        # checkbox (user_overrides.items.<id>.has, set by item-row.js) in
        # addition to the "Hide" checkbox. Marking an item owned must drop
        # it from the new_items "fastest to obtain" list on the next
        # results load — without needing a full re-optimize — and is
        # reversible (un-check → it reappears, no re-optimize). Both the
        # read-path filter and build_new_items_jobs read this lookup, so
        # honoring `has` here fixes both the display and job generation.
        if state.get('hide') or state.get('has'):
            _mark_owned(item_id)
        # hide_fine / has_fine intentionally NOT respected for new_items —
        # the kind buckets here are non-quality-aware (a drop is "Birch
        # skis", not "Birch skis (Fine)"), so a fine-only flag shouldn't
        # suppress the base item.

    return {
        'items': items,
        'collectibles': collectibles,
        'pet_species': pet_species,
        'eggs': eggs,
    }


# ============================================================================
# PET / CONSUMABLE POOL HELPERS (2026-05-20)
# ============================================================================
#
# When the user toggles "Include pets" / "Include consumables" we have to
# build the candidate pools the optimizer's PET_ITEMS / CONSUMABLE_ITEMS
# globals expect. These helpers run ONCE per worker invocation (in
# run_worker) and the resulting lists are reused across every job's
# optimizer call.

def _build_hidden_items(session_uuid: str, db_path: str):
    """Load the user's hide list (gear / materials / consumables) for this
    session and return the set the optimizer treats as IGNORED_ITEMS.

    Symmetric with _build_pet_items — used by both the server worker
    (run_worker) and the browser local path (_run_local). Pets are handled
    separately inside _build_pet_items via _get_hidden_pet_ids.
    """
    from ui.database import DatabaseManager
    from ui.optimize_worker import build_hidden_items_set
    db = DatabaseManager(db_path)
    session = db.get_session(session_uuid) or {}
    ui_config = session.get('ui_config') or {}
    if isinstance(ui_config, str):
        try:
            ui_config = json.loads(ui_config)
        except Exception:
            ui_config = {}
    return build_hidden_items_set(ui_config)


def _build_pet_items(session_uuid: str, db_path: str, use_pet_ability: bool = False):
    """Mirror optimize_worker._build_pet_items_from_character_config but
    self-contained: pets live in character_config['pets'] (species + level)
    and optionally character_config['user_overrides']['items'] (manual flags
    set in column 1). Return PetLevelInfo instances."""
    from ui.database import DatabaseManager
    from util.autogenerated.pets import PETS_BY_NAME

    db = DatabaseManager(db_path)
    session = db.get_session(session_uuid)
    if not session:
        return []
    char_config = session.get('character_config') or {}
    ui_config = session.get('ui_config') or {}
    if isinstance(ui_config, str):
        try:
            ui_config = json.loads(ui_config)
        except Exception:
            ui_config = {}

    # 2026-06-17 (jwbail): respect the user's hide list — pets flagged
    # hidden via the column-1 eye icon must never enter the goals report
    # optimizer's PET_ITEMS pool. Mirrors optimize_worker's column-2 path.
    from ui.optimize_worker import _get_hidden_pet_ids, _species_to_pet_id
    hidden_pet_ids = _get_hidden_pet_ids(ui_config)

    pet_items = []
    seen = set()

    overrides = ((ui_config or {}).get('user_overrides') or {}).get('items') or {}
    # 2026-06-16 (jwbail): column-1 pet level slider writes {level,...} WITHOUT
    # 'has' for an already-owned pet — it UPDATES the level. Apply it to owned
    # pets so e.g. setting the tiger to lvl 3 actually feeds the lvl-3 stats
    # (chest_finding) to the optimizer. has:true still marks an ADD of an
    # un-owned pet.
    pet_ov_level = {}
    for _oid, _st in overrides.items():
        if not isinstance(_st, dict):
            continue
        try:
            _lv = int(_st.get('level') or 0)
        except Exception:
            _lv = 0
        if _lv > 0:
            pet_ov_level[str(_oid).lower()] = _lv

    owned_species = set()
    for pet_data in (char_config.get('pets') or []):
        if not isinstance(pet_data, dict):
            continue
        species = (pet_data.get('species') or '').capitalize()
        level = int(pet_data.get('level') or 0)
        if not species:
            continue
        if _species_to_pet_id(species) in hidden_pet_ids:
            continue  # user hid this pet
        owned_species.add(species.lower())
        _ov = pet_ov_level.get(species.lower())   # owned-pet level override wins
        if _ov:
            level = _ov
        if level <= 0:
            continue
        pet_levels = PETS_BY_NAME.get(species)
        if not pet_levels:
            continue
        pet_info = pet_levels.get_level(level)
        if pet_info and (species, level) not in seen:
            seen.add((species, level))
            pet_items.append(pet_info)

    for override_id, state in overrides.items():
        if not isinstance(state, dict) or not state.get('has'):
            continue
        if override_id in hidden_pet_ids:
            continue  # user hid this pet
        level = int(state.get('level') or 0)
        if level <= 0:
            continue
        species = str(override_id).capitalize()
        if species.lower() in owned_species:
            continue  # already handled above as an owned pet (with override)
        pet_levels = PETS_BY_NAME.get(species)
        if not pet_levels:
            continue
        if (species, level) in seen:
            continue
        pet_info = pet_levels.get_level(level)
        if pet_info:
            seen.add((species, level))
            pet_items.append(pet_info)

    # Part 4 (2026-08-31 jwbail): when the goals report's "Always use active
    # applicable pet ability" toggle is on, merge each candidate pet's ACTIVE
    # ability stats into its per-skill/location stats (assume charges are
    # loaded) — byte-for-byte the same deep-merge the column-2 include_pets
    # path applies (optimize_worker._augment_pet_items_for_all_items /
    # _merge_pet_ability_stats). Only a pet whose CURRENT level has an
    # `abilities` list carries one — abilities unlock at the ADULT level — so
    # this naturally applies adult-level applicable abilities only and leaves
    # juvenile pets at their level-only stats. The optimizer's own
    # skill/location matching then decides which merged stats actually apply to
    # each activity/recipe (e.g. Pixie's find_collectibles for collectibles).
    if use_pet_ability and pet_items:
        try:
            from ui.optimize_worker import _merge_pet_ability_stats
            pet_items = [
                _merge_pet_ability_stats(p) if getattr(p, 'abilities', None) else p
                for p in pet_items
            ]
        except Exception as _merge_err:
            print(f'[stats_report_worker] pet-ability merge skipped: {_merge_err!r}',
                  flush=True)

    return pet_items


def _collect_owned_consumables(character, *, include_fine=True,
                               min_owned_enabled=False, min_owned=5,
                               min_owned_op='lt'):
    """Owned consumables come from character.items where the item has a
    `duration` attribute (mirrors the column-2 path's filter). Returns a
    list of Consumable objects ready for optimize_activity_gearsets.CONSUMABLE_ITEMS."""
    consumables = []
    items = getattr(character, 'items', None) or {}
    try:
        items_iter = items.items()
    except AttributeError:
        return consumables
    for item, qty in items_iter:
        try:
            owned_qty = int(qty)
        except (TypeError, ValueError):
            owned_qty = 0
        if owned_qty <= 0:
            continue
        if hasattr(item, 'duration'):
            consumables.append(item)
    # Apply global Consumable Options (Include Fine Consumables + "Ignore
    # consumables I own X or less of"). Fine and normal are distinct owned
    # items, so they are counted separately. Inlined (no cross-module import)
    # so the Pyodide local-worker path stays self-contained.
    if not include_fine or min_owned_enabled:
        try:
            threshold = int(min_owned)
        except (TypeError, ValueError):
            threshold = 0
        _op = str(min_owned_op or 'lt').lower()
        if _op not in ('lt', 'lte'):
            _op = 'lt'
        filtered = []
        for c in consumables:
            name = getattr(c, 'name', '') or ''
            is_fine = name.endswith('(Fine)') or name.endswith(' (Fine)')
            if not include_fine and is_fine:
                continue
            if min_owned_enabled:
                try:
                    q = int(items.get(c, 0))
                except Exception:
                    q = 0
                if (q <= threshold) if _op == 'lte' else (q < threshold):
                    continue
            filtered.append(c)
        consumables = filtered
    return consumables


def _filter_pet_consumable_for_activity(activity, pet_pool, consumable_pool):
    """Drop pets/consumables whose stats don't apply to the activity's
    primary skill. Matches the column-2 path's filter at
    optimize_worker._filter_pet_consumable_candidates_by_skill — without
    this, a Foraging-scoped pet would be picked for a Mining job purely
    to fill the slot, which is misleading for the user."""
    primary_skill = (getattr(activity, 'primary_skill', '') or '').lower()
    if not primary_skill:
        return list(pet_pool), list(consumable_pool)

    def _has_applicable_stats(item, allow_global):
        # `item.get_stats_for_skill(skill)` returns the stats dict scoped
        # to that skill; non-applicable items return {} or None.
        try:
            stats = item.get_stats_for_skill(primary_skill)
            if stats:
                return True
        except Exception:
            pass
        if allow_global:
            try:
                stats = item.get_stats_for_skill('global')
                if stats:
                    return True
            except Exception:
                pass
        return False

    # Pets do NOT match 'global'-scoped stats (mirrors the
    # column-2 path); consumables DO.
    filtered_pets = [p for p in pet_pool if _has_applicable_stats(p, allow_global=False)]
    filtered_consumables = [c for c in consumable_pool if _has_applicable_stats(c, allow_global=True)]
    return filtered_pets, filtered_consumables


# Sessions gated for the exact XP/step optimizer experiment. Mirrors
# ui.database._EXACT_XP_OPTIMIZER_ENABLED, but kept here too because the Pyodide
# bundle EXCLUDES ui/database.py -- the LOCAL (browser) path gates via this.
_EXACT_XP_SESSIONS = {'00000000-0000-0000-0000-000000000000'}

# Bundle-safe allowlist for the NEW (meet-in-the-middle) optimizer. This set is
# embedded in the Pyodide bundle, so it is the ONLY thing that enables the new
# optimizer on local/browser runs (which cannot read the server DB). Add tester
# session UUIDs here to let them try the new optimizer in prod. Keep in sync
# with DatabaseManager._NEW_OPTIMIZER_ALWAYS_ENABLED (the server-side mirror).
_NEW_OPTIMIZER_SESSIONS = {'00000000-0000-0000-0000-000000000000'}


def exact_xp_enabled_for(session_uuid, db_path=None):
    """True if the exact XP optimizer should run for this session.

    Works on BOTH the server path (run_worker) and the local/Pyodide path
    (optimize-local-worker.js) -- allowlist first (bundle-safe), then the
    DatabaseManager feature flag when available (server / admin-enabled).

    GA 2026-07-29: the exact optimizer is now the DEFAULT for ALL sessions --
    the FAC gate is removed by returning True unconditionally. The allowlist +
    feature-flag checks below are kept (unreachable) for reference / quick revert.
    """
    return True
    if session_uuid in _EXACT_XP_SESSIONS or session_uuid in _NEW_OPTIMIZER_SESSIONS:
        return True
    try:
        from ui.database import DatabaseManager
        _db = DatabaseManager(db_path)
        return bool(_db.has_feature(session_uuid, 'exact_xp_optimizer')
                    or _db.has_feature(session_uuid, 'new_optimizer'))
    except Exception:
        return False


def compute_region_access(session_uuid, db_path=None):
    """Return (unlocked_regions, locked_locations) for a session.

    unlocked_regions is a set of region keys, or None when it couldn't be
    computed (meaning "apply no region filter"). locked_locations is a set.

    This is the SINGLE source of truth for region access — run_worker uses it,
    AND app.py passes its result into the local/Pyodide run params so the
    browser does NOT recompute it DB-free. The browser recomputation diverged
    from the server (e.g. it missed 'jarvonia' for some characters and dropped
    "Litter looting in Kallaheim" — 2 XP scopes — from local runs). Computing
    it once, server-side, keeps local and server identical.
    """
    try:
        from ui.database import DatabaseManager as _DB
        _session = _DB(db_path).get_session(session_uuid) or {}
        _cc = _session.get('character_config') or {}
        if isinstance(_cc, str):
            _cc = json.loads(_cc)
        from optimize_travel_gearsets import detect_unlocked_regions, detect_locked_locations
        _ri = detect_unlocked_regions(_cc)
        _ur = {r for r, v in (_ri.get('unlocked') or _ri).items() if v} if isinstance(_ri, dict) else set()
        # ghostly/spectral are the charter realm BEYOND Wraithwater — only
        # unlocked with the Charter of the Drowned, not on Wallisia entry.
        _has_charter = any(
            (c if isinstance(c, str) else (c.get('name') or c.get('id') or c.get('export_name') or ''))
            .lower().replace(' ', '_').replace("'", '') == 'charter_of_the_drowned'
            for c in (_cc.get('collectibles') or [])
        )
        if _has_charter:
            _ur.update({'ghostly', 'spectral'})
        _ll = detect_locked_locations(_cc) or set()
        return _ur, _ll
    except Exception as e:
        print(f'[stats_report_worker] compute_region_access failed: {e}')
        return None, set()


def run_fastest_craft_category(session_uuid: str, db_path: str,
                               selected_categories: Optional[List[str]],
                               run_id: Optional[str] = None,
                               base_completed: int = 0,
                               base_total: int = 0) -> int:
    """Run the Fastest Craft compute for the goals-report `fastest_craft`
    category over the selected prefixed chip ids, persisting into
    fastest_craft_results. Never raises — a failure
    here must not fail the rest of the run. Returns the item count (0 on error).

    Progress: when `run_id` is given, the run's `total_jobs` is extended by the
    number of Fastest Craft items to solve and `completed_jobs` is advanced as
    each item finishes, so the goals-report progress bar reflects the (slow,
    12-solves-per-item) compute instead of sitting at 0/0. `base_completed` /
    `base_total` carry the regular-job counts so the combined denominator is
    correct when fastest_craft runs alongside other categories.
    """
    try:
        from ui.database import DatabaseManager
        from ui.fastest_craft import run_fastest_craft, enumerate_craftable_items, VARIANTS, QUALITIES
        db = DatabaseManager(db_path)
        session = db.get_session(session_uuid) or {}
        session_data = session.get('character_config') or {}
        ui_config = session.get('ui_config') or {}
        if isinstance(ui_config, str):
            try:
                ui_config = json.loads(ui_config)
            except Exception:
                ui_config = {}
        selected = set(selected_categories) if selected_categories else None

        def _set_counts(completed, total):
            if not run_id:
                return
            try:
                conn = db._get_connection()
                conn.execute(
                    "UPDATE stats_report_runs SET total_jobs = ?, completed_jobs = ? "
                    "WHERE id = ?", (int(total), int(completed), run_id))
                conn.commit()
            except Exception as _e:  # noqa: BLE001 — progress is best-effort
                print(f'[stats_report_worker] fc progress update failed: {_e}', flush=True)

        # Pre-set the denominator so the bar leaves 0/0 immediately, even before
        # the first (slow) item finishes.
        try:
            fc_total = len(enumerate_craftable_items(selected)) * len(VARIANTS) * len(QUALITIES)
        except Exception:
            fc_total = 0
        _set_counts(base_completed, base_total + fc_total)

        def _progress(done, total):
            # run_fastest_craft calls progress(done, total) per ITEM. Advance the
            # run's completed_jobs so the UI shows real motion (coarse: one tick
            # per item, each item = 12 B&B solves).
            _set_counts(base_completed + done, base_total + (total or fc_total))
            if done == total or done % 5 == 0:
                print(f'[stats_report_worker] fastest_craft [{done}/{total}]', flush=True)

        res = run_fastest_craft(session_uuid, selected, session_data, ui_config,
                                db=db, owned_counts=None, progress=_progress,
                                log=lambda *a, **k: print(*a, flush=True))
        count = int(res.get('count', 0) or 0)
        print(f'[stats_report_worker] fastest_craft complete: {count} items')
        return count
    except Exception as e:  # noqa: BLE001 — isolated from the rest of the run
        print(f'[stats_report_worker] fastest_craft failed (non-fatal): {e!r}', file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 0


def run_worker(session_uuid: str, run_id: str, db_path: str,
               categories: List[str], skills: List[str],
               notify: bool, mode: str,
               include_pets: bool = False, include_consumables: bool = False,
               use_pet_ability: bool = False,
               use_fine_inputs: bool = False,
               stale_only: bool = False,
               kinds: Optional[List[str]] = None,
               chests_filter: Optional[List[str]] = None,
               skills_by_category: Optional[dict] = None,
               chests_by_category: Optional[dict] = None,
               target_categories: Optional[List[str]] = None,
               include_fine: bool = False,
               include_fine_consumables: bool = True,
               consumable_min_owned_enabled: bool = False,
               consumable_min_owned: int = 5,
               consumable_min_owned_operator: str = 'lt',
               consumable_use_hidden: bool = False,
               include_unavailable: Optional[dict] = None,
               fastest_craft_categories: Optional[List[str]] = None):
    """Main worker logic — builds jobs, runs them concurrently, completes run.

    stale_only: when True, filter the built jobs to only those flagged stale
    or newly-unlocked in stats_report_stale_scopes for this session. Default
    False runs every job in the configured categories+skills scope.
    
    kinds: subset of ['gear','tools','eggs','collectibles']. Worker filters
    new_items jobs to only the requested kinds. Default None = all 4 (the
    pre-filter behavior). Empty list also resolves to all 4 (defensive —
    treat empty as "no filter" rather than "no jobs").

    chests_filter: list of chest display names to include (e.g.
    ['Mining chest', 'Foraging chest']). Worker filters chest_jobs +
    chests_recipes_jobs to only those chests. Default None / empty =
    all chests (preserves pre-2026-06-02 behavior). Plumbed from the
    --chests CLI arg / /api/stats-report/run body.chests / WTO panel
    selection.

    fastest_craft_categories: prefixed Fastest Craft chip ids ('gear:rings',
    'cons:cooking', 'mat:bar', ...) for the fastest_craft category ([] = every
    craftable output). Runs after the regular jobs, before the
    run is marked complete. None (merge / resume spawns, which don't carry the
    selection) skips it rather than solving every crafted item.
    """
    _RECIPE_FRONTIER_CACHE.clear()  # run-scoped: never reuse frontiers across runs
    from ui.database import DatabaseManager
    run_fc = 'fastest_craft' in categories and fastest_craft_categories is not None

    print(f'[stats_report_worker] Starting run {run_id} for session {session_uuid}')
    print(f'[stats_report_worker] Categories: {categories}, Skills: {skills}, Mode: {mode}')

    # Reset per-run stale-detection memo caches (snapshot + effective-owned
    # bitmap). One run per worker process today, but clear defensively in case
    # run_worker is ever invoked twice in a process or from tests.
    _reset_stale_memo()
    print(f'[stats_report_worker] include_pets={include_pets} include_consumables={include_consumables} use_pet_ability={use_pet_ability}')

    # Load character
    character = load_character(session_uuid, db_path)
    print(f'[stats_report_worker] Loaded character: {getattr(character, "name", "unknown")}')

    # [EXACT XP optimizer] feature gate -- ON only for opted-in sessions. The
    # gated hook in run_optimizer_for_job then runs the exact B&B for xp jobs.
    globals()['_EXACT_XP_MODE'] = exact_xp_enabled_for(session_uuid, db_path)
    if globals().get('_EXACT_XP_MODE'):
        print('[stats_report_worker] EXACT_XP_MODE enabled for this session')

    # Build owned-pet and owned-consumable lists ONCE up-front so every
    # job's optimizer call can reuse the same pool. Each helper is
    # tolerant of empty/missing data — returns [] when the user has no
    # pets / no consumables in their character config.
    # 2026-08-31 (jwbail): stash the run-level "use pet ability" flag on a
    # module global so _extract_pet_consumable_meta can mark the chosen pet's
    # slot with useAbility=true (so Equip checks column-2's per-pet "use
    # ability" box). Mirrors the other run-scoped worker globals
    # (_NEW_ITEMS_OWNERSHIP, _UNLOCKED_REGIONS, ...). The local Pyodide path
    # sets srw._USE_PET_ABILITY directly (optimize-local-worker.js).
    globals()['_USE_PET_ABILITY'] = bool(use_pet_ability)
    globals()['_USE_FINE_INPUTS'] = bool(use_fine_inputs)
    globals()['_USE_HIDDEN_CONSUMABLES'] = bool(consumable_use_hidden)
    # Include-unavailable dimensions for this run (EFFECTIVE flags derived in
    # ui/app.py). None / missing keys fall back to the legacy default (inputs
    # included-with-warning, everything else excluded). The local Pyodide path
    # sets srw._INCL_UNAVAIL directly (optimize-local-worker.js).
    globals()['_INCL_UNAVAIL'] = _normalize_incl_unavail(include_unavailable)
    print(f'[stats_report_worker] include_unavailable={globals()["_INCL_UNAVAIL"]}')
    pet_items_pool = _build_pet_items(session_uuid, db_path, use_pet_ability) if include_pets else []
    consumable_items_pool = _collect_owned_consumables(
        character,
        include_fine=include_fine_consumables,
        min_owned_enabled=consumable_min_owned_enabled,
        min_owned=consumable_min_owned,
        min_owned_op=consumable_min_owned_operator,
    ) if include_consumables else []
    # 2026-06-17 (jwbail): build the hide list once and feed it to every job's
    # optimizer (IGNORED_ITEMS + consumable filter) so the goals report never
    # recommends gear / items / collectibles / eggs / consumables the user hid.
    hidden_items = _build_hidden_items(session_uuid, db_path)
    print(f'[stats_report_worker] hidden_items={len(hidden_items)}')
    print(f'[stats_report_worker] pet_pool={len(pet_items_pool)} consumable_pool={len(consumable_items_pool)}')

    # Get owned item names for new_items category. We compute the
    # full per-category ownership lookup (items / collectibles /
    # pet species / available eggs) and stash it at module level so
    # build_new_items_jobs can read it without widening its signature
    # (the legacy `owned_item_names` arg is kept for back-compat but
    # ignored when the richer lookup is present).
    owned_item_names = get_owned_item_names(session_uuid, db_path)
    try:
        globals()['_NEW_ITEMS_OWNERSHIP'] = get_ownership_lookup(session_uuid, db_path)
    except Exception as e:
        print(f'[stats_report_worker] Failed to build ownership lookup: {e}')
        globals()['_NEW_ITEMS_OWNERSHIP'] = None

    # 2026-05-22: precompute accessible-locations set so build_*_jobs can
    # filter out inaccessible locations (e.g. Crown of Cinders for a
    # character without Charter of the Drowned). Uses the SAME helpers
    # the crafting tree spoiler-protection code uses
    # (detect_unlocked_regions + detect_locked_locations) so behavior
    # stays consistent across the app. The result is stashed on a module
    # global so build_*_jobs can read it without widening their
    # signatures.
    try:
        _unlocked_regions, _locked_locations = compute_region_access(session_uuid, db_path)
        globals()['_UNLOCKED_REGIONS'] = _unlocked_regions
        globals()['_LOCKED_LOCATIONS'] = _locked_locations
        print(f'[stats_report_worker] unlocked_regions='
              f'{sorted(_unlocked_regions) if _unlocked_regions is not None else None}, '
              f'locked_locations={sorted(_locked_locations)}')
    except Exception as e:
        print(f'[stats_report_worker] Failed to compute location accessibility: {e}')
        globals()['_UNLOCKED_REGIONS'] = None  # None = no filter
        globals()['_LOCKED_LOCATIONS'] = set()

    # Build jobs based on selected categories
    all_jobs: List[ReportJob] = []

    # 2026-06-16 (jwbail): per-category skill/chest selection. xp/coins apply
    # their own skill list; chests/chests_recipes their own chest filter. An
    # absent category key falls back to the flat skills / chests_filter.
    _sbc = skills_by_category or {}
    _cbc = chests_by_category or {}

    def _skills_for(cat):
        v = _sbc.get(cat)
        return v if isinstance(v, list) else skills

    def _chests_for(cat):
        v = _cbc.get(cat)
        return v if isinstance(v, list) else chests_filter

    if 'xp' in categories:
        xp_jobs = build_xp_jobs(run_id, session_uuid, _skills_for('xp'), character)
        all_jobs.extend(xp_jobs)
        print(f'[stats_report_worker] Built {len(xp_jobs)} XP jobs')

    if 'new_items' in categories:
        ni_jobs = build_new_items_jobs(run_id, session_uuid, character, owned_item_names)
        # 2026-05-22 (T17 follow-up): WTO sub-filter for new_items.
        # build_new_items_jobs emits one job per (activity, kind) with
        # job.skill_name = kind. Filter here so only the user-requested
        # kinds reach the optimizer / DB write.
        kinds_set = set((kinds or ['gear', 'tools', 'eggs', 'collectibles']))
        if not kinds_set:
            kinds_set = {'gear', 'tools', 'eggs', 'collectibles'}
        if kinds_set != {'gear', 'tools', 'eggs', 'collectibles'}:
            before = len(ni_jobs)
            ni_jobs = [j for j in ni_jobs if (j.skill_name or '').lower() in kinds_set]
            print(f'[stats_report_worker] new_items kind filter '
                  f'({sorted(kinds_set)}): {before} -> {len(ni_jobs)} jobs')
        all_jobs.extend(ni_jobs)
        print(f'[stats_report_worker] Built {len(ni_jobs)} new_items jobs')

        # Reconcile stored new_items rows against the freshly-built valid
        # scope set. ni_jobs (built from the FULL activity set above, before
        # the stale_only filter applied later) is the authoritative list of
        # (activity, kind) scopes that still have an unowned drop. Any stored
        # new_items row whose scope is no longer in that set is orphaned —
        # e.g. once the user owns the tiger pet, Box trapping stops yielding a
        # Tiger egg job, but the additive read keeps showing the old row
        # forever (bug 01797bdb). A re-run never overwrites it, so purge it
        # here. Scoped to kinds_set so a kind-filtered run can't wipe valid
        # rows of kinds it didn't recompute.
        try:
            valid_scopes = {
                (j.activity.name, (j.skill_name or '').lower())
                for j in ni_jobs if getattr(j, 'activity', None)
            }
            pruned = DatabaseManager(db_path).prune_orphaned_new_items_results(
                session_uuid, valid_scopes, kinds_set)
            if pruned:
                print(f'[stats_report_worker] pruned {pruned} orphaned '
                      f'new_items result row(s)')
        except Exception as _pe:
            print(f'[stats_report_worker] new_items orphan prune failed: {_pe}')

    if 'chests' in categories:
        chest_jobs = build_chest_jobs(run_id, session_uuid, character)
        # 2026-06-02 (jwbail): apply WTO chest filter. chests_filter
        # is None when the user wants all chests; a non-None list
        # restricts to that subset. Per-category as of 2026-06-16.
        _cf_act = _chests_for('chests')
        if _cf_act:
            chests_set = set(_cf_act)
            before_ch = len(chest_jobs)
            chest_jobs = [j for j in chest_jobs if (j.chest_name or '') in chests_set]
            print(f'[stats_report_worker] chest filter ({sorted(chests_set)}): '
                  f'{before_ch} -> {len(chest_jobs)} chest jobs')
        all_jobs.extend(chest_jobs)
        print(f'[stats_report_worker] Built {len(chest_jobs)} chest jobs')

    if 'chests_recipes' in categories:
        # Chest farming via recipes — iterate RECIPES_BY_NAME, find
        # chest drops on each recipe, emit precomputed-metric jobs.
        # Was previously calling build_chest_jobs which returned the
        # SAME activities as the chests category (just relabeled);
        # user noticed that on 2026-05-21.
        recipe_chest_jobs = build_chests_recipes_jobs(run_id, session_uuid, character)
        # 2026-06-02 (jwbail): same chest filter applies here. Only
        # recipes whose target chest is in the selected set survive.
        # Per-category as of 2026-06-16.
        _cf_rec = _chests_for('chests_recipes')
        if _cf_rec:
            chests_set = set(_cf_rec)
            before_rc = len(recipe_chest_jobs)
            recipe_chest_jobs = [j for j in recipe_chest_jobs if (j.chest_name or '') in chests_set]
            print(f'[stats_report_worker] chest filter ({sorted(chests_set)}): '
                  f'{before_rc} -> {len(recipe_chest_jobs)} chests_recipes jobs')
        all_jobs.extend(recipe_chest_jobs)
        print(f'[stats_report_worker] Built {len(recipe_chest_jobs)} chests_recipes jobs')

    if 'coins' in categories:
        coins_jobs = build_coins_jobs(run_id, session_uuid, _skills_for('coins'), character)
        all_jobs.extend(coins_jobs)
        print(f'[stats_report_worker] Built {len(coins_jobs)} coins jobs')

    if 'target_items' in categories:
        ti_jobs = build_target_items_jobs(run_id, session_uuid, character,
                                         include_fine=include_fine,
                                         target_groups=target_categories)
        # target_groups filter is now applied inside build_target_items_jobs
        all_jobs.extend(ti_jobs)
        print(f'[stats_report_worker] Built {len(ti_jobs)} target_items jobs')

    # Stats-report stale-detection: filter to stale/newly-unlocked scopes only
    # when --stale-only true. This is the new default behavior — Optimize button
    # always sends stale_only=true, and the filter computes stale list dynamically
    # via detect_stale_scopes (not from cache, which may be empty on first run).
    if stale_only:
        before = len(all_jobs)
        # target_items has its OWN stale filter (_filter_target_items_jobs_to_stale)
        # that uses the built jobs as the source of truth for the applicable set,
        # instead of detect_stale_scopes/enumerate_applicable_sources (which don't
        # emit target_items and would drop everything -> the old 0/0 failure mode
        # that forced the always-run bypass). It keeps only new / version-bumped /
        # gear-or-input-changed (item, activity) scopes and prunes orphaned rows.
        _ti_jobs = [j for j in all_jobs if getattr(j, 'category', None) == 'target_items']
        _other = [j for j in all_jobs if getattr(j, 'category', None) != 'target_items']
        _ti_kept = _filter_target_items_jobs_to_stale(_ti_jobs, session_uuid, db_path)
        all_jobs = _ti_kept + _filter_jobs_to_stale_only(_other, session_uuid, db_path)
        print(f'[stats_report_worker] stale_only filter: {before} -> {len(all_jobs)} jobs '
              f'(target_items {len(_ti_jobs)} -> {len(_ti_kept)} stale)')
        # Update total_jobs in the DB so progress UI shows accurate denominator
        try:
            db_local = DatabaseManager(db_path)
            conn_local = db_local._get_connection()
            conn_local.execute(
                "UPDATE stats_report_runs SET total_jobs = ? WHERE id = ?",
                (len(all_jobs), run_id),
            )
            conn_local.commit()
        except Exception as _e:
            print(f'[stats_report_worker] Failed to update total_jobs: {_e}')

    if not all_jobs:
        msg = 'No jobs to run — completing run immediately'
        if stale_only:
            msg = 'No stale or newly-unlocked scopes — nothing to optimize'
        print(f'[stats_report_worker] {msg}')
        if run_fc:
            run_fastest_craft_category(session_uuid, db_path, fastest_craft_categories,
                                       run_id=run_id, base_completed=0, base_total=0)
        db = DatabaseManager(db_path)
        # Update total_jobs to actual count so UI shows 0/0 correctly — but only
        # when fastest_craft did NOT run (it owns the denominator when present).
        if not run_fc:
            try:
                conn = db._get_connection()
                conn.execute("UPDATE stats_report_runs SET total_jobs = 0 WHERE id = ?", (run_id,))
                conn.commit()
            except Exception:
                pass
        fingerprint = db.compute_inventory_fingerprint(session_uuid)
        db.complete_stats_report_run(run_id, fingerprint)
        return

    # In merge mode, register new jobs with the DB
    if mode == 'merge':
        db = DatabaseManager(db_path)
        new_job_dicts = [
            {
                'id': job.job_id,
                'category': job.category,
                'activity_name': job.activity.name if job.activity else None,
                'skill_name': job.skill_name,
                'chest_name': job.chest_name,
                'session_uuid': session_uuid,
            }
            for job in all_jobs
        ]
        db.merge_stats_report_jobs(run_id, new_job_dicts)
        print(f'[stats_report_worker] Merged {len(all_jobs)} jobs into existing run')
    else:
        # Fresh run: update total_jobs count
        db = DatabaseManager(db_path)
        db._get_connection().execute(
            'UPDATE stats_report_runs SET total_jobs = ? WHERE id = ?',
            (len(all_jobs), run_id)
        )
        db._get_connection().commit()

    print(f'[stats_report_worker] Running {len(all_jobs)} jobs with {STATS_REPORT_WORKER_CONCURRENCY} workers')

    # Execute jobs concurrently
    with ThreadPoolExecutor(max_workers=STATS_REPORT_WORKER_CONCURRENCY) as executor:
        futures = {
            executor.submit(execute_job, job, character, db_path,
                            pet_items_pool, consumable_items_pool,
                            hidden_items=hidden_items): job
            for job in all_jobs
        }
        completed = 0
        for future in as_completed(futures):
            job = futures[future]
            try:
                success = future.result()
                completed += 1
                status = 'OK' if success else 'FAILED'
                print(f'[stats_report_worker] [{completed}/{len(all_jobs)}] {job.category}/{job.skill_name or job.chest_name}: {status}')
            except Exception as e:
                completed += 1
                print(f'[stats_report_worker] [{completed}/{len(all_jobs)}] Job exception: {e}')

    if run_fc:
        run_fastest_craft_category(session_uuid, db_path, fastest_craft_categories,
                                   run_id=run_id, base_completed=len(all_jobs),
                                   base_total=len(all_jobs))

    # Complete the run
    db = DatabaseManager(db_path)
    fingerprint = db.compute_inventory_fingerprint(session_uuid)
    db.complete_stats_report_run(run_id, fingerprint)
    print(f'[stats_report_worker] Run {run_id} complete. Fingerprint: {fingerprint[:16]}...')

    # Stats-report stale-detection: update snapshot cache so the next /stale-check
    # has a prev snapshot to diff against. Without this, every page load looks
    # like "first run" because there's nothing to diff.
    try:
        from util.stats_report.state_snapshot import from_char_config as _snap_from_cc
        # 2026-05-25 (jwbail): use from_char_config instead of from_character.
        # The worker's load_character() builds a "minimal export" Character whose
        # _all_items is empty -- from_character() reads _all_items first and
        # returns an empty owned_items frozenset. Same shape as the endpoints
        # use now, so prev/curr snapshots compare cleanly.
        from ui.database import DatabaseManager as _DB
        _db = _DB(db_path)
        _sess = _db.get_session(session_uuid) or {}
        _cc = _sess.get('character_config') or {}
        _ui = _sess.get('ui_config') or {}
        snapshot = _snap_from_cc(_cc, _ui)
        import time as _t
        conn = db._get_connection()
        conn.execute(
            "INSERT OR REPLACE INTO character_state_snapshot_cache "
            "(session_uuid, snapshot_json, captured_at) VALUES (?, ?, ?)",
            (session_uuid, snapshot.to_json(), int(_t.time())),
        )
        # Clear the stale_scopes cache for any scopes we just wrote
        conn.execute("DELETE FROM stats_report_stale_scopes WHERE session_uuid = ?", (session_uuid,))
        conn.commit()
        print('[stats_report_worker] Snapshot cache updated, stale-scopes cleared')
    except Exception as _e:
        print(f'[stats_report_worker] Snapshot cache update failed: {_e}')

    # Send push notification if requested
    if notify:
        sent, failed = send_push_notification_sync(session_uuid, db_path, run_id)
        print(f'[stats_report_worker] Push notification: sent={sent} failed={failed}')


# ============================================================================
# ENTRY POINT
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Stats Report Worker')
    parser.add_argument('--session-uuid', required=True, help='Session UUID')
    parser.add_argument('--run-id', required=True, help='Run UUID')
    parser.add_argument('--db-path', required=True, help='Path to SQLite database')
    parser.add_argument('--categories', required=True, help='JSON array of categories')
    parser.add_argument('--skills', default='[]', help='JSON array of skill names (empty = all)')
    parser.add_argument('--notify', default='false', help='Send push notification on complete')
    parser.add_argument('--include-pets', default='false',
                        help='Include owned pets in optimization (true/false)')
    parser.add_argument('--include-consumables', default='false',
                        help='Include owned consumables in optimization (true/false)')
    parser.add_argument('--use-pet-ability', default='false',
                        help='When true, merge each candidate pet\'s ACTIVE applicable '
                             'ability stats (adult-level only) into scoring — mirrors the '
                             'goals report "Always use active applicable pet ability" '
                             'toggle and column-2\'s per-pet "use ability" box. '
                             '2026-08-31 (jwbail).')
    parser.add_argument('--include-fine-consumables', default='true',
                        help='Consumable Options: include Fine consumable variants '
                             '(true/false, default true).')
    parser.add_argument('--use-fine-inputs', default='false',
                        help='Use fine inputs (R2): project the Fine variant of a hunting '
                             'activity input item (e.g. arrows) when one exists '
                             '(true/false, default false).')
    parser.add_argument('--consumable-min-owned-enabled', default='false',
                        help='Consumable Options: enable the "ignore consumables I own X '
                             'or less of" threshold (true/false, default false).')
    parser.add_argument('--consumable-min-owned', default='5',
                        help='Consumable Options: threshold X for the min-owned filter '
                             '(integer 1..100, default 5).')
    parser.add_argument('--consumable-min-owned-operator', default='lt',
                        help='Consumable Options: comparator for the min-owned threshold — '
                             '"lt" (< / fewer than, default) or "lte" (<= / fewer than or equal to).')
    parser.add_argument('--consumable-use-hidden', default='false',
                        help='Consumable Options: consider consumables the user hid '
                             '(column-1 hide) too (true/false, default false).')
    parser.add_argument('--include-unavailable', default='null',
                        help='JSON object of EFFECTIVE include-unavailable dimensions '
                             '{level,location,gear,inputs,other} (booleans). Surfaces '
                             'activities the report would normally hide because they are '
                             'gated only by the enabled dimension(s). Default "null" '
                             'reproduces legacy behavior (inputs included-with-warning, '
                             'everything else excluded).')
    parser.add_argument('--stale-only', default='false',
                        help='When true, filter jobs to scopes flagged stale or newly-unlocked '
                             '(stats-report stale-detection feature). Default false runs everything '
                             'in the configured categories+skills scope.')
    parser.add_argument('--mode', default='fresh', choices=['fresh', 'merge'],
                        help='fresh = new run, merge = add to existing run')
    parser.add_argument('--kinds', default='["gear","tools","eggs","collectibles"]',
                        help='JSON array of new_items sub-kinds to include '
                             '(subset of [gear, tools, eggs, collectibles]). '
                             'Worker filters build_new_items_jobs output to '
                             'only the requested kinds. Default = all 4.')
    parser.add_argument('--chests', default='null',
                        help='JSON array of chest display names to include '
                             '(subset of all chests, e.g. ["Mining chest"]). '
                             'Worker filters build_chest_jobs and '
                             'build_chests_recipes_jobs output to only the '
                             'requested chests. Default = "null" (all '
                             'chests). 2026-06-02 (jwbail): user-reported '
                             'WTO chest filter was a no-op — selecting one '
                             'chest still ran all 236.')
    parser.add_argument('--skills-by-category', default='{}',
                        help='JSON object {categoryKey: [skill names]} for per-category skill '
                             'selection (xp / coins tuned independently). Absent key falls back '
                             'to --skills. 2026-06-16 (jwbail).')
    parser.add_argument('--chests-by-category', default='{}',
                        help='JSON object {categoryKey: [chest names]} for per-category chest '
                             'selection (chests / chests_recipes tuned independently). Absent key '
                             'falls back to --chests. 2026-06-16 (jwbail).')
    parser.add_argument('--target-categories', default='null',
                        help='JSON array of target-category slugs (gems, normal_items, '
                             'fine_items, etc.) for the target_items WTO sub-filter. Worker '
                             'filters build_target_items_jobs to only these categories. '
                             '"null"/empty = all categories. 2026-08-11 (jwbail).')
    parser.add_argument('--include-fine', default='false',
                        help='When true, target_items includes fine item variants as separate '
                             'leaves and adds fine sell value to currency groups. '
                             '2026-08-12 (jwbail, v2 keyword grouping).')
    parser.add_argument('--fastest-craft-categories', default='null',
                        help='JSON array of prefixed Fastest Craft chip ids (e.g. '
                             '["tools:pickaxes", "mat:bar"]) for the fastest_craft category. '
                             '"[]" = every craftable output.')
    parser.add_argument('--resume', default='false',
                        help='When true, this is a respawned worker after container restart. '
                             'Flips the run row status from interrupted/running back to running '
                             'and forces stale_only filtering so already-completed jobs are skipped. '
                             'Triggered by ui/app.py::_resume_orphan_runs at startup.')
    parser.add_argument('--fast', default='false',
                        help='Testing mode: skip local-search refinement and use just the greedy '
                             'initial gearset. ~10x faster wall-clock per job but suboptimal '
                             'gearsets. Sets MAX_ITERATIONS=0 on both optimizer modules so the '
                             'while-loop exits before any swap pass runs.')

    args = parser.parse_args()

    # ── Background CPU throttle (2026-08-17) ─────────────────────────────
    # These optimization workers are CPU-heavy and, at default priority,
    # competed head-to-head with uvicorn for CPU — starving request handling
    # and causing slow page loads / intermittent 502s under load (bug reports
    # 2026-08-15..17). Renice ourselves so the kernel always preempts us for
    # interactive traffic. This is work-conserving: a lone run still gets a
    # full core (niceness only matters under contention), while many concurrent
    # runs share CPU and slow down gracefully instead of flattening the box.
    # Tunable via STATS_REPORT_WORKER_NICE (0..19, default 15); 0 disables.
    # Best-effort — never abort the run over a failed renice.
    try:
        _nice_target = max(0, min(19, int(os.environ.get('STATS_REPORT_WORKER_NICE', '15'))))
        if _nice_target:
            os.nice(_nice_target)
            print(f'[stats_report_worker] reniced to +{_nice_target} '
                  f'(background CPU throttle)', flush=True)
    except Exception as _nice_err:
        print(f'[stats_report_worker] renice skipped ({_nice_err!r})', flush=True)

    try:
        categories = json.loads(args.categories)
        skills = json.loads(args.skills)
        notify = args.notify.lower() in ('true', '1', 'yes')
        include_pets = args.include_pets.lower() in ('true', '1', 'yes')
        include_consumables = args.include_consumables.lower() in ('true', '1', 'yes')
        use_pet_ability = args.use_pet_ability.lower() in ('true', '1', 'yes')
        include_fine_consumables = args.include_fine_consumables.lower() in ('true', '1', 'yes')
        use_fine_inputs = args.use_fine_inputs.lower() in ('true', '1', 'yes')
        consumable_min_owned_enabled = args.consumable_min_owned_enabled.lower() in ('true', '1', 'yes')
        try:
            consumable_min_owned = max(1, min(100, int(args.consumable_min_owned)))
        except (TypeError, ValueError):
            consumable_min_owned = 5
        consumable_min_owned_operator = (getattr(args, 'consumable_min_owned_operator', 'lt') or 'lt').lower()
        if consumable_min_owned_operator not in ('lt', 'lte'):
            consumable_min_owned_operator = 'lt'
        consumable_use_hidden = args.consumable_use_hidden.lower() in ('true', '1', 'yes')
        try:
            include_unavailable = json.loads(args.include_unavailable)
            include_unavailable = include_unavailable if isinstance(include_unavailable, dict) else None
        except Exception:
            include_unavailable = None
        stale_only = args.stale_only.lower() in ('true', '1', 'yes')
        is_resume = args.resume.lower() in ('true', '1', 'yes')
        is_fast = args.fast.lower() in ('true', '1', 'yes')
        try:
            kinds = json.loads(args.kinds)
            if not isinstance(kinds, list):
                kinds = ['gear', 'tools', 'eggs', 'collectibles']
        except Exception:
            kinds = ['gear', 'tools', 'eggs', 'collectibles']
        # 2026-06-02 (jwbail): WTO chest filter. JSON-decode the
        # --chests arg ("null" / "[]" / array). null + empty resolve
        # to None (= run all chests, the prior behavior); a non-empty
        # list filters the chest_jobs / chests_recipes_jobs builders.
        try:
            chests_filter = json.loads(args.chests)
            if not isinstance(chests_filter, list) or not chests_filter:
                chests_filter = None
        except Exception:
            chests_filter = None
        # 2026-06-16 (jwbail): per-category skill/chest selection maps.
        try:
            skills_by_category = json.loads(args.skills_by_category)
            if not isinstance(skills_by_category, dict):
                skills_by_category = {}
        except Exception:
            skills_by_category = {}
        try:
            chests_by_category = json.loads(args.chests_by_category)
            if not isinstance(chests_by_category, dict):
                chests_by_category = {}
        except Exception:
            chests_by_category = {}
        try:
            target_categories = json.loads(args.target_categories)
            if not isinstance(target_categories, list) or not target_categories:
                target_categories = None
        except Exception:
            target_categories = None
        include_fine = args.include_fine.lower() in ('true', '1', 'yes')
        try:
            fastest_craft_categories = json.loads(args.fastest_craft_categories)
            if not isinstance(fastest_craft_categories, list):
                fastest_craft_categories = None
        except Exception:
            fastest_craft_categories = None
    except json.JSONDecodeError as e:
        print(f'[stats_report_worker] Failed to parse JSON args: {e}', file=sys.stderr)
        sys.exit(1)

    # 2026-05-23 fast (greedy-only) mode: stash a module global that
    # run_optimizer_for_job and run_recipe_optimizer_for_job both read.
    # When True, both optimizer paths set MAX_ITERATIONS=0 so the
    # local-search loop exits before any swap pass runs — only the
    # greedy initial solution is returned. Trades quality for ~10x
    # speed; testing-only flag surfaced via the WTO 'Fast' checkbox.
    globals()['_FAST_MODE'] = is_fast
    if is_fast:
        print('[stats_report_worker] FAST mode enabled — greedy only, no local search', flush=True)

    # Resume mode: this worker is being respawned after container restart.
    # The run row already exists; we just need to:
    #   1. Flip status back to 'running' (it may be 'interrupted' from a clean
    #      SIGTERM, or 'running' from a SIGKILL/crash — same handling either way)
    #   2. Force stale_only=True so we skip the jobs that already wrote results
    #      (the worker's _filter_jobs_to_stale_only naturally does this via the
    #      stats_report_results PK on session+category+subcategory+source)
    #   3. Honor the original notify_on_complete from the DB row (CLI arg may be
    #      stale — DB is the source of truth on resume)
    if is_resume:
        try:
            from ui.database import DatabaseManager as _DB
            _db = _DB(args.db_path)
            _row = _db.get_stats_report_run(args.run_id)
            if _row is None:
                print(f'[stats_report_worker] --resume but run {args.run_id} not found, exiting',
                      file=sys.stderr)
                sys.exit(1)
            # Pull authoritative values from the DB row
            try:
                categories = json.loads(_row.get('categories') or '[]') if isinstance(_row.get('categories'), str) else (_row.get('categories') or [])
                skills = json.loads(_row.get('skills') or '[]') if isinstance(_row.get('skills'), str) else (_row.get('skills') or [])
            except Exception:
                pass
            notify = bool(_row.get('notify_on_complete'))
            stale_only = True  # Always — skip completed jobs
            # Flip status back to 'running' + heartbeat
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            _conn = _db._get_connection()
            _conn.execute(
                "UPDATE stats_report_runs SET status='running', last_progress_at=? WHERE id=?",
                (now, args.run_id),
            )
            _conn.commit()
            print(f'[stats_report_worker] RESUMED run {args.run_id}: '
                  f'categories={categories} skills={skills} notify={notify} stale_only=True')
        except Exception as e:
            print(f'[stats_report_worker] Resume preflight failed: {e}', file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)

    # SIGTERM handler — Docker sends SIGTERM with ~10s grace before SIGKILL.
    # Flip our row to 'interrupted' as a clean-shutdown sentinel so the new
    # container's startup sweep can distinguish "we exited cleanly" from
    # "we crashed". Either way the run gets resumed; this is purely
    # diagnostic.
    def _handle_sigterm(signum, frame):
        try:
            from ui.database import DatabaseManager as _DB
            _db = _DB(args.db_path)
            _db.mark_run_interrupted(args.run_id)
            print(f'[stats_report_worker] SIGTERM received, run {args.run_id} marked interrupted')
        except Exception as e:
            print(f'[stats_report_worker] SIGTERM handler failed: {e}', file=sys.stderr)
        sys.exit(0)
    try:
        signal.signal(signal.SIGTERM, _handle_sigterm)
    except Exception:
        pass  # Some platforms don't support SIGTERM signal handlers

    try:
        run_worker(
            session_uuid=args.session_uuid,
            run_id=args.run_id,
            db_path=args.db_path,
            categories=categories,
            skills=skills,
            notify=notify,
            mode=args.mode,
            include_pets=include_pets,
            include_consumables=include_consumables,
            use_pet_ability=use_pet_ability,
            stale_only=stale_only,
            kinds=kinds,
            chests_filter=chests_filter,
            skills_by_category=skills_by_category,
            chests_by_category=chests_by_category,
            target_categories=target_categories,
            include_fine=include_fine,
            include_fine_consumables=include_fine_consumables,
            use_fine_inputs=use_fine_inputs,
            consumable_min_owned_enabled=consumable_min_owned_enabled,
            consumable_min_owned=consumable_min_owned,
            consumable_min_owned_operator=consumable_min_owned_operator,
            consumable_use_hidden=consumable_use_hidden,
            include_unavailable=include_unavailable,
            fastest_craft_categories=fastest_craft_categories,
        )
    except Exception as e:
        print(f'[stats_report_worker] Fatal error: {e}', file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        # Mark run as failed
        try:
            from ui.database import DatabaseManager
            db = DatabaseManager(args.db_path)
            db._get_connection().execute(
                "UPDATE stats_report_runs SET status = 'failed' WHERE id = ?",
                (args.run_id,)
            )
            db._get_connection().commit()
        except Exception:
            pass
        sys.exit(1)


# Note: `if __name__ == '__main__': main()` was moved to the END of the
# file (post-2026-05-22 fix). Previously it sat here, before the helper
# functions defined below — which caused main() → run_worker() to hit
# `NameError: name '_filter_jobs_to_stale_only' is not defined` (and
# similar for _write_stats_report_result_row, _derive_*) because Python
# binds top-level defs in source order. Every run with stale_only=True
# (the default after CR-6) was crashing on its first call to
# _filter_jobs_to_stale_only without writing any progress, leaving the
# stats_report_runs row stuck at status=running, completed_jobs=0. The
# user reported "0/833 complete" stalls and earlier "stalled
# optimization" bug reports — same root cause.


# ── Stats-report stale-detection: dual-write helper ─────────────────────────
# Worker writes BOTH the legacy stats_report_gearsets row (for existing
# endpoints) AND a stats_report_results row (for stale-detection). A future
# cleanup CR removes the legacy table after all endpoints are migrated.
# See .kiro/specs/stats-report-stale-detection/ for design.

def _write_stats_report_result_row(db, job, character, result):
    """Compute dominance_bitmap + metric_inputs_hash + optimization_version
    for this job's scope and write to stats_report_results.

    For new_items category: writes one row per kind (gear/tools/eggs/
    collectibles) the activity has unowned drops in, with extras_json
    holding the chip-row item list per spec T17.
    """
    from util.stats_report.state_snapshot import CharacterStateSnapshot, from_char_config
    from util.stats_report.effective_bitmap import compute_effective_owned_bitmap
    from util.stats_report.metric_inputs import compute_metric_inputs_hash
    from util.stats_report.optimization_versions import OPTIMIZATION_VERSIONS

    # 2026-05-29 (jwbail): use from_char_config to match the snapshot
    # constructor used by /api/stats-report/state-changed and
    # /api/stats-report/stale-check. Previously this used
    # CharacterStateSnapshot.from_character(character) which builds from
    # the Character object's _all_items — but load_character() produces
    # a "minimal export" Character whose _all_items is empty / disagrees
    # with char_config.owned_items. The bitmap and metric_inputs_hash
    # stored under that snapshot were then compared at stale-check time
    # against bitmaps recomputed from a from_char_config snapshot,
    # producing false-positive item_change/input_change badges on every
    # subsequent state mutation.
    # Per-run memo: the snapshot is identical for every job in the run, so
    # build it once (from the full session) and reuse. Avoids a get_session +
    # from_char_config (large inventory JSON parse) per job.
    with _STALE_MEMO_LOCK:
        snapshot = _STALE_SNAPSHOT_CACHE.get(job.session_uuid)
    if snapshot is None:
        sess = db.get_session(job.session_uuid) or {}
        snapshot = from_char_config(
            sess.get('character_config') or {},
            sess.get('ui_config') or {},
        )
        with _STALE_MEMO_LOCK:
            _STALE_SNAPSHOT_CACHE[job.session_uuid] = snapshot

    cat = job.category
    src = job.activity.name if job.activity else (getattr(job, 'recipe_name', None) or '')
    if not src:
        return

    _rctx = _recipe_loc_ctx(job.session_uuid, db, snapshot) if cat == "chests_recipes" else None
    loc = _derive_location(job, recipe_ctx=_rctx)
    svc = _derive_service(job)
    qmode = "recipe_quality" if cat == "chests_recipes" else "activity"
    skill_for_scope = _derive_primary_skill(job)
    if not skill_for_scope:
        return

    conn = db._get_connection()
    # Required tool keywords for keyword-gated activities (e.g. Sea fishing
    # (Cage) -> {'fishing cage'}). Passed to compute_effective_owned_bitmap so
    # the cage scope's maximal set includes the best owned cage tool even when
    # a higher-WE spear/net globally dominates it — otherwise crafting the
    # cage never flips a bit and the activity never re-optimizes (bug 4038424d).
    _req_kw = _required_keywords_for_job(job)
    # Per-run memo: compute_effective_owned_bitmap is a pure function of
    # (snapshot, skill, location, quality_mode) — `service` is passed but NOT
    # used by the function (its SQL keys only on skill/location/quality_mode),
    # so it is intentionally excluded from the key. Including it over-segments
    # the cache (one entry per recipe service) and recomputes the identical
    # bitmap many times. The snapshot is constant for the run, so this
    # collapses the per-owned-item SQL scan from once-per-job to
    # once-per-distinct-scope. Failures (b"") are NOT cached so a later job with
    # the same key can retry a transient error. The required-keyword set is part
    # of the key so keyword-gated scopes don't collide with the keyword-agnostic
    # bitmap of a sibling activity sharing (skill, location, quality_mode).
    _bm_key = (skill_for_scope, loc, qmode, frozenset(_req_kw))
    with _STALE_MEMO_LOCK:
        bitmap = _STALE_BITMAP_CACHE.get(_bm_key)
    if bitmap is None:
        try:
            bitmap = compute_effective_owned_bitmap(
                snapshot, skill_for_scope, loc, svc, qmode, db=conn,
                required_keywords=_req_kw or None,
            )
            with _STALE_MEMO_LOCK:
                _STALE_BITMAP_CACHE[_bm_key] = bitmap
        except Exception:
            bitmap = b""

    if cat == "new_items":
        # Emit one row per kind (gear/tools/eggs/collectibles) the activity has
        # unowned drops in. Each row has extras_json holding the chip data.
        try:
            kind_buckets = _bucket_unowned_drops_by_kind(job, character)
        except Exception:
            kind_buckets = {}
        if not kind_buckets:
            return  # No unowned drops → R5.11 skip
        import json as _json
        for kind, items in kind_buckets.items():
            extras = _json.dumps({"chip_items": items})
            mh = compute_metric_inputs_hash(snapshot, cat, kind, src, loc, svc, db=conn)
            db.create_stats_report_result(
                session_uuid=job.session_uuid,
                category=cat,
                subcategory=kind,
                source_name=src,
                location=loc,
                service=svc,
                rank=0,
                metric_value=result.get('metric_value') or 0.0,
                metric_name=result.get('metric_name') or '',
                export_string=result.get('gearset_export') or '',
                dominance_bitmap=bitmap,
                metric_inputs_hash=mh,
                optimization_version=OPTIMIZATION_VERSIONS.get(cat, 1),
                extras_json=extras,
            )
        return

    # target_items: one row per (item, activity). Key = ('target_items',
    # group_slug, item_slug, activity_slug, 'NONE'). Stores a REAL per-scope
    # dominance_bitmap + metric_inputs_hash (via the shared _target_items_stale_
    # signals helper) so the stale filter can detect gear/state changes -- these
    # rows used to store b''/'' and the category bypassed stale detection
    # entirely (2026-08-13, target_items v3).
    if cat == 'target_items':
        import json as _json
        _tik = _target_items_scope_key(job)
        sub_ti, src_ti, loc_ti = _tik[1], _tik[2], _tik[3]
        _ti_bm, _ti_mh, _ti_scope = _target_items_stale_signals(job, snapshot, conn)
        mj = result.get('metrics_json')
        # Carry the metrics_json for display AND the EXACT bitmap scope params
        # (skill/loc/req_kw) the bitmap was computed under, so the read-side
        # badge (compute_target_items_stale_groups) recomputes the bitmap with
        # byte-identical inputs instead of re-deriving loc from metrics_json.
        if isinstance(mj, dict):
            _extras_obj = dict(mj)
        elif mj:
            try:
                _extras_obj = _json.loads(mj) if isinstance(mj, str) else {}
            except Exception:
                _extras_obj = {}
        else:
            _extras_obj = {}
        if not isinstance(_extras_obj, dict):
            _extras_obj = {}
        _extras_obj["_stale_scope"] = _ti_scope
        extras_str = _json.dumps(_extras_obj)
        db.create_stats_report_result(
            session_uuid=job.session_uuid,
            category='target_items',
            subcategory=sub_ti,
            source_name=src_ti,
            location=loc_ti,
            service='NONE',
            rank=0,
            metric_value=result.get('metric_value') or 0.0,
            metric_name=result.get('metric_name') or '',
            export_string=result.get('gearset_export') or '',
            dominance_bitmap=_ti_bm,
            metric_inputs_hash=_ti_mh,
            optimization_version=OPTIMIZATION_VERSIONS.get('target_items', 1),
            extras_json=extras_str,
        )
        return

    # Other categories: single row, no extras
    sub = _derive_subcategory(job)
    metric_inputs_hash = compute_metric_inputs_hash(
        snapshot, cat, sub, src, loc, svc, db=conn
    )

    db.create_stats_report_result(
        session_uuid=job.session_uuid,
        category=cat,
        subcategory=sub,
        source_name=src,
        location=loc,
        service=svc,
        rank=0,
        metric_value=result.get('metric_value') or 0.0,
        metric_name=result.get('metric_name') or '',
        export_string=result.get('gearset_export') or '',
        dominance_bitmap=bitmap,
        metric_inputs_hash=metric_inputs_hash,
        optimization_version=OPTIMIZATION_VERSIONS.get(cat, 1),
    )


def _bucket_unowned_drops_by_kind(job, character):
    """Return {kind: [{slug, name, item_ref}, ...]} for the activity's drops
    that the character doesn't own (and aren't hidden). Used by new_items
    chip rows (T17).
    """
    if not job.activity:
        return {}
    out = {}
    drops = list(getattr(job.activity, 'drop_table', None) or []) + list(
        getattr(job.activity, 'secondary_drop_table', None) or []
    )

    # Build owned set from character snake_case names
    owned_names = set()
    try:
        for k in (getattr(character, '_all_items', None) or {}).keys():
            for sfx in ("_normal", "_good", "_great", "_excellent", "_perfect", "_eternal", "_fine"):
                if k.endswith(sfx):
                    owned_names.add(k[: -len(sfx)])
                    break
            else:
                owned_names.add(k)
    except Exception:
        pass

    for d in drops:
        item_name = getattr(d, 'item_name', None)
        if not item_name:
            continue
        slug = str(item_name).lower().replace(' ', '_').replace("'", "")
        if slug in owned_names:
            continue
        item_ref = getattr(d, 'item_ref', '') or ''
        kind = None
        if 'Egg.' in item_ref:
            kind = 'eggs'
            # Parity with build_new_items_jobs: an egg is already "owned"
            # if the user has a pet of that species (egg / juvenile / adult
            # — any stage) OR an available egg of it. The item-ownership
            # check above ('slug in owned_names') does NOT catch this,
            # because a pet is not an inventory item. Without this branch
            # the two new_items ownership paths diverge and a hatched/owned
            # pet's egg keeps getting re-emitted as a "new item" forever
            # (bug 01797bdb; same class as ba8696eb / bb0200f6). Use the
            # shared _NEW_ITEMS_OWNERSHIP lookup so both paths agree.
            _own = globals().get('_NEW_ITEMS_OWNERSHIP') or {}
            _species = slug.replace('_egg', '').strip('_')
            if (_species in (_own.get('pet_species') or set())
                    or slug in (_own.get('eggs') or set())):
                continue
        elif 'Collectible.' in item_ref:
            kind = 'collectibles'
        elif 'Item.' in item_ref:
            # Look up item slot to differentiate tools vs gear
            try:
                import util.walkscape_constants  # noqa: F401
                from util.autogenerated.equipment import Item, ItemInstance
                item_obj = getattr(Item, slug.upper(), None)
                slot = (getattr(item_obj, 'slot', '') or '').lower() if item_obj else ''
                kind = 'tools' if slot.startswith('tool') else 'gear'
            except Exception:
                kind = 'gear'
        if not kind:
            continue
        out.setdefault(kind, []).append({
            'slug': slug,
            'name': item_name,
            'item_ref': item_ref,
        })
    return out


def _derive_subcategory(job):
    cat = job.category
    if cat in ("xp", "coins"):
        return (job.skill_name or "").lower()
    if cat in ("chests", "chests_recipes"):
        return (job.chest_name or "").lower().replace(" ", "_")
    if cat == "new_items":
        # 2026-05-22 fix: build_new_items_jobs emits one job per (activity,
        # kind) and overloads job.skill_name to carry the kind label
        # ('gear'/'tools'/'eggs'/'collectibles'). Previously this returned
        # "all" which never matched enumerate_applicable_sources' per-kind
        # entries, so 100% of new_items jobs got dropped by the stale-only
        # filter. Now uses job.skill_name directly so keys line up.
        return (job.skill_name or "").lower()
    return ""


def _derive_location(job, recipe_ctx=None):
    # chests_recipes: derive the REAL per-character service location via the
    # shared helper (representative_recipe_service_location) — the SAME function
    # the enumerator uses — so the write-side key matches the read-side key. A
    # divergent key ghost-flags every recipe forever (see
    # .kiro/RECIPE_LOCATION_STALE_KEY.md). recipe_ctx = (state, unlocked_regions,
    # locked_locations, services_by_name); when absent (legacy callers) fall
    # back to "global". The _RecipeShim backing a chests_recipes job has no
    # .locations, so without this the activity branch below returns "global".
    if job.category == 'chests_recipes':
        if recipe_ctx is None:
            return "global"
        try:
            from util.stats_report.applicable_sources import representative_recipe_service_location
            from util.autogenerated.recipes import RECIPES_BY_NAME
            rec_name = getattr(job, 'recipe_name', None) or (
                getattr(job.activity, 'name', None) if job.activity is not None else None)
            recipe = RECIPES_BY_NAME.get(rec_name) if rec_name else None
            if recipe is None:
                return "global"
            state, ur, ll, svc_map = recipe_ctx
            loc_slug, _svc = representative_recipe_service_location(recipe, state, ur, ll, svc_map)
            return loc_slug or "global"
        except Exception:
            return "global"
    if job.activity is not None:
        # 2026-05-22 fix: prefer first ACCESSIBLE location, not just
        # locations[0]. Activities with multiple locations (Bog Top
        # backed by both halfling_rebels and gdte) shouldn't have their
        # row keyed under an inaccessible location if a working one
        # exists. Falls back to locations[0] when accessibility data
        # isn't available.
        accessible = _activity_first_accessible_location(job.activity)
        if accessible is not None:
            l = accessible
        else:
            locs = getattr(job.activity, "locations", None) or []
            if not locs:
                return "global"
            l = locs[0]
        # 2026-05-22 fix: strip apostrophes so the slug matches
        # enumerate_applicable_sources, which does the same. Without
        # this, locations like "Casbrant's Grave", "Elara's Lagoon",
        # and "Winter's End" produced different keys on each side
        # and any job at those locations got filtered out by the
        # stale-only path.
        return (l if isinstance(l, str) else getattr(l, "name", "")).lower().replace(" ", "_").replace("'", "") or "global"
    return "global"


def _derive_service(job):
    # 2026-05-22 fix: chests_recipes jobs don't have a recipe_name
    # attribute on ReportJob (the dataclass doesn't define it). The
    # recipe name lives on job.activity.name (a _RecipeShim). Look up
    # the recipe via that path, then read recipe.service. Without this
    # fix, every chests_recipes job had service='NONE' but
    # enumerate_applicable_sources resolves the actual service slug
    # (e.g. 'basic_sawmill'), so 100% of chests_recipes jobs got
    # filtered out by stale-only.
    rec_name = getattr(job, 'recipe_name', None)
    if not rec_name and job.activity is not None and job.category == 'chests_recipes':
        rec_name = getattr(job.activity, 'name', None)
    if not rec_name:
        return "NONE"
    try:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.recipes import RECIPES_BY_NAME
        recipe = RECIPES_BY_NAME.get(rec_name)
        if recipe is None:
            return "NONE"
        svc = getattr(recipe, "service", None)
        # 2026-05-29: same string-'None' quirk as _recipe_has_unlocked_service.
        # Without this, a recipe with service='None' (string) lowercased to
        # 'none' here while applicable_sources emits 'NONE' — keys diverge
        # and the row ghosts as REASON_NEWLY_UNLOCKED.
        if not svc or svc in ('None', 'NONE', ''):
            return "NONE"
        return str(svc).lower().replace(" ", "_").replace("'", "")
    except Exception:
        return "NONE"


def _derive_primary_skill(job):
    if job.activity is not None:
        v = getattr(job.activity, "skill", None) or getattr(job.activity, "primary_skill", None)
        if v:
            return (v if isinstance(v, str) else getattr(v, "name", "")).lower()
    return (job.skill_name or "").lower() or None


def _required_keywords_for_job(job):
    """Return the set of mandatory tool keywords for the job's activity.

    Sourced from activity.requirements['keyword_counts'] (e.g.
    {'fishing cage': 1} for Sea fishing (Cage)). Returns lowercase keyword
    strings. Recipes / jobs with no activity have no keyword gate. Mirrors
    stale_detector._scope_for_row so the write and read paths derive the same
    set (bug 4038424d).
    """
    act = getattr(job, "activity", None)
    if act is None:
        return set()
    reqs = getattr(act, "requirements", None) or {}
    kc = reqs.get("keyword_counts", {}) if isinstance(reqs, dict) else {}
    return {str(k).lower() for k in kc.keys()} if kc else set()


def _build_item_ifc_map():
    """Reverse map: item_ref -> frozenset('ItemFindingCategory.<CAT>').

    Built at runtime by iterating util.autogenerated.item_finding — a game-data
    regen that adds/renames IF categories or changes their member items is
    picked up automatically, no code edit. Memoized on _TI_ITEM_IFC_MAP.
    """
    global _TI_ITEM_IFC_MAP
    if _TI_ITEM_IFC_MAP is not None:
        return _TI_ITEM_IFC_MAP
    m = {}
    try:
        from util.autogenerated.item_finding import ItemFindingCategory
        # Sentinel type of a CategoryInstance (mirrors finding_stats_for_if_target).
        _sentinel = type(getattr(ItemFindingCategory, 'GOLD_PIECES', None))
        for attr in dir(ItemFindingCategory):
            if attr.startswith('_'):
                continue
            cat = getattr(ItemFindingCategory, attr, None)
            if _sentinel is type(None) or not isinstance(cat, _sentinel):
                continue
            stat = f'ItemFindingCategory.{attr}'
            for d in (getattr(cat, 'drops', None) or []):
                ref = getattr(d, 'item_ref', None)
                if ref:
                    m.setdefault(ref, set()).add(stat)
    except Exception as e:
        print(f"[stats_report_worker] item-IFC reverse map build failed "
              f"(target_items exact solves fall back to per-item, no sharing): {e}",
              flush=True)
    _TI_ITEM_IFC_MAP = {k: frozenset(v) for k, v in m.items()}
    return _TI_ITEM_IFC_MAP


def _ti_find_signature(job):
    """Find-signature for target_items exact-solve REUSE (see the exact block in
    run_optimizer_for_job). Two (item, activity) scopes may share ONE exact
    solve iff this signature matches — i.e. the identical set of find-relevant
    gear applies to both, so their argmax gearset is the same (only the base
    drop weight differs, which does not move the argmax).

    Fully data-driven (no hardcoded item/skill/gem lists). Composed of:
      * group_slug   -- activity-scoped material-type finding lever (gem/ore/
                        hide/...), from classify_item / build_target_groups.
      * is_fine      -- fine variants weight fine_material_finding.
      * per-item IF categories -- global ItemFindingCategory.* the item belongs
                        to, from the runtime item_ref->IFC reverse map (so e.g.
                        Gold nugget {GOLD_NUGGET} and Silver nugget {} do NOT
                        share, and all RANDOM_GEM gems DO share).
      * finding_stats_for_if_target(target_ref) -- cat:/currency/IFC targets.

    Correctness bias: on ANY error, return a UNIQUE token so the scope never
    shares a solve. A too-fine signature only costs reuse; a too-coarse one
    would hand an item the wrong gearset.
    """
    ex = None
    try:
        ex = getattr(job, 'extras', None) or {}
        group_slug = ex.get('group_slug') or (getattr(job, 'skill_name', None) or '')
        is_fine = bool(ex.get('is_fine'))
        item_ref = ex.get('item_ref') or ''
        target_ref = ex.get('target_ref') or ''
        ifcs = set(_build_item_ifc_map().get(item_ref, frozenset()))
        try:
            from optimize_activity_gearsets import finding_stats_for_if_target
            ifcs |= set(finding_stats_for_if_target(target_ref) or ())
        except Exception:
            pass
        return (group_slug, is_fine, frozenset(ifcs))
    except Exception:
        # Unique -> never shares a solve.
        _leaf = None
        try:
            _leaf = (ex or {}).get('item_slug')
        except Exception:
            _leaf = None
        return ('__unique__', _leaf or getattr(job, 'chest_name', None)
                or getattr(job, 'job_id', None) or id(job))


def _target_items_scope_key(job):
    """Scope key for a target_items job.

    MUST stay identical to what _write_stats_report_result_row writes and what
    enumerate_applicable_sources emits: ('target_items', <group_slug>,
    <leaf_slug>, 'NONE', 'NONE'). group_slug is carried on job.skill_name;
    leaf_slug is job.extras['item_slug'] (materials + currency), falling back to
    the normalized display name.

    2026-08-12 (bug 84f7b7ba): _filter_jobs_to_stale_only previously derived the
    key with the generic activity-based path (_derive_subcategory + activity
    name + activity location), producing ('target_items', '', '<activity>',
    '<loc>', 'NONE') which never matched the write/enumerate key. Every
    target_items job was dropped as "not stale" → the report ran 0/0 on both
    server and local runs.
    """
    sub = (getattr(job, 'skill_name', None) or '').lower()
    src = ''
    if getattr(job, 'extras', None):
        src = job.extras.get('item_slug', '') or ''
    if not src:
        src = _normalize_item_id(getattr(job, 'precomputed_metric_name', None) or '')
    # v3 per-(item,activity): activity slug in the location field so two
    # activities for the same item do NOT collide on the scope key.
    act = ''
    if getattr(job, 'extras', None):
        act = job.extras.get('activity_name', '') or ''
    if not act and getattr(job, 'activity', None) is not None:
        act = getattr(job.activity, 'name', '') or ''
    act_slug = _normalize_item_id(act) if act else 'NONE'
    return ('target_items', sub, src, act_slug, 'NONE')


def _target_items_stale_signals(job, snapshot, conn):
    """Compute (dominance_bitmap, metric_inputs_hash) for a target_items job.

    SINGLE source of truth shared by the WRITE path
    (_write_stats_report_result_row) and the stale FILTER
    (_filter_target_items_jobs_to_stale) so the stored signals and the
    recomputed signals can never diverge (the class of key/signal-divergence
    bug that stranded the enumerated categories forever).

    The bitmap is the activity's (primary_skill, first-accessible-location)
    effective-owned maximal set -- IDENTICAL derivation to the xp/coins/chests
    write path -- so owning or crafting a better piece of finding/skill gear
    for that activity flips a bit and re-flags the scope. The hash captures the
    activity's WE-cap skill level + relevant custom-stats / pets (resolved via
    the activity name). Both fall back to empty on error so the caller's
    comparison is safe (fail-open re-run happens in the filter, not here).
    """
    from util.stats_report.metric_inputs import compute_metric_inputs_hash

    skill = _derive_primary_skill(job)
    # 2026-08-13 (jwbail): derive the bitmap location from the job's
    # extras['location'] -- the EXACT location the optimizer scored this scope
    # at -- rather than _derive_location(job). For multi-location activities
    # _derive_location (globals-based first-accessible) can disagree with the
    # optimized location, so the WRITE (via _derive_location) and the BADGE
    # (compute_target_items_stale_groups, which uses the stored extras.location)
    # stored/recomputed bitmaps at DIFFERENT locations -> the signals never
    # matched -> those (item, activity) scopes always re-flagged and re-ran and
    # falsely badged. Sourcing loc from extras.location here makes the WRITE,
    # the resume FILTER, and the BADGE all compute the bitmap at the same
    # location, so completed scopes compare equal and are correctly skipped.
    loc = ""
    _ex_loc = (job.extras or {}).get("location") if getattr(job, "extras", None) else None
    if _ex_loc:
        loc = str(_ex_loc).lower().replace(" ", "_").replace("'", "")
    if not loc:
        loc = _derive_location(job)
    req_kw = _required_keywords_for_job(job)
    bitmap = b""
    if skill:
        # Snapshot-scoped memo (see _scoped_owned_bitmap). MUST NOT use the old
        # module-global scope-keyed cache, which leaked bitmaps across
        # concurrent runs/sessions and stored wrong bitmaps -> the false-positive
        # loop that got the bitmap comparison disabled on 2026-09-01.
        bitmap = _scoped_owned_bitmap(snapshot, skill, loc, "activity", req_kw, conn)

    tik = _target_items_scope_key(job)
    act_name = ""
    if getattr(job, "extras", None):
        act_name = job.extras.get("activity_name", "") or ""
    if not act_name and getattr(job, "activity", None) is not None:
        act_name = getattr(job.activity, "name", "") or ""
    try:
        # source_name = activity name (not the item slug) so the hash resolves
        # the activity's real primary skill / WE cap. Both write + filter call
        # this same helper, so the stored and recomputed hashes match.
        mh = compute_metric_inputs_hash(
            snapshot, "target_items", tik[1], act_name or tik[2], tik[3], "NONE", db=conn
        )
    except Exception:
        mh = ""
    # Scope params the bitmap was computed under. Stored in the row's extras so
    # the read-side badge recomputes the bitmap with byte-identical inputs
    # instead of re-deriving loc from metrics_json (that mismatch was a
    # bitmap-divergence source distinct from the memo pollution).
    _scope = {"skill": skill or "", "loc": loc or "", "req_kw": sorted(req_kw)}
    return (bitmap or b""), (mh or ""), _scope


def _target_items_filter_core(ti_jobs, stored, current_version, signal_fn):
    """Pure stale-decision core for target_items (no DB / snapshot).

    Keeps a job (re-run) when its scope is:
      * new       -- no stored row for the scope key (new activity/item, newly
                     unlocked, newly SELECTED group, or first ever run)
      * version   -- stored optimization_version < current_version
      * changed   -- recomputed (bitmap, hash) differs from the stored pair
                     (owned/crafted better gear, custom-stat/pet/level change)
    Drops fresh scopes (stored, same version, same signals). Fail-open: any
    signal_fn error keeps the job so a transient compute failure never wrongly
    skips a scope.

    Args:
        ti_jobs: built target_items ReportJobs (the AUTHORITATIVE applicable set).
        stored: {scope_key5: (dominance_bitmap, metric_inputs_hash, version)}.
        current_version: int, OPTIMIZATION_VERSIONS['target_items'].
        signal_fn: job -> (bitmap_bytes, hash_str).

    Returns (kept_jobs, built_keys, reasons_dict).
    """
    kept = []
    built_keys = set()
    reasons = {"new": 0, "version": 0, "changed": 0, "error": 0, "fresh": 0}
    for job in ti_jobs:
        key = _target_items_scope_key(job)
        built_keys.add(key)
        rec = stored.get(key)
        if rec is None:
            kept.append(job)
            reasons["new"] += 1
            continue
        bm_s, mh_s, ver_s = rec
        if (ver_s or 0) < current_version:
            kept.append(job)
            reasons["version"] += 1
            continue
        try:
            bm_c, mh_c = signal_fn(job)
        except Exception:
            kept.append(job)
            reasons["error"] += 1
            continue
        # 2026-09-01 (bug 8990f0e4) DISABLED the bitmap comparison because the
        # module-global scope-keyed bitmap memo leaked bitmaps across concurrent
        # runs/sessions, so stored bitmaps were wrong and never matched the
        # recompute (415/596 rows mismatched even with hash + owned-count equal)
        # -> a 100% false-positive re-optimize loop (AGT/ore/sea_shells never
        # cleared). But hash-only can NEVER see an owned-gear change, so gaining
        # a better piece (e.g. Heavy pick handle for Ore) stopped re-flagging.
        # 2026-09-21 (jwbail [fix:stale-detection]) RE-ENABLES it: the memo is
        # now snapshot-scoped (_scoped_owned_bitmap), so the write and the
        # recompute compute the identical bitmap for an unchanged snapshot and
        # the loop cannot recur. Guard: compare the bitmap ONLY when BOTH the
        # stored and recomputed bitmaps are non-empty, so a legacy empty-bitmap
        # row or a transient compute error falls back to hash-only and never
        # false-flags. bm_s/bm_c are the raw effective-owned dominance bitmaps.
        mh_changed = (mh_c or "") != (mh_s or "")
        bm_changed = bool(bm_s) and bool(bm_c) and (bytes(bm_c) != bytes(bm_s))
        if mh_changed or bm_changed:
            kept.append(job)
            reasons["changed"] += 1
        else:
            reasons["fresh"] += 1
    return kept, built_keys, reasons


def _filter_target_items_jobs_to_stale(ti_jobs, session_uuid, db_path):
    """Stale-filter target_items jobs, then prune orphaned stored rows.

    Unlike the other categories (which route through detect_stale_scopes +
    enumerate_applicable_sources), target_items derives its currently-applicable
    scope set directly from build_target_items_jobs -- the SAME code that
    produces the jobs -- so there is NO enumerate/build key divergence (the
    class of bug that caused the 0/0 and perpetual-(!) failures for the
    enumerated categories, see _target_items_scope_key). We compare each built
    job's scope against the stored stats_report_results rows and keep only the
    new / version-bumped / changed ones (see _target_items_filter_core).

    Fail-open at every DB boundary: if we can't load stored rows or build the
    snapshot, run ALL jobs (never wrongly skip). Returns the filtered list.
    """
    from ui.database import DatabaseManager
    from util.stats_report.state_snapshot import from_char_config
    from util.stats_report.optimization_versions import OPTIMIZATION_VERSIONS

    if not ti_jobs:
        return ti_jobs

    current_version = OPTIMIZATION_VERSIONS.get("target_items", 1)
    db = DatabaseManager(db_path)
    conn = db._get_connection()

    # Load stored target_items rows for this session.
    stored = {}
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT subcategory, source_name, location, service, "
            "dominance_bitmap, metric_inputs_hash, optimization_version "
            "FROM stats_report_results "
            "WHERE session_uuid = ? AND category = 'target_items'",
            (session_uuid,),
        )
        for sub, src, loc, svc, bm, mh, ver in cursor.fetchall():
            stored[("target_items", sub, src, loc, svc)] = (bm, mh, ver)
    except Exception as e:
        print(f"[stats_report_worker] target_items stale: stored-row query failed: "
              f"{e} -- running all target_items jobs", flush=True)
        return ti_jobs

    # Build the snapshot once (same constructor the write path uses).
    try:
        sess = db.get_session(session_uuid) or {}
        snapshot = from_char_config(
            sess.get("character_config") or {},
            sess.get("ui_config") or {},
        )
    except Exception as e:
        print(f"[stats_report_worker] target_items stale: snapshot build failed: "
              f"{e} -- running all target_items jobs", flush=True)
        return ti_jobs

    def _signal_fn(job):
        bm, mh, _scope = _target_items_stale_signals(job, snapshot, conn)
        return bm, mh

    kept, built_keys, reasons = _target_items_filter_core(
        ti_jobs, stored, current_version, _signal_fn
    )

    # Prune orphaned stored rows whose scope is no longer built THIS run, but
    # only within the groups actually built (a group the user didn't select
    # this run keeps its rows -- mirrors prune_orphaned_new_items_results'
    # kind-restriction). Removes rows for obtained items / removed or renamed
    # activities / de-selected fine variants.
    pruned = 0
    if built_keys:
        try:
            built_groups = {k[1] for k in built_keys}
            # (group_slug, item_slug, activity_slug) triples for the results
            # table; (group_slug, item_slug, activity_name) for the gearsets
            # (display) table. Build both from the jobs so the prune covers
            # what the UI actually reads.
            valid_result = {(k[1], k[2], k[3]) for k in built_keys}
            valid_gearset = set()
            for j in ti_jobs:
                grp = (getattr(j, "skill_name", None) or "")
                itm = getattr(j, "chest_name", None) or ""
                act = j.activity.name if getattr(j, "activity", None) else None
                valid_gearset.add((grp, itm, act))
            pruned = db.prune_orphaned_target_items_results(
                session_uuid, built_groups, valid_result, valid_gearset
            )
        except Exception as e:
            print(f"[stats_report_worker] target_items orphan prune failed: {e}", flush=True)

    print(f"[stats_report_worker] target_items stale filter: {len(ti_jobs)} -> {len(kept)} "
          f"jobs {reasons}; pruned {pruned} orphan row(s)", flush=True)
    return kept


def compute_target_items_stale_groups(snapshot, conn, session_uuid):
    """Read-side staleness for the target_items (!) badge (no job build).

    Returns (stale_group_slugs:set, stale_scope_tuples:list) where each tuple is
    (group_slug, item_slug, activity_slug). For every STORED target_items row it
    recomputes the (dominance_bitmap, metric_inputs_hash) from the activity in
    the row's extras_json and compares against the stored signals + version --
    the SAME signal logic _filter_target_items_jobs_to_stale uses on Optimize,
    so a badged group's rows WILL recompute and the badge clears (no perpetual-!).

    FAIL-SAFE: if a row can't be confidently recomputed (activity missing from
    the catalog, no skill, bitmap error) it is SKIPPED (not flagged), so a
    transient/unknown case never produces a stuck badge. Newly-unlocked scopes
    (no stored row) are intentionally NOT surfaced here -- they have no row to
    read and are picked up as jobs on the next Optimize by the worker's
    built-jobs filter; the badge is about EXISTING rows going stale.
    """
    import json as _json
    from util.stats_report.effective_bitmap import compute_effective_owned_bitmap
    from util.stats_report.metric_inputs import compute_metric_inputs_hash
    from util.stats_report.optimization_versions import OPTIMIZATION_VERSIONS

    stale_groups = set()
    stale_scopes = []
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT subcategory, source_name, location, dominance_bitmap, "
            "metric_inputs_hash, optimization_version, extras_json "
            "FROM stats_report_results WHERE session_uuid = ? AND category = 'target_items'",
            (session_uuid,),
        )
        rows = cur.fetchall()
    except Exception:
        return stale_groups, stale_scopes
    if not rows:
        return stale_groups, stale_scopes

    current_version = OPTIMIZATION_VERSIONS.get("target_items", 1)
    try:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
    except Exception:
        ACTIVITIES_BY_NAME = {}

    # 2026-08-31 (jwbail): per-call memoization of the two expensive signals.
    # This runs read-side on the web process over EVERY stored target_items row
    # (~1000+ for a large character) and previously recomputed the effective-
    # owned bitmap + metric hash from scratch per row -- the ~4s that dominated
    # the goals-report open. Both signals depend ONLY on the activity
    # (skill/location/required-keywords for the bitmap; group/activity for the
    # hash), NOT the per-item scope, so every target item sharing an activity
    # yields identical signals. Memoize within THIS call, where the snapshot is
    # fixed (so the cache is correct AND process-safe -- unlike the module-level
    # worker bitmap cache, which must stay snapshot-scoped to a single run).
    _bm_memo = {}
    _mh_memo = {}

    for (group, item_slug, act_slug, bm_s, mh_s, ver_s, extras_json) in rows:
        try:
            if (ver_s or 0) < current_version:
                stale_groups.add(group)
                stale_scopes.append((group, item_slug, act_slug))
                continue
            ex = {}
            if extras_json:
                try:
                    ex = _json.loads(extras_json) if isinstance(extras_json, str) else (extras_json or {})
                except Exception:
                    ex = {}
            act_name = ex.get("activity_name") or ""
            act = ACTIVITIES_BY_NAME.get(act_name)
            if act is None:
                continue  # can't recompute -> don't false-flag
            sk = getattr(act, "skill", None) or getattr(act, "primary_skill", None)
            skill = (sk if isinstance(sk, str) else getattr(sk, "name", "")).lower()
            if not skill:
                continue
            # Prefer the EXACT bitmap scope params the WRITE path used, stored in
            # extras._stale_scope, so the recompute is byte-identical to the
            # stored bitmap (re-deriving loc from metrics_json here was a
            # divergence source). Rows written before this fix have no
            # _stale_scope -> fall back to hash-only (no bitmap flag) so legacy
            # rows can never false-badge; they gain the bitmap signal after the
            # next Optimize rewrites them with stored scope params.
            _sscope = ex.get("_stale_scope") if isinstance(ex, dict) else None
            _use_bitmap = isinstance(_sscope, dict) and bool(_sscope.get("skill")) and bool(bm_s)
            if _use_bitmap:
                skill = str(_sscope.get("skill") or skill).lower()
                loc_slug = str(_sscope.get("loc") or "").lower()
                req_kw = {str(k).lower() for k in (_sscope.get("req_kw") or [])}
            else:
                loc_name = ex.get("location") or ""
                loc_slug = (loc_name.lower().replace(" ", "_").replace("'", "")
                            if loc_name else act_slug)
                reqs = getattr(act, "requirements", None) or {}
                kc = reqs.get("keyword_counts", {}) if isinstance(reqs, dict) else {}
                req_kw = {str(k).lower() for k in kc.keys()} if kc else set()

            _mh_key = (group, act_name, act_slug)
            if _mh_key in _mh_memo:
                mh_c = _mh_memo[_mh_key]
            else:
                try:
                    mh_c = compute_metric_inputs_hash(
                        snapshot, "target_items", group, act_name, act_slug, "NONE", db=conn)
                    _mh_memo[_mh_key] = mh_c  # memoize successes only
                except Exception:
                    mh_c = mh_s  # neutral (per-row stored) -> don't flag, don't memoize
            mh_changed = (mh_c or "") != (mh_s or "")

            # Owned-gear signal: recompute the bitmap with the stored scope
            # params and flag when it differs from the stored one. Only runs when
            # _use_bitmap (stored scope present AND a non-empty stored bitmap).
            # Fail-safe: a compute error leaves bm_changed False (never a stuck !).
            bm_changed = False
            if _use_bitmap:
                _bm_key = (skill, loc_slug, frozenset(req_kw))
                if _bm_key in _bm_memo:
                    bm_c = _bm_memo[_bm_key]
                else:
                    try:
                        bm_c = compute_effective_owned_bitmap(
                            snapshot, skill, loc_slug, "NONE", "activity", db=conn,
                            required_keywords=req_kw or None,
                        )
                    except Exception:
                        bm_c = None  # fail-safe: never false-flag on a compute error
                    if bm_c is not None:
                        _bm_memo[_bm_key] = bm_c
                if bm_c and bytes(bm_c) != bytes(bm_s):
                    bm_changed = True

            if mh_changed or bm_changed:
                stale_groups.add(group)
                stale_scopes.append((group, item_slug, act_slug))
        except Exception:
            continue
    return stale_groups, stale_scopes


def ensure_target_items_applicability_rows(session_uuid, db_path, include_fine=False):
    """Materialize a placeholder stats_report_results row for every currently-
    applicable BASE target_items (item, activity) scope that has no stored row,
    so NEWLY-UNLOCKED scopes 'have a row to read' and the (!) badge can flag
    them (compute_target_items_stale_groups reads rows; a scope with no row is
    invisible to it). This mirrors how the other categories detect
    newly-unlocked (enumerate_applicable_sources - stored), but target_items has
    no enumerate_applicable_sources entry (field-overloaded key), so we
    enumerate via build_target_items_jobs -- the SAME source of truth the run
    uses -- and persist the gap as placeholders.

    Placeholders use optimization_version=0 (< current) + empty bitmap/hash, so
    compute_target_items_stale_groups flags them stale until a real Optimize run
    overwrites them (via _write_stats_report_result_row, same PK) with the true
    signals. They live ONLY in stats_report_results (the stale-detection table),
    NOT stats_report_gearsets (the display table read by
    get_stats_report_results_latest_per_scope / /api/stats-report/results), so
    they never render as junk rows.

    include_fine defaults False on purpose: BASE scopes are built by EVERY run
    regardless of the fine toggle, so a base placeholder is guaranteed to be
    replaced (or pruned) by the next run of its group -- no perpetual-(!). Fine
    scopes are only built when the toggle is on, so materializing them here
    could strand a badge; they're covered by real rows once a fine run happens.

    Idempotent (only inserts MISSING scopes; never overwrites a real row) and
    fail-safe (any error is swallowed and returns the count so far). Returns the
    number of placeholder rows written.
    """
    import json as _json
    from ui.database import DatabaseManager

    written = 0
    try:
        character = load_character(session_uuid, db_path)
    except Exception as e:
        print(f"[stats_report_worker] applicability: load_character failed: {e}", flush=True)
        return 0
    if character is None:
        return 0

    # Set the region-access globals so build_target_items_jobs picks the SAME
    # first-accessible location the run/write path uses (else the scope key's
    # activity slug + the eventual bitmap location could diverge).
    try:
        _ur, _ll = compute_region_access(session_uuid, db_path)
        globals()['_UNLOCKED_REGIONS'] = _ur
        globals()['_LOCKED_LOCATIONS'] = _ll
    except Exception:
        globals().setdefault('_UNLOCKED_REGIONS', None)
        globals().setdefault('_LOCKED_LOCATIONS', set())

    try:
        jobs = build_target_items_jobs('applicability', session_uuid, character,
                                       include_fine=include_fine)
    except Exception as e:
        print(f"[stats_report_worker] applicability: build_target_items_jobs failed: {e}", flush=True)
        return 0

    db = DatabaseManager(db_path)
    conn = db._get_connection()
    stored = set()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT subcategory, source_name, location, service FROM stats_report_results "
            "WHERE session_uuid = ? AND category = 'target_items'",
            (session_uuid,),
        )
        for sub, src, loc, svc in cur.fetchall():
            stored.add((sub, src, loc, svc))
    except Exception as e:
        print(f"[stats_report_worker] applicability: stored-row query failed: {e}", flush=True)
        return 0

    for job in jobs:
        try:
            key = _target_items_scope_key(job)  # ('target_items', group, item, act, 'NONE')
            skey = (key[1], key[2], key[3], key[4])
            if skey in stored:
                continue  # already has a (real or placeholder) row
            extras = dict(job.extras) if getattr(job, 'extras', None) else {}
            extras['pending'] = True
            db.create_stats_report_result(
                session_uuid=session_uuid,
                category='target_items',
                subcategory=key[1],
                source_name=key[2],
                location=key[3],
                service='NONE',
                rank=0,
                metric_value=0.0,
                metric_name='',
                export_string='',
                dominance_bitmap=b'',
                metric_inputs_hash='',
                optimization_version=0,   # < current -> flagged stale by the badge
                extras_json=_json.dumps(extras),
            )
            stored.add(skey)
            written += 1
        except Exception:
            continue

    if written:
        print(f"[stats_report_worker] applicability: wrote {written} placeholder "
              f"target_items row(s) for newly-applicable scopes", flush=True)
    return written


def _filter_jobs_to_stale_only(all_jobs, session_uuid, db_path):
    """Filter built jobs to scopes flagged stale or newly-unlocked.

    Calls detect_stale_scopes directly (not the stats_report_stale_scopes cache)
    so this works correctly even when /state-changed has never been POSTed
    for the session. The cache is just an optimization for read API responses;
    the source of truth is the dynamic computation.

    First run (no rows in stats_report_results): newly_unlocked covers everything.
    Subsequent run, nothing changed: empty result → returns empty list.
    Subsequent run, something changed: only matching jobs returned.
    """
    from ui.database import DatabaseManager
    from util.stats_report.state_snapshot import CharacterStateSnapshot, from_char_config
    from util.stats_report.stale_detector import detect_stale_scopes

    # Need character state to build the current snapshot
    character = load_character(session_uuid, db_path)

    db = DatabaseManager(db_path)
    conn = db._get_connection()
    cursor = conn.cursor()

    # 2026-05-29: use from_char_config so curr snapshot matches
    # what /state-changed and /stale-check use, AND what
    # _write_stats_report_result_row writes. Mixing constructors gives
    # disagreeing ring_quantities and produces phantom item_change /
    # input_change scopes on every run.
    sess = db.get_session(session_uuid) or {}
    curr = from_char_config(
        sess.get('character_config') or {},
        sess.get('ui_config') or {},
    )

    # Load prev snapshot from cache if present
    cursor.execute(
        "SELECT snapshot_json FROM character_state_snapshot_cache WHERE session_uuid = ?",
        (session_uuid,),
    )
    row = cursor.fetchone()
    prev = None
    if row:
        try:
            prev = CharacterStateSnapshot.from_json(row[0])
        except Exception:
            prev = None

    try:
        scopes = detect_stale_scopes(prev, curr, conn,
                                      session_uuid=session_uuid,
                                      char_config=sess.get('character_config') or {},
                                      include_unavailable=globals().get('_INCL_UNAVAIL'))
    except Exception as e:
        print(f"[stats_report worker] detect_stale_scopes failed: {e} — falling back to no-op")
        scopes = []

    stale_keys = {(s.category, s.subcategory, s.source_name, s.location, s.service) for s in scopes}

    # 2026-06-18 (jwbail): self-heal degenerate cached rows. A stored
    # result with metric_value <= 0 is never a valid optimization outcome
    # (you can't farm a chest in 0 steps, etc.) — it's a stuck row from a
    # past transient compute failure. detect_stale_scopes won't flag it
    # when the character is unchanged, so without this it is served forever
    # and the only fix was a manual per-category reset (user-reported:
    # chests_recipes stuck showing "0 Steps/chest" across fresh runs).
    # Match on the coarse (category, source_name) pair so any drift in the
    # worker's location/service key derivation can't make the heal miss.
    try:
        zero_scopes = db.get_degenerate_result_scopes(session_uuid)
    except Exception as _ze:
        print(f"[stats_report worker] degenerate-scope self-heal query failed: {_ze}", flush=True)
        zero_scopes = set()
    if zero_scopes:
        print(f'[stats_report_worker] self-heal: {len(zero_scopes)} cached scope(s) with '
              f'metric_value<=0 forced stale for recompute: {sorted(zero_scopes)[:8]}', flush=True)

    if not stale_keys and not zero_scopes:
        return []

    out = []
    dropped_by_category = {}
    dropped_samples = {}
    for job in all_jobs:
        cat = job.category
        if cat == 'target_items':
            key = _target_items_scope_key(job)
        else:
            sub = _derive_subcategory(job)
            src = job.activity.name if job.activity else (getattr(job, 'recipe_name', None) or '')
            _rctx = _recipe_loc_ctx(session_uuid, db, curr) if cat == "chests_recipes" else None
            loc = _derive_location(job, recipe_ctx=_rctx)
            svc = _derive_service(job)
            key = (cat, sub, src, loc, svc)
        if key in stale_keys or (cat, src) in zero_scopes:
            out.append(job)
        else:
            # 2026-05-22 diagnostic: log the first few dropped jobs per
            # category so when the user sees "833 -> N" we can tell
            # whether it's expected (stale-detector says these are fresh)
            # or a key-mismatch bug (worker derives a key the detector
            # didn't enumerate). Logged at INFO so it appears in worker
            # log without DEBUG flag. Cap samples per category to keep
            # logs small.
            dropped_by_category[cat] = dropped_by_category.get(cat, 0) + 1
            if len(dropped_samples.get(cat, [])) < 5:
                dropped_samples.setdefault(cat, []).append(key)

    if dropped_by_category:
        print(f'[stats_report_worker] stale-only dropped {sum(dropped_by_category.values())} jobs '
              f'across categories: {dict(dropped_by_category)}', flush=True)
        for cat, samples in dropped_samples.items():
            for s in samples:
                # Show whether the key would match if we ignored case/spaces
                close_keys = [k for k in stale_keys if k[0] == cat and k[2] == s[2]][:2]
                print(f'[stats_report_worker]   dropped[{cat}] key={s} '
                      f'closest_stale_for_same_source={close_keys}', flush=True)
    return out


# ── Module entry point ──────────────────────────────────────────────────
# Must stay AT THE END of this file. Python binds top-level defs in source
# order, so any def that main()→run_worker() reaches must be declared
# above this block. Helpers like _filter_jobs_to_stale_only,
# _write_stats_report_result_row, _bucket_unowned_drops_by_kind, and the
# _derive_* functions all live above this point — moving this block
# higher in the file will silently break those references with NameError.
if __name__ == '__main__':
    main()
