/**
 * Inventory-slots helper.
 *
 * WalkScape's inventory holds ONE unique stack per slot. The number of slots a
 * pile of items consumes is therefore `ceil(count / stackSize)`, rounded UP and
 * never down (a partial stack still occupies a whole slot).
 *
 * Stack sizes (from the game):
 *   - Gear and tools (Item.*):        10 / stack
 *   - Pet eggs (Egg.*):                1 / stack
 *   - Consumables (Consumable.*):     20 / stack
 *   - Materials (Material.*):         25 / stack, UNLESS a keyword overrides:
 *        · "Heavy"        → 1 / stack
 *        · "Light"        → 1000 / stack
 *        · "Ultra light"  → 10000 / stack
 *   - Chests & collectibles (and currency): never enter the inventory → no slot
 *     (rendered as an em dash, no icon).
 *
 * Fine and normal variants of the same material do NOT stack together, so a
 * fine pile is counted as its own separate set of slots (the caller passes the
 * fine expected-count through `slotsForExpected` independently — see
 * calculator-section's drops table).
 *
 * Rules baked in here:
 *   - An expected item count of < 1.0 uses 0 inventory slots (you don't have a
 *     whole item yet, so nothing is stored).
 *   - Item types that never enter the inventory return `null` from
 *     `stackSizeForDrop`, and `slotsForExpected(..., null)` returns `null` so
 *     the caller shows an em dash.
 */

export const STACK_GEAR_TOOLS = 10;
export const STACK_EGG = 1;
export const STACK_CONSUMABLE = 20;
export const STACK_MATERIAL = 25;
export const STACK_MATERIAL_HEAVY = 1;
export const STACK_MATERIAL_LIGHT = 1000;
export const STACK_MATERIAL_ULTRA_LIGHT = 10000;

/**
 * Resolve the stack size for a drop object, or `null` when the item never
 * enters the inventory (chests, collectibles, currency) or its type can't be
 * recognised (unknown → em dash per product decision).
 *
 * Recognises the item type from the `item_ref` prefix (e.g. `Material.OAK_LOG`)
 * and falls back to an explicit `item_type` field when present. Material
 * keyword overrides come from `drop.item_keywords`.
 *
 * @param {Object} drop - Drop object (item_ref / item_type / item_keywords / source).
 * @returns {number|null} Stack size, or null for no-inventory / unknown items.
 */
export function stackSizeForDrop(drop) {
    if (!drop) return null;

    // Chests are surfaced with source:'chest' and often no item_ref — they
    // (and collectibles) never enter the inventory.
    if (drop.source === 'chest') return null;

    const ref = String(drop.item_ref || '');
    const refType = (ref.split('.')[0] || '').toLowerCase();
    const itemType = String(drop.item_type || '').toLowerCase();
    const type = refType || itemType;

    // No-inventory item types: chests, collectibles, currency (coins).
    if (type === 'collectible' || itemType === 'collectible') return null;
    if (type === 'container' || itemType === 'container') return null;
    if (type === 'currency' || itemType === 'currency') return null;

    if (type === 'egg' || itemType === 'egg') return STACK_EGG;

    // Gear + tools. `Item.*` in our ref space; `equipment`/`item` as item_type.
    if (type === 'item' || itemType === 'equipment' || itemType === 'item') return STACK_GEAR_TOOLS;

    if (type === 'consumable' || itemType === 'consumable') return STACK_CONSUMABLE;

    if (type === 'material' || itemType === 'material') {
        const kws = (drop.item_keywords || []).map(k => String(k).toLowerCase());
        // Check "ultra light" before "light" — the substrings differ but we
        // match whole keywords, so order only matters if both were present.
        if (kws.includes('ultra light')) return STACK_MATERIAL_ULTRA_LIGHT;
        if (kws.includes('light')) return STACK_MATERIAL_LIGHT;
        if (kws.includes('heavy')) return STACK_MATERIAL_HEAVY;
        return STACK_MATERIAL;
    }

    // Unknown type → treated as no-inventory (em dash) per product decision.
    return null;
}

/**
 * Number of inventory slots consumed by `expected` copies of an item with the
 * given `stackSize`.
 *
 * @param {number} expected - Expected item count.
 * @param {number|null} stackSize - Stack size from `stackSizeForDrop`.
 * @returns {number|null} Slots used (0 when expected < 1), or null when the
 *   item does not enter the inventory (stackSize null → em dash).
 */
export function slotsForExpected(expected, stackSize) {
    if (stackSize == null) return null;                 // em dash — no inventory
    if (!isFinite(expected) || expected < 1.0) return 0; // < 1 item → 0 slots
    return Math.ceil(expected / stackSize);
}

/**
 * Convenience: slots consumed by a drop's expected count in one call.
 * @param {Object} drop
 * @param {number} expected
 * @returns {number|null}
 */
export function slotsForDrop(drop, expected) {
    return slotsForExpected(expected, stackSizeForDrop(drop));
}

/**
 * Format a slot count for display: `null` → em dash, otherwise a localized
 * integer (honours the user's thousand separator via toLocaleString).
 * @param {number|null} slots
 * @returns {string}
 */
export function formatSlots(slots) {
    if (slots == null) return '—';
    return Math.round(slots).toLocaleString();
}
