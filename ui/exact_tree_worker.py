"""Out-of-process entrypoint for the EXACT crafting-tree solve.

Why this exists (2026-10-09):
The exact bottom-up solver (ui/crafting_tree_exact_driver.optimize_tree_exact)
is a pure-Python branch-and-bound search. When it ran INLINE inside the server
background task (app._run_crafting_tree_optimization -> optimize_crafting_tree),
it executed in a Starlette threadpool thread *inside the main web process* and
held the GIL for tens of seconds per node. That starved the event loop: every
other request (/api/trading/*, /api/comparison-stats, session config PATCHes)
slowed to 19-41s and the container's health check flipped to "unhealthy",
taking the main site down (incidents 2026-10-09 05:40 / 05:49).

os.nice() on an in-process thread does NOT fix this: nice only arbitrates OS
scheduling between runnable threads, and the event-loop thread is blocked
waiting for the GIL, not for a CPU slot. The fix is to run the solve in a
SEPARATE PROCESS (freeing the GIL so the web process serves requests normally)
and renice THAT process so it yields CPU under contention. This mirrors the
established pattern in ui/stats_report_worker.py and the per-node heuristic
executor (ui/optimize_worker.py).

Invocation (from app._run_crafting_tree_optimization's exact_executor):
    python -m ui.exact_tree_worker <in_file.json> <out_file.json>

in_file  (written by the parent): {
    session_uuid, nodes, global_settings, session_data, ui_config, node_budget
}
out_file (written by this worker): {ok: True, nodes: [...], diag: {...}}
                                or {ok: False, error: str, traceback: str}

All payload fields are JSON values: `nodes` originates from the request body,
`session_data`/`ui_config`/`global_settings` from the stored session JSON, and
the solved `nodes` are consumed as JSON downstream by the optimize-status poll.
So the JSON round-trip here is lossless by construction. Any failure is written
to out_file (ok=False) and signalled via a non-zero exit; the caller's exact
branch then falls back to the heuristic path.
"""

import json
import os
import sys


def _nice_from_env(raw, default=15):
    """Clamp a requested niceness into the valid 0..19 range.

    0 disables the renice (returns 0). Non-integer / missing values fall back
    to `default`. Mirrors ui/stats_report_worker.py's clamp.
    """
    try:
        return max(0, min(19, int(raw)))
    except (TypeError, ValueError):
        return max(0, min(19, int(default)))


def _apply_renice():
    """Best-effort self-renice. Tunable via EXACT_TREE_WORKER_NICE (0..19,
    default 15); 0 disables. Never aborts the run over a failed renice."""
    try:
        nice_target = _nice_from_env(os.environ.get("EXACT_TREE_WORKER_NICE", "15"))
        if nice_target:
            os.nice(nice_target)
            print(f"[exact_tree_worker] reniced to +{nice_target} "
                  f"(background CPU throttle)", flush=True)
    except Exception as nice_err:  # noqa: BLE001
        print(f"[exact_tree_worker] renice skipped ({nice_err!r})", flush=True)


def run(in_file, out_file):
    """Load the payload, run the exact solve + authoritative metrics refresh,
    and write the solved nodes back out. Returns a process exit code."""
    with open(in_file) as f:
        payload = json.load(f)

    session_uuid = payload.get("session_uuid")
    nodes = payload["nodes"]
    global_settings = payload.get("global_settings") or {}
    session_data = payload.get("session_data")
    ui_config = payload.get("ui_config") or {}
    node_budget = int(payload.get("node_budget", 400_000))

    def _log(msg, _su=None):
        # The parent captures stdout and replays these through app.log so the
        # /crafting-tree/optimize-status poll surfaces the same diagnostics as
        # the inline path did.
        print(msg, flush=True)

    try:
        from ui.crafting_tree_exact_driver import optimize_tree_exact
        from ui.crafting_tree import (calculate_tree as _ct_calc,
                                      _load_game_data as _ct_load)
        diag = optimize_tree_exact(
            session_uuid, nodes, global_settings, session_data, ui_config,
            node_budget=node_budget, log=_log,
        )
        # Authoritative metrics from the tree's own display path (identical to
        # the former inline sequence in crafting_tree_optimize.py).
        try:
            _ct_calc(nodes, global_settings, _ct_load(), session_data)
        except Exception as calc_err:  # noqa: BLE001
            _log(f"Crafting tree exact: calculate_tree refresh failed "
                 f"({calc_err!r})")
    except Exception as solve_err:  # noqa: BLE001
        import traceback
        with open(out_file, "w") as f:
            json.dump({"ok": False, "error": repr(solve_err),
                       "traceback": traceback.format_exc()}, f)
        print(f"[exact_tree_worker] FAILED ({solve_err!r})", flush=True)
        return 1

    with open(out_file, "w") as f:
        json.dump({"ok": True, "nodes": nodes, "diag": diag}, f)
    return 0


def main(argv=None):
    argv = list(sys.argv if argv is None else argv)
    if len(argv) < 3:
        print("usage: python -m ui.exact_tree_worker <in_file> <out_file>",
              file=sys.stderr)
        return 2
    _apply_renice()
    return run(argv[1], argv[2])


if __name__ == "__main__":
    sys.exit(main())
