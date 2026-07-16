/**
 * slot-reorder.js
 *
 * Pure, dependency-free helpers for reordering equipment slots within a group
 * (tools and rings) in Column 2's gear-slot grid. Shared by the UI component
 * (gear-slot-grid.js) and the state store (state.js) so the grouping/swap
 * semantics are defined in exactly one place and unit-tested directly.
 *
 * Only tools and rings are reorderable. Reordering simply exchanges the item
 * contents of two slots in the same group, so the gearset object (and therefore
 * the Save / Export buttons, which read from it) reflects the new order
 * immediately.
 */

// Slot groups that support reordering. Keep `tools` in sync with
// GearSlotGrid.TOOL_SLOTS and `rings` with the ring slots in GEAR_SLOTS.
export const REORDER_GROUPS = {
    tools: ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'],
    rings: ['ring1', 'ring2'],
};

/**
 * Classify a slot into its reorder group.
 * @param {string} slot - Slot identifier (e.g. 'tool0', 'ring1', 'head')
 * @returns {('tools'|'rings'|null)} The group, or null if the slot is not reorderable.
 */
export function getSlotGroup(slot) {
    if (typeof slot !== 'string') return null;
    if (REORDER_GROUPS.tools.includes(slot)) return 'tools';
    if (REORDER_GROUPS.rings.includes(slot)) return 'rings';
    return null;
}

/**
 * Compute the valid move targets for a source slot: every other slot in the
 * same group that is not level-locked. (Locked tool slots cannot receive items.)
 *
 * @param {string} sourceSlot - The slot being picked up.
 * @param {function(string): boolean} [isSlotLocked] - Predicate returning true
 *        if a slot is locked/unavailable. Defaults to "never locked".
 * @returns {string[]} Array of valid target slot identifiers (excludes the source).
 */
export function getValidMoveTargets(sourceSlot, isSlotLocked = () => false) {
    const group = getSlotGroup(sourceSlot);
    if (!group) return [];
    return REORDER_GROUPS[group].filter(
        (s) => s !== sourceSlot && !isSlotLocked(s)
    );
}

/**
 * Compute the result of swapping the contents of two slots in a gearset map.
 * Returns only the two changed entries (missing/undefined values normalize to
 * null, matching the empty-slot convention used throughout the gearset state).
 *
 * @param {Object} map - The gearset slot->item map.
 * @param {string} a - First slot identifier.
 * @param {string} b - Second slot identifier.
 * @returns {Object} An object with keys `a` and `b` holding their swapped values.
 */
export function computeSwap(map, a, b) {
    const m = map || {};
    const av = m[a] != null ? m[a] : null;
    const bv = m[b] != null ? m[b] : null;
    return { [a]: bv, [b]: av };
}

/**
 * Swap the per-slot alternatives lists for two slots within a slot->alternatives
 * map (the `alternatives` / `lockedAlternatives` structures, each keyed by slot
 * with an array of upgrade-suggestion entries). Used so that reordering rings or
 * tools carries each slot's non-owned/locked upgrade suggestions along with the
 * item, instead of discarding the whole cache and forcing a full re-optimize.
 * Every slot other than `a` and `b` is preserved untouched.
 *
 * Each alternative entry carries its own `slot` field (e.g. 'ring1'); moved
 * entries have that field rewritten to their new slot so the data stays
 * self-consistent with its key. Returns a shallow-cloned map (the input is not
 * mutated). If a source slot has no entry, the destination key is removed so it
 * does not linger with stale suggestions. Returns the input unchanged when it is
 * falsy, when `a === b`, or when neither slot has any entry.
 *
 * @param {Object|null} map - slot -> array-of-alternative-entries.
 * @param {string} a - First slot identifier.
 * @param {string} b - Second slot identifier.
 * @returns {Object|null} A new map with slots `a` and `b` swapped, or the
 *          original value if `map` is falsy / nothing to swap.
 */
export function computeAlternativesSwap(map, a, b) {
    if (!map || a === b) return map;
    const hasA = Object.prototype.hasOwnProperty.call(map, a);
    const hasB = Object.prototype.hasOwnProperty.call(map, b);
    if (!hasA && !hasB) return map;

    const retag = (list, newSlot) =>
        Array.isArray(list)
            ? list.map((entry) =>
                  entry && typeof entry === 'object' && !Array.isArray(entry)
                      ? { ...entry, slot: newSlot }
                      : entry
              )
            : list;

    const result = { ...map };
    const aVal = hasA ? map[a] : undefined;
    const bVal = hasB ? map[b] : undefined;

    // b's list moves into a (retagged to a) and vice versa.
    if (hasB) result[a] = retag(bVal, a);
    else delete result[a];
    if (hasA) result[b] = retag(aVal, b);
    else delete result[b];

    return result;
}
