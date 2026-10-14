/**
 * Shared "Unhide" action for the Hidden upgrades bucket.
 *
 * The Hidden bucket (gear-slot popup, column-2 combined section, goals report,
 * crafting tree) lists items the user hid via the column-1 eye icon that would
 * still be upgrades. Clicking Unhide flips the item's `hide` flag back off and
 * persists it — mirroring exactly what the column-1 eye toggle writes
 * (`ui.user_overrides.items.<id>.hide`). Per the feature decision (Jimmy
 * 2026-08-24) we do NOT auto re-optimize: we flip + persist, optimistically
 * drop the item from the live hidden buckets so it leaves the section
 * immediately, and let the next optimize re-slot it into its real bucket.
 */

import store from '../state.js';
import api from '../api.js';

/**
 * Resolve the catalog item id used as the `state.items` / ui_config key.
 * Mirrors nonowned-upgrades-section._resolveCatalogItem: uuid first, then
 * exact name, then the live popup's item list.
 */
function _resolveItemId(name, uuid) {
    const baseName = _baseName(name);
    const catalogItems = (api._catalogCache && api._catalogCache.items) || [];
    let item = null;
    if (uuid) item = catalogItems.find(i => i.uuid === uuid);
    if (!item && name) item = catalogItems.find(i => i.name === name);
    if (!item && baseName) item = catalogItems.find(i => i.name === baseName);
    const popupItems = window.itemSelectionPopup && window.itemSelectionPopup.items;
    if (!item && Array.isArray(popupItems)) {
        item = popupItems.find(i => i.name === name) || popupItems.find(i => i.name === baseName);
    }
    if (item && item.id) return item.id;
    // Fallback: derive the id the same way build_hidden_items_set does
    // (lowercase, spaces->_, strip parens/apostrophes, hyphens->_).
    return baseName
        ? baseName.toLowerCase().replace(/ /g, '_').replace(/[()']/g, '').replace(/-/g, '_')
        : null;
}

function _baseName(name) {
    let n = String(name || '');
    const q = n.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
    if (q) n = n.slice(0, q.index);
    return n;
}

/** Remove every entry matching this alt (by uuid+quality, else name) from a
 *  {slot: [alt,...]} bucket. Returns a new pruned object (or null if empty). */
function _pruneBucket(bucket, alt) {
    if (!bucket || typeof bucket !== 'object') return bucket;
    const out = {};
    let kept = 0;
    for (const [slot, list] of Object.entries(bucket)) {
        if (!Array.isArray(list)) { out[slot] = list; continue; }
        const filtered = list.filter(a => {
            if (alt.uuid && a.uuid) return !(a.uuid === alt.uuid && (a.quality || '') === (alt.quality || ''));
            return a.name !== alt.name;
        });
        if (filtered.length) { out[slot] = filtered; kept += filtered.length; }
    }
    return kept ? out : {};
}

/**
 * Unhide the item described by `alt`.
 * @param {{name:string, uuid?:string, quality?:string}} alt
 * @param {{pruneStore?:boolean}} [opts] pruneStore=true (default) prunes the
 *   live gearsets.hiddenAlternatives / gearset2HiddenAlternatives buckets and
 *   notifies subscribers so the popup + column-2 section update immediately.
 * @returns {string|null} the resolved item id, or null if it couldn't resolve.
 */
export function unhideAlt(alt, opts = {}) {
    const { pruneStore = true } = opts;
    if (!alt || !alt.name) return null;
    const itemId = _resolveItemId(alt.name, alt.uuid);
    if (!itemId) {
        api.showInfo && api.showInfo(`Could not resolve ${alt.name} to unhide.`);
        return null;
    }

    // Flip + persist — same write the column-1 eye toggle performs. A false
    // override wins over any base ui_config.items[id].hide=true via the merge.
    store.update(['ui', 'user_overrides', 'items', itemId, 'hide'], false);
    // Keep the in-memory item state in sync so the column-1 eye icon reflects
    // it without a reload, and fire the per-item notifier item-row listens on.
    try {
        if (store.state.items && store.state.items[itemId]) {
            store.state.items[itemId].hide = false;
        }
        store._notifySubscribers(`items.${itemId}`);
    } catch (_e) { /* best-effort */ }

    if (pruneStore) {
        const g = store.state.gearsets || {};
        if (g.hiddenAlternatives) {
            g.hiddenAlternatives = _pruneBucket(g.hiddenAlternatives, alt);
            store._notifySubscribers('gearsets.hiddenAlternatives');
        }
        if (g.gearset2HiddenAlternatives) {
            g.gearset2HiddenAlternatives = _pruneBucket(g.gearset2HiddenAlternatives, alt);
            store._notifySubscribers('gearsets.gearset2');
        }
    }

    api.showInfo && api.showInfo(`Unhid ${_baseName(alt.name)} — it'll rejoin the optimizer on the next run.`);
    return itemId;
}

export default { unhideAlt };
