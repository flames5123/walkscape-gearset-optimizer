/**
 * PinnedContainer — the top-of-viewport panel that holds Pinned Items.
 *
 * Lifecycle: mounted only when Pin State is non-empty. Insert point is
 * immediately after `</header>` and before `<nav.mobile-tabs>`.
 *
 * Reuses travel-config-panel semantics: tap toggle tab to collapse/expand,
 * drag toggle tab to resize (clamped via utils/split-clamp.js). Persistence
 * handled by the controller.
 */

import { clampSplit } from '../utils/split-clamp.js';

const DRAG_THRESHOLD_PX = 8;

export default class PinnedContainer {
    /**
     * @param {Object} opts
     * @param {Function} opts.onResize        Called with (pct: number) when user drags the tab.
     * @param {Function} opts.onCollapseToggle Called with (collapsed: bool) on tap.
     * @param {Function} opts.onClearAll      Called when user confirms Clear All.
     * @param {Function} opts.onReorder       Called with (fromIdx, toIdx) after drag-drop.
     * @param {Function} opts.onUnpin         Called with (pathKey) to remove a pinned item.
     * @param {Function} opts.onReorderKey    Called with (idx, direction 'up'|'down') for keyboard reorder.
     */
    constructor(opts = {}) {
        this.opts = opts;
        this.$el = null;
        this._dragStart = null;     // {y, pct, pointerId, moved}
        this._rowDrag = null;       // {idx, fromY, startY}
        this._clearPending = false;
        this._clearPendingTimer = null;
    }

    /**
     * Mount the container into the DOM (if not already mounted).
     * Inserted after <header> and before <nav.mobile-tabs>.
     */
    mount() {
        if (this.$el) return;
        const html = `
            <div id="pinned-container" role="region" aria-label="Pinned Items">
                <div class="pinned-container-body">
                    <div class="pin-mode-banner" role="status" hidden>
                        Pin Selection Mode — click or tap to select, use ▲ / ▼ to refine, ✓ to pin, Escape to cancel.
                    </div>
                    <div class="pinned-saves-preset-bar"></div>
                    <div class="pinned-items-list"></div>
                    <div class="pinned-container-footer">
                        <button class="button pin-clear-all-btn" type="button" data-pending="false">Clear All Pins</button>
                    </div>
                </div>
                <div class="pinned-bottom-collapse-tab" id="pinned-bottom-collapse-tab" role="button" aria-label="Drag to resize, tap to collapse pin section" tabindex="0" title="Drag to resize, tap to collapse">
                    <span class="pin-grip-bars">≡</span>
                    <span class="pin-collapse-label">▼ Pin Section</span>
                    <span class="pin-grip-bars">≡</span>
                </div>
            </div>
        `;
        const $el = $(html);

        // Insert after header, before the mobile tabs.
        const $header = $('header').first();
        if ($header.length) {
            $header.after($el);
        } else {
            $('body').prepend($el);
        }
        this.$el = $el;
        document.body.classList.add('has-pinned-container');
        this._attachEvents();
        // Immediately sync the --pinned-container-height CSS variable.
        this._syncHeightVar();
    }

    unmount() {
        if (!this.$el) return;
        document.body.classList.remove('has-pinned-container');
        document.documentElement.style.setProperty('--pinned-container-height', '0px');
        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
            this._resizeListener = null;
        }
        this.$el.addClass('unmounting');
        const el = this.$el;
        setTimeout(() => el.remove(), 220);
        this.$el = null;
    }

    get isMounted() { return !!this.$el; }

    /** Render the list of pinned items. Each entry is { pathKey, node, unresolved }. */
    renderItems(entries) {
        if (!this.$el) return;
        const $list = this.$el.find('.pinned-items-list');
        $list.empty();

        for (const entry of entries) {
            const $item = $(`
                <div class="pinned-item ${entry.unresolved ? 'unresolved' : ''}" data-pin-key="${_escape(entry.pathKey)}">
                    <button type="button" class="drag-handle" aria-label="Reorder pinned item" tabindex="0">≡</button>
                    <div class="pinned-item-mirror"></div>
                    <button type="button" class="unpin-btn" aria-label="Unpin">×</button>
                </div>
            `);
            if (entry.node) {
                $item.find('.pinned-item-mirror').append(entry.node);
            }
            if (entry.label) {
                $item.attr('aria-label', entry.label);
            }
            $list.append($item);
        }
    }

    /** Show/hide the inline banner. */
    setBannerVisible(visible) {
        if (!this.$el) return;
        this.$el.find('.pin-mode-banner').attr('hidden', visible ? null : 'hidden');
    }

    /** Apply a split-percentage height (clamped). */
    applySplit(pct) {
        if (!this.$el) return;
        const clamped = clampSplit(pct);
        // Height in px based on vh so the CSS variable for main-content push
        // stays pixel-accurate (matches what `calc(...vh)` resolves to).
        const vh = window.innerHeight || 800;
        const px = Math.round((clamped / 100) * vh);
        this.$el.css('height', `${px}px`);
        this._currentSplit = clamped;
        this._syncHeightVar();
    }

    /** Set collapsed state (true => hide body). */
    setCollapsed(collapsed) {
        if (!this.$el) return;
        if (collapsed) {
            this.$el.addClass('collapsed');
        } else {
            this.$el.removeClass('collapsed');
        }
        this._collapsed = collapsed;
        this._syncHeightVar();
    }

    /**
     * Set fully-collapsed state (true => everything except the pill is
     * hidden, with a smooth height animation). Uses a brief CSS transition
     * so the collapse/expand feels like the travel config panel.
     */
    setFullyCollapsed(fullyCollapsed) {
        if (!this.$el) return;
        if (fullyCollapsed === this._fullyCollapsed) return;

        const el = this.$el[0];

        // Pin the current rendered height to a fixed pixel value before we
        // animate. Browsers only transition height when both start and
        // end values are explicit pixels (not `auto`).
        const currentHeightPx = el.getBoundingClientRect().height;
        const targetPx = fullyCollapsed
            ? 0
            : Math.round((this.currentSplit / 100) * (window.innerHeight || 800));

        // Apply the starting height with no transition, then force a
        // reflow so the browser commits it.
        el.style.transition = 'none';
        el.style.height = `${currentHeightPx}px`;
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;

        // Flip the class immediately so body-hide etc. apply during the
        // animation (body fades along with the height).
        if (fullyCollapsed) {
            this.$el.addClass('fully-collapsed');
        } else {
            this.$el.removeClass('fully-collapsed');
        }

        // Immediately set the CSS variable to the TARGET height. Since
        // `.main-content` has `transition: margin-top 0.25s ease`, it
        // will animate its own margin in sync with our container's
        // height animation — both reach the target in 250ms.
        document.documentElement.style.setProperty('--pinned-container-height', `${targetPx}px`);

        // Double-rAF so the browser commits the "no transition + explicit
        // start height" state before we apply the "transition + target
        // height" state. Without the double rAF, both style changes land
        // in the same layout pass and the animation doesn't run.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!this.$el || this.$el[0] !== el) return;
                el.style.transition = 'height 0.25s ease';
                el.style.height = `${targetPx}px`;
            });
        });

        this._fullyCollapsed = fullyCollapsed;
        this._updateCollapseLabel();
        // Clear the inline transition after the animation finishes so
        // drag-resize stays lag-free.
        setTimeout(() => {
            if (this.$el && this.$el[0] === el) {
                el.style.transition = '';
            }
            this._syncHeightVar();
        }, 280);
    }

    get isFullyCollapsed() { return !!this._fullyCollapsed; }

    _updateCollapseLabel() {
        if (!this.$el) return;
        const $label = this.$el.find('.pin-collapse-label');
        if (!$label.length) return;
        // Always show a down-chevron — matches the user's preferred behavior
        // where the arrow indicates "the pin section is below / opens down".
        // Collapsed vs expanded states are communicated by the container's
        // actual height animation, not by arrow direction.
        $label.text('▼ Pin Section');
    }

    /**
     * Sync the `--pinned-container-height` CSS variable to the container's
     * current rendered height INCLUDING the hanging bottom pill (which
     * lives below the container's border box via `position: absolute;
     * top: 100%`). The main content reads this variable so it gets
     * pushed down by exactly the right amount — no visible gap.
     */
    /**
     * Sync the `--pinned-container-height` CSS variable to the container's
     * own box height (NOT including the hanging bottom pill). The pill is
     * designed to float over the main content below so there's no visible
     * gap between the pinned section's border and the columns below —
     * identical to how the Travel Config pill hangs over the map.
     */
    _syncHeightVar() {
        if (!this.$el) {
            document.documentElement.style.setProperty('--pinned-container-height', '0px');
            return;
        }
        const rect = this.$el[0].getBoundingClientRect();
        const h = Math.max(0, Math.round(rect.height));
        document.documentElement.style.setProperty('--pinned-container-height', `${h}px`);
    }

    get isCollapsed() { return !!this._collapsed; }
    get currentSplit() { return this._currentSplit || 20; }

    /** Get the preset-bar root element so PinnedSavesPresetBar can mount into it. */
    getPresetBarElement() {
        if (!this.$el) return null;
        return this.$el.find('.pinned-saves-preset-bar')[0] || null;
    }

    /** Insert or remove the drop indicator during drag. */
    _setDropIndicatorAt(insertionIdx) {
        const $list = this.$el.find('.pinned-items-list');
        $list.find('.pin-drop-indicator').remove();
        if (insertionIdx == null) return;
        const $children = $list.children('.pinned-item');
        const indicator = $('<div class="pin-drop-indicator"></div>');
        if (insertionIdx >= $children.length) {
            $list.append(indicator);
        } else {
            $children.eq(insertionIdx).before(indicator);
        }
    }

    _attachEvents() {
        const $el = this.$el;

        // --- Bottom collapse pill — drag-to-resize + tap-to-collapse ---
        // This mirrors the Travel Config tab pointer pattern exactly: a
        // single control does both jobs. If dragging, we resize the
        // container live; if the pointer barely moved, it's treated as a
        // tap that toggles the collapsed state. If the container is
        // already collapsed, the first few px of drag restore it so the
        // drag has something to resize against.
        const tab = $el.find('#pinned-bottom-collapse-tab')[0];
        if (tab) {
            const onTabPointerDown = (e) => {
                e.preventDefault();
                this._tabDrag = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    isDragging: false,
                    wasCollapsed: this.isFullyCollapsed,
                    startingSplit: this.currentSplit,
                };
                try { tab.setPointerCapture(e.pointerId); } catch (_err) { }
            };
            const onTabPointerMove = (e) => {
                const s = this._tabDrag;
                if (!s || e.pointerId !== s.pointerId) return;

                const dx = e.clientX - s.startX;
                const dy = e.clientY - s.startY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (!s.isDragging && dist > DRAG_THRESHOLD_PX) {
                    s.isDragging = true;
                    tab.classList.add('dragging');
                    // If the panel was collapsed, restore it first so the
                    // drag has something to resize.
                    if (s.wasCollapsed) {
                        this.setFullyCollapsed(false);
                        s.wasCollapsed = false;
                        s.startingSplit = this.currentSplit;
                    }
                }

                if (s.isDragging) {
                    // Drag down = grow; drag up = shrink. Compute delta as a
                    // % of viewport height.
                    const vh = window.innerHeight || 800;
                    const delta = (dy / vh) * 100;
                    const newPct = clampSplit(s.startingSplit + delta);
                    this.applySplit(newPct);
                }
            };
            const onTabPointerUp = (e) => {
                const s = this._tabDrag;
                if (!s || e.pointerId !== s.pointerId) return;
                try { tab.releasePointerCapture(s.pointerId); } catch (_err) { }
                tab.classList.remove('dragging');

                if (s.isDragging) {
                    // Persist the new split.
                    this.opts.onResize && this.opts.onResize(this.currentSplit);
                } else {
                    // Tap — toggle fully collapsed.
                    const next = !this.isFullyCollapsed;
                    this.setFullyCollapsed(next);
                    this.opts.onFullCollapseToggle && this.opts.onFullCollapseToggle(next);
                }

                this._tabDrag = null;
            };
            tab.addEventListener('pointerdown', onTabPointerDown);
            tab.addEventListener('pointermove', onTabPointerMove);
            tab.addEventListener('pointerup', onTabPointerUp);
            tab.addEventListener('pointercancel', onTabPointerUp);

            // Keyboard fallback: Enter/Space = toggle, ArrowUp/Down = resize.
            tab.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const next = !this.isFullyCollapsed;
                    this.setFullyCollapsed(next);
                    this.opts.onFullCollapseToggle && this.opts.onFullCollapseToggle(next);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (this.isFullyCollapsed) this.setFullyCollapsed(false);
                    this.applySplit(this.currentSplit + 5);
                    this.opts.onResize && this.opts.onResize(this.currentSplit);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.applySplit(this.currentSplit - 5);
                    this.opts.onResize && this.opts.onResize(this.currentSplit);
                }
            });
        }

        // --- Unpin click -----------------------------------------------
        $el.on('click', '.unpin-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            const $item = $(e.currentTarget).closest('.pinned-item');
            const key = $item.attr('data-pin-key');
            this.opts.onUnpin && this.opts.onUnpin(key);
        });

        // --- Clear All (two-click confirm) -----------------------------
        $el.on('click', '.pin-clear-all-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            const $btn = $(e.currentTarget);
            if (!this._clearPending) {
                this._clearPending = true;
                $btn.attr('data-pending', 'true').text('Click again to confirm');
                this._clearPendingTimer = setTimeout(() => {
                    this._clearPending = false;
                    $btn.attr('data-pending', 'false').text('Clear All Pins');
                }, 3000);
                return;
            }
            clearTimeout(this._clearPendingTimer);
            this._clearPending = false;
            $btn.attr('data-pending', 'false').text('Clear All Pins');
            this.opts.onClearAll && this.opts.onClearAll();
        });

        // --- Drag-handle row reorder -----------------------------------
        // Use direct listeners on the list so pointer capture targets the
        // drag handle itself (required for drags that leave the handle).
        const list = $el.find('.pinned-items-list')[0];
        if (list) {
            const onListPointerDown = (e) => {
                const handle = e.target.closest && e.target.closest('.drag-handle');
                if (!handle) return;
                const $item = $(handle).closest('.pinned-item');
                if (!$item.length) return;
                const idx = $item.index();
                this._rowDrag = { idx, $item, pointerId: e.pointerId, handle };
                try { handle.setPointerCapture(e.pointerId); } catch (_err) { }
                $item.addClass('dragging');
                e.preventDefault();
            };
            const onListPointerMove = (e) => {
                if (!this._rowDrag) return;
                const y = e.clientY;
                const $list2 = $el.find('.pinned-items-list');
                const $children = $list2.children('.pinned-item').not('.dragging');
                let insertionIdx = $children.length;
                for (let i = 0; i < $children.length; i++) {
                    const rect = $children[i].getBoundingClientRect();
                    if (y < rect.top + rect.height / 2) {
                        insertionIdx = i;
                        break;
                    }
                }
                this._setDropIndicatorAt(insertionIdx);
            };
            const endRowDrag = () => {
                if (!this._rowDrag) return;
                const rd = this._rowDrag;
                try { rd.handle.releasePointerCapture(rd.pointerId); } catch (_err) { }
                const $list2 = $el.find('.pinned-items-list');
                const $indicator = $list2.find('.pin-drop-indicator');
                let insertionIdx = $indicator.index();
                $indicator.remove();
                rd.$item.removeClass('dragging');
                if (insertionIdx >= 0 && insertionIdx !== rd.idx) {
                    this.opts.onReorder && this.opts.onReorder(rd.idx, insertionIdx);
                }
                this._rowDrag = null;
            };
            list.addEventListener('pointerdown', onListPointerDown);
            list.addEventListener('pointermove', onListPointerMove);
            list.addEventListener('pointerup', endRowDrag);
            list.addEventListener('pointercancel', endRowDrag);
        }

        // Keyboard reorder on drag handle
        $el.on('keydown', '.drag-handle', (e) => {
            const $item = $(e.currentTarget).closest('.pinned-item');
            const idx = $item.index();
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.opts.onReorderKey && this.opts.onReorderKey(idx, 'up');
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.opts.onReorderKey && this.opts.onReorderKey(idx, 'down');
            }
        });

        // Keep the --pinned-container-height CSS variable in sync on resize.
        this._resizeListener = () => this._syncHeightVar();
        window.addEventListener('resize', this._resizeListener);
    }
}

function _escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
