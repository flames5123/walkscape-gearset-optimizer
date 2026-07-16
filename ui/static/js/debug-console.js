/**
 * Debug Log Module
 *
 * Captures console output for inclusion in bug reports.
 *
 * Exports:
 *   getDebugLog()   — returns the current log array (used by bug_report.js)
 *   isDebugEnabled() — always returns false (debug UI removed)
 */

let debugLog = [];

// Keep references to original console methods
const originalConsoleLog = console.log.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

/**
 * Capture a console call into the debug log.
 */
function captureEntry(level, args) {
    const message = Array.from(args).map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');

    debugLog.push({
        timestamp: new Date().toISOString(),
        level,
        message
    });
}

// Install console overrides immediately so all output is captured from page load
console.log = function (...args) {
    captureEntry('log', args);
    originalConsoleLog(...args);
};
console.warn = function (...args) {
    captureEntry('warn', args);
    originalConsoleWarn(...args);
};
console.error = function (...args) {
    captureEntry('error', args);
    originalConsoleError(...args);
};

// Global JS-error capture. Errors that never log to console (thrown from
// event handlers, rejected promises, etc.) still end up in the debug log
// via these listeners, so a bug report after a silent failure has enough
// info to diagnose it.
function captureGlobalError(tag, err) {
    const msg = err && err.stack ? err.stack : String(err);
    captureEntry('error', [`[global:${tag}]`, msg]);
    originalConsoleError(`[global:${tag}]`, err);
}
if (typeof window !== 'undefined') {
    window.addEventListener('error', (ev) => {
        captureGlobalError('onerror', ev.error || ev.message || '(unknown)');
    });
    window.addEventListener('unhandledrejection', (ev) => {
        captureGlobalError('unhandledrejection', ev.reason || '(unknown)');
    });
    // Public helper that other modules can call to funnel caught errors
    // into the debug log. Prefer this over console.error when you want to
    // force-capture something even if console is silenced.
    window.__walkscapeRecordError = (tag, err) => captureGlobalError(tag, err);
}

/**
 * Return the current debug log array.
 * Used by bug_report.js to attach logs to bug reports.
 */
export function getDebugLog() {
    return debugLog;
}

/**
 * Debug UI has been removed. Always returns false.
 */
export function isDebugEnabled() {
    return false;
}

// --- Verbose-debug flag --------------------------------------------------
//
// A handful of `console.log` call sites dump multi-megabyte objects (the
// full session state, the saved-gearset list with embedded snapshots, the
// item catalog, the activities/recipes API responses). Those payloads
// pass through `captureEntry()` above which JSON.stringifies every object
// arg synchronously, so they cost real CPU on every page load AND bloat
// the bug-report blob to 15+ MB even for users who never opened devtools.
//
// We keep the small per-item / per-ring / per-collectible logs as-is
// (they are essentially free and have been useful for diagnosing
// real bugs). Only the giant payload dumps are gated.
//
// To re-enable the full payload dumps for a debug session:
//   localStorage.setItem('walkscape_debug', '1')   // persists
//   ?debug=1 in the URL                            // one-shot
function _readVerboseDebug() {
    try {
        if (typeof window !== 'undefined' && window.location && window.location.search) {
            const u = new URLSearchParams(window.location.search);
            if (u.get('debug') === '1') return true;
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('walkscape_debug') === '1';
        }
    } catch (_) {
        /* localStorage / URLSearchParams unavailable — treat as off */
    }
    return false;
}
const VERBOSE_DEBUG = _readVerboseDebug();
if (typeof window !== 'undefined') {
    window.__walkscapeVerboseDebug = VERBOSE_DEBUG;
}

export function isVerboseDebug() {
    return VERBOSE_DEBUG;
}

// --- Lightweight page-load perf channel ---------------------------------
//
// Always on (cost is essentially zero). Call sites do:
//
//   window.__walkscapePerf?.mark('session_start');
//   await store.loadSession(uuid);
//   window.__walkscapePerf?.measure('session_load', 'session_start');
//
// Each `measure` emits a `[PERF] <label>=<ms>ms` line so the bug-report
// log captures it even if `report()` is never called. At the end of
// `initializeApp` we also dump a single console.table for at-a-glance
// review in devtools.
const _perfMarks = {};
const _perfEntries = [];

function _perfMark(name) {
    _perfMarks[name] = performance.now();
}

function _perfMeasure(label, startMark) {
    const start = _perfMarks[startMark];
    if (start === undefined) return;
    const dur = +(performance.now() - start).toFixed(1);
    _perfEntries.push({ label, duration_ms: dur });
    // Inline emit so the entry is captured even if `report()` is not
    // called (lazy / async loads complete after init returns).
    console.log(`[PERF] ${label}=${dur}ms`);
}

function _perfReport() {
    if (_perfEntries.length === 0) return;
    // Compact one-line summary for the bug-report log
    const summary = _perfEntries.map(e => `${e.label}=${e.duration_ms}ms`).join(' ');
    console.log('[PERF-SUMMARY]', summary);
    // Pretty table for devtools
    if (typeof console.table === 'function') {
        try { console.table(_perfEntries); } catch (_) { /* ignore */ }
    }
}

if (typeof window !== 'undefined') {
    window.__walkscapePerf = {
        mark: _perfMark,
        measure: _perfMeasure,
        report: _perfReport,
        entries: _perfEntries,
    };
}
