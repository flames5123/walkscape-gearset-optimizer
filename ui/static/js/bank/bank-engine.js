/**
 * bank-engine.js — Pure filter/assignment engine for the Bank Layout Simulator.
 *
 * NO DOM, NO side effects. Given a set of items and a layout, computes which
 * tab/category each item lands in. Unit-tested in tests/test_bank_engine.mjs.
 *
 * Spec: .kiro/BANK_LAYOUT_SPEC.md (§6 engine, §7 filters).
 *
 * ── Item interface (documented; UI adapter maps the live store to this in Phase 1b) ──
 *   Item {
 *     id:        string          // slug / uuid — identity for dedup + counts
 *     type:      string          // item-type taxonomy value  (UNKNOWN_BANK_ITEM_TYPE_TAXONOMY)
 *     gearType?: string          // gear/slot value            (UNKNOWN_BANK_GEAR_TYPE)
 *     keywords:  string[]        // keywords the item carries
 *     skills:    string[]        // skill scopes; EMPTY => not skill-scoped
 *     hasStats:  boolean         // whether the item grants any stats at all
 *     owned:     boolean         // does the current session own it
 *     stale?:    boolean         // signals a re-import is needed (goals-report stale detection)
 *     regional?: boolean         // convenience flag; else inferred from a "Regional" keyword
 *   }
 */

import { canonKeyword } from './bank-keyword-tokens.js';

export const FILTER_TYPES = Object.freeze([
    'item_type', 'gear_type', 'keyword', 'skill', 'global', 'regional', 'item_state', 'item_id', 'recipe',
]);

// Advanced tool-only auto-category states (§7). Not in-game.
export const ITEM_STATES = Object.freeze(['not_obtained', 'obtained', 'stale_detection']);

// Background shapes the game actually supports (confirmed from export `bs` codes):
// none (bs absent/0), circle (1), rounded-square (2), square (3).
export const BG_SHAPES = Object.freeze(['none', 'circle', 'rounded-square', 'square']);

// UNKNOWN_BANK_MATCH_MODE — default first-match (decision 2026-07-30).
export const MATCH_MODES = Object.freeze(['first-match', 'multi-match']);
export const DEFAULT_MATCH_MODE = 'first-match';

// The marker keyword the game uses to denote a regional item. UNKNOWN_BANK_* — flag.
export const REGIONAL_MARKER = 'Regional';

function asArray(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}

function intersects(a, b) {
    if (!a || !b || !a.length || !b.length) return false;
    const set = a instanceof Set ? a : new Set(a);
    for (const x of b) if (set.has(x)) return true;
    return false;
}

// Our catalog uses Title-case / singular keywords + slots (`Bar`, `Log`, `tools`) while the
// game's filter values are lowercase / plural (`bar`, `logs`, `tool`). Normalize both sides:
// lowercase and drop a trailing plural 's' so `Log`/`logs`, `Bar`/`bar`, `tools`/`tool` match.
function _normTok(s) { return String(s == null ? '' : s).toLowerCase().replace(/s$/, ''); }
// item_type: game `crafted` vs our `crafted_item`; strip a trailing `_item`, then lowercase.
function _normType(s) { return String(s == null ? '' : s).toLowerCase().replace(/_item$/, ''); }
function _intersectsNorm(a, b) {
    if (!a || !b || !a.length || !b.length) return false;
    const set = new Set(asArray(a).map(_normTok));
    return asArray(b).some((x) => set.has(_normTok(x)));
}
// Keyword matching uses canonKeyword() (separator/case-insensitive + game-token aliases) so
// game Bank-filter tokens match the Title-cased keywords our catalog carries:
//   "cookedFish"↔"Cooked Fish", "fishing_bait"↔"Fishing Bait" (separator/case),
//   "item_trinket"↔"Trinket", "search_travel(l)ing"↔"Travelling" (aliases).
function _intersectsKeyword(a, b) {
    if (!a || !b || !a.length || !b.length) return false;
    const set = new Set(asArray(a).map(canonKeyword));
    return asArray(b).some((x) => set.has(canonKeyword(x)));
}

function isRegional(item) {
    if (item.regional === true) return true;
    return asArray(item.keywords).includes(REGIONAL_MARKER);
}

// Traveling behaves like a skill scope in-game: a travelling item's stats are traveling-scoped,
// so it is NOT "global" (which is stats-but-no-skill). Detect via the "Travelling" keyword
// (canonicalized, so "Traveling"/"Travelling" both count). Used to exclude such items from the
// global filter so they land in a Traveling category instead of Global.
function isTravellingScoped(item) {
    return asArray(item.keywords).some((k) => canonKeyword(k) === 'travelling');
}

/**
 * Does a single filter match a single item?
 * `filter.negate === true` inverts the result.
 */
export function itemMatchesFilter(item, filter) {
    let m;
    switch (filter.type) {
        case 'item_type':
            m = asArray(filter.value).some((v) => _normType(v) === _normType(item.type));
            break;
        case 'gear_type':
            m = _intersectsNorm(asArray([item.gearType]), asArray(filter.value));
            break;
        case 'keyword':
            m = _intersectsKeyword(asArray(item.keywords), asArray(filter.value));
            break;
        case 'skill':
            m = intersects(asArray(item.skills), asArray(filter.value));
            break;
        case 'global':
            // "Global" = has stats but is not skill-scoped AND not traveling-scoped (traveling
            // acts like a skill scope). filter.value falsy => no constraint.
            m = filter.value ? (!!item.hasStats && asArray(item.skills).length === 0 && !isTravellingScoped(item)) : true;
            break;
        case 'regional': {
            const reg = isRegional(item);
            const vals = asArray(filter.value);
            m = vals.length ? (reg && intersects(asArray(item.keywords), vals)) : reg;
            break;
        }
        case 'item_state':
            if (filter.value === 'not_obtained') m = !item.owned;
            else if (filter.value === 'obtained') m = !!item.owned;
            else if (filter.value === 'stale_detection') m = !!item.stale;
            else m = false;
            break;
        case 'item_id':
            m = asArray(filter.value).includes(item.id);
            break;
        case 'recipe':
            // Recipe filter stores the recipe's resolved material item-ids in
            // `value` (built from the crafting tree in the editor). Match is the
            // same primitive as item_id — an item collects here if it's one of
            // the recipe's materials.
            m = asArray(filter.value).includes(item.id);
            break;
        default:
            m = false;
    }
    return filter.negate ? !m : m;
}

/**
 * Does an item satisfy a filter SET?
 * Combine semantics (CONFIRMED against the game 2026-08-01): **OR across ALL filters** —
 * an item is auto-collected if it matches ANY single filter, regardless of filter type.
 * (Keywords are the full item-keyword set and may overlap other filter types; that's fine
 * under OR.) An EMPTY filter set matches NOTHING (a category with no auto-filters collects
 * no items automatically; manual pins are applied separately as overrides).
 */
export function filterSetMatches(item, filters) {
    const list = asArray(filters);
    if (!list.length) return false;
    return list.some((f) => itemMatchesFilter(item, f));
}

function tabHasFilters(tab) {
    return asArray(tab.filters).length > 0;
}

// A category is a "Regional" category if any of its filters is a regional-type filter
// (the game's bare regional flag [5], folded to { type:'regional' }). Used to prefer such
// categories for regional items under first-match.
function catHasRegionalFilter(cat) {
    return asArray(cat && cat.filters).some((f) => f && f.type === 'regional');
}

/**
 * Find the categories within a tab (in order) whose filter set matches the item.
 */
function matchingCategories(item, tab) {
    return asArray(tab.categories).filter((cat) => filterSetMatches(item, cat.filters));
}

/**
 * Assign items to a layout.
 *
 * @param {Item[]} items
 * @param {BankLayout} layout   { tabs: Tab[], settings?: { matchMode } }
 * @param {{matchMode?: string, pins?: {[itemId]: {tabId, catId}}}} [opts]
 * @returns {{
 *   byTab: { [tabId]: { byCategory: {[catId]: Item[]}, uncategorized: Item[] } },
 *   globalUncategorized: Item[],
 *   multiMatched: Array<{ item: Item, matches: Array<{tabId, catId|null}> }>,
 * }}
 *
 * Tab semantics:
 *  - Tab WITH filters: the item must match the tab's filter set to be considered for
 *    that tab. It is then placed into matching categories; if it matches the tab but
 *    no category, it goes to that tab's `uncategorized`.
 *  - Tab WITHOUT filters: the item is considered for the tab only if it matches at
 *    least one category in it (there is nothing else pulling items into the tab).
 *
 * `pins` (per-layout manual placement overrides) win over filter assignment and are
 * always single-placement regardless of match mode.
 */
export function assign(items, layout, opts = {}) {
    const matchMode = opts.matchMode || layout?.settings?.matchMode || DEFAULT_MATCH_MODE;
    const pins = opts.pins || {};
    const tabs = asArray(layout?.tabs);

    const byTab = {};
    for (const tab of tabs) {
        byTab[tab.id] = { byCategory: {}, uncategorized: [] };
        for (const cat of asArray(tab.categories)) byTab[tab.id].byCategory[cat.id] = [];
    }
    const globalUncategorized = [];
    const multiMatched = [];

    const tabById = new Map(tabs.map((t) => [t.id, t]));

    for (const item of asArray(items)) {
        // 1) Manual pin override — always single placement.
        const pin = pins[item.id];
        if (pin && byTab[pin.tabId]) {
            const bucket = byTab[pin.tabId];
            if (pin.catId && bucket.byCategory[pin.catId]) bucket.byCategory[pin.catId].push(item);
            else bucket.uncategorized.push(item);
            continue;
        }

        // 2) Filter-based assignment.
        const placements = []; // {tabId, catId|null}
        for (const tab of tabs) {
            const cats = matchingCategories(item, tab);
            const consideredForTab = tabHasFilters(tab)
                ? filterSetMatches(item, tab.filters)
                : cats.length > 0;
            if (!consideredForTab) continue;

            if (cats.length) {
                for (const cat of cats) placements.push({ tabId: tab.id, catId: cat.id, regionalCat: catHasRegionalFilter(cat) });
            } else if (tabHasFilters(tab)) {
                // matched tab filter but no category → tab-level uncategorized
                placements.push({ tabId: tab.id, catId: null, regionalCat: false });
            }
        }

        if (!placements.length) {
            globalUncategorized.push(item);
            continue;
        }

        // Regional items prefer a Regional (regional-filter) category. Under first-match a
        // regional map/tool otherwise lands in an earlier Global/skill category it also
        // matches (stats + no skill → Global), leaving the Regional category empty. Stable
        // partition so regional-filter categories sort ahead of the rest (order preserved
        // among equals). Match mode multi-match places everything, so ordering is moot there.
        if (matchMode !== 'multi-match' && placements.length > 1 && isRegional(item)) {
            placements.sort((a, b) => (b.regionalCat === true) - (a.regionalCat === true));
        }

        if (matchMode === 'multi-match') {
            for (const p of placements) placeItem(byTab, p, item);
        } else {
            // first-match: place in the first placement only
            placeItem(byTab, placements[0], item);
        }

        // Record ambiguity for the coverage/validation panel (both modes).
        if (placements.length > 1) multiMatched.push({ item, matches: placements });
    }

    return { byTab, globalUncategorized, multiMatched };
}

function placeItem(byTab, placement, item) {
    const bucket = byTab[placement.tabId];
    if (!bucket) return;
    if (placement.catId && bucket.byCategory[placement.catId]) bucket.byCategory[placement.catId].push(item);
    else bucket.uncategorized.push(item);
}

/**
 * Unique-item counts for the tab rail and category headers (NOT summed quantity).
 * Counts distinct item ids. In multi-match mode an item can appear in several
 * categories; the tab count still counts each distinct item once.
 * @returns {{ tabs: {[tabId]: number}, categories: {[tabId]: {[catId]: number}} }}
 */
export function layoutCounts(assignment) {
    const tabs = {};
    const categories = {};
    for (const [tabId, bucket] of Object.entries(assignment.byTab)) {
        const tabSet = new Set();
        categories[tabId] = {};
        for (const [catId, arr] of Object.entries(bucket.byCategory)) {
            const catSet = new Set(arr.map((i) => i.id));
            categories[tabId][catId] = catSet.size;
            for (const id of catSet) tabSet.add(id);
        }
        for (const i of bucket.uncategorized) tabSet.add(i.id);
        tabs[tabId] = tabSet.size;
    }
    return { tabs, categories };
}

/**
 * Should a tab/category render given its assigned items and showWhenEmpty flag?
 */
export function isVisible(node, count) {
    return count > 0 || !!node.showWhenEmpty;
}

// ---- Display sort & filter (view-layer lens; does NOT change assignment/export) ----

// Rarity tiers low→high. 'normal' is the common baseline; 'fine' (material variant) ranks top.
export const RARITY_ORDER = Object.freeze(['normal', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal', 'fine']);
export const ITEM_TYPES = Object.freeze(['material', 'crafted', 'consumable', 'loot', 'egg', 'gear']);
export const SORT_KEYS = Object.freeze(['default', 'alphabetical', 'quantity', 'rarity']);
// Default direction per key: alphabetical ascends (A→Z / ↑), quantity & rarity descend (most/highest first / ↓).
export const SORT_DEFAULT_DIR = Object.freeze({ default: 'asc', alphabetical: 'asc', quantity: 'desc', rarity: 'desc' });

function rarityRank(q) {
    const i = RARITY_ORDER.indexOf(String(q == null ? 'normal' : q).toLowerCase());
    return i < 0 ? 0 : i;
}

/**
 * Return a sorted copy of items. key ∈ SORT_KEYS; dir 'asc'|'desc' (defaults per key).
 * 'default' preserves engine/insertion order (reversed when dir='desc').
 */
export function sortItems(items, sort) {
    const key = (sort && sort.key) || 'default';
    const dir = (sort && sort.dir) || SORT_DEFAULT_DIR[key] || 'asc';
    const arr = items.slice();
    const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));
    if (key !== 'default') {
        const cmp = key === 'alphabetical' ? byName
            : key === 'quantity' ? ((a, b) => ((a.qty || 0) - (b.qty || 0)) || byName(a, b))
                : key === 'rarity' ? ((a, b) => (rarityRank(a.quality) - rarityRank(b.quality)) || byName(a, b))
                    : (() => 0);
        arr.sort(cmp);
    }
    if (dir === 'desc') arr.reverse();
    return arr;
}

/**
 * Display filter: does an item pass the active view filter? OR within each dimension,
 * AND across dimensions. Returns true when the filter is disabled/empty.
 * f = { enabled, owned, types[], skills[], qualities[] }
 */
export function itemPassesDisplayFilter(item, f) {
    if (!f || !f.enabled) return true;
    if (f.owned && !item.owned) return false;
    const types = asArray(f.types), skills = asArray(f.skills), quals = asArray(f.qualities);
    if (types.length && !types.some((t) => _normType(t) === _normType(item.type))) return false;
    if (skills.length && !intersects(asArray(item.skills), skills)) return false;
    if (quals.length && !quals.map((q) => String(q).toLowerCase()).includes(String(item.quality || 'normal').toLowerCase())) return false;
    return true;
}
