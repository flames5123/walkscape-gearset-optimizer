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
        background: rgba(0,0,0,0.92); color: #0f0; font-size: 11px;
        font-family: monospace; padding: 10px; border-radius: 8px;
        z-index: 99999; overflow-y: auto; white-space: pre-wrap;
        line-height: 1.4; border: 1px solid #0f0;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = `
        position: sticky; top: 0; float: right;
        background: #333; color: #fff; border: 1px solid #0f0;
        padding: 4px 10px; border-radius: 4px; font-size: 12px;
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
    // Each column scrolls independently — the .column element is the scroll container on mobile
    const activeCol = document.querySelector('.column.active-mobile-column');
    if (activeCol && activeCol.scrollHeight > activeCol.clientHeight) {
        return activeCol.scrollTop;
    }
    // Fallback: check .column-content
    if (activeCol) {
        const content = activeCol.querySelector('.column-content');
        if (content && content.scrollHeight > content.clientHeight) {
            return content.scrollTop;
        }
    }
    // Fallback for desktop
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
}

// ============================================================================
// TOUCH HANDLERS
// ============================================================================

function onTouchStart(e) {
    if (!isMobile()) return;

    // Don't activate on the travel config page (map/divider need touch events)
    if (window.location.hash === '#travel-config') return;

    // Don't activate on the stats report page — same reason as the
    // crafting tree below: the page has its own internal scroll regions
    // and slide-toggling sections that get confused if the gesture
    // refreshes mid-interaction (user feedback 2026-05-20).
    if (window.location.hash === '#goals-report') return;

    // Don't activate on the Sell for Chips overlay — it's a hash-routed
    // overlay (#sell-for-chips) with its own scrollable content and
    // slide-toggling sections, same reasoning as the goals report above
    // (user feedback 2026-06-12).
    if (window.location.hash === '#sell-for-chips') return;

    // Don't activate on the Walkdle overlay — hash-routed (#walkdle) full-screen
    // overlay with its own scrollable content, same reasoning as the others.
    if (window.location.hash === '#walkdle') return;

    // Notepad overlay: a full-screen editor; pull-to-refresh interferes with
    // dragging/scrolling inside it on mobile.
    if (window.location.hash === '#notepad') return;

    // Don't activate while the crafting tree overlay is open. The tree is
    // a full-screen overlay mounted at #crafting-tree-container with class
    // .crafting-tree-overlay, shown via `$container.show()` and hidden via
    // `$container.hide()` (display: none) on close. User feedback
    // 2026-05-19: pull-to-refresh fired on the tree's gear preview slide
    // when the user dragged finger from the top — disable the gesture
    // entirely while the tree is mounted+visible.
    const treeOverlay = document.getElementById('crafting-tree-container');
    if (treeOverlay && treeOverlay.style.display !== 'none' && treeOverlay.offsetParent !== null) {
        log('start: crafting tree overlay open, skipping');
        return;
    }

    // Don't activate if a modal/popup is open
    const openModal = document.querySelector('.modal-overlay[style*="display: flex"], .modal-overlay.show');
    if (openModal) {
        log('start: modal open, skipping');
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

function switchToTab(index) {
    if (index < 0 || index >= TAB_ORDER.length) return;
    const columnId = TAB_ORDER[index];
    const currentIdx = getActiveTabIndex();
    if (index === currentIdx) return;

    // Update tab buttons
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-column') === columnId);
    });

    // Update active-mobile-column class (for any code that checks it)
    document.querySelectorAll('.column').forEach(col => {
        col.classList.toggle('active-mobile-column', col.id === columnId);
    });

    const isTravelTab = columnId === 'travel-config-page';
    const mainContent = document.querySelector('.main-content');
    const travelPage = document.getElementById('travel-config-page');

    if (isTravelTab) {
        // Show travel page, hide main columns strip
        if (mainContent) mainContent.style.display = 'none';
        if (travelPage) travelPage.style.display = 'flex';
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
        // Show main columns strip, hide travel page
        if (mainContent) {
            mainContent.style.display = '';
            mainContent.style.visibility = 'visible';
            // Slide to the correct column (travel is index 3, so clamp to 0-2)
            const colIndex = Math.min(index, 2);
            mainContent.style.transform = `translateX(-${colIndex * 100}vw)`;
        }
        if (travelPage) travelPage.style.display = 'none';
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

    // Don't swipe if a modal is open
    const openModal = document.querySelector('.modal-overlay[style*="display: flex"], .modal-overlay.show');
    if (openModal) return;

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

    if (dx < 0) {
        // Swipe left → next tab
        switchToTab(currentIdx + 1);
    } else {
        // Swipe right → previous tab
        switchToTab(currentIdx - 1);
    }
}

// ============================================================================
// INIT
// ============================================================================

export { switchToTab, getActiveTabIndex, TAB_ORDER };

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
