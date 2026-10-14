/**
 * Consumable duration display helper.
 *
 * WalkScape consumables apply their buff for a fixed number of steps
 * (`duration` on the catalog entry; `duration_fine` for the Fine variant).
 * This helper renders a small "Active for X steps" line so the duration is
 * visible wherever a consumable is shown:
 *   - the slot-selection popup browse rows (item-selection-popup renderStatsPreview)
 *   - the currently-equipped consumable view in that popup
 *   - the owned-items rows in column 2 (item-row)
 *
 * Step counts go through the (separator-patched) Number.prototype.toLocaleString
 * so they honor the user's chosen thousand separator, matching every other
 * number in the UI.
 *
 * @param {Object} item - Catalog-shaped item (needs type/slot + duration).
 * @param {Object} [opts]
 * @param {'normal'|'fine'} [opts.variant] - Force a single-variant line for
 *        contexts that render one specific variant per row (the popup). When
 *        omitted, a combined row (owned items) shows the normal line plus a
 *        Fine line when the Fine variant lasts a different number of steps.
 * @returns {string} HTML string (empty when not a consumable or no duration).
 */
export function consumableDurationHtml(item, opts = {}) {
    if (!item) return '';

    const isConsumable = item.type === 'consumable'
        || item.slot === 'consumable'
        || item.slot === 'consumables';
    if (!isConsumable) return '';

    const toSteps = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    const normal = toSteps(item.duration);
    const fine = toSteps(item.duration_fine);

    const line = (steps, isFine) =>
        `<div class="consumable-duration${isFine ? ' consumable-duration-fine' : ''}"`
        + `${isFine ? ' style="color:var(--fine-color)"' : ''}>`
        + `Active for ${steps.toLocaleString()} steps${isFine ? ' (Fine)' : ''}</div>`;

    // Single-variant contexts (popup browse rows + equipped view). The Fine
    // popup entry is a distinct row flagged is_fine, so treat that as fine too.
    if (opts.variant === 'fine' || (opts.variant == null && item.is_fine)) {
        const d = fine != null ? fine : normal;
        return d != null ? line(d, false) : '';
    }
    if (opts.variant === 'normal') {
        return normal != null ? line(normal, false) : '';
    }

    // Combined context (owned-items column 2): normal line, plus a Fine line
    // only when the Fine variant's duration actually differs.
    const lines = [];
    if (normal != null) lines.push(line(normal, false));
    if (fine != null && fine !== normal) lines.push(line(fine, true));
    return lines.join('');
}
