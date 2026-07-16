/**
 * Service worker: PWA installability + push notifications + a durable
 * cache-first layer for the Pyodide runtime (see below).
 * Required by Chrome to show "Install app" instead of "Create shortcut".
 */

// ============================================================================
// PYODIDE RUNTIME CACHE (durable, version-pinned)
// ============================================================================
// The local optimizer loads the Pyodide runtime (pyodide.js + pyodide.asm.wasm
// ~9MB + python_stdlib.zip ~3MB) from the jsdelivr CDN. jsdelivr marks those
// immutable, so the HTTP cache *should* keep them — but they are large,
// cross-origin entries that mobile browsers (esp. iOS Safari) evict under
// storage pressure, forcing a full re-download every session. That is the main
// reason local optimization feels slow to start on phones / old laptops.
//
// The Cache API is durable per-origin and not subject to the same eviction
// heuristics, so we serve the runtime cache-first: downloaded once per Pyodide
// version, then instant on every later boot. Bump PYODIDE_VERSION (mirror the
// value in optimize-local-worker.js) and the old cache is purged on activate.
const PYODIDE_VERSION = 'v0.26.2';
const PYODIDE_CACHE = 'walkscape-pyodide-' + PYODIDE_VERSION;
const PYODIDE_CDN_PREFIX = 'https://cdn.jsdelivr.net/pyodide/';

async function cacheFirst(request) {
    const cache = await caches.open(PYODIDE_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const resp = await fetch(request);
    // Store successful CORS responses (200) and opaque cross-origin responses
    // (status 0, e.g. importScripts no-cors). Both replay correctly.
    if (resp && (resp.status === 200 || resp.type === 'opaque')) {
        try { await cache.put(request, resp.clone()); } catch (e) { /* quota: serve anyway */ }
    }
    return resp;
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Purge stale Pyodide runtime caches from older versions.
        const names = await caches.keys();
        await Promise.all(
            names
                .filter((n) => n.startsWith('walkscape-pyodide-') && n !== PYODIDE_CACHE)
                .map((n) => caches.delete(n))
        );
        await clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    // Cache-first ONLY for the version-pinned Pyodide CDN runtime. Everything
    // else (app JS/CSS/API/session data) passes straight through so deploys
    // are never served stale.
    if (req.method === 'GET' && req.url.indexOf(PYODIDE_CDN_PREFIX) === 0) {
        event.respondWith(cacheFirst(req));
        return;
    }
    event.respondWith(fetch(req));
});

// ============================================================================
// PUSH NOTIFICATION HANDLERS
// ============================================================================

self.addEventListener('push', (event) => {
    let title = 'Walkscape Optimizer';
    let body = 'You have a new announcement.';
    let data = {};
    try {
        const payload = event.data.json();
        title = payload.title || title;
        body = payload.body || body;
        data = { broadcast_id: payload.broadcast_id, session_uuid: payload.session_uuid };
    } catch (e) { }
    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: '/assets/icons/favicon-192.png',
            data
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    // Send click beacon
    if (data.broadcast_id || data.session_uuid) {
        fetch('/api/push/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: 'clicked',
                broadcast_id: data.broadcast_id || null,
                session_uuid: data.session_uuid || ''
            })
        }).catch(() => { });
    }
    // Determine target URL: stats report notifications navigate to #stats-report
    const targetHash = data.stats_report_run_id ? '#stats-report' : '';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    if (targetHash) {
                        client.postMessage({ type: 'navigate', hash: targetHash });
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow('/' + targetHash);
        })
    );
});

self.addEventListener('notificationclose', (event) => {
    const data = event.notification.data || {};
    if (data.broadcast_id || data.session_uuid) {
        fetch('/api/push/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: 'dismissed',
                broadcast_id: data.broadcast_id || null,
                session_uuid: data.session_uuid || ''
            })
        }).catch(() => { });
    }
});
