/**
 * bank-icon-map.js — maps the game's bank node-icon tokens (sprite_20_icons/*,
 * general_icons/*) to icons WE actually host, so imported layouts DISPLAY our assets.
 *
 * IMPORTANT — direction is game → ours for DISPLAY ONLY. The node keeps the canonical
 * game token (bank-schema stores withSlash(ic) and exports noSlash(icon)), so export is
 * lossless. We deliberately do NOT keep a reverse (ours → game) map: it would be lossy
 * because many game tokens legitimately share one of our icons (e.g. materials_ore and
 * tools_pickaxe both resolve to the mining skill icon). Keeping the game token canonical
 * is what makes import → show-our-data → export round-trip correctly.
 *
 * Our hosted icon sources:
 *   - /assets/icons/text/skill_icons/<skill>.svg  (12 skills, served — used by stats report)
 *   - /assets/icons/items/equipment/*.svg         (in-repo item icons)
 * The game's sprite_20_icons PNGs are hosted NOWHERE, which is why the raw game path 404s.
 *
 * Unmapped tokens (gear slots, misc rarity glyphs, generic tools, favourite/recent) return
 * '' → the node renders as its clean coloured shape (no broken image).
 */

const SKILL = (s) => `/assets/icons/text/skill_icons/${s}.svg`;
const TYPE = (t) => `/assets/icons/text/skill_types/${t}.svg`;

export const GAME_ICON_MAP = {
    // --- generic tabs → skill-type glyphs (no single-skill match) ---
    tab_materials: TYPE('gathering'), // materials come from the gathering skills
    tab_tools: TYPE('utility'),       // tools are utility items

    // --- skill tabs → skill icons ---
    tab_agility: SKILL('agility'),
    tab_carpentry: SKILL('carpentry'),
    tab_cooking: SKILL('cooking'),
    tab_crafting: SKILL('crafting'),
    tab_fishing: SKILL('fishing'),
    tab_foraging: SKILL('foraging'),
    tab_hunting: SKILL('hunting'),
    tab_mining: SKILL('mining'),
    tab_smithing: SKILL('smithing'),
    tab_tailoring: SKILL('tailoring'),
    tab_trinketry: SKILL('trinketry'),
    tab_woodcutting: SKILL('woodcutting'),
    tab_consumables: SKILL('cooking'),

    // --- materials categories → the skill that produces them ---
    materials_ore: SKILL('mining'),
    materials_gem: SKILL('mining'),
    materials_bars: SKILL('smithing'),
    materials_logs: SKILL('woodcutting'),
    materials_plank: SKILL('carpentry'),
    materials_plants: SKILL('foraging'),
    materials_raw_fish: SKILL('fishing'),
    materials_trinket: SKILL('trinketry'),
    materials_ingredient: SKILL('cooking'),
    materials_arrow: SKILL('hunting'),
    materials_hunting_products: SKILL('hunting'),

    // --- tools → the skill they belong to ---
    tools_carpentry: SKILL('carpentry'),
    tools_cooking: SKILL('cooking'),
    tools_cooking_pan: SKILL('cooking'),
    tools_crafting: SKILL('crafting'),
    tools_foraging: SKILL('foraging'),
    tools_fishing_rod: SKILL('fishing'),
    tools_fishing_lure: SKILL('fishing'),
    tools_pickaxe: SKILL('mining'),
    tools_light_source: SKILL('mining'),
    tools_saw: SKILL('carpentry'),
    tools_sander: SKILL('carpentry'),
    tools_ruler: SKILL('carpentry'),
    tools_sickle: SKILL('foraging'),
    tools_chisel: SKILL('crafting'),
    tools_knife: SKILL('cooking'),
    tools_needle: SKILL('tailoring'),
    tools_scissors: SKILL('tailoring'),
    tools_pliers: SKILL('smithing'),
    tools_wrench: SKILL('smithing'),
    tools_bug_catching_net: SKILL('hunting'),

    // --- consumables → cooking (fishing bait → fishing) ---
    consumables_baked: SKILL('cooking'),
    consumables_cooked_fish: SKILL('cooking'),
    consumables_dishes: SKILL('cooking'),
    consumables_drinks: SKILL('cooking'),
    consumables_food: SKILL('cooking'),
    consumables_meats: SKILL('cooking'),
    consumables_fishing_bait: SKILL('fishing'),
};

/** Reduce a stored icon value (full path or bare token) to its game token key. */
export function gameIconToken(icon) {
    if (!icon) return '';
    return String(icon).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
}

/**
 * Rewrite a game sprite/general icon path (…/sprite_20_icons/<n>.png or
 * …/general_icons/<n>.png) to the exact hosted SVG we converted from the game art
 * (util/scrapers/png_to_svg.py → ./assets, served at /assets). Returns '' if not a
 * sprite/general path.
 */
function spriteSvg(s) {
    const m = String(s).match(/(?:^|\/)(sprite_20_icons|general_icons)\/([^/]+)\.(?:png|svg)$/i);
    return m ? `/assets/icons/text/${m[1]}/${m[2]}.svg` : '';
}

/**
 * Resolve a node's stored icon to a src WE host, for display. Prefers the EXACT hosted
 * game glyph (converted to SVG); falls back to the skill/type approximation, else ''.
 * @returns {string} hosted path, or '' when unmapped (caller shows the coloured shape).
 */
export function resolveNodeIcon(icon) {
    if (!icon) return '';
    const s = String(icon);
    // Already one of our own hosted assets (not a game sprite path) → use directly.
    if (s.startsWith('/assets/') && !s.includes('/sprite_20_icons/') && !s.includes('/general_icons/')) return s;
    return spriteSvg(s) || GAME_ICON_MAP[gameIconToken(s)] || '';
}

/** The skill/type approximation only (used as the onerror fallback below the exact svg). */
export function approxNodeIcon(icon) {
    return GAME_ICON_MAP[gameIconToken(icon)] || '';
}

/**
 * Inline onerror chain for a node <img> whose primary src is resolveNodeIcon(rawIcon)
 * (the exact hosted SVG). On error: skill/type approximation → finalFallback (data-URI)
 * or hide. Graceful degradation if a converted SVG is ever missing.
 */
export function nodeIconOnError(rawIcon, finalFallback = '') {
    const primary = resolveNodeIcon(rawIcon);
    const approx = approxNodeIcon(rawIcon);
    const fb = (approx && approx !== primary) ? approx : '';
    const last = finalFallback
        ? `this.onerror=null;this.src='${finalFallback}'`
        : `this.onerror=null;this.style.display='none'`;
    if (!fb) return last;
    return `if(this.dataset.fb){${last}}else{this.dataset.fb=1;this.src='${fb}'}`;
}
