/**
 * split-clamp.js — Shared panel-split clamp utility.
 *
 * Used by both the Travel Config panel and the Pinned Container to clamp
 * panel-split percentages into the valid [SPLIT_MIN, SPLIT_MAX] range.
 *
 * Pure — no DOM, no globals. Safe to unit-test with Node + fast-check.
 */

export const SPLIT_MIN = 10;
export const SPLIT_MAX = 90;

/**
 * Clamp a split percentage to [SPLIT_MIN, SPLIT_MAX].
 *
 * `NaN` and non-numeric inputs return the midpoint so a partial drag that
 * produces garbage doesn't corrupt the panel split.
 * `±Infinity` clamps to the corresponding bound, matching the historical
 * `Math.max(min, Math.min(max, pct))` behavior in TravelConfigPage.
 *
 * @param {number} pct - Requested split percentage.
 * @returns {number} Clamped percentage in [SPLIT_MIN, SPLIT_MAX].
 */
export function clampSplit(pct) {
    const n = Number(pct);
    if (Number.isNaN(n)) {
        return (SPLIT_MIN + SPLIT_MAX) / 2;
    }
    return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, n));
}

export default { SPLIT_MIN, SPLIT_MAX, clampSplit };
