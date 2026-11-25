/*
 * maintenance-poller.js — DB-free scheduled-maintenance awareness for already-loaded tabs.
 *
 * Problem: when maintenance starts (or the DB is swapped during a cutover), a
 * browser tab that loaded the SPA BEFORE maintenance keeps firing API calls at
 * a backend/DB that is down, and a tab left open overnight "wakes up" the next
 * day still pointed at the old app. We need those tabs to bounce to the
 * maintenance page WITHOUT ever calling the (possibly-down) app/DB.
 *
 * Mechanism: poll a STATIC status file served by the edge proxy (Caddy), never
 * the app. It is available before, during, and after maintenance (served even
 * while the rest of the site returns 503), so the decision is made purely from
 * this file + the clock + localStorage.
 *
 *   /maintenance-status.json
 *     { "active": bool,                      // maintenance happening right now
 *       "scheduled_start": "<ISO8601>"|null, // next scheduled window start
 *       "scheduled_end":   "<ISO8601>"|null,
 *       "build": "<id>", "updated_at": "<ISO8601>" }
 *
 * Reload triggers (each at most once, de-duped in localStorage):
 *   - active === true                       -> reload (lands on the 503 page,
 *                                              whose own 60s refresh returns the
 *                                              user to the app once maint ends).
 *   - scheduled_start has passed AND this tab loaded BEFORE it -> reload (the
 *                                              overnight-stale-tab case; checked
 *                                              on focus/visibility, not just the
 *                                              60s timer, since backgrounded tabs
 *                                              throttle timers).
 *   - status endpoint itself returns 503     -> reload.
 *
 * Network errors are ignored (no false reloads when merely offline).
 */
(function () {
  'use strict';

  var POLL_MS = 60000;
  var STATUS_URL = '/maintenance-status.json';
  var LS_WINDOW = 'ws_maint_window_handled'; // value = scheduled_start we've acted on
  var loadedAt = Date.now();
  var reloading = false;

  function parseTs(s) {
    if (!s) return null;
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function banner(msg) {
    var d = document.getElementById('ws-maint-banner');
    if (!d) {
      d = document.createElement('div');
      d.id = 'ws-maint-banner';
      d.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#b45309;color:#fff;font:600 14px/1.5 system-ui,-apple-system,sans-serif;' +
        'text-align:center;padding:10px 14px;box-shadow:0 2px 10px rgba(0,0,0,.35)';
      (document.body || document.documentElement).appendChild(d);
    }
    d.textContent = msg;
  }

  function doReload(reason) {
    if (reloading) return;
    reloading = true;
    try { console.log('[maint-poller] reloading ->', reason); } catch (e) {}
    banner('Scheduled maintenance is starting - reloading...');
    setTimeout(function () {
      try { location.reload(); } catch (e) { location.href = location.href; }
    }, 1500);
  }

  function evaluate(st) {
    if (!st || typeof st !== 'object') return;

    // Maintenance is happening right now.
    if (st.active === true) { doReload('maintenance-active'); return; }

    // Scheduled window has started while this tab was already loaded.
    var start = parseTs(st.scheduled_start);
    if (start && Date.now() >= start) {
      var handled = null;
      try { handled = localStorage.getItem(LS_WINDOW); } catch (e) {}
      if (loadedAt < start && handled !== String(start)) {
        try { localStorage.setItem(LS_WINDOW, String(start)); } catch (e) {}
        doReload('scheduled-window-elapsed');
        return;
      }
      // Loaded fresh after the window: record it so we never loop on this window.
      try { localStorage.setItem(LS_WINDOW, String(start)); } catch (e) {}
    }
  }

  function poll() {
    if (reloading) return;
    fetch(STATUS_URL, { cache: 'no-store' })
      .then(function (r) {
        if (r.status === 503) { doReload('status-503'); return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (st) { if (st) evaluate(st); })
      .catch(function () { /* offline / transient — do nothing */ });
  }

  poll();
  setInterval(poll, POLL_MS);
  // Backgrounded tabs throttle setInterval; re-check the instant the user returns.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) poll();
  });
  window.addEventListener('focus', poll);
})();
