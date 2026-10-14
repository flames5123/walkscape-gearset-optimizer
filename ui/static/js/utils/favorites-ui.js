/**
 * favorites-ui.js
 *
 * Pure helpers for the recipe/activity favorites feature (account-synced).
 *
 * DATA MODEL — favorites are a single ORDERED list of typed entries:
 *   [ { type: 'activity'|'recipe', id: string }, ... ]
 * The order is meaningful: it is the manual order the user added / rearranged
 * them in, and it is what the "Favorites" category renders (newest-added last,
 * drag-to-reorder in edit mode). A single list (rather than two per-type
 * arrays) lets the combined dropdown show activities and recipes interleaved in
 * one true manual order.
 *
 * Legacy shape { activities:[], recipes:[] } is migrated on normalize
 * (activities first, then recipes) so older persisted data keeps working.
 *
 * All helpers are DOM/jQuery/state-free and unit-tested.
 */

/**
 * Normalize any raw favorites value into the canonical ordered entry array,
 * de-duplicated (first occurrence wins), preserving order.
 * Accepts: the ordered array, the legacy {activities,recipes} object, or junk.
 * @param {*} fav
 * @returns {Array<{type:string,id:string}>}
 */
export function normalizeFavorites(fav) {
    const out = [];
    const seen = new Set();
    const push = (type, id) => {
        if ((type !== 'activity' && type !== 'recipe') || id == null) return;
        const key = `${type}\u0000${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ type, id });
    };
    if (Array.isArray(fav)) {
        for (const e of fav) {
            if (e && typeof e === 'object') push(e.type, e.id);
        }
    } else if (fav && typeof fav === 'object') {
        // Legacy { activities:[], recipes:[] }
        if (Array.isArray(fav.activities)) for (const id of fav.activities) push('activity', id);
        if (Array.isArray(fav.recipes)) for (const id of fav.recipes) push('recipe', id);
    }
    return out;
}

/**
 * Ordered ids of a given type (preserves manual order).
 * @param {*} favorites
 * @param {'activity'|'recipe'} type
 * @returns {string[]}
 */
export function favoriteListFor(favorites, type) {
    return normalizeFavorites(favorites).filter(e => e.type === type).map(e => e.id);
}

/**
 * Is (type, id) favorited?
 * @param {*} favorites
 * @param {'activity'|'recipe'} type
 * @param {string} id
 * @returns {boolean}
 */
export function isFavorited(favorites, type, id) {
    if (!id) return false;
    const arr = Array.isArray(favorites) ? favorites : normalizeFavorites(favorites);
    return arr.some(e => e && e.type === type && e.id === id);
}

/**
 * Return a NEW ordered array with (type, id) toggled. Adds at the END when
 * absent (so new favorites append in add-order), removes when present. Pure.
 * @param {*} favorites
 * @param {'activity'|'recipe'} type
 * @param {string} id
 * @returns {Array<{type:string,id:string}>}
 */
export function toggleFavorite(favorites, type, id) {
    const arr = normalizeFavorites(favorites);
    if (!id) return arr;
    const i = arr.findIndex(e => e.type === type && e.id === id);
    if (i >= 0) {
        arr.splice(i, 1);
    } else {
        arr.push({ type, id });
    }
    return arr;
}

/**
 * Reorder the entries of ONE type to match `orderedIds`, leaving entries of
 * other types in their absolute positions. Pure. Used when the user drags to
 * reorder within a single-type dropdown (activity or recipe). Entries of `type`
 * are rewritten in the given id order at the positions they currently occupy.
 * If `orderedIds` isn't a permutation of the current type's ids, the input is
 * returned unchanged (defensive).
 * @param {*} favorites
 * @param {'activity'|'recipe'} type
 * @param {string[]} orderedIds
 * @returns {Array<{type:string,id:string}>}
 */
export function reorderFavoriteType(favorites, type, orderedIds) {
    const arr = normalizeFavorites(favorites);
    const current = arr.filter(e => e.type === type).map(e => e.id);
    const a = [...current].sort();
    const b = [...orderedIds].sort();
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
        return arr; // not a permutation — ignore
    }
    const queue = orderedIds.slice();
    return arr.map(e => (e.type === type ? { type, id: queue.shift() } : e));
}

/**
 * Replace the whole ordered list from a list of {type,id} (used by the combined
 * dropdown's cross-type drag reorder). Normalizes/dedupes. Pure.
 * @param {Array<{type:string,id:string}>} orderedEntries
 * @returns {Array<{type:string,id:string}>}
 */
export function reorderFavoritesAll(orderedEntries) {
    return normalizeFavorites(orderedEntries);
}

/**
 * ORDER-SENSITIVE equality (reordering IS a change, so undo/redo records it).
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function favoritesEqual(a, b) {
    const na = normalizeFavorites(a);
    const nb = normalizeFavorites(b);
    if (na.length !== nb.length) return false;
    for (let i = 0; i < na.length; i++) {
        if (na[i].type !== nb[i].type || na[i].id !== nb[i].id) return false;
    }
    return true;
}

/**
 * Does the list contain at least one favorite of the given type(s)?
 * @param {*} favorites
 * @param {Array<'activity'|'recipe'>} types
 * @returns {boolean}
 */
export function hasAnyFavorite(favorites, types) {
    return normalizeFavorites(favorites).some(e => types.includes(e.type));
}

/**
 * Heart-toggle markup for a dropdown row.
 * @param {'activity'|'recipe'} type
 * @param {string} id
 * @param {boolean} isFav
 * @returns {string} HTML
 */
export function heartHtml(type, id, isFav) {
    const cls = isFav ? 'dropdown-fav-heart is-fav' : 'dropdown-fav-heart';
    const label = isFav ? 'Remove from favorites' : 'Add to favorites';
    return `<span class="${cls}" data-fav-type="${type}" data-fav-id="${id}" role="button" tabindex="0" aria-label="${label}" title="${label}">${isFav ? '♥' : '♡'}</span>`;
}

/**
 * Drag-handle markup shown on favorite rows in edit mode.
 * @returns {string} HTML
 */
export function dragHandleHtml() {
    return `<span class="fav-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">☰</span>`;
}
