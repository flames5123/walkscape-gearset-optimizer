/**
 * UndoRedoButtons Component
 *
 * Displays undo/redo buttons in the bottom right corner.
 *
 * History popup:
 * - Desktop: hover the button for 500ms to open a list of history
 *   entries above it. Click one to jump directly to that state.
 * - Mobile: long-press (500ms) to open the same list. The long-press
 *   suppresses the normal tap so you don't accidentally undo a single
 *   step when you meant to open the list.
 *
 * List order (both undo and redo popups):
 * - Bottom = closest to current state (one step away)
 * - Top    = furthest away
 * - Scroll starts at the bottom so the nearest jump target is visible first.
 */

import Component from './base.js';
import undoRedoManager from '../undo-redo.js';

const HOVER_OPEN_MS = 500;
const LONG_PRESS_MS = 500;
const CLOSE_GRACE_MS = 150;
const MAX_LIST_HEIGHT_PX = 300;
// Must match the info-popover-out animation duration in styles.css so the
// hidden attribute flips only after the fade-out finishes.
const CLOSE_ANIM_MS = 120;

class UndoRedoButtons extends Component {
    constructor(element, props = {}) {
        super(element, props);

        // Which popup is open: 'undo' | 'redo' | null
        this._openKind = null;
        // Timers for hover/long-press/close
        this._openTimer = null;
        this._closeTimer = null;
        // Timer for the exit animation so a fast re-open can cancel it.
        this._closeAnimTimer = null;
        // Long-press tracking so we can suppress the synthetic click
        this._longPressFired = false;
        this._longPressTarget = null;
        this._touchStartPos = null;
        // Track currentIndex of the manager so we can tell which
        // direction (undo vs redo) triggered a rebuild while open.
        this._lastKnownIndex = undoRedoManager.currentIndex;

        this.render();
        this.attachEvents();
        undoRedoManager.updateButtons();

        // Keep the open popup in sync when undo/redo/jump happens
        // via the button, keyboard shortcut, or any other path.
        this._unsubscribeChange = undoRedoManager.onChange(() => this._onManagerChange());
    }

    render() {
        const html = `<div class="undo-redo-buttons">
            <div class="undo-redo-slot" data-kind="undo">
                <div id="undo-history-popup" class="undo-redo-history-popup" hidden></div>
                <button id="undo-btn" class="undo-redo-button" title="Undo (Ctrl/Cmd+Z)" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 7v6h6"/>
                        <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
                    </svg>
                </button>
            </div>
            <div class="undo-redo-slot" data-kind="redo">
                <div id="redo-history-popup" class="undo-redo-history-popup" hidden></div>
                <button id="redo-btn" class="undo-redo-button" title="Redo (Ctrl/Cmd+Shift+Z)" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 7v6h-6"/>
                        <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/>
                    </svg>
                </button>
            </div>
        </div>`;
        this.$element.html(html);
    }

    attachEvents() {
        // Plain clicks still perform one undo / redo step, unless a
        // long-press just fired (mobile) — in that case we suppress.
        this.$element.on('click', '#undo-btn', (e) => {
            if (this._longPressFired) {
                e.preventDefault();
                e.stopPropagation();
                this._longPressFired = false;
                return;
            }
            undoRedoManager.undo();
        });
        this.$element.on('click', '#redo-btn', (e) => {
            if (this._longPressFired) {
                e.preventDefault();
                e.stopPropagation();
                this._longPressFired = false;
                return;
            }
            undoRedoManager.redo();
        });

        // Desktop hover — open after HOVER_OPEN_MS, close on leave with grace.
        this.$element.on('mouseenter', '.undo-redo-slot', (e) => {
            const kind = $(e.currentTarget).data('kind');
            this._scheduleOpen(kind);
        });
        this.$element.on('mouseleave', '.undo-redo-slot', (e) => {
            // Don't close if the mouse moved into the popup itself — the
            // popup's own listeners handle that.
            this._scheduleClose();
        });
        this.$element.on('mouseenter', '.undo-redo-history-popup', () => {
            this._cancelClose();
        });
        this.$element.on('mouseleave', '.undo-redo-history-popup', () => {
            this._scheduleClose();
        });

        // Click a row to jump to that index.
        this.$element.on('click', '.undo-redo-history-entry', (e) => {
            const $row = $(e.currentTarget);
            const idx = parseInt($row.attr('data-index'), 10);
            if (!Number.isNaN(idx)) {
                undoRedoManager.jumpToIndex(idx);
            }
            this._closePopup();
        });

        // Mobile long-press on either button.
        this.$element.on('touchstart', '.undo-redo-button', (e) => {
            const kind = $(e.currentTarget).closest('.undo-redo-slot').data('kind');
            if (!kind) return;
            this._longPressFired = false;
            this._longPressTarget = kind;
            const t = e.originalEvent.touches && e.originalEvent.touches[0];
            this._touchStartPos = t ? { x: t.clientX, y: t.clientY } : null;

            this._cancelOpen();
            this._openTimer = setTimeout(() => {
                this._longPressFired = true;
                this._openPopup(kind);
            }, LONG_PRESS_MS);
        });
        this.$element.on('touchmove', '.undo-redo-button', (e) => {
            // Cancel the long-press if the finger moves far enough to look
            // like a scroll, not a press.
            if (!this._touchStartPos) return;
            const t = e.originalEvent.touches && e.originalEvent.touches[0];
            if (!t) return;
            const dx = t.clientX - this._touchStartPos.x;
            const dy = t.clientY - this._touchStartPos.y;
            if (Math.hypot(dx, dy) > 10) {
                this._cancelOpen();
            }
        });
        this.$element.on('touchend touchcancel', '.undo-redo-button', () => {
            this._cancelOpen();
            // If the long-press fired, the click handler above will see
            // _longPressFired=true and suppress the tap.
            this._touchStartPos = null;
            this._longPressTarget = null;
        });

        // Tap outside the popup on mobile should close it.
        $(document).on('touchstart.undoRedoPopup click.undoRedoPopup', (e) => {
            if (!this._openKind) return;
            const $target = $(e.target);
            if ($target.closest('.undo-redo-buttons').length === 0) {
                this._closePopup();
            }
        });
    }

    // ---- popup open/close state machine --------------------------------

    _scheduleOpen(kind) {
        this._cancelClose();
        this._cancelOpen();
        this._openTimer = setTimeout(() => this._openPopup(kind), HOVER_OPEN_MS);
    }

    _cancelOpen() {
        if (this._openTimer) {
            clearTimeout(this._openTimer);
            this._openTimer = null;
        }
    }

    _scheduleClose() {
        this._cancelClose();
        this._closeTimer = setTimeout(() => this._closePopup(), CLOSE_GRACE_MS);
    }

    _cancelClose() {
        if (this._closeTimer) {
            clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }
    }

    _openPopup(kind) {
        // If another popup is already open, close it first.
        if (this._openKind && this._openKind !== kind) {
            this._closePopup(/*immediate=*/true);
        }

        const entries = kind === 'undo'
            ? undoRedoManager.getUndoList()
            : undoRedoManager.getRedoList();

        if (!entries.length) {
            // Nothing to show — just bail.
            return;
        }

        const $popup = this.$element.find(`#${kind}-history-popup`);
        this._renderEntries($popup, entries);
        $popup.css('max-height', `${MAX_LIST_HEIGHT_PX}px`);

        // If a previous close animation is mid-flight (the popup is still
        // visible but fading out), cancel it and snap back to the open
        // state. Without this, a user who hovers away and back within the
        // 120ms exit window would see the popup stay faded/gone.
        if (this._closeAnimTimer) {
            clearTimeout(this._closeAnimTimer);
            this._closeAnimTimer = null;
        }
        $popup.removeClass('undo-redo-history-popup--closing');

        $popup.prop('hidden', false);
        this._scrollToBottom($popup);

        this._openKind = kind;
        this._lastKnownIndex = undoRedoManager.currentIndex;
    }

    /**
     * Called whenever the manager's history or current index changed.
     * Keeps an open popup in sync and animates the transition so the
     * user can see which direction the history moved in.
     */
    _onManagerChange() {
        // Always keep our cached index current, even when popup is closed,
        // so the first change after open is directional.
        const newIndex = undoRedoManager.currentIndex;

        if (!this._openKind) {
            this._lastKnownIndex = newIndex;
            return;
        }

        const oldIndex = this._lastKnownIndex;
        this._lastKnownIndex = newIndex;

        if (oldIndex === newIndex) return;

        // Direction of motion: 'undo' = went back (currentIndex decreased),
        // 'redo' = went forward (currentIndex increased).
        const direction = newIndex < oldIndex ? 'undo' : 'redo';

        const entries = this._openKind === 'undo'
            ? undoRedoManager.getUndoList()
            : undoRedoManager.getRedoList();

        if (!entries.length) {
            // Nothing left to show in this popup direction — close it.
            this._closePopup();
            return;
        }

        const $popup = this.$element.find(`#${this._openKind}-history-popup`);
        this._animateRebuild($popup, entries, direction);
    }

    /**
     * Animate the popup content when the history moves while open.
     *   direction='undo'  -> content slides DOWN (as if the list shifted
     *                        downward because an entry was removed from
     *                        the bottom of the undo stack).
     *   direction='redo'  -> content slides UP (a new entry appeared at
     *                        the bottom of the undo stack, or the redo
     *                        stack shortened).
     */
    _animateRebuild($popup, entries, direction) {
        const $list = $popup.find('.undo-redo-history-list');
        if (!$list.length) {
            this._renderEntries($popup, entries);
            this._scrollToBottom($popup);
            return;
        }

        const slideClass = direction === 'undo'
            ? 'undo-redo-slide-down'
            : 'undo-redo-slide-up';

        // Phase 1: animate out.
        $list.addClass(slideClass + '-out');

        setTimeout(() => {
            // Phase 2: swap content and animate in from the opposite side.
            this._renderEntries($popup, entries);
            this._scrollToBottom($popup);

            const $newList = $popup.find('.undo-redo-history-list');
            $newList.addClass(slideClass + '-in');

            // Force reflow so the browser registers the starting state,
            // then remove the class to transition to resting state.
            // eslint-disable-next-line no-unused-expressions
            $newList[0] && $newList[0].offsetHeight;

            requestAnimationFrame(() => {
                $newList.removeClass(slideClass + '-in');
            });
        }, 120);
    }

    _renderEntries($popup, entries) {
        const currentIdx = undoRedoManager.currentIndex;
        const rowsHtml = entries.map(entry => {
            const safeLabel = this._escape(entry.label);
            const isNearest = (
                (this._openKind === 'undo' && entry.index === currentIdx - 1) ||
                (this._openKind === 'redo' && entry.index === currentIdx + 1)
            );
            const nearestClass = isNearest ? ' undo-redo-history-entry--nearest' : '';
            return `<div class="undo-redo-history-entry${nearestClass}" data-index="${entry.index}" title="${safeLabel}">
                <span class="undo-redo-history-label">${safeLabel}</span>
            </div>`;
        }).join('');
        $popup.html(`<div class="undo-redo-history-list">${rowsHtml}</div>`);
    }

    _scrollToBottom($popup) {
        const listEl = $popup.find('.undo-redo-history-list').get(0);
        if (listEl) {
            listEl.scrollTop = listEl.scrollHeight;
        }
    }

    _closePopup(immediate = false) {
        this._cancelOpen();
        this._cancelClose();
        if (!this._openKind) return;

        const kindBeingClosed = this._openKind;
        const $popup = this.$element.find(`#${kindBeingClosed}-history-popup`);

        // Always clear openKind eagerly so any new open request sees no
        // active popup and starts fresh instead of trying to close twice.
        this._openKind = null;

        // Cancel any in-flight close animation timer before starting a new
        // one (e.g. consecutive close calls).
        if (this._closeAnimTimer) {
            clearTimeout(this._closeAnimTimer);
            this._closeAnimTimer = null;
        }

        const finalize = () => {
            $popup.prop('hidden', true);
            $popup.empty();
            $popup.removeClass('undo-redo-history-popup--closing');
            this._closeAnimTimer = null;
        };

        if (immediate) {
            // Used when switching between undo and redo popups — don't
            // animate, just hand off.
            finalize();
            return;
        }

        // Play the exit animation; then hide once it finishes.
        $popup.addClass('undo-redo-history-popup--closing');
        this._closeAnimTimer = setTimeout(finalize, CLOSE_ANIM_MS);
    }

    _escape(s) {
        return String(s).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }
}

export default UndoRedoButtons;
