/**
 * X-per-Y Activity Priority List — shared component used by:
 *   1. Settings Modal > Optimization > Activity section (Detailed mode)
 *   2. Column 3 optimize-button Quick Settings panel (Quick mode, activity)
 *
 * Sister module to xy-recipe-priority-list.js. Same dict shape and
 * UI plumbing (drag/drop, edit-mode, weight sliders, dropdowns) but
 * with an activity-specific axis catalog and target-item picker:
 *   - No quality axis (activities don't roll quality outcomes)
 *   - No budget mode (activities have no produce-N-mats goal)
 *   - 'steps' is one merged axis (recipe splits into step/expected_steps)
 *   - 'total_xp' (all skills combined) added alongside primary 'xp'
 *   - 'target_item' is Y-only with drop-table-aware activity categories
 *     (cat:chests / cat:fine / cat:collectibles / cat:gems / cat:coins
 *     and the IF cats including activity-only bird_nest/crustacean/
 *     fibrous_plant/fishing_bait)
 *
 * NOTE: 'reward_roll' was previously a selectable X/Y axis but is now
 * REMOVED — it was redundant with `target_item + cat:normal_items`
 * (which means the same thing: "any drop") and confused users by
 * presenting two axes with overlapping semantics. Any persisted
 * entry with x=reward_roll OR y=reward_roll is silently migrated
 * to (steps, target_item, cat:normal_items) in normalizeEntry.
 *
 * Data model (per entry):
 *   {
 *     mode:          'ratio',           // activities have no budget mode
 *     x:             string,            // one of AXIS_OPTIONS
 *     y:             string,            // one of AXIS_OPTIONS (target_item only as Y)
 *     weight:        int 0-100,
 *     targetItem:    string,            // ratio + y=target_item (e.g. 'cat:chests')
 *     hiddenInQuick: bool,              // eye icon state
 *     editing:       bool,              // pencil icon state
 *   }
 *
 * Styles are shared with xy-recipe-priority-list.js — we import its
 * `ensureXyStyles()` rather than duplicating the ~600-line CSS block.
 */

import { wireInfoIcons as _wireInfoIcons } from '../info-popover.js';
import { ensureXyStyles, findScrollParent, updateAutoScroll, stopAutoScroll } from './xy-recipe-priority-list.js';
import { resolveItemIcon } from '../utils/resolve-item-icon.js';

// ----------------------------------------------------------------------------
// STYLES — shared with xy-recipe-priority-list.js (imported above)
// ----------------------------------------------------------------------------
// The style block itself lives in the recipe module — running the
// injector twice is idempotent so there's no harm if both modules
// are loaded. We expose the same internal name `injectStylesOnce()`
// so the rest of this file (which calls it from mount()) doesn't
// need to change.
function injectStylesOnce() { ensureXyStyles(); }


// Safe wrapper around wireInfoIcons that tolerates jQuery objects, arrays,
// NodeLists, and $.parseHTML results (whose first entry may be a text
// node that the raw wireInfoIcons chokes on).
function wireInfoIcons(target) {
    if (!target) return;
    if (typeof target.each === 'function' && typeof target.get === 'function') {
        target.each((_, el) => { if (el && el.nodeType === 1) _wireInfoIcons(el); });
        return;
    }
    if (typeof target.length === 'number' && typeof target !== 'string') {
        for (const el of target) if (el && el.nodeType === 1) _wireInfoIcons(el);
        return;
    }
    if (target.nodeType === 1) _wireInfoIcons(target);
}

// Find the nearest ancestor of $el that is actually scrollable (has
// overflow-y: auto/scroll and has scrollTop > 0 capability). Used by
// render() to preserve the outer scroll position when we rebuild the
// panel — without this, the user's scroll jumps to the top every time
// they click duplicate/remove/hide.
function findScrollableAncestor($el) {
    if (!$el || !$el.length) return null;
    let node = $el[0].parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScroll = (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight;
        if (canScroll) return $(node);
        node = node.parentElement;
    }
    return null;
}

// ----------------------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------------------

// Axis catalog. Some axes are x-only (total_crafts is always X because
// "X per Total Crafts" collapses to "X per Craft") or y-only (Craft, Step
// are always denominators; Quality and Target item are always targets).
//
// Note: 'displayed_steps' was removed from the dropdown per user feedback
// (few people use it vs. the probability-weighted expected_steps). Any
// existing entries saved with x='displayed_steps' are silently migrated
// to x='expected_steps' in normalizeEntry below.
// Axis catalog. Some axes are x-only (total_crafts is always X because
// "X per Total Crafts" collapses to "X per Craft") or y-only (Craft, Step
// are always denominators; Quality and Target item are always targets).
//
// Naming notes:
//   - The X option "expected_steps" is labeled "Steps" (not "Expected
//     Steps") because the distinction doesn't read well in the UI — the
//     user thinks in "steps per X" and rarely cares about the
//     expected-vs-displayed nuance.
//   - The Y option "step" (and only "step") is the denominator for "XP
//     per step" etc. The old Y option "expected_steps" was removed
//     entirely since it duplicated "step" — any entry saved with
//     y='expected_steps' is migrated to y='step' in normalizeEntry.
//   - The action icon is a green checkmark with a black border. Inlined
//     as a data: URL so we don't depend on a specific asset file.
const _ACTION_ICON_DATA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M5 12.5 L10 17.5 L19 7.5" fill="none" stroke="#000000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M5 12.5 L10 17.5 L19 7.5" fill="none" stroke="#27ae60" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
);
export const AXIS_OPTIONS = [
    { value: 'action',      label: 'Action',      yOnly: false, xOnly: false, icon: _ACTION_ICON_DATA },
    // 'steps' merges recipe's split between 'expected_steps' (X-only)
    // and 'step' (Y-only) into a single value usable as both. Backend
    // metric_key remains 'expected_steps_per_action' / 'primary_xp_per_step'
    // — the bridge in util/walkscape_constants.py handles the lookup.
    { value: 'steps',       label: 'Steps',       yOnly: false, xOnly: false, icon: '/assets/icons/attributes/steps_required.svg' },
    { value: 'target_item', label: 'Target Item', yOnly: true,  xOnly: false, needs: 'target_item', icon: '/assets/icons/keywords/chest.svg' },
    // 'xp' renders as "Primary XP" per user spec — the underlying value
    // stays 'xp' so the bridge mapping (xy_activity_entry_to_sorting_entry)
    // doesn't need to change. Only the user-facing label differs from recipe.
    { value: 'xp',          label: 'Primary XP',  yOnly: false, xOnly: false, icon: '/assets/icons/attributes/bonus_experience.svg' },
    { value: 'total_xp',    label: 'Total XP',    yOnly: false, xOnly: false, icon: '/assets/icons/attributes/bonus_experience.svg' },
];

const X_OPTIONS = AXIS_OPTIONS.filter(o => !o.yOnly);
const Y_OPTIONS = AXIS_OPTIONS.filter(o => !o.xOnly);

// Activity target categories. Unlike recipe (which has a fixed
// "Chests / Coins / Silver Nugget" set), activity targets come from
// the SELECTED activity's drop table at runtime — passed in via
// state.activityDropTable. The base categories below are the
// drop-table-aware ones the optimizer can score; IF_CATEGORIES are
// the equipment-finding categories shown when the user enables the
// "Include item finding drops" toggle.
//
// `infoItems` is filled in dynamically by the dropdown render based on
// the activity's drop table. The icon path falls back to a keyword
// icon when no item-specific icon exists.
const BASE_TARGET_CATEGORIES = [
    { value: 'cat:normal_items',    name: 'Normal Items',     icon: '/assets/icons/attributes/double_rewards.svg' },
    { value: 'cat:chests',          name: 'Chests',           icon: '/assets/icons/keywords/chest.svg' },
    { value: 'cat:coins',           name: 'Coins',            icon: '/assets/icons/items/coins.svg' },
    { value: 'cat:coins_no_chests', name: 'Coins (no chests)', icon: '/assets/icons/items/coins.svg' },
    { value: 'cat:collectibles',    name: 'Collectibles',     icon: '/assets/icons/keywords/collectible.svg' },
    { value: 'cat:fine',            name: 'Fine Items',       icon: '/assets/icons/keywords/fine_material.svg' },
    { value: 'cat:gems',            name: 'Gems',             icon: '/assets/icons/keywords/gem.svg' },
    { value: 'cat:gems_fine',       name: 'Gems (Fine)',      icon: '/assets/icons/keywords/gem.svg', isFine: true },
    // Single-item categories whose item drops both directly from the
    // activity's drop_table AND via item-finding gear stats. The
    // 'cat:sea_shells' target is now a synthetic aggregator (mirrors
    // 'cat:coins') — the optimizer rolls up direct sea shell drops,
    // fine sea shells (10x via Material.SEA_SHELL_FINE.special_sell),
    // and shell-bearing chests (Coral chest, Sunken chest, Chest of
    // Syrenthia) into a single steps_per_shell value. cat:sea_shells_fine
    // was removed 2026-05-31 — fine variants are folded automatically.
    { value: 'cat:sea_shells',      name: 'Sea Shells',       icon: '/assets/icons/items/materials/sea_shell.svg' },
];

// Activity item-finding categories. Includes the activity-only ones
// (bird_nest, crustacean, fibrous_plant, fishing_bait) that recipe
// excludes. Sorted alphabetically — matches how optimize-button.js
// renders the existing activity dropdown.
const IF_CATEGORIES = [
    { value: 'cat:if:adventurers_guild_tokens', name: "Adventurers' Guild Tokens", icon: "/assets/icons/items/adventurers'_guild_token.svg", infoItems: ["Adventurers' guild token"] },
    { value: 'cat:if:bird_nest',          name: 'Bird Nest',                 icon: '/assets/icons/items/containers/bird_nest.svg', infoItems: ['Bird nest'] },
    { value: 'cat:if:crustacean',         name: 'Crustacean',                icon: '/assets/icons/keywords/crustacean.svg', infoItems: ['Raw crab', 'Raw lobster', 'Raw shrimp'] },
    { value: 'cat:if:crustacean_fine',    name: 'Crustacean (Fine)',         icon: '/assets/icons/keywords/crustacean.svg', isFine: true, infoItems: ['Raw crab (Fine)', 'Raw lobster (Fine)', 'Raw shrimp (Fine)'] },
    { value: 'cat:if:ectoplasm',          name: 'Ectoplasm',                 icon: '/assets/icons/items/materials/ectoplasm.svg', infoItems: ['Ectoplasm'] },
    { value: 'cat:if:ectoplasm_fine',     name: 'Ectoplasm (Fine)',          icon: '/assets/icons/items/materials/ectoplasm.svg', isFine: true, infoItems: ['Ectoplasm (Fine)'] },
    { value: 'cat:if:fibrous_plant',      name: 'Fibrous Plant',             icon: '/assets/icons/keywords/fibrous_plant.svg', infoItems: ['Hemp', 'Flax'] },
    { value: 'cat:if:fibrous_plant_fine', name: 'Fibrous Plant (Fine)',      icon: '/assets/icons/keywords/fibrous_plant.svg', isFine: true, infoItems: ['Hemp (Fine)', 'Flax (Fine)'] },
    { value: 'cat:if:fishing_bait',       name: 'Fishing Bait',              icon: '/assets/icons/keywords/fishing.svg', infoItems: ['Bug bait', 'Frozen bait'] },
    { value: 'cat:if:fishing_bait_fine',  name: 'Fishing Bait (Fine)',       icon: '/assets/icons/keywords/fishing.svg', isFine: true, infoItems: ['Bug bait (Fine)', 'Frozen bait (Fine)'] },
    { value: 'cat:if:gold_nugget',        name: 'Gold Nugget',               icon: '/assets/icons/items/materials/gold_nugget.svg', infoItems: ['Gold nugget'] },
    { value: 'cat:if:gold_nugget_fine',   name: 'Gold Nugget (Fine)',        icon: '/assets/icons/items/materials/gold_nugget.svg', isFine: true, infoItems: ['Gold nugget (Fine)'] },
    { value: 'cat:if:random_gem',         name: 'Random Gem',                icon: '/assets/icons/keywords/gem.svg', infoItems: ['Rough opal', 'Rough star pearl', 'Rough topaz', 'Rough wrentmarine', 'Rough jade', 'Rough ruby', 'Rough sun stone', 'Rough ethernite'] },
    { value: 'cat:if:random_gem_fine',    name: 'Random Gem (Fine)',         icon: '/assets/icons/keywords/gem.svg', isFine: true, infoItems: ['Rough opal (Fine)', 'Rough star pearl (Fine)', 'Rough topaz (Fine)', 'Rough wrentmarine (Fine)', 'Rough jade (Fine)', 'Rough ruby (Fine)', 'Rough sun stone (Fine)', 'Rough ethernite (Fine)'] },
    { value: 'cat:if:random_piece_of_junk',      name: 'Random Piece of Junk',          icon: '/assets/icons/keywords/trash.svg', infoItems: ['Trash', 'Fishbone', 'Grass', 'Mud', 'Copper arrows', 'Milkweed', 'Moondaisy', 'Sea shell', 'Birch skis', 'Clay skydisc', 'Rough opal', 'Simple torch', 'Rusty chest', 'Sunken chest'] },
    { value: 'cat:if:random_piece_of_junk_fine', name: 'Random Piece of Junk (Fine)',   icon: '/assets/icons/keywords/trash.svg', isFine: true, infoItems: ['Trash (Fine)', 'Fishbone (Fine)', 'Grass (Fine)', 'Mud (Fine)', 'Copper arrows (Fine)', 'Milkweed (Fine)', 'Moondaisy (Fine)', 'Sea shell (Fine)'] },
    { value: 'cat:if:sea_shells',         name: 'Sea Shells',                icon: '/assets/icons/items/materials/sea_shell.svg', infoItems: ['Sea shell'] },
    { value: 'cat:if:skill_chest',        name: 'Random Skill Chest',        icon: '/assets/icons/keywords/skilling_chest.svg', infoItems: ['Agility chest', 'Carpentry chest', 'Cooking chest', 'Crafting chest', 'Fishing chest', 'Foraging chest', 'Hunting chest', 'Mining chest', 'Smithing chest', 'Tailoring chest', 'Trinketry chest', 'Woodcutting chest'] },
];

let _nextEntryId = 1;

function clampWeight(n) {
    const parsed = Number(n);
    if (isNaN(parsed)) return 100;
    return Math.max(0, Math.min(100, Math.floor(parsed)));
}

// Build the default activity priority list. Keep in sync with
// `DEFAULT_ACTIVITY_ORDER` + `LEGACY_ACTIVITY_KEY_MIGRATION` in
// ui/optimization_settings_migration.py so server and client agree on
// what "reset to default" means for activity sorting. Six entries
// matching the legacy default order — what the user sees on Reset to
// Default. Only the (steps, target_item, cat:normal_items) entry is
// visible in Quick by default; the rest are hidden until unhidden.
export function defaultActivityEntries() {
    return [
        makeRatioEntry('steps',    'target_item', { hiddenInQuick: false, targetItem: 'cat:normal_items' }),
        makeRatioEntry('total_xp', 'steps',       { hiddenInQuick: true }),  // total_xp_per_step
        makeRatioEntry('xp',       'steps',       { hiddenInQuick: true }),  // primary_xp_per_step
        makeRatioEntry('total_xp', 'action',      { hiddenInQuick: true }),  // total_xp_for_action
        makeRatioEntry('steps',    'action',      { hiddenInQuick: true }),  // expected_steps_per_action
        makeRatioEntry('xp',       'action',      { hiddenInQuick: true }),  // primary_xp_per_action
    ];
}

// Create a ratio entry. `extras` may override targetItem/weight/hiddenInQuick/editing.
// `editing` defaults to false (compact display). Callers that want the
// dropdowns visible from the get-go (e.g. add/duplicate handlers) pass
// `editing: true` so the user can pick X/Y axes immediately.
//
// Activities have no `quality` field (no quality outcomes) and no
// budget mode (no produce-N-mats goal). Both are absent from this
// constructor compared to the recipe equivalent.
export function makeRatioEntry(x, y, extras = {}) {
    return {
        id: _nextEntryId++,
        mode: 'ratio',
        x, y,
        targetItem: extras.targetItem || null,
        weight: typeof extras.weight === 'number' ? clampWeight(extras.weight) : 100,
        hiddenInQuick: !!extras.hiddenInQuick,
        editing: !!extras.editing,
    };
}

// Normalize an entry from the server into the in-memory shape. Assigns a
// local ID if one isn't present (IDs are not persisted across sessions).
//
// Activity-specific normalizations:
//   - Budget mode dicts → rejected (returns null) — activities have no budget
//   - quality field → stripped (activities don't carry it)
//   - Recipe-only X axes (materials, expected_steps, total_crafts) → rejected
//   - Recipe-only Y axes (craft, materials, quality, step) → rejected
//   - 'expected_steps' (recipe X) silently migrated to 'steps' (activity merged)

// Dedup entries by signature (x, y, targetItem). Activities don't have
// quality so the signature is simpler than recipe.
function dedupEntries(entries) {
    const seen = new Set();
    return entries.filter(e => {
        const sig = `${e.x}|${e.y}|${e.targetItem || ''}`;
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
    });
}

function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'number' ? raw.id : _nextEntryId++;
    if (id >= _nextEntryId) _nextEntryId = id + 1;
    // Activities have no budget mode — reject any budget-shaped entries
    // that accidentally land here (e.g. a recipe export pasted into the
    // activity import).
    if (raw.mode === 'budget') return null;
    if (raw.mode !== 'ratio') return null;
    // Silent axis migrations from recipe-only values into activity equivalents:
    //   - X='expected_steps' (recipe X) → 'steps' (activity merged)
    //   - X='displayed_steps' (legacy)  → 'steps'
    //   - Y='step'            (recipe Y) → 'steps' (activity uses single 'steps' for both roles)
    //   - Y='expected_steps' / 'displayed_steps' → 'steps'
    let x = raw.x;
    let y = raw.y;
    if (x === 'expected_steps' || x === 'displayed_steps') x = 'steps';
    if (y === 'step' || y === 'expected_steps' || y === 'displayed_steps') y = 'steps';
    // Silent migration: any entry with x=reward_roll OR y=reward_roll
    // is collapsed into `(steps, target_item)` with the cat:normal_items
    // category. `reward_roll` was removed from AXIS_OPTIONS because it
    // was redundant with `target_item + cat:normal_items` — both mean
    // "any drop". This handles all cases:
    //   - steps/reward_roll  → steps/target_item (cat:normal_items)
    //   - xp/reward_roll     → steps/target_item (cat:normal_items)
    //   - reward_roll/action → steps/target_item (cat:normal_items)
    //   - reward_roll/steps  → steps/target_item (cat:normal_items)
    //
    // We collapse `x=reward_roll` to the canonical form rather than
    // trying to preserve the "reward_rolls per X" intent because the
    // X-per-Y system is self-symmetric (A/B and B/A produce the same
    // ordering) so the user's optimization intent is preserved either
    // way, and a single canonical entry is less confusing than a
    // duplicated alternate form.
    let targetItem = raw.targetItem || null;
    if (x === 'reward_roll' || y === 'reward_roll') {
        x = 'steps';
        y = 'target_item';
        if (!targetItem) targetItem = 'cat:normal_items';
    }
    // Silent migration (2026-05-31): cat:sea_shells_fine and
    // cat:if:sea_shells_fine targets were removed when the
    // 'cat:sea_shells' synthetic aggregator landed — fine sea shells
    // are now folded automatically (×10 via Material.SEA_SHELL_FINE
    // .special_sell). Rewrite saved entries pointing at the removed
    // targets so the user keeps a usable equivalent.
    if (targetItem === 'cat:sea_shells_fine') targetItem = 'cat:sea_shells';
    if (targetItem === 'cat:if:sea_shells_fine') targetItem = 'cat:if:sea_shells';
    // Reject recipe-only axes that have no activity equivalent.
    const validX = AXIS_OPTIONS.some(o => o.value === x && !o.yOnly);
    const validY = AXIS_OPTIONS.some(o => o.value === y && !o.xOnly);
    if (!validX || !validY) return null;
    return {
        id,
        mode: 'ratio',
        x,
        y,
        targetItem,
        weight: clampWeight(raw.weight),
        hiddenInQuick: !!raw.hiddenInQuick,
        editing: !!raw.editing,
    };
}

function isValidAsY(xVal, yVal) {
    if (xVal === yVal) return false;
    const y = AXIS_OPTIONS.find(o => o.value === yVal);
    if (!y) return false;
    if (y.xOnly) return false;
    if (yVal === 'target_item' && xVal === 'target_item') return false;
    return true;
}

function axisIconHtml(value) {
    const opt = AXIS_OPTIONS.find(o => o.value === value);
    if (!opt || !opt.icon) return '';
    return `<img src="${opt.icon}" alt="" class="axis-icon" onerror="this.style.display='none'" />`;
}

function xLabel(val) { return AXIS_OPTIONS.find(o => o.value === val)?.label || val; }
function yLabel(val) { return AXIS_OPTIONS.find(o => o.value === val)?.label || val; }
function yOption(val) { return AXIS_OPTIONS.find(o => o.value === val); }

// Returns false when `val` represents a target category that is NOT
// available in the current activity's drop table. The category is
// "available" when at least one of:
//   - It's an IF category (always available; the user has gear for it
//     even if the activity doesn't drop it natively)
//   - It's the synthetic Coins or Coins (no chests) target
//   - The activity's drop table contains at least one item matching
//     the category (chest container, collectible, fine item, gem, etc.)
//
// `activityDropTable` is the GET /api/activities/<id>/drop-table response
// shape used by optimize-button.js — array of objects with at least
// {item_ref, item_name, item_keywords, has_fine_material}.
function isTargetAvailable(val, activityDropTable) {
    if (!val) return true;
    // Synthetic targets are always available (the optimizer handles
    // activities with or without their components). cat:sea_shells is
    // synthetic too — the aggregator returns inf when the activity has
    // no shell sources, but if the user has flatpack shark or other
    // SEA_SHELLS IF gear it can still produce a valid score.
    if (val === 'cat:coins' || val === 'cat:coins_no_chests' || val === 'cat:normal_items' || val === 'cat:sea_shells') return true;
    // IF categories are gear-driven, not drop-table-driven.
    if (val.startsWith('cat:if:')) return true;
    if (!Array.isArray(activityDropTable)) return true; // assume valid
    const drops = activityDropTable.filter(d => d && d.item_name !== 'Nothing' && d.source !== 'equipment');
    if (val === 'cat:chests') {
        return drops.some(d => d.item_ref && d.item_ref.startsWith('Container.'));
    }
    if (val === 'cat:collectibles') {
        return drops.some(d => d.item_ref && d.item_ref.startsWith('Collectible.'));
    }
    if (val === 'cat:fine') {
        return drops.some(d => d.has_fine_material === true);
    }
    if (val === 'cat:gems' || val === 'cat:gems_fine') {
        const gemRefs = new Set([
            'Material.ROUGH_OPAL', 'Material.ROUGH_STAR_PEARL', 'Material.ROUGH_TOPAZ',
            'Material.ROUGH_WRENTMARINE', 'Material.ROUGH_JADE', 'Material.ROUGH_RUBY',
            'Material.ROUGH_SUN_STONE', 'Material.ROUGH_ETHERNITE',
            'Material.OPAL', 'Material.STAR_PEARL', 'Material.TOPAZ',
            'Material.WRENTMARINE', 'Material.JADE', 'Material.RUBY',
            'Material.SUN_STONE', 'Material.ETHERNITE',
        ]);
        const requiresFine = val === 'cat:gems_fine';
        return drops.some(d =>
            ((d.item_ref && gemRefs.has(d.item_ref)) ||
                (d.item_keywords && d.item_keywords.some(kw =>
                    kw === 'gem' || kw === 'rough_gem' || kw === 'cut_gem'
                ))) &&
            (!requiresFine || d.has_fine_material === true)
        );
    }
    return true;
}

// Build a base category with `infoItems` dynamically populated from
// the activity's drop table. Mirrors the classification used in
// optimize-button.js _renderActivityTargetDropdown so the (ⓘ) tooltip
// shows the actual items the activity drops in each category. Returns
// the input untouched when no drop table is available, when the
// category is synthetic (cat:coins / cat:coins_no_chests), or when
// classification yields zero items.
//
// infoItems entries here are objects `{name, iconPath}` where iconPath
// is resolved from the drop's item_ref via resolveItemIcon — that's
// the only way to land equipment drops at /equipment/ and materials
// at /materials/ etc. The previous string-only form forced
// _guessItemIconPath to default everything to materials/, breaking
// equipment drops like Pirate hat (Item.PIRATE_HAT lives at
// /assets/icons/items/equipment/pirate_hat.svg, not /materials/).
// The popover renderer accepts both legacy strings and the new
// object form, so static IF infoItems still work unchanged.
function _withDynamicInfoItems(cat, activityDropTable) {
    if (!cat) return cat;
    if (!Array.isArray(activityDropTable) || activityDropTable.length === 0) return cat;
    // Same gem detection rules used by isTargetAvailable above.
    const gemRefs = new Set([
        'Material.ROUGH_OPAL', 'Material.ROUGH_STAR_PEARL', 'Material.ROUGH_TOPAZ',
        'Material.ROUGH_WRENTMARINE', 'Material.ROUGH_JADE', 'Material.ROUGH_RUBY',
        'Material.ROUGH_SUN_STONE', 'Material.ROUGH_ETHERNITE',
        'Material.OPAL', 'Material.STAR_PEARL', 'Material.TOPAZ',
        'Material.WRENTMARINE', 'Material.JADE', 'Material.RUBY',
        'Material.SUN_STONE', 'Material.ETHERNITE',
    ]);
    const isGem = d =>
        (d.item_ref && gemRefs.has(d.item_ref)) ||
        (d.item_keywords && d.item_keywords.some(kw =>
            kw === 'gem' || kw === 'rough_gem' || kw === 'cut_gem' ||
            kw === 'Gem' || kw === 'Rough gem' || kw === 'Cut gem'
        ));
    const regularDrops = activityDropTable.filter(d =>
        d && d.item_name !== 'Nothing' && d.source !== 'equipment'
    );
    const chestDrops = regularDrops.filter(d => d.item_ref && d.item_ref.startsWith('Container.'));
    const collectibleDrops = regularDrops.filter(d => d.item_ref && d.item_ref.startsWith('Collectible.'));
    // Exclude sea shells from cat:normal_items and cat:fine info lists.
    // The new 'cat:sea_shells' synthetic aggregator (mirrors 'cat:coins')
    // owns sea shells across all sources — direct drops, fine variants
    // (×10), and shell-bearing chests. Listing 'Sea shell' under
    // normal_items would imply it's still part of that bucket for
    // optimization, which is no longer true.
    const seaShellDrops = regularDrops.filter(d => d.item_ref === 'Material.SEA_SHELL');
    const fineDrops = regularDrops.filter(d => d.has_fine_material && d.item_ref !== 'Material.SEA_SHELL');
    const gemDrops = regularDrops.filter(isGem);
    const gemFineDrops = gemDrops.filter(d => d.has_fine_material);

    // Build a {name, iconPath} entry from a drop. Optionally appends
    // " (Fine)" to the name (used for fine and gems_fine categories).
    const entryFromDrop = (drop, fine = false) => ({
        name: fine ? `${drop.item_name} (Fine)` : drop.item_name,
        iconPath: resolveItemIcon({
            itemRef: drop.item_ref,
            itemName: drop.item_name,
            fallback: '',
        }),
    });
    const sortByName = arr => arr.slice().sort((a, b) => a.name.localeCompare(b.name));

    let infoItems = null;
    switch (cat.value) {
        case 'cat:normal_items':
            infoItems = sortByName(
                regularDrops
                    .filter(d => !chestDrops.includes(d) && !collectibleDrops.includes(d) && !seaShellDrops.includes(d))
                    .map(d => entryFromDrop(d))
            );
            break;
        case 'cat:chests':
            infoItems = sortByName(chestDrops.map(d => entryFromDrop(d)));
            break;
        case 'cat:collectibles':
            infoItems = sortByName(collectibleDrops.map(d => entryFromDrop(d)));
            break;
        case 'cat:fine':
            infoItems = sortByName(fineDrops.map(d => entryFromDrop(d, /*fine=*/true)));
            break;
        case 'cat:gems':
            infoItems = sortByName(gemDrops.map(d => entryFromDrop(d)));
            break;
        case 'cat:gems_fine':
            infoItems = sortByName(gemFineDrops.map(d => entryFromDrop(d, /*fine=*/true)));
            break;
        default:
            // cat:coins, cat:coins_no_chests, cat:sea_shells — synthetic
            // aggregates rolled up by the optimizer, no single list of
            // constituent items makes sense (cat:sea_shells aggregates
            // direct shells + chests + fine — see util/shell_value.py).
            return cat;
    }
    if (!infoItems || infoItems.length === 0) return cat;
    return { ...cat, infoItems };
}

// Render a single info-popover row from an infoItems entry. Accepts
// both legacy string form ('Sea shell', 'Sea shell (Fine)') and the
// new object form ({name, iconPath}). The object form's iconPath is
// derived upstream from item_ref via resolveItemIcon — the only way
// equipment drops (e.g. Pirate hat at /equipment/) and materials
// (e.g. Sea shell at /materials/) both resolve correctly. The legacy
// string form falls back to _guessItemIconPath which handles the
// static IF_CATEGORIES whose item names map into known
// material/container/collectible paths.
function _renderInfoItemRow(entry, categoryValue) {
    const name = (typeof entry === 'string') ? entry : entry.name;
    const explicitIconPath = (entry && typeof entry === 'object' && entry.iconPath) ? entry.iconPath : null;
    const isFine = name.includes('(Fine)');
    const baseName = name.replace(/ \(Fine\)/, '').trim();
    const iconName = baseName.toLowerCase().replace(/ /g, '_');
    const iconPath = explicitIconPath || _guessItemIconPath(iconName, categoryValue);
    const fineStyle = isFine ? ' filter:drop-shadow(1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(-1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(0 1px 0 var(--fine-color,#4fc3f7)) drop-shadow(0 -1px 0 var(--fine-color,#4fc3f7));' : '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;"><img src="${iconPath}" style="width:32px;height:32px;${fineStyle}" onerror="this.style.display='none'" /><span>${name}</span></div>`;
}

function displayTargetItem(val, activityDropTable) {
    if (!val) return '<span>Select…</span>';
    const baseStatic = BASE_TARGET_CATEGORIES.find(c => c.value === val);
    const base = baseStatic ? _withDynamicInfoItems(baseStatic, activityDropTable) : null;
    const ifCat = IF_CATEGORIES.find(c => c.value === val);
    const cat = base || ifCat;
    if (!cat) {
        if (val.startsWith('if:')) return `<span>${val.slice(3)}</span>`;
        return `<span>${val}</span>`;
    }
    const fineClass = cat.isFine ? 'fine-item' : '';
    const unavailable = !isTargetAvailable(val, activityDropTable);
    const unavailableStyle = unavailable ? ' style="opacity:0.5;font-style:italic;"' : '';
    const naLabel = unavailable ? ' <span style="color:#f1c40f;font-size:0.8em;font-weight:bold;">N/A</span>' : '';
    const iconHtml = cat.icon
        ? `<img src="${cat.icon}" alt="${cat.name}" class="target-icon ${fineClass}" onerror="this.style.display='none'" />`
        : '';
    let infoHtml = '';
    if (cat.infoItems && cat.infoItems.length > 0 && !unavailable) {
        const itemListHtml = cat.infoItems.map(e => _renderInfoItemRow(e, cat.value)).join('');
        const escapedHtml = itemListHtml.replace(/"/g, '&quot;');
        infoHtml = ` <span class="travel-info-icon" data-info-html="${escapedHtml}" role="button" tabindex="0" aria-label="Items in category" style="font-size:0.9em;font-style:normal;">ⓘ</span>`;
    }
    return `${iconHtml}<span${unavailableStyle}>${cat.name}${naLabel}${infoHtml}</span>`;
}

// ----------------------------------------------------------------------------
// FLOATING DROPDOWN (fixed-position, appended to document.body)
// ----------------------------------------------------------------------------

let _openDropdown = null; // { $el, $triggerArrow, onClose, for, openAbove }
// Guard so window resize/scroll reflow doesn't fight the open animation
// by overwriting `top` while jQuery.animate is driving it.
let _animatingOpen = false;

// ----------------------------------------------------------------------------
// AUTO-SCROLL HELPERS (shared across all mounts)
// ----------------------------------------------------------------------------
// During touch drag, when the finger nears the top or bottom of the active
// scroll container, kick off a velocity-based scroll loop so the list can
// continue being reordered without the user having to manually scroll.
//
// `findScrollParent` walks up from the given element looking for the nearest
// ancestor with overflow-y auto/scroll AND a scrollable scrollHeight. Falls
// back to document.scrollingElement so it always returns something scrollable.

// findScrollParent, updateAutoScroll, stopAutoScroll come from
// xy-recipe-priority-list.js (imported at top). Both modules share the
// same auto-scroll RAF state — only one drag is active at a time
// across the whole app, so a single shared RAF is correct.

export function closeGlobalDropdown(immediate = false) {
    if (!_openDropdown) return;
    const { $el, $triggerArrow, onClose, openAbove } = _openDropdown;
    _openDropdown = null;
    if ($triggerArrow) $triggerArrow.removeClass('expanded');
    if (immediate) {
        $el.remove();
        if (onClose) onClose();
    } else if (openAbove) {
        // Collapse downward toward trigger (reverse of open animation).
        // At this point $el is visible at finalTop with its natural
        // rendered height — safe to read offsetHeight.
        const curTop = parseInt($el.css('top'), 10);
        const curHeight = $el[0].offsetHeight;
        $el.css({ overflow: 'hidden' });
        $el.animate({
            top: (curTop + curHeight) + 'px',
            height: '0px',
        }, 180, () => { $el.remove(); if (onClose) onClose(); });
    } else {
        $el.slideUp(180, () => {
            $el.remove();
            if (onClose) onClose();
        });
    }
}

// Position the floating dropdown under (or above) the trigger. Returns
// the measurement/placement info the caller needs to drive the open
// animation: { openAbove, finalTop, finalHeight, triggerRect }. Natural
// height is measured via a visibility:hidden + display:block flip so
// offsetHeight is readable (a display:none element always reports 0).
// finalHeight is returned so openDropdownUnder doesn't have to re-
// measure a display:none element and end up animating to 0 (which was
// the root cause of the flip-up "hiding and showing" glitch).
function positionDropdownUnder($trigger, $dd) {
    const rect = $trigger[0].getBoundingClientRect();
    let naturalHeight = $dd[0].offsetHeight;
    if (naturalHeight === 0) {
        const prevDisplay = $dd[0].style.display;
        const prevVisibility = $dd[0].style.visibility;
        $dd.css({ visibility: 'hidden', display: 'block' });
        naturalHeight = $dd[0].offsetHeight;
        $dd.css({ visibility: prevVisibility || '', display: prevDisplay || '' });
    }
    const GAP = 4;
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
    const finalHeight = openAbove
        ? Math.min(naturalHeight, spaceAbove)
        : naturalHeight;
    const finalTop = openAbove
        ? (rect.top - finalHeight - GAP)
        : (rect.bottom + GAP);
    $dd.css({
        position: 'fixed',
        top: finalTop + 'px',
        left: rect.left + 'px',
        width: Math.max(rect.width, 200) + 'px',
        zIndex: 10000,
        margin: 0,
    });
    return { openAbove, finalTop, finalHeight, triggerRect: rect };
}

export function openDropdownUnder($trigger, itemsHtml, onSelect, forKey) {
    closeGlobalDropdown(true);
    const $dd = $('<div class="target-dropdown xy-floating" style="display:none;"></div>');
    $dd.html(itemsHtml);
    $('body').append($dd);
    const placement = positionDropdownUnder($trigger, $dd);
    const { openAbove, finalTop, finalHeight, triggerRect } = placement;
    const $arrow = $trigger.find('.target-dropdown-toggle .expand-arrow, .expand-arrow').first();
    $arrow.addClass('expanded');

    if (openAbove) {
        // Grow upward: start pinned at the trigger's top edge with
        // height:0, animate top AND height together so the dropdown
        // appears to emerge upward from the trigger. Same pattern as
        // location-dropdown.js. Using the finalHeight measured during
        // positionDropdownUnder (NOT re-reading offsetHeight here —
        // $dd was display:none during measurement so it'd report 0
        // and the animation would silently be a no-op, then snap to
        // full height at the end).
        const GAP = 4;
        $dd.css({
            display: 'block',
            top: (triggerRect.top - GAP) + 'px',
            height: '0px',
            overflow: 'hidden',
        });
        _animatingOpen = true;
        $dd.animate({
            top: finalTop + 'px',
            height: finalHeight + 'px',
        }, 200, function () {
            $(this).css({ height: '', overflow: '' });
            _animatingOpen = false;
        });
    } else {
        $dd.slideDown(200);
    }

    _openDropdown = { $el: $dd, $triggerArrow: $arrow, for: forKey || null, openAbove };

    wireInfoIcons($dd);

    $dd.on('click', '.target-item', (e) => {
        e.preventDefault(); e.stopPropagation();
        const $ti = $(e.currentTarget);
        if ($ti.hasClass('disabled')) return;
        onSelect($ti.data('value'));
        closeGlobalDropdown();
    });

    // Reposition on resize/scroll — but skip while the open animation
    // is still running. Otherwise the animation target (finalTop) and
    // the re-positioner fight over the same `top` property and the
    // dropdown flickers.
    const onReflow = () => {
        if (!_openDropdown || _animatingOpen) return;
        positionDropdownUnder($trigger, $dd);
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    $dd.on('remove', () => {
        window.removeEventListener('resize', onReflow);
        window.removeEventListener('scroll', onReflow, true);
    });
}

// ----------------------------------------------------------------------------
// DROPDOWN CONTENT BUILDERS
// ----------------------------------------------------------------------------

function renderXOptionsHtml() {
    return X_OPTIONS.map(o =>
        `<div class="target-item" data-value="${o.value}">${axisIconHtml(o.value)}<span>${o.label}</span></div>`
    ).join('');
}

function renderYOptionsHtml(currentX) {
    return Y_OPTIONS
        .filter(o => isValidAsY(currentX, o.value))
        .map(o => `<div class="target-item" data-value="${o.value}">${axisIconHtml(o.value)}<span>${o.label}</span></div>`)
        .join('');
}

// Copied from optimize-button.js _guessItemIconPath — determines the
// correct icon path for a given item name within a category.
function _guessItemIconPath(iconName, categoryValue) {
    // Known items that live outside materials/ (equipment, containers, etc.)
    const OVERRIDES = {
        birch_skis: '/assets/icons/items/equipment/birch_skis.svg',
        clay_skydisc: '/assets/icons/items/equipment/clay_skydisc.svg',
        simple_torch: '/assets/icons/items/equipment/simple_torch.svg',
        rusty_chest: '/assets/icons/items/containers/rusty_chest.svg',
        sunken_chest: '/assets/icons/items/containers/sunken_chest.svg',
        // Currencies live at the top-level /assets/icons/items/ dir.
        "adventurers'_guild_token": "/assets/icons/items/adventurers'_guild_token.svg",
    };
    if (OVERRIDES[iconName]) return OVERRIDES[iconName];
    if (categoryValue && (categoryValue.includes('chest') || categoryValue.includes('skill_chest') || categoryValue.includes('bird_nest'))) {
        return `/assets/icons/items/containers/${iconName}.svg`;
    }
    if (categoryValue && categoryValue.includes('collectible')) {
        return `/assets/icons/items/collectibles/${iconName}.svg`;
    }
    if (categoryValue && categoryValue.includes('fishing_bait')) {
        return `/assets/icons/items/consumables/${iconName}.svg`;
    }
    return `/assets/icons/items/materials/${iconName}.svg`;
}

// renderQualityOptionsHtml removed — activities have no quality axis.

function renderTargetItemOptionsHtml(includeItemFinding, activityDropTable) {
    const rowHtml = (cat, { isIf = false } = {}) => {
        const fineClass = cat.isFine ? 'fine-item' : '';
        const ifClass = isIf ? 'equipment-drop-item' : '';
        const prefix = isIf ? '✦ ' : '';
        const unavailable = !isTargetAvailable(cat.value, activityDropTable);
        const unavailableStyle = unavailable ? ' style="opacity:0.5;font-style:italic;"' : '';
        const naLabel = unavailable ? ' <span style="color:#f1c40f;font-size:0.8em;font-weight:bold;">N/A</span>' : '';
        let infoIconHtml = '';
        if (cat.infoItems && cat.infoItems.length > 0 && !unavailable) {
            const itemListHtml = cat.infoItems.map(e => _renderInfoItemRow(e, cat.value)).join('');
            const escapedHtml = itemListHtml.replace(/"/g, '&quot;');
            infoIconHtml = ` <span class="travel-info-icon" data-info-html="${escapedHtml}" role="button" tabindex="0" aria-label="Items in category" style="font-size:0.9em;font-style:normal;">ⓘ</span>`;
        }
        return `
            <div class="target-item ${fineClass} ${ifClass}" data-value="${cat.value}"${unavailableStyle}>
                <img src="${cat.icon}" alt="${cat.name}" class="target-icon" onerror="this.style.display='none'" />
                <span>${prefix}${cat.name}${naLabel}${infoIconHtml}</span>
            </div>
        `;
    };
    let html = '';
    for (const cat of BASE_TARGET_CATEGORIES) {
        html += rowHtml(_withDynamicInfoItems(cat, activityDropTable));
    }
    if (includeItemFinding) {
        for (const cat of IF_CATEGORIES) html += rowHtml(cat, { isIf: true });
    }
    return html;
}

// ----------------------------------------------------------------------------
// ENTRY RENDERING
// ----------------------------------------------------------------------------

// Inline SVG for the edit-mode pencil icon (used on per-entry toggle and
// global toggle). 14x14 stroke-only icon; `currentColor` lets CSS flip
// between muted (inactive) and yellow (active).
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;

function buildHideIcon(hidden) {
    return hidden
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
           </svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
           </svg>`;
}

function renderWeightRow(entry) {
    const w = clampWeight(entry.weight);
    return `
        <div class="sort-weight-row" data-entry-id="${entry.id}">
            <input type="range" class="weight-slider" min="0" max="100" value="${w}" data-entry-id="${entry.id}" />
            <input type="number" class="weight-input" min="0" max="100" value="${w}" data-entry-id="${entry.id}" />
            <span class="weight-pct">%</span>
        </div>
    `;
}

function renderEntryReveal(entry, activityDropTable) {
    // Activities have no budget mode and no quality axis — only target_item
    // gets a reveal panel.
    const y = yOption(entry.y);
    if (y && y.needs === 'target_item') {
        return `
            <div class="mockup-reveal">
                <div class="xy-wrap target-item-btn-wrap" data-entry-id="${entry.id}" data-xy-axis="target_item">
                    <span class="mockup-dropdown-label">Target item</span>
                    <div class="target-dropdown-button xy-dropdown-btn">
                        <div class="target-dropdown-value">
                            ${displayTargetItem(entry.targetItem, activityDropTable)}
                        </div>
                        <button class="target-dropdown-toggle" tabindex="-1">
                            <span class="expand-arrow">▼</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    return '';
}

// ----------------------------------------------------------------------------
// PUBLIC COMPONENT
// ----------------------------------------------------------------------------

/**
 * Render and manage an X-per-Y priority list.
 *
 * @param {jQuery} $container  - element to render into (contents replaced)
 * @param {Object} options
 * @param {Array}  options.entries      - initial entry list
 * @param {string} options.mode         - 'detailed' (full) | 'quick' (filter-only)
 * @param {Function} options.onChange   - (entries) => void, fires on any edit
 * @param {boolean} options.includeItemFinding - toggles IF categories in dropdown
 * @returns {Object} controller { getEntries, setEntries, destroy, refresh, setIncludeItemFinding }
 */
export function mountXyActivityPriorityList($container, options = {}) {
    injectStylesOnce();
    const state = {
        entries: dedupEntries((options.entries || []).map(normalizeEntry).filter(Boolean)),
        mode: options.mode === 'quick' ? 'quick' : 'detailed',
        includeItemFinding: !!options.includeItemFinding,
        // Activity's drop_table (same shape as optimize-button.js's
        // dropTableData — array of {item_ref, item_name, item_keywords,
        // has_fine_material, source}). Gates visibility of target items:
        // when the selected target references a category not present in
        // this table, the target renders greyed-out with "N/A" in yellow.
        // null/missing → "assume valid" (settings modal has no activity
        // context yet).
        activityDropTable: Array.isArray(options.activityDropTable) ? options.activityDropTable : null,
        // Which grouped rows are expanded in Quick mode. Keyed by the
        // group signature (e.g. 'target_item:cat:chests'). Single-entry
        // groups have no expand arrow so this is only useful for
        // multi-member groups. Can be pre-seeded via
        // options.initialExpandedGroups so a re-mount of the panel
        // preserves which groups the user had open.
        expandedGroups: options.initialExpandedGroups instanceof Set
            ? new Set(options.initialExpandedGroups)
            : new Set(),
    };

    // Optional external slot for the global "Edit all / Collapse all"
    // button. When provided (as a jQuery element or CSS selector) the
    // button is rendered INTO this slot instead of inline above the
    // list. Used by the Quick panel so the button can sit next to the
    // "Quick Optimization Settings" heading. Clicks on the slot button
    // are wired via a second delegated handler because the global $container
    // click delegation doesn't see events outside $container.
    const $globalEditSlot = options.globalEditSlot
        ? (options.globalEditSlot.jquery ? options.globalEditSlot : $(options.globalEditSlot))
        : null;
    const hasExternalEditSlot = !!($globalEditSlot && $globalEditSlot.length);

    const onChange = typeof options.onChange === 'function' ? options.onChange : () => { };

    function priorityNumberFor(entry) {
        // 1-based index in the FULL list (matches current Quick UX — user
        // wanted to keep the `(#N)` priority display).
        const idx = state.entries.findIndex(e => e.id === entry.id);
        return idx >= 0 ? idx + 1 : '?';
    }

    function renderEntry(entry, opts = {}) {
        const inQuick = state.mode === 'quick';
        // Indented flag: renders a slightly smaller row without metric
        // chip (used when this entry is expanded INSIDE a group in Quick).
        const expandedFromGroup = !!opts.expandedFromGroup;
        const total = state.entries.length;
        const isSingle = total <= 1;
        const hiddenClass = entry.hiddenInQuick ? 'entry-hidden-in-quick' : '';
        const expandedCls = expandedFromGroup ? 'xy-entry-expanded' : '';
        const editingCls = entry.editing ? 'xy-entry-editing' : '';
        const rootClass = inQuick
            ? `xy-priority-entry xy-priority-entry-quick ${hiddenClass} ${expandedCls} ${editingCls}`
            : `sort-item xy-priority-entry ${hiddenClass} ${editingCls}`;
        const dragDraggable = inQuick ? '' : 'draggable="true"';
        // Detailed mode gets a vertical reorder strip: up arrow + hamburger
        // (still used as the drag handle on desktop) + down arrow. The
        // hamburger alone doesn't work reliably on mobile Safari (HTML5
        // drag-and-drop isn't triggered by touch), so the arrows are the
        // primary reorder mechanism on touch devices. Up/down are grayed
        // out at the boundaries — we compute the visible position below
        // so the disabled state is visible relative to this mode's list.
        // (Quick mode shows no drag controls; grouping + eye-icon handle
        // priority management there.)
        const visibleIndex = opts.visibleIndex;
        const visibleTotal = opts.visibleTotal;
        const atTop = typeof visibleIndex === 'number' && visibleIndex <= 0;
        const atBottom = typeof visibleIndex === 'number' && visibleTotal != null && visibleIndex >= visibleTotal - 1;
        const reorderStrip = inQuick ? '' : `
            <div class="xy-reorder-strip">
                <button class="xy-move-up" ${atTop ? 'disabled' : ''} title="Move up" data-entry-id="${entry.id}" tabindex="-1">▲</button>
                <span class="drag-handle" title="Drag to reorder">☰</span>
                <button class="xy-move-down" ${atBottom ? 'disabled' : ''} title="Move down" data-entry-id="${entry.id}" tabindex="-1">▼</button>
            </div>
        `;

        const priorityNum = priorityNumberFor(entry);
        const priorityBadge = inQuick
            ? `<span class="xy-priority-badge" title="Priority position">#${priorityNum}</span>`
            : '';

        // Body parts — split so we can interleave the weight row between
        // the compact label and the editing dropdowns. DOM order is
        // always [compact-label, weight, xy-row (editing), reveal].
        // With display:none applied based on entry.editing, the visible
        // sequence becomes:
        //   - compact:  label → weight → reveal
        //   - editing:  weight → X/Y dropdowns → reveal
        //   - budget:   budget-label → weight → reveal (inputs)
        // No flex `order` tricks needed — just the right DOM order plus
        // toggled visibility.
        const budgetRow = entry.mode === 'budget' ? `
                <div class="xy-row xy-row-budget">
                    <span class="xy-budget-label">Steps for Budget</span>
                    <span class="xy-budget-hint" title="Minimizes expected steps needed to turn Input Materials into Target Output">(minimize steps within this budget)</span>
                </div>
              ` : '';

        const compactRow = entry.mode === 'budget' ? '' : `
                <div class="xy-row-compact" style="display: ${entry.editing ? 'none' : 'flex'};" data-entry-id="${entry.id}">
                    <span class="xy-compact-label">${xLabel(entry.x)}/${yLabel(entry.y)}</span>
                </div>
              `;

        const xyRow = entry.mode === 'budget' ? '' : `
                <div class="xy-row" style="display: ${entry.editing ? 'flex' : 'none'};">
                    <div class="xy-wrap" data-entry-id="${entry.id}" data-xy-axis="x">
                        <span class="mockup-dropdown-label xy-label-x">What to Optimize</span>
                        <div class="target-dropdown-button xy-dropdown-btn">
                            <div class="target-dropdown-value">${axisIconHtml(entry.x)}<span>${xLabel(entry.x)}</span></div>
                            <button class="target-dropdown-toggle" tabindex="-1"><span class="expand-arrow">▼</span></button>
                        </div>
                    </div>
                    <span class="xy-per">per</span>
                    <div class="xy-wrap" data-entry-id="${entry.id}" data-xy-axis="y">
                        <span class="mockup-dropdown-label xy-label-y">Unit</span>
                        <div class="target-dropdown-button xy-dropdown-btn">
                            <div class="target-dropdown-value">${axisIconHtml(entry.y)}<span>${yLabel(entry.y)}</span></div>
                            <button class="target-dropdown-toggle" tabindex="-1"><span class="expand-arrow">▼</span></button>
                        </div>
                    </div>
                </div>
              `;

        const revealHtml = renderEntryReveal(entry, state.activityDropTable);

        // Action buttons — rendered in BOTH Quick and Detailed modes now
        // (user feedback: need duplicate / remove / hide on Quick too).
        // Quick mode drops the weight slider + drag handle but keeps actions.
        // Budget entries don't get the edit pencil (no X/Y to toggle).
        const editBtnHtml = entry.mode === 'budget' ? '' : `
                <button class="sort-edit-btn ${entry.editing ? 'active' : ''}"
                        title="${entry.editing ? 'Collapse to compact view' : 'Edit X/Y axes'}"
                        data-entry-id="${entry.id}">
                    ${PENCIL_SVG}
                </button>`;
        const actionsHtml = `
            <div class="sort-item-actions ${entry.mode === 'budget' ? 'no-duplicate' : ''}">
                ${entry.mode === 'budget' ? '' : `
                <button class="sort-duplicate-btn" title="Duplicate this priority" data-entry-id="${entry.id}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                        <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                    </svg>
                </button>`}
                <button class="sort-remove-btn" ${isSingle ? 'disabled' : ''} title="Remove this priority" data-entry-id="${entry.id}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <button class="sort-hide-btn" title="${entry.hiddenInQuick ? 'Show in Quick settings' : 'Hide from Quick settings'}" data-entry-id="${entry.id}">
                    ${buildHideIcon(entry.hiddenInQuick)}
                </button>
                ${editBtnHtml}
            </div>
        `;

        return `
            <div class="${rootClass}" data-entry-id="${entry.id}" ${dragDraggable}>
                ${reorderStrip}
                <div class="sort-item-content">
                    ${budgetRow}
                    ${compactRow}
                    ${!inQuick ? renderWeightRow(entry) : ''}
                    ${xyRow}
                    ${revealHtml}
                </div>
                ${priorityBadge}
                ${actionsHtml}
            </div>
        `;
    }

    // --- Quick mode grouping --------------------------------------------
    //
    // When multiple ratio entries share the same quality target, we
    // collapse them into a single row in Quick mode. One shared target
    // dropdown controls all of them — matches the pre-redesign Quick
    // panel behavior the user asked to preserve. Target_item entries
    // are intentionally NOT grouped (per user feedback in issue #5).
    //
    // The group signature looks like:
    //   'budget'                  — budget mode (always a singleton)
    //   'quality:Perfect'         — all entries with y='quality' + q=Perfect
    //   'solo:<entryId>'          — everything else (no grouping)

    function groupSignature(entry) {
        // Activities have no quality grouping and no budget mode.
        // Every entry renders as a solo row in Quick mode (one row per
        // priority, one target_item picker per row).
        return `solo:${entry.id}`;
    }

    function buildQuickGroups(entries) {
        const order = [];
        const groups = new Map();
        for (const entry of entries) {
            const sig = groupSignature(entry);
            if (!groups.has(sig)) {
                groups.set(sig, { signature: sig, entries: [] });
                order.push(sig);
            }
            groups.get(sig).entries.push(entry);
        }
        return order.map(sig => groups.get(sig));
    }

    function shortMetricLabel(entry) {
        // Compact "X" label for the combined group row. Strips the y-axis
        // label since the group row already shows the shared denominator.
        return xLabel(entry.x);
    }

    function renderGroupCollapsedRow(group) {
        const first = group.entries[0];
        // Activities have no budget mode and no quality grouping —
        // groupSignature always returns 'solo:<id>' so every group has
        // exactly one member. Simply render the entry directly.
        return renderEntry(first);
    }

    function renderAddMenuHtml() {
        // Activities have no budget mode — only the ratio option is offered.
        return `
            <div class="target-item" data-value="ratio" title="Add a new X-per-Y optimization priority">
                <span>Optimization Priority</span>
            </div>
        `;
    }

    function render() {
        // Scroll preservation — record the current scroll positions so we
        // can restore them after the HTML replacement. Without this, any
        // user interaction that triggers render() (duplicate, delete, hide,
        // group expand) would bounce the scroll position to the top, which
        // is jarring especially when the user is deep in a long Detailed
        // list or when the outer column has scrolled past the panel.
        const $existingList = $container.find('.sort-list').first();
        const prevListScroll = $existingList.length ? $existingList[0].scrollTop : 0;
        // Find nearest scrollable ancestor (handles both the outer page
        // and Column 3's overflow-y:auto content scroller).
        const $scrollAncestor = findScrollableAncestor($container);
        const prevAncestorScroll = $scrollAncestor ? $scrollAncestor[0].scrollTop : null;
        const prevWindowScroll = window.scrollY;

        const inQuick = state.mode === 'quick';
        let entriesToShow = state.entries;
        if (inQuick) {
            entriesToShow = entriesToShow.filter(e => !e.hiddenInQuick);
            // When the selected recipe is non-quality, quality-targeted
            // entries don't apply — hide them from Quick entirely. They
            // remain editable in Detailed for consistency across recipes.
            if (false) {
                entriesToShow = entriesToShow.filter(e => !(e.mode === 'ratio' && e.y === 'quality'));
            }
        }

        if (inQuick && entriesToShow.length === 0) {
            $container.html(buildQuickEmptyStateHtml());
            return;
        }

        let innerHtml;
        if (inQuick) {
            // Group same-quality entries into combined rows. Target_item
            // entries are no longer grouped per user feedback.
            const groups = buildQuickGroups(entriesToShow);
            const rows = [];
            for (const group of groups) {
                const expanded = state.expandedGroups.has(group.signature);
                if (group.entries.length > 1) {
                    // Multi-member group: show the collapsed grouped row, then
                    // wrap the member rows in a slide-able container so the
                    // expand arrow can animate them in/out without a re-render.
                    rows.push(renderGroupCollapsedRow(group));
                    const memberHtml = group.entries
                        .map(e => renderEntry(e, { expandedFromGroup: true }))
                        .join('');
                    const hiddenStyle = expanded ? '' : ' style="display:none;"';
                    rows.push(`<div class="xy-group-members-wrap" data-group-sig="${group.signature}"${hiddenStyle}>${memberHtml}</div>`);
                } else {
                    // Singleton — render as a normal entry (no group UI).
                    rows.push(renderEntry(group.entries[0]));
                }
            }
            innerHtml = rows.join('');
        } else {
            innerHtml = entriesToShow
                .map((e, i) => renderEntry(e, { visibleIndex: i, visibleTotal: entriesToShow.length }))
                .join('');
        }

        const addBtn = inQuick ? '' : `
            <div class="sort-add-wrapper">
                <button class="sort-add-btn" title="Add a new optimization priority or budget goal">
                    <span>+ Add Optimization Priority</span>
                    <span class="expand-arrow">▼</span>
                </button>
            </div>
        `;

        // Global edit-mode toggle — derived from entries. "All on" means
        // every ratio entry has editing=true. Budget entries don't count.
        // Yellow = at least one ratio entry is currently editing (so the
        // icon signals "some edits are in flight").
        const ratioEntries = state.entries.filter(e => e.mode === 'ratio');
        const anyEditing = ratioEntries.some(e => e.editing);
        const allEditing = ratioEntries.length > 0 && ratioEntries.every(e => e.editing);
        const globalEditBarHtml = ratioEntries.length === 0 ? '' : `
            <div class="xy-global-edit-bar">
                <button class="xy-global-edit-btn ${anyEditing ? 'active' : ''}"
                        title="${allEditing ? 'Collapse all to compact view' : 'Expand all for axis editing'}">
                    ${PENCIL_SVG}
                    <span>${allEditing ? 'Collapse all' : 'Edit all'}</span>
                </button>
            </div>
        `;
        // When an external slot is provided (Quick panel header), render
        // the bar there so it sits inline with the "Quick Optimization
        // Settings" heading. Otherwise inline at the top of the list.
        const inlineEditBar = hasExternalEditSlot ? '' : globalEditBarHtml;

        $container.html(`
            ${inlineEditBar}
            ${addBtn}
            <div class="sort-list xy-sort-list ${inQuick ? 'xy-sort-list-quick' : ''}">${innerHtml}</div>
        `);

        if (hasExternalEditSlot) {
            $globalEditSlot.html(globalEditBarHtml);
        }

        wireInfoIcons($container);

        // Restore scroll positions on the replaced containers. The new
        // .sort-list is a different DOM node so we have to re-apply here.
        // Deferring to requestAnimationFrame ensures the browser has
        // computed the new content height before we try to set scrollTop.
        // Without this, setting scrollTop on a temporarily-shorter
        // document has no effect (the browser clamps it).
        const applyScrollRestore = () => {
            const $newList = $container.find('.sort-list').first();
            if ($newList.length && prevListScroll) $newList[0].scrollTop = prevListScroll;
            if ($scrollAncestor && prevAncestorScroll != null) $scrollAncestor[0].scrollTop = prevAncestorScroll;
            if (Math.abs(window.scrollY - prevWindowScroll) > 1) {
                window.scrollTo(window.scrollX, prevWindowScroll);
            }
        };
        requestAnimationFrame(() => {
            applyScrollRestore();
            // Second rAF: some layouts (flex inside overflow:auto) settle
            // over two frames — restore again to catch those.
            requestAnimationFrame(applyScrollRestore);
        });

        // If we just inserted a duplicated entry, slide it down from hidden
        // state for a smooth appearance animation.
        if (state._slideDownEntryId != null) {
            const id = state._slideDownEntryId;
            state._slideDownEntryId = null;
            const $newEntry = $container.find(`.xy-priority-entry[data-entry-id="${id}"]`).first();
            if ($newEntry.length) {
                $newEntry.hide().slideDown(200);
            }
        }

        // Initialize every weight slider's blue-fill gradient. Without this
        // freshly-rendered sliders stay at the flat bg-primary background
        // until the user interacts with them.
        $container.find('.sort-weight-row .weight-slider').each(function () {
            updateSliderTrack(this);
        });

        // Re-observe the list-root for width changes, since render() may
        // have replaced the .xy-sort-list node with a fresh one.
        if (typeof watchContainerWidth === 'function') watchContainerWidth();
    }

    function emit() { onChange(getEntries()); }

    // Toggle the edit state of every ratio entry at once. If any ratio
    // entry is currently non-editing, flip all to editing; otherwise
    // collapse all. Used by both the inline global-edit button inside
    // $container AND by an external slot (Quick panel header) if the
    // caller provides one via options.globalEditSlot.
    function handleGlobalEditToggle() {
        const ratio = state.entries.filter(en => en.mode === 'ratio');
        if (ratio.length === 0) return;
        const allEditing = ratio.every(en => en.editing);
        const next = !allEditing;
        const toFlip = ratio.filter(en => en.editing !== next);
        if (toFlip.length === 0) return;
        toFlip.forEach(en => { en.editing = next; });
        // Update pencil active class + editing class on ALL rows.
        $container.find('.sort-edit-btn').each(function () {
            const id = parseInt(this.dataset.entryId, 10);
            const en = state.entries.find(x => x.id === id);
            if (en) {
                $(this).toggleClass('active', !!en.editing);
                const $row = $(this).closest('.xy-priority-entry');
                // Fade the actions column during layout change.
                const $actions = $row.find('.sort-item-actions');
                $actions.animate({ opacity: 0 }, 80, function () {
                    $row.toggleClass('xy-entry-editing', !!en.editing);
                    $actions.animate({ opacity: 1 }, 100);
                });
            }
        });
        // Collect only the bodies that need animating.
        let $bodies = $();
        for (const en of toFlip) {
            $bodies = $bodies.add(
                $container.find(
                    `.xy-priority-entry[data-entry-id="${en.id}"] .xy-row, ` +
                    `.xy-priority-entry[data-entry-id="${en.id}"] .xy-row-compact`
                )
            );
        }
        $bodies.slideToggle(180);
        $bodies.promise().done(() => { updateGlobalEditBarLabel(); emit(); });
    }

    // After an in-place delete (see .sort-remove-btn handler), refresh
    // the priority badge numbers (Quick mode) and the up/down arrow
    // disabled-boundary states (Detailed mode) on the remaining rows.
    // Also updates sort-remove-btn disabled state when only one entry
    // Show the "all hidden" empty hint after the last Quick entry is
    // removed or hidden. Also slides up the .sort-list container so
    // the scrollable area disappears.
    function showQuickEmptyHint() {
        const $list = $container.find('.sort-list').first();
        if ($list.length) $list.slideUp(200);
        const $hint = $(buildQuickEmptyStateHtml()).css('display', 'none');
        $container.append($hint);
        $hint.slideDown(200);
    }

    // Build the Quick-mode empty-state markup. Shows a brief context
    // message explaining why the list is empty (all hidden vs
    // non-quality craft with no applicable entries) and an "Add
    // priority #1" button that directly inserts a new ratio entry at
    // index 0 so it becomes the top priority — no need to open the
    // Detailed settings for simple users. Defaults are context-aware:
    //   - quality recipe:      materials/quality  (most common default)
    //   - non-quality craft:   materials/craft    (any non-quality y
    //                          works; this one applies to every recipe)
    function buildQuickEmptyStateHtml() {
        const hintText = true
            ? 'All priorities are hidden from Quick settings.'
            : 'No applicable priorities for this non-quality craft.';
        return `
            <div class="quick-empty-hint">
                <div style="margin-bottom: 10px;">${hintText}</div>
                <button class="sort-add-btn xy-quick-add-first-btn" title="Add a new optimization priority as #1">
                    <span>+ Add priority #1</span>
                </button>
            </div>
        `;
    }

    // Update the global "Edit all / Collapse all" button label + active
    // state in-place.
    function updateGlobalEditBarLabel() {
        const ratioEntries = state.entries.filter(e => e.mode === 'ratio');
        const anyEditing = ratioEntries.some(e => e.editing);
        const allEditing = ratioEntries.length > 0 && ratioEntries.every(e => e.editing);
        // Update inside $container (Detailed mode inline bar).
        const $btn = $container.find('.xy-global-edit-btn');
        $btn.toggleClass('active', anyEditing);
        $btn.find('span').text(allEditing ? 'Collapse all' : 'Edit all');
        $btn.attr('title', allEditing ? 'Collapse all to compact view' : 'Expand all for axis editing');
        // Also update the external slot if present.
        if (hasExternalEditSlot) {
            const $slotBtn = $globalEditSlot.find('.xy-global-edit-btn');
            $slotBtn.toggleClass('active', anyEditing);
            $slotBtn.find('span').text(allEditing ? 'Collapse all' : 'Edit all');
            $slotBtn.attr('title', allEditing ? 'Collapse all to compact view' : 'Expand all for axis editing');
        }
    }

    // After an in-place delete (see .sort-remove-btn handler), refresh
    // is left. Cheap DOM-only pass — no full render, no scroll jump.
    function updateBadgesAndBoundaryStates() {
        const inQuick = state.mode === 'quick';
        const onlyOneLeft = state.entries.length <= 1;

        // Disable the remove button on the last remaining row to match
        // initial render behavior (can't delete the final priority).
        $container.find('.sort-remove-btn').each(function () {
            this.disabled = onlyOneLeft;
        });

        if (inQuick) {
            // Quick mode: priority badges reflect the entry's position
            // in state.entries — recompute using priorityNumberFor.
            $container.find('.xy-priority-entry').each(function () {
                const entryId = parseInt(this.getAttribute('data-entry-id'), 10);
                if (!Number.isFinite(entryId)) return;
                const entry = state.entries.find(e => e.id === entryId);
                if (!entry) return;
                const num = priorityNumberFor(entry);
                $(this).find('.xy-priority-badge').text('#' + num);
            });
        } else {
            // Detailed mode: refresh up/down disabled based on visible
            // position among the currently-rendered rows.
            const $rows = $container.find('.sort-list > .xy-priority-entry');
            const total = $rows.length;
            $rows.each(function (i) {
                const $up = $(this).find('.xy-move-up');
                const $down = $(this).find('.xy-move-down');
                $up.prop('disabled', i <= 0);
                $down.prop('disabled', i >= total - 1);
            });
        }
    }

    // FLIP-style swap animation for up/down arrow clicks. Directly
    // reorders the two DOM nodes (no full render()) and animates both
    // rows from their old visual position to their new one. The old
    // version called render() which rebuilt all HTML — the user saw
    // that full rebuild as a "section re-render" before the FLIP kicked
    // in, sometimes with the card briefly at the top of the list.
    // By skipping render() and using insertBefore/insertAfter on the
    // two specific rows, only the affected pair visibly moves.
    //
    // Direction is 'up' or 'down' (of the MOVED entry relative to its
    // neighbor). Also updates state.entries + priority/boundary states
    // + emits the onChange at the end.
    function animateReorderSwap(movedId, neighborId, direction) {
        const $movedBefore = $container.find('.xy-priority-entry[data-entry-id="' + movedId + '"]').first();
        const $neighborBefore = $container.find('.xy-priority-entry[data-entry-id="' + neighborId + '"]').first();
        if (!$movedBefore.length || !$neighborBefore.length) return;

        const beforeMoved = $movedBefore[0].getBoundingClientRect();
        const beforeNeighbor = $neighborBefore[0].getBoundingClientRect();

        const movedIdx = state.entries.findIndex(p => p.id === movedId);
        const neighborIdx = state.entries.findIndex(p => p.id === neighborId);
        if (movedIdx < 0 || neighborIdx < 0) return;
        const [moved] = state.entries.splice(movedIdx, 1);
        state.entries.splice(neighborIdx, 0, moved);

        if (direction === 'up') $movedBefore.insertBefore($neighborBefore);
        else $movedBefore.insertAfter($neighborBefore);

        const afterMoved = $movedBefore[0].getBoundingClientRect();
        const afterNeighbor = $neighborBefore[0].getBoundingClientRect();
        const dyMoved = beforeMoved.top - afterMoved.top;
        const dyNeighbor = beforeNeighbor.top - afterNeighbor.top;

        // FLIP via Web Animations API — browser-native, no paint-
        // separation tricks needed.
        const duration = 280;
        const easing = 'ease';
        if (dyMoved !== 0) {
            $movedBefore[0].animate([
                { transform: 'translateY(' + dyMoved + 'px)' },
                { transform: 'translateY(0)' }
            ], { duration, easing });
        }
        if (dyNeighbor !== 0) {
            $neighborBefore[0].animate([
                { transform: 'translateY(' + dyNeighbor + 'px)' },
                { transform: 'translateY(0)' }
            ], { duration, easing });
        }

        setTimeout(() => {
            // Refresh priority badges + up/down disabled boundary states
            // on all rows. Cheap — no render().
            updateBadgesAndBoundaryStates();
            emit();
            // Scroll follow — pull the moved row back into view if it
            // drifted past the edge of the active scroll container.
            try {
                const el = $movedBefore[0];
                if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            } catch (_err) { /* noop */ }
        }, 300);
    }

    // Apply the blue-fill linear-gradient background to a weight-slider
    // input. Matches the activity-side `_updateSliderTrack` so XY sliders
    // visually match the rest of the optimization UI. Called on input
    // events and once per render for each fresh slider.
    function updateSliderTrack(slider) {
        if (!slider) return;
        const min = Number(slider.min || 0);
        const max = Number(slider.max || 100);
        const val = Number(slider.value || 0);
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        slider.style.background =
            'linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ' +
            pct + '%, var(--bg-primary) ' + pct + '%, var(--bg-primary) 100%)';
    }

    function getEntries() {
        // Return a deep-copy shaped for the backend (strip the local id).
        // Activity entries are always ratio mode — no budget, no quality.
        return state.entries.map(e => {
            return {
                mode: 'ratio',
                x: e.x,
                y: e.y,
                weight: clampWeight(e.weight),
                targetItem: e.targetItem || null,
                hiddenInQuick: !!e.hiddenInQuick,
                editing: !!e.editing,
            };
        });
    }

    function setEntries(newEntries) {
        state.entries = dedupEntries((newEntries || []).map(normalizeEntry).filter(Boolean));
        render();
    }

    function setIncludeItemFinding(v) {
        state.includeItemFinding = !!v;
    }

    // --- Event handlers (delegated from $container) -------------------

    $container.on('click.xypl', (e) => {
        const t = e.target;

        // Group expand arrow (Quick mode only). Animate slide of the
        // member rows and the shared-target dropdown instead of calling
        // render() — this keeps the DOM stable (no flash) and gives a
        // smoother feel. State is still updated so a subsequent render
        // from duplicate/delete/hide lands on the right layout.
        const expBtn = t.closest('.xy-group-expand');
        if (expBtn) {
            e.preventDefault(); e.stopPropagation();
            const sig = expBtn.dataset.groupSig;
            if (!sig) return;
            const willExpand = !state.expandedGroups.has(sig);
            if (willExpand) state.expandedGroups.add(sig);
            else state.expandedGroups.delete(sig);

            const $arrow = $(expBtn);
            const $groupRow = $container.find(`.xy-priority-group[data-group-sig="${CSS.escape(sig)}"]`);
            const $shared = $groupRow.find('.xy-group-shared-target').first();
            const $members = $container.find(`.xy-group-members-wrap[data-group-sig="${CSS.escape(sig)}"]`).first();

            if (willExpand) {
                $arrow.addClass('expanded');
                $groupRow.addClass('group-expanded');
                // Simultaneously hide the shared dropdown and reveal
                // the member rows (issue #3 feedback).
                if ($shared.length) $shared.slideUp(180);
                if ($members.length) $members.slideDown(200);
            } else {
                $arrow.removeClass('expanded');
                if ($members.length) $members.slideUp(200);
                if ($shared.length) {
                    $shared.slideDown(180, () => {
                        // Drop the group-expanded class after the shared
                        // dropdown is fully back so CSS rules stay in sync.
                        $groupRow.removeClass('group-expanded');
                    });
                } else {
                    $groupRow.removeClass('group-expanded');
                }
            }
            return;
        }

        // XY dropdown button — X, Y, Quality, Target-item.
        // Grouped rows use data-group-sig on the wrap instead of data-entry-id;
        // selecting a value there updates every entry in that group.
        const btn = t.closest('.xy-dropdown-btn');
        if (btn) {
            e.preventDefault(); e.stopPropagation();
            const $wrap = $(btn).closest('.xy-wrap');
            const axis = $wrap.data('xy-axis');

            // Group-level dropdown: shared quality / target_item across members.
            const groupSig = $wrap.data('group-sig');
            if (groupSig) {
                const visible = state.entries.filter(e => {
                    if (e.hiddenInQuick) return false;
                    if (false && e.mode === 'ratio' && e.y === 'quality') return false;
                    return true;
                });
                const groupEntries = visible.filter(e => groupSignature(e) === groupSig);
                if (!groupEntries.length) return;

                if (_openDropdown && _openDropdown.for === `group:${groupSig}:${axis}`) {
                    closeGlobalDropdown();
                    return;
                }

                let itemsHtml;
                if (axis === 'target_item') itemsHtml = renderTargetItemOptionsHtml(state.includeItemFinding, state.activityDropTable);
                else return;

                openDropdownUnder($(btn), itemsHtml, (val) => {
                    let changed = false;
                    for (const e of groupEntries) {
                        // quality axis removed for activities
                        if (axis === 'target_item' && e.targetItem !== val) { e.targetItem = val; changed = true; }
                    }
                    if (changed) {
                        // The group signature changed (since the shared target
                        // is part of the signature), so the group may merge
                        // with another existing group. Drop the old expanded
                        // state so we don't leak stale signatures.
                        state.expandedGroups.delete(groupSig);
                        render();
                        emit();
                    }
                }, `group:${groupSig}:${axis}`);
                return;
            }

            // Per-entry dropdown (existing behavior).
            const entryId = parseInt($wrap.data('entry-id'), 10);
            const entry = state.entries.find(p => p.id === entryId);
            if (!entry) return;

            if (_openDropdown && _openDropdown.for === `${entryId}:${axis}`) {
                closeGlobalDropdown();
                return;
            }

            let itemsHtml;
            if (axis === 'x') itemsHtml = renderXOptionsHtml();
            else if (axis === 'y') itemsHtml = renderYOptionsHtml(entry.x);
            else if (axis === 'target_item') itemsHtml = renderTargetItemOptionsHtml(state.includeItemFinding, state.activityDropTable);
            else return;

            openDropdownUnder($(btn), itemsHtml, (val) => {
                let changed = false;
                if (axis === 'x' && entry.x !== val) {
                    entry.x = val;
                    if (!isValidAsY(val, entry.y)) entry.y = 'craft';
                    changed = true;
                } else if (axis === 'y' && entry.y !== val) {
                    entry.y = val;
                    changed = true;
                } else if (false) { // quality removed
                    entry.quality = val;
                    changed = true;
                } else if (axis === 'target_item' && entry.targetItem !== val) {
                    entry.targetItem = val;
                    changed = true;
                }
                if (changed) {
                    render();
                    emit();
                }
            }, `${entryId}:${axis}`);
            return;
        }

        // "Add priority #1" from the Quick-mode empty state. Inserts a
        // new ratio entry at index 0 so it becomes the top priority,
        // and makes it visible in Quick. Defaults are context-aware
        // (see buildQuickEmptyStateHtml for rationale). Matched before
        // the generic .sort-add-btn handler below since this button
        // carries both classes but should route here.
        //
        // Activity defaults: (steps, target_item, cat:normal_items) —
        // matches the activity default entry on line 200 and the
        // exported addPriorityFirst method. This is what most users
        // want when they add a new top-priority activity entry.
        // (Earlier versions copy-pasted recipe's `(materials, quality)`
        // ternary which is wrong for activities — bug 73e74ec7.)
        if (t.closest('.xy-quick-add-first-btn')) {
            e.preventDefault(); e.stopPropagation();
            const newEntry = makeRatioEntry('steps', 'target_item', {
                editing: true,
                hiddenInQuick: false,
                targetItem: 'cat:normal_items',
            });
            state.entries.unshift(newEntry);
            state._slideDownEntryId = newEntry.id;
            render(); emit();
            return;
        }

        // Add priority (detailed only)
        if (t.closest('.sort-add-btn')) {
            e.preventDefault(); e.stopPropagation();
            if (_openDropdown && _openDropdown.for === 'add-menu') {
                closeGlobalDropdown();
                return;
            }
            const $btn = $(t.closest('.sort-add-btn'));
            openDropdownUnder($btn, renderAddMenuHtml(), (kind) => {
                let newEntry;
                // Activities have no budget mode — only ratio entries.
                // New ratio entries default to editing=true so the
                // user can pick X/Y axes immediately without hunting
                // for the pencil toggle. Default axes are
                // (steps, target_item, cat:normal_items) — the
                // canonical activity starter, matching the empty-state
                // add button and the exported addPriorityFirst method.
                newEntry = makeRatioEntry('steps', 'target_item', {
                    editing: true,
                    targetItem: 'cat:normal_items',
                });
                state.entries.push(newEntry);
                // Flag for render() to slideDown the new entry.
                state._slideDownEntryId = newEntry.id;
                render(); emit();
            }, 'add-menu');
            return;
        }

        // Duplicate — insert new entry directly after the source then slide
        // it down for a smooth visual (issue #4).
        const dupBtn = t.closest('.sort-duplicate-btn');
        if (dupBtn) {
            e.preventDefault(); e.stopPropagation();
            const entryId = parseInt(dupBtn.dataset.entryId, 10);
            const idx = state.entries.findIndex(p => p.id === entryId);
            if (idx >= 0) {
                const src = state.entries[idx];
                // Activities have no budget mode — only ratio entries.
                // Duplicates open in edit mode (user usually copies then
                // tweaks X/Y immediately).
                const copy = makeRatioEntry(src.x, src.y, { targetItem: src.targetItem, weight: src.weight, hiddenInQuick: src.hiddenInQuick, editing: true });
                state.entries.splice(idx + 1, 0, copy);
                state._slideDownEntryId = copy.id;
                render(); emit();
            }
            return;
        }

        // Remove — slide up the affected row, then remove the DOM node
        // directly (no full render()). Previously we called render()
        // after the slideUp which rebuilt the whole list HTML — that
        // triggered a visible scroll-jump because the scroll restore
        // happens in rAF and the browser paints one frame of content
        // at wrong scroll before restore. Activity uses this in-place
        // pattern (settings-modal.js .sort-remove-btn handler) and it's
        // smooth; copying it here. The only post-op cleanup is updating
        // priority badges + up/down disabled state on the remaining
        // rows, and removing any now-empty Quick-mode group wrapper.
        const rmBtn = t.closest('.sort-remove-btn');
        if (rmBtn && !rmBtn.disabled) {
            e.preventDefault(); e.stopPropagation();
            if (state.entries.length <= 1) return;
            const entryId = parseInt(rmBtn.dataset.entryId, 10);
            const $row = $(rmBtn).closest('.xy-priority-entry');
            const $groupWrap = $row.closest('.xy-group-members-wrap'); // Quick mode only
            rmBtn.disabled = true; // stop double-clicks during the anim
            $row.css('pointer-events', 'none');
            const finish = () => {
                $row.remove();
                state.entries = state.entries.filter(p => p.id !== entryId);
                // Clean up an orphan group wrapper if the deleted row was
                // the last member of its Quick-mode group (leaves a stale
                // group-of-1 header otherwise).
                if ($groupWrap.length && $groupWrap.children('.xy-priority-entry').length === 0) {
                    const sig = $groupWrap.data('groupSig');
                    // Slide up the wrapper + group header so they don't
                    // just vanish abruptly.
                    const $groupHeader = sig
                        ? $container.find(`.xy-priority-group[data-group-sig="${CSS.escape(String(sig))}"]`)
                        : $();
                    $groupWrap.slideUp(200, () => { $groupWrap.remove(); });
                    $groupHeader.slideUp(200, () => { $groupHeader.remove(); });
                    if (sig) state.expandedGroups.delete(String(sig));
                }
                updateBadgesAndBoundaryStates();
                // If Quick mode and no visible entries remain, show hint.
                if (state.mode === 'quick') {
                    const visible = state.entries.filter(en => !en.hiddenInQuick);
                    if (visible.length === 0) showQuickEmptyHint();
                }
                emit();
            };
            if ($row.length) $row.slideUp(200, finish);
            else finish();
            return;
        }

        // Per-entry edit toggle (pencil). Flips entry.editing and
        // simultaneously slides BOTH body variants (expanded .xy-row
        // and compact .xy-row-compact) — jQuery's slideToggle toggles
        // each element based on its current visibility, so the hidden
        // one slides down AS the visible one slides up. Final render
        // happens after both animations complete to sync the global
        // edit bar text.
        const editBtn = t.closest('.sort-edit-btn');
        if (editBtn) {
            e.preventDefault(); e.stopPropagation();
            const entryId = parseInt(editBtn.dataset.entryId, 10);
            const entry = state.entries.find(p => p.id === entryId);
            if (!entry || entry.mode === 'budget') return;
            const $row = $(editBtn).closest('.xy-priority-entry');
            entry.editing = !entry.editing;
            $row.find('.sort-edit-btn').toggleClass('active', entry.editing);
            // Animate the actions column layout change (2×2 ↔ 1-col) with
            // a quick fade so the grid reflow isn't jarring.
            const $actions = $row.find('.sort-item-actions');
            $actions.animate({ opacity: 0 }, 80, function () {
                $row.toggleClass('xy-entry-editing', entry.editing);
                $actions.animate({ opacity: 1 }, 100);
            });
            const $bodies = $row.find('.xy-row, .xy-row-compact');
            $bodies.slideToggle(180);
            $bodies.promise().done(() => { updateGlobalEditBarLabel(); emit(); });
            return;
        }

        // Global edit toggle — flips all ratio entries toward the target
        // state (all-on if any is off, all-off if all are on). Only the
        // entries whose state actually changes get animated, so a second
        // click after a full expand doesn't re-animate entries that were
        // already editing.
        const globalEditBtn = t.closest('.xy-global-edit-btn');
        if (globalEditBtn) {
            e.preventDefault(); e.stopPropagation();
            handleGlobalEditToggle();
            return;
        }

        // Up / down arrow reorder (detailed mode only). Moves the entry
        // one position in state.entries, animates the swap via FLIP, and
        // scrolls the moved entry back into view so rapid clicks don't
        // send it offscreen. Previous version called render() after the
        // state mutation which rebuilt the entire list HTML on every
        // swap — the user saw the whole section flash + re-render before
        // the FLIP. In-place DOM reorder keeps everything stable and
        // the FLIP is the only visible motion.
        const upBtn = t.closest('.xy-move-up');
        if (upBtn) {
            e.preventDefault(); e.stopPropagation();
            if (upBtn.disabled) return;
            const entryId = parseInt(upBtn.dataset.entryId, 10);
            const idx = state.entries.findIndex(p => p.id === entryId);
            if (idx > 0) {
                const neighborId = state.entries[idx - 1].id;
                animateReorderSwap(entryId, neighborId, 'up');
            }
            return;
        }
        const downBtn = t.closest('.xy-move-down');
        if (downBtn) {
            e.preventDefault(); e.stopPropagation();
            if (downBtn.disabled) return;
            const entryId = parseInt(downBtn.dataset.entryId, 10);
            const idx = state.entries.findIndex(p => p.id === entryId);
            if (idx >= 0 && idx < state.entries.length - 1) {
                const neighborId = state.entries[idx + 1].id;
                animateReorderSwap(entryId, neighborId, 'down');
            }
            return;
        }

        // Hide / show in Quick. In Quick mode (where the toggle makes the
        // entry disappear from the list) we slide up first. In Detailed
        // mode the entry stays visible — just re-render to refresh the
        // eye icon color.
        const hideBtn = t.closest('.sort-hide-btn');
        if (hideBtn) {
            e.preventDefault(); e.stopPropagation();
            const entryId = parseInt(hideBtn.dataset.entryId, 10);
            const entry = state.entries.find(p => p.id === entryId);
            if (!entry) return;
            const inQuick = state.mode === 'quick';
            const willDisappear = inQuick && !entry.hiddenInQuick;
            const $row = $(hideBtn).closest('.xy-priority-entry');
            const finish = () => {
                entry.hiddenInQuick = !entry.hiddenInQuick;
                if (willDisappear) {
                    // Row is gone from Quick — remove DOM + update badges.
                    $row.remove();
                    updateBadgesAndBoundaryStates();
                    // If no visible entries remain, show the empty hint.
                    const visibleEntries = state.entries.filter(en => !en.hiddenInQuick);
                    if (visibleEntries.length === 0) showQuickEmptyHint();
                } else {
                    // Detailed or un-hiding: update icon + class in-place.
                    $row.toggleClass('entry-hidden-in-quick', entry.hiddenInQuick);
                    $(hideBtn).attr('title', entry.hiddenInQuick ? 'Show in Quick settings' : 'Hide from Quick settings');
                    $(hideBtn).html(buildHideIcon(entry.hiddenInQuick));
                }
                emit();
            };
            if (willDisappear && $row.length) $row.slideUp(200, finish);
            else finish();
            return;
        }

        // Click outside dropdown closes it
        if (_openDropdown && !t.closest('.target-dropdown.xy-floating') && !t.closest('.xy-dropdown-btn')) {
            closeGlobalDropdown();
        }
    });

    // Budget input persistence
    $container.on('input.xypl', 'input[data-budget]', function () {
        const entryId = parseInt(this.dataset.entryId, 10);
        const entry = state.entries.find(p => p.id === entryId);
        if (!entry) return;
        if (this.dataset.budget === 'mats') entry.budgetMats = this.value;
        else entry.budgetTarget = this.value;
        emit();
    });

    // Weight slider
    $container.on('input.xypl', '.sort-weight-row .weight-slider', function () {
        const val = clampWeight(this.value);
        const $row = $(this).closest('.sort-weight-row');
        $row.find('.weight-input').val(val);
        const entryId = parseInt(this.dataset.entryId, 10);
        const entry = state.entries.find(p => p.id === entryId);
        if (entry) entry.weight = val;
        updateSliderTrack(this);
        emit();
    });
    $container.on('input.xypl', '.sort-weight-row .weight-input', function () {
        const val = clampWeight(this.value);
        const $row = $(this).closest('.sort-weight-row');
        const $slider = $row.find('.weight-slider');
        $slider.val(val);
        const sliderEl = $slider[0];
        if (sliderEl) updateSliderTrack(sliderEl);
        const entryId = parseInt(this.dataset.entryId, 10);
        const entry = state.entries.find(p => p.id === entryId);
        if (entry) entry.weight = val;
        emit();
    });
    $container.on('blur.xypl', '.sort-weight-row .weight-input', function () {
        this.value = clampWeight(this.value);
    });

    // Drag-and-drop reorder (detailed only). Desktop uses HTML5 drag-and-
    // drop on the whole entry; mobile falls back to touch events on the
    // `.drag-handle` (☰) since iOS Safari doesn't fire HTML5 drag events
    // from touch input. Both paths share the same `draggedEl` reference
    // so the finish logic in dragend also runs when touchend fires.
    if (state.mode === 'detailed') {
        let draggedEl = null;
        let touchStartY = 0;
        let touchCurrentY = 0;
        let touchScrollParent = null;
        let touchClassTimer = null;

        function finishDragCommit() {
            if (draggedEl) $(draggedEl).removeClass('dragging');
            const newOrder = [];
            $container.find('.xy-sort-list').first().find('.xy-priority-entry').each(function () {
                const id = parseInt(this.dataset.entryId, 10);
                const entry = state.entries.find(p => p.id === id);
                if (entry) newOrder.push(entry);
            });
            draggedEl = null;
            if (newOrder.length === state.entries.length) {
                state.entries = newOrder;
                render(); emit();
            }
        }

        // ===== DESKTOP =====
        // Mirror the activity settings drag-guard: mousedown on any
        // interactive child temporarily strips draggable="true" from the
        // parent entry so the browser doesn't start an HTML5 drag from
        // an input/button. Without this, grabbing the slider thumb and
        // dragging horizontally makes the whole row drag-reorder — the
        // dragstart tag-check below can't save us because the drag
        // gesture has already begun.
        // Includes all XY-specific interactive selectors:
        //   .weight-slider / .weight-input — weight controls
        //   .sort-remove-btn / .sort-duplicate-btn / .sort-hide-btn — action buttons
        //   .xy-dropdown-btn — axis / quality / target-item pickers
        //   .xy-move-up / .xy-move-down — reorder arrows
        //   input[data-budget] — budget-mode number inputs
        const DRAG_GUARD_SELECTOR = [
            '.weight-slider', '.weight-input',
            '.sort-remove-btn', '.sort-duplicate-btn', '.sort-hide-btn',
            '.sort-edit-btn', '.xy-global-edit-btn',
            '.xy-dropdown-btn', '.target-dropdown-button',
            '.xy-move-up', '.xy-move-down',
            'input[data-budget]',
        ].join(', ');
        $container.on('mousedown.xypl', DRAG_GUARD_SELECTOR, function (e) {
            const $item = $(e.target).closest('.xy-priority-entry');
            if (!$item.length) return;
            $item.attr('draggable', 'false');
            $(document).one('mouseup', () => {
                $item.attr('draggable', 'true');
            });
        });

        $container.on('dragstart.xypl', '.xy-priority-entry', function (e) {
            const tag = e.target.tagName.toLowerCase();
            if (['input', 'button', 'select', 'textarea'].includes(tag)) { e.preventDefault(); return; }
            draggedEl = this;
            $(this).addClass('dragging');
            try { e.originalEvent.dataTransfer.effectAllowed = 'move'; } catch (err) { /* noop */ }
        });
        $container.on('dragend.xypl', '.xy-priority-entry', function () {
            stopAutoScroll();
            finishDragCommit();
        });
        $container.on('dragover.xypl', '.xy-priority-entry', function (e) {
            if (!draggedEl || this === draggedEl) return;
            e.preventDefault();
            try { e.originalEvent.dataTransfer.dropEffect = 'move'; } catch (err) { /* noop */ }
            const rect = this.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.originalEvent.clientY < midpoint) this.parentNode.insertBefore(draggedEl, this);
            else this.parentNode.insertBefore(draggedEl, this.nextSibling);
            // Auto-scroll when dragging near the edge — benefits desktop
            // drags inside the settings modal too, not just touch drags.
            if (!touchScrollParent) touchScrollParent = findScrollParent(draggedEl);
            updateAutoScroll(e.originalEvent.clientY, touchScrollParent);
        });

        // ===== MOBILE TOUCH =====
        // Only the ☰ handle initiates a touch drag — matches activity.
        // Touching the entry body otherwise lets native scroll take over.
        $container.on('touchstart.xypl', '.drag-handle', function (e) {
            const $item = $(this).closest('.xy-priority-entry');
            if (!$item.length) return;
            draggedEl = $item[0];
            touchStartY = e.originalEvent.touches[0].clientY;
            touchCurrentY = touchStartY;
            touchScrollParent = findScrollParent(draggedEl);
            // Slight delay before applying `dragging` so a quick scroll
            // gesture doesn't briefly flash the drag-state styling.
            touchClassTimer = setTimeout(() => {
                if (draggedEl) $(draggedEl).addClass('dragging');
            }, 100);
        });

        // touchmove listens on the container so it keeps working even if
        // the finger drifts off the handle onto another row.
        $container.on('touchmove.xypl', function (e) {
            if (!draggedEl) return;
            e.preventDefault();
            touchCurrentY = e.originalEvent.touches[0].clientY;
            const elements = $container.find('.xy-priority-entry').not('.dragging').toArray();
            let targetEl = null;
            for (const el of elements) {
                const r = el.getBoundingClientRect();
                if (touchCurrentY >= r.top && touchCurrentY <= r.bottom) { targetEl = el; break; }
            }
            if (targetEl && targetEl !== draggedEl) {
                const r = targetEl.getBoundingClientRect();
                const midpoint = r.top + r.height / 2;
                if (touchCurrentY < midpoint) targetEl.parentNode.insertBefore(draggedEl, targetEl);
                else targetEl.parentNode.insertBefore(draggedEl, targetEl.nextSibling);
            }
            updateAutoScroll(touchCurrentY, touchScrollParent);
        });

        $container.on('touchend.xypl touchcancel.xypl', function () {
            if (!draggedEl) return;
            if (touchClassTimer) { clearTimeout(touchClassTimer); touchClassTimer = null; }
            stopAutoScroll();
            finishDragCommit();
            touchStartY = 0;
            touchCurrentY = 0;
            touchScrollParent = null;
        });
    }

    // Watch each list-root's width and toggle .xy-list-narrow when narrow.
    // Replaces the earlier container-query approach — ResizeObserver avoids
    // the CSS layout-containment side effect that was interfering with the
    // floating axis / target-item dropdown positioning.
    const NARROW_THRESHOLD = 340;
    let _resizeObserver = null;
    function watchContainerWidth() {
        if (typeof ResizeObserver === 'undefined') return;
        if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (_e) {} _resizeObserver = null; }
        const roots = $container.find('.xy-sort-list, .xy-sort-list-quick').toArray();
        if (!roots.length) return;
        _resizeObserver = new ResizeObserver(entries => {
            for (const ent of entries) {
                const w = ent.contentRect ? ent.contentRect.width : ent.target.clientWidth;
                // Skip zero-width readings — they happen when an ancestor is
                // display:none (e.g. the Quick Optimization Settings panel is
                // collapsed). Treating w=0 as "narrow" applies .xy-list-narrow
                // and column-stacks the entries, poisoning the height jQuery
                // measures when slideDown opens the panel. Mid-animation the
                // real width arrives, .xy-list-narrow is removed, the entries
                // collapse back to row layout, and the panel snaps from the
                // (taller) animated height to the (shorter) real height.
                if (w === 0) continue;
                ent.target.classList.toggle('xy-list-narrow', w < NARROW_THRESHOLD);
            }
        });
        for (const r of roots) _resizeObserver.observe(r);
    }

    // Initial render + width watcher.
    render();
    watchContainerWidth();

    // Attach click handler on the external edit-bar slot if provided.
    // The main delegated handler on $container doesn't see clicks on
    // elements outside $container, so we wire a parallel delegated
    // listener scoped to the slot.
    if (hasExternalEditSlot) {
        $globalEditSlot.on('click.xypl-slot', '.xy-global-edit-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            handleGlobalEditToggle();
        });
    }

    return {
        getEntries,
        setEntries,
        setIncludeItemFinding,
        // Insert a new ratio entry at index 0 (priority #1). Mirrors the
        // recipe module's addPriorityFirst — exposed here so the "+"
        // button in the Quick Optimization Settings header works for
        // activity mode too. Defaults to (steps, target_item) with
        // cat:normal_items because that's what most users want when
        // they add a new activity priority — matching the activity
        // default entry (see line 200) and the standard "steps per
        // normal item drop" optimization goal.
        addPriorityFirst: () => {
            const newEntry = makeRatioEntry('steps', 'target_item', {
                editing: true,
                hiddenInQuick: false,
                targetItem: 'cat:normal_items',
            });
            state.entries.unshift(newEntry);
            state._slideDownEntryId = newEntry.id;
            render();
            emit();
        },
        // Return a snapshot of the currently-expanded group signatures so
        // the caller can persist it across a destroy+mount cycle (issue #1
        // — duplicating inside an expanded group used to collapse it when
        // saveOptimizationSettings triggered a parent re-render).
        getExpandedGroups: () => new Set(state.expandedGroups),
        refresh: render,
        destroy: () => {
            $container.off('.xypl');
            closeGlobalDropdown(true);
            if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (_e) {} _resizeObserver = null; }
            $container.empty();
            if (hasExternalEditSlot) {
                $globalEditSlot.off('.xypl-slot');
                $globalEditSlot.empty();
            }
        },
    };
}
