"""Exact gearset optimizer ENGINE — category-agnostic branch-and-bound base.

Given an activity + character, picks the best OWNED gearset (gear/tool/ring/
neck/pet/consumable + input offset) for an objective, or returns None to signal
"fall back to greedy". NEVER raises (any error -> None).

This is the shared machinery extracted from the XP optimizer so other categories
(coins, chests, drops) can plug in a numerator without re-implementing the search.
Subclass ExactGearsetOptimizer and implement `numerator` + `numerator_bound`
(the per-objective value); everything else — the steps denominator, Pareto
pruning, tool-pool frontier, set meta-items, keyword/ring/token constraints,
best-first ordering (Point 4), WE-reserve bound (Point 1), capped-axis collapse
(Point 2) and the node-budget safety valve — is shared and objective-independent.

Axis model (class attributes, overridable):
  AXES      – all stat axes that affect the objective.
  AXIS_MAP  – game-stat-name -> axis.
  MAX_AXES  – axes where more is better (dominance >=).
  MIN_AXES  – axes where less is better (dominance <=).
  CAP_AXIS  – the axis clamped at `kappa` (work-efficiency); drives Point 2.

Exactness invariants (see .kiro/EXACT_OPTIMIZER_ENGINE_DESIGN.md): the steps
denominator uses a single ceil + fractional double-action (matches
activities.get_expected_drop_rate); numerator_bound MUST be an admissible upper
bound or the B&B will prune the optimum.
"""
import math
import itertools
from collections import defaultdict
import util.walkscape_constants as wc


class _It:
    __slots__ = ("id", "stats", "keywords", "tokens", "tb", "qty")
    def __init__(self, id, stats, keywords, tokens=frozenset(), tb=0.0, qty=1):
        self.id = id; self.stats = stats; self.keywords = keywords
        self.tokens = tokens; self.tb = tb; self.qty = qty


class _Meta:
    __slots__ = ("id", "slots", "stats", "keywords", "component_ids", "tb")
    def __init__(self, id, slots, stats, keywords, component_ids, tb=0.0):
        self.id = id; self.slots = slots; self.stats = stats
        self.keywords = keywords; self.component_ids = component_ids; self.tb = tb


def _item_id(it):
    return getattr(it, "uuid", None) or getattr(it, "name", None) or str(id(it))


class ExactGearsetOptimizer:
    # ── axis model (XP-standard defaults; a numerator subclass may extend) ──
    AXES = ("A_xp", "P_xp", "W", "S_add", "S_pct", "B")
    AXIS_MAP = {"bonus_xp_add": "A_xp", "bonus_xp_percent": "P_xp", "work_efficiency": "W",
                "steps_add": "S_add", "steps_percent": "S_pct", "double_action": "B"}
    MAX_AXES = ("A_xp", "P_xp", "W", "B")   # more is better
    MIN_AXES = ("S_add", "S_pct")           # less is better
    CAP_AXIS = "W"                          # clamped at kappa (work-efficiency)
    SINGLE = ["head", "cape", "back", "chest", "primary", "secondary",
              "hands", "legs", "neck", "feet"]

    # Safety valve: hard cap on B&B nodes per activity. Best-first ordering finds
    # a near-optimal incumbent fast, so past this budget we keep that incumbent
    # instead of wedging the worker until the 120s watchdog. Deterministic.
    NODE_BUDGET = 5_000_000

    # Dinkelbach fractional-programming mode (experimental). When USE_DINKELBACH
    # is True, the ratio score = num/steps is maximized via a sequence of
    # linearized subproblems max(num - lambda*steps); the outer loop raises
    # lambda to the achieved ratio until the subproblem max is <= 0 (optimality
    # certificate). Reuses the same B&B for each subproblem — only the leaf value
    # and bound switch from ratio to (num - lambda*steps).
    USE_DINKELBACH = False
    DINKELBACH_MAX_ITERS = 15
    DINKELBACH_EPS = 1e-9

    # Permutation-symmetry breaking for interchangeable identical-pool slots.
    # ring1/ring2 draw from the SAME ring frontier, so [A,B] and [B,A] reach an
    # identical state (same accumulated stats, keywords, tokens, used-set) yet
    # are explored as two distinct interior subtrees — a pure 2! blow-up. We
    # force a canonical order (filled ring in the earlier slot; later slot's
    # id-rank >= earlier slot's), which provably preserves the optimum (swapping
    # two rings changes nothing) while cutting the redundant branching. Toggle
    # off only to measure the node reduction.
    DEDUP_RING_ORDER = True
    PAIR_SLOTS = (("ring1", "ring2"),)

    # Slot visitation order is a PURE pruning heuristic — it never changes the
    # optimum (any order explores the same space), only how fast the bound
    # prunes. Strategies:
    #   "constrained" (default) – excl slots, then most-keyword-supplying, then
    #                             smallest domain (CSP most-constrained-first).
    #   "tools_first"           – tools+rings first (saturate WE early so the
    #                             rest runs on the collapsed cand_capped frontier).
    #   "tools_last"            – tools+rings last.
    #   "we_first"              – highest max work-efficiency slot first (direct
    #                             cap-saturation heuristic).
    #   "impact_first"          – highest best-single-item score slot first.
    SLOT_ORDER_STRATEGY = "constrained"
    _ORDER_STRATEGIES = ("constrained", "tools_first", "tools_last", "we_first", "impact_first")

    def __init__(self):
        self.last_run_budget_exhausted = False
        self.last_run_diag = None    # per-run diagnostics (Dinkelbach iters/nodes)
        self._last_opt_nodes = 0
        self.debug = False          # per-call [EXACT_DBG] logging
        self.debug_slot = "legs"
        # ── plateau-dump diagnostic (OFF by default) ──────────────────────
        # When _DUMP_PLATEAU is True and the activity name contains
        # _PLATEAU_TARGET, the ratio B&B records every near-optimal complete
        # gearset (score within _PLATEAU_REL_EPS of the running best) plus its
        # 6-axis vector, so we can inspect whether the near-optimal plateau is
        # Pareto-incomparable (dominance cuts moot -> ε-termination is the
        # lever) or has exploitable structure. Throwaway instrumentation; the
        # flag stays False in normal runs.
        self._DUMP_PLATEAU = False
        self._PLATEAU_TARGET = ""            # lower-case substring of activity name
        self._PLATEAU_OUT = "/tmp/plateau_dump.json"
        self._PLATEAU_REL_EPS = 0.01         # "near-optimal" = within 1% of best
        self._PLATEAU_CAP = 4000             # in-memory cap before compaction
        self._cur_activity_name = ""
        self._dump_active = False
        self._plateau_dump = []
        self._plateau_seen = 0
        self._plateau_hits = 0
        # Per-group Pareto-frontier size diagnostic (MITM viability probe). OFF
        # by default; the XP module turns it on. Only runs inside _run, which
        # only executes for exact-allowlisted sessions -> auto session-gated.
        self._GROUP_FRONTIER_DIAG = False
        # MITM prototype (no-req, no-meta only). Runs MITM + B&B side-by-side and
        # logs [MITM] r/time/match. OFF by default; XP module turns it on.
        self._MITM_ENABLED = False

    # ── objective hooks (OVERRIDE per category) ────────────────────────────
    def prepare(self, activity, character, skill, location, X0, S0, kappa, WE_level):
        """Optional per-activity precompute hook (e.g. coin-value coefficients).
        Called once in _run after the activity params are resolved, before the
        search. Default: no-op (XP needs nothing per-activity)."""
        pass

    def numerator(self, X0, s):
        """Value per action for the accumulated stat vector s (X0 = base)."""
        raise NotImplementedError

    def numerator_bound(self, X0, s, R):
        """Admissible UPPER bound on the numerator over remaining slots.
        R is the per-axis suffix reserve dict at the current slot index."""
        raise NotImplementedError

    # ── shared steps denominator (identical across categories) ─────────────
    def steps(self, S0, kappa, WE_level, s):
        eff = min(WE_level + s[self.CAP_AXIS], kappa)
        base = S0 / (1.0 + eff)
        st = max(math.ceil(base * (1.0 + s["S_pct"]) + s["S_add"]), 10)
        # Double action reduces EXPECTED steps fractionally (no ceil) — matches
        # activities.get_expected_drop_rate. A second ceil rounds small DA away.
        return st / (1.0 + s["B"])

    def steps_lower_bound(self, S0, kappa, WE_level, s, R):
        # Point 1: cap achievable CAP_AXIS at the tightest reachable value
        # (level + gear + suffix reserve, clamped) instead of pinning at kappa,
        # so sub-cap branches get a much tighter (still admissible) bound.
        eff = min(WE_level + s[self.CAP_AXIS] + R[self.CAP_AXIS], kappa)
        b = S0 / (1.0 + eff)
        st = max(math.ceil(b * (1.0 + s["S_pct"] + R["S_pct"]) + s["S_add"] + R["S_add"]), 10)
        return st / (1.0 + s["B"] + R["B"])

    def score(self, X0, S0, kappa, WE_level, s):
        return self.numerator(X0, s) / self.steps(S0, kappa, WE_level, s)

    def bound_value(self, X0, S0, kappa, WE_level, s, R):
        return self.numerator_bound(X0, s, R) / self.steps_lower_bound(S0, kappa, WE_level, s, R)

    # ── helpers ─────────────────────────────────────────────────────────────
    def _vec(self, stats):
        return {ax: float(stats[k]) for k, ax in self.AXIS_MAP.items() if k in stats}

    @staticmethod
    def _rel(v):
        return any(abs(x) > 1e-12 for x in v.values())

    def _dom(self, A, B, reqs, ignore_w=False):
        # ignore_w: past the CAP_AXIS cap, extra CAP_AXIS is free, so it stops
        # being a domination axis (collapses items differing only in it).
        ga = A.stats.get; gb = B.stats.get
        for a in self.MAX_AXES:
            if ignore_w and a == self.CAP_AXIS:
                continue
            if ga(a, 0) < gb(a, 0):
                return False
        for a in self.MIN_AXES:
            if ga(a, 0) > gb(a, 0):
                return False
        if any(A.keywords.count(k) < B.keywords.count(k) for k in reqs):
            return False
        if not A.tokens <= B.tokens:
            return False
        # Secondary tie-break ONLY on exact ties across every axis (skip
        # CAP_AXIS when ignore_w). Keeps the frontier small — a full tb
        # dimension blows up the B&B.
        eq = all(ga(a, 0) == gb(a, 0) for a in self.AXES
                 if not (ignore_w and a == self.CAP_AXIS))
        if eq and A.tb < B.tb:
            return False
        return True

    def _prune(self, items, reqs, ignore_w=False):
        kept = []
        for it in items:
            if any(self._dom(k, it, reqs, ignore_w) for k in kept):
                continue
            kept = [k for k in kept if not self._dom(it, k, reqs, ignore_w)]
            kept.append(it)
        return kept

    # ── core branch-and-bound ────────────────────────────────────────────────
    def _optimize(self, slots, metas, X0, S0, kappa, WE_level, reqs, excl, base_stats, lambda_val=None):
        AXES = self.AXES
        order = list(slots)
        _strat = getattr(self, "SLOT_ORDER_STRATEGY", "constrained")
        _tool_ring = {"tools", "ring1", "ring2"}

        def key(sn):
            cands = slots[sn]
            sup = sum(1 for k in reqs if any(it.keywords.count(k) > 0 for it in cands))
            n_c = len(cands)
            base = (0 if sn in excl else 1, -sup, n_c)   # the default tie-breakers
            if _strat == "tools_first":
                return (0 if sn in _tool_ring else 1,) + base
            if _strat == "tools_last":
                return (1 if sn in _tool_ring else 0,) + base
            if _strat == "we_first":
                mx = max([it.stats.get(self.CAP_AXIS, 0.) for it in cands], default=0.)
                return (-round(mx, 6),) + base
            if _strat == "impact_first":
                ms = max([self.score(X0, S0, kappa, WE_level,
                                     {a: it.stats.get(a, 0.) for a in AXES}) for it in cands],
                         default=0.)
                return (-round(ms, 6),) + base
            return base                                   # "constrained" (unchanged default)
        order.sort(key=key)
        idx_of = {sn: i for i, sn in enumerate(order)}
        n = len(order); cand = [slots[sn] for sn in order]

        # Point 4: best-first per-slot ordering -> strong incumbent on the first
        # descent -> bound() prunes almost everything after. Order-only.
        def _item_score(it):
            return self.score(X0, S0, kappa, WE_level, {a: it.stats.get(a, 0.) for a in AXES})
        for _c in cand:
            _c.sort(key=_item_score, reverse=True)
        # Point 2: W-ignoring frontier used once the CAP_AXIS cap is hit.
        cand_capped = [self._prune(list(c), reqs, ignore_w=True) for c in cand]
        for _c in cand_capped:
            _c.sort(key=_item_score, reverse=True)

        metas_at = [[] for _ in range(n)]
        for m in metas:
            idxs = [idx_of[sn] for sn in m.slots]; mask = 0
            for i in idxs:
                mask |= (1 << i)
            metas_at[min(idxs)].append((m, mask))

        # Suffix reserves per axis (max for MAX_AXES, min for MIN_AXES) + keywords.
        R = {a: [0.] * (n + 1) for a in AXES}
        RKW = [{k: 0 for k in reqs} for _ in range(n + 1)]
        for i in range(n - 1, -1, -1):
            pool = list(cand[i]) + [m for m, _ in metas_at[i]]
            for a in self.MAX_AXES:
                R[a][i] = R[a][i + 1] + max([o.stats.get(a, 0.) for o in pool], default=0.)
            for a in self.MIN_AXES:
                R[a][i] = R[a][i + 1] + min([o.stats.get(a, 0.) for o in pool] + [0.])
            for k in reqs:
                RKW[i][k] = RKW[i + 1][k] + max([o.keywords.count(k) for o in pool], default=0)

        best = {"r": float("-inf"), "tb": float("-inf"), "nfill": float("-inf"), "load": None, "s": None}
        _nodes = [0]; _aborted = [False]
        cap_axis = self.CAP_AXIS

        # Ring-pair permutation symmetry breaking. _pair_rA/_pair_rB are the
        # (earlier, later) slot indices of the interchangeable ring pair;
        # _ring_canon maps item id -> stable rank. _rA_pick tracks the earlier
        # slot's pick while inside its subtree: None = not a single ring (meta
        # or not yet chosen), -1 = empty, >=0 = the chosen ring's rank.
        _pair_rA = _pair_rB = -1
        _ring_canon = {}
        if self.DEDUP_RING_ORDER:
            for a, b in self.PAIR_SLOTS:
                if a in idx_of and b in idx_of:
                    ia, ib = idx_of[a], idx_of[b]
                    _pair_rA, _pair_rB = (ia, ib) if ia < ib else (ib, ia)
                    _ring_canon = {iid: rk for rk, iid in
                                   enumerate(sorted({it.id for it in cand[_pair_rA]}))}
                    break
        _rA_pick = [None]

        def bound(idx, s):
            Ri = {a: R[a][idx] for a in AXES}
            if lambda_val is None:
                return self.bound_value(X0, S0, kappa, WE_level, s, Ri)
            # Dinkelbach subproblem: admissible upper bound on (num - lambda*steps)
            # = upper_bound(num) - lambda * lower_bound(steps),  lambda >= 0.
            return (self.numerator_bound(X0, s, Ri)
                    - lambda_val * self.steps_lower_bound(S0, kappa, WE_level, s, Ri))

        def rec(idx, filled, s, tally, used, ban, chosen, tb):
            if _aborted[0]:
                return
            _nodes[0] += 1
            if _nodes[0] > self.NODE_BUDGET:
                _aborted[0] = True
                return
            for k, t in reqs.items():
                if tally[k] + RKW[idx][k] < t:
                    return
            if best["r"] > float("-inf") and bound(idx, s) < best["r"]:
                return
            if idx == n:
                if lambda_val is None:
                    r = self.score(X0, S0, kappa, WE_level, s)
                else:
                    r = self.numerator(X0, s) - lambda_val * self.steps(S0, kappa, WE_level, s)
                # Plateau-dump diagnostic (ratio path only): record complete
                # gearsets within _PLATEAU_REL_EPS of the running best. best["r"]
                # rises monotonically, so early over-collection (vs a lower best)
                # is filtered post-hoc; compaction keeps the list bounded.
                if self._dump_active and lambda_val is None:
                    self._plateau_seen += 1
                    if best["r"] > float("-inf") and r >= best["r"] * (1.0 - self._PLATEAU_REL_EPS):
                        self._plateau_hits += 1
                        self._plateau_dump.append(
                            (r, {a: s[a] for a in AXES},
                             [(_l, _c) for _l, _c in chosen if _c != "(empty)"]))
                        if len(self._plateau_dump) > self._PLATEAU_CAP:
                            _thr = best["r"] * (1.0 - self._PLATEAU_REL_EPS)
                            self._plateau_dump = [e for e in self._plateau_dump if e[0] >= _thr]
                # Tie-break after (r, tb): prefer FEWER equipped pieces so a
                # stat-neutral fill never beats an empty slot on a true tie.
                nfill = -sum(1 for _lbl, _cid in chosen if _cid != "(empty)")
                if (r, tb, nfill) > (best["r"], best["tb"], best["nfill"]):
                    best["r"] = r; best["tb"] = tb; best["nfill"] = nfill
                    best["load"] = list(chosen); best["s"] = dict(s)
                return
            if filled & (1 << idx):
                rec(idx + 1, filled, s, tally, used, ban, chosen, tb); return
            sn = order[idx]
            is_rA = (idx == _pair_rA); is_rB = (idx == _pair_rB)
            _pool = cand_capped[idx] if (WE_level + s[cap_axis] >= kappa - 1e-12) else cand[idx]
            for it in _pool:
                if used.get(it.id, 0) >= it.qty:
                    continue
                if is_rB and _rA_pick[0] is not None:
                    # Canonical order: filled ring goes in the earlier slot, and
                    # the later slot's rank must be >= the earlier slot's. Skips
                    # the [B,A] / [empty,A] permutation twins of kept states.
                    if _rA_pick[0] == -1 or _ring_canon.get(it.id, -1) < _rA_pick[0]:
                        continue
                nt = tally
                if any(k in it.keywords for k in reqs):
                    nt = dict(tally)
                    for k in reqs:
                        nt[k] += it.keywords.count(k)
                ns = {a: s[a] + it.stats.get(a, 0.) for a in AXES}
                used[it.id] = used.get(it.id, 0) + 1; chosen.append((sn, it.id))
                if is_rA:
                    _prev_pick = _rA_pick[0]; _rA_pick[0] = _ring_canon.get(it.id, None)
                rec(idx + 1, filled | (1 << idx), ns, nt, used, ban, chosen, tb + it.tb)
                if is_rA:
                    _rA_pick[0] = _prev_pick
                chosen.pop(); used[it.id] -= 1
            for m, mask in metas_at[idx]:
                if mask & filled or any(used.get(c, 0) > 0 for c in m.component_ids):
                    continue
                ns = {a: s[a] + m.stats.get(a, 0.) for a in AXES}
                nt = tally
                if any(k in m.keywords for k in reqs):
                    nt = dict(tally)
                    for k in reqs:
                        nt[k] += m.keywords.count(k)
                for c in m.component_ids:
                    used[c] = used.get(c, 0) + 1
                chosen.append(("+".join(m.slots), m.id))
                rec(idx + 1, filled | mask, ns, nt, used, ban, chosen, tb + m.tb)
                chosen.pop()
                for c in m.component_ids:
                    used[c] -= 1
            # Empty slot explored LAST (Point 4).
            if is_rA:
                _prev_pick = _rA_pick[0]; _rA_pick[0] = -1
            chosen.append((sn, "(empty)")); rec(idx + 1, filled, s, tally, used, ban, chosen, tb); chosen.pop()
            if is_rA:
                _rA_pick[0] = _prev_pick

        s0 = {a: float(base_stats.get(a, 0.)) for a in AXES}
        rec(0, 0, s0, {k: 0 for k in reqs}, {}, frozenset(), [], 0.0)
        self.last_run_budget_exhausted = bool(_aborted[0])
        self._last_opt_nodes = _nodes[0]
        if _aborted[0]:
            print(f"[EXACT] node budget {self.NODE_BUDGET} exhausted -> "
                  f"returning best-first incumbent (R={best['r']}, not proof-optimal)")
        return best["r"], best["load"], best["s"]

    def _optimize_dinkelbach(self, slots, metas, X0, S0, kappa, WE_level, reqs, excl, base_stats):
        """Maximize num/steps via Dinkelbach: iterate max(num - lambda*steps),
        raising lambda to the achieved ratio until the subproblem max is <= 0
        (optimality certificate). Reuses _optimize per subproblem."""
        lam = 0.0                       # 0 <= lambda* always (all feasible scores > 0)
        best_load = None; best_s = None
        exhausted = False
        per_iter_nodes = []
        iters = 0
        for iters in range(1, self.DINKELBACH_MAX_ITERS + 1):
            F, load, s_win = self._optimize(slots, metas, X0, S0, kappa, WE_level,
                                            reqs, excl, base_stats, lambda_val=lam)
            per_iter_nodes.append(self._last_opt_nodes)
            exhausted = exhausted or bool(self.last_run_budget_exhausted)
            if load is None:
                break
            best_load = load; best_s = s_win
            if F is None or F <= self.DINKELBACH_EPS:      # g(lambda) ~ 0 -> optimal
                break
            new_lam = self.numerator(X0, s_win) / self.steps(S0, kappa, WE_level, s_win)
            if new_lam <= lam + self.DINKELBACH_EPS:        # no further progress
                lam = new_lam
                break
            lam = new_lam
        self.last_run_budget_exhausted = exhausted
        self.last_run_diag = {"mode": "dinkelbach", "iters": iters,
                              "nodes": list(per_iter_nodes), "total_nodes": sum(per_iter_nodes),
                              "lambda": round(lam, 6), "exhausted": exhausted}
        r = self.score(X0, S0, kappa, WE_level, best_s) if best_s is not None else float("-inf")
        print(f"[DINKELBACH] iters={iters} lambda={lam:.6f} nodes={per_iter_nodes} exhausted={exhausted}")
        return r, best_load, best_s

    # ── meet-in-the-middle / group-DP (prototype; no-req, no-meta only) ───────
    def _group_collapse(self, slot_defs, metas=(), reqs=None):
        """Collapse a set of slots into their Pareto frontier of partial
        gearsets. Each state carries its axis vector, per-requirement keyword
        provision (kw), and comp (list of (slot_label, cid)) for reconstruction.
        Enforces item uniqueness within the group. Ties (identical axis vector)
        keep the fewer-pieces state. `metas` are atomic multi-slot set-pieces
        whose slots are ALL within this group; each is offered at its earliest
        slot and occupies a filled mask. `reqs` are keyword-count requirements —
        a state that provides MORE of a required keyword is NOT dominated (it may
        be needed to satisfy the requirement in the combine), so keyword
        provision is a dominance dimension (capped at the requirement, since
        excess is useless)."""
        from collections import defaultdict
        AXES = self.AXES
        reqs = reqs or {}
        labels = [lbl for lbl, _ in slot_defs]
        cands = [c for _, c in slot_defs]
        idx_of = {lbl: i for i, lbl in enumerate(labels)}
        n = len(labels)

        # Owned-quantity-aware uniqueness. An item may be equipped up to its
        # owned qty (mirrors the B&B: `used.get(id,0) >= it.qty`). The OLD code
        # tracked `used` as an id-set (qty=1), so it could never place two copies
        # of an owned-in-multiples item — most importantly two identical rings
        # (ring1/ring2 share one candidate pool). That made MITM unable to reach
        # gearsets the B&B could (e.g. 2x a light-source ring to satisfy a
        # keyword-count requirement), so MITM missed the true optimum on
        # duplicate-dependent activities (Halfmaw tracking, Bog fishing (Spear)).
        #
        # An item is residual-CONSTRAINED only when more slots in this group can
        # select it than its owned qty allows (qty < #eligible slots). Only those
        # items' residual counts affect future feasibility, so only they enter
        # the Pareto-prune key — otherwise the frontier would stop collapsing.
        # Distinct-slot groups (gear/tools) have no shared candidate, so this set
        # is empty and the frontier collapses exactly as before (no slowdown);
        # the ring pair is the only group where it bites, and there only qty-1
        # rings split the frontier.
        seen_in = defaultdict(int); qty_of = {}
        for cl in cands:
            for _cid in {c.id for c in cl}:
                seen_in[_cid] += 1
            for c in cl:
                qty_of[c.id] = c.qty
        shared_ids = tuple(sorted(i for i, c in seen_in.items()
                                  if c > 1 and qty_of.get(i, 1) < c))

        metas_at = [[] for _ in range(n)]
        for m in metas:
            idxs = sorted(idx_of[s] for s in m.slots)
            mask = 0
            for i in idxs:
                mask |= (1 << i)
            metas_at[idxs[0]].append((m, mask))

        def dominates(A, B):
            va, vb = A["v"], B["v"]
            for a in self.MAX_AXES:
                if va[a] < vb[a]:
                    return False
            for a in self.MIN_AXES:
                if va[a] > vb[a]:
                    return False
            ka, kb = A["kw"], B["kw"]
            for k in reqs:
                if ka[k] < kb[k]:
                    return False
            return True

        def gkey(s):
            # States are comparable only if they filled the SAME slots (a meta
            # pre-fills future slots, so its vector isn't comparable to a state
            # that still has them open) AND hold the SAME residual of any
            # quantity-constrained shared item (otherwise a state that still has
            # a required duplicate available could be wrongly dropped for one
            # that already spent it).
            return (s["mask"], tuple(s["used"].get(i, 0) for i in shared_ids))

        def prune(sts):
            groups = defaultdict(list)
            for s in sts:
                groups[gkey(s)].append(s)
            out = []
            for g in groups.values():
                g.sort(key=lambda s: len(s["comp"]))   # fewer pieces first (tie-break)
                kept = []
                for s in g:
                    if any(dominates(k, s) for k in kept):
                        continue
                    kept = [k for k in kept if not dominates(s, k)]
                    kept.append(s)
                out.extend(kept)
            return out

        def _kw_add(base_kw, obj):
            if not reqs:
                return base_kw
            return {k: min(base_kw[k] + obj.keywords.count(k), reqs[k]) for k in reqs}

        def _uinc(used, ids):
            nu = dict(used)
            for c in ids:
                nu[c] = nu.get(c, 0) + 1
            return nu

        z_kw = {k: 0 for k in reqs}
        states = [{"v": {a: 0.0 for a in AXES}, "kw": z_kw, "comp": (), "used": {}, "mask": 0}]
        for i in range(n):
            label = labels[i]
            nxt = []
            for st in states:
                if st["mask"] & (1 << i):
                    nxt.append(st)                   # slot already filled by a meta
                    continue
                nxt.append(st)                       # empty option for this slot
                for it in cands[i]:
                    if st["used"].get(it.id, 0) >= it.qty:   # qty-aware (was: id in set)
                        continue
                    nxt.append({
                        "v": {a: st["v"][a] + it.stats.get(a, 0.) for a in AXES},
                        "kw": _kw_add(st["kw"], it),
                        "comp": st["comp"] + ((label, it.id),),
                        "used": _uinc(st["used"], (it.id,)),
                        "mask": st["mask"]})
                for m, mask in metas_at[i]:
                    if st["mask"] & mask or any(st["used"].get(c, 0) > 0 for c in m.component_ids):
                        continue
                    nxt.append({
                        "v": {a: st["v"][a] + m.stats.get(a, 0.) for a in AXES},
                        "kw": _kw_add(st["kw"], m),
                        "comp": st["comp"] + (("+".join(m.slots), m.id),),
                        "used": _uinc(st["used"], m.component_ids),
                        "mask": st["mask"] | mask})
            states = prune(nxt)
        return states

    _MITM_COMBINE_CAP = 8_000_000

    def _optimize_mitm(self, slots, metas, reqs, X0, S0, kappa, WE_level, base_stats):
        """Meet-in-the-middle: collapse gear / tools-bundle / rings to Pareto
        frontiers, then combine by true score. Set-metas (armor sets, slots all
        within the gear group) fold into the gear frontier as atomic options.
        Keyword requirements are enforced as an O(1) feasibility check in the
        combine (sum of per-group keyword provision >= threshold). Exact: the
        only cross-group coupling is the WE cap + the additive requirement, both
        evaluated in the combine. Returns (r, load, s), or (-inf, None, None) to
        bail (combine product over the cap, or no feasible combine)."""
        AXES = self.AXES
        reqs = reqs or {}
        ring = slots.get("ring1", [])
        FG = self._group_collapse([(sl, slots.get(sl, [])) for sl in self.SINGLE], metas, reqs)
        FT = self._group_collapse([("tools", slots.get("tools", [])),
                                   ("pet", slots.get("pet", [])),
                                   ("consumable", slots.get("consumable", []))], reqs=reqs)
        FR = self._group_collapse([("ring1", ring), ("ring2", ring)], reqs=reqs)
        if len(FG) * len(FT) * len(FR) > self._MITM_COMBINE_CAP:
            return float("-inf"), None, None      # bail -> caller falls back to B&B
        s0 = {a: float(base_stats.get(a, 0.)) for a in AXES}
        best_r = float("-inf"); best_nfill = None; best_load = None; best_s = None
        for gG in FG:
            vG = gG["v"]; kG = gG["kw"]
            for gT in FT:
                vGT = {a: vG[a] + gT["v"][a] for a in AXES}
                kGT = {k: kG[k] + gT["kw"][k] for k in reqs}
                for gR in FR:
                    feasible = True
                    for k, t in reqs.items():
                        if kGT[k] + gR["kw"][k] < t:
                            feasible = False
                            break
                    if not feasible:
                        continue
                    s = {a: s0[a] + vGT[a] + gR["v"][a] for a in AXES}
                    r = self.score(X0, S0, kappa, WE_level, s)
                    nfill = -(len(gG["comp"]) + len(gT["comp"]) + len(gR["comp"]))
                    if best_load is None or (r, nfill) > (best_r, best_nfill):
                        best_r = r; best_nfill = nfill
                        best_load = list(gG["comp"]) + list(gT["comp"]) + list(gR["comp"])
                        best_s = dict(s)
        return best_r, best_load, best_s

    # ── public entry ─────────────────────────────────────────────────────────
    def optimize(self, activity, character, skill=None, location=None, base_stats=None,
                 pets=None, consumables=None, input_item=None):
        """Return {slot: Item|None} for controlled slots, or None to fall back."""
        self.last_run_budget_exhausted = False
        try:
            return self._run(activity, character, skill, location, base_stats or {},
                             pets, consumables, input_item)
        except Exception:
            return None

    def _run(self, activity, character, skill, location, base_stats,
             pets=None, consumables=None, input_item=None):
        skill = skill or getattr(activity, "primary_skill", None)
        if not skill:
            return None
        if location is None:
            locs = getattr(activity, "locations", None)
            location = locs[0] if locs else None
        X0 = float(activity.base_xp); S0 = int(activity.base_steps); kappa = float(activity.max_efficiency)
        try:
            lvl = character.get_skill_level(str(skill).lower())
        except Exception:
            lvl = 0
        sr = getattr(activity, "skill_requirements", {}) or {}
        req_lvl = (sr.get(skill) or (list(sr.values())[0] if sr else 1)) or 1
        WE_level = min(max(0, lvl - req_lvl), 20) * 0.0125
        n_tools = character.get_tool_slots()
        self.prepare(activity, character, skill, location, X0, S0, kappa, WE_level)
        # Capture the axis model AFTER prepare() — a category's prepare() (e.g.
        # coins) may extend AXES/AXIS_MAP with per-activity numerator axes.
        AXES = self.AXES; AXIS_MAP = self.AXIS_MAP

        kc = dict((getattr(activity, "requirements", {}) or {}).get("keyword_counts", {}))
        input_kw = {str(getattr(ii, "reference", "")).lower()
                    for ii in (getattr(activity, "input_items", []) or [])
                    if getattr(ii, "type", None) == "keyword"}
        reqs = {k.lower(): v for k, v in kc.items() if k.lower() not in input_kw}
        excl = {"primary", "secondary"}
        _excluded_kw = {str(x).lower() for x in getattr(wc, "EXCLUDED_TOOL_KEYWORDS", set())}

        def _tool_tokens(kws_lower):
            return frozenset(kw for kw in kws_lower if kw not in _excluded_kw)

        by_slot = defaultdict(list)
        owned_qty = {}
        for it, qty in character.items.items():
            if not qty or not hasattr(it, "get_stats_for_skill") or not hasattr(it, "slot"):
                continue
            if getattr(it, "slot", None) is None:
                continue
            if hasattr(it, "is_unlocked"):
                try:
                    if not it.is_unlocked(character, ignore_gear_requirements=True):
                        continue
                except Exception:
                    pass
            owned_qty[_item_id(it)] = qty
            by_slot[it.slot].append(it)

        refs_single = {}; refs_meta = {}; refs_pool = {}

        def make(data_items):
            out = []
            for it in data_items:
                try:
                    stats = it.get_stats_for_skill(skill=skill, location=location, character=character)
                except Exception:
                    continue
                v = self._vec(stats)
                tb = 0.0
                for _sk, _sv in stats.items():
                    if _sk in AXIS_MAP:
                        continue
                    try:
                        tb += abs(float(_sv))
                    except (TypeError, ValueError):
                        pass
                kws = [str(k).lower() for k in (getattr(it, "keywords", []) or [])]
                keep = [k for k in kws if k in reqs]
                toks = _tool_tokens(kws)
                if not self._rel(v) and not keep:
                    continue
                iid = _item_id(it); refs_single[iid] = it
                out.append(_It(iid, v, keep, toks, tb, owned_qty.get(iid, 1)))
            return out

        slots = {sl: make(by_slot.get(sl, [])) for sl in self.SINGLE}
        ring = make(by_slot.get("ring", []))
        slots["ring1"] = list(ring); slots["ring2"] = list(ring)

        def pool_frontier(items, K):
            fr = [{"v": {a: 0. for a in AXES}, "kw": {k: 0 for k in reqs},
                   "ban": frozenset(), "size": 0, "comp": (), "tb": 0.0}]
            def pdom(A, B):
                v, w = A["v"], B["v"]
                for a in self.MAX_AXES:
                    if v[a] < w[a]:
                        return False
                for a in self.MIN_AXES:
                    if v[a] > w[a]:
                        return False
                if any(A["kw"][k] < B["kw"][k] for k in reqs):
                    return False
                if not A["ban"] <= B["ban"]:
                    return False
                return A["size"] <= B["size"]
            def prune(states):
                kept = []
                for s in states:
                    if any(pdom(k, s) for k in kept):
                        continue
                    kept = [k for k in kept if not pdom(s, k)]; kept.append(s)
                return kept
            for it in items:
                ib = it.tokens; ik = {k: it.keywords.count(k) for k in reqs}
                add = []
                for st in fr:
                    if st["size"] >= K or it.id in st["comp"] or (ib & st["ban"]):
                        continue
                    add.append({"v": {a: st["v"][a] + it.stats.get(a, 0.) for a in AXES},
                                "kw": {k: min(st["kw"][k] + ik[k], reqs[k]) for k in reqs},
                                "ban": st["ban"] | ib, "size": st["size"] + 1,
                                "comp": st["comp"] + (it.id,), "tb": st["tb"] + it.tb})
                fr = prune(fr + add)
            out = []
            for i, st in enumerate(fr):
                pid = f"toolpool#{i}"
                refs_pool[pid] = [refs_single[c] for c in st["comp"]]
                kws = [k for k in reqs for _ in range(st["kw"][k])]
                out.append(_It(pid, dict(st["v"]), kws, st["ban"], st["tb"]))
            return out

        slots["tools"] = pool_frontier(make(by_slot.get("tools", [])), n_tools)
        for sl in self.SINGLE:
            slots[sl] = self._prune(slots[sl], reqs)
        slots["pet"] = self._prune(make(pets or []), reqs)
        slots["consumable"] = self._prune(make(consumables or []), reqs)
        base = {a: float(base_stats.get(a, 0.)) for a in AXES}
        # Always-on collectible stats folded into the baseline BEFORE the cap
        # (matches calculate_gearset_metrics, which pre-merges collectibles).
        for _col in (getattr(character, "collectibles", None) or []):
            if not hasattr(_col, "get_stats_for_skill"):
                continue
            try:
                for ax, val in self._vec(_col.get_stats_for_skill(skill, location=location)).items():
                    base[ax] = base.get(ax, 0.) + val
            except Exception:
                pass
        if input_item is not None and hasattr(input_item, "get_stats_for_skill"):
            try:
                for ax, val in self._vec(input_item.get_stats_for_skill(
                        skill=skill, location=location, character=character)).items():
                    base[ax] = base.get(ax, 0.) + val
            except Exception:
                pass

        # dynamic set meta-items from gated_stats['set_pieces'] over OWNED pieces
        SLOTMAP = {"ring": "ring1", "tools": "tool0"}
        setsd = defaultdict(lambda: defaultdict(list)); thr = defaultdict(set)
        for lst in by_slot.values():
            for it in lst:
                gs = getattr(it, "gated_stats", None)
                if not isinstance(gs, dict) or not gs.get("set_pieces"):
                    continue
                for sname, ths in gs["set_pieces"].items():
                    setsd[sname][SLOTMAP.get(it.slot, it.slot)].append(it)
                    thr[sname].update(int(k) for k in ths)
        metas = []
        for sname, bys in setsd.items():
            mn = min(thr[sname]) if thr[sname] else 1
            sl_list = list(bys.keys())
            for r in range(max(1, mn), len(sl_list) + 1):
                for combo in itertools.combinations(sl_list, r):
                    for chosen in itertools.product(*[bys[s] for s in combo]):
                        tot = {}; meta_tb = 0.0
                        for itm in chosen:
                            try:
                                st = itm.get_stats_for_skill(skill=skill, location=location,
                                                             character=character,
                                                             set_piece_counts={sname: r})
                            except Exception:
                                st = {}
                            for ax, val in self._vec(st).items():
                                tot[ax] = tot.get(ax, 0.) + val
                            for _sk, _sv in st.items():
                                if _sk in AXIS_MAP:
                                    continue
                                try:
                                    meta_tb += abs(float(_sv))
                                except (TypeError, ValueError):
                                    pass
                        mid = f"{sname}|{r}|" + "/".join(combo)
                        refs_meta[mid] = [(combo[j], chosen[j]) for j in range(len(combo))]
                        metas.append(_Meta(mid, list(combo), tot, [], [_item_id(x) for x in chosen], meta_tb))

        # ── plateau-dump gating (target activity only) ────────────────────
        self._cur_activity_name = str(getattr(activity, "name", "") or "").lower()
        self._dump_active = bool(self._DUMP_PLATEAU and self._PLATEAU_TARGET
                                 and self._PLATEAU_TARGET in self._cur_activity_name)
        self._plateau_dump = []; self._plateau_seen = 0; self._plateau_hits = 0
        if self._dump_active:
            # Guarantee a COMPLETE plateau (true optimum) for just this activity
            # by lifting the node budget — a valve abort would truncate the
            # plateau and leave `best` non-optimal, breaking the incomparability
            # check. Every other activity keeps its normal budget.
            self.NODE_BUDGET = max(self.NODE_BUDGET, 30_000_000)

        if getattr(self, "_GROUP_FRONTIER_DIAG", False):
            self._measure_group_frontiers(str(getattr(activity, "name", "?")), slots, reqs)

        _armor = set(self.SINGLE)
        _metas_armor_only = all(set(m.slots) <= _armor for m in metas)
        _use_mitm = getattr(self, "_MITM_ENABLED", False) and _metas_armor_only
        if getattr(self, "_MITM_ENABLED", False) and not _use_mitm:
            print(f"[MITM-SKIP] {getattr(activity, 'name', '?')} reqs={len(reqs)} "
                  f"metas={len(metas)} armor_only={_metas_armor_only}")
        if _use_mitm:
            import time as _t
            _t0 = _t.perf_counter()
            r_m, load_m, _sm = self._optimize_mitm(slots, metas, reqs, X0, S0, kappa, WE_level, base)
            _tm = (_t.perf_counter() - _t0) * 1000.0
            _t1 = _t.perf_counter()
            r_b, load_b, _sb = self._optimize(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
            _tb = (_t.perf_counter() - _t1) * 1000.0
            if load_m is None:
                # MITM bailed (combine product over cap, or no feasible combine).
                print(f"[MITM-BAIL] {getattr(activity, 'name', '?')} reqs={len(reqs)} "
                      f"-> B&B t_bnb={_tb:.0f}ms")
                r, load = r_b, load_b
            else:
                _match = (abs(r_m - r_b) < 1e-9) if (r_m > float("-inf") and r_b > float("-inf")) else (r_m == r_b)
                _spd = (_tb / _tm) if _tm > 0 else 0.0
                print(f"[MITM] {getattr(activity, 'name', '?')} reqs={len(reqs)} "
                      f"r_mitm={r_m:.6f} r_bnb={r_b:.6f} match={_match} "
                      f"t_mitm={_tm:.0f}ms t_bnb={_tb:.0f}ms speedup={_spd:.1f}x")
                if _match:
                    r, load = r_m, load_m
                else:
                    print(f"[MITM] MISMATCH on {getattr(activity, 'name', '?')} -> using B&B result")
                    r, load = r_b, load_b
        elif getattr(self, "USE_DINKELBACH", False):
            r, load, _sw = self._optimize_dinkelbach(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
        else:
            r, load, _sw = self._optimize(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
        if self._dump_active:
            self._run_slot_order_ab(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base, r)
        if load is None:
            return None
        all_slots = list(self.SINGLE) + ["ring1", "ring2", "pet", "consumable"] + [f"tool{i}" for i in range(n_tools)]
        gearset = {s: None for s in all_slots}
        for label, cid in load:
            if cid == "(empty)":
                continue
            if cid in refs_pool:
                for j, itm in enumerate(refs_pool[cid]):
                    if j < n_tools:
                        gearset[f"tool{j}"] = itm
            elif cid in refs_meta:
                for slot, itm in refs_meta[cid]:
                    gearset[slot] = itm
            elif cid in refs_single:
                gearset[label] = refs_single[cid]

        if self.debug:
            self._debug_log(activity, character, skill, location, gearset, slots, refs_single,
                            base, X0, S0, kappa, WE_level)
        if self._dump_active:
            self._write_plateau_dump(refs_single, refs_pool, refs_meta, S0, kappa, WE_level, r)
        return gearset

    def _run_slot_order_ab(self, slots, metas, X0, S0, kappa, WE_level, reqs, excl, base, ref_r):
        """Diagnostic A/B: re-run the exact B&B under each slot-ordering strategy
        for the target activity and log node counts. Order is a pure heuristic,
        so every strategy MUST return the same optimum — a mismatch is a bug."""
        _orig = self.SLOT_ORDER_STRATEGY
        rows = []
        for strat in self._ORDER_STRATEGIES:
            self.SLOT_ORDER_STRATEGY = strat
            try:
                rr, _ld, _s = self._optimize(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
                rows.append((strat, self._last_opt_nodes, rr, bool(self.last_run_budget_exhausted)))
            except Exception:
                rows.append((strat, -1, float("nan"), False))
        self.SLOT_ORDER_STRATEGY = _orig
        best = min((n for _s, n, _r, _e in rows if n >= 0), default=0)
        parts = []
        for strat, n, rr, exh in rows:
            mark = "*" if (n == best and n >= 0) else " "
            ok = "OK" if abs(rr - ref_r) < 1e-9 else f"R-MISMATCH({rr:.5f})"
            parts.append(f"{mark}{strat}:nodes={n}{'!' if exh else ''} {ok}")
        print(f"[SLOT-ORDER] {self._cur_activity_name} ref_r={ref_r:.5f} | " + " | ".join(parts))

    def _measure_group_frontiers(self, name, slots, reqs):
        """MITM viability probe: collapse each proposed slot-group to a Pareto
        frontier and log the sizes + combine product. Diagnostic only — never
        used by the search. Capped (bail on explosion) to bound cost."""
        try:
            AXES = self.AXES
            CAP = 5000

            def grp(cand_lists):
                fr = [{"v": {a: 0. for a in AXES}, "kw": {k: 0 for k in reqs},
                       "ban": frozenset(), "size": 0}]

                def pdom(A, B):
                    v, w = A["v"], B["v"]
                    for a in self.MAX_AXES:
                        if v[a] < w[a]:
                            return False
                    for a in self.MIN_AXES:
                        if v[a] > w[a]:
                            return False
                    if any(A["kw"][k] < B["kw"][k] for k in reqs):
                        return False
                    if not A["ban"] <= B["ban"]:
                        return False
                    return A["size"] <= B["size"]

                def prune(states):
                    kept = []
                    for s in states:
                        if any(pdom(k, s) for k in kept):
                            continue
                        kept = [k for k in kept if not pdom(s, k)]
                        kept.append(s)
                    return kept

                for cands in cand_lists:
                    add = []
                    for st in fr:
                        for it in cands:
                            if it.tokens & st["ban"]:
                                continue
                            add.append({
                                "v": {a: st["v"][a] + it.stats.get(a, 0.) for a in AXES},
                                "kw": {k: min(st["kw"][k] + it.keywords.count(k), reqs[k]) for k in reqs},
                                "ban": st["ban"] | it.tokens, "size": st["size"] + 1})
                    if len(fr) + len(add) > 6 * CAP:
                        return (CAP, True)
                    fr = prune(fr + add)
                    if len(fr) > CAP:
                        return (CAP, True)
                return (len(fr), False)

            armor = [slots.get(sl, []) for sl in self.SINGLE]
            gear_n, gear_cap = grp(armor)
            tb_n, tb_cap = grp([slots.get("tools", []), slots.get("pet", []), slots.get("consumable", [])])
            ring = slots.get("ring1", [])
            rings_n, rings_cap = grp([ring, ring])
            combine = gear_n * tb_n * rings_n
            reqinfo = "none"
            if reqs:
                reqslots = [sl for sl in slots if any(any(k in it.keywords for k in reqs) for it in slots[sl])]
                reqinfo = f"{dict(reqs)} slots={reqslots}"
            perslot = ",".join(f"{sl}={len(slots.get(sl, []))}"
                               for sl in (list(self.SINGLE) + ["ring1", "tools", "pet", "consumable"]))

            def tag(n, c):
                return f"{n}{'+' if c else ''}"
            print(f"[GROUP-FRONTIER] {name} | reqs={reqinfo} | "
                  f"gear={tag(gear_n, gear_cap)} tools_bundle={tag(tb_n, tb_cap)} "
                  f"rings={tag(rings_n, rings_cap)} | combine_product={combine}"
                  f"{'+' if (gear_cap or tb_cap or rings_cap) else ''} | perslot=[{perslot}]")
        except Exception as _e:
            print(f"[GROUP-FRONTIER] {name} error: {_e}")

    def _write_plateau_dump(self, refs_single, refs_pool, refs_meta, S0, kappa, WE_level, best_r):
        """Serialize the near-optimal plateau (item names + 6-axis vectors) to
        _PLATEAU_OUT for post-hoc Pareto-incomparability analysis."""
        import json
        AXES = self.AXES

        def _cid_name(cid):
            if cid in refs_pool:
                return "tools:[" + ", ".join(getattr(x, "name", str(x)) for x in refs_pool[cid]) + "]"
            if cid in refs_meta:
                return "set:" + str(cid)
            if cid in refs_single:
                return getattr(refs_single[cid], "name", str(cid))
            return str(cid)

        thr = best_r * (1.0 - self._PLATEAU_REL_EPS) if best_r > float("-inf") else float("-inf")
        entries = [e for e in self._plateau_dump if e[0] >= thr]
        entries.sort(key=lambda e: e[0], reverse=True)
        entries = entries[:500]
        out = {
            "activity": self._cur_activity_name,
            "best_r": best_r,
            "rel_eps": self._PLATEAU_REL_EPS,
            "leaves_seen": self._plateau_seen,
            "plateau_hits_within_eps": self._plateau_hits,
            "budget_exhausted": bool(self.last_run_budget_exhausted),
            "node_budget": self.NODE_BUDGET,
            "written": len(entries),
            "entries": [
                {"r": r, "steps": self.steps(S0, kappa, WE_level, sv),
                 "axes": {a: round(sv.get(a, 0.), 6) for a in AXES},
                 "items": [_cid_name(c) for _l, c in ch]}
                for (r, sv, ch) in entries
            ],
        }
        try:
            with open(self._PLATEAU_OUT, "w") as fh:
                json.dump(out, fh, indent=2, default=str)
            print(f"[PLATEAU] {self._cur_activity_name}: seen={self._plateau_seen} "
                  f"within_eps={self._plateau_hits} wrote={len(entries)} "
                  f"nodes={self._last_opt_nodes} dedup_ring={self.DEDUP_RING_ORDER} "
                  f"-> {self._PLATEAU_OUT} exhausted={self.last_run_budget_exhausted}")
        except Exception as _e:
            print(f"[PLATEAU] write failed: {_e}")

    def _debug_log(self, activity, character, skill, location, gearset, slots, refs_single,
                   base, X0, S0, kappa, WE_level):
        AXES = self.AXES
        _dbg_slot = self.debug_slot
        try:
            def _gv(it):
                try:
                    return self._vec(it.get_stats_for_skill(skill=skill, location=location, character=character))
                except Exception:
                    return {}
            s_win = {a: base.get(a, 0.) for a in AXES}
            for _sl, _it in gearset.items():
                if _it is None:
                    continue
                for a, v in _gv(_it).items():
                    s_win[a] = s_win.get(a, 0.) + v
            _raw_we = WE_level + s_win.get(self.CAP_AXIS, 0.)
            _eff = min(_raw_we, kappa)
            print(f"[EXACT_DBG] {getattr(activity, 'name', '?')} skill={skill} "
                  f"kappa(cap)={kappa} WE_level={WE_level:.4f} "
                  f"base_W={base.get(self.CAP_AXIS, 0.):.4f} base_Pxp={base.get('P_xp', 0.):.4f}")
            print(f"[EXACT_DBG]   WIN total_W={s_win.get(self.CAP_AXIS, 0.):.4f} raw_WE(lvl+gear+base)={_raw_we:.4f} "
                  f"eff={_eff:.4f} over_cap={_raw_we > kappa + 1e-9} "
                  f"Pxp={s_win.get('P_xp', 0.):.4f} B={s_win.get('B', 0.):.4f} "
                  f"R={self.score(X0, S0, kappa, WE_level, s_win):.5f} "
                  f"{_dbg_slot}={getattr(gearset.get(_dbg_slot), 'name', 'None')}")
            _chosen = gearset.get(_dbg_slot)
            _chosen_vec = _gv(_chosen) if _chosen is not None else {}
            _s_base = {a: s_win.get(a, 0.) - _chosen_vec.get(a, 0.) for a in AXES}
            _cands = slots.get(_dbg_slot) or []
            if not _cands:
                print(f"[EXACT_DBG]   (no surviving candidates for slot '{_dbg_slot}')")
            for _cand in _cands:
                _it = refs_single.get(_cand.id)
                _cv = _gv(_it) if _it is not None else dict(_cand.stats)
                _s_try = {a: _s_base.get(a, 0.) + _cv.get(a, 0.) for a in AXES}
                _raw = WE_level + _s_try.get(self.CAP_AXIS, 0.)
                print(f"[EXACT_DBG]   cand {getattr(_it, 'name', '?'):34} "
                      f"W={_cv.get(self.CAP_AXIS, 0.):.4f} B={_cv.get('B', 0.):.4f} Pxp={_cv.get('P_xp', 0.):.4f} "
                      f"tb={_cand.tb:.4f} | raw_WE={_raw:.4f} eff={min(_raw, kappa):.4f} "
                      f"over_cap={_raw > kappa + 1e-9} R={self.score(X0, S0, kappa, WE_level, _s_try):.5f}")
        except Exception as _dbg_e:
            print(f"[EXACT_DBG] logging error: {_dbg_e}")
