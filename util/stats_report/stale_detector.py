"""stale_detector — single funnel for staleness derivation.

detect_stale_scopes(prev, curr, db) combines four sources:
  1. Item-set changes (dominance bitmap XOR)
  2. Metric-input changes (metric_inputs_hash diff)
  3. Optimization-version bumps (per-category constant comparison)
  4. Newly-unlocked sources (set difference vs current applicable set)

EVERY caller that mutates character state goes through this funnel.
No code path computes staleness ad-hoc. Adding a new game state dimension
that affects optimization means extending CharacterStateSnapshot AND
the bitmap / hash / applicable-sources functions — nothing else.

Known callers:
  - ui/app.py:/api/stats-report/state-changed
  - ui/app.py:/api/stats-report/stale-check
"""

from dataclasses import dataclass, field
from typing import FrozenSet, List, Optional, Set, Tuple

from .applicable_sources import enumerate_applicable_sources
from .effective_bitmap import compute_effective_owned_bitmap
from .metric_inputs import compute_metric_inputs_hash
from .optimization_versions import OPTIMIZATION_VERSIONS
from .state_snapshot import CharacterStateSnapshot
from .bitmap_ops import bitmap_diff, iter_set_bits


# Reasons in priority order: item_change > input_change > version_bump > newly_unlocked
REASON_ITEM_CHANGE = "item_change"
REASON_INPUT_CHANGE = "input_change"
REASON_VERSION_BUMP = "version_bump"
REASON_NEWLY_UNLOCKED = "newly_unlocked"


@dataclass(frozen=True)
class StaleScope:
    category: str
    subcategory: str
    source_name: str
    location: str
    service: str
    reason: str
    added_items: FrozenSet[int] = field(default_factory=frozenset)
    removed_items: FrozenSet[int] = field(default_factory=frozenset)


def detect_stale_scopes(
    prev: Optional[CharacterStateSnapshot],
    curr: CharacterStateSnapshot,
    db,
    session_uuid: Optional[str] = None,
    char_config: Optional[dict] = None,
) -> List[StaleScope]:
    """Single call site for staleness derivation.

    char_config is forwarded to enumerate_applicable_sources so it can
    pick the same first-accessible location the worker writes under
    (mirrors stats_report_worker._activity_first_accessible_location).
    Without this, multi-location activities ghost as NEWLY_UNLOCKED.
    """
    cursor = db.cursor()

    # Load existing rows for this session
    if session_uuid is None:
        return []

    # Whether character/UI state changed since the last cached snapshot.
    # When it has NOT changed we can skip the expensive per-row item-set /
    # metric-input recomputation (compute_effective_owned_bitmap +
    # compute_metric_inputs_hash per row) -- nothing feeding those changed.
    # But we MUST still run the version-bump check AND the newly-unlocked
    # check below, because a scope can become stale/missing for reasons
    # independent of character state:
    #   * OPTIMIZATION_VERSIONS bumped (forces a re-run regardless of state)
    #   * the user newly SELECTS a category/kind in the WTO that was never
    #     optimized -- its scopes have no row yet, so they're newly_unlocked
    # The old `if prev == curr: return []` short-circuit skipped BOTH of
    # those, so optimizing a newly-selected category after any prior run
    # scheduled zero jobs and reported "all owned" (jwbail 2026-06-12:
    # "optimize tools, then select tools+eggs -> says all eggs owned and
    # stops"). The job-build filter is the safety net against over-
    # enumeration: newly_unlocked may include all-owned new_items
    # (activity, kind) scopes, but build_new_items_jobs never builds jobs
    # for those, so they get filtered out and never run.
    state_changed = (prev != curr)

    cursor.execute(
        "SELECT category, subcategory, source_name, location, service, "
        "dominance_bitmap, metric_inputs_hash, optimization_version "
        "FROM stats_report_results WHERE session_uuid = ?",
        (session_uuid,),
    )
    existing_rows = cursor.fetchall()
    results: List[StaleScope] = []
    seen_keys: Set[Tuple[str, str, str, str, str]] = set()

    # ── Sources 1, 2, 3: per-row checks ───────────────────────────────
    for row in existing_rows:
        cat, sub, src, loc, svc, stored_bitmap, stored_hash, stored_version = row
        key = (cat, sub, src, loc, svc)
        seen_keys.add(key)

        # 3. Version bump check (cheapest first)
        current_version = OPTIMIZATION_VERSIONS.get(cat, 1)
        if stored_version < current_version:
            results.append(StaleScope(*key, reason=REASON_VERSION_BUMP))
            continue

        # Item-set / metric-input changes only matter when character state
        # actually changed. When it didn't, this row is up to date -- skip
        # the expensive per-row recompute and move on (newly-unlocked is
        # still computed once below, independent of state).
        if not state_changed:
            continue

        # 1. Item-set change: recompute current dominance bitmap
        # Need to derive (skill, location, quality_mode) from the row's scope
        scope_skill, scope_loc, scope_qmode, scope_req_kw = _scope_for_row(cat, sub, src, loc, svc)
        if scope_skill is None:
            continue
        try:
            curr_bitmap = compute_effective_owned_bitmap(
                curr, scope_skill, scope_loc, svc, scope_qmode, db=db,
                required_keywords=scope_req_kw or None,
            )
        except Exception:
            continue
        # AND with applicability so we compare in the same scope as stored
        # Actually the stored bitmap IS the maximal-set scope; comparing directly is fine.
        added, removed = bitmap_diff(curr_bitmap, stored_bitmap)
        added_ids = frozenset(iter_set_bits(added))
        removed_ids = frozenset(iter_set_bits(removed))
        # Show only the items the USER actually changed in their owned set
        # (quality swaps, (un)owns) — NOT the dominance cascade those changes
        # trigger. Upgrading Apprentice Vest Perfect->Eternal (or downgrading
        # back) flips the maximal pool for any item the vest now dominates /
        # no longer dominates (e.g. Treasure Hunter Jacket), which would
        # otherwise be listed as added/removed even though the user never
        # touched it. Intersecting the maximal-pool diff with the owned-set
        # delta ("ran with" vs "current") drops that cascade and keeps both
        # sides of the real change. Falls back to the full diff when there's
        # no prior snapshot or the owned set didn't change (e.g. a skill-up
        # unlocked an already-owned item — the pool grew with no owned delta).
        added_ids, removed_ids = _restrict_to_owned_delta(
            added_ids, removed_ids, prev, curr, db
        )
        if added_ids or removed_ids:
            results.append(StaleScope(
                *key,
                reason=REASON_ITEM_CHANGE,
                added_items=added_ids,
                removed_items=removed_ids,
            ))
            continue

        # 2. Metric-input change
        curr_hash = compute_metric_inputs_hash(curr, cat, sub, src, loc, svc, db=db)
        if curr_hash != stored_hash:
            results.append(StaleScope(*key, reason=REASON_INPUT_CHANGE))
            continue

    # ── Source 4: newly-unlocked sources ──────────────────────────────
    # Always computed. A scope that's applicable to the character but has NO
    # stored result row is surfaced as newly_unlocked — this is the intended
    # "never optimized = stale" signal: if the user optimizes only one
    # category, every other applicable scope keeps its red (!) until it's run
    # (jwbail 2026-06-15). NOTE: do NOT suppress this when state is unchanged
    # — that wrongly cleared the (!) for never-optimized scopes. The earlier
    # "(!) shows crafts under Chest farming for ACTIVITIES" report was a
    # separate chest-chip category leak in the annotator (fixed 28f3893a),
    # not this computation.
    try:
        current_applicable = enumerate_applicable_sources(curr, db=db, char_config=char_config)
    except Exception:
        current_applicable = set()
    newly_unlocked = current_applicable - seen_keys
    for tup in newly_unlocked:
        results.append(StaleScope(*tup, reason=REASON_NEWLY_UNLOCKED))

    # Deterministic order
    results.sort(key=lambda s: (s.category, s.subcategory, s.source_name, s.location, s.service, s.reason))
    return results


def _restrict_to_owned_delta(added_ids, removed_ids, prev, curr, db):
    """Restrict the maximal-pool diff to items the USER actually changed.

    The maximal-set diff (added/removed bits) includes dominance-cascade items:
    when you upgrade/downgrade one item, anything it now dominates (or no longer
    dominates) enters/leaves the pool too. The user didn't touch those, so
    listing them is confusing. We intersect:

        added   ∩  (curr.owned_items  - prev.owned_items)   # newly owned / requalified
        removed ∩  (prev.owned_items  - curr.owned_items)   # un-owned / old quality

    so only the real owned-set change ("ran with" vs "current") survives. Both
    sides of a quality swap are kept (e.g. Perfect added + Eternal removed);
    only the cascade (Treasure Hunter Jacket) is dropped.

    Fallbacks (return the diff unfiltered):
      - prev is None (no prior snapshot to diff against), or
      - the owned set didn't change at all — a non-item state change such as a
        skill-up unlocking an already-owned item grew the pool with no owned
        delta, and we must still surface it.
    Any failure also falls back (fail-open), so we never hide a real change.
    """
    try:
        if prev is None:
            return added_ids, removed_ids
        owned_added_pairs = set(curr.owned_items) - set(prev.owned_items)
        owned_removed_pairs = set(prev.owned_items) - set(curr.owned_items)
        if not owned_added_pairs and not owned_removed_pairs:
            return added_ids, removed_ids  # non-item state change — keep full diff

        from .precompute.build_item_ids import get_item_id_map
        id_map = get_item_id_map(db)  # (slug, quality) -> id
        owned_added_ids = {id_map.get(p) for p in owned_added_pairs}
        owned_removed_ids = {id_map.get(p) for p in owned_removed_pairs}
        owned_added_ids.discard(None)
        owned_removed_ids.discard(None)

        return (
            frozenset(added_ids) & owned_added_ids,
            frozenset(removed_ids) & owned_removed_ids,
        )
    except Exception:
        return added_ids, removed_ids


def _scope_for_row(category: str, subcategory: str, source_name: str, location: str, service: str):
    """Derive (skill, location, quality_mode, required_keywords) for compute_effective_owned_bitmap.

    For activities: scope_skill = primary_skill of source, scope_loc = location, qmode='activity'.
    For chests_recipes: scope_skill = recipe.skill, scope_loc = location, qmode='recipe_quality'.

    required_keywords is the activity's mandatory tool-keyword set (from
    requirements['keyword_counts'], lowercased). It mirrors the write path's
    _required_keywords_for_job so the recomputed bitmap matches the stored one
    for keyword-gated activities (bug 4038424d). Empty for recipes.
    """
    try:
        import util.walkscape_constants  # noqa: F401
        from util.autogenerated.activities import ACTIVITIES_BY_NAME
        from util.autogenerated.recipes import RECIPES_BY_NAME
    except ImportError:
        return None, location, "activity", set()

    if category == "chests_recipes":
        recipe = RECIPES_BY_NAME.get(source_name)
        if recipe is None:
            return None, location, "recipe_quality", set()
        skill = getattr(recipe, "skill", None)
        skill_str = (skill if isinstance(skill, str) else getattr(skill, "name", "")).lower()
        return skill_str, location, "recipe_quality", set()
    else:
        activity = ACTIVITIES_BY_NAME.get(source_name)
        if activity is None:
            return None, location, "activity", set()
        skill = getattr(activity, "skill", None) or getattr(activity, "primary_skill", None)
        skill_str = (skill if isinstance(skill, str) else getattr(skill, "name", "")).lower()
        reqs = getattr(activity, "requirements", None) or {}
        kc = reqs.get("keyword_counts", {}) if isinstance(reqs, dict) else {}
        req_kw = {str(k).lower() for k in kc.keys()} if kc else set()
        return skill_str, location, "activity", req_kw


def write_stale_scopes_cache(db, session_uuid: str, scopes: List[StaleScope]) -> int:
    """Replace the stale_scopes cache for a session with the given list."""
    cursor = db.cursor()
    cursor.execute("DELETE FROM stats_report_stale_scopes WHERE session_uuid = ?", (session_uuid,))
    import time
    now = int(time.time())
    for s in scopes:
        # Encode added/removed item ids as bitmaps for storage
        added_bm = _ids_to_bitmap(s.added_items)
        removed_bm = _ids_to_bitmap(s.removed_items)
        cursor.execute(
            "INSERT INTO stats_report_stale_scopes "
            "(session_uuid, category, subcategory, source_name, location, service, "
            " reason, added_item_ids, removed_item_ids, detected_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (session_uuid, s.category, s.subcategory, s.source_name, s.location, s.service,
             s.reason, added_bm, removed_bm, now),
        )
    db.commit()
    return len(scopes)


def _ids_to_bitmap(ids: FrozenSet[int]) -> Optional[bytes]:
    if not ids:
        return None
    max_id = max(ids)
    bm = bytearray((max_id + 1 + 7) // 8)
    for i in ids:
        bm[i // 8] |= 1 << (i % 8)
    return bytes(bm)
