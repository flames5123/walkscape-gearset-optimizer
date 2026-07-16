/**
 * GranularityPicker — floating Up / Down / Confirm buttons during Pin Selection.
 *
 * Positions itself at viewport top or bottom based on where the target sits,
 * so it never occludes the element being selected. Listens to window resize
 * and scroll to keep itself positioned.
 */

export default class GranularityPicker {
    /**
     * @param {Object} opts
     * @param {Function} opts.onUp       Called when Up pressed.
     * @param {Function} opts.onDown     Called when Down pressed.
     * @param {Function} opts.onConfirm  Called when Confirm pressed.
     */
    constructor({ onUp, onDown, onConfirm }) {
        this.onUp = onUp || (() => { });
        this.onDown = onDown || (() => { });
        this.onConfirm = onConfirm || (() => { });
        this.$el = null;
        this._targetEl = null;
        this._scrollHandler = null;
        this._resizeHandler = null;
    }

    mount() {
        if (this.$el) return;
        const $el = $(`
            <div class="pin-granularity-picker" role="toolbar" aria-label="Pin granularity controls">
                <button type="button" class="pin-up-btn" aria-label="Move pin target up">▲</button>
                <button type="button" class="pin-down-btn" aria-label="Move pin target down">▼</button>
                <button type="button" class="pin-confirm-btn" aria-label="Confirm pin">✓</button>
            </div>
        `);
        $('body').append($el);
        this.$el = $el;

        $el.find('.pin-up-btn').on('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onUp(); });
        $el.find('.pin-down-btn').on('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onDown(); });
        $el.find('.pin-confirm-btn').on('click', (e) => { e.preventDefault(); e.stopPropagation(); this.onConfirm(); });

        this._scrollHandler = () => this._reposition();
        this._resizeHandler = () => this._reposition();
        window.addEventListener('scroll', this._scrollHandler, true);
        window.addEventListener('resize', this._resizeHandler);
    }

    unmount() {
        if (!this.$el) return;
        if (this._scrollHandler) window.removeEventListener('scroll', this._scrollHandler, true);
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        this.$el.remove();
        this.$el = null;
        this._targetEl = null;
    }

    setTarget(el) {
        this._targetEl = el || null;
        this._reposition();
    }

    _reposition() {
        if (!this.$el) return;
        if (!this._targetEl) {
            this.$el.css({ display: 'none' });
            return;
        }
        this.$el.css({ display: 'flex' });

        const rect = this._targetEl.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const pickerRect = this.$el[0].getBoundingClientRect();
        const pickerW = pickerRect.width || 180;
        const pickerH = pickerRect.height || 56;
        const GAP = 8;
        const EDGE_MARGIN = 8;

        // Prefer placing the picker DIRECTLY ABOVE the target (closer to
        // the user's pointer / attention). If there's not enough room
        // above, place it BELOW. Clamp to viewport edges as a last
        // resort so the picker is never off-screen.
        let top;
        let placeAbove = rect.top - pickerH - GAP >= EDGE_MARGIN;
        if (placeAbove) {
            top = Math.round(rect.top - pickerH - GAP);
            this.$el.attr('data-edge', 'above');
        } else {
            // Try below
            const belowTop = rect.bottom + GAP;
            if (belowTop + pickerH + EDGE_MARGIN <= vh) {
                top = Math.round(belowTop);
                this.$el.attr('data-edge', 'below');
            } else {
                // Neither fits — pin to whichever edge is closer.
                if (rect.top > vh - rect.bottom) {
                    top = EDGE_MARGIN;
                    this.$el.attr('data-edge', 'above');
                } else {
                    top = vh - pickerH - EDGE_MARGIN;
                    this.$el.attr('data-edge', 'below');
                }
            }
        }

        // Horizontal: center on the target, clamped to the viewport.
        const targetCenterX = rect.left + rect.width / 2;
        let left = Math.round(targetCenterX - pickerW / 2);
        left = Math.max(EDGE_MARGIN, Math.min(vw - pickerW - EDGE_MARGIN, left));

        this.$el.css({
            position: 'fixed',
            left: `${left}px`,
            top: `${top}px`,
            bottom: 'auto',
        });
    }
}
