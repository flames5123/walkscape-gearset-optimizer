/**
 * Effective collectible-ownership helpers.
 *
 * A collectible can be owned two ways:
 *   1. Imported from the character export -> store.state.character.collectibles
 *      (array of lowercase-underscore collectible slugs).
 *   2. Manually checked in the UI -> ui.user_overrides.items[slug].has === true
 *      (and manually un-owned via has === false). This is what item-row.js
 *      writes when the user ticks the "owned" checkbox on a collectible row.
 *
 * Historically the Collection ring's obtained-collectible count and the "hide
 * owned collectibles" drop filter looked ONLY at (1), so a manually-checked
 * collectible neither bumped the ring's 10/20/30/... tiers nor dropped out of
 * activity loot tables (bug 5d24decc). These helpers merge (1) and (2) so every
 * "owned collectible" consumer agrees on the effective owned set.
 */
import store from '../state.js';

/** Lowercased Set of the imported (character-export) owned collectible slugs. */
function _importedOwnedSet() {
    const coll = store.state.character?.collectibles;
    const set = new Set();
    if (Array.isArray(coll)) {
        for (const c of coll) set.add(String(c).toLowerCase());
    }
    return set;
}

/**
 * Lowercased Set of every known collectible slug from the cached catalog. Used
 * to decide which user_overrides.items entries are collectibles — the overrides
 * map mixes gear/consumables/pets/collectibles together, so only entries that
 * are actually collectibles may affect the collectible count.
 */
function _catalogCollectibleSlugs() {
    const cat = (typeof window !== 'undefined' && window.api) ? window.api._catalogCache : null;
    const list = (cat && Array.isArray(cat.collectibles)) ? cat.collectibles : [];
    const set = new Set();
    for (const c of list) {
        const slug = c && (c.id || c.slug);
        if (slug) set.add(String(slug).toLowerCase());
    }
    return set;
}

/**
 * Is a specific collectible (by slug/name) currently owned, honoring manual
 * overrides? A manual override (has true/false) takes precedence over the
 * imported set. The caller already knows the slug is a collectible (e.g. from a
 * "Collectible.<name>" drop ref), so no catalog lookup is needed here.
 *
 * @param {string} slug - collectible slug/name (case-insensitive)
 * @returns {boolean}
 */
export function isCollectibleOwned(slug) {
    if (!slug) return false;
    const s = String(slug).toLowerCase();
    const ov = store.state.ui?.user_overrides?.items?.[s];
    if (ov && typeof ov.has === 'boolean') return ov.has;
    return _importedOwnedSet().has(s);
}

/**
 * Lowercased Set of every owned collectible slug (imported UNION manually
 * checked, minus manually-unchecked). Manual overrides are only merged for
 * slugs that are known collectibles per the catalog (falling back to the
 * imported set when the catalog has not loaded yet, so a non-collectible
 * "owned" override can never inflate the collectible count).
 *
 * @returns {Set<string>}
 */
export function getEffectiveOwnedCollectibles() {
    const set = _importedOwnedSet();
    const overrides = store.state.ui?.user_overrides?.items || {};
    const collectibleSlugs = _catalogCollectibleSlugs();
    for (const [slug, ov] of Object.entries(overrides)) {
        if (!ov || typeof ov.has !== 'boolean') continue;
        const s = String(slug).toLowerCase();
        // Only collectibles affect the collectible count. If the catalog has not
        // loaded yet we can still trust slugs already in the imported set.
        const isColl = collectibleSlugs.has(s) || set.has(s);
        if (!isColl) continue;
        if (ov.has) set.add(s);
        else set.delete(s);
    }
    return set;
}

/**
 * Count of owned collectibles for the Collection ring's obtained-collectible
 * gated tiers. A numeric user_overrides.total_collectibles still wins when set
 * (legacy manual total override).
 *
 * @returns {number}
 */
export function getOwnedCollectiblesCount() {
    const overrideTC = store.state.ui?.user_overrides?.total_collectibles;
    if (overrideTC !== undefined && overrideTC !== null) {
        return overrideTC;
    }
    return getEffectiveOwnedCollectibles().size;
}
