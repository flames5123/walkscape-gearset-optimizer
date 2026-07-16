/**
 * Resolve the icon path for any drop / item / collectible / egg /
 * container / material / consumable.
 *
 * Mirrors the canonical pattern in `components/drops-section.js`
 * (resolveDropIcon) which the column-3 drops list has been using
 * forever — but extracted into a single helper so callers don't
 * keep re-implementing it (and getting the slug normalization
 * subtly wrong).
 *
 * Two key gotchas the bare `Item.X.toLowerCase()` slug shortcut
 * gets wrong:
 *
 *   1. Eggs live at `/assets/icons/items/pet_eggs/`, NOT
 *      `/assets/icons/items/eggs/`. (The folder name is historic.)
 *
 *   2. Apostrophes and hyphens are PRESERVED in the filename, but
 *      they're stripped from the .item_ref slug. E.g.
 *        item_name: "Lost Timmy's sand shovel"
 *        item_ref:  "Collectible.LOST_TIMMYS_SAND_SHOVEL"
 *      The actual file is `lost_timmy's_sand_shovel.svg`. So we
 *      derive the icon slug from item_name (lowercase + spaces→_),
 *      not from the ref. Same problem for "99-year-old wine".
 *
 * Bug history: jwbail 2026-05-25 reported eggs and collectibles
 * not showing in the new_items section. Root cause: stats-report-page
 * was building paths from item_ref alone (LOST_TIMMYS_SAND_SHOVEL →
 * lost_timmys_sand_shovel) and pointing eggs at `/eggs/` (didn't
 * exist). This helper fixes both.
 *
 * @param {object} args
 * @param {string} args.itemRef  - e.g. 'Item.PARKOUR_GLOVES',
 *                                 'Collectible.LOST_TIMMYS_SAND_SHOVEL',
 *                                 'Egg.MUMMY_EGG'.
 * @param {string} [args.itemName] - Display name; preferred for slug
 *                                   derivation when present (preserves
 *                                   apostrophes / hyphens).
 * @param {string} [args.fallback] - Path to use when ref is missing or
 *                                   unrecognized. Empty string => let
 *                                   the caller's onerror handler hide
 *                                   the img.
 * @returns {string} URL to the SVG, or the fallback (default '').
 */
export function resolveItemIcon({ itemRef, itemName, fallback = '' } = {}) {
    // Derive slug from item_name when available (preserves '/-/').
    // Fall back to the ref's tail when item_name is empty.
    const slugFromName = (itemName || '').trim().toLowerCase().replace(/ /g, '_');
    const refStr = String(itemRef || '');
    const refParts = refStr.split('.');
    const refTail = refParts.length === 2
        ? String(refParts[1] || '').toLowerCase()
        : '';
    const slug = slugFromName || refTail;
    if (!slug) return fallback;

    const type = refParts.length === 2 ? refParts[0] : '';

    switch (type) {
        case 'Item':
            return `/assets/icons/items/equipment/${slug}.svg`;
        case 'Collectible':
            return `/assets/icons/items/collectibles/${slug}.svg`;
        case 'Egg':
            // Folder name is `pet_eggs`, NOT `eggs`. Easy footgun.
            return `/assets/icons/items/pet_eggs/${slug}.svg`;
        case 'Material':
            return `/assets/icons/items/materials/${slug}.svg`;
        case 'Consumable':
            return `/assets/icons/items/consumables/${slug}.svg`;
        case 'Container':
            return `/assets/icons/items/containers/${slug}.svg`;
        case 'Currency':
            // Currencies (Coins) live at the top-level items dir.
            return `/assets/icons/items/${slug}.svg`;
        default:
            // Unknown type — try the equipment path as a best guess
            // and let the caller's onerror handler hide the img if
            // the file doesn't exist. Preferable to returning ''
            // because for many drops we DO have an equipment icon
            // even when the ref type is missing.
            if (slug.endsWith('_egg')) {
                return `/assets/icons/items/pet_eggs/${slug}.svg`;
            }
            return fallback || `/assets/icons/items/equipment/${slug}.svg`;
    }
}
