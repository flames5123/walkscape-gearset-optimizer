/**
 * Tool Keyword Validation
 * 
 * Enforces the game's keyword uniqueness rules for tool slots:
 * - Only one tool per non-excluded keyword (e.g., one "Smithing hammer", one "Pickaxe")
 * - Banned keyword groups: only one tool from any keyword in the group
 *   (e.g., "Fishing rod" and "Fishing net" are mutually exclusive)
 * 
 * These mirror the Python constants in util/walkscape_constants.py.
 * See: https://wiki.walkscape.app/wiki/Keywords/en
 */

// Keywords that CAN be shared between tools (no uniqueness constraint).
// These are categorization keywords, not "banned" keywords.
// Note: "foraging tool" and "fishing tool" are BANNED (not listed here).
const EXCLUDED_TOOL_KEYWORDS = new Set([
    'regional',
    'tool',
    'light source',
    'achievement reward',
    'faction reward',
    'activity tool',
    'crafting tool',
    'smithing tool',
    'woodcutting tool',
    'mining tool',
    'carpentry tool',
    'cooking tool',
    'adventuring tool set',
    'spectral',
    'tailoring tool',
    'skydisc',  // Activity keyword (not banned) - multiple skydiscs allowed
    'upgradeable',  // Categorization (marks an upgradeable tool); NOT banned —
    'upgradable',   // multiple upgradeable tools (Log splitter + Log basket, etc.)
                    // can be equipped together. See bug dd4b6aea.
    // --- tools-API migration categorization keywords (skill / skill-category
    // / location / while-travelling scopes). NOT uniqueness constraints --
    // multiple tools may share them (e.g. Fishing rod + Comfy fishing chair
    // both carry 'fishing'). Mirrors util/walkscape_constants.py.
    'agility', 'carpentry', 'cooking', 'crafting', 'fishing', 'foraging',
    'hunting', 'mining', 'smithing', 'tailoring', 'trinketry', 'woodcutting',
    'gathering', 'artisan', 'utility',
    'travelling', 'traveling',
    'jarvonia', 'erdwise', 'trellin', 'syrenthia', 'halfling rebels',
    'gdte', 'swamp',
    // Remaining non-banned equipment + location + gear-set keywords per the
    // wiki Keywords page. Mirrors util/walkscape_constants.py. Banned keywords
    // (Hatchet, Pickaxe, Sickle, Saw, Chisel, Wrench, Needle, Scissors, the
    // Fishing* group, etc.) are intentionally absent.
    'amulet', 'aquatic', 'cooking pot', 'cutting board', 'ring', 'screwdriver',
    'shield', 'skill book', 'skis', 'socks', 'spices', 'water', 'weapon',
    'desert', 'ghostly', 'snowy', 'underwater',
    'diving gear', 'diving gear set', 'advanced diving gear',
    'advanced diving gear set', 'expert diving gear', 'expert diving gear set',
    'proper gear', 'proper gear set', 'treasure hunter set',
]);

// Banned keyword groups — only ONE item from ANY keyword in the group
// can be equipped at a time. Each array is a mutually exclusive group.
const BANNED_KEYWORD_GROUPS = [
    new Set(['fishing rod', 'fishing net', 'fishing cage', 'fishing spear']),
];

/**
 * Check if equipping a tool in a given slot would violate keyword uniqueness.
 *
 * Also blocks equipping the SAME item (by itemId) in multiple tool slots —
 * keyword-only validation lets items with all-excluded keywords (e.g.
 * omni_tool with only "Achievement reward") or empty keyword arrays slip
 * through and end up in two slots at once. See bug 88a427a8.
 *
 * @param {Object} newItem - The item being equipped (must have .keywords array)
 * @param {string} targetSlot - The slot being equipped to (e.g., "tool0")
 * @param {Object} currentGear - The current gearset object { tool0: item, tool1: item, ... }
 * @returns {{ valid: boolean, conflictKeyword: string|null, conflictItem: string|null }}
 */
export function validateToolKeyword(newItem, targetSlot, currentGear) {
    if (!newItem || !targetSlot.startsWith('tool')) {
        return { valid: true, conflictKeyword: null, conflictItem: null };
    }

    // 1) Same-item check: itemId must be unique across tool slots regardless of keywords.
    const newItemId = newItem.itemId || newItem.id;
    if (newItemId) {
        for (const [slot, equippedItem] of Object.entries(currentGear)) {
            if (!slot.startsWith('tool')) continue;
            if (slot === targetSlot) continue;
            if (!equippedItem) continue;
            const equippedItemId = equippedItem.itemId || equippedItem.id;
            if (equippedItemId && equippedItemId === newItemId) {
                return {
                    valid: false,
                    conflictKeyword: 'duplicate item',
                    conflictItem: equippedItem.name || newItem.name,
                };
            }
        }
    }

    // 2) Keyword-based conflict check.
    if (!newItem.keywords) {
        return { valid: true, conflictKeyword: null, conflictItem: null };
    }

    const newKeywords = newItem.keywords.map(kw => kw.toLowerCase());

    // Collect keywords from all OTHER equipped tools
    for (const [slot, equippedItem] of Object.entries(currentGear)) {
        if (!slot.startsWith('tool')) continue;
        if (slot === targetSlot) continue;  // Skip the slot we're replacing
        if (!equippedItem || !equippedItem.keywords) continue;

        const equippedKeywords = equippedItem.keywords.map(kw => kw.toLowerCase());

        for (const newKw of newKeywords) {
            if (EXCLUDED_TOOL_KEYWORDS.has(newKw)) continue;

            // Check banned keyword groups
            for (const group of BANNED_KEYWORD_GROUPS) {
                if (group.has(newKw)) {
                    // Check if the equipped item has ANY keyword from this group
                    for (const eqKw of equippedKeywords) {
                        if (group.has(eqKw)) {
                            return {
                                valid: false,
                                conflictKeyword: `${newKw} / ${eqKw}`,
                                conflictItem: equippedItem.name,
                            };
                        }
                    }
                }
            }

            // Check direct keyword conflict
            if (equippedKeywords.includes(newKw)) {
                return {
                    valid: false,
                    conflictKeyword: newKw,
                    conflictItem: equippedItem.name,
                };
            }
        }
    }

    return { valid: true, conflictKeyword: null, conflictItem: null };
}

/**
 * Validate an entire gearset's tool slots for keyword conflicts.
 * Used for import/load validation.
 *
 * Also flags duplicate itemIds across tool slots — see {@link validateToolKeyword}
 * for rationale (bug 88a427a8).
 *
 * @param {Object} gearset - The full gearset { tool0: item, tool1: item, ... }
 * @returns {{ valid: boolean, conflicts: Array<{slot: string, keyword: string, otherSlot: string}> }}
 */
export function validateAllToolKeywords(gearset) {
    const conflicts = [];
    const seenKeywords = {};      // keyword -> { slot, itemName }
    const usedGroups = {};        // groupIndex -> { slot, itemName, keyword }
    const seenItemIds = {};       // itemId -> { slot, itemName }

    for (const [slot, item] of Object.entries(gearset)) {
        if (!slot.startsWith('tool')) continue;
        if (!item) continue;

        // Same-item check: itemId must be unique across tool slots.
        const itemId = item.itemId || item.id;
        if (itemId) {
            if (seenItemIds[itemId]) {
                conflicts.push({
                    slot,
                    itemName: item.name,
                    keyword: 'duplicate item',
                    otherSlot: seenItemIds[itemId].slot,
                    otherItemName: seenItemIds[itemId].itemName,
                    otherKeyword: 'duplicate item',
                });
            } else {
                seenItemIds[itemId] = { slot, itemName: item.name };
            }
        }

        if (!item.keywords) continue;

        // Track banned groups already claimed by THIS slot. A single tool can
        // legitimately carry multiple keywords from the same banned group
        // (e.g. Spectral fishing cagespear has both 'Fishing cage' and
        // 'Fishing spear') — it should only conflict with OTHER slots.
        const slotGroups = new Set();

        for (const rawKw of item.keywords) {
            const kw = rawKw.toLowerCase();
            if (EXCLUDED_TOOL_KEYWORDS.has(kw)) continue;

            // Check banned keyword groups
            for (let gi = 0; gi < BANNED_KEYWORD_GROUPS.length; gi++) {
                const group = BANNED_KEYWORD_GROUPS[gi];
                if (group.has(kw)) {
                    if (usedGroups[gi] && !slotGroups.has(gi)) {
                        conflicts.push({
                            slot,
                            itemName: item.name,
                            keyword: kw,
                            otherSlot: usedGroups[gi].slot,
                            otherItemName: usedGroups[gi].itemName,
                            otherKeyword: usedGroups[gi].keyword,
                        });
                    } else if (!slotGroups.has(gi)) {
                        usedGroups[gi] = { slot, itemName: item.name, keyword: kw };
                    }
                    slotGroups.add(gi);
                    break;
                }
            }

            // Check individual keyword conflict
            if (seenKeywords[kw]) {
                conflicts.push({
                    slot,
                    itemName: item.name,
                    keyword: kw,
                    otherSlot: seenKeywords[kw].slot,
                    otherItemName: seenKeywords[kw].itemName,
                    otherKeyword: kw,
                });
            } else {
                seenKeywords[kw] = { slot, itemName: item.name };
            }
        }
    }

    return { valid: conflicts.length === 0, conflicts };
}
