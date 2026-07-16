/**
 * Owned-quantity helper.
 *
 * Single source of truth for the "N owned" label shown in the column-1
 * expanded item row and in the drop/crafting-tree/notepad hover popovers.
 *
 * Data source: `store.state.character.owned_quantities` — a map of
 * `item_id -> total quantity owned` (inventory + bank + gear, summed across
 * qualities), built server-side in app.py. Fine variants live under a
 * separate `${item_id}_fine` key.
 *
 * Gating: the label is only meaningful once a character has been imported.
 * We treat a non-empty map as the "imported" signal (matching the existing
 * recipe-info material-tile logic); under that condition a missing key
 * legitimately means 0 owned. When no character is imported (empty/absent
 * map) we return '' so unimported sessions don't show "0 owned" everywhere.
 *
 * @param {Object|null} ownedQuantities - character.owned_quantities map
 * @param {string|null} itemId - canonical item id (slug) to look up
 * @param {Object} [opts]
 * @param {boolean} [opts.fine=false] - look up the Fine variant (`${id}_fine`)
 * @returns {string} e.g. "3 owned", or '' when there's no character/id
 */
export function ownedCountLabel(ownedQuantities, itemId, opts = {}) {
    if (!itemId) return '';
    if (!ownedQuantities || Object.keys(ownedQuantities).length === 0) return '';
    const key = opts.fine ? `${itemId}_fine` : itemId;
    const n = ownedQuantities[key] || 0;
    return `${n} owned`;
}
