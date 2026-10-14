/**
 * favorites-reorder.js
 *
 * Shared drag-to-reorder wiring for the "Favorites" category in the activity,
 * recipe, and combined selector dropdowns. Mirrors the proven HTML5-DnD +
 * touch-handle pattern used by travel-priority-list.js so it works on both
 * desktop (native drag) and touch (drag handle) devices.
 *
 * Rows that participate MUST carry `draggable="true"`, `data-fav-type`,
 * `data-fav-id`, and contain a `.fav-drag-handle`. They live inside a
 * `.favorites-category` container. Handlers are delegated on the dropdown's
 * root element (so they survive list re-renders) and are gated by isActive()
 * (edit mode). On drop/touchend the new DOM order is read and passed to
 * onReorder as an array of { type, id }.
 */

/**
 * @param {JQuery} $element - the dropdown root element (this.$element)
 * @param {Object} opts
 * @param {string} opts.ns - unique jQuery event namespace, e.g. '.favdrag-activity'
 * @param {() => boolean} opts.isActive - true when edit mode is on
 * @param {(orderedEntries: Array<{type:string,id:string}>) => void} opts.onReorder
 */
export function attachFavoritesDrag($element, opts) {
    const { ns, isActive, onReorder } = opts;
    const ITEM = '.favorites-category .activity-item[data-fav-id], .favorites-category .recipe-item[data-fav-id]';
    let dragged = null;

    const readOrder = () => {
        const order = [];
        $element.find(ITEM).each(function () {
            const $i = $(this);
            order.push({ type: $i.attr('data-fav-type'), id: $i.attr('data-fav-id') });
        });
        return order;
    };

    $element.off(ns);

    // ---- Desktop HTML5 drag-and-drop ----
    $element.on('dragstart' + ns, ITEM, function (e) {
        if (!isActive()) { e.preventDefault(); return; }
        dragged = this;
        $(this).addClass('fav-dragging');
        try { e.originalEvent.dataTransfer.effectAllowed = 'move'; } catch (_) { /* noop */ }
    });
    $element.on('dragend' + ns, ITEM, function () {
        if (dragged) $(dragged).removeClass('fav-dragging');
        dragged = null;
    });
    $element.on('dragover' + ns, ITEM, function (e) {
        if (!dragged || this === dragged) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (e.originalEvent.clientY < mid) $(this).before($(dragged));
        else $(this).after($(dragged));
    });
    $element.on('drop' + ns, ITEM, function (e) {
        e.preventDefault();
        if (!dragged) return;
        $(dragged).removeClass('fav-dragging');
        dragged = null;
        onReorder(readOrder());
    });

    // ---- Touch reorder via the drag handle (HTML5 dnd isn't touch-triggered) ----
    $element.on('touchstart' + ns, '.favorites-category .fav-drag-handle', function (e) {
        if (!isActive()) return;
        dragged = $(e.currentTarget).closest(ITEM)[0];
        if (dragged) $(dragged).addClass('fav-dragging');
    });
    $element.on('touchmove' + ns, function (e) {
        if (!dragged) return;
        e.preventDefault();
        const y = e.originalEvent.touches[0].clientY;
        $element.find(ITEM).not('.fav-dragging').each(function () {
            const r = this.getBoundingClientRect();
            if (y >= r.top && y <= r.bottom) {
                const mid = r.top + r.height / 2;
                if (y < mid) $(this).before($(dragged)); else $(this).after($(dragged));
                return false;
            }
        });
    });
    $element.on('touchend' + ns + ' touchcancel' + ns, function () {
        if (!dragged) return;
        $(dragged).removeClass('fav-dragging');
        dragged = null;
        onReorder(readOrder());
    });
}
