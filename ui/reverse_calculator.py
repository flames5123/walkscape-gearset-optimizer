#!/usr/bin/env python3
"""
Reverse step calculator for generic activities and recipes.

Derives the true base_steps from the observed in-game step count by
reversing the game's step formula.  When the result is ambiguous (multiple
base_steps values map to the same observed count due to ceil rounding),
the caller can use calibration data to disambiguate.

Key formulas
------------
Forward (game formula, no gear):
    level_we = min(skill_level - required_level, 20) * 0.0125
    total_we = gear_we + level_we + collectible_we + service_we
    total_efficiency = 1.0 + total_we
    steps_with_efficiency = ceil(base_steps / total_efficiency)
    min_steps = ceil(base_steps / (1 + max_efficiency))
    steps_after_min = max(steps_with_efficiency, min_steps)
    steps_with_pct = ceil(steps_after_min * (1 + pct))
    steps_with_flat = steps_with_pct + flat
    observed_steps = max(steps_with_flat, 10)

Reverse:
    Iterate candidate base_steps values around
    observed_steps * total_efficiency and forward-calculate each to find
    which ones produce the observed step count.
"""

import math
from typing import Dict, List, Optional


# ============================================================================
# FORWARD CALCULATION
# ============================================================================

def forward_calculate(
    base_steps: int,
    skill_level: int,
    required_level: int,
    max_efficiency: float,
    collectible_we: float = 0.0,
    service_we: float = 0.0,
    gear_we: float = 0.0,
    flat: int = 0,
    pct: float = 0.0,
) -> int:
    """Forward-calculate observed steps from base steps using the game formula.

    This replicates the step calculation in
    ``GenericActivityInfo.get_expected_drop_rate`` (and the real game engine).

    Args:
        base_steps: True base steps of the activity/recipe.
        skill_level: Character's current skill level (≥ 1).
        required_level: Activity/recipe required level (≥ 1).
        max_efficiency: WE cap as a decimal (e.g. 0.60 for 60%).
        collectible_we: Collectible WE bonus as a decimal.
        service_we: Service WE bonus as a decimal (recipes only).
        gear_we: Gear WE bonus as a decimal.
        flat: Flat steps modifier (from gear).
        pct: Percentage steps modifier as a decimal (from gear).

    Returns:
        The observed step count after all bonuses are applied.
    """
    if base_steps < 1:
        return 10

    # Level WE: min(levels_above, 20) * 1.25%
    levels_above = max(0, skill_level - required_level)
    level_we = min(levels_above, 20) * 0.0125

    # Total WE (all sources)
    total_we = gear_we + level_we + collectible_we + service_we
    total_efficiency = 1.0 + total_we

    # Steps with efficiency applied
    steps_with_efficiency = math.ceil(base_steps / total_efficiency)

    # Minimum steps floor (max_efficiency cap)
    if max_efficiency > 0:
        min_steps = math.ceil(base_steps / (1.0 + max_efficiency))
    else:
        # max_efficiency=0 means no WE bonus is possible — min_steps = base_steps
        min_steps = base_steps

    steps_after_min = max(steps_with_efficiency, min_steps)

    # Percentage modifier
    steps_with_pct = math.ceil(steps_after_min * (1.0 + pct))

    # Flat modifier
    steps_with_flat = steps_with_pct + flat

    # Game floor
    observed_steps = max(steps_with_flat, 10)

    return observed_steps

def forward_calculate_xp(
    base_xp: int,
    bonus_xp_pct: float = 0.0,
    bonus_xp_add: float = 0.0,
) -> float:
    """Forward-calculate displayed XP from base XP using the game formula.

    Formula: displayed_xp = (base_xp * (1 + bonus_xp_pct)) + bonus_xp_add

    Args:
        base_xp: True base XP of the activity/recipe.
        bonus_xp_pct: Total bonus XP percent as decimal (e.g. 0.01 = 1%).
        bonus_xp_add: Total flat bonus XP.

    Returns:
        The displayed XP value (not rounded — the game shows this per action).
    """
    return (base_xp * (1.0 + bonus_xp_pct)) + bonus_xp_add


def reverse_calculate_xp(
    observed_xp: float,
    bonus_xp_pct: float = 0.0,
    bonus_xp_add: float = 0.0,
) -> Dict:
    """Reverse the XP formula to derive true base XP.

    The game displays: observed_xp = (base_xp * (1 + bonus_xp_pct)) + bonus_xp_add
    So: base_xp = (observed_xp - bonus_xp_add) / (1 + bonus_xp_pct)

    Since base_xp is always an integer, we try floor and ceil of the raw
    result and forward-calculate each to find which ones could produce the
    observed value (accounting for possible display rounding).

    Args:
        observed_xp: XP shown in-game per action with no gear equipped.
        bonus_xp_pct: Known bonus XP percent from collectibles + service (decimal).
        bonus_xp_add: Known flat bonus XP from collectibles + service.

    Returns:
        Dict with keys:
            base_xp (int | None): Resolved base XP, or None if ambiguous.
            ambiguous (bool): True when multiple candidates exist.
            candidates (list[int]): All base_xp values that could produce
                the observed XP.
            bonus_xp_pct (float): Echo of input.
            bonus_xp_add (float): Echo of input.
    """
    import math

    if observed_xp <= 0:
        return {
            'base_xp': 0,
            'ambiguous': False,
            'candidates': [0],
            'bonus_xp_pct': bonus_xp_pct,
            'bonus_xp_add': bonus_xp_add,
        }

    # If no bonuses, observed IS the base
    if bonus_xp_pct == 0.0 and bonus_xp_add == 0.0:
        base = int(observed_xp)
        return {
            'base_xp': base,
            'ambiguous': False,
            'candidates': [base],
            'bonus_xp_pct': 0.0,
            'bonus_xp_add': 0.0,
        }

    # Reverse: base_xp = (observed_xp - bonus_xp_add) / (1 + bonus_xp_pct)
    raw = (observed_xp - bonus_xp_add) / (1.0 + bonus_xp_pct)

    # Try candidates around the raw value (floor, ceil, and neighbors).
    # First pass: strict match using round() only (most likely game behavior).
    # Second pass: if no strict match, try floor/ceil too.
    candidates = []
    for b in range(max(0, math.floor(raw) - 1), math.ceil(raw) + 2):
        displayed = forward_calculate_xp(b, bonus_xp_pct, bonus_xp_add)
        if round(displayed) == observed_xp:
            candidates.append(b)

    # If strict matching found nothing, try floor/ceil
    if not candidates:
        for b in range(max(0, math.floor(raw) - 1), math.ceil(raw) + 2):
            displayed = forward_calculate_xp(b, bonus_xp_pct, bonus_xp_add)
            if math.floor(displayed) == observed_xp or math.ceil(displayed) == observed_xp:
                candidates.append(b)

    # Deduplicate and sort
    candidates = sorted(set(candidates))

    if not candidates:
        # Fallback: just use rounded raw value
        base = max(0, round(raw))
        return {
            'base_xp': base,
            'ambiguous': False,
            'candidates': [base],
            'bonus_xp_pct': bonus_xp_pct,
            'bonus_xp_add': bonus_xp_add,
        }

    ambiguous = len(candidates) != 1
    base_xp = candidates[0] if len(candidates) == 1 else None

    return {
        'base_xp': base_xp,
        'ambiguous': ambiguous,
        'candidates': candidates,
        'bonus_xp_pct': bonus_xp_pct,
        'bonus_xp_add': bonus_xp_add,
    }




# ============================================================================
# REVERSE CALCULATION
# ============================================================================

def reverse_calculate_base_steps(
    observed_steps: int,
    skill_level: int,
    required_level: int,
    max_efficiency: float,
    collectible_we: float = 0.0,
    service_we: float = 0.0,
) -> Dict:
    """Reverse the step formula to derive true base steps.

    For the "no gear" observation the gear-specific parameters are zero
    (gear_we=0, flat=0, pct=0).  We compute the known WE from level,
    collectibles, and service, then iterate candidate base_steps values
    around ``observed_steps * total_efficiency`` and forward-calculate each
    to find which ones reproduce the observed count.

    Args:
        observed_steps: Steps shown in-game with no gear equipped.
        skill_level: Character's current skill level (≥ 1).
        required_level: Activity/recipe required level (≥ 1).
        max_efficiency: WE cap as a decimal (e.g. 0.60 for 60%).
        collectible_we: Collectible WE bonus as a decimal.
        service_we: Service WE bonus as a decimal (recipes only).

    Returns:
        Dict with keys:
            base_steps (int | None): Unique result, or None if ambiguous.
            ambiguous (bool): True when multiple candidates exist.
            candidates (list[int]): All base_steps values that produce
                the observed count.
            needs_calibration (bool): True when ambiguous.
            level_we (float): Computed level WE bonus.
            collectible_we (float): Echo of input collectible WE.
            service_we (float): Echo of input service WE.
            total_we_used (float): Total known WE used in calculation.
    """
    # Compute known WE (no gear)
    levels_above = max(0, skill_level - required_level)
    level_we = min(levels_above, 20) * 0.0125
    total_we = level_we + collectible_we + service_we
    total_efficiency = 1.0 + total_we

    # Search range for candidate base_steps values.
    #
    # Case 1 — WE below cap (steps_with_efficiency > min_steps):
    #   observed ≈ ceil(base / total_efficiency)
    #   → base ≈ observed * total_efficiency  (search ± small margin)
    #
    # Case 2 — WE above cap (min_steps floor active):
    #   observed ≈ ceil(base / (1 + max_efficiency))
    #   → base ≈ observed * (1 + max_efficiency)
    #   But ALSO: any base_steps whose min_steps == observed AND whose
    #   steps_with_efficiency < min_steps will produce the same observed.
    #   That means base_steps can range from:
    #     lo: (observed - 1) * (1 + max_efficiency) + 1  (just above prev ceil bucket)
    #     hi: observed * (1 + max_efficiency)             (top of this ceil bucket)
    #   We need to search this entire range.

    center = observed_steps * total_efficiency
    search_lo = max(1, math.floor(center - 2))
    search_hi = math.ceil(center + 2) + 1

    # Expand range for the max_efficiency cap case
    if max_efficiency > 0:
        cap_factor = 1.0 + max_efficiency
        # Upper bound: base_steps whose min_steps ceil bucket includes observed
        cap_hi = math.ceil(observed_steps * cap_factor) + 2
        # Lower bound: base_steps at the bottom of this ceil bucket
        cap_lo = max(1, math.floor((observed_steps - 1) * cap_factor))
        search_lo = min(search_lo, cap_lo)
        search_hi = max(search_hi, cap_hi)

    # Game floor case: when observed_steps == 10, any base_steps whose
    # formula result is ≤ 10 will produce 10.  Search from 1.
    if observed_steps <= 10:
        search_lo = 1

    candidates: List[int] = []
    for b in range(search_lo, search_hi):
        if forward_calculate(
            base_steps=b,
            skill_level=skill_level,
            required_level=required_level,
            max_efficiency=max_efficiency,
            collectible_we=collectible_we,
            service_we=service_we,
            gear_we=0.0,
            flat=0,
            pct=0.0,
        ) == observed_steps:
            candidates.append(b)

    ambiguous = len(candidates) != 1
    base_steps = candidates[0] if len(candidates) == 1 else None

    return {
        'base_steps': base_steps,
        'ambiguous': ambiguous,
        'candidates': candidates,
        'needs_calibration': ambiguous,
        'level_we': level_we,
        'collectible_we': collectible_we,
        'service_we': service_we,
        'total_we_used': total_we,
    }


# ============================================================================
# CALIBRATION
# ============================================================================

def reverse_calculate_with_calibration(
    observed_steps_no_gear: int,
    observed_steps_calibration: int,
    calibration_stats: Dict[str, float],
    skill_level: int,
    required_level: int,
    max_efficiency: float,
    collectible_we: float = 0.0,
    service_we: float = 0.0,
) -> Dict:
    """Use two observations to solve for exact base steps.

    The first observation is with no gear; the second is with a known
    calibration gearset.  We find candidates from the no-gear observation,
    then filter to those that also produce the calibration observation.

    Args:
        observed_steps_no_gear: Steps in-game with no gear.
        observed_steps_calibration: Steps in-game with calibration gearset.
        calibration_stats: Known stats of calibration gearset.
            Keys: 'work_efficiency', 'steps_add', 'steps_percent'.
        skill_level: Character's current skill level.
        required_level: Activity/recipe required level.
        max_efficiency: WE cap as a decimal.
        collectible_we: Collectible WE bonus as a decimal.
        service_we: Service WE bonus as a decimal.

    Returns:
        Dict with keys:
            base_steps (int | None): Exact result or None.
            confidence ('exact' | 'high' | 'low'): Confidence level.
            details (str): Human-readable explanation.
    """
    cal_we = calibration_stats.get('work_efficiency', 0.0)
    cal_flat = int(calibration_stats.get('steps_add', 0))
    cal_pct = calibration_stats.get('steps_percent', 0.0)

    # Get candidates from no-gear observation
    no_gear_result = reverse_calculate_base_steps(
        observed_steps=observed_steps_no_gear,
        skill_level=skill_level,
        required_level=required_level,
        max_efficiency=max_efficiency,
        collectible_we=collectible_we,
        service_we=service_we,
    )

    candidates = no_gear_result['candidates']

    # Also search around the calibration observation in case the no-gear
    # search missed some (different WE shifts the center)
    levels_above = max(0, skill_level - required_level)
    level_we = min(levels_above, 20) * 0.0125
    total_we_cal = level_we + collectible_we + service_we + cal_we
    total_eff_cal = 1.0 + total_we_cal

    cal_center = observed_steps_calibration * total_eff_cal
    cal_lo = max(1, math.floor(cal_center - 2))
    cal_hi = math.ceil(cal_center + 2) + 1
    if max_efficiency > 0:
        cap_factor = 1.0 + max_efficiency
        cal_hi = max(cal_hi, math.ceil(observed_steps_calibration * cap_factor) + 2)
        cal_lo = min(cal_lo, max(1, math.floor((observed_steps_calibration - 1) * cap_factor)))

    extra_candidates = set()
    for b in range(cal_lo, cal_hi):
        if forward_calculate(b, skill_level, required_level, max_efficiency,
                             collectible_we, service_we, 0.0, 0, 0.0) == observed_steps_no_gear:
            extra_candidates.add(b)

    all_candidates = sorted(set(candidates) | extra_candidates)

    # Filter: must also produce the calibration observation
    matches = []
    for b in all_candidates:
        if forward_calculate(
            base_steps=b,
            skill_level=skill_level,
            required_level=required_level,
            max_efficiency=max_efficiency,
            collectible_we=collectible_we,
            service_we=service_we,
            gear_we=cal_we,
            flat=cal_flat,
            pct=cal_pct,
        ) == observed_steps_calibration:
            matches.append(b)

    if len(matches) == 1:
        return {
            'base_steps': matches[0],
            'confidence': 'exact',
            'details': f'Calibration resolved to exactly {matches[0]} base steps.',
        }
    elif len(matches) > 1:
        return {
            'base_steps': matches[0],
            'confidence': 'high',
            'details': (f'Calibration narrowed to {len(matches)} candidates: '
                        f'{matches}. Using lowest.'),
        }
    else:
        return {
            'base_steps': None,
            'confidence': 'low',
            'details': ('No candidate satisfies both observations. '
                        'Check inputs or try different calibration gear.'),
        }


def build_calibration_gearset(
    character_items: Dict,
    skill: str,
    location: str,
) -> Dict:
    """Select items from owned inventory with known small WE values.

    Only considers work_efficiency, steps_add, and steps_percent stats
    (not DA, DR, or other stats).  Picks items that produce a measurably
    different step count for calibration.

    Args:
        character_items: Dict mapping item_id → item object.  Each item
            must support ``get_stats_for_skill(skill, location=location)``
            returning a stat dict.
        skill: Skill name for stat lookup.
        location: Location name for stat lookup.

    Returns:
        Dict with keys:
            items (list[dict]): Items to equip, each with 'name', 'slot',
                'work_efficiency', 'steps_add', 'steps_percent'.
            total_we (float): Sum of WE from selected items.
            total_flat (int): Sum of flat steps from selected items.
            total_pct (float): Sum of pct steps from selected items.
            export_string (str): Placeholder (empty for now).
            error (str | None): Error message if no suitable items found.
    """
    RELEVANT_STATS = {'work_efficiency', 'steps_add', 'steps_percent'}

    if not character_items:
        return {
            'items': [],
            'total_we': 0.0,
            'total_flat': 0,
            'total_pct': 0.0,
            'export_string': '',
            'error': 'No items in inventory.',
        }

    # Score each item: prefer items with ONLY relevant stats and small WE
    scored_items = []
    for item_id, item in character_items.items():
        try:
            stats = item.get_stats_for_skill(skill, location=location)
        except Exception:
            continue

        if not stats:
            continue

        we = stats.get('work_efficiency', 0.0)
        flat = stats.get('steps_add', 0.0)
        pct = stats.get('steps_percent', 0.0)

        # Skip items with no relevant stats
        if we == 0.0 and flat == 0.0 and pct == 0.0:
            continue

        # Check for non-relevant stats (DA, DR, etc.) — prefer items without
        has_irrelevant = any(
            v != 0.0 for k, v in stats.items() if k not in RELEVANT_STATS
        )

        scored_items.append({
            'item': item,
            'item_id': item_id,
            'name': getattr(item, 'name', str(item_id)),
            'slot': getattr(item, 'slot', 'unknown'),
            'work_efficiency': we,
            'steps_add': flat,
            'steps_percent': pct,
            'has_irrelevant': has_irrelevant,
            'abs_we': abs(we),
        })

    if not scored_items:
        return {
            'items': [],
            'total_we': 0.0,
            'total_flat': 0,
            'total_pct': 0.0,
            'export_string': '',
            'error': 'No items with WE/flat/pct stats found.',
        }

    # Sort: prefer items without irrelevant stats, then by small positive WE
    scored_items.sort(key=lambda x: (x['has_irrelevant'], -x['abs_we']))

    # Pick the best single item (simplest calibration)
    best = scored_items[0]

    return {
        'items': [{
            'name': best['name'],
            'slot': best['slot'],
            'work_efficiency': best['work_efficiency'],
            'steps_add': best['steps_add'],
            'steps_percent': best['steps_percent'],
        }],
        'total_we': best['work_efficiency'],
        'total_flat': int(best['steps_add']),
        'total_pct': best['steps_percent'],
        'export_string': '',
        'error': None,
    }


def build_xp_calibration_gearset(
    character_items: Dict,
    skill: str,
    location: str,
    candidates: Optional[List[int]] = None,
) -> Dict:
    """Select items from owned inventory with bonus XP stats for calibration.

    Finds items with bonus_xp_percent or bonus_xp_add that produce different
    displayed XP values for the given candidates, enabling disambiguation.

    Args:
        character_items: Dict mapping item_id -> item object.
        skill: Skill name for stat lookup.
        location: Location name for stat lookup.
        candidates: Optional list of candidate base_xp values to check
            disambiguation against.

    Returns:
        Dict with keys:
            items (list[dict]): Items to equip, each with name, slot,
                bonus_xp_percent, bonus_xp_add.
            total_bonus_xp_pct (float): Sum of bonus XP percent.
            total_bonus_xp_add (float): Sum of flat bonus XP.
            error (str | None): Error message if no suitable items found.
    """
    if not character_items:
        return {
            'items': [],
            'total_bonus_xp_pct': 0.0,
            'total_bonus_xp_add': 0.0,
            'error': 'No items in inventory.',
        }

    RELEVANT_STATS = {'bonus_xp_percent', 'bonus_xp_add'}

    scored_items = []
    for item_id, item in character_items.items():
        try:
            stats = item.get_stats_for_skill(skill, location=location)
        except Exception:
            continue

        if not stats:
            continue

        xp_pct = stats.get('bonus_xp_percent', 0.0)
        xp_add = stats.get('bonus_xp_add', 0.0)

        if xp_pct == 0.0 and xp_add == 0.0:
            continue

        scored_items.append({
            'name': getattr(item, 'name', str(item_id)),
            'slot': getattr(item, 'slot', 'unknown'),
            'bonus_xp_percent': xp_pct,
            'bonus_xp_add': xp_add,
            'abs_xp_pct': abs(xp_pct),
        })

    if not scored_items:
        return {
            'items': [],
            'total_bonus_xp_pct': 0.0,
            'total_bonus_xp_add': 0.0,
            'error': 'No items with Bonus XP stats found for this skill.',
        }

    # Sort by largest absolute XP percent (best chance to disambiguate)
    scored_items.sort(key=lambda x: -x['abs_xp_pct'])
    best = scored_items[0]

    return {
        'items': [{
            'name': best['name'],
            'slot': best['slot'],
            'bonus_xp_percent': best['bonus_xp_percent'],
            'bonus_xp_add': best['bonus_xp_add'],
        }],
        'total_bonus_xp_pct': best['bonus_xp_percent'],
        'total_bonus_xp_add': best['bonus_xp_add'],
        'error': None,
    }
