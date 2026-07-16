/*
 * Pyodide hybrid optimization — benchmark worker (PROTOTYPE, Option C).
 *
 * Runs entirely off the main thread. Boots Pyodide, unpacks the pure-Python
 * optimizer bundle into the virtual filesystem, then runs the UNMODIFIED
 * ui.optimize_worker.main() over a real captured request — the same code path
 * the server runs as a subprocess. We measure wall-clock time for the run only
 * (Pyodide boot + bundle load are reported separately as one-time costs).
 *
 * Messages posted back to the page:
 *   {phase, detail}                      progress updates
 *   {done:true, bootMs, loadMs, runs:[ms...], result}  final
 *   {error:'...'}                        failure
 */

/* global importScripts, loadPyodide */

const PYODIDE_VERSION = "v0.26.2";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

let pyodide = null;

function post(msg) {
  self.postMessage(msg);
}

async function boot() {
  post({ phase: "boot", detail: "loading Pyodide runtime…" });
  importScripts(PYODIDE_BASE + "pyodide.js");
  const t0 = performance.now();
  pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
  const bootMs = performance.now() - t0;
  post({ phase: "boot", detail: `Pyodide ready in ${bootMs.toFixed(0)} ms` });
  return bootMs;
}

async function loadBundle() {
  post({ phase: "bundle", detail: "downloading optimizer bundle…" });
  let bundleUrl = "/api/pyodide/runtime-bundle.zip";
  try {
    const vr = await fetch("/api/pyodide/bundle-version", { cache: "no-cache" });
    if (vr.ok) {
      const { version } = await vr.json();
      if (version) bundleUrl += "?v=" + encodeURIComponent(version);
    }
  } catch (e) { /* fall through */ }
  const resp = await fetch(bundleUrl,
    bundleUrl.indexOf("?v=") !== -1 ? { cache: "force-cache" } : { cache: "no-cache" });
  if (!resp.ok) throw new Error(`bundle fetch failed: HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());

  const t0 = performance.now();
  // Unpack into a dedicated dir and put it at the FRONT of sys.path so the
  // bundled modules win over anything Pyodide ships.
  pyodide.FS.mkdirTree("/opt/ws");
  pyodide.unpackArchive(buf, "zip", { extractDir: "/opt/ws" });
  pyodide.runPython(`
import sys
if "/opt/ws" not in sys.path:
    sys.path.insert(0, "/opt/ws")
# Warm the equipment<->walkscape_constants circular import in the safe order
# (per project steering) before anything else imports them.
import util.walkscape_constants  # noqa: F401
`);
  const loadMs = performance.now() - t0;
  post({ phase: "bundle", detail: `bundle unpacked + imported in ${loadMs.toFixed(0)} ms` });
  return loadMs;
}

async function fetchRequest() {
  post({ phase: "request", detail: "fetching last real optimize request…" });
  const resp = await fetch("/api/pyodide/last-request", { cache: "no-store" });
  if (resp.status === 404) {
    throw new Error(
      "No captured request. Run one normal optimization in the app first, then retry."
    );
  }
  if (!resp.ok) throw new Error(`last-request fetch failed: HTTP ${resp.status}`);
  return await resp.text(); // raw JSON string; written to FS verbatim
}

// Python driver: write the request to a file, point argv at it (NO --db-save,
// so main() prints the result JSON to stdout), capture stdout, return it.
const DRIVER = `
import sys, io, json, time, contextlib, traceback

# Module prefixes that carry per-run mutable state (main() sets module-level
# globals like optimize_activity_gearsets.SORTING_PRIORITY). The real server
# runs each optimization in a fresh subprocess, so to be faithful we purge and
# re-import these between runs. Re-import happens BEFORE the timer, so the
# measured time covers only main()'s compute, not import cost.
def _purge_optimizer_modules():
    for name in list(sys.modules):
        if (name == "util" or name.startswith("util.")
                or name.startswith("optimize_")
                or name == "my_config"
                or name == "ui.optimize_worker"):
            del sys.modules[name]

def _run_once(req_path):
    _purge_optimizer_modules()
    # Warm imports in the steering-mandated order (circular equipment<->consts),
    # excluded from timing. Pre-import the activity optimizer too so main()'s
    # lazy 'import optimize_activity_gearsets' doesn't land inside the timer.
    import util.walkscape_constants  # noqa: F401
    import optimize_activity_gearsets  # noqa: F401
    import ui.optimize_worker as w

    sys.argv = ["optimize_worker", req_path]
    out, err = io.StringIO(), io.StringIO()
    code = 0
    t0 = time.perf_counter()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            w.main()
        except SystemExit as e:
            code = int(e.code) if e.code is not None else 0
        except BaseException as e:  # surface real errors instead of swallowing
            code = 99
            out.write(json.dumps({"success": False, "error": str(e),
                                  "traceback": traceback.format_exc()}))
    dt = (time.perf_counter() - t0) * 1000.0
    return dt, code, out.getvalue(), err.getvalue()[-4000:]
`;

async function run(requestJson, iterations) {
  pyodide.runPython(DRIVER);
  const runOnce = pyodide.globals.get("_run_once");

  const runs = []; // {dt, code, ok}
  let lastOutput = "";
  let lastErr = "";
  for (let i = 0; i < iterations; i++) {
    // Rewrite the request before every run: main() deletes its input file
    // after reading (it's normally a throwaway server temp file), so each
    // run needs a fresh copy.
    pyodide.FS.writeFile("/opt/ws/_bench_request.json", requestJson);
    post({ phase: "run", detail: `optimization ${i + 1} / ${iterations}…` });
    const res = runOnce("/opt/ws/_bench_request.json");
    const dt = res.get(0);
    const code = res.get(1);
    const out = res.get(2);
    const err = res.get(3);
    res.destroy();
    const ok = code === 0;
    runs.push({ dt, code, ok });
    lastOutput = out;
    lastErr = err;
    post({ phase: "run", detail: `  → ${dt.toFixed(0)} ms (exit ${code}${ok ? "" : ", FAILED"})` });
    if (!ok) {
      // Surface the failure so we can actually fix it.
      let parsed = null;
      try { parsed = JSON.parse(out); } catch (e) { /* not json */ }
      if (parsed && parsed.traceback) {
        post({ phase: "run", detail: "TRACEBACK:\n" + parsed.traceback });
      } else if (err) {
        post({ phase: "run", detail: "stderr tail:\n" + err });
      }
    }
  }
  runOnce.destroy();

  let result = null;
  try { result = JSON.parse(lastOutput); } catch (e) {
    result = { _unparsed_stdout: lastOutput.slice(0, 2000) };
  }
  return { runs, result, lastErr };
}

self.onmessage = async (ev) => {
  const iterations = Math.max(1, Math.min(10, ev.data?.iterations || 1));
  try {
    const bootMs = await boot();
    const loadMs = await loadBundle();
    const requestJson = await fetchRequest();
    const { runs, result } = await run(requestJson, iterations);
    post({ done: true, bootMs, loadMs, runs, result });
  } catch (err) {
    post({ error: String(err && err.message ? err.message : err) });
  }
};
