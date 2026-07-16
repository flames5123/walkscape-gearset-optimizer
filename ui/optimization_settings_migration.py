"""
Activity sorting migration helper + Recipe X-per-Y migration.

## Activity sorting migration

Three "finding" metrics were retired in favor of a single duplicable
`steps_per_reward_roll` metric with per-entry category targets:

    steps_for_chest           -> steps_per_reward_roll + target=cat:chests
    steps_for_fine_material   -> steps_per_reward_roll + target=cat:fine
    steps_for_collectible     -> steps_per_reward_roll + target=cat:collectibles

Some users never interacted with these defaults and would be worse off
with three separate rows cluttering their priority list. The migration
detects "pristine" defaults (all three present at weight 100, no target,
in default relative order) and, if they sit outside the top 5 positions,
strips them entirely to keep the simple experience. Pristine entries that
do sit in the top 5 get migrated normally because their prominent
placement suggests the user cares.

Non-pristine entries (customized weights, explicit targets, swapped
order) are always migrated with customizations preserved.

Every session that passes through this migration is logged once to
`optimization_settings_migration_log` so the rollout can be audited.

## Recipe X-per-Y migration

The recipe priority list used to be a flat list of named metrics
(`materials_for_target`, `total_crafts`, `primary_xp_per_step`, etc.)
stored as `[key, weight, target]` tuples. The redesign generalizes every
recipe metric to an X-per-Y pair plus a separate "budget" mode:

    materials_for_target     -> {mode: ratio, x: materials,       y: quality}
    total_crafts             -> {mode: ratio, x: total_crafts,    y: quality}
    steps_for_target         -> {mode: ratio, x: expected_steps,  y: quality}
    expected_steps_per_item  -> {mode: ratio, x: expected_steps,  y: craft}
    current_steps            -> {mode: ratio, x: displayed_steps, y: craft}
    materials_per_craft      -> {mode: ratio, x: materials,       y: craft}
    primary_xp_per_step      -> {mode: ratio, x: xp,              y: step}
    primary_xp_per_action    -> {mode: ratio, x: xp,              y: action}
    materials_per_chest      -> {mode: ratio, x: materials,       y: target_item, targetItem: cat:chests}
    xp_per_material          -> {mode: ratio, x: xp,              y: materials}
    steps_for_budget         -> {mode: budget}

Each new-form entry also carries `quality` (for y=quality), `weight` (0-100),
`hiddenInQuick` (boolean — the "eye icon" flag), and `budgetMats`/`budgetTarget`
(budget mode only).

Default visibility in the Quick panel:
  - visible: materials/quality, total_crafts/quality, expected_steps/quality,
    steps_for_budget
  - hidden:  everything else

The migration preserves each saved entry's weight and explicit target
(e.g. quality value for the three quality-targeted metrics, chest category
for materials_per_chest). Any key the user previously removed via the X
button — tracked in `ui_config.optimize_removed_recipe` — is added back
as a hidden-from-Quick entry so the user can still unhide it from Detailed.
"""
from __future__ import annotations

from typing import Iterable, List, Optional, Tuple


# Legacy deprecated keys → new (key, target) pair. Order here defines the
# "default relative order" used by the pristine detector.
DEPRECATED_KEY_MIGRATION: List[Tuple[str, Tuple[str, str]]] = [
    ('steps_for_chest',         ('steps_per_reward_roll', 'cat:chests')),
    ('steps_for_fine_material', ('steps_per_reward_roll', 'cat:fine')),
    ('steps_for_collectible',   ('steps_per_reward_roll', 'cat:collectibles')),
]
DEPRECATED_KEY_MAP = dict(DEPRECATED_KEY_MIGRATION)
DEPRECATED_ORDER = [k for k, _ in DEPRECATED_KEY_MIGRATION]

# Already-migrated cat targets, in the same default relative order.
MIGRATED_CAT_TARGETS = ['cat:chests', 'cat:fine', 'cat:collectibles']

# Pristine entries in the top 5 positions are preserved (migrated as normal).
# Anywhere below that, pristine entries are stripped entirely.
TOP_N_CUTOFF = 5


def _entry_key(entry) -> str:
    if isinstance(entry, (list, tuple)) and entry:
        return entry[0] if isinstance(entry[0], str) else ''
    if isinstance(entry, str):
        return entry
    return ''


def _entry_weight(entry) -> Optional[int]:
    if isinstance(entry, (list, tuple)) and len(entry) >= 2:
        try:
            return int(entry[1])
        except (ValueError, TypeError):
            return None
    return None


def _entry_target(entry):
    if isinstance(entry, (list, tuple)) and len(entry) >= 3:
        return entry[2]
    return None


def detect_pristine_deprecated(sorting_list: list) -> Tuple[bool, List[int]]:
    """Detect pristine deprecated entries in activity sorting.

    A set of entries is "pristine" when all three legacy finding metrics
    are present AND each:
      - has weight 100
      - has no explicit target
      - appears in default relative order (chest before fine before collectible)

    We also recognise the already-migrated shape — three
    `steps_per_reward_roll` rows with targets `cat:chests`, `cat:fine`,
    `cat:collectibles`, weight 100, in the same default relative order —
    so sessions that saved settings once post-migration without touching
    them are still treated as pristine.

    Returns:
        (is_pristine, positions) — positions is the list of indexes (into
        sorting_list) where the three entries live, in the order they were
        found. Empty when not pristine.
    """
    if not sorting_list:
        return False, []

    legacy_positions: List[int] = []
    legacy_keys_found: List[str] = []

    migrated_positions: List[int] = []
    migrated_targets_found: List[str] = []

    for idx, entry in enumerate(sorting_list):
        key = _entry_key(entry)
        weight = _entry_weight(entry)
        target = _entry_target(entry)

        # Legacy deprecated-key form
        if key in DEPRECATED_KEY_MAP:
            if weight != 100 or target:
                return False, []  # customized — not pristine
            legacy_positions.append(idx)
            legacy_keys_found.append(key)
            continue

        # Already-migrated form: steps_per_reward_roll + cat:* target
        if key == 'steps_per_reward_roll' and target in MIGRATED_CAT_TARGETS:
            if weight != 100:
                return False, []  # customized weight
            migrated_positions.append(idx)
            migrated_targets_found.append(target)
            continue

    # Must use exactly one shape (legacy OR migrated) and have all 3.
    if len(legacy_keys_found) == 3 and not migrated_positions:
        if legacy_keys_found != DEPRECATED_ORDER:
            return False, []
        return True, legacy_positions
    if len(migrated_targets_found) == 3 and not legacy_positions:
        if migrated_targets_found != MIGRATED_CAT_TARGETS:
            return False, []
        return True, migrated_positions

    return False, []


def migrate_activity_sorting(
    sorting_list: list,
    *,
    logger=None,
) -> Tuple[list, str]:
    """Migrate an activity sorting list in place.

    Args:
        sorting_list: List of [key, weight, target] triples (or looser
            shapes — str entries and 2-tuples are tolerated). NOT mutated.
        logger: Optional callable taking (message: str) for debug output.

    Returns:
        (new_sorting_list, action) where action is:
            'removed'  — pristine entries stripped (all outside top 5)
            'migrated' — pristine entries migrated (at least one in top 5)
            'custom'   — non-pristine entries migrated with customizations
            'none'     — no deprecated entries present, nothing changed

    Notes:
        * 'custom' covers every non-pristine case that contains deprecated
          keys (e.g. user changed a weight, added a target, reordered).
        * 'none' means the list contains no deprecated content at all —
          typically fresh defaults from a new session.
    """
    if not sorting_list:
        return list(sorting_list or []), 'none'

    is_pristine, positions = detect_pristine_deprecated(sorting_list)

    if is_pristine:
        any_in_top_n = any(p < TOP_N_CUTOFF for p in positions)
        if any_in_top_n:
            # Keep them, apply normal migration (legacy → migrated shape).
            return _migrate_entries(sorting_list), 'migrated'
        # Pristine AND entirely outside top 5 → strip.
        stripped = [
            list(entry) if isinstance(entry, (list, tuple)) else entry
            for i, entry in enumerate(sorting_list)
            if i not in set(positions)
        ]
        if logger:
            logger(f"[migration] stripping pristine deprecated entries at positions {positions}")
        return stripped, 'removed'

    # Not pristine. If no deprecated entries exist, nothing to migrate.
    has_deprecated = False
    for entry in sorting_list:
        key = _entry_key(entry)
        if key in DEPRECATED_KEY_MAP:
            has_deprecated = True
            break
    if not has_deprecated:
        return [
            list(entry) if isinstance(entry, (list, tuple)) else entry
            for entry in sorting_list
        ], 'none'

    return _migrate_entries(sorting_list), 'custom'


def _migrate_entries(sorting_list: list) -> list:
    """Apply the legacy→new key+target rewrite without removing anything.

    Preserves existing targets (only fills in the default cat target when
    the entry had none), clamps weights to 0–100 ints.
    """
    result: list = []
    for entry in sorting_list:
        if isinstance(entry, str):
            key = entry
            if key in DEPRECATED_KEY_MAP:
                new_key, new_target = DEPRECATED_KEY_MAP[key]
                result.append([new_key, 100, new_target])
            else:
                result.append([key, 100, None])
            continue

        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            key = entry[0] if isinstance(entry[0], str) else ''
            try:
                weight = max(0, min(100, int(entry[1])))
            except (ValueError, TypeError):
                weight = 100
            target = entry[2] if len(entry) >= 3 else None
            if key in DEPRECATED_KEY_MAP:
                new_key, new_target = DEPRECATED_KEY_MAP[key]
                result.append([new_key, weight, target or new_target])
            else:
                result.append([key, weight, target])
    return result


# ---------------------------------------------------------------------------
# Recipe X-per-Y migration
# ---------------------------------------------------------------------------

# Legacy recipe sorting keys → new X-per-Y form.
# Value tuple: (mode, x, y, default_target_item, default_hidden_in_quick)
LEGACY_RECIPE_KEY_MIGRATION: dict = {
    # Quality targets — default-visible in Quick.
    'materials_for_target':    ('ratio',  'materials',       'quality',     None,         False),
    'total_crafts':            ('ratio',  'total_crafts',    'quality',     None,         False),
    'steps_for_target':        ('ratio',  'expected_steps',  'quality',     None,         False),
    # Budget — default-visible in Quick (mode='budget' ignores x/y).
    'steps_for_budget':        ('budget', '',                '',            None,         False),
    # Everything else — default-hidden in Quick.
    'expected_steps_per_item': ('ratio',  'expected_steps',  'craft',       None,         True),
    'current_steps':           ('ratio',  'expected_steps',  'craft',       None,         True),
    'materials_per_craft':     ('ratio',  'materials',       'craft',       None,         True),
    'primary_xp_per_step':     ('ratio',  'xp',              'step',        None,         True),
    'primary_xp_per_action':   ('ratio',  'xp',              'action',      None,         True),
    'materials_per_chest':     ('ratio',  'materials',       'target_item', 'cat:chests', True),
    'xp_per_material':         ('ratio',  'xp',              'materials',   None,         True),
}

# Default order for a fresh recipe priority list. Matches the order used in
# `ui/static/js/craftingpoll.js::defaultPriorities()` so the mockup and
# production defaults stay in sync.
DEFAULT_RECIPE_ORDER: List[str] = [
    'materials_for_target',     # visible
    'total_crafts',             # visible
    'expected_steps_per_item',  # hidden
    'current_steps',            # hidden
    'materials_per_craft',      # hidden
    'primary_xp_per_step',      # hidden
    'steps_for_target',         # visible
    'primary_xp_per_action',    # hidden
    'materials_per_chest',      # hidden
    'steps_for_budget',         # visible (budget mode)
    'xp_per_material',          # hidden
]

# Valid axis values (keep in sync with craftingpoll.js AXIS_OPTIONS).
_VALID_X_AXES = {'materials', 'total_crafts', 'expected_steps', 'displayed_steps', 'xp', 'action'}
_VALID_Y_AXES = {'materials', 'craft', 'step', 'action', 'quality', 'target_item'}
_VALID_QUALITIES = {'Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'}


def _clamp_weight(w) -> int:
    """Clamp a weight value to the 0-100 integer range, defaulting to 100."""
    try:
        return max(0, min(100, int(w)))
    except (ValueError, TypeError):
        return 100


def _make_recipe_entry(
    legacy_key: str,
    *,
    weight=100,
    target=None,
    hidden_override: Optional[bool] = None,
) -> Optional[dict]:
    """Build a new-form recipe entry dict from a legacy key + optional target.

    Returns None for unknown legacy keys. For budget mode, `target` is ignored
    (budget values are per-entry inputs, empty by default). For ratio mode,
    `target` is interpreted as:
      - the quality name (Normal/Good/.../Eternal) if y == 'quality'
      - the target-item category (e.g. 'cat:chests') if y == 'target_item'
      - otherwise ignored
    """
    if legacy_key not in LEGACY_RECIPE_KEY_MIGRATION:
        return None
    mode, x, y, ti_default, default_hidden = LEGACY_RECIPE_KEY_MIGRATION[legacy_key]
    hidden = default_hidden if hidden_override is None else bool(hidden_override)

    if mode == 'budget':
        return {
            'mode': 'budget',
            'weight': _clamp_weight(weight),
            'budgetMats': '',
            'budgetTarget': '',
            'hiddenInQuick': hidden,
        }

    # Ratio mode: map legacy `target` into the right field based on Y type.
    quality = 'Perfect'
    target_item = ti_default
    if y == 'quality' and isinstance(target, str) and target in _VALID_QUALITIES:
        quality = target
    elif y == 'target_item' and isinstance(target, str) and target:
        target_item = target

    return {
        'mode': 'ratio',
        'x': x,
        'y': y,
        'weight': _clamp_weight(weight),
        'quality': quality,
        'targetItem': target_item,
        'hiddenInQuick': hidden,
        'editing': False,
    }


def _entry_signature(entry: dict) -> tuple:
    """Loose signature used to decide whether a default metric is already
    represented in the list (any entry with the same (x, y, targetItem)
    counts — e.g. a materials/quality entry at any quality stands in for
    the default). Budget is always singleton.
    """
    if entry.get('mode') == 'budget':
        return ('budget',)
    return (entry.get('x'), entry.get('y'), entry.get('targetItem'))


def _strict_entry_signature(entry: dict) -> tuple:
    """Strict signature used to detect true duplicates during migration.
    Includes quality so a user's intentional duplicates (e.g. materials
    per Perfect + materials per Normal) are preserved, while accidental
    collisions from axis-value collapses (displayed_steps → expected_steps)
    still get deduplicated.
    """
    if entry.get('mode') == 'budget':
        return ('budget',)
    return (
        entry.get('x'),
        entry.get('y'),
        entry.get('targetItem'),
        entry.get('quality') if entry.get('y') == 'quality' else None,
    )


def is_new_form_recipe_entry(entry) -> bool:
    """Detect whether an entry is already in the new dict form."""
    return (
        isinstance(entry, dict)
        and entry.get('mode') in ('ratio', 'budget')
    )


def _normalize_new_form_entry(entry: dict) -> Optional[dict]:
    """Canonicalize a dict entry; return None if it's invalid."""
    if not isinstance(entry, dict):
        return None
    mode = entry.get('mode')
    if mode == 'budget':
        return {
            'mode': 'budget',
            'weight': _clamp_weight(entry.get('weight', 100)),
            'budgetMats': str(entry.get('budgetMats', '') or ''),
            'budgetTarget': str(entry.get('budgetTarget', '') or ''),
            'hiddenInQuick': bool(entry.get('hiddenInQuick', False)),
        }
    if mode != 'ratio':
        return None
    x = entry.get('x')
    y = entry.get('y')
    # Silent migrations for axis values that used to exist but were removed.
    # Mirrors the frontend normalizeEntry migrations so stored state is
    # self-healing on the next save (otherwise orphan entries persist
    # forever and break the UI dropdowns that try to render them).
    if x == 'displayed_steps':
        x = 'expected_steps'
    if y in ('displayed_steps', 'expected_steps'):
        y = 'step'
    if x not in _VALID_X_AXES or y not in _VALID_Y_AXES:
        return None
    quality = entry.get('quality') or 'Perfect'
    if quality not in _VALID_QUALITIES:
        quality = 'Perfect'
    target_item = entry.get('targetItem') or None
    if y == 'target_item' and not target_item:
        # Default to the only recipe category we have today.
        target_item = 'cat:chests'
    return {
        'mode': 'ratio',
        'x': x,
        'y': y,
        'weight': _clamp_weight(entry.get('weight', 100)),
        'quality': quality,
        'targetItem': target_item,
        'hiddenInQuick': bool(entry.get('hiddenInQuick', False)),
        'editing': bool(entry.get('editing', False)),
    }


def default_recipe_sorting() -> List[dict]:
    """Return a fresh default recipe sorting list in the new dict form."""
    result: List[dict] = []
    for key in DEFAULT_RECIPE_ORDER:
        entry = _make_recipe_entry(key)
        if entry is not None:
            result.append(entry)
    return result


def migrate_recipe_sorting(
    sorting_list: list,
    removed_keys: Optional[Iterable[str]] = None,
    *,
    logger=None,
) -> Tuple[List[dict], str]:
    """Migrate a recipe sorting list to the new X-per-Y dict form.

    Input shapes supported:
      1. Legacy: list of `[key, weight, target]` tuples (or lists), or plain
         key strings. Tuples with fewer fields are tolerated.
      2. New form: list of `{mode, x, y, weight, quality, targetItem,
         budgetMats, budgetTarget, hiddenInQuick}` dicts.
      3. Mixed: legacy + new form entries interleaved. Each entry is treated
         independently.

    Args:
        sorting_list: The saved sorting list from `ui_config['optimize_sorting_recipe']`.
        removed_keys: Set of metric keys the user previously removed via the
            X button (`ui_config['optimize_removed_recipe']`). These are
            added back as hidden entries so they remain accessible.
        logger: Optional callable for debug output.

    Returns:
        (new_sorting_list, action) where action is one of:
            'new_defaults'     — input was empty, returned fresh defaults.
            'already_migrated' — input was entirely new-form, no conversion needed.
            'migrated'         — legacy shape detected and converted.
            'mixed'            — a mix of legacy + new-form entries was converted.
    """
    removed_set = {k for k in (removed_keys or []) if isinstance(k, str)}

    # Empty / missing list → fresh defaults (with removed-keys applied).
    if not sorting_list:
        result = default_recipe_sorting()
        if removed_set:
            for i, key in enumerate(DEFAULT_RECIPE_ORDER):
                if key in removed_set and i < len(result):
                    result[i]['hiddenInQuick'] = True
        return result, 'new_defaults'

    # Detect shape.
    has_new = any(is_new_form_recipe_entry(e) for e in sorting_list)
    has_legacy = any(
        (isinstance(e, str) or (isinstance(e, (list, tuple)) and not is_new_form_recipe_entry(e)))
        for e in sorting_list
    )

    result: List[dict] = []
    strict_sigs: set = set()
    for entry in sorting_list:
        if is_new_form_recipe_entry(entry):
            normalized = _normalize_new_form_entry(entry)
            if normalized is not None:
                sig = _strict_entry_signature(normalized)
                if sig in strict_sigs:
                    # Duplicate strict signature (same x/y/target/quality) —
                    # typically an artifact of axis-value collapses like
                    # displayed_steps → expected_steps. Drop the later one
                    # so the earlier entry's customizations survive.
                    continue
                strict_sigs.add(sig)
                result.append(normalized)
            continue

        # Legacy shape.
        key = None
        weight = 100
        target = None
        if isinstance(entry, str):
            key = entry
        elif isinstance(entry, (list, tuple)) and entry:
            if isinstance(entry[0], str):
                key = entry[0]
            if len(entry) >= 2:
                weight = entry[1]
            if len(entry) >= 3:
                target = entry[2]

        if not key:
            continue

        new_entry = _make_recipe_entry(key, weight=weight, target=target)
        if new_entry is None:
            if logger:
                logger(f"[recipe-migration] dropping unknown legacy key: {key!r}")
            continue
        sig = _strict_entry_signature(new_entry)
        if sig in strict_sigs:
            # Two legacy keys mapped onto the same strict signature — drop
            # the later one. Typical case: `current_steps` (displayed_steps
            # collapsed to expected_steps) mapping onto expected_steps_per_item.
            continue
        strict_sigs.add(sig)
        result.append(new_entry)

    # Add back any legacy default metric that isn't already represented. The
    # "represented" check uses the LOOSE signature (x, y, targetItem) so that
    # e.g. a user's materials/Great entry stands in for the materials-for-
    # quality default — we don't want to add materials/Perfect on top.
    #
    # IMPORTANT: we only fill in defaults when the input was a legacy list
    # (first-time migration). Once the user is on the new form, their list
    # is authoritative — removing an entry must stick across reloads. Before
    # this guard, every GET /api/optimization-settings would re-insert
    # entries the user had deleted, which defeated the X-button removal and
    # made the list grow on each reload.
    first_time_migration = has_legacy or not has_new
    if first_time_migration:
        existing_sigs = {_entry_signature(e) for e in result}
        for key in DEFAULT_RECIPE_ORDER:
            stub = _make_recipe_entry(key)
            if stub is None:
                continue
            sig = _entry_signature(stub)
            if sig in existing_sigs:
                # Entry already represented. If the user had previously removed it,
                # flip the existing entry to hiddenInQuick (honors the removal).
                if key in removed_set:
                    for e in result:
                        if _entry_signature(e) == sig:
                            e['hiddenInQuick'] = True
                continue
            # Missing — add it back.
            if key in removed_set:
                stub['hiddenInQuick'] = True
            result.append(stub)
            existing_sigs.add(sig)
    elif removed_set:
        # Already on the new form. Still honor removed_keys by flipping
        # existing matching entries to hidden, but do NOT add back entries
        # the user has deliberately removed from their list.
        for key in removed_set:
            stub = _make_recipe_entry(key)
            if stub is None:
                continue
            sig = _entry_signature(stub)
            for e in result:
                if _entry_signature(e) == sig:
                    e['hiddenInQuick'] = True

    # Classify action for logging.
    if has_new and not has_legacy:
        action = 'already_migrated'
    elif has_legacy and has_new:
        action = 'mixed'
    else:
        action = 'migrated'

    return result, action



# ---------------------------------------------------------------------------
# Activity X-per-Y migration
# ---------------------------------------------------------------------------
#
# Activities have a separate axis catalog from recipes (no quality, no
# materials, no crafts; reward_roll replaces craft as the sub-action
# denominator). The dict shape is the same — {mode, x, y, weight,
# targetItem, hiddenInQuick, editing} — but `quality`/`budgetMats`/
# `budgetTarget` fields are absent (no budget mode for activities).
#
# Two-phase migration:
#   1. `migrate_activity_sorting()` (above) handles deprecated finding-key
#      cleanup (steps_for_chest → steps_per_reward_roll + cat:chests, etc.)
#      producing legacy [key, weight, target] tuples.
#   2. `migrate_activity_to_xy_form()` (below) converts those tuples into
#      the new dict form. Mirrors `migrate_recipe_sorting()`.
# ---------------------------------------------------------------------------

# Legacy activity sorting keys → new X-per-Y form.
# Value tuple: (mode, x, y, default_target_item, default_hidden_in_quick)
#
# Note: 'current_steps_activity' (Displayed Steps/Action) is intentionally
# omitted — per user direction we drop it entirely rather than collapsing
# into 'expected_steps_per_action' (in contrast to recipe, which collapses
# 'current_steps' onto 'expected_steps_per_item'). Legacy entries with
# this key are silently dropped during migration.
LEGACY_ACTIVITY_KEY_MIGRATION: dict = {
    # steps_per_reward_roll has special target-aware visibility — see
    # _make_activity_entry below. The default_hidden_in_quick value here
    # only applies to the no-target form.
    'steps_per_reward_roll':     ('ratio',  'steps',     'reward_roll', None,  True),
    'expected_steps_per_action': ('ratio',  'steps',     'action',      None,  True),
    'primary_xp_per_action':     ('ratio',  'xp',        'action',      None,  True),
    'primary_xp_per_step':       ('ratio',  'xp',        'steps',       None,  True),
    'total_xp_for_action':       ('ratio',  'total_xp',  'action',      None,  True),
    'total_xp_per_step':         ('ratio',  'total_xp',  'steps',       None,  True),
}

# Targets for steps_per_reward_roll that are visible in the Quick panel
# by default. cat:normal_items is the new fresh-default visible target.
# cat:chests/fine/collectibles are kept here so EXISTING legacy sessions
# that had Steps/Chest/Fine/Collectible from the original migration keep
# those entries visible after the dict-form upgrade — only the FRESH
# defaults (clicks Reset / new session) switch to cat:normal_items.
_ACTIVITY_QUICK_VISIBLE_TARGETS = frozenset({
    'cat:normal_items',
    'cat:chests',
    'cat:fine',
    'cat:collectibles',
})

# Default order for a fresh activity priority list. Six entries matching
# the legacy default order — what the user sees on Reset to Default.
# Mirrors the legacy app.py behavior of seeding all activity-applicable
# Sorting enums with weight 100, minus the dropped DISPLAYED_STEPS_PER_ACTION.
# Only the (steps, target_item, cat:normal_items) entry is visible in
# Quick by default; the rest are hidden until the user unhides them.
DEFAULT_ACTIVITY_ORDER: List[Tuple[str, Optional[str]]] = [
    ('steps_per_reward_roll',     'cat:normal_items'), # visible — Steps / Normal Items
    ('total_xp_per_step',         None),               # hidden — Total XP / Step
    ('primary_xp_per_step',       None),               # hidden — Primary XP / Step
    ('total_xp_for_action',       None),               # hidden — Total XP / Action
    ('expected_steps_per_action', None),               # hidden — Steps / Action (Displayed Steps was dropped)
    ('primary_xp_per_action',     None),               # hidden — Primary XP / Action
]

# Valid axis values (keep in sync with xy-activity-priority-list.js
# AXIS_OPTIONS). 'reward_roll' was REMOVED — it was redundant with
# target_item + cat:normal_items. Migration in
# `_normalize_new_form_activity_entry` collapses any persisted
# reward_roll entry into (steps, target_item, cat:normal_items)
# BEFORE this validation runs, so reward_roll never reaches the
# validity check.
_VALID_ACTIVITY_X_AXES = {'action', 'steps', 'xp', 'total_xp'}
_VALID_ACTIVITY_Y_AXES = {'action', 'steps', 'target_item'}


def _make_activity_entry(
    legacy_key: str,
    *,
    weight=100,
    target=None,
    hidden_override: Optional[bool] = None,
) -> Optional[dict]:
    """Build a new-form activity entry dict from a legacy key + optional target.

    Returns None for unknown legacy keys (including the explicitly-dropped
    `current_steps_activity`). For ratio mode, `target` is interpreted as:
      - the target-item category (e.g. 'cat:chests') if y == 'target_item'
        OR if the legacy key is `steps_per_reward_roll` AND target is set
        (because steps_per_reward_roll's Y axis is auto-flipped to
        target_item when a target is present)
      - otherwise ignored

    Visibility: `steps_per_reward_roll + cat:chests/fine/collectibles` is
    visible in Quick by default; everything else starts hidden. Caller
    can override via `hidden_override`.
    """
    if legacy_key not in LEGACY_ACTIVITY_KEY_MIGRATION:
        return None
    mode, x, y, ti_default, default_hidden = LEGACY_ACTIVITY_KEY_MIGRATION[legacy_key]

    # steps_per_reward_roll is always migrated to y='target_item'.
    # When a cat:* target is present (legacy form like
    # `steps_per_reward_roll + cat:chests`), use that target.
    # When no target is present (raw "any drop" form), default to
    # cat:normal_items — the new "Normal Items" category that covers
    # the same conceptual ground. The legacy `reward_roll` Y axis is
    # never produced by migration; the JS-side normalizeEntry collapses
    # any persisted reward_roll entries into target_item + cat:normal_items
    # on load too.
    target_item: Optional[str] = ti_default
    if legacy_key == 'steps_per_reward_roll':
        y = 'target_item'
        if isinstance(target, str) and target:
            target_item = target
        else:
            target_item = 'cat:normal_items'
    elif y == 'target_item' and isinstance(target, str) and target:
        target_item = target

    # Default visibility:
    #   - Target-item entries with cat:chests/fine/collectibles → visible
    #   - Everything else → hidden
    if hidden_override is not None:
        hidden = bool(hidden_override)
    elif y == 'target_item' and target_item in _ACTIVITY_QUICK_VISIBLE_TARGETS:
        hidden = False
    else:
        hidden = default_hidden

    return {
        'mode': 'ratio',
        'x': x,
        'y': y,
        'weight': _clamp_weight(weight),
        'targetItem': target_item,
        'hiddenInQuick': hidden,
        'editing': False,
    }


def _activity_entry_signature(entry: dict) -> tuple:
    """Loose signature used to decide whether a default metric is already
    represented in the list. Activity entries don't have quality, so the
    signature is just (x, y, targetItem). Budget mode doesn't apply.
    """
    return (entry.get('x'), entry.get('y'), entry.get('targetItem'))


def is_new_form_activity_entry(entry) -> bool:
    """Detect whether an entry is already in the new dict form.

    Activity-specific check: dict with mode='ratio'. Activities don't
    have budget mode, so a `mode='budget'` dict in an activity list
    is treated as malformed (returns False, gets dropped).
    """
    return isinstance(entry, dict) and entry.get('mode') == 'ratio'


def _normalize_new_form_activity_entry(entry: dict) -> Optional[dict]:
    """Canonicalize a dict entry; return None if it's invalid.

    Drops budget-mode entries (activities have no budget). Drops entries
    with axes not in the activity catalog. Strips recipe-only fields
    (quality, budgetMats, budgetTarget) — they're not stored on activity
    entries even if accidentally present.

    Migrates reward_roll → (steps, target_item, cat:normal_items)
    BEFORE validating axes, so legacy persisted entries with x=reward_roll
    OR y=reward_roll survive the validation. Mirrors the JS-side
    `normalizeEntry` migration in xy-activity-priority-list.js.
    """
    if not isinstance(entry, dict):
        return None
    if entry.get('mode') != 'ratio':
        return None
    x = entry.get('x')
    y = entry.get('y')
    target_item = entry.get('targetItem') or None
    # Silent migration: collapse any reward_roll usage into the
    # canonical (steps, target_item, cat:normal_items) form. Done
    # BEFORE the axis-validity check so legacy entries don't get
    # silently dropped.
    if x == 'reward_roll' or y == 'reward_roll':
        x = 'steps'
        y = 'target_item'
        if not target_item:
            target_item = 'cat:normal_items'
    if x not in _VALID_ACTIVITY_X_AXES or y not in _VALID_ACTIVITY_Y_AXES:
        return None
    if y == 'target_item' and not target_item:
        # Default to the most common activity target.
        target_item = 'cat:chests'
    return {
        'mode': 'ratio',
        'x': x,
        'y': y,
        'weight': _clamp_weight(entry.get('weight', 100)),
        'targetItem': target_item,
        'hiddenInQuick': bool(entry.get('hiddenInQuick', False)),
        'editing': bool(entry.get('editing', False)),
    }


def default_activity_sorting() -> List[dict]:
    """Return a fresh default activity sorting list in the new dict form."""
    result: List[dict] = []
    for key, target in DEFAULT_ACTIVITY_ORDER:
        entry = _make_activity_entry(key, target=target)
        if entry is not None:
            result.append(entry)
    return result


def migrate_activity_to_xy_form(
    sorting_list: list,
    removed_keys: Optional[Iterable[str]] = None,
    *,
    logger=None,
) -> Tuple[List[dict], str]:
    """Migrate an activity sorting list to the new X-per-Y dict form.

    Mirrors `migrate_recipe_sorting()` for activities. Expects input that
    has already been through the deprecated-key cleanup
    (`migrate_activity_sorting`) and the in-app `normalize_sorting` pass —
    i.e. legacy tuples have keys like `steps_per_reward_roll` (not
    `steps_for_chest`) and dict entries already exist alongside.

    Input shapes supported:
      1. Legacy: list of `[key, weight, target]` tuples (or lists), or
         plain key strings.
      2. New form: list of `{mode, x, y, weight, targetItem,
         hiddenInQuick, editing}` dicts.
      3. Mixed: legacy + new form entries interleaved.

    Args:
        sorting_list: The saved activity sorting list (post deprecated-key
            cleanup).
        removed_keys: Set of metric keys the user previously removed via
            the X button. These are added back as hidden entries so they
            remain accessible via Detailed.
        logger: Optional callable for debug output.

    Returns:
        (new_sorting_list, action) where action is one of:
            'new_defaults'     — input was empty, returned fresh defaults.
            'already_migrated' — input was entirely new-form, no conversion.
            'migrated'         — legacy shape detected and converted.
            'mixed'            — a mix of legacy + new-form was converted.
    """
    removed_set = {k for k in (removed_keys or []) if isinstance(k, str)}

    # Empty / missing list → fresh defaults (with removed-keys applied).
    if not sorting_list:
        result = default_activity_sorting()
        if removed_set:
            for entry in result:
                # Match the loose entry signature against removed keys.
                # Removed keys are stored as the legacy metric_key form
                # (e.g. 'primary_xp_per_step'), so we check by mapping
                # the entry back to its legacy key via x/y/targetItem.
                if _activity_legacy_key_of(entry) in removed_set:
                    entry['hiddenInQuick'] = True
        return result, 'new_defaults'

    # Detect shape.
    has_new = any(is_new_form_activity_entry(e) for e in sorting_list)
    has_legacy = any(
        (isinstance(e, str) or (isinstance(e, (list, tuple)) and not is_new_form_activity_entry(e)))
        for e in sorting_list
    )

    result: List[dict] = []
    sigs: set = set()
    for entry in sorting_list:
        if is_new_form_activity_entry(entry):
            normalized = _normalize_new_form_activity_entry(entry)
            if normalized is not None:
                sig = _activity_entry_signature(normalized)
                if sig in sigs:
                    # Duplicate (same x/y/target) — drop later one so
                    # earlier customizations survive.
                    continue
                sigs.add(sig)
                result.append(normalized)
            continue

        # Legacy shape: [key, weight, target] tuple or bare string.
        key = None
        weight = 100
        target = None
        if isinstance(entry, str):
            key = entry
        elif isinstance(entry, (list, tuple)) and entry:
            if isinstance(entry[0], str):
                key = entry[0]
            if len(entry) >= 2:
                weight = entry[1]
            if len(entry) >= 3:
                target = entry[2]

        if not key:
            continue

        new_entry = _make_activity_entry(key, weight=weight, target=target)
        if new_entry is None:
            if logger:
                logger(f"[activity-migration] dropping unknown legacy key: {key!r}")
            continue
        sig = _activity_entry_signature(new_entry)
        if sig in sigs:
            # Two legacy keys mapped onto the same signature — drop later.
            continue
        sigs.add(sig)
        result.append(new_entry)

    # The user's list is authoritative. We do NOT fill in default
    # entries on legacy migration — that surprised users by adding
    # entries they never had (e.g. cat:normal_items, total_xp/action
    # for someone whose pre-migration list didn't include them).
    # If a user wants the new defaults, they can click Reset to Default.
    # The empty-input case (truly fresh session) is handled at the top
    # of this function and already returns full defaults.
    #
    # We honor `removed_keys` (from optimize_removed_activity) by flipping
    # any matching entries to hiddenInQuick=True ONLY on first-time
    # migration. Once the user is on the new dict form, per-entry
    # hiddenInQuick is the source of truth — re-applying removed_keys on
    # every load would clobber unhide actions on reload (the user toggles
    # the eye to false, save bug rewrites optimize_removed_activity to
    # include every key, next load forces hiddenInQuick=True back on).
    # Mirrors the recipe-side `first_time_migration` guard.
    first_time_migration = has_legacy or not has_new
    if first_time_migration and removed_set:
        for key in removed_set:
            stub = _make_activity_entry(key)
            if stub is None:
                continue
            sig = _activity_entry_signature(stub)
            for e in result:
                if _activity_entry_signature(e) == sig:
                    e['hiddenInQuick'] = True

    # Classify action for logging.
    if has_new and not has_legacy:
        action = 'already_migrated'
    elif has_legacy and has_new:
        action = 'mixed'
    else:
        action = 'migrated'

    return result, action


def _activity_legacy_key_of(entry: dict) -> Optional[str]:
    """Best-effort reverse lookup: dict entry → legacy metric_key.

    Used to honor `optimize_removed_activity` which stores legacy keys.
    Returns None for entries that don't correspond to a known legacy key
    (e.g. novel X/Y combos).

    Note: `('steps', 'reward_roll')` was previously mapped to
    `steps_per_reward_roll`, but reward_roll has been removed from the
    activity axis set entirely. The `('steps', 'target_item')` mapping
    below covers it now — `_make_activity_entry` always rewrites
    `steps_per_reward_roll` to `(steps, target_item)`.
    """
    x = entry.get('x')
    y = entry.get('y')
    if y == 'target_item':
        # All target-item entries map to steps_per_reward_roll today.
        return 'steps_per_reward_roll' if x == 'steps' else None
    pairs = {
        ('steps',    'action'):      'expected_steps_per_action',
        ('xp',       'action'):      'primary_xp_per_action',
        ('xp',       'steps'):       'primary_xp_per_step',
        ('total_xp', 'action'):      'total_xp_for_action',
        ('total_xp', 'steps'):       'total_xp_per_step',
    }
    return pairs.get((x, y))
