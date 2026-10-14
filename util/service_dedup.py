"""Service dedup + dominance for chests_recipes (Best Chest Farming for Recipes).

A recipe's chest can be crafted at any of several service instances (benches) of
the required tier. Each instance has:
  - a LOCATION whose region tags scope the candidate gear (locationHasKeywords),
  - intrinsic bench stats (e.g. Blackspell trinketry +5% double_rewards).

Two instances yield the IDENTICAL optimization iff their per-character
scoped-gear profile AND their objective-relevant intrinsic stats are equal.
`scoped_gear_key` (the exact per-character hash of the location-scoped candidate
gear) is computed by the caller (via the optimizer probe) and passed in here —
this module owns only the pure dominance/grouping/(i) logic on top of it.

Dominance: among instances sharing a scoped_gear_key, drop any whose
objective-relevant intrinsic stats are Pareto-dominated by another (Blackspell
+5% DR strictly dominates the no-stat GDTE benches for a chest objective). A
mixed-stat bench (e.g. +DR but -WE) is NOT dominated and survives as its own
solve. Stats that don't affect the objective (e.g. bonus_xp on a chest run) are
excluded from dominance and instead surfaced via an (i) tooltip.
"""

# Objective-relevant axes for the chest / target-rate objective, split by
# direction. XP axes (bonus_xp_*) are deliberately absent — they don't affect a
# chest-finding run, so they become (i)-tooltip extras, not dominance inputs.
_MAX_AXES = ("work_efficiency", "double_action", "double_rewards",
             "chest_finding", "find_collectibles", "find_gems",
             "find_bird_nests", "fine_material_finding")
_MIN_AXES = ("steps_add", "steps_percent")
_RELEVANT = frozenset(_MAX_AXES + _MIN_AXES)


def service_intrinsic_stats(service, skill_key):
    """Flatten a ServiceInstance's own intrinsic stats for `skill_key` into a
    {stat: value} dict. Reads _stats[skill]['global'] (the bench-intrinsic
    scope). Gated (reputation) stats are intentionally NOT folded here — they're
    conditional and handled as part of the scoped profile by the caller."""
    out = {}
    stats = getattr(service, "_stats", None) or {}
    skill_block = stats.get(skill_key) or stats.get((skill_key or "").lower()) or {}
    for scope in ("global", (skill_key or "").lower()):
        block = skill_block.get(scope)
        if isinstance(block, dict):
            for k, v in block.items():
                try:
                    out[k] = out.get(k, 0.0) + float(v)
                except (TypeError, ValueError):
                    pass
    return out


def relevant_intrinsic(intrinsic):
    """Subset of intrinsic stats that affect the chest/target-rate objective."""
    return {k: v for k, v in intrinsic.items() if k in _RELEVANT and v}


def irrelevant_intrinsic(intrinsic):
    """The non-objective stats (e.g. bonus_xp_percent) — surfaced via (i)."""
    return {k: v for k, v in intrinsic.items() if k not in _RELEVANT and v}


def _rel_key(rel):
    return tuple(sorted((k, round(float(v), 9)) for k, v in rel.items()))


def dominates(a_rel, b_rel):
    """True if intrinsic-stat dict a Pareto-dominates b on the objective axes:
    >= on every MAX axis, <= on every MIN axis, and strictly better on >=1."""
    strict = False
    for ax in _MAX_AXES:
        av = a_rel.get(ax, 0.0); bv = b_rel.get(ax, 0.0)
        if av < bv:
            return False
        if av > bv:
            strict = True
    for ax in _MIN_AXES:
        av = a_rel.get(ax, 0.0); bv = b_rel.get(ax, 0.0)
        if av > bv:
            return False
        if av < bv:
            strict = True
    return strict


class ServiceCandidate:
    """One service instance considered for a recipe's chest optimization.
      scoped_gear_key: exact per-character hash of the location-scoped candidate
        gear (computed by the caller); only instances with the SAME key are
        comparable/groupable.
      intrinsic: full {stat: value} from service_intrinsic_stats().
    """
    __slots__ = ("name", "location", "scoped_gear_key", "intrinsic",
                 "rel", "irrel")

    def __init__(self, name, location, scoped_gear_key, intrinsic):
        self.name = name
        self.location = location
        self.scoped_gear_key = scoped_gear_key
        self.intrinsic = dict(intrinsic or {})
        self.rel = relevant_intrinsic(self.intrinsic)
        self.irrel = irrelevant_intrinsic(self.intrinsic)


def dedup_and_dominate(candidates):
    """Given ServiceCandidates for one recipe/chest, return the surviving groups
    to actually optimize. Returns a list of dicts:
      { 'representative': ServiceCandidate,   # the one to solve
        'locations': [location names sharing this exact solve],
        'extras_info': [(name, location, irrel_stats) ...] }  # (i)-tooltip
    Rules (all EXACT):
      1. Group by (scoped_gear_key, relevant-intrinsic signature) — identical
         solves collapse; their locations are listed together.
      2. Within a scoped_gear_key, drop any group Pareto-dominated by another.
      3. Instances whose ONLY difference is an objective-irrelevant stat (e.g.
         +XP) join the matching relevant-signature group, are flagged for the
         (i) tooltip, and sort FIRST in the group's location list.
    """
    # Group by exact solve signature.
    groups = {}
    for c in candidates:
        key = (c.scoped_gear_key, _rel_key(c.rel))
        groups.setdefault(key, []).append(c)

    # Pareto-dominance within each scoped_gear_key across distinct rel-sigs.
    surviving = []
    by_gear = {}
    for (gear_key, rel_sig), members in groups.items():
        by_gear.setdefault(gear_key, []).append((rel_sig, members))
    for gear_key, sigs in by_gear.items():
        rels = [dict(members[0].rel) for (_sig, members) in sigs]
        keep = []
        for i, (sig_i, members_i) in enumerate(sigs):
            dominated = any(
                j != i and dominates(rels[j], rels[i]) and rels[j] != rels[i]
                for j in range(len(sigs)))
            if not dominated:
                keep.append((sig_i, members_i))
        surviving.extend(keep)

    # Build output: pick a representative, list locations, flag (i) extras.
    out = []
    for _sig, members in surviving:
        # extras-carrying instances (irrelevant stats) sort first.
        members_sorted = sorted(members, key=lambda c: (0 if c.irrel else 1, c.location or ""))
        rep = members_sorted[0]
        out.append({
            "representative": rep,
            "locations": [c.location for c in members_sorted],
            "extras_info": [(c.name, c.location, c.irrel) for c in members_sorted if c.irrel],
        })
    return out


def grouped_name(base_name, locations):
    """'Basic Kitchen (Blackspell Harbour, Everhaven, or Salsfirth)'.

    2-item lists use 'A or B' (no Oxford comma); the comma+or form is only
    correct for 3+ items (bug: 'Barbantok, or Kallaheim' -> 'Barbantok or
    Kallaheim'). (Thread 2026-07-29.)"""
    locs = [l for l in locations if l]
    if not locs:
        return base_name
    if len(locs) == 1:
        return f"{base_name} ({locs[0]})"
    if len(locs) == 2:
        return f"{base_name} ({locs[0]} or {locs[1]})"
    return f"{base_name} ({', '.join(locs[:-1])}, or {locs[-1]})"
