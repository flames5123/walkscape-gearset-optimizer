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


# Set by run_worker (server path) so the exact-optimizer safety-valve comparison
# can be recorded to sessions.db. None on the LOCAL/Pyodide path (no server DB) —
# there the comparison is still emitted to the console via the [VALVE_CMP] line.
_VALVE_LOG_DB_PATH = None


def _log_valve_comparison(job, activity, exact_r, refine_r, winner):
    """Record one safety-valve comparison (exact incumbent vs greedy+refine).

    ALWAYS emits a structured [VALVE_CMP] stdout line (captured on both server
    and forwarded-console/Pyodide). Best-effort INSERT into the
    exact_valve_comparisons table server-side. Fully guarded — never breaks the
    report. Lets us later prove whether the incumbent ever loses to the
    hill-climb (delta<0); if it never does, the hill-climb can be dropped.
    """
    import datetime
    aname = getattr(activity, 'name', '?')
    skill = getattr(activity, 'primary_skill', None) or getattr(job, 'skill_name', None) or '?'
    sess = getattr(job, 'session_uuid', None) or '?'
    delta = (exact_r - refine_r)
    print(f"[VALVE_CMP] activity={aname!r} skill={skill} "
          f"exact_r={exact_r:.6f} refine_r={refine_r:.6f} delta={delta:.6f} "
          f"winner={winner} budget={getattr(__import__('util.exact_activity_xp_optimizer', fromlist=['_EXACT_NODE_BUDGET']), '_EXACT_NODE_BUDGET', '?')}")
    db_path = _VALVE_LOG_DB_PATH
    if not db_path:
        return
    try:
        import sqlite3
        con = sqlite3.connect(db_path)
        con.execute(
            "CREATE TABLE IF NOT EXISTS exact_valve_comparisons ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, session_uuid TEXT, "
            "activity TEXT, skill TEXT, exact_r REAL, refine_r REAL, delta REAL, winner TEXT)")
        con.execute(
            "INSERT INTO exact_valve_comparisons "
            "(ts, session_uuid, activity, skill, exact_r, refine_r, delta, winner) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (datetime.datetime.utcnow().isoformat(), str(sess), str(aname), str(skill),
             float(exact_r), float(refine_r), float(delta), str(winner)))
        con.commit(); con.close()
    except Exception as _e:
        print(f"[VALVE_CMP] table insert skipped: {_e}")


def _reset_stale_memo():
    """Clear the per-run stale-detection memo caches. Called at run_worker start."""
    with _STALE_MEMO_LOCK:
        _STALE_SNAPSHOT_CACHE.clear()
        _STALE_BITMAP_CACHE.clear()
        _STALE_RECIPE_CTX_CACHE.clear()


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
        # Skip locked activities (spoiler protection)
        try:
            if not activity.is_unlocked(character=character):
                continue
        except Exception:
            pass  # If check fails, include the activity

        # 2026-05-22 fix: skip activities whose every location is
        # inaccessible to the character (e.g. Crown of Cinders for
        # a character without Charter of the Drowned). Was causing
        # locked-region activities to surface in xp/coins sections.
        if _activity_first_accessible_location(activity) is None:
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

        for sk_lower in granted:
            sk_display = skill_display.get(sk_lower, sk_lower.capitalize())
            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='xp',
                activity=activity,
                skill_name=sk_display,
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
        # Skip locked activities (spoiler protection)
        try:
            if not activity.is_unlocked(character=character):
                continue
        except Exception:
            pass  # If check fails, include the activity

        # 2026-05-22 fix: skip activities at inaccessible locations.
        if _activity_first_accessible_location(activity) is None:
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
                spi = steps_per_reward / denom
                if best_steps is None or spi < best_steps:
                    best_steps = spi
                    best_drop = d

            if best_drop is None or best_steps is None:
                # Every drop in the bucket has zero/invalid chance — skip
                # the bucket entirely rather than emit a misleading row.
                continue

            best_drop_name = best_drop.item_name
            best_drop_ref = best_drop.item_ref or ''

            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='new_items',
                activity=activity,
                skill_name=kind,  # OVERLOADED: kind label (gear/tools/eggs/collectibles)
                precomputed_metric=best_steps,
                # 2026-05-24: keep the item name in the metric_name so the
                # row-level metric_name carries the ITEM the value refers
                # to. The frontend now renders the item name as the row
                # title (no more "Steps/new gear (X)" subtitle), and
                # parses metric_name + metrics_json.best_drop to drive
                # the drop popover wiring.
                precomputed_metric_name=best_drop_name,
                # Stash the best-drop item_ref + name in metrics_json so
                # the frontend can derive the item icon path and wire
                # the column-3 drop popover from these rows.
                extras={
                    'best_drop': {
                        'item_name': best_drop_name,
                        'item_ref': best_drop_ref,
                        'kind': kind,
                    },
                },
            ))

    return jobs


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

    for skill_activities in ACTIVITIES_BY_SKILL.values():
        for activity in skill_activities:
            try:
                if not activity.is_unlocked(character=character):
                    continue
            except Exception:
                pass

            # 2026-05-22 fix: skip activities at inaccessible locations.
            if _activity_first_accessible_location(activity) is None:
                continue

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
            try:
                if not activity.is_unlocked(character=character):
                    continue
            except Exception:
                pass

            # 2026-05-22 fix: skip activities at inaccessible locations
            # (e.g. Crown of Cinders without Charter of the Drowned).
            if _activity_first_accessible_location(activity) is None:
                continue

            jobs.append(ReportJob(
                job_id=str(uuid.uuid4()),
                run_id=run_id,
                session_uuid=session_uuid,
                category='coins',
                activity=activity,
                skill_name=skill_name,
            ))

    return jobs


# ============================================================================
# JOB EXECUTION
# ============================================================================

def _auto_pick_input_item_for_activity(activity, character):
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
                return best

        elif input_type == 'material':
            try:
                from util.autogenerated.materials import Material, MaterialInstance
            except ImportError:
                return None
            ref_attr = reference.split('.', 1)[-1] if '.' in reference else reference
            mat = getattr(Material, ref_attr, None)
            if mat is not None and isinstance(mat, MaterialInstance):
                return mat

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
                          hidden_items=None) -> Dict[str, Any]:
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

    activity = job.activity

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
    # Drop hidden consumables (pets are already filtered at pool build).
    if hidden_items:
        consumable_pool = [c for c in consumable_pool if c not in hidden_items]
    if primary_skill:
        pet_pool = _filter_pet_consumable_candidates_by_skill(
            pet_pool, primary_skill, item_kind='pet')
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
        optimize_activity_gearsets.IGNORED_ITEMS = set(hidden_items) if hidden_items else set()
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
        _selected_loc = _activity_first_accessible_location(activity)
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
        _picked_input = _auto_pick_input_item_for_activity(activity, character)
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
        if globals().get('_EXACT_XP_MODE', False) and getattr(job, 'category', None) in ('xp', 'coins'):
            _ex_gear = None
            try:
                _oag = optimize_activity_gearsets
                if getattr(job, 'category', None) == 'coins':
                    from util.exact_coins_optimizer import exact_coins_optimize as _exact_fn
                else:
                    from util.exact_activity_xp_optimizer import exact_xp_optimize as _exact_fn
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
                if getattr(job, 'category', None) == 'coins':
                    import util.exact_coins_optimizer as _exmod
                else:
                    import util.exact_activity_xp_optimizer as _exmod
                if getattr(_exmod, '_USE_DINKELBACH', False) or not getattr(_exmod, 'last_run_budget_exhausted', False):
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
                    _log_valve_comparison(job, activity, _r_exact, _r_refine, _winner)
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
        _slot_alts, _slot_locked = ({}, {})
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
        if metric_value is None or not (metric_value > 0) or metric_value == float('inf'):
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

    # 2026-06-05 (jwbail): stash the worker-computed slot alternatives so
    # the frontend can render them directly (correct-axis, no on-demand
    # re-scoring). Keys mirror the column-2 _alternatives convention.
    if _slot_alts:
        metrics_breakdown['_slot_alternatives'] = _slot_alts
    if _slot_locked:
        metrics_breakdown['_slot_locked_alternatives'] = _slot_locked

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

    pet_pool = list(pet_items_pool or [])
    consumable_pool = list(consumable_items_pool or [])
    # Drop hidden consumables (pets are already filtered at pool build).
    if hidden_items:
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
        optimize_craft_gearsets.IGNORED_ITEMS = set(hidden_items) if hidden_items else set()
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
                for cand_svc in service_candidates:
                    try:
                        cg, cm, _ = optimize_craft_gearsets.optimize_for_service(
                            recipe, cand_svc, character,
                        )
                    except Exception as _cand_e:
                        print(f'[stats_report_worker] recipe candidate failed {recipe_name} '
                              f'svc={getattr(cand_svc, "name", cand_svc)!r}: '
                              f'{type(_cand_e).__name__}: {_cand_e}', flush=True)
                        continue
                    cand_score = cm.get('steps_per_chest_recipe::cat:chests')
                    if cand_score is None or not (cand_score > 0):
                        cand_score = cm.get('steps_per_chest_recipe', float('inf'))
                    if cand_score is None or cand_score == 0:
                        cand_score = float('inf')
                    if best_score is None or cand_score < best_score:
                        best_score = cand_score
                        best_gearset = cg
                        best_metrics = cm
                        best_service = cand_svc
                if best_gearset is None:
                    raise RuntimeError(
                        f'no service candidate produced a result for {recipe_name}'
                    )
                gearset = best_gearset
                metrics = best_metrics
                service = best_service  # so service_icon/location pick this one
                chosen_loc_obj = None  # service supplies its own location
            elif service is not None:
                gearset, metrics, _iter = optimize_craft_gearsets.optimize_for_service(
                    recipe, service, character,
                )
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
                    if getattr(loc, 'is_underwater', False):
                        continue
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
                for cand in candidate_locations:
                    optimize_craft_gearsets.SELECTED_LOCATION = cand
                    try:
                        cg, cm, _ci = optimize_craft_gearsets.optimize_for_service(
                            recipe, None, character,
                        )
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
                            rerun = optimize_craft_gearsets.optimize_for_service(
                                recipe, None, character,
                            )
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
        _slot_alts, _slot_locked = ({}, {})

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

    metrics_json = {
        'recipe_name': recipe_name,
        # Service info — frontend reads these to render the recipe row's
        # location-equivalent line (icon + service name + location).
        'service_id': service_id,
        'service_name': service_name,
        'service_location': service_location,
        'service_icon': service_icon,
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
            elif job.extras and not result.get('metrics_json'):
                # Optimizer fallback path returned None — still surface
                # best_drop so the row renders with item info.
                result['metrics_json'] = {'best_drop': job.extras.get('best_drop')}
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
        'pets': char_config.get('pets', []),
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
    for item_id, state in merged_overrides.items():
        if not isinstance(state, dict):
            continue
        if state.get('hide'):
            norm = _normalize_item_id(item_id)
            if norm:
                items.add(norm)
                # Also strip ring rarity suffix so a drop normalized
                # without quality (e.g. 'gold_ruby_ring') matches a
                # hidden 'gold_ruby_ring_legendary'.
                for suffix in ('_common', '_uncommon', '_rare', '_epic',
                               '_legendary', '_ethereal'):
                    if norm.endswith(suffix):
                        items.add(norm[:-len(suffix)])
                        break
        # hide_fine intentionally NOT respected for new_items — the kind
        # buckets here are non-quality-aware (a drop is "Birch skis", not
        # "Birch skis (Fine)"), so a fine-only hide shouldn't suppress
        # the base item.

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


def _build_pet_items(session_uuid: str, db_path: str):
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

    return pet_items


def _collect_owned_consumables(character):
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


def exact_xp_enabled_for(session_uuid, db_path=None):
    """True if the exact XP optimizer should run for this session.

    Works on BOTH the server path (run_worker) and the local/Pyodide path
    (optimize-local-worker.js) -- allowlist first (bundle-safe), then the
    DatabaseManager feature flag when available (server / admin-enabled).
    """
    if session_uuid in _EXACT_XP_SESSIONS:
        return True
    try:
        from ui.database import DatabaseManager
        return bool(DatabaseManager(db_path).has_feature(session_uuid, 'exact_xp_optimizer'))
    except Exception:
        return False


def run_worker(session_uuid: str, run_id: str, db_path: str,
               categories: List[str], skills: List[str],
               notify: bool, mode: str,
               include_pets: bool = False, include_consumables: bool = False,
               stale_only: bool = False,
               kinds: Optional[List[str]] = None,
               chests_filter: Optional[List[str]] = None,
               skills_by_category: Optional[dict] = None,
               chests_by_category: Optional[dict] = None):
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
    """
    from ui.database import DatabaseManager

    print(f'[stats_report_worker] Starting run {run_id} for session {session_uuid}')
    print(f'[stats_report_worker] Categories: {categories}, Skills: {skills}, Mode: {mode}')

    # Reset per-run stale-detection memo caches (snapshot + effective-owned
    # bitmap). One run per worker process today, but clear defensively in case
    # run_worker is ever invoked twice in a process or from tests.
    _reset_stale_memo()
    print(f'[stats_report_worker] include_pets={include_pets} include_consumables={include_consumables}')

    # Load character
    character = load_character(session_uuid, db_path)
    print(f'[stats_report_worker] Loaded character: {getattr(character, "name", "unknown")}')

    # [EXACT XP optimizer] feature gate -- ON only for opted-in sessions. The
    # gated hook in run_optimizer_for_job then runs the exact B&B for xp jobs.
    globals()['_VALVE_LOG_DB_PATH'] = db_path
    globals()['_EXACT_XP_MODE'] = exact_xp_enabled_for(session_uuid, db_path)
    if globals().get('_EXACT_XP_MODE'):
        print('[stats_report_worker] EXACT_XP_MODE enabled for this session')

    # Build owned-pet and owned-consumable lists ONCE up-front so every
    # job's optimizer call can reuse the same pool. Each helper is
    # tolerant of empty/missing data — returns [] when the user has no
    # pets / no consumables in their character config.
    pet_items_pool = _build_pet_items(session_uuid, db_path) if include_pets else []
    consumable_items_pool = _collect_owned_consumables(character) if include_consumables else []
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
        from ui.database import DatabaseManager as _DB
        _db = _DB(db_path)
        _session = _db.get_session(session_uuid) or {}
        _char_config = _session.get('character_config') or {}
        if isinstance(_char_config, str):
            _char_config = json.loads(_char_config)
        from optimize_travel_gearsets import detect_unlocked_regions, detect_locked_locations
        _region_info = detect_unlocked_regions(_char_config)
        _unlocked_regions = set(_region_info.get('unlocked', _region_info).keys()) if isinstance(_region_info, dict) else set()
        if isinstance(_region_info, dict):
            _unlocked_regions = {r for r, v in (_region_info.get('unlocked') or _region_info).items() if v}
        # ghostly/spectral are the charter realm BEYOND Wraithwater. Wallisia
        # entry is now GDTE-based, so only unlock these sub-regions with the
        # Charter of the Drowned — not on Wallisia entry alone (else a
        # GDTE-only player would wrongly reach the spectral realm).
        _has_charter = any(
            (c if isinstance(c, str) else (c.get('name') or c.get('id') or c.get('export_name') or ''))
            .lower().replace(' ', '_').replace("'", '') == 'charter_of_the_drowned'
            for c in (_char_config.get('collectibles') or [])
        )
        if _has_charter:
            _unlocked_regions.update({'ghostly', 'spectral'})
        _locked_locations = detect_locked_locations(_char_config) or set()
        globals()['_UNLOCKED_REGIONS'] = _unlocked_regions
        globals()['_LOCKED_LOCATIONS'] = _locked_locations
        print(f'[stats_report_worker] unlocked_regions={sorted(_unlocked_regions)}, '
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

    # Stats-report stale-detection: filter to stale/newly-unlocked scopes only
    # when --stale-only true. This is the new default behavior — Optimize button
    # always sends stale_only=true, and the filter computes stale list dynamically
    # via detect_stale_scopes (not from cache, which may be empty on first run).
    if stale_only:
        before = len(all_jobs)
        all_jobs = _filter_jobs_to_stale_only(all_jobs, session_uuid, db_path)
        print(f'[stats_report_worker] stale_only filter: {before} -> {len(all_jobs)} jobs')
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
        db = DatabaseManager(db_path)
        # Update total_jobs to actual count so UI shows 0/0 correctly
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

    try:
        categories = json.loads(args.categories)
        skills = json.loads(args.skills)
        notify = args.notify.lower() in ('true', '1', 'yes')
        include_pets = args.include_pets.lower() in ('true', '1', 'yes')
        include_consumables = args.include_consumables.lower() in ('true', '1', 'yes')
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
            stale_only=stale_only,
            kinds=kinds,
            chests_filter=chests_filter,
            skills_by_category=skills_by_category,
            chests_by_category=chests_by_category,
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
                                      char_config=sess.get('character_config') or {})
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
