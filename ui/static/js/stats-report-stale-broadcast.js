// stats-report-stale-broadcast.js
//
// Debounced helper to fire POST /api/stats-report/state-changed after the
// character state mutates. Single funnel — every code path that mutates
// state calls broadcastStateChange() instead of computing staleness ad-hoc.
//
// See .kiro/specs/stats-report-stale-detection/ for design.

const DEBOUNCE_MS = 300;
let _pendingTimer = null;
let _inflight = false;

/**
 * Schedule a stale-detection refresh. Calls coalesce within DEBOUNCE_MS.
 *
 * Use options.immediate=true for events that don't need debouncing
 * (import completion, custom_stat selection, ring-slot toggle).
 */
export function broadcastStateChange(options = {}) {
    const immediate = options.immediate === true;
    if (immediate) {
        if (_pendingTimer) {
            clearTimeout(_pendingTimer);
            _pendingTimer = null;
        }
        _fire();
        return;
    }
    if (_pendingTimer) {
        clearTimeout(_pendingTimer);
    }
    _pendingTimer = setTimeout(() => {
        _pendingTimer = null;
        _fire();
    }, DEBOUNCE_MS);
}

async function _fire() {
    if (_inflight) {
        // Another fire in flight — schedule a follow-up
        setTimeout(() => broadcastStateChange(), DEBOUNCE_MS);
        return;
    }
    _inflight = true;
    try {
        const resp = await fetch('/api/stats-report/state-changed', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({}),
        });
        if (!resp.ok) {
            // Quietly swallow — non-critical
            return;
        }
        const data = await resp.json();
        // Re-fetch stale-check on the stats report page if it's open
        try {
            window.dispatchEvent(new CustomEvent('stats-report-stale-refresh', {
                detail: { stale_scope_count: data.stale_scope_count || 0 },
            }));
        } catch (_) {}
    } catch (_) {
        // Network errors are non-critical
    } finally {
        _inflight = false;
    }
}

// Expose globally for non-module call sites
if (typeof window !== 'undefined') {
    window.statsReportBroadcastStateChange = broadcastStateChange;
}
