/*
 * Crafting-tree optimize CORRECTNESS GATE (dev tool, FAC: local_optimization).
 *
 * Runs the SAME crafting tree through BOTH the server (subprocess) optimize and
 * the in-browser (Pyodide) optimize, then diffs the resulting per-node gearsets
 * and metrics. This is how we prove the in-process local port produces
 * identical results to the server before relying on it.
 *
 * Usage (browser console, with a crafting tree open and the local_optimization
 * FAC on):
 *     await window.__ctOptimizeDiff()
 *
 * It reads the live tree from the store (ui.crafting_tree.nodes /
 * global_settings, session.uuid). Pass {nodes, globalSettings, sessionUuid} to
 * override. Returns a structured report and console.table()s the per-node diff.
 *
 * NOTE: this runs TWO full optimizes (server + local), so it is slow — it's a
 * verification tool, not part of the normal flow.
 */

import store from './state.js';
import { runLocalCompute } from './local-compute.js';

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fields compared per node. Gearset export is the strongest signal (full
// equipment set); metrics/stats catch scoring differences; underlying route id
// catches a different Best(auto) route being chosen.
function _nodeSig(node) {
  const gc = (node && node.gear_config) || {};
  const m = (node && node.metrics) || {};
  const st = gc.optimized_stats || {};
  return {
    gearset: gc.optimized_export || null,
    steps_per_item: m.steps_per_item != null ? Number(m.steps_per_item) : null,
    we: st.work_efficiency != null ? Number(st.work_efficiency) : null,
    dr: st.double_rewards != null ? Number(st.double_rewards) : null,
    qo: st.quality_outcome != null ? Number(st.quality_outcome) : null,
    route: node ? (node.underlying_source_id || node.source_id || null) : null,
  };
}

function _approxEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return a === b;
}

function _diffNodes(serverNodes, localNodes) {
  const byId = (arr) => {
    const m = {};
    for (const n of arr || []) if (n && n.node_id) m[n.node_id] = n;
    return m;
  };
  const s = byId(serverNodes);
  const l = byId(localNodes);
  const ids = new Set([...Object.keys(s), ...Object.keys(l)]);
  const rows = [];
  let mismatches = 0;
  for (const id of ids) {
    const sn = s[id], ln = l[id];
    if (!sn || !ln) {
      mismatches++;
      rows.push({ node_id: id, status: !sn ? 'MISSING_ON_SERVER' : 'MISSING_LOCAL' });
      continue;
    }
    const ssig = _nodeSig(sn), lsig = _nodeSig(ln);
    const fieldDiffs = [];
    for (const k of Object.keys(ssig)) {
      if (!_approxEq(ssig[k], lsig[k])) fieldDiffs.push(k);
    }
    if (fieldDiffs.length) {
      mismatches++;
      rows.push({
        node_id: id, status: 'MISMATCH', fields: fieldDiffs.join(','),
        server: JSON.stringify(ssig), local: JSON.stringify(lsig),
      });
    } else {
      rows.push({ node_id: id, status: 'match' });
    }
  }
  return { mismatches, total: ids.size, rows };
}

async function _runServerOptimize(nodes, globalSettings, sessionUuid) {
  const post = await fetch('/api/crafting-tree/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes, global_settings: globalSettings, session_uuid: sessionUuid,
      node_ids: null, depth_optimize: false, run_local: false,
    }),
  }).then((r) => r.json());
  if (post && post.run_local) {
    throw new Error('server run unexpectedly returned run_local — FAC routing issue');
  }
  // Poll the status endpoint to completion (~15 min cap).
  for (let i = 0; i < 600; i++) {
    await _sleep(1500);
    const st = await fetch(
      `/api/crafting-tree/optimize-status?session_uuid=${encodeURIComponent(sessionUuid)}`
    ).then((r) => r.json());
    if (st.status === 'complete') return st.nodes || [];
    if (st.status === 'error') throw new Error('server optimize error: ' + (st.error || 'unknown'));
  }
  throw new Error('server optimize timed out');
}

async function _runLocalOptimize(nodes, globalSettings, sessionUuid) {
  // Handshake (run_local) to get session_data + ui_config for the worker.
  const hs = await fetch('/api/crafting-tree/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes, global_settings: globalSettings, session_uuid: sessionUuid,
      node_ids: null, depth_optimize: false, run_local: true,
    }),
  }).then((r) => r.json());
  if (!hs || !hs.run_local) {
    throw new Error('local handshake did not return run_local (FAC off server-side?)');
  }
  const result = await runLocalCompute('crafting-tree-optimize', {
    payload: {
      optimization_id: hs.optimization_id,
      session_uuid: sessionUuid,
      nodes, global_settings: globalSettings,
      session_data: hs.session_data, ui_config: hs.ui_config,
      node_ids: null, depth_optimize: false,
    },
  });
  return (result && result.final_nodes) || [];
}

export async function ctOptimizeDiff(opts = {}) {
  const nodes = opts.nodes || store.get('ui.crafting_tree.nodes') || [];
  const globalSettings = opts.globalSettings || store.get('ui.crafting_tree.global_settings') || {};
  const sessionUuid = opts.sessionUuid || store.get('session.uuid');
  if (!nodes.length) throw new Error('No crafting tree nodes (open a tree first or pass {nodes}).');
  if (!sessionUuid) throw new Error('No session.uuid in store.');

  console.log('[ct-diff] running SERVER optimize…');
  const serverNodes = await _runServerOptimize(nodes, globalSettings, sessionUuid);
  console.log('[ct-diff] server done:', serverNodes.length, 'nodes. running LOCAL optimize…');
  const localNodes = await _runLocalOptimize(nodes, globalSettings, sessionUuid);
  console.log('[ct-diff] local done:', localNodes.length, 'nodes. diffing…');

  const report = _diffNodes(serverNodes, localNodes);
  try { console.table(report.rows); } catch (e) { console.log(report.rows); }
  if (report.mismatches === 0) {
    console.log(`%c[ct-diff] PASS — ${report.total} nodes identical (server == local)`, 'color:#2e7d32;font-weight:bold');
  } else {
    console.warn(`[ct-diff] FAIL — ${report.mismatches}/${report.total} nodes differ. See table above.`);
  }
  return report;
}

if (typeof window !== 'undefined') {
  window.__ctOptimizeDiff = ctOptimizeDiff;
}
