"""Exact saturation-headroom transform (fc-preopt Step 2).

See .kiro/specs/fc-preopt/exact-speedup-design.md §1.

An objective axis is saturated by one of:
  * upper-only:  sat(x) = min(x, C)                 (W: eff = min(WE_level+W, kappa))
  * floor+cap:   sat(x) = clamp(x, 0, C) = min(C, max(0, x))   (DR, NMC, QO)

When we fix ONE group's contribution to an axis (a tool bundle, or the
accumulated B&B state) and the rest of the gearset is still open, we may replace
that group's raw axis value `T` with

    T_hat = min(T, H),   H = C - F - L

where
    C = the axis saturation cap,
    F = the fixed/already-known contribution to this axis (base + service +
        level bonus + any already-selected slots), counted exactly once,
    L = a LOWER bound on the sum of all remaining (not-yet-chosen) slot
        contributions to this axis.

`L` must be a genuine lower bound: for each remaining slot, the minimum
contribution over its candidates INCLUDING the empty choice (0). Omitting a
legal negative candidate is NOT safe (it would overstate L and clip too hard).

Exactness, for EVERY completion R (not just the optimum): with `R >= L`,
    sat(F + T + R) == sat(F + T_hat + R).
Proof: if T <= H then T_hat = T (identical). If T > H then F + H + R >=
F + H + L = C, so the UPPER cap pins both sides to C; capping T lowers the
pre-sat value but never below C, so neither the cap nor the 0-floor sees a
different clamped result. The floor is untouched because the transform only
removes upper-saturation excess, never pushing a value toward 0.

This module is pure and standalone so the transform can be validated
exhaustively (tests/test_headroom_transform_exact.py) before it is wired into
pool_frontier / the B&B.
"""
from __future__ import annotations

from typing import Iterable, Sequence


def clamp(x: float, floor, cap) -> float:
    """sat(x). floor=None => upper-only (no 0 floor, e.g. the W axis)."""
    if cap is not None and x > cap:
        x = cap
    if floor is not None and x < floor:
        x = floor
    return x


def remaining_lower_bound(remaining_slot_candidates: Iterable[Sequence[float]]) -> float:
    """L = sum over remaining slots of the minimum candidate contribution,
    INCLUDING the empty choice (0.0). Pass each slot's candidate axis values;
    an empty/omittable slot contributes min(..., 0.0)."""
    total = 0.0
    for vals in remaining_slot_candidates:
        lo = 0.0  # empty choice
        for v in vals:
            if v < lo:
                lo = v
        total += lo
    return total


def safe_headroom(cap: float, fixed: float, remaining_lb: float) -> float:
    """H = C - F - L. May exceed C (when L < 0, i.e. remaining slots can drag
    the axis down) — that is correct and is exactly what preserves exactness
    under cursed/negative contributions."""
    return cap - fixed - remaining_lb


def cap_value(value: float, headroom: float) -> float:
    """T_hat = min(T, H)."""
    return value if value <= headroom else headroom
