/**
 * tab-scroll-indicators.js — horizontal overflow affordance for a scrollable
 * tab strip (.settings-tabs).
 *
 * On mobile / narrow screens the tab row scrolls horizontally with its
 * scrollbar hidden, so there's no hint that more tabs sit off-screen to the
 * left or right. This wraps the strip in a non-scrolling positioning context
 * and overlays a ‹ / › chevron at whichever edge still has hidden content.
 * Tapping a chevron scrolls ~60% of the visible width in that direction, or
 * snaps to the very end if that end is closer than one step.
 *
 * Shared by the trading page tab bar and the settings modal — both render the
 * same .settings-tabs component, so both get the affordance from one helper.
 *
 * The chevrons are driven purely by real overflow (scrollWidth > clientWidth),
 * so they appear exactly when needed (narrow viewports) and stay hidden when
 * every tab already fits. Overflow changes are tracked with a ResizeObserver
 * on the strip (which also fires on viewport resize, since the strip is
 * width-constrained by its container) plus a throttled scroll listener — both
 * bound to the strip itself, so they are garbage-collected with it on re-render
 * and never leak onto persistent nodes like window.
 */

const EDGE_TOL = 2; // px tolerance for treating a position as "at the edge"

/**
 * Attach left/right scroll indicators to a horizontally-scrollable tab strip.
 *
 * @param {HTMLElement} bar  The scrollable `.settings-tabs` element.
 * @param {Object} [opts]
 * @param {string} [opts.fade]  CSS color for the edge fade gradient so it
 *   blends into the surface behind the strip (e.g. 'var(--bg-secondary)' for a
 *   modal). Defaults to the strip's own `--tab-scroll-bg` (var(--bg-primary)).
 * @returns {Function} detach  Removes listeners/observers (optional cleanup).
 */
export function attachTabScrollIndicators(bar, opts = {}) {
    if (!bar || bar.dataset.scrollInd === '1') return () => {};
    bar.dataset.scrollInd = '1';

    const doc = bar.ownerDocument || document;

    // Wrap the strip so the chevrons have a positioning context that does NOT
    // scroll with the tab content (absolute children of the strip itself would
    // scroll away). The wrapper also carries the strip's bottom margin.
    const wrap = doc.createElement('div');
    wrap.className = 'tab-scroll-wrap';
    if (opts.fade) wrap.style.setProperty('--tab-scroll-bg', opts.fade);
    bar.parentNode.insertBefore(wrap, bar);
    wrap.appendChild(bar);

    const mkChevron = (cls, glyph, label) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'tab-scroll-ind ' + cls;
        b.setAttribute('aria-label', label);
        b.tabIndex = -1; // convenience affordance, not a keyboard focus stop
        b.textContent = glyph;
        return b;
    };
    const left = mkChevron('tab-scroll-left', '\u2039', 'Scroll tabs left');
    const right = mkChevron('tab-scroll-right', '\u203A', 'Scroll tabs right');
    wrap.appendChild(left);
    wrap.appendChild(right);

    const update = () => {
        const max = bar.scrollWidth - bar.clientWidth;
        const x = bar.scrollLeft;
        left.classList.toggle('visible', x > EDGE_TOL);
        right.classList.toggle('visible', x < max - EDGE_TOL);
    };

    const step = (dir) => {
        const max = bar.scrollWidth - bar.clientWidth;
        if (max <= 0) return;
        const by = Math.max(bar.clientWidth * 0.6, 80);
        let target = bar.scrollLeft + dir * by;
        // Snap to an end when the remaining distance is less than half a step,
        // so a final tap always lands cleanly on the first/last tab.
        if (target <= by * 0.5) target = 0;
        if (target >= max - by * 0.5) target = max;
        target = Math.max(0, Math.min(max, target));
        if (typeof bar.scrollTo === 'function') {
            bar.scrollTo({ left: target, behavior: 'smooth' });
        } else {
            bar.scrollLeft = target;
        }
    };
    left.addEventListener('click', (e) => { e.preventDefault(); step(-1); });
    right.addEventListener('click', (e) => { e.preventDefault(); step(1); });

    // rAF-throttled scroll updates keep the chevrons in sync as the user drags.
    let raf = 0;
    const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    bar.addEventListener('scroll', onScroll, { passive: true });

    // ResizeObserver on the strip covers both container growth/shrink and
    // viewport resize (the strip is width-bound by its container). No window
    // listener => nothing to leak across modal re-renders.
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => update());
        ro.observe(bar);
    }

    update();
    // One more pass after layout settles (strip may be 0-width at first paint,
    // e.g. inside a modal that is still animating in).
    requestAnimationFrame(update);

    return function detach() {
        bar.removeEventListener('scroll', onScroll);
        if (ro) ro.disconnect();
    };
}
