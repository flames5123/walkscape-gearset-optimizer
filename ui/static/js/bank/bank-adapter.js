/**
 * bank-adapter.js — maps the app's item data into the engine Item interface
 * (see bank-engine.js). Phase 1b: returns a representative SAMPLE set so the
 * shell + editor are demonstrable. Live-inventory wiring (window.store items +
 * catalog type/keywords/skills) is the next increment.
 *
 * Override hook: set window._bankItems to an Item[] (or a function returning
 * one) and getBankItems() will use it instead of the sample set.
 */

// Skill palette (primary colors) — mirrors the values used across the app
// (stats-report-page.js / recipe-info-section.js). Used by the editor color picker.
export const SKILL_COLORS = {
    agility: '#F05FBE', carpentry: '#F18C62', cooking: '#F0AD5F', crafting: '#E9487C',
    fishing: '#60DAEF', foraging: '#ABD3A1', hunting: '#CA986D', mining: '#8CA4D4',
    smithing: '#E2A6A6', tailoring: '#A5C9D2', trinketry: '#D0C0A0', woodcutting: '#5EF06B',
};
export const SKILLS = Object.keys(SKILL_COLORS);

const SAMPLE_ITEMS = [
    { id: 'birch_logs', name: 'Birch logs', type: 'material', keywords: ['wood'], skills: [], hasStats: false, owned: true, qty: 2635, quality: 'normal' },
    { id: 'pine_logs', name: 'Pine logs', type: 'material', keywords: ['wood'], skills: [], hasStats: false, owned: true, qty: 748, quality: 'uncommon' },
    { id: 'oak_logs', name: 'Oak logs', type: 'material', keywords: ['wood'], skills: [], hasStats: false, owned: true, qty: 103, quality: 'fine' },
    { id: 'birch_plank', name: 'Birch plank', type: 'material', keywords: ['plank'], skills: [], hasStats: false, owned: true, qty: 4415, quality: 'normal' },
    { id: 'copper_ore', name: 'Copper ore', type: 'material', keywords: ['ore'], skills: [], hasStats: false, owned: true, qty: 137, quality: 'uncommon' },
    { id: 'agility_boots', name: 'Trailblazer boots', type: 'gear', gearType: 'feet', keywords: ['Skilling Gear'], skills: ['agility'], hasStats: true, owned: true, qty: 1, quality: 'epic' },
    { id: 'mining_pick', name: 'Sturdy pickaxe', type: 'gear', gearType: 'tool', keywords: ['Skilling Gear'], skills: ['mining'], hasStats: true, owned: true, qty: 1, quality: 'rare' },
    { id: 'inv_ring', name: 'Ring of holding', type: 'gear', gearType: 'ring', keywords: [], skills: [], hasStats: true, owned: true, qty: 1, quality: 'uncommon' },
    { id: 'jarv_amulet', name: 'Amulet of Jarvonia', type: 'gear', gearType: 'amulet', keywords: ['Regional', 'Jarvonia'], skills: ['crafting'], hasStats: true, owned: true, qty: 1, quality: 'epic' },
    { id: 'ruby', name: 'Ruby', type: 'material', keywords: ['gem'], skills: [], hasStats: false, owned: false, qty: 0, quality: 'epic' },
    { id: 'new_tool', name: 'Freshly forged hammer', type: 'gear', gearType: 'tool', keywords: ['Skilling Gear'], skills: ['smithing'], hasStats: true, owned: true, stale: true, qty: 1, quality: 'fine' },
    { id: 'cooked_trout', name: 'Cooked trout', type: 'consumable', keywords: ['food'], skills: [], hasStats: false, owned: true, qty: 42, quality: 'normal' },
];

export function getBankItems() {
    const override = window._bankItems;
    if (typeof override === 'function') return override();
    if (Array.isArray(override)) return override;
    if (Array.isArray(_liveCache)) return _liveCache;
    return SAMPLE_ITEMS;
}

// Equipment slots → items with one of these are treated as engine type 'gear'.
// NOTE: the game's torso slot is `chest` (not `body`); omitting it left chest armor
// (tunics/vests/plastrons) mis-typed as non-gear, so stats-less pieces matched neither
// a skill, global, nor regional category and fell into Uncategorized (bug da8ab970).
const GEAR_SLOTS = new Set([
    'head', 'body', 'chest', 'legs', 'feet', 'hands', 'back', 'neck', 'amulet', 'ring',
    'weapon', 'tool', 'tools', 'offhand', 'cape', 'bracelet', 'earring', 'primary', 'secondary',
]);
const SKILL_SET = new Set(SKILLS);

// Item types/keywords that cannot be stored in the in-game bank.
// 'pet' items (from the catalog's pet list) are NOT bankable — they render with an egg
// icon and are "owned" whenever the player owns that pet, so without excluding them they
// showed up as bogus owned "pet eggs" in Uncategorized. The actual egg ITEMS (type 'egg')
// remain and are owned only when in inventory.
const BANK_EXCLUDE_TYPES = new Set(['collectible', 'container', 'memosphere', 'pet']);
function isBankExcluded(ci) {
    if (BANK_EXCLUDE_TYPES.has(String(ci.type || '').toLowerCase())) return true;
    const kws = (ci.keywords || []).map((k) => String(k).toLowerCase());
    return kws.some((k) => k.includes('memosphere') || k.includes('collectible'));
}

let _liveCache = null;

/** Best-effort skill-scope derivation. The catalog carries the authoritative scope in the
 * singular `skill` field ('Fishing', 'Global', 'None', …); older/sample shapes use a plural
 * `skills[]`. An explicit real skill wins; otherwise fall back to skill-named keywords
 * (e.g. "Mining Skill") or stat keys mentioning a skill. Non-skill scopes ('Global',
 * 'Traveling', 'None') yield [] so the item is treated as global, not skill-scoped. */
function deriveSkills(ci) {
    const explicit = [];
    if (Array.isArray(ci.skills)) explicit.push(...ci.skills);
    if (ci.skill != null) explicit.push(ci.skill);
    const explicitSkills = explicit.map((s) => String(s).toLowerCase()).filter((s) => SKILL_SET.has(s));
    if (explicitSkills.length) return [...new Set(explicitSkills)];
    const found = new Set();
    const kws = (ci.keywords || []).map((k) => String(k).toLowerCase());
    for (const s of SKILLS) if (kws.some((k) => k.includes(s))) found.add(s);
    const statsStr = ci.stats && typeof ci.stats === 'object' ? Object.keys(ci.stats).join(' ').toLowerCase() : '';
    for (const s of SKILLS) if (statsStr.includes(s)) found.add(s);
    return [...found];
}

/**
 * Map a raw /api/catalog item + owned state into the engine Item shape.
 * type/name/slot/keywords are reliable; quantities come from
 * character.owned_quantities (id->qty); skill-scope is best-effort (deriveSkills).
 */
function mapCatalogItem(ci, ownedMap, ownedQty) {
    const st = ownedMap[ci.id] || {};
    const slot = ci.slot ? String(ci.slot).toLowerCase() : '';
    const isGear = ci.type === 'equipment' || GEAR_SLOTS.has(slot);
    const type = isGear ? 'gear'
        : (ci.type === 'crafted_item' ? 'crafted' : (ci.type || 'other'));
    const hasStats = !!(ci.stats && typeof ci.stats === 'object' && Object.keys(ci.stats).length) || isGear;
    const qty = ownedQty[ci.id];
    return {
        id: ci.id,
        uuid: ci.uuid || null,
        gameId: ci.game_id || null,   // exact game `i`-array entry id (bare uuid for materials, item-<slug>-<uuid> for gear)
        name: ci.name || ci.id,
        type,
        gearType: isGear ? (slot || 'gear') : undefined,
        icon: ci.icon_path || ci.icon || '',
        keywords: Array.isArray(ci.keywords) ? ci.keywords : [],
        skills: deriveSkills(ci),
        hasStats,
        // Eggs are consumed when hatched, so the ever-obtained `has` flag is stale once the
        // pet exists — a hatched egg would otherwise show as owned with 0 in the bank. Base egg
        // ownership on CURRENT quantity only. Gear/materials keep the has-flag fallback (gear
        // ownership isn't quantity-tracked).
        owned: type === 'egg'
            ? (qty != null && qty > 0)
            : ((qty != null && qty > 0) || st.has === true),
        qty: qty != null ? qty : undefined,
        quality: String(st.quality || st.rarity || ci.rarity || ci.quality || 'normal').toLowerCase(),
        stale: false,
    };
}

/**
 * Load real items from the app catalog + owned-state store. Cached after first
 * success. Falls back silently to the sample set on any failure.
 */
export async function loadBankItems() {
    try {
        const api = window.api;
        if (!api || typeof api.getCatalog !== 'function') return getBankItems();
        const data = await api.getCatalog();
        const items = (data && data.items) || [];
        if (!items.length) return getBankItems();
        const ch = (window.store && window.store.state && window.store.state.character) || {};
        const ownedMap = (window.store && window.store.state && window.store.state.items) || {};
        const ownedQty = ch.owned_quantities || {};
        _liveCache = items.filter((ci) => !isBankExcluded(ci)).map((ci) => mapCatalogItem(ci, ownedMap, ownedQty));
        return _liveCache;
    } catch (_e) {
        return getBankItems();
    }
}
