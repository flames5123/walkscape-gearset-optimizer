/*
 * Local-speed warning controller (FAC: local_optimization).
 *
 * Goal: nudge users whose device runs optimizations FASTER than the server to
 * turn on "Run optimization locally" — but only when it's genuinely worth it,
 * and only ONCE per browser.
 *
 * How it decides:
 *   1. On page load (idle), run a tiny CPU benchmark ONCE per browser inside
 *      Pyodide (local-speed-bench-worker.js) — the same WASM env the real local
 *      optimizer uses. Cache {version, count, faster, ts} in localStorage.
 *   2. `faster = count > SERVER_THRESHOLD`.
 *   3. When the user clicks any optimize entry point, if the device is faster
 *      (and we've never prompted on this browser), show a one-time popup.
 *
 * Hard gates (benchmark AND popup both skip when any is true):
 *   - local_optimization FAC is off
 *   - current session is a bug-report snapshot   (settingsModal.isSnapshotSession)
 *   - "Disable warning on all devices" is on      (settingsModal.disableLocalOptWarning)
 *   - "Run optimization locally" is already on     (nothing to nudge)
 *
 * CALIBRATION NOTE: SERVER_THRESHOLD (14M) was measured with native python3 on
 * the Oracle box. The device benchmark runs in Pyodide, whose time.time() cost
 * differs, so the device count is on a different scale. The measured count is
 * logged as `[local-bench]` and exposed on `window.__localSpeedBench` so the
 * threshold can be re-tuned to a real break-even with one on-device reading.
 * Bump BENCH_VERSION to force every browser to re-benchmark.
 */

const BENCH_VERSION = 3; // bump to force every browser to re-benchmark + re-arm the popup
const SERVER_THRESHOLD = 2000000; // device "faster than server" if Pyodide loop count exceeds this
// Calibrated 2026-06-17 against a real device: laptop benchmarked 6.1M in Pyodide
// and its actual local optimize ran 3.04x faster than the server (33 opts in 3m11s
// vs 9m40s). The benchmark scales with real local-optimize speed (both run in
// Pyodide), so break-even (device == server speed) = 6.1M / 3.04 ≈ 2.0M. The old
// 14M was a NATIVE number; this loop is ~8.6x slower in Pyodide, so no device
// could ever cross it.
const BENCH_SECONDS = 2;
const WORKER_URL = '/static/js/local-speed-bench-worker.js';

const LS_BENCH = 'walkscape_local_speed_bench';      // {version, count, faster, ts}
const LS_PROMPT_SEEN = 'walkscape_local_speed_prompt_seen'; // '1' once shown

let _benchRunning = false;
let _scheduled = false;
let _pendingDecision = null; // shared Promise while the blocking decision popup is open

/* ------------------------------ gate helpers ----------------------------- */

function _facOn() {
  return !!(window._featureFlags && window._featureFlags.local_optimization);
}
function _isSnapshot() {
  return !!(window.settingsModal && window.settingsModal.isSnapshotSession);
}
function _warningDisabled() {
  return !!(window.settingsModal && window.settingsModal.disableLocalOptWarning);
}
function _localOptOn() {
  return !!(window.settingsModal && window.settingsModal.runLocalOptimization);
}
function _settingsLoaded() {
  // settingsModal exists once the modal component is constructed; the flags we
  // read are populated by its async settings load. Treat the presence of the
  // object as "safe to read" — the booleans default to false before load,
  // which fails closed (no benchmark / no popup), which is the safe direction.
  return !!window.settingsModal;
}

/** All hard gates that suppress both the benchmark and the popup. */
function _gatedOff() {
  return !_facOn() || _isSnapshot() || _warningDisabled() || _localOptOn();
}

/* ------------------------------ cache helpers ----------------------------- */

function _readBench() {
  try {
    const raw = localStorage.getItem(LS_BENCH);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.version === BENCH_VERSION) return obj;
  } catch (_) { /* ignore */ }
  return null;
}
function _writeBench(count) {
  const obj = { version: BENCH_VERSION, count, faster: count > SERVER_THRESHOLD, ts: Date.now() };
  try { localStorage.setItem(LS_BENCH, JSON.stringify(obj)); } catch (_) { /* ignore */ }
  window.__localSpeedBench = { ...obj, threshold: SERVER_THRESHOLD };
  return obj;
}

/** Best-effort: persist a benchmark sample to the server for calibration. */
function _postBenchResult(count, runMs, bootMs, faster, source) {
  try {
    fetch('/api/local-speed-benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count, run_ms: runMs, boot_ms: bootMs, faster,
        threshold: SERVER_THRESHOLD, source,
      }),
      keepalive: true,
    }).catch(() => { /* best-effort */ });
  } catch (_) { /* best-effort */ }
}
function _promptSeen() {
  try { return localStorage.getItem(LS_PROMPT_SEEN) === String(BENCH_VERSION); } catch (_) { return false; }
}
function _markPromptSeen() {
  try { localStorage.setItem(LS_PROMPT_SEEN, String(BENCH_VERSION)); } catch (_) { /* ignore */ }
}

/* ------------------------------ benchmark --------------------------------- */

function _runBenchmark() {
  if (_benchRunning) return;
  if (_gatedOff()) return;
  if (_readBench()) return;              // already benchmarked this browser
  if (navigator && navigator.onLine === false) return; // worker needs the CDN
  _benchRunning = true;

  let worker;
  try {
    worker = new Worker(WORKER_URL);
  } catch (e) {
    console.warn('[local-bench] could not start benchmark worker:', e);
    _benchRunning = false;
    return;
  }

  worker.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.done) {
      const obj = _writeBench(m.count);
      console.log(
        `[local-bench] device counted ${m.count.toLocaleString()} in ~${BENCH_SECONDS}s ` +
        `(boot ${Math.round(m.bootMs)}ms). Server threshold ${SERVER_THRESHOLD.toLocaleString()} → ` +
        `device is ${obj.faster ? 'FASTER' : 'not faster'} than the server.`
      );
      _postBenchResult(m.count, m.runMs, m.bootMs, obj.faster, 'auto');
      _benchRunning = false;
      try { worker.terminate(); } catch (_) { /* ignore */ }
    } else if (m.error) {
      console.warn('[local-bench] benchmark failed:', m.error);
      _benchRunning = false;
      try { worker.terminate(); } catch (_) { /* ignore */ }
    }
    // phase messages are ignored (kept quiet)
  };
  worker.onerror = (e) => {
    console.warn('[local-bench] worker error:', e && e.message ? e.message : e);
    _benchRunning = false;
    try { worker.terminate(); } catch (_) { /* ignore */ }
  };

  worker.postMessage({ seconds: BENCH_SECONDS });
}

function _scheduleBenchmark() {
  if (_scheduled) return;
  if (_gatedOff()) return;
  if (_readBench()) return;
  _scheduled = true;
  const kick = () => _runBenchmark();
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(kick, { timeout: 8000 });
  } else {
    setTimeout(kick, 3000);
  }
}

/* -------------------------------- popup ----------------------------------- */

// Apply the user's choice to the global setting (and sync every "Run locally"
// surface) before the gated optimize proceeds. isLocalComputeEnabled() reads
// this live, so the very next optimize routes accordingly.
function _applyChoice(runLocal) {
  try {
    const sm = window.settingsModal;
    if (sm) {
      sm.runLocalOptimization = runLocal;
      if (typeof sm.saveGlobalOptimizationSettings === 'function') {
        sm.saveGlobalOptimizationSettings();
      }
    }
    window.dispatchEvent(new CustomEvent('runLocalOptimizationChanged',
      { detail: { enabled: runLocal } }));
    console.log(`[local-bench] user chose to run ${runLocal ? 'LOCALLY' : 'on the SERVER'} from the speed prompt`);
  } catch (e) {
    console.error('[local-bench] failed to apply local-optimization choice:', e);
  }
}

// Blocking decision popup. Calls onDecision(runLocal:boolean) exactly once,
// after the user picks — the gated optimize waits on that.
function _showPopup(count, onDecision) {
  let done = false;
  const finish = (runLocal) => {
    if (done) return;
    done = true;
    _markPromptSeen();
    _applyChoice(runLocal);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    _pendingDecision = null;
    try { onDecision(runLocal); } catch (_) {}
  };

  const backdrop = document.createElement('div');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Run optimizations locally');
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10000',
    'background:rgba(0,0,0,0.55)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:16px',
    'opacity:0', 'transition:opacity 0.2s ease-out',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'max-width:430px', 'width:100%',
    'background:var(--bg-secondary,#1e1e24)', 'color:var(--text-primary,#eee)',
    'border:1px solid var(--border-color,#3a3a44)', 'border-radius:10px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.5)', 'padding:18px 20px',
    'font-size:0.92em', 'line-height:1.4',
    'opacity:0', 'transform:scale(0.95)',
    'transition:opacity 0.2s ease-out, transform 0.2s ease-out',
  ].join(';');

  const btnBase = 'border:none;border-radius:6px;padding:9px 14px;cursor:pointer;font-size:0.9em;font-weight:600;';
  card.innerHTML = `
    <div style="font-weight:700;font-size:1.05em;margin-bottom:8px;">This device is faster than the server</div>
    <div style="color:var(--text-muted,#aaa);margin-bottom:14px;">
      A quick speed test says this device runs optimizations faster than our server.
      Run this optimization locally instead? Your choice is remembered.
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-bottom:12px;">
      <button class="lsw-no" style="${btnBase}background:var(--bg-tertiary,#2a2a32);color:var(--text-primary,#eee);">No, run on server</button>
      <button class="lsw-yes" style="${btnBase}background:var(--accent-primary,var(--accent-color,#4a9eff));color:#fff;">Yes, run locally</button>
    </div>
    <div style="color:var(--text-muted,#888);font-size:0.8em;">
      Shown once per device. Turn it off everywhere in Optimization Settings → "Disable local optimization speed warning on all devices".
    </div>
  `;
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Fade in (0.2s) + grow from scale(0.95)→1, matching the app's modal opens
  // (stats-report-open). Double rAF so the initial styles paint before the
  // transition kicks in.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      backdrop.style.opacity = '1';
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';
    });
  });

  card.querySelector('.lsw-yes').addEventListener('click', () => finish(true));
  card.querySelector('.lsw-no').addEventListener('click', () => finish(false));
}

/* ------------------------------- public API ------------------------------- */

/**
 * Called by every optimize entry point. Returns a Promise the caller MUST await
 * before starting the optimize: if the one-time "your device is faster" popup
 * is eligible, it blocks until the user picks local vs server (applying the
 * choice first). If not eligible, it resolves immediately so the optimize
 * proceeds normally. Never rejects.
 */
export function maybeShowLocalSpeedWarning() {
  try {
    if (_pendingDecision) return _pendingDecision; // popup already open — coalesce
    if (_promptSeen() || _gatedOff()) return Promise.resolve();
    const bench = _readBench();
    if (!bench || !bench.faster) return Promise.resolve(); // no result yet, or not faster
    _pendingDecision = new Promise((resolve) => { _showPopup(bench.count, resolve); });
    return _pendingDecision;
  } catch (_) {
    return Promise.resolve(); // never let the nudge break an optimize
  }
}

/**
 * Called once from main.js on load. Schedules the per-browser benchmark when
 * settings are available; retries briefly until settingsModal exists.
 */
export function initLocalSpeedBenchmark() {
  const attempt = () => {
    if (!_settingsLoaded()) return false;
    _scheduleBenchmark();
    return true;
  };
  // Settings load is async; re-evaluate when they land, and also poll briefly
  // in case the event already fired before this listener attached.
  window.addEventListener('optimizationSettingsLoaded', () => { attempt(); });
  // If the user turns OFF local opt or toggles the disable flag, nothing to do
  // here (gates are re-read live on each maybeShow / schedule call).
  let tries = 0;
  const poll = setInterval(() => {
    tries += 1;
    if (attempt() || tries > 20) clearInterval(poll); // ~10s max
  }, 500);
}
