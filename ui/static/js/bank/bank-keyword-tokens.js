/**
 * bank-keyword-tokens.js — bridges the in-game Bank filter keyword TOKENS to the keyword
 * IDs our catalog items actually carry, in BOTH directions (matching + export).
 *
 * Why this exists: the game's Bank filter uses a few keyword spellings that differ from the
 * keyword our items carry (our catalog keywords are Title-cased, e.g. "Cooked Fish"):
 *
 *   game Bank-filter token   our item keyword        cause
 *   ----------------------   -------------------     -------------------------------------
 *   cookedFish               "Cooked Fish"           separator/case only  → normKeyword() alone
 *   fishing_bait             "Fishing Bait"          separator/case only  → normKeyword() alone
 *   item_trinket             "Trinket"               different word       → ALIAS
 *   search_traveling         "Travelling"            different word       → ALIAS
 *   search_travelling        "Travelling"            different word (game current spelling)
 *
 * Most tokens differ only by separator/case, which normKeyword() folds away; only the
 * genuinely-different words need an explicit ALIAS entry.
 */

// lowercase, drop every non-alphanumeric separator (_/-/space/camel boundaries collapse to
// nothing), then strip a trailing plural 's'. "Cooked Fish"/"cookedFish"/"cooked_fish" → "cookedfish".
export function normKeyword(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
}

// Genuinely-different-word aliases: normKeyword(anything) -> canonical normalized keyword.
// Both the game token and the catalog keyword canonicalize to the same value so they match.
const ALIAS = {
    itemtrinket: 'trinket',          // game filter "item_trinket"  ↔ item keyword "Trinket"
    traveling: 'travelling',         // American spelling ↔ our catalog "Travelling"
    searchtraveling: 'travelling',   // game default-layout spelling (one L)
    searchtravelling: 'travelling',  // game current spelling (two L)
};

/** Canonicalize any keyword token/value to the form used for MATCHING (engine) + export lookup. */
export function canonKeyword(s) {
    const n = normKeyword(s);
    return ALIAS[n] || n;
}

// EXPORT direction: canonKeyword(value) -> the exact game Bank-filter token to emit, so a
// keyword the user picked from our editor (or an imported one) serializes to what the game
// expects. Keyed on the canonical (normKeyword) form so every input spelling maps correctly.
// Keywords not listed here export via bank-schema's default _gameKeyword() (lower_snake).
export const KEYWORD_EXPORT_TOKEN = {
    trinket: 'item_trinket',
    cookedfish: 'cookedFish',
    travelling: 'search_travelling',
};
