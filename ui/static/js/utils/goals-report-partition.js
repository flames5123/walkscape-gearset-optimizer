/**
 * Goals-report "Include unavailable" render partitioning helpers.
 *
 * Pure functions (no DOM) so they can be unit-tested under node. The worker
 * writes `gear_gated: true` into a result row's metrics_json for activities
 * surfaced only because the user enabled the "By Gear" dimension AND the
 * activity needs a gear-keyword the player can't satisfy from owned gear.
 * Those rows render in a separate bottom "Possible with more gear" sub-section
 * with no rank badge (their ranking is meaningless until the gear is owned).
 */

/**
 * True if a result row was flagged gear_gated by the worker. Tolerant of
 * metrics_json being a JSON string, an object, or absent.
 * @param {Object} row
 * @returns {boolean}
 */
export function rowGearGated(row) {
    if (!row) return false;
    let mj = row.metrics_json;
    if (typeof mj === 'string') {
        try { mj = JSON.parse(mj); } catch (_) { return false; }
    }
    return !!(mj && mj.gear_gated);
}

/**
 * Split rows into { normal, gearGated }, preserving order within each bucket
 * (the backend already sorts by score, so gear-gated rows arrive best-first).
 * @param {Array<Object>} rows
 * @returns {{normal: Array<Object>, gearGated: Array<Object>}}
 */
export function partitionGearGated(rows) {
    const normal = [];
    const gearGated = [];
    for (const r of (rows || [])) {
        (rowGearGated(r) ? gearGated : normal).push(r);
    }
    return { normal, gearGated };
}
