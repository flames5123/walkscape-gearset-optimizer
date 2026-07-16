/*
 * Shared client-side (Pyodide) compute helper (FAC: local_optimization).
 *
 * runLocalCompute(task, payload) routes work to a persistent Web Worker that
 * runs the WalkScape Python locally. A SEPARATE worker instance is used per
 * task type so module state never mixes (optimize purges optimizer modules;
 * crafting-tree relies on cached game data) — mirroring the server, which runs
 * optimize in a subprocess but the crafting tree in-process.
 *
 * All Python stdout/stderr from the worker is re-emitted here via
 * console.log/console.error ([local-opt] / [local-tree]) so it flows through
 * debug-console.js and is captured in bug reports. The result is delivered via
 * the worker's {type:'result'} message, independent of the log stream.
 *
 * Tasks:
 *   'optimize'           payload: { requestData }
 *   'crafting-tree-calc' payload: { nodes, global_settings, session_data }
 */

// Cache-bust the Worker script URL. `new Worker(url)` fetches its script via
// the HTTP cache independently of the JS module graph; without a version query
// a stale worker script can keep running even after a deploy (observed: the
// goals-report worker-recycle fix was deployed + served no-store, yet Firefox
// kept executing the OLD worker, so the OOM persisted). Bump WORKER_BUILD
// whenever optimize-local-worker.js changes to force a fresh fetch.
const WORKER_BUILD = 'recycle-8';
const WORKER_URL = "/static/js/optimize-local-worker.js?b=" + WORKER_BUILD;
const _workers = {}; // task -> Worker (one persistent instance each)

// POST JSON with retry/backoff across transient server outages (deploy 502/503
// /504 or a dropped connection for ~20-30s). The local goals-report finalize
// MUST survive a server blip: if it doesn't land, the run stays 'running' in
// the DB, the Optimize button stays disabled, and the user can't start a new
// run until the orphan-resume sweeper eventually reconciles it. Retrying keeps
// the run-completion reliable across a deploy.
async function _postJsonWithRetry(url, bodyObj, { retries = 8, baseDelayMs = 2000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
      });
      if (r.ok || ![429, 500, 502, 503, 504].includes(r.status)) return r;
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) {
      const delay = Math.min(baseDelayMs * Math.pow(1.5, attempt), 10000);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr || new Error('_postJsonWithRetry: exhausted retries');
}

const LOG_TAG = {
  "optimize": "[local-opt]",
  "crafting-tree-calc": "[local-tree]",
  "crafting-tree-optimize": "[local-tree-opt]",
  "travel-optimize": "[local-travel]",
};

function _getWorker(task) {
  if (!_workers[task]) {
    _workers[task] = new Worker(WORKER_URL);
  }
  return _workers[task];
}

// Ref-counted beforeunload guard. While any local compute is in flight, warn
// the user before they reload/close (a reload kills the worker and loses the
// in-progress run). Ref-counted so concurrent runs don't disarm prematurely.
let _guardCount = 0;
function _beforeUnload(e) {
  e.preventDefault();
  e.returnValue = ''; // required for the native "Leave site?" prompt
  return '';
}
export function armUnloadGuard() {
  if (_guardCount === 0) window.addEventListener('beforeunload', _beforeUnload);
  _guardCount++;
}
export function disarmUnloadGuard() {
  _guardCount = Math.max(0, _guardCount - 1);
  if (_guardCount === 0) window.removeEventListener('beforeunload', _beforeUnload);
}

// --- Leave-page -> server handoff (goals report) -----------------------------
// When the user navigates away / closes the tab while a LOCAL goals-report run
// is in flight AND has "Finish on server if I leave the page" enabled, beacon
// the server to finish the run (it has the cached jobs + completed scopes in
// the DB; a --resume worker runs only the remainder). Uses `pagehide` (real
// unload) + sendBeacon, which is the iOS-reliable pattern — NOT
// visibilitychange, so a mere tab-switch (worker keeps running) doesn't hand
// off. In-app SPA navigation doesn't fire pagehide, so it's unaffected too.
let _activeLocalGoalsRun = null; // { run_id, session_uuid }
let _leaveHandoffBeaconed = false;
function _maybeFinishOnServerBeacon() {
  if (_leaveHandoffBeaconed) return;
  const run = _activeLocalGoalsRun;
  if (!run || !run.run_id || !run.session_uuid) return;
  if (!(window.settingsModal && window.settingsModal.finishOnServerOnLeave)) return;
  _leaveHandoffBeaconed = true;
  try {
    const blob = new Blob(
      [JSON.stringify({ run_id: run.run_id, session_uuid: run.session_uuid })],
      { type: 'application/json' });
    navigator.sendBeacon('/api/stats-report/finish-on-server', blob);
    console.log('[local-goals] page leaving — handed run off to the server to finish');
  } catch (e) { /* best-effort */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', _maybeFinishOnServerBeacon);
}

export function runLocalCompute(task, payload) {
  return new Promise((resolve, reject) => {
    const worker = _getWorker(task);
    const tag = LOG_TAG[task] || "[local]";
    const reqId = task + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

    let settled = false;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener("message", onMessage);
      disarmUnloadGuard();
      fn(arg);
    };

    const onMessage = (ev) => {
      const m = ev.data || {};
      if (m.type === "log") {
        // Route worker Python output to the page console (bug-report capture).
        if (m.stream === "stderr") console.error(tag, m.line);
        else console.log(tag, m.line);
        return;
      }
      if (m.type === "ready") {
        console.log(tag, "Pyodide ready");
        return;
      }
      if (m.id && m.id !== reqId) return; // a different request's message
      if (m.type === "result") {
        settle(resolve, m.result);
      } else if (m.type === "error") {
        settle(reject, new Error(m.error || "unknown local compute error"));
      }
    };

    worker.addEventListener("message", onMessage);
    worker.onerror = (e) => {
      settle(reject, new Error("local compute worker crashed: " + (e.message || e.filename || "unknown")));
    };

    armUnloadGuard();
    worker.postMessage(Object.assign({ id: reqId, task }, payload));
  });
}

/**
 * Run a crafting-tree OPTIMIZE locally (FAC: local_optimization). Runs the
 * shared core in a Pyodide worker (same logic as the server), then POSTs the
 * resulting task snapshot (completed_nodes + final_nodes + status) to
 * /api/crafting-tree/optimize-local-result so the existing optimize-status
 * poll picks it up. The unload guard is armed for the run (runLocalCompute).
 *
 * payload: { optimization_id, session_uuid, nodes, global_settings,
 *            session_data, ui_config, node_ids, depth_optimize }
 */
export async function runCraftingTreeOptimizeLocal(payload) {
  const result = await runLocalCompute('crafting-tree-optimize', { payload });
  try {
    await fetch('/api/crafting-tree/optimize-local-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_uuid: payload.session_uuid,
        optimization_id: payload.optimization_id,
        status: result.status || 'complete',
        completed_nodes: result.completed_nodes || [],
        pending: result.pending || 0,
        total: result.total || 0,
        final_nodes: result.final_nodes,
      }),
    });
  } catch (e) {
    console.error('[local-tree-opt] result POST failed:', e);
    throw e;
  }
  return result;
}

// --- Subtree-parallel crafting-tree optimize ---------------------------------
//
// Crafting-tree nodes are DEPENDENT (a parent consumes its children's optimized
// metrics), so we can't shard all nodes like the goals report. But the target's
// independent BRANCHES (each direct child of the root + its descendants) ARE
// disjoint, so we optimize each branch in parallel on its own worker — scoped
// via the `node_ids` the shared core already honors — then merge and run one
// final pass for the root. The server core + worker are reused UNCHANGED; this
// is purely a client-side coordinator (mirrors how the goals report shards
// independent units across the pool).
//
// Falls back to the single-worker path for trees with <2 branches, an unusual
// shape, or if any branch fails — so correctness never depends on the split.

const _ctOptPool = []; // persistent pool of crafting-tree-optimize workers
function _getCtOptWorkers(n) {
  while (_ctOptPool.length < n) _ctOptPool.push(new Worker(WORKER_URL));
  return _ctOptPool.slice(0, n);
}

// Run ONE crafting-tree-optimize task on a SPECIFIC worker (so branches run
// concurrently on different workers). Resolves with the worker's result
// {status, completed_nodes, final_nodes, pending, total}.
function _ctOptimizeOnWorker(worker, payload) {
  return new Promise((resolve, reject) => {
    const tag = '[local-tree-opt]';
    const reqId = 'cto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const onMessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'log') { (m.stream === 'stderr' ? console.error : console.log)(tag, m.line); return; }
      if (m.type === 'ready') { return; }
      if (m.id && m.id !== reqId) return;
      if (m.type === 'result') { worker.removeEventListener('message', onMessage); resolve(m.result); }
      else if (m.type === 'error') { worker.removeEventListener('message', onMessage); reject(new Error(m.error || 'ct optimize error')); }
    };
    worker.addEventListener('message', onMessage);
    worker.onerror = (e) => { worker.removeEventListener('message', onMessage); reject(new Error('ct worker crashed: ' + ((e && (e.message || e.filename)) || 'unknown'))); };
    worker.postMessage({ id: reqId, task: 'crafting-tree-optimize', payload });
  });
}

// Partition nodes into the root, its independent branches (each a root-child +
// all descendants), and the root-chain (everything not in a branch). Returns
// null when the shape isn't safely parallelizable (≠1 root, or <2 branches).
function _partitionTree(nodes) {
  const byId = {};
  for (const n of nodes) byId[n.node_id] = n;
  const childrenOf = {};
  const roots = [];
  for (const n of nodes) {
    const pid = n.parent_id;
    if (pid && byId[pid]) (childrenOf[pid] = childrenOf[pid] || []).push(n.node_id);
    else roots.push(n.node_id);
  }
  if (roots.length !== 1) return null;
  const rootId = roots[0];
  const rootChildren = childrenOf[rootId] || [];
  if (rootChildren.length < 2) return null; // linear/narrow tree — no parallelism win
  const branches = rootChildren.map((childId) => {
    const ids = [];
    const stack = [childId];
    while (stack.length) {
      const id = stack.pop();
      ids.push(id);
      for (const c of (childrenOf[id] || [])) stack.push(c);
    }
    return ids;
  });
  const branchSet = new Set(branches.flat());
  const rootChain = nodes.map((n) => n.node_id).filter((id) => !branchSet.has(id));
  return { rootId, branches, rootChain };
}

// Extract a branch's (possibly Best(auto)-restructured) subtree from a worker
// result by walking parent_id from the branch root in the RESULT — so spliced
// nodes / changed node_ids are captured correctly.
function _subtreeNodes(resultNodes, branchRootId) {
  const byId = {}; const childrenOf = {};
  for (const n of resultNodes) {
    byId[n.node_id] = n;
    const p = n.parent_id;
    if (p) (childrenOf[p] = childrenOf[p] || []).push(n.node_id);
  }
  const out = []; const stack = [branchRootId];
  while (stack.length) {
    const id = stack.pop();
    const n = byId[id];
    if (!n) continue;
    out.push(n);
    for (const c of (childrenOf[id] || [])) stack.push(c);
  }
  return out;
}

/**
 * Subtree-parallel crafting-tree optimize. Same external contract as
 * runCraftingTreeOptimizeLocal (POSTs the final snapshot to the ingest
 * endpoint), but optimizes independent branches concurrently. Falls back to the
 * single-worker path when the tree can't be safely split or a branch fails.
 */
export async function runCraftingTreeOptimizeLocalParallel(payload) {
  const tag = '[local-tree-opt]';
  const part = _partitionTree(payload.nodes || []);
  if (!part) {
    return runCraftingTreeOptimizeLocal(payload); // <2 branches / unusual shape
  }
  const n = Math.min(part.branches.length, SR_MAX_WORKERS);
  console.log(tag, `subtree-parallel: ${part.branches.length} branches across ${n} worker(s)`);
  armUnloadGuard();
  try {
    const workers = _getCtOptWorkers(n);
    const branchResults = await Promise.all(part.branches.map((branchIds, i) =>
      _ctOptimizeOnWorker(workers[i % workers.length], Object.assign({}, payload, { node_ids: branchIds }))
        .catch((e) => { console.error(tag, 'branch', i, 'failed:', e); return null; })
    ));
    if (branchResults.some((r) => !r || !r.final_nodes)) {
      // A branch failed — abandon the split and run the whole tree single-worker
      // so the result is never partial.
      console.warn(tag, 'a branch failed — falling back to single-worker run');
      return runCraftingTreeOptimizeLocal(payload);
    }

    // Merge: start from the original nodes, replace each branch's subtree with
    // its worker's (possibly restructured) subtree.
    const masterById = {};
    for (const node of payload.nodes) masterById[node.node_id] = node;
    let completed = [];
    for (let i = 0; i < part.branches.length; i++) {
      const res = branchResults[i];
      const branchRootId = part.branches[i][0];
      const sub = _subtreeNodes(res.final_nodes, branchRootId);
      for (const oldId of part.branches[i]) delete masterById[oldId];
      for (const node of sub) masterById[node.node_id] = node;
      if (res.completed_nodes) completed = completed.concat(res.completed_nodes);
    }
    const mergedNodes = Object.values(masterById);

    // Final pass: optimize the root-chain against the merged tree (the core
    // recalcs so the root sees the branches' fresh child metrics).
    const finalRes = await _ctOptimizeOnWorker(workers[0],
      Object.assign({}, payload, { nodes: mergedNodes, node_ids: part.rootChain }));
    const finalNodes = (finalRes && finalRes.final_nodes) || mergedNodes;
    if (finalRes && finalRes.completed_nodes) completed = completed.concat(finalRes.completed_nodes);

    await fetch('/api/crafting-tree/optimize-local-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_uuid: payload.session_uuid,
        optimization_id: payload.optimization_id,
        status: 'complete',
        completed_nodes: completed,
        pending: 0,
        total: completed.length,
        final_nodes: finalNodes,
      }),
    });
    return { status: 'complete', completed_nodes: completed, final_nodes: finalNodes };
  } finally {
    disarmUnloadGuard();
  }
}

/**
 * Run a column-3 travel gearset optimization locally (FAC: local_optimization).
 * Runs the UNMODIFIED ui.travel_optimize_worker.main() in a Pyodide worker, then
 * POSTs the resulting response dict to /api/travel/optimize/local-result so the
 * server persists the named gearset + marks the task complete (identical DB
 * outcome to the server subprocess path). The unload guard is armed for the run.
 *
 * @param {Object} payload { task_key, request_data } from the server's
 *        run_local response to /api/travel/optimize.
 * @returns the worker's result dict (gearset_export, stats, alternatives, ...).
 */
export async function runTravelOptimizeLocal(payload) {
  const result = await runLocalCompute('travel-optimize', { requestData: payload.request_data });
  await _postJsonWithRetry('/api/travel/optimize/local-result', {
    task_key: payload.task_key,
    result,
  });
  return result;
}

/** True when the local_optimization FAC is on AND the user enabled the toggle. */
export function isLocalComputeEnabled() {
  return !!(
    window._featureFlags && window._featureFlags.local_optimization &&
    window.settingsModal && window.settingsModal.runLocalOptimization
  );
}

/**
 * Run a goals-report (stats report) run locally, ACROSS MULTIPLE Pyodide
 * workers in parallel.
 *
 * The server runs the goals report SERIALLY (STATS_REPORT_WORKER_CONCURRENCY=1,
 * lock-serialized), and Pyodide's WASM penalty (~3-5x) roughly cancels a fast
 * laptop's per-core advantage — so a single local worker is no faster than the
 * server. The win that is available locally and NOT on the serial server is
 * PARALLELISM: run N workers across the user's cores, each computing a shard of
 * the jobs (job i -> worker i % N). ~10 jobs across ~5 workers ≈ ~5x.
 *
 * Each shard worker builds the identical job list and runs only its indices,
 * POSTing its own scopes to /api/stats-report/local-scope. This coordinator
 * aggregates per-shard progress into a single global count (relayed to
 * onProgress, which the page renders via the statsReportLocalProgress event)
 * and finalizes the run EXACTLY ONCE after every shard has drained its POSTs.
 *
 * payload: { run_params, session, completed?, jobCountHint? }
 */
const SR_MAX_WORKERS = 3;   // cap concurrent Pyodide instances. Each worker loads
                            // the full runtime+bundle (~hundreds of MB baseline);
                            // 6 in parallel exhausted device memory and the heavier
                            // recipe optimizations OOMed (MemoryError -> metric 0).
const _srPool = [];         // persistent pool of stats-report shard workers

function _statsWorkerCount(jobCountHint) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  // ~half the cores (leave headroom for the UI thread + GC), capped, and never
  // more workers than there are jobs to run.
  let n = Math.max(1, Math.floor(cores / 2));
  n = Math.min(n, SR_MAX_WORKERS);
  if (jobCountHint && jobCountHint > 0) n = Math.min(n, jobCountHint);
  return Math.max(1, n);
}

function _getStatsWorkers(n) {
  while (_srPool.length < n) _srPool.push(new Worker(WORKER_URL));
  return _srPool.slice(0, n);
}

export function runStatsReportLocal(payload, onProgress) {
  const tag = '[local-goals]';
  console.log(tag, 'coordinator build ' + WORKER_BUILD);
  const baseId = 'sr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const runId = (payload && payload.run_params && payload.run_params.run_id) || null;

  // Jobs a worker runs before it's recycled (terminate + respawn) to reset its
  // Pyodide WASM heap. The recipe optimizer accreted memory across jobs in one
  // interpreter and threw MemoryError after ~150 jobs, storing metric 0 for the
  // rest. Recycling is the hard guarantee a long shard never exhausts the heap.
  const SR_RECYCLE_CHUNK = 15;
  const SR_MAX_CHUNKS = 60; // safety bound vs a pathological non-OOM job looping

  // ── Per-category parallelism policy ─────────────────────────────────────
  // chests_recipes re-optimizes EACH recipe across every crafting service (the
  // kitchens/looms), so one job allocates far more than the per-activity
  // categories. At the default 3-wide parallelism those concurrent WASM heaps
  // exhausted device memory and the heavy recipes threw MemoryError -> stored
  // metric 0 (skipped) and the run hung on "Finishing" retrying them (bug
  // 46fadf03). Fix: run each category GROUP as its own sharded pass with its
  // own worker count + recycle chunk, so ONLY the heavy category loses
  // parallelism; the light categories keep full speed. Tunable per category.
  // 2026-07-06: even 2-wide OOMed (bug 7091473e) once "include consumables"
  // folds the consumable into the recipe search slot (bigger combo space), so
  // chests_recipes is now fully serial (1 worker) with a small recycle chunk.
  const SR_CATEGORY_WORKER_CAP = { chests_recipes: 1 };     // default: defaultWorkers
  const SR_CATEGORY_RECYCLE_CHUNK = { chests_recipes: 4 };  // default: SR_RECYCLE_CHUNK
  const defaultWorkers = _statsWorkerCount(payload && payload.jobCountHint);

  // Partition the run's categories into groups sharing a worker cap; same-cap
  // categories run together in one pass. Higher-parallelism (light) groups run
  // first; the throttled heavy group runs LAST, alone, for max memory headroom.
  const _allCats = (payload && payload.run_params && payload.run_params.categories) || [];
  const _capOf = (c) => Math.max(1, Math.min(SR_CATEGORY_WORKER_CAP[c] || defaultWorkers, defaultWorkers));
  const _chunkOf = (c) => SR_CATEGORY_RECYCLE_CHUNK[c] || SR_RECYCLE_CHUNK;
  const _groupMap = new Map();
  for (const c of _allCats) {
    const cap = _capOf(c);
    const g = _groupMap.get(cap) || { cats: [], chunk: SR_RECYCLE_CHUNK };
    g.cats.push(c);
    g.chunk = Math.min(g.chunk, _chunkOf(c));
    _groupMap.set(cap, g);
  }
  let _groups = [..._groupMap.entries()].map(([cap, g]) => ({ workers: cap, cats: g.cats, chunk: g.chunk }));
  if (!_groups.length) _groups = [{ workers: defaultWorkers, cats: _allCats, chunk: SR_RECYCLE_CHUNK }];
  _groups.sort((a, b) => b.workers - a.workers);

  // Free pooled workers beyond what a pass needs, so a throttled pass actually
  // reclaims the memory the wider prior pass held (idle Pyodide workers keep
  // hundreds of MB resident). Preserves warm reuse when the pool already fits.
  const _resetStatsPoolTo = (want) => {
    while (_srPool.length > want) { try { _srPool.pop().terminate(); } catch (_) { /* ignore */ } }
  };

  // ── Cumulative progress across all category passes ──────────────────────
  let globalTotal = 0;   // full job count across ALL categories (summed per pass)
  let doneBase = 0;      // jobs attempted in prior (finished) passes
  let perShardDone = []; // current pass, per shard
  let passTotalSeen = 0; // current pass's own reported global_total
  const emit = () => {
    if (!onProgress) return;
    let done = doneBase + perShardDone.reduce((a, b) => a + b, 0);
    if (globalTotal > 0) done = Math.min(done, globalTotal);
    try { onProgress(done, globalTotal); } catch (e) { /* ignore */ }
  };

  console.log(tag, 'running locally: ' + _groups.map(g => g.cats.join('+') + '@' + g.workers + 'w/c' + g.chunk).join(', '));
  // Track this run so the pagehide handler can hand it off to the server if
  // the user leaves with "Finish on server if I leave" enabled.
  _activeLocalGoalsRun = { run_id: runId, session_uuid: (payload && payload.run_params && payload.run_params.session_uuid) || null };
  _leaveHandoffBeaconed = false;
  armUnloadGuard();

  // Pass-scoped mutable bindings that runChunk/runShard close over. The driver
  // reassigns them before each category pass. Passes run sequentially (awaited),
  // so only one pass is ever in flight — the shared bindings are safe.
  let n = defaultWorkers;
  let workers = [];
  let srChunk = SR_RECYCLE_CHUNK;
  let passParams = payload.run_params;
  let completedIn = (payload.completed || []);
  let passId = '';

  // Run ONE chunk (up to srChunk jobs) of shard k on `worker`, with the
  // jobs already finished by this shard passed as `completed` so _sr_build skips
  // them. Resolves with the chunk's totals + remaining + completed_idents.
  const runChunk = (worker, k, completedForShard, chunkBase) => new Promise((resolve) => {
    const subId = baseId + passId + '_s' + k + '_c' + completedForShard.length;
    // Inactivity watchdog: a worker that OOMs WHILE serializing its result
    // (MemoryError in json.dumps) can die without ever posting 'result' or
    // 'error' and without firing worker.onerror -- the chunk Promise then
    // never resolves, the shard hangs, and the whole run sits at
    // "finishing..." forever (prod bug). Any message (log/progress/result)
    // re-arms the timer; if the worker goes silent for WATCHDOG_MS we
    // terminate it and resolve with an error so the shard/run can proceed.
    const WATCHDOG_MS = 120000;
    let settled = false;
    let wd = null;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(wd);
      worker.removeEventListener('message', onMessage);
      resolve(val);
    };
    const arm = () => {
      clearTimeout(wd);
      wd = setTimeout(() => {
        console.error(tag, 'shard ' + k + ' watchdog: no activity for ' + (WATCHDOG_MS / 1000) + 's — terminating wedged worker');
        try { worker.terminate(); } catch (_) { /* ignore */ }
        finish({ ok: 0, failed: 0, done: 0, remaining: 0, completed_idents: [], error: 'worker timeout' });
      }, WATCHDOG_MS);
    };
    function onMessage(ev) {
      arm(); // any message proves the worker is still alive
      const m = ev.data || {};
      if (m.type === 'log') {
        if (m.stream === 'stderr') console.error(tag, m.line);
        else console.log(tag, m.line);
        return;
      }
      if (m.type === 'ready') { console.log(tag, 'Pyodide ready'); return; }
      if (m.id && m.id !== subId) return; // another shard's / chunk's message
      if (m.type === 'progress') {
        if (typeof m.global_total === 'number' && m.global_total > passTotalSeen) {
          globalTotal += (m.global_total - passTotalSeen);
          passTotalSeen = m.global_total;
        }
        perShardDone[k] = chunkBase + (m.done || 0);
        emit();
        return;
      }
      if (m.type === 'result') {
        const r = m.result || {};
        finish({ ok: r.ok || 0, failed: r.failed || 0, done: r.done || 0,
                 remaining: r.remaining || 0, completed_idents: r.completed_idents || [] });
      } else if (m.type === 'error') {
        console.error(tag, 'shard ' + k + ' failed:', m.error);
        finish({ ok: 0, failed: 0, done: 0, remaining: 0, completed_idents: [], error: m.error || 'shard error' });
      }
    }
    worker.addEventListener('message', onMessage);
    worker.onerror = (e) => {
      console.error(tag, 'shard ' + k + ' worker crashed:', (e && (e.message || e.filename)) || 'unknown');
      finish({ ok: 0, failed: 0, done: 0, remaining: 0, completed_idents: [], error: 'worker crashed' });
    };
    arm();
    worker.postMessage({
      id: subId,
      task: 'stats-report',
      shard_index: k,
      shard_count: n,
      max_jobs: srChunk,
      run_params: passParams,
      session: payload.session,
      completed: completedIn.concat(completedForShard),
    });
  });

  // Drive shard k across recycle chunks. After each chunk the heap-bloated
  // worker is terminated and replaced with a fresh one (which re-builds and
  // skips the completed jobs), so no single interpreter runs more than
  // SR_RECYCLE_CHUNK jobs.
  const runShard = async (k) => {
    let worker = workers[k];
    let shardCompleted = [];   // idents this shard has finished (drives resume-skip)
    let baseDone = 0;          // attempts across prior chunks (for progress base)
    let okTot = 0, failedTot = 0, lastErr = null, consecutiveErr = 0;
    for (let chunk = 0; chunk < SR_MAX_CHUNKS; chunk++) {
      const res = await runChunk(worker, k, shardCompleted, baseDone);
      okTot += res.ok || 0;
      failedTot += res.failed || 0;
      baseDone += res.done || 0;
      if (Array.isArray(res.completed_idents) && res.completed_idents.length) {
        shardCompleted = shardCompleted.concat(res.completed_idents);
      }
      perShardDone[k] = baseDone;
      emit();
      if (res.error) {
        lastErr = res.error;
        consecutiveErr += 1;
        // The wedged/crashed worker was already terminated (watchdog/onerror).
        // Recycle once and continue so the shard's remaining jobs still run,
        // but give up after 2 straight failures so a deterministically-wedging
        // job (e.g. a too-large result that OOMs json.dumps) can't stall the
        // whole run -- better to finalize and let the next run self-heal it.
        if (consecutiveErr >= 2) break;
      } else {
        consecutiveErr = 0;
        // A chunk that OOMed leaves failed jobs (no scope POSTed), so their
        // stale 0 rows persist. Those jobs are NOT in shardCompleted, so a
        // fresh worker re-runs them on a clean heap and overwrites the 0s.
        const retryFailed = (res.failed || 0) > 0;
        if (!res.remaining && !retryFailed) break;
      }
      try { worker.terminate(); } catch (_) { /* ignore */ }
      worker = new Worker(WORKER_URL);
      _srPool[k] = worker; // keep the pool pointing at the live worker
      console.log(tag, 'shard ' + k + ' recycled after chunk ' + chunk + ' (' + shardCompleted.length + ' done, ' + (res.remaining || 0) + ' remaining, ' + (res.failed || 0) + ' to retry' + (res.error ? ', err=' + res.error : '') + ')');
    }
    return { ok: okTot, failed: failedTot, done: baseDone, error: lastErr, completed: shardCompleted };
  };

  // Run each category group as its own sharded pass (sequentially), threading
  // completed idents forward so later passes skip finished scopes. Only the
  // throttled (heavy) group runs at reduced parallelism. Finalize EXACTLY ONCE.
  return (async () => {
    let ok = 0, failed = 0, done = 0;
    let completedAll = (payload.completed || []).slice();
    for (let gi = 0; gi < _groups.length; gi++) {
      const g = _groups[gi];
      const cats = (g.cats || []).filter(Boolean);
      if (!cats.length) continue;
      // Bind the pass-scoped state that runChunk/runShard close over.
      n = Math.max(1, Math.min(g.workers, defaultWorkers));
      _resetStatsPoolTo(n);            // free wider prior pass's idle workers
      workers = _getStatsWorkers(n);
      srChunk = g.chunk;
      passParams = Object.assign({}, payload.run_params, { categories: cats });
      completedIn = completedAll;
      passId = '_p' + gi;
      perShardDone = new Array(n).fill(0);
      passTotalSeen = 0;
      console.log(tag, 'pass ' + gi + ': ' + cats.join('+') + ' across ' + n + ' worker(s), chunk=' + srChunk);
      const results = await Promise.all(workers.map((w, k) => runShard(k)));
      ok += results.reduce((a, r) => a + (r.ok || 0), 0);
      failed += results.reduce((a, r) => a + (r.failed || 0), 0);
      const passAttempts = results.reduce((a, r) => a + (r.done || 0), 0);
      done += passAttempts;
      doneBase += passAttempts;        // roll into the cumulative progress base
      const passCompleted = results.reduce((a, r) => a.concat(r.completed || []), []);
      if (passCompleted.length) completedAll = completedAll.concat(passCompleted);
    }
    // Finalize ONCE, after every pass has drained its scope POSTs: compute the
    // inventory fingerprint + flip the run to complete (the server worker's
    // final step). Done here (not in the workers) so it runs exactly once.
    if (runId) {
      try {
        await _postJsonWithRetry('/api/stats-report/local-complete', { run_id: runId });
      } catch (e) { /* non-fatal — orphan-resume reconciles */ }
    }
    return { done, ok, failed };
  })().finally(() => { _activeLocalGoalsRun = null; disarmUnloadGuard(); });
}

/**
 * On page load, resume an in-progress client-side goals-report run if one
 * survived a reload (still in the server's in-memory cache). Runs only the
 * remaining (not-yet-completed) jobs. Safe no-op when the FAC/toggle is off or
 * nothing is resumable. Fire-and-forget.
 */
export async function maybeResumeLocalGoalsReport(onProgress) {
  // Gate on the FAC only (not the toggle): an in-progress LOCAL run should
  // resume regardless of the user's current new-run preference. The server's
  // resume-info endpoint is FAC-gated and only flags genuine local runs.
  if (!(window._featureFlags && window._featureFlags.local_optimization)) return false;
  // If the user enabled "Finish on server if I leave", an interrupted run was
  // (or will be) handed off to the server — don't start a competing LOCAL
  // resume here. The existing /status poll surfaces the server's progress.
  if (window.settingsModal && window.settingsModal.finishOnServerOnLeave) return false;
  let info;
  try {
    const resp = await fetch('/api/stats-report/local-resume-info', { cache: 'no-store' });
    if (!resp.ok) return false;
    info = await resp.json();
  } catch (e) {
    return false;
  }
  if (!info || !info.resumable || !info.run_params) return false;
  // Don't silently resume — prompt the user (Continue in browser / Finish on
  // server / Dismiss). The continue-local-run-popup component listens for this
  // and calls resumeLocalGoalsReportNow() or the finish-on-server endpoint.
  try {
    window.dispatchEvent(new CustomEvent('goalsReportResumePrompt', { detail: { info } }));
  } catch (e) { /* ignore */ }
  return true;
}

/**
 * Resume an interrupted local goals-report run in the browser (the "Continue
 * in browser" choice from the return prompt). Kept separate from
 * maybeResumeLocalGoalsReport so the popup can trigger it on demand.
 */
export function resumeLocalGoalsReportNow(info) {
  if (!info || !info.run_params) return;
  const alreadyDone = (info.completed || []).length;
  console.log('[local-goals] resuming run', info.run_id,
    '(' + alreadyDone + ' scopes already done)');
  runStatsReportLocal(
    { run_params: info.run_params, session: info.session, completed: info.completed || [] },
    (done, total) => {
      // runStatsReportLocal reports `done` over the REMAINDER it actually
      // runs (the already-completed scopes are filtered out of the worker's
      // job list), but `total` is the FULL job count. Report ABSOLUTE
      // progress (alreadyDone + done) so the progress bar starts at the
      // resume point and climbs to total — otherwise the page's
      // monotonic-max kept the bar pinned at the already-completed count
      // (e.g. stuck at 48) until the relative `done` slowly caught up.
      try { window.dispatchEvent(new CustomEvent('statsReportLocalProgress', { detail: { done: alreadyDone + done, total } })); }
      catch (e) { /* ignore */ }
    }
  ).catch((e) => console.error('[local-goals] resume failed:', e));
}

/**
 * Hard-reset all in-browser goals-report local-run state. Called from the
 * goals-report Reset button so a Reset truly clears the LOCAL (Pyodide)
 * optimization too — not just the server rows. Without this, the persistent
 * shard-worker pool kept grinding the previous run's job list and a later
 * "Continue locally" resumed the prior browser session's work (user-reported:
 * "reset then continue locally starts from what the last session was doing").
 *
 * Terminates the shard worker pool (killing any in-flight browser computation),
 * clears the active-run handoff tracking, and disarms the unload guard.
 */
export function resetLocalGoalsReport() {
  try {
    for (const w of _srPool) {
      try { w.terminate(); } catch (_) { /* ignore */ }
    }
    _srPool.length = 0;
  } catch (_) { /* ignore */ }
  _activeLocalGoalsRun = null;
  _leaveHandoffBeaconed = false;
  // Best-effort: ensure the beforeunload guard isn't left armed by an
  // abandoned run. Reset the ref-count and remove the listener.
  try {
    _guardCount = 0;
    window.removeEventListener('beforeunload', _beforeUnload);
  } catch (_) { /* ignore */ }
}
