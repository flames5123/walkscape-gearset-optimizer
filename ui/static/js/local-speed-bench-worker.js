/*
 * Local-speed benchmark worker (FAC: local_optimization).
 *
 * Runs a tiny fixed-window CPU benchmark INSIDE Pyodide — the same WASM
 * interpreter the real local optimization runs in — so the measured number
 * reflects the device's actual local-exec throughput, not its native JS speed.
 *
 * The benchmark is the exact loop the user calibrated on the server:
 *
 *     import time
 *     i = 0
 *     end = time.time() + 2
 *     while time.time() < end:
 *         i += 1
 *     print(i)
 *
 * The server (native python3, 4-vCPU Oracle box) averaged ~12.9M over 10 runs.
 * NOTE: this loop is dominated by time.time() cost, which is far cheaper native
 * than in Pyodide (WASM→JS boundary), so the device's Pyodide count is NOT on
 * the same scale as the native 12.9M. The controller's threshold is calibrated
 * for the Pyodide environment, and the raw count is surfaced for tuning.
 *
 * No optimizer bundle is loaded — the loop only needs the stdlib `time` module,
 * so boot is just the Pyodide core runtime (cached by the browser after first
 * download).
 *
 * Messages posted back:
 *   { phase, detail }                     progress
 *   { done:true, count, runMs, bootMs }   final
 *   { error:'...' }                       failure
 */

/* global importScripts, loadPyodide */

const PYODIDE_VERSION = 'v0.26.2';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

// Seconds the counter loop runs for. Matches the user's calibration loop.
const BENCH_SECONDS = 2;

let pyodide = null;

function post(msg) { self.postMessage(msg); }

async function boot() {
  post({ phase: 'boot', detail: 'loading Pyodide runtime…' });
  importScripts(PYODIDE_BASE + 'pyodide.js');
  const t0 = performance.now();
  pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
  const bootMs = performance.now() - t0;
  post({ phase: 'boot', detail: `Pyodide ready in ${bootMs.toFixed(0)} ms` });
  return bootMs;
}

// The exact calibration loop, run in Pyodide. Returns the iteration count.
function runBenchmark(seconds) {
  const t0 = performance.now();
  const count = pyodide.runPython(`
import time
_i = 0
_end = time.time() + ${seconds}
while time.time() < _end:
    _i += 1
_i
`);
  const runMs = performance.now() - t0;
  return { count: Number(count), runMs };
}

self.onmessage = async (ev) => {
  const seconds = Math.max(1, Math.min(5, ev.data?.seconds || BENCH_SECONDS));
  try {
    const bootMs = await boot();
    post({ phase: 'run', detail: `running ${seconds}s speed test…` });
    const { count, runMs } = runBenchmark(seconds);
    post({ phase: 'run', detail: `counted ${count.toLocaleString()} in ${runMs.toFixed(0)} ms` });
    post({ done: true, count, runMs, bootMs });
  } catch (err) {
    post({ error: String(err && err.message ? err.message : err) });
  }
};
