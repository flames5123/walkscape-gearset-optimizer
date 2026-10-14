/**
 * Pull-to-refresh for mobile.
 * Requires an intentional pull (higher threshold) since users scroll up a lot.
 * Only active on screens <= 768px.
 * 
 * On mobile, the page scrolls at the document/body level, not inside
 * .column-content (which grows to fit). So we check window.scrollY.
 */

const PULL_THRESHOLD = 100;
const MAX_PULL = 140;
const RESISTANCE = 0.4;
// const DEBUG_SESSION = '00000000-0000-0000-0000-000000000000'; // me donut steal
const DEBUG_SESSION = '';

let pullState = {
    startY: 0,
    currentY: 0,
    pulling: false,
    triggered: false,
};

// ============================================================================
// DEBUG (only for debug session)
// ============================================================================

const debugLog = [];

function isDebugSession() {
    const match = document.cookie.match(/(?:^|;\s*)session_uuid=([^;]*)/);
    return match && match[1] === DEBUG_SESSION;
}

function log(msg) {
    if (!isDebugSession()) return;
    const ts = new Date().toISOString().slice(11, 23);
    debugLog.push(`${ts} ${msg}`);
    if (debugLog.length > 200) debugLog.shift();
}

// Lightweight always-on diagnostic logger. Routed through console.log so it is
// captured by the bug-report debug log (debug-logger.js) for EVERY session —
// unlike log()/isDebugSession() above, which only records for one hardcoded
// debug UUID. Kept terse to avoid spam. Added to diagnose the "can't change
// away from the data tab, refresh fixes it" report (6a190fb3): the mobile
// tab-switch + swipe paths were previously silent, so a stuck report showed a
// blind gap. These lines make the next such report conclusive.
function diag(msg) {
    try { console.log(`[TAB-DIAG] ${msg}`); } catch (_e) { /* ignore */ }
}

// ============================================================================
// MODAL-OPEN DETECTION (hardened)
// ============================================================================
// A modal counts as *open* only when its overlay carries the `.show` class —
// added on open, removed synchronously in every modal's hide(). We deliberately
// do NOT treat a lingering inline `display: flex` as "open": hide() removes
// `.show` immediately but clears `display` only after a 200ms fade timer, and
// if that timer is ever lost (re-render, backgrounded tab, interrupted close)
// the overlay is stranded at `display: flex` with no `.show`. That orphaned,
// invisible overlay used to (a) permanently disable swipe/tab navigation via
// the old `[style*="display: flex"]` guard and (b) sit over the columns + bottom
// nav eating every tap — exactly the report-6a190fb3 lockup. Here we detect the
// orphan and neutralize it (hide + kill pointer capture) so the UI self-heals on
// the next touch instead of needing a page reload.
function getBlockingModalOverlay() {
    // Genuinely-open modal → block gestures as intended.
    const shown = document.querySelector('.modal-overlay.show');
    if (shown) return shown;

    // Orphaned overlay: inline display:flex but no `.show` class → stuck-open
    // leftover. Self-heal it and do NOT treat it as blocking.
    const overlays = document.querySelectorAll('.modal-overlay');
    for (const el of overlays) {
        if (el.style && el.style.display === 'flex') {
            diag(`neutralized orphaned modal-overlay (display:flex, no .show): ${el.className || '(no class)'}`);
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
        }
    }
    return null;
}

function saveDebugLog() {
    if (!isDebugSession()) return;
    try {
        localStorage.setItem('ptr_debug_log', debugLog.join('\n'));
    } catch (e) { /* ignore */ }
}

function showDebugOverlay(text) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; top: 65px; left: 8px; right: 8px; bottom: 80px;
        background: rgba(0,0,0,0.92); color: #0f0; font-size: max(var(--min-text, 5px), calc(11px * var(--text-scale, 1)));
        font-family: monospace; padding: 10px; border-radius: 8px;
        z-index: 99999; overflow-y: auto; white-space: pre-wrap;
        line-height: 1.4; border: 1px solid #0f0;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = `
        position: sticky; top: 0; float: right;
        background: #333; color: #fff; border: 1px solid #0f0;
        padding: 4px 10px; border-radius: 4px; font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));
        cursor: pointer; z-index: 1;
    `;
    closeBtn.addEventListener('click', () => overlay.remove());

    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = 'margin: 0; margin-top: 8px; user-select: all; -webkit-user-select: all;';

    overlay.appendChild(closeBtn);
    overlay.appendChild(pre);
    document.body.appendChild(overlay);
}

// ============================================================================
// INDICATOR UI
// ============================================================================

function getOrCreateIndicator() {
    let indicator = document.getElementById('pull-refresh-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'pull-refresh-indicator';
        indicator.innerHTML = `
            <div class="pull-refresh-spinner"></div>
            <span class="pull-refresh-text">Pull to refresh</span>
        `;
        document.body.appendChild(indicator);
    }
    return indicator;
}

function updateIndicator(pullDistance) {
    const indicator = getOrCreateIndicator();
    const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
    const headerHeight = 60;
    const yPos = headerHeight + pullDistance - 40;

    indicator.style.display = 'flex';
    indicator.style.transform = `translateY(${yPos}px)`;
    indicator.style.opacity = String(Math.min(progress, 1));

    const spinner = indicator.querySelector('.pull-refresh-spinner');
    spinner.style.transform = `rotate(${progress * 360}deg)`;

    const text = indicator.querySelector('.pull-refresh-text');
    if (pullDistance >= PULL_THRESHOLD) {
        text.textContent = 'Release to refresh';
        indicator.classList.add('ready');
    } else {
        text.textContent = 'Pull to refresh';
        indicator.classList.remove('ready');
    }
}

function hideIndicator() {
    const indicator = document.getElementById('pull-refresh-indicator');
    if (indicator) {
        indicator.classList.remove('ready', 'refreshing');
        indicator.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        indicator.style.transform = 'translateY(-50px)';
        indicator.style.opacity = '0';
        setTimeout(() => {
            indicator.style.display = 'none';
            indicator.style.transition = '';
        }, 300);
    }
}

function showRefreshing() {
    const indicator = getOrCreateIndicator();
    const headerHeight = 60;
    indicator.classList.add('refreshing');
    indicator.querySelector('.pull-refresh-text').textContent = 'Refreshing...';
    indicator.style.transform = `translateY(${headerHeight + 10}px)`;
    indicator.style.opacity = '1';
}

// ============================================================================
// SCROLL POSITION
// ============================================================================

function getScrollTop() {
    // Body-scroll model: on mobile only the active column is in normal flow and
    // the WINDOW is its scroller (so iOS's native status-bar-tap-to-top works).
    // Desktop scrolls at the window level too. Either way, read window scroll.
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
}

// ============================================================================
// VIEW GUARDS
// ============================================================================

// Hash-routed full-screen views/overlays where the custom pull-to-refresh
// gesture must be disabled entirely. Each has its own scrollable content and/or
// slide-toggling sections that get confused if the gesture refreshes mid-
// interaction. (Native browser pull-to-refresh is separately suppressed via
// `overscroll-behavior: none` in CSS on these same views.)
const PTR_DISABLED_HASHES = new Set([
    '#travel-config',  // map/divider need raw touch events
    '#goals-report',   // internal scroll regions + slide-toggling sections
    '#sell-for-chips', // hash-routed overlay, own scroll + slide sections
    '#walkdle',        // hash-routed full-screen overlay
    '#notepad',        // full-screen editor, drag/scroll inside
    '#bank',           // Bank Layout Simulator — grid DnD + slide sections (bug 2026-08-02)
    '#crafting-tree',  // Crafting tree full-screen page (bug 2026-08-02)
]);

/**
 * Whether the custom pull-to-refresh gesture must be disabled for the current
 * view. Covers hash-routed overlays plus the crafting tree opened directly
 * (no hash) from the recipe info panel via `$container.show()`.
 *
 * NOTE on the tree backstop: `.crafting-tree-overlay` is `position: fixed`, so
 * its `offsetParent` is ALWAYS null — the old `offsetParent !== null` check made
 * that guard dead code and let pull-to-refresh fire on the tree (bug 2026-08-02).
 * offsetWidth/offsetHeight are non-zero whenever the fixed overlay is visible.
 */
export function pullToRefreshDisabledForCurrentView() {
    // Trading overlay (all its tabs + sub-pages) sets body.trading-open — disable
    // the pull-to-refresh gesture everywhere inside it.
    if (typeof document !== 'undefined' && document.body
            && document.body.classList.contains('trading-open')) {
        return true;
    }
    if (typeof window !== 'undefined' && PTR_DISABLED_HASHES.has(window.location.hash)) {
        return true;
    }
    const treeOverlay = typeof document !== 'undefined'
        ? document.getElementById('crafting-tree-container')
        : null;
    if (treeOverlay && treeOverlay.style && treeOverlay.style.display !== 'none' &&
        ((treeOverlay.offsetWidth || 0) > 0 || (treeOverlay.offsetHeight || 0) > 0)) {
        return true;
    }
    return false;
}

// ============================================================================
// TOUCH HANDLERS
// ============================================================================

function onTouchStart(e) {
    if (!isMobile()) return;

    // Top-bar customization edit mode uses vertical drag (drawer reorder / icon
    // drag) — don't let that trigger pull-to-refresh.
    if (document.body.classList.contains('tc-editing')) {
        log('start: topbar edit mode active, skipping');
        return;
    }

    // Disable the gesture entirely on hash-routed overlays and the crafting
    // tree (see pullToRefreshDisabledForCurrentView for the full list + why).
    if (pullToRefreshDisabledForCurrentView()) {
        log('start: pull-to-refresh disabled for current view, skipping');
        return;
    }

    // Don't activate if a modal/popup is genuinely open. getBlockingModalOverlay()
    // also self-heals an orphaned (stuck display:flex, no .show) overlay.
    if (getBlockingModalOverlay()) {
        log('start: modal open, skipping');
        return;
    }

    // Don't arm when the gesture starts inside an open selector dropdown list
    // (activity / recipe / combined). These scroll internally and support
    // drag-to-reorder of favorites, so a pull-to-refresh there is never
    // intended (bug: pull-to-refresh fired while scrolling up / dragging in the
    // dropdowns).
    if (e.target && e.target.closest && e.target.closest('.activity-dropdown, .recipe-dropdown')) {
        log('start: inside selector dropdown, skipping');
        return;
    }
    // Also skip while a favorites drag-reorder is mid-flight anywhere.
    if (document.querySelector('.fav-editable.fav-dragging')) {
        log('start: favorites drag in progress, skipping');
        return;
    }

    const scrollTop = getScrollTop();
    log(`start: windowScrollY=${scrollTop.toFixed(1)}`);

    // Only arm if page is scrolled to the very top
    if (scrollTop > 5) {
        log('start: NOT armed (page not at top)');
        return;
    }

    pullState.startY = e.touches[0].clientY;
    pullState.currentY = pullState.startY;
    pullState.pulling = false;
    pullState.triggered = false;
    log(`start: armed at Y=${pullState.startY.toFixed(0)}`);
}

function onTouchMove(e) {
    if (pullState.triggered || pullState.startY === 0) return;

    // Re-check: if page scrolled during gesture, abort
    const scrollTop = getScrollTop();
    if (scrollTop > 5) {
        if (pullState.pulling) {
            hideIndicator();
        }
        resetState();
        return;
    }

    const currentY = e.touches[0].clientY;
    const rawDelta = currentY - pullState.startY;

    // Only downward pulls
    if (rawDelta <= 0) {
        if (pullState.pulling) {
            hideIndicator();
            pullState.pulling = false;
        }
        return;
    }

    const pullDistance = Math.min(rawDelta * RESISTANCE, MAX_PULL);
    if (pullDistance < 10) return;

    pullState.pulling = true;
    pullState.currentY = currentY;
    e.preventDefault();

    updateIndicator(pullDistance);
}

function onTouchEnd() {
    if (!pullState.pulling) {
        resetState();
        return;
    }

    const rawDelta = pullState.currentY - pullState.startY;
    const pullDistance = rawDelta * RESISTANCE;

    log(`end: pull=${pullDistance.toFixed(0)} thresh=${PULL_THRESHOLD}`);

    if (pullDistance >= PULL_THRESHOLD) {
        pullState.triggered = true;
        showRefreshing();
        log('REFRESH TRIGGERED');
        saveDebugLog();
        setTimeout(() => {
            window.location.reload();
        }, 400);
    } else {
        hideIndicator();
    }

    resetState();
}

function resetState() {
    pullState.pulling = false;
    pullState.startY = 0;
    pullState.currentY = 0;
}

function isMobile() {
    return window.innerWidth <= 768;
}

// ============================================================================
// SWIPE TO CHANGE TABS
// ============================================================================

const SWIPE_THRESHOLD = 60;    // min horizontal px to count as swipe
const SWIPE_MAX_VERTICAL = 80; // max vertical px (reject diagonal swipes)
const TAB_ORDER = ['column-1', 'column-2', 'column-3', 'travel-config-page'];

let swipeState = {
    startX: 0,
    startY: 0,
    tracking: false,
};

function getActiveTabIndex() {
    const active = document.querySelector('.mobile-tab.active');
    if (!active) return 0;
    const col = active.getAttribute('data-column');
    const idx = TAB_ORDER.indexOf(col);
    return idx >= 0 ? idx : 0;
}

// Scroll positions are handled naturally — each .column-content scrolls independently

// Remembered vertical (window) scroll position per column, so switching tabs
// restores where you were — the body-scroll equivalent of the old model where
// each column had its own live inner scroller.
const columnScrollY = Object.create(null);

function switchToTab(index) {
    if (index < 0 || index >= TAB_ORDER.length) return;
    const columnId = TAB_ORDER[index];
    const currentIdx = getActiveTabIndex();
    diag(`switchToTab(${index}=${columnId}) from ${currentIdx}=${TAB_ORDER[currentIdx]}`);
    if (index === currentIdx) {
        diag('switchToTab no-op (target already active)');
        return;
    }

    // Remember the outgoing column's scroll position (body-scroll model).
    const prevColumnId = TAB_ORDER[currentIdx];
    if (prevColumnId && prevColumnId !== 'travel-config-page') {
        columnScrollY[prevColumnId] = window.scrollY || window.pageYOffset || 0;
    }

    // Update tab buttons
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-column') === columnId);
    });

    // Show only the target column (CSS: .column is display:none, active shown)
    document.querySelectorAll('.column').forEach(col => {
        col.classList.toggle('active-mobile-column', col.id === columnId);
    });

    const isTravelTab = columnId === 'travel-config-page';
    const mainContent = document.querySelector('.main-content');
    const travelPage = document.getElementById('travel-config-page');

    if (isTravelTab) {
        // Show travel page, hide main columns
        if (mainContent) mainContent.style.display = 'none';
        // Animated overlay open (matches showTravelConfigPage / item 4)
        if (travelPage) {
            travelPage.classList.remove('closing');
            travelPage.classList.add('opening');
            travelPage.style.display = 'flex';
        }
        // Use replaceState to update URL without triggering hashchange
        // (avoids double-navigation race with showTravelConfigPage)
        history.replaceState(null, '', '#travel-config');
        // Mark desktop travel button as active
        const travelBtn = document.getElementById('travel-nav-btn');
        if (travelBtn) travelBtn.classList.add('active');
        // Init map first (async), then notify page
        const initMap = window._initTravelMap;
        const doNavigate = async () => {
            try { if (initMap) await initMap(); } catch (e) { console.error(e); }
            if (window.travelConfigPage && window.travelConfigPage.onNavigatedTo) {
                window.travelConfigPage.onNavigatedTo();
            }
        };
        doNavigate();
    } else {
        // Body-scroll model: the active column is shown via the
        // active-mobile-column class (CSS). There is no fixed sliding strip, so
        // clear any legacy transform and let the window scroll the column.
        if (mainContent) {
            mainContent.style.display = '';
            mainContent.style.visibility = 'visible';
            mainContent.style.transform = '';
        }
        if (travelPage) {
            travelPage.classList.remove('opening', 'closing');
            travelPage.style.display = 'none';
        }
        // Transient horizontal slide on the newly-active column (keeps the
        // carousel feel without a persistent strip). Direction follows tab
        // order. No `forwards` fill + resting transform:none (CSS) so we don't
        // leave a retained transform that would break iOS touch hit-testing.
        const activeCol = document.getElementById(columnId);
        if (activeCol) {
            const dir = index > currentIdx ? 'ws-slide-right' : 'ws-slide-left';
            activeCol.classList.remove('ws-slide-right', 'ws-slide-left');
            void activeCol.offsetWidth; // force reflow so the animation replays
            activeCol.classList.add(dir);
        }
        // Restore the incoming column's remembered scroll position.
        window.scrollTo(0, columnScrollY[columnId] || 0);

        if (window.location.hash === '#travel-config') {
            history.replaceState(null, '', window.location.pathname);
        }
        // Remove desktop travel button active state
        const travelBtn = document.getElementById('travel-nav-btn');
        if (travelBtn) travelBtn.classList.remove('active');
    }
}

function onSwipeStart(e) {
    if (!isMobile()) return;

    // Don't swipe if touching a range slider (they need horizontal drag)
    if (e.target.type === 'range') return;

    // Don't swipe if on the travel config page and touching the map
    if (window.location.hash === '#travel-config') {
        const target = e.target;
        const mapPanel = document.getElementById('travel-map-panel');
        if (mapPanel && mapPanel.contains(target)) return;
    }

    // Don't swipe if inside a horizontally scrollable container (e.g. quality outcomes table)
    let el = e.target;
    while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 1) return;
        el = el.parentElement;
    }

    // Don't swipe if a modal is genuinely open. getBlockingModalOverlay() also
    // neutralizes an orphaned (stuck display:flex, no .show) overlay so a leftover
    // invisible modal can't permanently kill swipe/tab nav (report 6a190fb3).
    if (getBlockingModalOverlay()) {
        diag('swipe blocked: modal open');
        return;
    }

    swipeState.startX = e.touches[0].clientX;
    swipeState.startY = e.touches[0].clientY;
    swipeState.tracking = true;
}

function onSwipeEnd(e) {
    if (!swipeState.tracking) return;
    swipeState.tracking = false;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - swipeState.startX;
    const dy = touch.clientY - swipeState.startY;

    // Must be mostly horizontal
    if (Math.abs(dy) > SWIPE_MAX_VERTICAL) return;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    const currentIdx = getActiveTabIndex();

    // The travel config tab is reachable ONLY via the bottom-nav tab and the
    // top-header map button — never by swiping (user request). Swiping stays
    // within the main columns. switchToTab() (used by those buttons) is
    // unaffected.
    const travelIdx = TAB_ORDER.indexOf('travel-config-page');
    if (currentIdx === travelIdx) return;               // don't swipe out of travel
    const targetIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
    if (targetIdx === travelIdx) return;                // don't swipe into travel
    switchToTab(targetIdx);
}

// ============================================================================
// INIT
// ============================================================================

export { switchToTab, getActiveTabIndex, TAB_ORDER, getBlockingModalOverlay };

export function initPullToRefresh() {
    // Listen on document since the page scrolls at body level on mobile
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    // Swipe left/right to change tabs on mobile
    document.addEventListener('touchstart', onSwipeStart, { passive: true });
    document.addEventListener('touchend', onSwipeEnd, { passive: true });

    // ----------------------------------------------------------------
    // Prevent double-tap zoom (iOS + Android)
    // touch-action: manipulation in CSS handles most cases, but some
    // browsers/elements still allow it. This JS fallback catches the rest.
    // ----------------------------------------------------------------
    let lastTapTime = 0;
    document.addEventListener('touchend', (e) => {
        const now = Date.now();
        // Double-tap is two taps within 300ms
        if (now - lastTapTime < 300) {
            // Don't block range inputs — they need touchend for value commits
            if (e.target.type !== 'range') {
                e.preventDefault();
            }
        }
        lastTapTime = now;
    }, { passive: false });

    // ----------------------------------------------------------------
    // Reset zoom on input blur (iOS auto-zooms on focus for < 16px fonts)
    // Even with 16px set, some edge cases still zoom. This resets it.
    // ----------------------------------------------------------------
    document.addEventListener('blur', (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            setTimeout(() => {
                // Force viewport reset by briefly toggling maximum-scale
                const viewport = document.querySelector('meta[name="viewport"]');
                if (viewport) {
                    const original = viewport.getAttribute('content');
                    viewport.setAttribute('content',
                        'width=device-width, initial-scale=1.0, maximum-scale=1.0');
                    // Restore after a tick so pinch-to-zoom stays enabled
                    setTimeout(() => {
                        viewport.setAttribute('content', original);
                    }, 100);
                }
            }, 50);
        }
    }, true);

    // ----------------------------------------------------------------
    // Reset zoom on orientation change
    // iOS keeps the zoom level from landscape when rotating back to
    // portrait. Briefly set maximum-scale=1 to snap back to 1x.
    // ----------------------------------------------------------------
    function resetZoomOnOrientationChange() {
        const viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) return;
        const original = viewport.getAttribute('content');
        viewport.setAttribute('content',
            'width=device-width, initial-scale=1.0, maximum-scale=1.0');
        setTimeout(() => {
            viewport.setAttribute('content', original);
        }, 200);
    }

    // Use screen.orientation API if available, fall back to resize
    if (screen.orientation) {
        screen.orientation.addEventListener('change', resetZoomOnOrientationChange);
    } else {
        window.addEventListener('orientationchange', resetZoomOnOrientationChange);
    }

    // Show debug log from previous refresh (debug session only)
    if (isDebugSession()) {
        const stashed = localStorage.getItem('ptr_debug_log');
        if (stashed) {
            localStorage.removeItem('ptr_debug_log');
            showDebugOverlay(stashed);
        }
    }
}
