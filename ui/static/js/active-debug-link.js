/**
 * Active Debug Session — swap button controller for the main site nav.
 *
 * Behavior (per spec):
 *   - When current cookie session_uuid === ACTIVE_DEBUG_MAIN_UUID, ping the
 *     /api/active-debug-link endpoint. If a link exists, show the orange
 *     (#FF4500) caterpillar button. The snapshot UUID is resolved FRESH at
 *     click time (re-pinging the endpoint) so the button always swaps to the
 *     newest linked snapshot, even if the admin linked a different one after
 *     this page loaded.
 *   - When current cookie is anything else, ask the server whether the
 *     current session is a bug-report snapshot session via
 *     /api/active-debug-snapshot-check. If it is, show the green (#20FF00)
 *     caterpillar button which swaps back to the main UUID. This shows on
 *     EVERY snapshot session (never on normal sessions) and keeps working
 *     even after the link is removed, so the admin is never stranded.
 *     A localStorage cache is used only as a fallback if that check fails.
 *   - Button only appears after a page-load API check has settled — same
 *     pattern as the FAC-gated nav icons (no flash-then-disappear).
 *   - When the snapshot is deleted (bug-report reviewed), the snapshot row is
 *     gone so the check returns false and the button stays hidden.
 */

const ACTIVE_DEBUG_MAIN_UUID = '00000000-0000-0000-0000-000000000000';
const LS_KEY = 'walkscape_active_debug_link';

/** Read session_uuid cookie. */
function _getCookieSessionUuid() {
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
        const [name, value] = c.trim().split('=');
        if (name === 'session_uuid') return value;
    }
    return null;
}

/** Set session_uuid cookie + reload. Mirrors settings-modal switchSession() finish. */
function _swapToSession(uuid) {
    document.cookie = `session_uuid=${uuid}; path=/; max-age=31536000`;
    window.location.reload();
}

function _readCache() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (obj && obj.snapshot_session_uuid && obj.main_session_uuid) return obj;
    } catch (_) { }
    return null;
}

function _writeCache(snapshotUuid, bugReportId) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            main_session_uuid: ACTIVE_DEBUG_MAIN_UUID,
            snapshot_session_uuid: snapshotUuid,
            bug_report_id: bugReportId || null,
        }));
    } catch (_) { }
}

function _clearCache() {
    try { localStorage.removeItem(LS_KEY); } catch (_) { }
}

function _showButton(role, onClick) {
    const btn = document.getElementById('active-debug-swap-btn');
    if (!btn) return;
    btn.dataset.role = role; // 'main' or 'snapshot' — drives CSS color
    btn.title = role === 'main'
        ? 'Swap to linked debug session'
        : 'Swap back to main session';
    btn.setAttribute('aria-label', btn.title);
    btn.style.display = '';
    // Use onclick (not addEventListener) so re-init replaces handler instead of stacking
    btn.onclick = (e) => {
        e.preventDefault();
        onClick();
    };
}

/**
 * Initialize the active-debug swap button. Call once on page load.
 *
 * SAFE TO CALL ON ANY PAGE that includes #active-debug-swap-btn in its
 * markup. No-op if the button isn't present (e.g. the admin site).
 */
export async function initActiveDebugSwapButton() {
    const btn = document.getElementById('active-debug-swap-btn');
    if (!btn) return;

    const cookie = _getCookieSessionUuid();
    if (!cookie) return;

    if (cookie === ACTIVE_DEBUG_MAIN_UUID) {
        // Main session: ping the endpoint to find out if there's a link.
        // The page-load ping only decides whether to SHOW the button. The
        // actual snapshot UUID is resolved fresh at click time (see below) so
        // that if the admin links a different snapshot after this page loaded,
        // the button swaps to the NEWEST link instead of a stale captured one.
        try {
            const res = await fetch('/api/active-debug-link', { credentials: 'same-origin' });
            if (!res.ok) {
                _clearCache();
                return;
            }
            const data = await res.json();
            if (!data.linked || !data.snapshot_session_uuid) {
                _clearCache();
                return;
            }
            _writeCache(data.snapshot_session_uuid, data.bug_report_id);
            _showButton('main', _swapToFreshLinkedSnapshot);
        } catch (err) {
            console.warn('[active-debug-link] fetch failed:', err);
            _clearCache();
        }
        return;
    }

    // Non-main session: ask the server whether THIS session is a bug-report
    // snapshot session. If so, always show the green "swap back to main"
    // button — even when the link has been removed — so the admin is never
    // stranded inside a snapshot session. This endpoint only reports a
    // boolean about the current cookie; it never reveals any other session's
    // UUID, so it's safe to call from non-main sessions.
    try {
        const res = await fetch('/api/active-debug-snapshot-check', { credentials: 'same-origin' });
        if (res.ok) {
            const data = await res.json();
            if (data.is_snapshot) {
                _showButton('snapshot', () => _swapToSession(ACTIVE_DEBUG_MAIN_UUID));
                return;
            }
        }
    } catch (err) {
        console.warn('[active-debug-link] snapshot check failed:', err);
    }

    // Fallback (server check unavailable): legacy localStorage cache written
    // by the main-session ping on this device or the admin "Link snapshot"
    // button.
    const cache = _readCache();
    if (cache && cache.snapshot_session_uuid === cookie) {
        _showButton('snapshot', () => _swapToSession(ACTIVE_DEBUG_MAIN_UUID));
    }
}

/**
 * Resolve the currently-linked snapshot UUID FRESH from the server and swap
 * to it. Used by the main-session button so a link the admin created after
 * this page loaded is honored instead of a value captured at page-load time.
 * Falls back to the cached UUID only if the fresh fetch fails.
 */
async function _swapToFreshLinkedSnapshot() {
    try {
        const res = await fetch('/api/active-debug-link', { credentials: 'same-origin' });
        if (res.ok) {
            const data = await res.json();
            if (data.linked && data.snapshot_session_uuid) {
                _writeCache(data.snapshot_session_uuid, data.bug_report_id);
                _swapToSession(data.snapshot_session_uuid);
                return;
            }
            // Link was removed since page load — nothing to swap to.
            _clearCache();
            return;
        }
    } catch (err) {
        console.warn('[active-debug-link] fresh link fetch failed, using cache:', err);
    }
    // Network/HTTP failure: fall back to the last-known cached snapshot.
    const cache = _readCache();
    if (cache && cache.snapshot_session_uuid) _swapToSession(cache.snapshot_session_uuid);
}

/**
 * Update the localStorage cache from the admin site after a link/unlink
 * action. Called by admin/bug-reports.js so subsequent visits to the
 * snapshot session on the same device immediately show the green button
 * without first needing to visit the main session.
 */
export function syncAdminLinkCache(snapshotUuid, bugReportId) {
    if (snapshotUuid) _writeCache(snapshotUuid, bugReportId);
    else _clearCache();
}
