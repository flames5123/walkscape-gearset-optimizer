"""Exact XP/step activity gearset optimizer (goals report) — XP objective on the
shared ExactGearsetOptimizer engine.

This module is now a THIN objective on top of util/exact_gearset_optimizer.py:
it only supplies the XP numerator; all branch-and-bound machinery (Pareto
pruning, tool-pool frontier, set meta-items, best-first ordering, WE-reserve
bound, WE-saturated collapse, node-budget safety valve) lives in the base
engine so coins/chests/drops can plug in their own numerators.

Public surface (unchanged for callers):
  exact_xp_optimize(activity, character, ...) -> {slot: Item|None} | None
  last_run_budget_exhausted  (module attr, set after each call)
  _EXACT_NODE_BUDGET         (module attr, tunable)
"""
import math

from util.exact_gearset_optimizer import ExactGearsetOptimizer

# Tunable node budget (kept at module level so the worker + tests can read/set
# it). Drives the optimizer instance's NODE_BUDGET.
_EXACT_NODE_BUDGET = 5_000_000

# Experimental: route XP/step through the Dinkelbach fractional-programming loop
# (sequence of linearized max(num - lambda*steps) subproblems) instead of the
# direct ratio B&B. MEASURED net regression on the never-saturating hard
# activities (walks the near-optimal plateau ~2x); kept off. Code stays as a
# seam for a future MITM inner solver.
_USE_DINKELBACH = False

# "Today's changes" toggle (the goals-report old/new checkbox drives these on the
# gated session). NEW way = ring de-dup on + slot-order "tools_first" (visit the
# WE-heavy tool/ring slots first so the WE cap saturates early and the rest of
# the tree runs on the collapsed frontier). OLD way = ring de-dup off + slot-
# order "constrained". The exact B&B, the 5M node cap, and the greedy+1-4swap
# valve fallback are present in BOTH modes. Order is a pure pruning heuristic —
# the optimum is identical either way (tests/test_slot_order_strategies.py).
_DEDUP_RING_ORDER = True
_SLOT_ORDER_STRATEGY = "tools_first"

# ── plateau-dump diagnostic ───────────────────────────────────────────────
# One-off instrumentation to inspect WHY the never-saturating activities spend
# millions of nodes proving optimality. When _DUMP_PLATEAU is True, the ratio
# B&B records every complete gearset within 1% of the best for the activity
# whose (lower-cased) name contains _PLATEAU_TARGET, and writes them to
# _PLATEAU_OUT (item names + 6-axis vectors) so we can test whether the plateau
# is Pareto-incomparable. The budget is auto-lifted for that one activity so the
# plateau is captured complete. Leave _DUMP_PLATEAU False in normal operation.
_DUMP_PLATEAU = False

# MITM viability probe: log per-group Pareto-frontier sizes per XP activity.
# Auto-gated to exact-allowlisted sessions (only they run the exact _run).
_GROUP_FRONTIER_DIAG = False

# MITM prototype: for no-requirement, no-set-meta XP activities, run
# meet-in-the-middle group-DP alongside the B&B and log [MITM] match + speedup.
_MITM_ENABLED = True
_PLATEAU_TARGET = "bird watching"
_PLATEAU_OUT = "/tmp/plateau_dump_birdwatching.json"

# Set after every exact_xp_optimize call: True when the node budget was
# exhausted and the returned gearset is the best-first INCUMBENT (not proven
# optimal). The worker reads this to decide whether to also run greedy+refine
# and keep the better of the two.
last_run_budget_exhausted = False
last_run_diag = None

# Diagnostic [EXACT_DBG] logging (per-candidate WE/cap/R for one slot). Kept on
# by default to preserve the existing debug capture; set False to silence.
_EXACT_XP_DEBUG = True
_EXACT_XP_DEBUG_SLOT = "legs"


class ExactXpOptimizer(ExactGearsetOptimizer):
    """XP/step objective: maximize (base_xp + bonus_xp_add)*(1+bonus_xp_pct)
    per expected step. Axis model is the engine default (A_xp, P_xp drive the
    numerator; W/S_pct/S_add/B drive the shared steps denominator)."""

    def numerator(self, X0, s):
        return (X0 + s["A_xp"]) * (1.0 + s["P_xp"])

    def numerator_bound(self, X0, s, R):
        # Admissible: independent per-slot max of A_xp and P_xp reserves.
        return (X0 + s["A_xp"] + R["A_xp"]) * (1.0 + s["P_xp"] + R["P_xp"])

    def _combine_best(self, FG, FA, reqs, X0, S0, kappa, WE_level, base_stats):
        """Inlined XP FG × FA combine. Bit-identical to the base reference (same
        float association: axp_tot/pxp_tot summed before the outer op), hoisting
        gear-side scalars and inlining the numerator ((X0+A_xp)*(1+P_xp)) and the
        steps args — no per-pair dict(zip(...)) rebuild, no numerator() call."""
        AXES = self.AXES
        s0 = {a: float(base_stats.get(a, 0.)) for a in AXES}
        s0v = tuple(s0[a] for a in AXES)
        iAx = AXES.index("A_xp"); iPx = AXES.index("P_xp")
        iW = AXES.index("W"); iSa = AXES.index("S_add"); iSp = AXES.index("S_pct"); iB = AXES.index("B")
        s0Ax = s0v[iAx]; s0Px = s0v[iPx]
        s0W = s0v[iW]; s0Sa = s0v[iSa]; s0Sp = s0v[iSp]; s0B = s0v[iB]
        FGv = [(tuple(g["v"][a] for a in AXES), g["kw"], g["comp"]) for g in FG]
        FAv = [(tuple(a["v"][ax] for ax in AXES), a["kw"], a["comp"]) for a in FA]
        step_cache = {}
        def _steps(w, sa, sp, b):
            key = (w, sa, sp, b)
            st = step_cache.get(key)
            if st is None:
                eff = min(WE_level + w, kappa)
                stp = max(math.ceil((S0 / (1.0 + eff)) * (1.0 + sp) + sa), 10)
                st = stp / (1.0 + b)
                step_cache[key] = st
            return st
        reqs_items = list(reqs.items())
        has_reqs = bool(reqs_items)
        best_r = float("-inf"); best_nfill = None; best_load = None
        best_gv = None; best_av = None
        for gv, kG, cG in FGv:
            gAx = s0Ax + gv[iAx]; gPx = s0Px + gv[iPx]
            gW = s0W + gv[iW]; gSa = s0Sa + gv[iSa]; gSp = s0Sp + gv[iSp]; gB = s0B + gv[iB]
            nG = len(cG)
            for av, kA, cA in FAv:
                if has_reqs:
                    ok = True
                    for k, t in reqs_items:
                        if kG[k] + kA[k] < t:
                            ok = False
                            break
                    if not ok:
                        continue
                axp_tot = gAx + av[iAx]          # == sv[iAx] (same association)
                pxp_tot = gPx + av[iPx]          # == sv[iPx]
                r = ((X0 + axp_tot) * (1.0 + pxp_tot)) / _steps(
                    gW + av[iW], gSa + av[iSa], gSp + av[iSp], gB + av[iB])
                nfill = -(nG + len(cA))
                if best_load is None or (r, nfill) > (best_r, best_nfill):
                    best_r = r; best_nfill = nfill
                    best_load = list(cG) + list(cA)
                    best_gv = gv; best_av = av
        if best_load is None:
            return float("-inf"), None, None
        rng = range(len(AXES))
        bsv = tuple(s0v[j] + best_gv[j] + best_av[j] for j in rng)
        return best_r, best_load, dict(zip(AXES, bsv))


def exact_xp_optimize(activity, character, skill=None, location=None, base_stats=None,
                      pets=None, consumables=None, input_item=None):
    """Return {slot: Item|None} for controlled slots, or None to fall back."""
    opt = ExactXpOptimizer()
    opt.NODE_BUDGET = _EXACT_NODE_BUDGET
    opt.USE_DINKELBACH = _USE_DINKELBACH
    opt.debug = _EXACT_XP_DEBUG
    opt.debug_slot = _EXACT_XP_DEBUG_SLOT
    opt._DUMP_PLATEAU = _DUMP_PLATEAU
    opt._PLATEAU_TARGET = _PLATEAU_TARGET
    opt._PLATEAU_OUT = _PLATEAU_OUT
    opt.DEDUP_RING_ORDER = _DEDUP_RING_ORDER
    opt.SLOT_ORDER_STRATEGY = _SLOT_ORDER_STRATEGY
    opt._GROUP_FRONTIER_DIAG = _GROUP_FRONTIER_DIAG
    opt._MITM_ENABLED = _MITM_ENABLED
    result = opt.optimize(activity, character, skill=skill, location=location,
                          base_stats=base_stats, pets=pets, consumables=consumables,
                          input_item=input_item)
    globals()["last_run_budget_exhausted"] = opt.last_run_budget_exhausted
    globals()["last_run_diag"] = getattr(opt, "last_run_diag", None)
    return result
