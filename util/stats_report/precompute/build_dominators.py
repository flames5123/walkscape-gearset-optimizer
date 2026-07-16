"""build_dominators — populate item_static_dominators per (item, scope).

Scope is `(skill, location, quality_mode)` where `quality_mode` is one of:
  - 'activity':            for activity-context dominance (no QO consideration)
  - 'recipe_quality':      for recipe context where QO matters
  - 'recipe_non_quality':  for recipe context where QO is ignored

For each scope, items in the same slot are compared pairwise. Item A
dominates B iff A.stats >= B.stats component-wise across the union of stat
keys, with A strictly greater on at least one key. Inverted stats
(`steps_add`, `steps_percent`) flip the comparison direction (lower is
better).

Items in `items_requiring_runtime_eval` are excluded from BOTH sides of
the comparison (handled at request time per-character).

For incremental refresh (`changed_slugs` provided):
  Identify the set of (skill, location, quality_mode) scopes any changed
  item participates in. Rebuild ALL dominators_bitmap rows in those scopes
  (because a newly-changed item may newly dominate or be-newly-dominated-by
  any item in the same scope).
"""

import time
from typing import Dict, List, Optional, Set, Tuple

# WalkScape stats where lower is better. Apply inverted comparison.
INVERTED_STATS = frozenset({"steps_add", "steps_percent"})

# QO-related stats. Suppressed from `recipe_non_quality` scope.
QUALITY_OUTCOME_STATS = frozenset({"quality_outcome"})

# Quality mode values
QM_ACTIVITY = "activity"
QM_RECIPE_QUALITY = "recipe_quality"
QM_RECIPE_NON_QUALITY = "recipe_non_quality"

# 2026-06-16 (jwbail): skill -> category. WalkScape item stats can be scoped to
# a skill CATEGORY ('artisan' / 'gathering' / 'utility') that applies to every
# skill in that category — not just a specific skill or 'global'. Apprentice
# vest, for example, stores its WE/DA/QO under _stats['artisan']['global'].
# _effective_stats_in_scope previously matched only the exact skill or 'global',
# so all category-scoped items (72 artisan / 74 gathering / 36 utility) resolved
# to EMPTY stats in a per-skill scope and got dropped from the maximal bitmap —
# their quality/ownership changes never flipped item_change. Including the
# scope skill's category key fixes that.
_SKILL_TO_CATEGORY = {}
for _s in ("fishing", "foraging", "hunting", "mining", "woodcutting"):
    _SKILL_TO_CATEGORY[_s] = "gathering"
for _s in ("carpentry", "cooking", "crafting", "smithing", "tailoring", "trinketry"):
    _SKILL_TO_CATEGORY[_s] = "artisan"
for _s in ("agility",):
    _SKILL_TO_CATEGORY[_s] = "utility"


def _get_item_slot(item) -> Optional[str]:
    """Return canonical slot for an item, or None if no fixed slot."""
    return getattr(item, "slot", None)


def _get_item_stats(item) -> Dict:
    """Return the item's nested stat dict {skill: {location: {stat: val}}}."""
    return getattr(item, "_stats", None) or getattr(item, "stats", {}) or {}


def _enumerate_scope_keys(
    catalog_items: List[Tuple[str, str, object]],
) -> Set[Tuple[str, str, str]]:
    """Return the set of (skill, location, quality_mode) triples that have
    at least one participating item across the entire catalog."""
    scopes: Set[Tuple[str, str, str]] = set()
    for slug, quality, item in catalog_items:
        stats = _get_item_stats(item)
        for skill, by_loc in stats.items():
            if not isinstance(by_loc, dict):
                continue
            for loc in by_loc:
                # Activity dominance applies to everything
                scopes.add((skill, loc, QM_ACTIVITY))
                # Recipe modes only apply to crafting-relevant skills
                # (we generate them broadly; uninvolved scopes will just
                # produce empty rows)
                scopes.add((skill, loc, QM_RECIPE_QUALITY))
                scopes.add((skill, loc, QM_RECIPE_NON_QUALITY))
    return scopes


def _effective_stats_in_scope(
    item, skill: str, location: str, quality_mode: str
) -> Dict[str, float]:
    """Flatten item's stats restricted to (skill, location, quality_mode)
    into a flat {stat: value} dict.

    Includes:
      - Stats keyed at item._stats[skill][location]
      - Stats keyed at item._stats[skill]['global'] (skill-global)
      - Stats keyed at item._stats['global'][location] (location-global)
      - Stats keyed at item._stats['global']['global']

    Excludes:
      - Items whose location is `!<loc>` and the requested location matches
        (handled by the !-prefix check below)
      - QO-class stats when quality_mode is 'recipe_non_quality'
    """
    raw = _get_item_stats(item)
    flat: Dict[str, float] = {}
    # Accept the exact skill, 'global', AND the skill's CATEGORY
    # ('artisan'/'gathering'/'utility') — category-scoped stats apply to every
    # skill in that category (see _SKILL_TO_CATEGORY note above).
    _accepted_skill_keys = {skill, "global"}
    _cat = _SKILL_TO_CATEGORY.get(skill)
    if _cat:
        _accepted_skill_keys.add(_cat)

    def _add(stat_block):
        if not isinstance(stat_block, dict):
            return
        for stat, val in stat_block.items():
            if quality_mode == QM_RECIPE_NON_QUALITY and stat in QUALITY_OUTCOME_STATS:
                continue
            try:
                flat[stat] = flat.get(stat, 0.0) + float(val)
            except (TypeError, ValueError):
                pass

    def _location_matches(scope_loc: str, item_loc: str) -> bool:
        if item_loc == "global":
            return True
        if item_loc.startswith("!"):
            # Excluded location
            return scope_loc != item_loc[1:]
        return scope_loc == item_loc

    for s_key, by_loc in raw.items():
        if not isinstance(by_loc, dict):
            continue
        if s_key not in _accepted_skill_keys:
            continue
        for loc_key, stats_dict in by_loc.items():
            if _location_matches(location, loc_key):
                _add(stats_dict)

    return flat


def _statically_dominates(
    a_stats: Dict[str, float], b_stats: Dict[str, float]
) -> bool:
    """A strictly statically dominates B: A>=B on all stats, A>B on >=1."""
    if not a_stats and not b_stats:
        return False
    all_keys = set(a_stats) | set(b_stats)
    if not all_keys:
        return False
    a_better_anywhere = False
    for key in all_keys:
        a_v = a_stats.get(key, 0.0)
        b_v = b_stats.get(key, 0.0)
        if key in INVERTED_STATS:
            if a_v > b_v:
                return False
            if a_v < b_v:
                a_better_anywhere = True
        else:
            if a_v < b_v:
                return False
            if a_v > b_v:
                a_better_anywhere = True
    return a_better_anywhere


def _enumerate_all_catalog_items() -> List[Tuple[str, str, object]]:
    """Return list of (slug, quality, item_obj) for every item to be considered.

    For CraftedItem, yields one entry per quality tier with its quality-specific
    stat object resolved.
    """
    import util.walkscape_constants  # noqa: F401
    from util.autogenerated.equipment import (
        Item, ItemInstance, AchievementItem, CraftedItem,
    )
    from util.autogenerated.consumables import Consumable, ConsumableItem
    from util.autogenerated.pets import PETS_BY_NAME
    from .build_item_ids import _tier_to_crafted_key, QUALITY_TIERS

    out: List[Tuple[str, str, object]] = []

    # Equipment
    for attr_name in dir(Item):
        if attr_name.startswith("_"):
            continue
        v = getattr(Item, attr_name, None)
        slug = attr_name.lower()
        if isinstance(v, ItemInstance):
            out.append((slug, "normal", v))
        elif isinstance(v, AchievementItem):
            # Skip — will be runtime_eval, no static dominators
            continue
        elif isinstance(v, CraftedItem):
            for tier in QUALITY_TIERS:
                tier_key = _tier_to_crafted_key(tier)
                if tier_key in v._quality_stats or tier == "normal":
                    instance = getattr(v, tier_key.upper())
                    out.append((slug, tier, instance))

    # Consumables
    for attr_name in dir(Consumable):
        if attr_name.startswith("_"):
            continue
        v = getattr(Consumable, attr_name, None)
        if isinstance(v, ConsumableItem):
            slug = attr_name.lower()
            out.append((slug, "normal", v))
            out.append((slug, "fine", v))  # Fine variant uses same stats; bitmap captures membership

    # Pets (treated as runtime-eval — skip from static dominance)

    return out


def _bitmap_size_bits(max_id: int) -> int:
    """Bitmap size in bits to cover ids 1..max_id."""
    return max_id + 1  # bit 0 unused; ids start at 1


def _empty_bitmap(max_id: int) -> bytearray:
    return bytearray((_bitmap_size_bits(max_id) + 7) // 8)


def _set_bit(bm: bytearray, idx: int) -> None:
    if idx < 0 or idx >= len(bm) * 8:
        return
    bm[idx // 8] |= 1 << (idx % 8)


def build_static_dominators(
    db,
    changed_slugs: Optional[Set[str]] = None,
    full_rebuild: bool = False,
) -> int:
    """Populate item_static_dominators.

    Args:
        db: sqlite3 connection
        changed_slugs: when provided, only scopes touched by changed items
                       get rebuilt. When None and full_rebuild=False, behaves
                       as if changed_slugs=set() (no-op).
        full_rebuild: when True, ignore changed_slugs and rebuild everything.

    Returns:
        Number of dominators_bitmap rows written.
    """
    from .build_item_ids import get_item_id_map, get_max_item_id
    from .scan_runtime_eval import get_runtime_eval_set

    item_id_map = get_item_id_map(db)
    max_id = get_max_item_id(db)
    if max_id == 0:
        return 0

    runtime_eval_ids = get_runtime_eval_set(db)
    catalog = _enumerate_all_catalog_items()
    # Filter out runtime_eval items from the candidate pool
    catalog_filtered = [
        (slug, qty, item)
        for slug, qty, item in catalog
        if item_id_map.get((slug, qty)) is not None
        and item_id_map[(slug, qty)] not in runtime_eval_ids
    ]

    all_scopes = _enumerate_scope_keys(catalog_filtered)
    if not full_rebuild and changed_slugs is not None:
        # Restrict to scopes any changed item participates in
        changed_scope_set: Set[Tuple[str, str, str]] = set()
        for slug, qty, item in catalog_filtered:
            if slug not in changed_slugs:
                continue
            stats = _get_item_stats(item)
            for s_key, by_loc in stats.items():
                if not isinstance(by_loc, dict):
                    continue
                for loc_key in by_loc:
                    real_loc = loc_key[1:] if loc_key.startswith("!") else loc_key
                    for qm in (QM_ACTIVITY, QM_RECIPE_QUALITY, QM_RECIPE_NON_QUALITY):
                        if s_key == "global":
                            # Global scopes can participate in any (skill, loc) — restrict to scopes that
                            # actually exist in the catalog
                            for sc in all_scopes:
                                if sc[1] == real_loc and sc[2] == qm:
                                    changed_scope_set.add(sc)
                        else:
                            if real_loc == "global":
                                for sc in all_scopes:
                                    if sc[0] == s_key and sc[2] == qm:
                                        changed_scope_set.add(sc)
                            else:
                                changed_scope_set.add((s_key, real_loc, qm))
        scopes_to_rebuild = changed_scope_set & all_scopes
    elif full_rebuild:
        scopes_to_rebuild = all_scopes
    else:
        scopes_to_rebuild = set()

    if not scopes_to_rebuild:
        return 0

    cursor = db.cursor()
    now = int(time.time())
    rows_written = 0

    # Group catalog items by slot for faster pairwise iteration
    items_by_slot: Dict[str, List[Tuple[int, object]]] = {}
    for slug, qty, item in catalog_filtered:
        slot = _get_item_slot(item)
        if not slot:
            continue
        item_id = item_id_map.get((slug, qty))
        if item_id is None:
            continue
        items_by_slot.setdefault(slot, []).append((item_id, item))

    for skill, location, quality_mode in scopes_to_rebuild:
        # Clear existing rows for this scope before rebuilding
        cursor.execute(
            "DELETE FROM item_static_dominators WHERE skill = ? AND location = ? AND quality_mode = ?",
            (skill, location, quality_mode),
        )
        # For each slot's items, compute effective stats in this scope, then
        # pairwise dominance check.
        for slot, slot_items in items_by_slot.items():
            # Resolve effective stats in this scope for each candidate
            scoped: List[Tuple[int, Dict[str, float]]] = []
            for item_id, item in slot_items:
                eff = _effective_stats_in_scope(item, skill, location, quality_mode)
                if eff:
                    scoped.append((item_id, eff))
            if not scoped:
                continue
            # For each item, build bitmap of dominators
            for self_id, self_stats in scoped:
                bm = _empty_bitmap(max_id)
                any_dom = False
                for other_id, other_stats in scoped:
                    if other_id == self_id:
                        continue
                    if _statically_dominates(other_stats, self_stats):
                        _set_bit(bm, other_id)
                        any_dom = True
                if any_dom:
                    cursor.execute(
                        "INSERT INTO item_static_dominators "
                        "(item_id, skill, location, quality_mode, dominators_bitmap, last_computed_at) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (self_id, skill, location, quality_mode, bytes(bm), now),
                    )
                    rows_written += 1

    db.commit()
    return rows_written
