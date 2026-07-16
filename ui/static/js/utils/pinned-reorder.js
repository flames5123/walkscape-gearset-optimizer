/**
 * pinned-reorder.js — Pure array reorder used by drag-and-drop + keyboard.
 *
 * Semantics match the standard "move index `from` so it is placed at position
 * `to` in the resulting array":
 *   - from === to  → returns a shallow copy of `arr` (identity-like op).
 *   - from < to    → insertAt = to - 1 to account for the removal shift.
 *   - from > to    → insertAt = to.
 *
 * Pure — no mutation of inputs, no global state, no exceptions for equal
 * endpoints. Throws RangeError only on truly out-of-range indices.
 */

export function reorder(arr, from, to) {
    if (!Array.isArray(arr)) {
        throw new TypeError('arr must be an array');
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
        throw new TypeError('from and to must be integers');
    }
    if (from < 0 || from >= arr.length) {
        throw new RangeError('from out of range');
    }
    if (to < 0 || to > arr.length) {
        throw new RangeError('to out of range');
    }
    if (from === to) return arr.slice();
    const out = arr.slice();
    const [item] = out.splice(from, 1);
    const insertAt = to > from ? to - 1 : to;
    out.splice(insertAt, 0, item);
    return out;
}

export default { reorder };
