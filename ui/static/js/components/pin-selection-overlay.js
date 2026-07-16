/**
 * PinSelectionOverlay — document-level listeners + highlight overlay for
 * Pin Selection Mode.
 *
 * Responsibilities:
 *  - Add `body.pin-mode-active` while mounted.
 *  - Listen for hover / tap / click / keyboard and report them to the controller.
 *  - Apply the parent/child gradient highlight to the current target and its
 *    ancestor chain (within the Pinnable Root).
 *  - Render a mode banner (either free-floating toast if the Pinned Container
 *    is unmounted, or inside the container).
 *  - Render the ancestor-chain tooltip listing the candidate granularities.
 */

// The Pinnable Roots — elements only pinnable if descendants of one of these.
export const PINNABLE_ROOT_IDS = ['combined-stats-section', 'column-3'];

/** Return the Pinnable Root ancestor of `el`, or null. */
export function pinnableRootFor(el) {
    if (!el || el.nodeType !== 1) return null;
    let cur = el;
    while (cur) {
        if (cur.id && PINNABLE_ROOT_IDS.includes(cur.id)) return cur;
        cur = cur.parentElement;
    }
    return null;
}

/** True iff `el` is a descendant of any Pinnable Root. */
export function isPinnable(el) {
    return pinnableRootFor(el) !== null;
}

export default class PinSelectionOverlay {
    /**
     * @param {Object} opts
     * @param {Function} opts.onTargetSet     Called with (el) when user hovers/taps a pinnable el.
     * @param {Function} opts.onIneligibleTap Called with (el) when user taps an ineligible el.
     * @param {Function} opts.onConfirm       Called when user clicks a pinnable el (desktop shortcut).
     * @param {Function} opts.onEscape        Called when user presses Escape.
     * @param {Function} opts.onKeyNav        Called with ('up'|'down'|'confirm') for keyboard nav.
     */
    constructor({ onTargetSet, onIneligibleTap, onConfirm, onEscape, onKeyNav }) {
        this.onTargetSet = onTargetSet || (() => { });
        this.onIneligibleTap = onIneligibleTap || (() => { });
        this.onConfirm = onConfirm || (() => { });
        this.onEscape = onEscape || (() => { });
        this.onKeyNav = onKeyNav || (() => { });

        this._pointerOver = this._onPointerOver.bind(this);
        this._pointerOut = this._onPointerOut.bind(this);
        this._click = this._onClick.bind(this);
        this._keydown = this._onKeyDown.bind(this);
        this._highlighted = []; // elements with .pin-hover-leaf / .pin-hover-ancestor

        this._banner = null;
        this._ancestorPicker = null;
        // Once the user clicks a target, we LOCK to that element's ancestor
        // chain. Hovering elsewhere won't move the target; the user refines
        // with Up/Down on the picker. Clicking a different pinnable element
        // re-locks to that new target.
        this._locked = false;

        // Anchor watch — detects when the highlighted leaf is removed from the
        // DOM (e.g., by a re-render) so we can clear the stale highlight chain
        // and ancestor picker. Mirrors the info-popover.js and
        // drop-item-popover.js anchor-watch pattern.
        this._anchorObserver = null;
        this._staleAnchorInterval = null;
        this._checkStaleAnchor = this._checkStaleAnchor.bind(this);
    }

    mount() {
        document.body.classList.add('pin-mode-active');
        // Capture-phase click listener so we can suppress the source's click.
        document.addEventListener('pointerover', this._pointerOver, true);
        document.addEventListener('pointerout', this._pointerOut, true);
        document.addEventListener('click', this._click, true);
        document.addEventListener('keydown', this._keydown, true);

        this._renderBanner();
        this._startAnchorWatch();
    }

    unmount() {
        document.body.classList.remove('pin-mode-active');
        document.removeEventListener('pointerover', this._pointerOver, true);
        document.removeEventListener('pointerout', this._pointerOut, true);
        document.removeEventListener('click', this._click, true);
        document.removeEventListener('keydown', this._keydown, true);
        this._clearHighlights();
        this._removeBanner();
        this._removeAncestorPicker();
        this._stopAnchorWatch();
    }

    /** Apply highlight chain to `target` and its ancestors up to (excluding) root. */
    applyHighlight(target) {
        this._clearHighlights();
        if (!target) return;
        const root = pinnableRootFor(target);
        if (!root) return;

        // Build chain leaf -> root-adjacent
        const chain = [];
        let cur = target;
        while (cur && cur !== root) {
            chain.push(cur);
            cur = cur.parentElement;
        }

        for (let i = 0; i < chain.length; i++) {
            const el = chain[i];
            if (i === 0) {
                el.classList.add('pin-hover-leaf');
            } else {
                // t ∈ [0, 1] where 0 = leaf-adjacent (red), 1 = root-adjacent (green)
                const t = (chain.length - 1 === 0) ? 0 : (i / (chain.length - 1));
                el.classList.add('pin-hover-ancestor');
                el.style.setProperty('--pin-gradient-t', String(t));
            }
            this._highlighted.push(el);
        }

        this._renderAncestorPicker(chain);
    }

    _clearHighlights() {
        for (const el of this._highlighted) {
            el.classList.remove('pin-hover-leaf');
            el.classList.remove('pin-hover-ancestor');
            el.style.removeProperty('--pin-gradient-t');
        }
        this._highlighted = [];
    }

    _onPointerOver(e) {
        const el = e.target;
        if (!el || el.nodeType !== 1) return;
        // Skip over our own overlay UI.
        if (el.closest('.pin-granularity-picker, .pin-mode-banner, .pin-ancestor-picker, .pin-feature-intro-popup, #pinned-container')) {
            return;
        }
        // Once the user has locked a target by clicking, hovering elsewhere
        // must not move the target. They refine with Up/Down or click
        // another pinnable element to re-lock.
        if (this._locked) return;
        if (isPinnable(el)) {
            el.classList.remove('pin-mode-not-allowed');
            this.onTargetSet(el);
        } else {
            el.classList.add('pin-mode-not-allowed');
        }
    }

    _onPointerOut(e) {
        const el = e.target;
        if (!el || el.nodeType !== 1) return;
        el.classList.remove('pin-mode-not-allowed');
    }

    _onClick(e) {
        const el = e.target;
        if (!el || el.nodeType !== 1) return;

        // Clicks on the picker / banner / intro popup / container / pin icon
        // bypass our handling entirely.
        if (el.closest('.pin-granularity-picker, .pin-mode-banner, .pin-ancestor-picker, .pin-feature-intro-popup, #pinned-container, #pin-mode-btn')) {
            return;
        }

        // Always suppress the source's click while in selection mode.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (isPinnable(el)) {
            // Click SELECTS the target and LOCKS it — further hover won't
            // move the target. The user refines with Up/Down on the picker.
            // Pass `fromClick: true` so the controller remembers this
            // element as the "interesting leaf" for Up/Down walking.
            this._locked = true;
            this.onTargetSet(el, { fromClick: true });
        } else {
            this.onIneligibleTap(el);
        }
    }

    _onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.onEscape();
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            // Don't interfere with typing inside inputs the user might be
            // hovering — but inputs are inside pinnable roots too. Keep it
            // simple: if focus is on a form control, ignore.
            const ae = document.activeElement;
            if (ae && /^(input|textarea|select)$/i.test(ae.tagName)) return;
            e.preventDefault();
            this.onKeyNav('confirm');
            return;
        }
        if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault();
            this.onKeyNav('up');
            return;
        }
        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            this.onKeyNav('down');
            return;
        }
    }

    /**
     * If the currently-highlighted leaf element has been removed from the DOM
     * (a re-render fired while pin-selection mode was active), clear the
     * stale highlight chain and ancestor picker so they don't get stuck on
     * screen. Unlocks so the user can re-hover/click to pick a new target.
     *
     * We don't call onEscape here — the user is still in pin-select mode and
     * likely wants to pick a different target, not cancel entirely.
     */
    _checkStaleAnchor() {
        const leaf = this._highlighted[0];
        if (leaf && !leaf.isConnected) {
            this._clearHighlights();
            this._removeAncestorPicker();
            this._locked = false;
        }
    }

    _startAnchorWatch() {
        if (this._anchorObserver || this._staleAnchorInterval) return;
        if (typeof MutationObserver !== 'undefined') {
            this._anchorObserver = new MutationObserver(this._checkStaleAnchor);
            this._anchorObserver.observe(document.body, { childList: true, subtree: true });
        }
        // Backstop poll in case a mutation is missed.
        this._staleAnchorInterval = setInterval(this._checkStaleAnchor, 300);
    }

    _stopAnchorWatch() {
        if (this._anchorObserver) {
            this._anchorObserver.disconnect();
            this._anchorObserver = null;
        }
        if (this._staleAnchorInterval) {
            clearInterval(this._staleAnchorInterval);
            this._staleAnchorInterval = null;
        }
    }

    _renderBanner() {
        // Only float a banner if the pinned container isn't mounted — when it
        // IS mounted, the container renders its own banner inline.
        if (document.getElementById('pinned-container')) return;
        if (this._banner) return;
        const $b = $(`
            <div class="pin-mode-banner" role="status">
                Pin Selection Mode — click or tap to select, use ▲ / ▼ to refine, ✓ to pin, Escape to cancel.
            </div>
        `);
        $('body').append($b);
        this._banner = $b;
    }

    _removeBanner() {
        if (this._banner) {
            this._banner.remove();
            this._banner = null;
        }
    }

    /** Render the list of ancestors from leaf to root, nearest current target highlighted. */
    _renderAncestorPicker(chain) {
        if (!chain || chain.length <= 1) {
            this._removeAncestorPicker();
            return;
        }
        if (!this._ancestorPicker) {
            this._ancestorPicker = $('<div class="pin-ancestor-picker"></div>');
            $('body').append(this._ancestorPicker);
        }
        const html = chain.map((el, i) => {
            const label = _describeElement(el);
            const cls = i === 0 ? 'pin-ancestor-row current' : 'pin-ancestor-row';
            return `<div class="${cls}" data-ancestor-index="${i}" title="${label}">${label}</div>`;
        }).join('');
        this._ancestorPicker.html(html);

        // Position near the first element
        const rect = chain[0].getBoundingClientRect();
        const left = Math.min(window.innerWidth - 300, rect.left);
        const top = Math.min(window.innerHeight - 200, rect.bottom + 8);
        this._ancestorPicker.css({ left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px` });
    }

    _removeAncestorPicker() {
        if (this._ancestorPicker) {
            this._ancestorPicker.remove();
            this._ancestorPicker = null;
        }
    }
}

function _describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const pid = el.dataset && el.dataset.pinId;
    if (pid) return `${tag}[${pid}]`;
    const stat = el.dataset && el.dataset.stat;
    if (stat) return `${tag}[stat=${stat}]`;
    const drop = el.dataset && el.dataset.drop;
    if (drop) return `${tag}[drop=${drop}]`;
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return `${tag}[${aria}]`;
    if (el.id) return `${tag}#${el.id}`;
    const cls = [...el.classList].slice(0, 2).join('.');
    if (cls) return `${tag}.${cls}`;
    const text = (el.textContent || '').trim().slice(0, 30);
    return text ? `${tag} "${text}"` : tag;
}
