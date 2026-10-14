/**
 * bank-schema.js — map the in-game Bank export ("v2" object) <-> our layout model.
 *
 * Transport: the game ships a gzip'd JSON string (base64 for our import/export box).
 * Structure (from a real export):
 *   { v:2, l:[ { n, ic, t:[ { id,n,ic,cl,f:[[code,val]], c:[ {id,n,ic,cl,bs,bc,f,i} ], u } ] } ] }
 *   f entries are [typeCode, value]; c[].i / t[].u are ordered item ids with
 *   placeholder tuples (preserved verbatim for lossless round-trip).
 *
 * Assumptions flagged for live validation:
 *  - FILTER_CODE 0-5 -> item_type/gear_type/keyword/skill/global/regional (ALL confirmed 2026-08-01).
 *    Filters combine with OR across ALL of a node's filters (confirmed). Keyword (2) is the full
 *    item-keyword set and may overlap other types (e.g. "regional", "consumable"). global (4) and
 *    regional (5) appear as bare valueless flags: [4] / [5].
 *  - bs shape codes (confirmed): none = bs absent/0, 1 = circle, 2 = rounded-square, 3 = square.
 *  - `cl` (foreground) and `bc` (background) are INDEPENDENT tokens (bc is NOT always dark_+cl);
 *    the original names are preserved (_c/_bc) for lossless export.
 *  - Tool-only filters (item_state/item_id) are dropped from the GAME export (they don't exist
 *    in-game); they survive in our own saved layouts.
 */

import { canonKeyword, KEYWORD_EXPORT_TOKEN } from './bank-keyword-tokens.js';

export const FILTER_CODE = ['item_type', 'gear_type', 'keyword', 'skill', 'global', 'regional'];
const FILTER_CODE_REV = Object.fromEntries(FILTER_CODE.map((t, i) => [t, i]));

// bs shape codes (confirmed): none = absent/0, 1 = circle, 2 = rounded-square, 3 = square.
export const BS_SHAPE_LIST = ['circle', 'rounded-square', 'square']; // 1-based; 0/absent = none

// Named palette (non-skill `cl` tokens) -> HTML/CSS hex. `amber` and `sky` aren't CSS
// keyword colors, so use their standard hex (amber #FFBF00, sky = skyblue #87CEEB); the
// rest are exact CSS keyword hexes. `dark_<name>` (the bg color) is the base darkened ~55%.
export const NAMED_COLORS = {
    amber: "#F8D667",
    blue: "#77B3F0",
    brown: "#9D8880",
    charcoal: "#36454F",
    cyan: "#73CDDE",
    green: "#90C58A",
    grey: "#BDBDBD",
    indigo: "#7B85C5",
    lime: "#B5D38A",
    orange: "#F4BA60",
    pink: "#DF6B91",
    purple: "#AE6CC2",
    red: "#D67976",
    sky: "#6FC0F1",
    slate: "#708090",
    teal: "#6AB3AB",
    violet: "#9076C7",
    yellow: "#FCF187",
};
// Foreground (`cl`) palette in the exact order the game's picker lists it, 8 across.
export const NAMED_COLOR_ORDER = [
    'red', 'pink', 'purple', 'violet', 'indigo', 'blue', 'sky', 'cyan',
    'teal', 'green', 'lime', 'yellow', 'amber', 'orange', 'brown', 'grey',
];
// Background (`bc`) picker adds two neutral-only shades after the 16 named darks,
// before the skill secondaries: dark_slate (17), dark_charcoal (18). NOTE: exact hexes
// for indigo/cyan/slate/charcoal are approximate CSS keywords pending Jimmy's screenshots.
export const BG_ONLY_NAMES = ['slate', 'charcoal'];
// The 12 skill color tokens the game emits as `skill_<name>` / `dark_skill_<name>`.
export const SKILL_COLOR_TOKENS = [
    'agility', 'carpentry', 'cooking', 'crafting', 'fishing', 'foraging',
    'hunting', 'mining', 'smithing', 'tailoring', 'trinketry', 'woodcutting',
];

function darkenHex(hex, f = 0.55) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
    return '#' + parts.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Exact game palette hexes (from the in-game picker). Table-first so the simulator
// renders the game's real colors, incl. its own skill hues.
export const BANK_COLOR_HEX = {
    red: "#D67976",
    pink: "#DF6B91",
    purple: "#AE6CC2",
    violet: "#9076C7",
    indigo: "#7B85C5",
    blue: "#77B3F0",
    sky: "#6FC0F1",
    cyan: "#73CDDE",
    teal: "#6AB3AB",
    green: "#90C58A",
    lime: "#B5D38A",
    yellow: "#FCF187",
    amber: "#F8D667",
    orange: "#F4BA60",
    brown: "#9D8880",
    grey: "#BDBDBD",
    skill_agility: "#BC70A7",
    skill_carpentry: "#BF8A70",
    skill_cooking: "#C29E72",
    skill_crafting: "#B6617D",
    skill_fishing: "#7EB9C6",
    skill_foraging: "#A0B597",
    skill_hunting: "#CA986D",
    skill_mining: "#8B97B3",
    skill_smithing: "#B99A99",
    skill_tailoring: "#A5C9D2",
    skill_trinketry: "#D0C0A0",
    skill_woodcutting: "#82C67B",
    dark_red: "#492C2B",
    dark_pink: "#492C38",
    dark_purple: "#3B2B43",
    dark_violet: "#332A43",
    dark_indigo: "#2B3043",
    dark_blue: "#253950",
    dark_sky: "#274050",
    dark_cyan: "#2A494F",
    dark_teal: "#2C4945",
    dark_green: "#2F412E",
    dark_lime: "#3C452A",
    dark_yellow: "#4D4A24",
    dark_amber: "#4C4123",
    dark_orange: "#4B3922",
    dark_brown: "#3C332F",
    dark_grey: "#383838",
    dark_slate: "#2D3339",
    dark_charcoal: "#2A2A2E",
    dark_skill_agility: "#3E2437",
    dark_skill_carpentry: "#3F2E25",
    dark_skill_cooking: "#403525",
    dark_skill_crafting: "#3C202A",
    dark_skill_fishing: "#293D41",
    dark_skill_foraging: "#353C32",
    dark_skill_hunting: "#433323",
    dark_skill_mining: "#2E323B",
    dark_skill_smithing: "#3D3232",
    dark_skill_tailoring: "#364345",
    dark_skill_trinketry: "#453F34",
    dark_skill_woodcutting: "#2A4129",
};

/**
 * Resolve a game `cl`/`bc` color token to a CSS color value.
 *  - skill_<name>       -> var(--skill-<name>-color)            (our primary skill color)
 *  - dark_skill_<name>  -> var(--skill-<name>-secondary-color)  (our secondary skill color)
 *  - <named>            -> HTML/CSS hex (NAMED_COLORS)
 *  - dark_<named>       -> that hex darkened ~55% (the tile background shade)
 *  - anything else (already a hex, or unknown) -> passed through unchanged
 */
export function resolveBankColor(cl) {
    if (!cl) return '#888888';
    const s = String(cl);
    if (Object.prototype.hasOwnProperty.call(BANK_COLOR_HEX, s)) return BANK_COLOR_HEX[s];
    let m = /^dark_skill_(.+)$/.exec(s);
    if (m) return `var(--skill-${m[1]}-secondary-color)`;
    m = /^skill_(.+)$/.exec(s);
    if (m) return `var(--skill-${m[1]}-color)`;
    m = /^dark_(.+)$/.exec(s);
    if (m) return NAMED_COLORS[m[1]] ? darkenHex(NAMED_COLORS[m[1]]) : s;
    return NAMED_COLORS[s] || s;
}

// Reverse map (named hex -> name) so an editor-picked hex serializes back to a game token.
const HEX_TO_NAME = Object.fromEntries(Object.entries(NAMED_COLORS).map(([n, h]) => [h.toLowerCase(), n]));
const nameFromHex = (hex) => HEX_TO_NAME[String(hex || '').toLowerCase()] || 'grey';
const shapeFromCode = (bs) => (!bs ? 'none' : (BS_SHAPE_LIST[bs - 1] || 'circle'));
const codeFromShape = (shape) => { const i = BS_SHAPE_LIST.indexOf(shape); return i >= 0 ? i + 1 : 0; }; // 'none'/unknown -> 0
const withSlash = (p) => (p && !p.startsWith('/') && !p.startsWith('http') ? '/' + p : (p || ''));
const noSlash = (p) => (p && p.startsWith('/') ? p.slice(1) : (p || ''));

function filterFromGame(entry) {
    const [code, val] = entry;
    const type = FILTER_CODE[code] || 'keyword';
    // global (4) and regional (5) are bare valueless flags in the game: [4] / [5].
    if (type === 'global') return { type, value: true };
    if (type === 'regional') return { type, value: (val == null ? [] : [val]) }; // [] = any regional
    return { type, value: [val] };
}
const isFlagFilter = (f) => f.type === 'global'
    || (f.type === 'regional' && (!Array.isArray(f.value) || f.value.length === 0));

/** Fold game [code,val] pairs into our merged filters (OR within a type; flags stand alone). */
function foldFilters(entries) {
    const out = [];
    const byType = new Map();
    for (const e of (entries || [])) {
        const f = filterFromGame(e);
        if (isFlagFilter(f)) { // global / any-regional: keep one flag, dedupe repeats
            if (!out.some((o) => o.type === f.type && isFlagFilter(o))) out.push(f);
            continue;
        }
        if (!byType.has(f.type)) { const nf = { type: f.type, value: [] }; byType.set(f.type, nf); out.push(nf); }
        byType.get(f.type).value.push(Array.isArray(f.value) ? f.value[0] : f.value);
    }
    return out;
}

/** Game keyword token form: lowercase, spaces→underscores (e.g. "Cut Gem" → "cut_gem"). */
function _gameKeyword(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '_'); }

/** Expand our merged filters back into game [code,val] pairs (drops tool-only filters). */
function filtersToGame(filters) {
    const out = [];
    for (const f of (filters || [])) {
        if (!(f.type in FILTER_CODE_REV)) continue; // item_state / item_id / recipe are tool-only
        const code = FILTER_CODE_REV[f.type];
        if (f.type === 'global') { out.push([code]); continue; }           // bare [4]
        if (f.type === 'regional') {
            const vals = Array.isArray(f.value) ? f.value.filter((v) => v != null) : [];
            if (!vals.length) out.push([code]);                            // bare [5] = any regional
            else for (const v of vals) out.push([code, v]);
            continue;
        }
        // Keyword tokens must be game-form or the game shows nothing. Most fold to lower_snake
        // via _gameKeyword ("Cut Gem" → "cut_gem"); a few have a distinct game Bank-filter token
        // (Trinket → item_trinket, Cooked fish → cookedFish, Travelling → search_travelling) that
        // KEYWORD_EXPORT_TOKEN restores so an editor-picked or imported keyword round-trips.
        if (f.type === 'keyword') {
            for (const v of (Array.isArray(f.value) ? f.value : [f.value])) {
                out.push([code, KEYWORD_EXPORT_TOKEN[canonKeyword(v)] || _gameKeyword(v)]);
            }
            continue;
        }
        for (const v of (Array.isArray(f.value) ? f.value : [f.value])) out.push([code, v]);
    }
    // De-dupe identical filter pairs so a category with two of the same filter (e.g. the editor
    // stored [{skill:[tailoring]},{skill:[tailoring]}]) doesn't export [[3,"tailoring"],[3,"tailoring"]].
    // Keyed by code (+value for valued filters); preserves first-occurrence order.
    const seen = new Set();
    const deduped = [];
    for (const pair of out) {
        const k = pair.length > 1 ? pair[0] + '\u0000' + String(pair[1]) : String(pair[0]);
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(pair);
    }
    return deduped;
}

function catFromGame(c) {
    return {
        id: c.id, name: c.n, icon: withSlash(c.ic),
        color: resolveBankColor(c.cl), _c: c.cl,
        bgShape: shapeFromCode(c.bs), _bs: c.bs,
        bgColor: resolveBankColor(c.bc), _bc: c.bc,
        showWhenEmpty: !!c.se,
        locked: !!c.lk,
        filters: foldFilters(c.f),
        _i: c.i || [],   // preserved item ordering + placeholders (lossless)
    };
}
function tabFromGame(t) {
    return {
        id: t.id, name: t.n, icon: withSlash(t.ic),
        color: resolveBankColor(t.cl), _c: t.cl,
        bgShape: shapeFromCode(t.bs), _bs: t.bs,
        filters: foldFilters(t.f),
        categories: (t.c || []).map(catFromGame),
        _u: t.u || [],
    };
}

/** Parse a decoded v2 export object into our layout (first layout in `l`). */
export function parseGameExport(obj) {
    if (!obj || !Array.isArray(obj.l) || !obj.l.length) throw new Error('Not a v2 bank export');
    const l = obj.l[0];
    return {
        name: l.n || 'Imported layout',
        schemaVersion: 1,
        icon: withSlash(l.ic),
        settings: { view: 'grid', showPlaceholders: true },
        pins: {},
        tabs: (l.t || []).map(tabFromGame),
        _gameVersion: obj.v || 2,
    };
}

/** Reorder game item entries (bare id / [id] / [id,q,0]) by a settings.itemOrder key list,
 *  matching on gameItemKey so each entry's existing encoding is preserved. Entries not in the
 *  order list keep their original relative position after the ordered ones. */
function reorderEntries(entries, order) {
    if (!Array.isArray(entries) || entries.length < 2 || !order || !order.length) return entries || [];
    const pos = new Map(order.map((id, ix) => [gameItemKey(id), ix]));
    const keyOf = (e) => gameItemKey(Array.isArray(e) ? e[0] : e);
    return entries
        .map((e, ix) => [e, ix])
        .sort((a, b) => (pos.has(keyOf(a[0])) ? pos.get(keyOf(a[0])) : order.length + a[1]) - (pos.has(keyOf(b[0])) ? pos.get(keyOf(b[0])) : order.length + b[1]))
        .map((x) => x[0]);
}

/** Append game item-entries from `additions` to `entries`, skipping any whose stable key
 *  (slug/uuid) is already present. Does NOT de-dupe within `entries` itself — the game's own
 *  `i`/`u` arrays legitimately carry a placeholder (`[id]`) alongside the placed item (`id`),
 *  which share a key and must both survive a round-trip. Entries may be a bare id, `[id]`, or
 *  `[id, quality, variant]`. */
function mergeNewEntries(entries, additions) {
    const keyOf = (e) => gameItemKey(Array.isArray(e) ? e[0] : e);
    const have = new Set(entries.map(keyOf));
    for (const a of (additions || [])) {
        const k = keyOf(a);
        if (!k || have.has(k)) continue;
        have.add(k);
        entries.push(a);
    }
    return entries;
}

function catToGame(c, order, bakedById, manualById) {
    const cl = c._c || nameFromHex(c.color);
    const gameFilters = filtersToGame(c.filters);
    // Recipe / item_id / advanced (item_state) filters don't exist in-game, so a category
    // relying ONLY on them would import EMPTY. Materialize the tool-resolved items into the
    // explicit `i` array (game item entries: item-<slug>-<uuid>) so they actually show up.
    const entries = Array.isArray(c._i) ? c._i.slice() : [];
    const hasFilters = Array.isArray(c.filters) && c.filters.length > 0;
    if (hasFilters && gameFilters.length === 0 && bakedById && Array.isArray(bakedById[c.id]) && bakedById[c.id].length) {
        mergeNewEntries(entries, bakedById[c.id]);
    }
    // Manual (drag/pin) placements ALWAYS bake in — the game's own filters can't reproduce
    // them, so a filterless (drag-only) category would otherwise export/import EMPTY. These
    // come from layout.pins resolved to game entry ids; ordering is applied by reorderEntries
    // via settings.itemOrder below.
    if (manualById && Array.isArray(manualById[c.id]) && manualById[c.id].length) {
        mergeNewEntries(entries, manualById[c.id]);
    }
    const out = {
        id: c.id, n: c.name,
        cl,
        // bc is independent of cl; preserve the imported token, else the editor-picked bg,
        // else default to the dark_ pair. (Serialized only if present.)
        bc: c._bc || (c.bgColor ? nameFromHex(c.bgColor) : ('dark_' + cl)),
        f: gameFilters,
        i: reorderEntries(entries, order),
    };
    const _ic = noSlash(c.icon); if (_ic) out.ic = _ic; // omit `ic` when no icon (matches game)
    const bs = c._bs != null ? c._bs : codeFromShape(c.bgShape);
    if (bs) out.bs = bs; // omit for 'none' (0) — matches the game's absent-bs representation
    if (c.showWhenEmpty) out.se = 1; // show-when-empty; omit when off (matches game absent = hidden)
    if (c.locked) out.lk = 1;        // lock items in place on auto-organize; omit when off
    return out;
}
function tabToGame(t, orderMap, bakedById, manualById, manualUncat) {
    const uEntries = Array.isArray(t._u) ? t._u.slice() : [];
    if (manualUncat && Array.isArray(manualUncat[t.id]) && manualUncat[t.id].length) {
        mergeNewEntries(uEntries, manualUncat[t.id]);
    }
    const out = {
        id: t.id, n: t.name,
        cl: t._c || nameFromHex(t.color),
        f: filtersToGame(t.filters),
        c: (t.categories || []).map((c) => catToGame(c, orderMap && orderMap[c.id], bakedById, manualById)),
        u: reorderEntries(uEntries, orderMap && orderMap.__uncat),
    };
    const _ic = noSlash(t.icon); if (_ic) out.ic = _ic; // omit `ic` when no icon (matches game)
    return out;
}

/** Serialize our layout back into a v2 export object (game-compatible; drops tool-only filters).
 *  opts.catItemEntries = { [catId]: ['item-<slug>-<uuid>', ...] } bakes resolved items into
 *  categories whose only filters are tool-only (recipe/item_id/advanced).
 *  opts.manualCatEntries = { [catId]: [gameId, ...] } and opts.manualUncat = { [tabId]: [gameId, ...] }
 *  bake manually-placed (drag/pin) items into a category's `i` / a tab's `u` regardless of
 *  filters — without these, drag-only categories export empty. */
export function toGameExport(layout, opts = {}) {
    const orderMap = (layout.settings && layout.settings.itemOrder) || {};
    const bakedById = opts.catItemEntries || {};
    const manualById = opts.manualCatEntries || {};
    const manualUncat = opts.manualUncat || {};
    const l = {
        n: layout.name || 'My layout',
        t: (layout.tabs || []).map((t) => tabToGame(t, orderMap, bakedById, manualById, manualUncat)),
    };
    const _ic = noSlash(layout.icon); if (_ic) l.ic = _ic; // omit `ic` when no icon (matches game)
    return { v: 2, l: [l] };
}

// ---- gzip transport (base64 of gzip'd JSON) ----
export async function gzipEncode(str) {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(str)); w.close();
    const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
}
export async function gzipDecode(b64) {
    const bytes = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

export async function encodeLayoutExport(layout, opts) { return gzipEncode(JSON.stringify(toGameExport(layout, opts))); }
export async function decodeLayoutImport(b64) { return parseGameExport(JSON.parse(await gzipDecode(b64))); }

// ---- item-array resolution (category `i` + tab `u`) ----
// Game item ids look like "item-<slug>-<uuid>" or a bare uuid. We normalize to a
// stable key (the slug when present, else the raw id) so the page can match against
// our engine items by id or slug.
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
export function gameItemKey(raw) {
    if (typeof raw !== 'string') return '';
    const m = raw.match(/^item-(.+)-([0-9a-fA-F-]{30,})$/);
    if (m && UUID_RE.test(m[2])) return m[1]; // slug from item-<slug>-<uuid>
    return raw;
}

function parseItemEntry(e, order) {
    // string => placed; [id] => placeholder; [id, quality, variant] => placed w/ quality.
    if (Array.isArray(e)) return { key: gameItemKey(e[0]), placeholder: e.length === 1, quality: e.length > 1 ? e[1] : null, order };
    return { key: gameItemKey(e), placeholder: false, quality: null, order };
}

/**
 * Walk a parsed layout's preserved `_i`/`_u` arrays into placement records:
 *   { key, tabId, catId|null, placeholder, quality, order }
 * Deduped by key+tab+cat (first occurrence wins, preserving order).
 */
export function importedPlacements(layout) {
    const out = [];
    for (const tab of (layout.tabs || [])) {
        (tab._u || []).forEach((e, i) => { const p = parseItemEntry(e, i); if (p.key) out.push({ ...p, tabId: tab.id, catId: null }); });
        for (const cat of (tab.categories || [])) {
            (cat._i || []).forEach((e, i) => { const p = parseItemEntry(e, i); if (p.key) out.push({ ...p, tabId: tab.id, catId: cat.id }); });
        }
    }
    const seen = new Set();
    const res = [];
    for (const p of out) {
        const k = `${p.key}|${p.tabId}|${p.catId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        res.push(p);
    }
    return res;
}
