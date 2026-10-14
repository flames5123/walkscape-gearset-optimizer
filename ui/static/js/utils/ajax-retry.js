/**
 * ajax-retry.js — transient-failure retry for catalog GET requests.
 *
 * Why this exists (bug 72dd1567):
 *   A user on a flaky mobile link (Cloudflare edge) hit repeated
 *   "aborting with incomplete response / http2: stream closed" errors on the
 *   large catalog GETs (/api/activities, /api/recipes, /api/services, ...).
 *   The server was healthy — the client's connection dropped mid-download.
 *   The selectors do a single `$.get(...)` with no retry, so one transient
 *   blip left the activity/recipe dropdowns and info panels permanently empty
 *   (just a fleeting error toast) until a full page reload.
 *
 * What this does:
 *   Wraps jQuery's global `$.get` so idempotent GETs to `/api/*` automatically
 *   retry with exponential backoff on TRANSIENT failures only (connection
 *   aborts, truncated bodies, 502/503/504, timeouts). Deterministic failures
 *   (404, 400, 500, ...) are NOT retried. GETs to non-`/api/*` URLs pass
 *   straight through untouched.
 *
 * Compatibility:
 *   Returns a jQuery Deferred promise, which preserves the `.done()/.fail()/
 *   .then()/.always()` chaining and `await` semantics that existing callers
 *   rely on. It resolves/rejects with the SAME argument tuple jQuery's own
 *   `$.get` uses, so `.fail((xhr, textStatus, err) => ...)` handlers keep
 *   working. (No call site uses jqXHR-only methods like `.abort()`.)
 */

/**
 * Classify a jQuery ajax failure as transient (worth retrying) or not.
 * @param {number} status - xhr.status (0 when the connection never completed)
 * @param {string} [textStatus] - jQuery textStatus ('error'|'timeout'|'parsererror'|'abort')
 * @returns {boolean}
 */
export function isTransientFailure(status, textStatus) {
    // Connection never completed / was cut, or upstream gateway hiccup.
    if (status === 0 || status === 502 || status === 503 || status === 504) return true;
    // A body truncated mid-transfer (the exact bug-72dd1567 signature) surfaces
    // as a parse error or a timeout even when a status line was received.
    if (textStatus === 'parsererror' || textStatus === 'timeout') return true;
    return false;
}

/**
 * Backoff delay (ms) before retry N. Exponential with capped jitter.
 * @param {number} attempt - 1-based retry index (1 = first retry)
 * @param {object} [o]
 * @param {number} [o.base=500] base delay
 * @param {number} [o.cap=4000] max base (pre-jitter)
 * @param {function} [o.rng=Math.random] jitter source (injectable for tests)
 * @returns {number} whole milliseconds
 */
export function nextBackoffMs(attempt, { base = 500, cap = 4000, rng = Math.random } = {}) {
    const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
    const jitter = exp * 0.25 * rng();
    return Math.round(exp + jitter);
}

/**
 * Install the retry wrapper on a jQuery-like object. Idempotent.
 * @param {object} $ - jQuery (must expose `.get` and `.Deferred`)
 * @param {object} [opts]
 * @param {number}   [opts.maxAttempts=3]  total tries (initial + retries)
 * @param {function} [opts.isTransient=isTransientFailure] (status, textStatus)=>bool
 * @param {function} [opts.backoff=nextBackoffMs] (attempt)=>ms
 * @param {function} [opts.schedule=setTimeout-based] (fn, ms)=>void
 * @param {function} [opts.shouldRetryUrl] (url)=>bool — default: string starting with '/api/'
 * @param {function} [opts.onRetry] (url, attempt, status, textStatus, delay)=>void
 * @returns {function|undefined} the original `$.get` (or undefined if not installable)
 */
export function installGetRetry($, opts = {}) {
    const {
        maxAttempts = 3,
        isTransient = isTransientFailure,
        backoff = nextBackoffMs,
        schedule = (fn, ms) => setTimeout(fn, ms),
        shouldRetryUrl = (url) => typeof url === 'string' && url.startsWith('/api/'),
        onRetry = null,
    } = opts;

    if (!$ || typeof $.get !== 'function' || typeof $.Deferred !== 'function') return undefined;
    if ($.__getRetryInstalled) return $.__origGet;

    const origGet = $.get.bind($);
    $.__getRetryInstalled = true;
    $.__origGet = origGet;

    $.get = function patchedGet(...args) {
        const url = args[0];
        // Only wrap idempotent catalog/data GETs. Non-/api GETs pass through
        // unchanged so their native jqXHR (and any exotic methods) are preserved.
        if (!shouldRetryUrl(url)) return origGet(...args);

        const deferred = $.Deferred();
        let attempt = 0;

        const tryOnce = () => {
            attempt += 1;
            origGet(...args)
                .done((...doneArgs) => deferred.resolve(...doneArgs))
                .fail((...failArgs) => {
                    const xhr = failArgs[0] || {};
                    const textStatus = failArgs[1];
                    const status = (xhr && typeof xhr.status === 'number') ? xhr.status : 0;
                    if (attempt < maxAttempts && isTransient(status, textStatus)) {
                        const delay = backoff(attempt);
                        if (onRetry) {
                            try { onRetry(url, attempt, status, textStatus, delay); } catch (_) { /* noop */ }
                        }
                        schedule(tryOnce, delay);
                    } else {
                        deferred.reject(...failArgs);
                    }
                });
        };

        tryOnce();
        return deferred.promise();
    };

    return origGet;
}

export default installGetRetry;
