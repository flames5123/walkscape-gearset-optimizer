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
    # Quality-aware id. Quality variants of the same base item SHARE a uuid
    # (e.g. "Gold ruby ring (Good)" and "(Excellent)" are both uuid 532971e1…)
    # but have distinct names (quality is a name suffix). Keying on uuid alone
    # collided them, so owned_qty and refs_single got overwritten: the Pareto
    # frontier used one quality's stat vector but resolved/equipped a different
    # quality instance (crafted items showed Normal though Good was owned), and
    # the dual-ring pair frontier couldn't tell Excellent from Good (blank ring
    # slot / worse ring picked). Combining uuid + name makes each quality a
    # distinct candidate: single slots let the better quality dominate (prune)
    # the worse, while rings keep both qualities available for pairing.
    base = getattr(it, "uuid", None) or getattr(it, "name", None) or str(id(it))
    name = getattr(it, "name", None)
    return (base, name) if name else base


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

    # Step floor: activities and crafting BOTH floor at 10 (game rule: no action
    # costs fewer than 10 steps). Per-solve override via attribute on the
    # activity/adapter (step_floor). Default matches both.
    STEP_FLOOR = 10

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
        st = max(math.ceil(base * (1.0 + s["S_pct"]) + s["S_add"]), self.STEP_FLOOR)
        # Double action reduces EXPECTED steps fractionally (no ceil) — matches
        # activities.get_expected_drop_rate. A second ceil rounds small DA away.
        return st / (1.0 + s["B"])

    def steps_lower_bound(self, S0, kappa, WE_level, s, R):
        # Point 1: cap achievable CAP_AXIS at the tightest reachable value
        # (level + gear + suffix reserve, clamped) instead of pinning at kappa,
        # so sub-cap branches get a much tighter (still admissible) bound.
        eff = min(WE_level + s[self.CAP_AXIS] + R[self.CAP_AXIS], kappa)
        b = S0 / (1.0 + eff)
        st = max(math.ceil(b * (1.0 + s["S_pct"] + R["S_pct"]) + s["S_add"] + R["S_add"]), self.STEP_FLOOR)
        return st / (1.0 + s["B"] + R["B"])

    def score(self, X0, S0, kappa, WE_level, s):
        return self.numerator(X0, s) / self.steps(S0, kappa, WE_level, s)

    def bound_value(self, X0, S0, kappa, WE_level, s, R):
        return self.numerator_bound(X0, s, R) / self.steps_lower_bound(S0, kappa, WE_level, s, R)

    # ── helpers ─────────────────────────────────────────────────────────────
    def _vec(self, stats):
        v = {ax: float(stats[k]) for k, ax in self.AXIS_MAP.items() if k in stats}
        # One-time activities: DA never averages out over a single action, so
        # get_expected_drop_rate zeroes it. Mirror that here so B (double_action)
        # doesn't wrongly reduce the modeled steps and over-value DA gear.
        if getattr(self, "_one_time", False):
            v["B"] = 0.0
        return v

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

    def _prune_tool_candidates(self, tools, refs_single, reqs, excluded_kw, set_names):
        """Exact pre-frontier pruning of the tool pool (runs before
        pool_frontier). Three passes, each provably exact — every removed tool
        can never appear in an optimal bundle:

          #1 Relaxed mutual-exclusion dominance. A prunes B when A >= B on every
             scored axis, A covers B's required keywords, A and B share a banned
             token (so at most one is ever worn -> pruning the loser is safe),
             and A's EXTRA tokens are non-required, non-set, and appear only on
             tools that also conflict with B (so A's extra bans can't cost a
             companion B could have kept). Gated on mutual exclusion, so tools
             that CAN coexist (e.g. skydiscs -- 'skydisc' is excluded from
             tokens) are never pruned. Collapses interchangeable fishing tools
             (rod/net/spear/cage all share 'fishing tool') to the single best,
             and Wintry pan over Gold pan (both tokens {gold pan}).

          #2 Drop net-harmful tools. A tool with no beneficial objective stat
             (nothing positive on a MAX axis and nothing negative on a MIN
             axis — e.g. only -WE + bonus-XP) can only hurt the objective, so
             drop it unless it provides a required keyword or is a set piece.

          #3 Required-keyword conflict cull. For each required keyword, take the
             intersection of the full keyword lists of ALL its providers; any
             banned keyword in that intersection is guaranteed to be in every
             valid bundle's ban set (a provider is mandatory), so any tool that
             shares it and provides NO required keyword can never be worn — cull
             it. Tools providing some required keyword are never culled (they
             may be needed for that role).
        """
        if not tools:
            return tools
        from collections import defaultdict

        def full_kws(it):
            raw = refs_single.get(it.id)
            return frozenset(str(k).lower() for k in (getattr(raw, "keywords", []) or []))

        MAXA = self.MAX_AXES; MINA = self.MIN_AXES; AXES = self.AXES

        # #1 — relaxed mutual-exclusion dominance. Precompute token -> bearers so
        # a dominator's EXTRA tokens can be verified to only ban B-incompatible
        # tools.
        _bearers = defaultdict(list)
        for it in tools:
            for t in it.tokens:
                _bearers[t].append(it)

        def _conflict(a, b):
            return bool(a.tokens & b.tokens)

        def _dom_tool(A, B):
            # Prune B iff A dominates it AND they mutually exclude (share a
            # banned token). Exact: tools that can coexist are never pruned.
            if not _conflict(A, B):
                return False
            ga = A.stats.get; gb = B.stats.get
            for a in MAXA:
                if ga(a, 0.) < gb(a, 0.):
                    return False
            for a in MINA:
                if ga(a, 0.) > gb(a, 0.):
                    return False
            if any(A.keywords.count(k) < B.keywords.count(k) for k in reqs):
                return False
            # A's extra tokens must be harmless relative to B: non-required,
            # non-set, and every pool tool bearing them also conflicts with B
            # (so banning them removes only tools that can't coexist with B).
            for t in (A.tokens - B.tokens):
                if t in reqs or t in set_names:
                    return False
                if any(not _conflict(Z, B) for Z in _bearers.get(t, ())):
                    return False
            if all(ga(a, 0.) == gb(a, 0.) for a in AXES) and A.tb < B.tb:
                return False   # exact tie -> keep the higher-tb one
            return True

        kept = []
        for i, B in enumerate(tools):
            dominated = False
            for j, A in enumerate(tools):
                if i == j:
                    continue
                if _dom_tool(A, B):
                    if j > i and _dom_tool(B, A):   # equal pair: keep earlier index
                        continue
                    dominated = True
                    break
            if not dominated:
                kept.append(B)
        tools = kept

        # #2 — drop net-harmful tools (no beneficial axis, no keyword, no set)
        MAXA = self.MAX_AXES; MINA = self.MIN_AXES
        kept = []
        for it in tools:
            beneficial = (any(it.stats.get(a, 0.0) > 0 for a in MAXA)
                          or any(it.stats.get(a, 0.0) < 0 for a in MINA))
            if beneficial or it.keywords or (full_kws(it) & set_names):
                kept.append(it)
        tools = kept

        # #3 — required-keyword conflict cull
        for rk in reqs:
            providers = [it for it in tools if rk in it.keywords]
            if not providers:
                continue
            inter = set(full_kws(providers[0]))
            for it in providers[1:]:
                inter &= full_kws(it)
            guaranteed_banned = {k for k in inter if k not in excluded_kw}
            if not guaranteed_banned:
                continue
            tools = [it for it in tools
                     if it.keywords or not (it.tokens & guaranteed_banned)]
        return tools

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

        # Flat-tuple dominance: precompute each state's comparison vector once —
        # MAX axes as-is, MIN axes negated, then keyword provision — so
        # "A dominates B" reduces to a single componentwise >= scan with early
        # exit, no per-axis dict lookups (~3-5x faster than the old dict compare,
        # which was 31.5M calls on Cave's gear build).
        _MAXA = self.MAX_AXES; _MINA = self.MIN_AXES; _RK = tuple(reqs)
        _DLEN = len(_MAXA) + len(_MINA) + len(_RK)

        def _dt(s):
            v = s["v"]; kw = s["kw"]
            return (tuple(v[a] for a in _MAXA)
                    + tuple(-v[a] for a in _MINA)
                    + tuple(kw[k] for k in _RK))

        def dominates_t(da, db):
            for i in range(_DLEN):
                if da[i] < db[i]:
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
                dt = s.get("dt")
                if dt is None:
                    dt = s["dt"] = _dt(s)
                groups[gkey(s)].append(s)
            out = []
            for g in groups.values():
                # Sort by primary MAX axis (dt[0]) DESC, then fewer pieces. In
                # descending-primary order every already-kept state has
                # primary >= the current one, so the current state can only
                # dominate kept states with EQUAL primary — the removal scan
                # skips all unequal-primary kept (near-free), eliminating the
                # expensive full "s dominates kept" pass.
                g.sort(key=lambda s: (-s["dt"][0], len(s["comp"])))
                kept = []
                for s in g:
                    sdt = s["dt"]; sp = sdt[0]
                    dominated = False
                    for k in kept:
                        if dominates_t(k["dt"], sdt):
                            dominated = True
                            break
                    if dominated:
                        continue
                    kept = [k for k in kept
                            if k["dt"][0] != sp or not dominates_t(sdt, k["dt"])]
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
    # Max |FT|·|FR| accessory product to attempt the FA pre-merge on. A bail
    # already pays the FG/FT/FR build, and MITM just reuses those frontiers with
    # a combine bounded by _MITM_COMBINE_CAP — so MITM is never slower than
    # bailing to B&B. This cap only guards against a pathologically huge
    # accessory product (tool-heavy activities) making the FA merge itself
    # (O(|FT|·|FR|·|FA|)) blow up. Coral (~3.5k), Cave (~2k), Bog Net (~22k) all
    # run MITM; only extreme tool pools bail.
    _FA_BUILD_CAP = 60_000

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
        fr = self._mitm_frontiers(slots, metas, reqs)
        if fr is None:
            return float("-inf"), None, None      # bail -> caller falls back to B&B
        FG, FT, FR, FA = fr
        return self._combine_best(FG, FA, reqs, X0, S0, kappa, WE_level, base_stats)

    def _mitm_frontiers(self, slots, metas, reqs):
        """Build the MITM Pareto frontiers (FG gear, FT tools+pet+consumable,
        FR ring-pair, FA = FT∪FR merged) for a candidate `slots` set. Returns
        (FG, FT, FR, FA) or None to bail (accessory product or combine product
        over cap -> caller falls back to B&B). Split out of _optimize_mitm so the
        frontiers can be CACHED and reused across recipes that share the same
        (skill, location, reqs, pools) — the frontiers depend only on the item
        pools, not on base_steps/kappa/WE_level/base_stats (those enter the
        combine). See _run's frontier cache."""
        reqs = reqs or {}
        ring = slots.get("ring1", [])
        FG = self._group_collapse([(sl, slots.get(sl, [])) for sl in self.SINGLE], metas, reqs)
        FT = self._group_collapse([("tools", slots.get("tools", [])),
                                   ("pet", slots.get("pet", [])),
                                   ("consumable", slots.get("consumable", []))], reqs=reqs)
        FR = self._group_collapse([("ring1", ring), ("ring2", ring)], reqs=reqs)
        if len(FT) * len(FR) > self._FA_BUILD_CAP:
            return None
        FA = self._merge_accessories(FT, FR, reqs)
        if len(FG) * len(FA) > self._MITM_COMBINE_CAP:
            return None
        return (FG, FT, FR, FA)

    # ── frontier reuse cache (recipe-gated) ──────────────────────────────────
    def _frontier_key(self, character, skill, location, reqs, pets, consumables):
        """Cache key for the MITM frontiers. Frontiers depend on the item pools
        (skill+location+character) and the keyword requirements — NOT on the
        recipe's base_steps/kappa/WE_level/base_stats (combine-time). Character
        is fixed within a run (keyed by identity), and the pet/consumable pools
        are skill-scoped, so (char, skill, location, reqs, pet-sig, consumable-sig)
        uniquely identifies the frontier build. The cache is run-scoped (cleared
        per run) so character identity never collides across runs."""
        if isinstance(location, str):
            loc_id = location
        else:
            loc_id = getattr(location, "id", None) or getattr(location, "name", None) or str(location)
        pet_sig = tuple(sorted(
            f"{getattr(p, 'species', getattr(p, 'name', ''))}:{getattr(p, 'level', '')}"
            for p in (pets or [])))
        con_sig = tuple(sorted(getattr(c, "name", str(c)) for c in (consumables or [])))
        return (id(character), str(skill).lower(), str(loc_id).lower(),
                tuple(sorted(reqs.items())), pet_sig, con_sig)

    def _rescale_acoins(self, states, factor):
        """Return frontier states with the aggregated find-axis (A_coins)
        rescaled by `factor`. Cached frontiers embed A_coins at the build
        recipe's k-scale (k = C0 = base_chest_rate/base_steps for the recipe
        chest target); a reusing recipe has a different base_steps, so its
        numerator axis must be rescaled by C0_now/C0_build. Pareto dominance is
        scale-invariant, so the cached frontier SET is valid for the reusing
        recipe — only the stored A_coins VALUE needs correcting. No-ops when
        A_coins isn't an axis or factor≈1."""
        if "A_coins" not in self.AXES or abs(factor - 1.0) < 1e-15:
            return states
        out = []
        for s in states:
            v = dict(s["v"]); v["A_coins"] = v.get("A_coins", 0.0) * factor
            ns = dict(s); ns["v"] = v; ns.pop("dt", None)
            out.append(ns)
        return out

    def _build_base_axis(self, base_stats, character, skill, location, input_item):
        """Baseline axis-stat vector (service base_stats + always-on collectibles
        + input-item stats), folded through _vec at the CURRENT recipe's k-scale.
        Independent of the item pools, so it's recomputed fresh per recipe even
        on a frontier cache hit."""
        # base_stats arrives with RAW stat keys (work_efficiency, chest_finding,
        # steps_add, …) from service.get_stats_for_skill — NOT axis keys. Fold it
        # through _vec (the same raw→axis mapping used for collectibles/items,
        # which also routes find-axes into A_coins) instead of an axis-key lookup
        # that silently dropped every service stat. Without this the engine
        # ignored service work_efficiency/steps_add/chest_finding and mis-ranked
        # below-cap gearsets (e.g. proper set inflated at cursed services with
        # negative WE). (Thread 2026-07-28.)
        base = {a: 0.0 for a in self.AXES}
        for ax, val in self._vec(base_stats or {}).items():
            base[ax] = base.get(ax, 0.) + val
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
        return base

    def _reconstruct_gearset(self, load, refs_single, refs_meta, refs_pool, n_tools):
        """Map a combine `load` (list of (slot_label, cid)) back to a
        {slot: Item} gearset using the reference maps. Shared by the fresh-build
        and frontier-cache-hit paths."""
        all_slots = list(self.SINGLE) + ["ring1", "ring2", "pet", "consumable"] + \
            [f"tool{i}" for i in range(n_tools)]
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
        return gearset

    def _combine_best(self, FG, FA, reqs, X0, S0, kappa, WE_level, base_stats):
        """Generic FG × FA combine: pick the (gear, accessories) pair with the
        best score, tie-broken toward fewer pieces. This is the EXACT reference
        implementation. Objective subclasses (coins, XP) override it with an
        inlined hot loop that reproduces bit-identical (best_r, best_load,
        best_s). Returns (best_r, best_load, best_s), or (-inf, None, None) when
        no feasible pair exists. Flatten frontier vectors to AXES-ordered tuples
        (kills the per-pair dict rebuild) and memoize the pure-function steps
        denominator, which depends only on (effWE, S_add, S_pct, B)."""
        AXES = self.AXES
        s0 = {a: float(base_stats.get(a, 0.)) for a in AXES}
        s0v = tuple(s0[a] for a in AXES)
        nax = len(AXES)
        iW = AXES.index(self.CAP_AXIS)
        iSa = AXES.index("S_add"); iSp = AXES.index("S_pct"); iB = AXES.index("B")
        FGv = [(tuple(g["v"][a] for a in AXES), g["kw"], g["comp"]) for g in FG]
        FAv = [(tuple(a["v"][ax] for ax in AXES), a["kw"], a["comp"]) for a in FA]
        step_cache = {}
        def _steps_of(sv):
            key = (sv[iW], sv[iSa], sv[iSp], sv[iB])
            st = step_cache.get(key)
            if st is None:
                eff = min(WE_level + sv[iW], kappa)
                stp = max(math.ceil((S0 / (1.0 + eff)) * (1.0 + sv[iSp]) + sv[iSa]), self.STEP_FLOOR)
                st = stp / (1.0 + sv[iB])
                step_cache[key] = st
            return st
        best_r = float("-inf"); best_nfill = None; best_load = None; best_s = None
        rng = range(nax)
        for gv, kG, cG in FGv:
            for av, kA, cA in FAv:
                feasible = True
                for k, t in reqs.items():
                    if kG[k] + kA[k] < t:
                        feasible = False
                        break
                if not feasible:
                    continue
                sv = tuple(s0v[j] + gv[j] + av[j] for j in rng)
                s = dict(zip(AXES, sv))
                r = self.numerator(X0, s) / _steps_of(sv)
                nfill = -(len(cG) + len(cA))
                if best_load is None or (r, nfill) > (best_r, best_nfill):
                    best_r = r; best_nfill = nfill
                    best_load = list(cG) + list(cA)
                    best_s = s
        return best_r, best_load, best_s

    def _merge_accessories(self, FT, FR, reqs):
        """Pareto-merge the tool-bundle frontier FT and the ring-pair frontier
        FR into a single accessories frontier, so the MITM combine is FG × FA
        rather than FG × FT × FR. Tools and rings are disjoint item pools, so
        every (bundle, ring-pair) pair is a valid combination. Dominance uses
        RAW (uncapped) axes — a piece's surplus W must be preserved because
        higher raw W is always weakly better once summed and clamped at κ (and a
        downstream negative-W item could reclaim it) — and kw provision is
        clamped to the requirement (excess is useless in the ≥-threshold
        combine feasibility test). Exact by MITM monotonicity."""
        AXES = self.AXES; MAXA = self.MAX_AXES; MINA = self.MIN_AXES
        reqs = reqs or {}
        cand = []
        for gT in FT:
            vT = gT["v"]; kT = gT["kw"]; cT = gT["comp"]
            for gR in FR:
                vR = gR["v"]; kR = gR["kw"]
                cand.append({
                    "v": {a: vT[a] + vR[a] for a in AXES},
                    "kw": {k: min(kT[k] + kR[k], reqs[k]) for k in reqs},
                    "comp": list(cT) + list(gR["comp"])})
        cand.sort(key=lambda s: len(s["comp"]))   # fewer pieces first (tie-break)

        def dom(A, B):
            va, vb = A["v"], B["v"]
            for a in MAXA:
                if va[a] < vb[a]:
                    return False
            for a in MINA:
                if va[a] > vb[a]:
                    return False
            ka, kb = A["kw"], B["kw"]
            for k in reqs:
                if ka[k] < kb[k]:
                    return False
            return True

        kept = []
        for s in cand:
            if any(dom(k, s) for k in kept):
                continue
            kept = [k for k in kept if not dom(s, k)]
            kept.append(s)
        return kept

    # ── public entry ─────────────────────────────────────────────────────────
    def optimize(self, activity, character, skill=None, location=None, base_stats=None,
                 pets=None, consumables=None, input_item=None, frontier_cache=None):
        """Return {slot: Item|None} for controlled slots, or None to fall back."""
        self.last_run_budget_exhausted = False
        self._frontier_cache = frontier_cache
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
        # One-time activities (Venture/Explore/emergency escapes) complete in a
        # single action, so Double Action never averages out —
        # get_expected_drop_rate zeroes DA for them. Flag it so _vec neutralizes
        # the B (double_action) axis on every candidate; otherwise the optimizer
        # over-values DA gear and picks a worse real gearset on these activities.
        self._one_time = bool(getattr(activity, "one_time", False))
        try:
            lvl = character.get_skill_level(str(skill).lower())
        except Exception:
            lvl = 0
        sr = getattr(activity, "skill_requirements", {}) or {}
        req_lvl = (sr.get(skill) or (list(sr.values())[0] if sr else 1)) or 1
        WE_level = min(max(0, lvl - req_lvl), 20) * 0.0125
        # Innate (non-gear, non-service) work-efficiency the engine credits before
        # gear/service WE. The default above is the ACTIVITY level-WE rule. Crafting
        # recipes have a DIFFERENT innate level-WE bonus (e.g. 0.125 vs the activity
        # formula's 0.25 at Carpentry L62), so the recipe adapter supplies the
        # correct value via `we_level_override`; without it the engine over-credits
        # innate WE, thinks WE gear hits the max_efficiency cap sooner, and picks
        # DA-heavy gearsets the real crafting metric rates worse. Activities never
        # set this attr, so their path is unchanged. (Thread 2026-07-27.)
        _we_ov = getattr(activity, "we_level_override", None)
        if _we_ov is not None:
            WE_level = float(_we_ov)
        # Per-solve step floor: crafting floors at 1 step (vs activity 10). The
        # adapter can override via `step_floor`; activities never set it.
        _sf = getattr(activity, "step_floor", None)
        if _sf is not None:
            self.STEP_FLOOR = int(_sf)
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

        # ── frontier reuse fast-path (recipe-gated) ─────────────────────────
        # If a frontier cache is provided (recipe-chest solves only) and we've
        # already built the frontiers for this (skill, location, reqs, pools),
        # skip the whole expensive build (make / pool_frontier / group_collapse)
        # and go straight to the combine on the cached frontiers, rescaling the
        # A_coins numerator axis for this recipe's k. Frontiers are pool-only
        # (base_steps/kappa/WE_level/base_stats enter the combine), so reuse is
        # exact. (Thread 2026-07-27.)
        _fcache = getattr(self, "_frontier_cache", None)
        _fkey = None
        if (_fcache is not None and not getattr(self, "_ESTIMATE_ONLY", False)
                and getattr(self, "_C0", None) is not None):
            _fkey = self._frontier_key(character, skill, location, reqs, pets, consumables)
            _hit = _fcache.get(_fkey)
            if _hit is not None:
                _FG, _FT, _FR, _FA, _rs, _rm, _rp, _nt, _C0b = _hit
                _f = (self._C0 / _C0b) if _C0b else 1.0
                _FGr = self._rescale_acoins(_FG, _f)
                _FAr = self._rescale_acoins(_FA, _f)
                _base = self._build_base_axis(base_stats, character, skill, location, input_item)
                _r, _load, _s = self._combine_best(_FGr, _FAr, reqs, X0, S0, kappa, WE_level, _base)
                if _load is None:
                    return None
                return self._reconstruct_gearset(_load, _rs, _rm, _rp, _nt)

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

        # Keep only the highest quality per base item for single-occupancy slots
        # (gear / tools). Lower qualities are strictly dominated and only bloat
        # the pool — and after the quality-aware _item_id change they're distinct
        # candidates, so without this the tool pool could fill slots with several
        # qualities of the SAME base tool (Normal+Good+Great+Perfect Wanderlust
        # walking stick). filter_items_by_quality keeps the top 2 for rings (dual
        # ring slots), preserving the excellent+good ring-pairing fix.
        from util.optimization_utils import (
            filter_items_by_quality,
            filter_items_failing_keyword_level_requirements,
        )
        for _sl in list(by_slot.keys()):
            by_slot[_sl] = filter_items_by_quality(by_slot[_sl], keep_highest_only=True)

        # Drop candidates that can never satisfy the activity's tool
        # keyword-level requirement (e.g. a Mining-40 Tarsilium pickaxe for
        # "Mine adamant ore", which requires a pickaxe that itself requires
        # Mining 50). Such a tool carries the gated keyword but is invalid, so
        # it must not be a candidate — otherwise the objective (xp/coins/chest)
        # picks it whenever it out-scores a valid pickaxe and the report shows
        # an impossible gearset. Tool-keyword uniqueness guarantees only one
        # such tool is ever worn, so removing the under-level ones is exact.
        for _sl in list(by_slot.keys()):
            by_slot[_sl] = filter_items_failing_keyword_level_requirements(
                by_slot[_sl], activity)

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
            _PMAXA = self.MAX_AXES; _PMINA = self.MIN_AXES; _PRK = tuple(reqs)
            _PLEN = len(_PMAXA) + len(_PMINA) + len(_PRK)
            # Cap the CAP_AXIS (work_efficiency) at the max useful gear-side value
            # for dominance comparison. Any tool-bundle W past (kappa - WE_level)
            # is useless (other W sources are non-negative, so eff is already at
            # kappa). Without this, a high-W bundle wrongly dominates a
            # cap-equivalent bundle with better secondary stats. Activities keep
            # the default 10-step floor and rarely hit this (tools have low WE vs
            # activity caps), but crafting recipes (low kappa, high innate WE)
            # frequently trigger it. (Thread 2026-07-27 residual fix.)
            _w_cap = max(kappa - WE_level, 0.0)
            _cap_idx = _PMAXA.index(self.CAP_AXIS) if self.CAP_AXIS in _PMAXA else -1

            def _pdt(v, kw):
                t = tuple(min(v[a], _w_cap) if (i == _cap_idx) else v[a]
                          for i, a in enumerate(_PMAXA))
                return (t
                        + tuple(-v[a] for a in _PMINA)
                        + tuple(kw[k] for k in _PRK))
            fr = [{"v": {a: 0. for a in AXES}, "kw": {k: 0 for k in reqs},
                   "dt": (0.0,) * _PLEN,
                   "ban": frozenset(), "size": 0, "comp": (), "tb": 0.0}]

            def pdom(A, B):
                # Flat-tuple numeric dominance (MAX as-is, MIN negated, kw) then
                # token-ban subset + size — ~3-5x vs the old per-axis dict compare.
                da, db = A["dt"], B["dt"]
                for i in range(_PLEN):
                    if da[i] < db[i]:
                        return False
                if not A["ban"] <= B["ban"]:
                    return False
                if A["size"] > B["size"]:
                    return False
                # On an EXACT tie across every scored axis + ban + size, prefer
                # the bundle with more beneficial NON-scored stats (higher tb).
                # Mirrors _dom's tie-break for single slots. Without this, two
                # keyword-only tools tied on the objective (e.g. Clay skydisc CF2
                # vs Golden skydisc CF12 for a collectible target where chest_
                # finding isn't scored) were interchangeable and the first-
                # enumerated won. Tie-only => never changes the optimum; it only
                # keeps the strictly-nicer equivalent (and shrinks the frontier).
                if (A["tb"] < B["tb"] and da == db
                        and A["ban"] == B["ban"] and A["size"] == B["size"]):
                    return False
                return True
            def _merge(fr, add):
                # fr is ALREADY a Pareto antichain. Incorporate the new `add`
                # states without re-checking fr-vs-fr (that O(len(fr)^2) rescan,
                # repeated per item, was the 76M-comparison / ~40s bottleneck).
                # The Pareto antichain is unique, so this yields the identical
                # exact frontier as the old full re-prune.
                surv = []
                for a in add:
                    if any(pdom(k, a) for k in fr):
                        continue
                    if any(pdom(k, a) for k in surv):
                        continue
                    surv = [k for k in surv if not pdom(a, k)]
                    surv.append(a)
                if surv:
                    fr = [s for s in fr if not any(pdom(a, s) for a in surv)]
                    fr.extend(surv)
                return fr
            import time as _pt
            _gen = 0; _peak = 0; _t0 = _pt.perf_counter()
            for it in items:
                ib = it.tokens; ik = {k: it.keywords.count(k) for k in reqs}
                add = []
                for st in fr:
                    if st["size"] >= K or it.id in st["comp"] or (ib & st["ban"]):
                        continue
                    nv = {a: st["v"][a] + it.stats.get(a, 0.) for a in AXES}
                    nkw = {k: min(st["kw"][k] + ik[k], reqs[k]) for k in reqs}
                    add.append({"v": nv, "kw": nkw, "dt": _pdt(nv, nkw),
                                "ban": st["ban"] | ib, "size": st["size"] + 1,
                                "comp": st["comp"] + (it.id,), "tb": st["tb"] + it.tb})
                _gen += len(add)
                if add:
                    fr = _merge(fr, add)
                if len(fr) > _peak:
                    _peak = len(fr)
            _merge_ms = (_pt.perf_counter() - _t0) * 1000.0
            if _peak > 50000:
                print(f"[POOL-WARN] frontier peak {_peak} > 50000 on "
                      f"{getattr(self, '_cur_activity_name', '?')} — investigate objective-aware DP")
            if getattr(self, "_POOL_DIAG", False):
                print(f"[POOL] items={len(items)} K={K} subsets_generated={_gen} "
                      f"final_frontier={len(fr)} peak_frontier={_peak} "
                      f"merge_ms={_merge_ms:.0f}")
            out = []
            for i, st in enumerate(fr):
                pid = f"toolpool#{i}"
                refs_pool[pid] = [refs_single[c] for c in st["comp"]]
                kws = [k for k in reqs for _ in range(st["kw"][k])]
                out.append(_It(pid, dict(st["v"]), kws, st["ban"], st["tb"]))
            return out

        # Set-piece keyword names (for the #2 prune's set exception): any key of
        # gated_stats['set_pieces'] on ANY owned item is a set keyword, so a
        # tool bearing it (e.g. an 'Adventuring Tool Set' rod) is never dropped.
        _set_names = set()
        for _lst in by_slot.values():
            for _it in _lst:
                _gs = getattr(_it, "gated_stats", None)
                if isinstance(_gs, dict) and _gs.get("set_pieces"):
                    for _sn in _gs["set_pieces"].keys():
                        _set_names.add(str(_sn).lower())
        _tool_its = make(by_slot.get("tools", []))
        if getattr(self, "_TOOL_CAND_PRUNE", True):
            _n0 = len(_tool_its)
            _tool_its = self._prune_tool_candidates(
                _tool_its, refs_single, reqs, _excluded_kw, _set_names)
            if getattr(self, "_POOL_DIAG", False):
                print(f"[TOOL-PRUNE] {getattr(activity, 'name', '?')} "
                      f"tools {_n0} -> {len(_tool_its)}")
        if getattr(self, "_ESTIMATE_ONLY", False):
            # Cheap solve-cost estimate for shard load-balancing (LPT): the tool
            # BUNDLE-count upper bound C(T_pruned, tool_slots), computed WITHOUT
            # building the (expensive) tool frontier or the MITM combine. Reuses
            # the exact prep + prune above, so the estimate matches exactly what
            # the real solve would prune to (no divergent second code path). The
            # frontier grows combinatorially in the number of surviving tools, so
            # C(T, slots) tracks solve cost far better than a raw tool count.
            import math as _math
            _T = len(_tool_its)
            self.last_estimate_weight = _math.comb(_T, min(int(n_tools), _T)) if _T > 0 else 1
            return None
        slots["tools"] = pool_frontier(_tool_its, n_tools)
        for sl in self.SINGLE:
            slots[sl] = self._prune(slots[sl], reqs)
        # NOTE: pets/consumables are NOT quality-variant gear — pets have no
        # quality tiers and consumable "Fine" variants are distinct items (not
        # dominated), so filter_items_by_quality must NOT be applied here. It
        # also assumes objects with .name, but pets arrive as plain dicts, so
        # filtering them raised AttributeError that optimize()'s blanket except
        # swallowed to None -> every job (coins/xp/chests/new_items) silently
        # fell back to greedy. The gear/tool quality-dedup (the Wanderlust fix)
        # lives on by_slot above and is unaffected. (regression from 35a18bf1)
        slots["pet"] = self._prune(make(pets or []), reqs)
        slots["consumable"] = self._prune(make(consumables or []), reqs)
        # base_stats has RAW stat keys (service.get_stats_for_skill), not axis
        # keys — fold through _vec (raw→axis + find→A_coins) so service stats
        # actually reach the engine. The old axis-key lookup dropped them all.
        # (Thread 2026-07-28; see _build_base_axis for the full rationale.)
        base = {a: 0.0 for a in AXES}
        for _bax, _bval in self._vec(base_stats or {}).items():
            base[_bax] = base.get(_bax, 0.) + _bval
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
        if _use_mitm and _fkey is not None:
            # Recipe frontier cache MISS: build the frontiers once and store them
            # (plus the reference maps needed to reconstruct the gearset) so the
            # sibling recipes at this (skill, location, reqs, pools) reuse them.
            _fr = self._mitm_frontiers(slots, metas, reqs)
            if _fr is not None:
                _FG, _FT, _FR, _FA = _fr
                _fcache[_fkey] = (_FG, _FT, _FR, _FA, refs_single, refs_meta, refs_pool,
                                  n_tools, self._C0)
                r, load, _sm = self._combine_best(_FG, _FA, reqs, X0, S0, kappa, WE_level, base)
            else:
                # frontier over cap -> exact B&B fallback (not cacheable)
                r, load, _sb = self._optimize(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
        elif _use_mitm:
            import time as _t
            _t0 = _t.perf_counter()
            r_m, load_m, _sm = self._optimize_mitm(slots, metas, reqs, X0, S0, kappa, WE_level, base)
            _tm = (_t.perf_counter() - _t0) * 1000.0
            _validate = getattr(self, "_MITM_VALIDATE", True)
            if load_m is None:
                # MITM bailed (combine product over cap, or no feasible combine).
                # Fall back to the B&B ALWAYS — even in MITM-only mode — so these
                # activities still get an exact result.
                _t1 = _t.perf_counter()
                r_b, load_b, _sb = self._optimize(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
                _tb = (_t.perf_counter() - _t1) * 1000.0
                print(f"[MITM-BAIL] {getattr(activity, 'name', '?')} reqs={len(reqs)} "
                      f"-> B&B t_bnb={_tb:.0f}ms")
                r, load = r_b, load_b
            elif not _validate:
                # MITM-only: trust the (proven-exact) MITM result and SKIP the
                # slow side-by-side B&B. This is where the real speedup lands.
                print(f"[MITM-ONLY] {getattr(activity, 'name', '?')} reqs={len(reqs)} "
                      f"r_mitm={r_m:.6f} t_mitm={_tm:.0f}ms")
                r, load = r_m, load_m
            else:
                # Side-by-side validation: run the B&B too and compare.
                _t1 = _t.perf_counter()
                r_b, load_b, _sb = self._optimize(slots, metas, X0, S0, kappa, WE_level, reqs, excl, base)
                _tb = (_t.perf_counter() - _t1) * 1000.0
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
