/*
 * Client-side optimization worker (FAC: local_optimization).
 *
 * Runs the UNMODIFIED ui.optimize_worker.main() inside Pyodide, off the main
 * thread, so the local path is logic-identical to the server. Stays alive
 * across optimizations so Pyodide boot + bundle load are paid once.
 *
 * LOGGING: every Python stdout/stderr line is forwarded to the main thread
 * ({type:'log'}) which re-emits it via console.log/console.error. That routes
 * the optimizer's diagnostics through debug-console.js (the main-thread console
 * hook) so they are captured in bug reports — a Web Worker's own console is
 * NOT seen by that hook.
 *
 * RESULT: captured by monkeypatching save_result_to_db (the same function the
 * server worker calls), independent of stdout — so log forwarding never
 * swallows the result.
 *
 * Protocol:
 *   main -> worker: { id, requestData }
 *   worker -> main: { type:'log', stream, line }
 *                   { type:'result', id, result }
 *                   { type:'error',  id, error }
 *                   { type:'ready' }   (after first boot)
 */

/* global importScripts, loadPyodide */

const PYODIDE_VERSION = "v0.26.2";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

let pyodide = null;
let readyPromise = null;

function post(m) { self.postMessage(m); }
// Build stamp so bug-report debug logs prove WHICH worker script actually ran
// (stale-worker diagnosis). Keep in sync with WORKER_BUILD in local-compute.js.
const WORKER_BUILD = 'recycle-8';

// POST JSON with retry/backoff across transient server outages. Local
// optimization compute is fully client-side, so a brief server blip (a deploy
// restart returns 502/503/504, or the connection drops for ~20-30s) must NOT
// lose computed scopes — keep retrying the persistence until the server is
// back. Returns the Response (ok, or a final non-retryable status); throws
// after exhausting retries on persistent failure.
async function postJsonWithRetry(url, bodyObj, { retries = 6, baseDelayMs = 1500 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
      });
      // 2xx -> done. 4xx (except 429) won't recover -> return as-is. Only
      // 429 / 5xx transient gateway errors are worth retrying.
      if (r.ok || ![429, 500, 502, 503, 504].includes(r.status)) return r;
      lastErr = new Error("HTTP " + r.status);
    } catch (e) {
      lastErr = e; // network error — server down mid-deploy
    }
    if (attempt < retries) {
      const delay = Math.min(baseDelayMs * Math.pow(1.5, attempt), 10000);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr || new Error("postJsonWithRetry: exhausted retries");
}

async function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const _bootStart = performance.now();
    importScripts(PYODIDE_BASE + "pyodide.js");
    pyodide = await loadPyodide({
      indexURL: PYODIDE_BASE,
      // Forward Python output to the page console (bug-report capture).
      stdout: (line) => post({ type: "log", stream: "stdout", line }),
      stderr: (line) => post({ type: "log", stream: "stderr", line }),
    });
    post({ type: "log", stream: "stdout", line: "[local-timing] pyodide boot " + (performance.now() - _bootStart).toFixed(0) + "ms" });
    const _bundleStart = performance.now();
    // Content-addressed bundle: fetch the current version (tiny, revalidated),
    // then load the bundle at ?v=<version> with force-cache. A changed bundle
    // gets a new version -> new URL -> fresh download; otherwise it's served
    // from cache with no re-check (downloaded once per version, not per boot).
    let bundleUrl = "/api/pyodide/runtime-bundle.zip";
    try {
      const vr = await fetch("/api/pyodide/bundle-version", { cache: "no-cache" });
      if (vr.ok) {
        const { version } = await vr.json();
        if (version) bundleUrl += "?v=" + encodeURIComponent(version);
      }
    } catch (e) { /* fall through to unversioned revalidated fetch */ }
    const resp = await fetch(bundleUrl,
      bundleUrl.indexOf("?v=") !== -1 ? { cache: "force-cache" } : { cache: "no-cache" });
    if (!resp.ok) throw new Error(`runtime bundle fetch failed: HTTP ${resp.status}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    pyodide.FS.mkdirTree("/opt/ws");
    pyodide.unpackArchive(buf, "zip", { extractDir: "/opt/ws" });
    post({ type: "log", stream: "stdout", line: "[local-timing] bundle load+unpack " + (performance.now() - _bundleStart).toFixed(0) + "ms" });
    // Put the bundle first on sys.path and warm the equipment<->constants
    // circular import in the safe order (per project steering).
    pyodide.runPython(`
import sys
if "/opt/ws" not in sys.path:
    sys.path.insert(0, "/opt/ws")
import util.walkscape_constants  # noqa: F401

# Recursively replace non-finite floats (inf/-inf/nan) with None so json.dumps
# produces VALID JSON for the browser. Python's json.dumps emits bare
# Infinity/NaN tokens (allow_nan defaults True) which Python's json.loads
# tolerates (the server path) but JS JSON.parse REJECTS ("unexpected
# character") — that mismatch is why local optimize crashed while the server
# was fine. Applied to every worker result that the JS side JSON.parses.
import math as _math
def _finite_safe(o):
    if isinstance(o, float):
        return o if _math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _finite_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_finite_safe(v) for v in o]
    return o
`);
    pyodide.runPython(DRIVER);
    pyodide.runPython(CT_DRIVER);
    pyodide.runPython(CT_OPT_DRIVER);
    pyodide.runPython(SR_DRIVER);
    pyodide.runPython(TRAVEL_DRIVER);
    post({ type: "ready" });
  })();
  return readyPromise;
}

// Python driver. Captures the result via monkeypatch (no reliance on stdout),
// and lets all print() output flow to the configured stdout/stderr handlers.
const DRIVER = `
import sys, json
_captured = {}

def _run_local(req_json):
    # main() mutates module-level globals (SORTING_PRIORITY, etc.) and is not
    # safe to re-enter, so purge + re-import the optimizer tree each run to
    # match the server's fresh-process model.
    for name in list(sys.modules):
        if (name == "util" or name.startswith("util.")
                or name.startswith("optimize_")
                or name == "my_config"
                or name == "ui.optimize_worker"):
            del sys.modules[name]
    import util.walkscape_constants  # noqa: F401
    import optimize_activity_gearsets  # noqa: F401 (pre-import; main imports it lazily)
    import ui.optimize_worker as w

    with open("/opt/ws/_opt_request.json", "w") as f:
        f.write(req_json)

    _captured.clear()
    def _capture(result, *a, **k):
        _captured["result"] = result
    # Intercept the persistence call so we get the result dict without a DB.
    w.save_result_to_db = _capture
    # Sentinel --db-save args route main() down the save path (-> _capture).
    # Prints still flow to the configured stdout/stderr handlers.
    sys.argv = ["optimize_worker", "/opt/ws/_opt_request.json",
                "--db-save", "local", "/opt/ws/_nodb", "[]"]
    code = 0
    try:
        w.main()
    except SystemExit as e:
        code = int(e.code) if e.code is not None else 0
    return json.dumps(_finite_safe({"result": _captured.get("result"), "exit": code}))
`;

// Crafting-tree driver. calculate_tree is re-entrant (the server calls it
// repeatedly in one long-lived process), so no module purge is needed. Game
// data is loaded once and cached. A worker instance only ever receives one
// task type, so optimizer module-purging never contaminates a tree calc.
const CT_DRIVER = `
import json
import ui.crafting_tree as _ct
_ct_game_data = None

def _run_crafting_tree(payload_json):
    global _ct_game_data
    try:
        p = json.loads(payload_json)
        if _ct_game_data is None:
            _ct_game_data = _ct._load_game_data()
        result = _ct.calculate_tree(
            p.get("nodes", []),
            p.get("global_settings", {}),
            _ct_game_data,
            p.get("session_data"),
        )
        return json.dumps(_finite_safe({"result": result}))
    except BaseException as e:
        import traceback
        return json.dumps({"error": str(e), "traceback": traceback.format_exc()})
`;

// Crafting-tree OPTIMIZE driver. Runs the SAME shared core the server uses
// (ui.crafting_tree_optimize.optimize_crafting_tree) in-process, with an
// in-process node executor in place of the server's subprocess. The core does
// all the orchestration (eligible bottom-up, Best(auto) route trials, tree
// recalc); the executor just runs one optimize_worker.main() per node.
//
// PURGE SCOPE: the executor purges ONLY the optimizer entrypoint modules
// (optimize_*, my_config, ui.optimize_worker) before each node — that's where
// main()'s mutable per-run globals live (SORTING_PRIORITY, CHILD_INPUT_SPECS),
// which made it unsafe to re-enter. It deliberately does NOT purge util.* or
// ui.crafting_tree: the core binds calculate_tree / route_candidates ONCE and
// holds _game_data, so purging those would leave stale bindings mid-run.
const CT_OPT_DRIVER = `
import sys, json, io, contextlib

class _ProcShim:
    # Mimics subprocess.CompletedProcess so the shared core's
    # .returncode/.stdout/.stderr parsing is identical to the server path.
    def __init__(self, returncode, stdout, stderr):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

def _ct_opt_node_executor(req_json):
    # Fresh optimizer state per node (mirror the server's fresh subprocess).
    for name in list(sys.modules):
        if (name.startswith("optimize_") or name == "my_config"
                or name == "ui.optimize_worker"):
            del sys.modules[name]
    path = "/opt/ws/_ct_node_req.json"
    with open(path, "w") as f:
        f.write(req_json)
    import ui.optimize_worker as w
    sys.argv = ["optimize_worker", path]
    buf = io.StringIO()
    code = 0
    # optimize_worker prints the result JSON to stdout (captured) and
    # diagnostics to stderr (left flowing to the page console).
    with contextlib.redirect_stdout(buf):
        try:
            w.main()
        except SystemExit as e:
            code = int(e.code) if e.code is not None else 0
    return _ProcShim(code, buf.getvalue().strip(), "")

def _run_ct_optimize(payload_json):
    import ui.crafting_tree_optimize as cto
    p = json.loads(payload_json)
    task = {
        "optimization_id": p.get("optimization_id", ""),
        "status": "running",
        "completed_nodes": [],
        "pending": 0,
        "total": 0,
    }
    def _exec(request_data):
        return _ct_opt_node_executor(json.dumps(request_data))
    def _log(msg, *a):
        # Forward to stderr -> page console ([local-tree-opt]) for bug reports.
        print(msg, file=sys.stderr)
    try:
        cto.optimize_crafting_tree(
            p.get("session_uuid"),
            p.get("nodes", []),
            p.get("global_settings", {}),
            p.get("session_data"),
            p.get("ui_config", {}),
            task,
            node_ids=p.get("node_ids"),
            depth_optimize=p.get("depth_optimize", False),
            node_executor=_exec,
            log=_log,
        )
    except BaseException as e:
        import traceback
        traceback.print_exc()
        return json.dumps({"error": str(e)})
    return json.dumps(_finite_safe({
        "status": task.get("status"),
        "completed_nodes": task.get("completed_nodes", []),
        "pending": task.get("pending", 0),
        "total": task.get("total", 0),
        "final_nodes": task.get("final_nodes"),
    }))
`;

// Goals report (stats report) driver. Builds character + jobs DB-free by
// injecting a fake ui.database whose get_session returns the handshake session.
// Builds once (_sr_build), then runs ONE job per call (_sr_run_one) so the JS
// side can await-POST each scope between jobs (incremental persistence +
// progress) without async-from-sync-Python.
const SR_DRIVER = `
import sys, json, types
_SR = {}

def _sr_build(params_json, session_json, completed_json, shard_index=0, shard_count=1):
    params = json.loads(params_json)
    session = json.loads(session_json)
    completed = json.loads(completed_json) if completed_json else []

    class _FakeDB:
        def __init__(self, *a, **k):
            self.db_path = ":memory:"
        def get_session(self, uuid):
            return session

    fake = types.ModuleType("ui.database")
    fake.DatabaseManager = _FakeDB
    sys.modules["ui.database"] = fake
    if "ui.stats_report_worker" in sys.modules:
        del sys.modules["ui.stats_report_worker"]
    import ui.stats_report_worker as srw

    # Honor the WTO "Fast (greedy)" toggle in the browser path. The SERVER
    # worker sets this module global from its CLI args (main():
    # globals()['_FAST_MODE'] = is_fast); run_optimizer_for_job and
    # run_recipe_optimizer_for_job read srw._FAST_MODE to set
    # MAX_ITERATIONS=0 (greedy initial solution only, no local-search
    # refinement). The local path skips main(), so without this the toggle
    # was ignored and a local "fast" run did the full local search — same
    # time as non-fast (user-reported). Mirror the server exactly.
    srw._FAST_MODE = bool(params.get("fast", False))

    sid = params.get("session_uuid")
    # [EXACT XP optimizer] gate the LOCAL path too. run_worker sets
    # _EXACT_XP_MODE on the server; the local path skips run_worker, so mirror it
    # here via the bundled allowlist helper (works without ui/database.py).
    try:
        srw._EXACT_XP_MODE = srw.exact_xp_enabled_for(sid)
    except Exception:
        srw._EXACT_XP_MODE = False
    # "Today's changes" old/new toggle (goals-report checkbox, gated session).
    # exact stays gated by the allowlist above; this only flips ring de-dup on
    # the XP optimizer. None (absent) -> leave the module default (new/on).
    try:
        _exact_new = params.get("exact_new", None)
        if _exact_new is not None:
            import util.exact_activity_xp_optimizer as _xpmod
            _xpmod._DEDUP_RING_ORDER = bool(_exact_new)
            _xpmod._SLOT_ORDER_STRATEGY = "tools_first" if _exact_new else "constrained"
    except Exception:
        pass
    run_id = params.get("run_id")
    categories = params.get("categories") or []
    skills = params.get("skills") or []
    kinds = params.get("kinds") or ["gear", "tools", "eggs", "collectibles"]
    chests_filter = params.get("chests")
    # 2026-06-16 (jwbail): per-category skill/chest selection, mirroring the
    # server worker. Absent category key falls back to the flat list.
    _sbc = params.get("skills_by_category") or {}
    _cbc = params.get("chests_by_category") or {}
    def _skills_for(cat):
        v = _sbc.get(cat)
        return v if isinstance(v, list) else skills
    def _chests_for(cat):
        v = _cbc.get(cat)
        return v if isinstance(v, list) else chests_filter

    character = srw.load_character(sid, ":memory:")
    # 2026-06-16 (jwbail): populate region-accessibility globals that run_worker
    # sets on the SERVER path. The local path skips run_worker, so without this
    # _activity_first_accessible_location / _service_location_accessible see no
    # unlocked-region set (None) and let LOCKED-region activities/services
    # through — bug: "Heatstroke Metalworks (Myriadian Arc)" recommended for a
    # character without the Charter of the Drowned, and Myriadian Arc activities
    # in chest farming. Mirror run_worker's setup exactly.
    try:
        from ui.database import DatabaseManager as _DBR
        _sessR = _DBR(":memory:").get_session(sid) or {}
        _ccR = _sessR.get("character_config") or {}
        if isinstance(_ccR, str):
            _ccR = json.loads(_ccR)
        from optimize_travel_gearsets import detect_unlocked_regions, detect_locked_locations
        _riR = detect_unlocked_regions(_ccR)
        _urR = {r for r, v in (_riR.get("unlocked") or _riR).items() if v} if isinstance(_riR, dict) else set()
        if "wallisia" in _urR:
            _urR.update({"ghostly", "spectral"})
        srw._UNLOCKED_REGIONS = _urR
        srw._LOCKED_LOCATIONS = detect_locked_locations(_ccR) or set()
    except Exception:
        srw._UNLOCKED_REGIONS = None
        srw._LOCKED_LOCATIONS = set()
    owned = srw.get_owned_item_names(sid, ":memory:")
    try:
        srw._NEW_ITEMS_OWNERSHIP = srw.get_ownership_lookup(sid, ":memory:")
    except Exception:
        srw._NEW_ITEMS_OWNERSHIP = None
    # 2026-06-18 (jwbail): skip the heavy per-job slot-alternatives computation
    # in the browser. It scans the full ~1300-item pool x 15 slots per recipe
    # and was OOMing the Pyodide WASM heap (MemoryError -> metric 0). The row's
    # metric + gearset are unaffected; alternatives are computed on demand when
    # a row is expanded. Server path never sets this flag.
    srw._SKIP_SLOT_ALTS = True

    # Build the pet / consumable pools when the user opted in, mirroring the
    # server worker (run_worker): include_pets -> _build_pet_items (reads the
    # session through the injected FakeDB), include_consumables ->
    # _collect_owned_consumables(character). Without this the local path ran
    # execute_job with empty pools, so "Include pets / Include consumables" did
    # nothing in the browser (jwbail 2026-06-15). Stored on _SR so _sr_run_one
    # passes them into execute_job exactly like the server's ThreadPoolExecutor
    # call does. Built once per shard (read-only, identical across shards).
    try:
        _SR["pet_pool"] = srw._build_pet_items(sid, ":memory:") if params.get("include_pets") else []
    except Exception:
        _SR["pet_pool"] = []
    try:
        _SR["consumable_pool"] = srw._collect_owned_consumables(character) if params.get("include_consumables") else []
    except Exception:
        _SR["consumable_pool"] = []
    # 2026-06-17 (jwbail): respect the user's hide list in the browser path
    # too — build the hide set once and pass it into execute_job, mirroring
    # the server worker (run_worker). Without this, local runs recommended
    # hidden gear / items / collectibles / eggs / consumables.
    try:
        _SR["hidden_items"] = srw._build_hidden_items(sid, ":memory:")
    except Exception:
        _SR["hidden_items"] = set()

    jobs = []
    if "xp" in categories:
        jobs += srw.build_xp_jobs(run_id, sid, _skills_for("xp"), character)
    if "new_items" in categories:
        ni = srw.build_new_items_jobs(run_id, sid, character, owned)
        ks = set(kinds)
        if ks and ks != {"gear", "tools", "eggs", "collectibles"}:
            ni = [j for j in ni if (j.skill_name or "").lower() in ks]
        jobs += ni
    if "chests" in categories:
        ch = srw.build_chest_jobs(run_id, sid, character)
        _cf_act = _chests_for("chests")
        if _cf_act:
            cs = set(_cf_act)
            ch = [j for j in ch if (j.chest_name or "") in cs]
        jobs += ch
    if "chests_recipes" in categories:
        cr = srw.build_chests_recipes_jobs(run_id, sid, character)
        _cf_rec = _chests_for("chests_recipes")
        if _cf_rec:
            cs = set(_cf_rec)
            cr = [j for j in cr if (j.chest_name or "") in cs]
        jobs += cr
    if "coins" in categories:
        jobs += srw.build_coins_jobs(run_id, sid, _skills_for("coins"), character)

    # Resume: drop jobs whose scope already completed (matched by stable
    # identity, since job_id is random per build).
    if completed:
        done_ids = set()
        for c in completed:
            done_ids.add((c.get("category"), c.get("skill_name"),
                          c.get("chest_name"), c.get("activity_name")))
        def _ident(j):
            src = j.activity.name if getattr(j, "activity", None) else getattr(j, "recipe_name", None)
            return (j.category, j.skill_name, j.chest_name, src)
        jobs = [j for j in jobs if _ident(j) not in done_ids]

    _SR["srw"] = srw
    _SR["character"] = character

    # Shard by a STABLE identity hash (NOT list position). Job-build order is
    # deterministic today, but relying on cross-process positional order is
    # fragile (a future set/dict change could reorder, silently overlapping or
    # dropping scopes across workers). crc32 of the same stable identity used
    # for the resume filter guarantees a clean, gap-free partition regardless
    # of build order. shard_count == 1 keeps the whole list (single worker).
    global_count = len(jobs)
    if shard_count and shard_count > 1:
        import zlib
        def _shard_key(j):
            src = j.activity.name if getattr(j, "activity", None) else getattr(j, "recipe_name", None)
            ident = (j.category, j.skill_name, j.chest_name, src)
            return zlib.crc32("|".join(str(x) for x in ident).encode("utf-8"))
        jobs = [j for j in jobs if _shard_key(j) % shard_count == shard_index]

    _SR["jobs"] = jobs
    return json.dumps({"shard": len(jobs), "global": global_count})

def _sr_run_one(idx):
    srw = _SR["srw"]
    character = _SR["character"]
    job = _SR["jobs"][idx]
    captured = {}
    import time as _time
    _t0 = _time.time()
    _src = (job.activity.name if getattr(job, "activity", None)
            else getattr(job, "recipe_name", None)) or "?"
    _label = "%s/%s/%s" % (job.category, job.skill_name or job.chest_name or "-", _src)
    # 2026-07-01 (jwbail): bug 042ff9cd — chests_recipes recipes resolve to a
    # degenerate metric_value<=0 in the BROWSER but not natively, and the WHY
    # (ZERO-WRITE / candidate-failed / optimizer-failed prints inside
    # run_recipe_optimizer_for_job) only reaches the page console, which bug
    # reports do NOT capture. Capture those prints for chests_recipes jobs and
    # forward them to the server as scope["_diag"] (logged server-side, so it
    # lands in the bug report's server_logs). Still re-emitted to the console.
    _diag_cap = job.category == "chests_recipes"
    _buf = None
    try:
        if _diag_cap:
            import io as _io, contextlib as _ctx
            _buf = _io.StringIO()
            with _ctx.redirect_stdout(_buf):
                srw.execute_job(job, character, ":memory:",
                                pet_items_pool=_SR.get("pet_pool") or [],
                                consumable_items_pool=_SR.get("consumable_pool") or [],
                                hidden_items=_SR.get("hidden_items") or set(),
                                scope_sink=lambda s: captured.update(scope=s))
        else:
            srw.execute_job(job, character, ":memory:",
                            pet_items_pool=_SR.get("pet_pool") or [],
                            consumable_items_pool=_SR.get("consumable_pool") or [],
                            hidden_items=_SR.get("hidden_items") or set(),
                            scope_sink=lambda s: captured.update(scope=s))
    except BaseException as e:
        import traceback
        if _buf is not None:
            _cap = _buf.getvalue()
            if _cap:
                print(_cap, end="")
        traceback.print_exc()
        import gc; gc.collect()
        print("[local-timing] FAIL %s %.0fms" % (_label, (_time.time() - _t0) * 1000), flush=True)
        return json.dumps({"error": str(e)})
    # Free per-job garbage so the long-lived worker's WASM heap stays flat.
    # Goals-report OOM fix: the recipe optimizer threw MemoryError after ~150
    # jobs in one Pyodide interpreter; gc is ms-scale vs the optimization.
    import gc; gc.collect()
    # Per-job timing for diagnosing local-run slowness. fast= reports whether
    # the greedy-only toggle is actually engaged (fast=False => full local
    # search, ~10x slower per job). Forwarded to the page console -> bug report.
    print("[local-timing] %s %.0fms fast=%s" % (
        _label, (_time.time() - _t0) * 1000, bool(getattr(srw, "_FAST_MODE", False))), flush=True)
    _sc = captured.get("scope")
    # XP Dinkelbach per-activity diagnostics -> scope["_diag"] -> POSTed ->
    # logged server-side into server_logs (the page console is not reliably
    # captured in bug reports). Tells us iters + per-iteration node counts +
    # wall ms per activity so slow XP activities are attributable.
    if job.category == "xp" and isinstance(_sc, dict):
        try:
            import util.exact_activity_xp_optimizer as _xpmod
            _d = getattr(_xpmod, "last_run_diag", None)
            if _d:
                _sc["_diag"] = ("[XP-DINK] %s iters=%s total_nodes=%s nodes=%s exhausted=%s ms=%.0f"
                                % (_label, _d.get("iters"), _d.get("total_nodes"),
                                   _d.get("nodes"), _d.get("exhausted"),
                                   (_time.time() - _t0) * 1000))
        except Exception:
            pass
    if _diag_cap:
        _cap = _buf.getvalue() if _buf is not None else ""
        if _cap:
            print(_cap, end="")  # keep console visibility for DevTools
        try:
            _mv = _sc.get("metric_value") if isinstance(_sc, dict) else None
        except Exception:
            _mv = None
        if isinstance(_sc, dict) and (_mv is None or _mv <= 0):
            _sc["_diag"] = ("[CHESTS-DIAG] %s metric=%s | %s"
                            % (_src, _mv, (_cap or "(no optimizer output)").strip()))[:3000]
    return json.dumps(_finite_safe({"scope": _sc}))
`;

// Travel-optimize driver. Runs the UNMODIFIED ui.travel_optimize_worker.main()
// inside Pyodide (same code path the server runs as a subprocess), capturing
// the final result JSON via redirect_stdout — mirroring how CT_OPT_DRIVER runs
// optimize_worker.main(). main() itself redirects its diagnostic prints to
// sys.stderr (forwarded to the page console) and prints ONLY the result JSON to
// the (restored) stdout, which we capture in `buf`. The optimizer entrypoint +
// travel worker modules are purged first so main()'s module-level globals
// (SORTING_PRIORITY, LOCKED_SLOTS, FIXED_TRAVEL_ITEMS) start fresh each run,
// matching the server's fresh-subprocess model.
const TRAVEL_DRIVER = `
import sys, json, io, contextlib

def _run_travel(request_json):
    for name in list(sys.modules):
        if (name.startswith("optimize_") or name == "my_config"
                or name == "ui.travel_optimize_worker"):
            del sys.modules[name]
    path = "/opt/ws/_travel_req.json"
    with open(path, "w") as f:
        f.write(request_json)
    import ui.travel_optimize_worker as w
    sys.argv = ["travel_optimize_worker", path]
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            try:
                w.main()
            except SystemExit:
                pass
    except BaseException as e:
        import traceback
        traceback.print_exc()
        return json.dumps({"error": str(e)})
    out = (buf.getvalue() or "").strip()
    if not out:
        return json.dumps({"error": "travel worker produced no result"})
    # main() prints exactly one JSON line (the result) to the restored stdout.
    try:
        result = json.loads(out)
    except Exception:
        # Defense-in-depth: if any stray diagnostic line slipped into stdout,
        # scan from the end for the last line that parses as JSON.
        result = None
        for _line in reversed(out.splitlines()):
            _line = _line.strip()
            if not _line:
                continue
            try:
                result = json.loads(_line)
                break
            except Exception:
                continue
        if result is None:
            return json.dumps({"error": "travel worker output was not JSON: " + out[:200]})
    return json.dumps(_finite_safe({"result": result}))
`;

self.onmessage = async (ev) => {
  const data = ev.data || {};
  const id = data.id;
  const task = data.task || "optimize";
  try {
    await ensureReady();
    if (task === "crafting-tree-calc") {
      const fn = pyodide.globals.get("_run_crafting_tree");
      const out = fn(JSON.stringify(data.payload || {}));
      fn.destroy();
      const parsed = JSON.parse(out);
      if (parsed.error) {
        post({ type: "error", id, error: parsed.error });
      } else {
        post({ type: "result", id, result: parsed.result });
      }
      return;
    }
    if (task === "crafting-tree-optimize") {
      const fn = pyodide.globals.get("_run_ct_optimize");
      let out;
      try {
        out = fn(JSON.stringify(data.payload || {}));
      } finally {
        fn.destroy();
      }
      const parsed = JSON.parse(out);
      if (parsed.error) {
        post({ type: "error", id, error: parsed.error });
      } else {
        post({ type: "result", id, result: parsed });
      }
      return;
    }
    if (task === "travel-optimize") {
      const fn = pyodide.globals.get("_run_travel");
      let out;
      try {
        out = fn(JSON.stringify(data.requestData || {}));
      } finally {
        fn.destroy();
      }
      const parsed = JSON.parse(out);
      if (parsed.error) {
        post({ type: "error", id, error: parsed.error });
      } else if (parsed.result && typeof parsed.result === "object") {
        post({ type: "result", id, result: parsed.result });
      } else {
        post({ type: "error", id, error: "Local travel optimizer produced no result. See console for the Python log." });
      }
      return;
    }
    if (task === "stats-report") {
      const runId = (data.run_params || {}).run_id;
      post({ type: "log", stream: "stdout", line: "[build] worker=" + WORKER_BUILD + " max_jobs=" + (data.max_jobs || 0) });
      // Sharding: this worker runs ONLY the jobs assigned to its shard.
      // _sr_build (below) partitions by a stable crc32 identity hash and keeps
      // only this shard's jobs, so each of the N workers computes a disjoint
      // ~1/N slice with no overlap and no gaps. shardCount === 1 is the
      // single-worker case (whole list).
      const shardIndex = data.shard_index || 0;
      const shardCount = data.shard_count || 1;
      const build = pyodide.globals.get("_sr_build");
      // _sr_build shards by a STABLE identity hash (not list position) and
      // stores ONLY this shard's jobs, returning both this shard's count and
      // the full global count (for the aggregate progress bar).
      let shardTotal = 0, globalTotal = 0;
      try {
        const built = JSON.parse(build(
          JSON.stringify(data.run_params || {}),
          JSON.stringify(data.session || {}),
          JSON.stringify(data.completed || []),
          shardIndex, shardCount));
        shardTotal = built.shard || 0;
        globalTotal = built.global || 0;
      } finally {
        build.destroy();
      }
      post({ type: "progress", id, done: 0, total: shardTotal, shard_index: shardIndex, global_total: globalTotal });
      const runOne = pyodide.globals.get("_sr_run_one");
      let ok = 0, failed = 0, doneInShard = 0;
      // Compute this shard's jobs back-to-back; batch scopes (BATCH_SIZE per
      // POST) and pipeline the batches (<= MAX_INFLIGHT). The server writes the
      // fast gearset rows + progress and defers the heavy stale-detection
      // write, so persistence never throttles the local compute. MAX_INFLIGHT
      // is PER-WORKER; with N parallel shards the total in-flight POSTs are
      // bounded at N * MAX_INFLIGHT, so keep it modest.
      const BATCH_SIZE = 8;
      const MAX_INFLIGHT = 2;
      const inflight = new Set();
      let buffer = [];
      const flush = () => {
        if (!buffer.length) return;
        const scopes = buffer;
        buffer = [];
        const p = postJsonWithRetry("/api/stats-report/local-scope", { run_id: runId, scopes })
          .then((r) => { if (r.ok) ok += scopes.length; else failed += scopes.length; })
          .catch(() => { failed += scopes.length; })
          .finally(() => { inflight.delete(p); });
        inflight.add(p);
      };
      const maxJobs = data.max_jobs || 0;   // 0 = whole shard (legacy); >0 = one recycle chunk
      const jobsThisChunk = maxJobs > 0 ? Math.min(shardTotal, maxJobs) : shardTotal;
      const completedIdents = [];
      const _chunkStart = performance.now();
      for (let i = 0; i < jobsThisChunk; i++) {
        let parsed = null;
        try {
          parsed = JSON.parse(runOne(i));
        } catch (e) {
          parsed = { error: String(e) };
        }
        if (parsed && parsed.scope) {
          const s = parsed.scope;
          // Stable identity the resume filter (_sr_build) uses to skip a job
          // after a worker recycle — must mirror its _ident() tuple.
          completedIdents.push({
            category: s.category, skill_name: s.skill_name,
            chest_name: s.chest_name, activity_name: s.activity_name,
          });
          buffer.push(s);
          if (buffer.length >= BATCH_SIZE) {
            flush();
            if (inflight.size >= MAX_INFLIGHT) await Promise.race(inflight);
          }
        } else {
          failed++;
        }
        doneInShard++;
        post({ type: "progress", id, done: doneInShard, total: shardTotal, shard_index: shardIndex, global_total: globalTotal });
      }
      flush();
      await Promise.all(inflight); // drain this chunk's POSTs before signalling done
      runOne.destroy();
      const _chunkMs = performance.now() - _chunkStart;
      const _avg = jobsThisChunk ? (_chunkMs / jobsThisChunk) : 0;
      post({ type: "log", stream: "stdout", line:
        "[local-timing] shard " + shardIndex + ": " + jobsThisChunk + " jobs in "
        + (_chunkMs / 1000).toFixed(1) + "s (avg " + _avg.toFixed(0) + "ms/job, "
        + (_avg ? (1000 / _avg).toFixed(1) : "0") + " jobs/s) ok=" + ok + " failed=" + failed });
      const remaining = Math.max(0, shardTotal - jobsThisChunk);
      // NOTE: finalize (/api/stats-report/local-complete) is intentionally NOT
      // called here. With multiple shards only the coordinator (main thread)
      // may finalize, exactly once, after EVERY shard has drained its POSTs.
      post({ type: "result", id, result: { done: doneInShard, ok, failed, shard_index: shardIndex, global_total: globalTotal, remaining: remaining, completed_idents: completedIdents } });
      return;
    }
    // Default task: optimize.
    const runLocal = pyodide.globals.get("_run_local");
    const out = runLocal(JSON.stringify(data.requestData));
    runLocal.destroy();
    const parsed = JSON.parse(out);
    if (parsed.result && typeof parsed.result === "object") {
      post({ type: "result", id, result: parsed.result });
    } else {
      post({ type: "error", id, error: `Local optimizer produced no result (exit ${parsed.exit}). See console for the Python log.` });
    }
  } catch (err) {
    post({ type: "error", id, error: String(err && err.message ? err.message : err) });
  }
};
