#!/usr/bin/env python3
"""
Shared activity and crafting metrics calculations.

Provides pure mathematical formulas for calculating activity efficiency metrics
that are used across multiple tools (optimizers, analyzers, etc.).

Functions:
- calculate_activity_metrics() - Calculate steps/action, steps/reward, XP/step
- calculate_crafting_metrics() - Calculate crafting efficiency metrics  
- aggregate_gearset_stats() - Sum stats from items, level bonus, collectibles
"""

# Standard library imports
import math
from typing import Dict, Optional

# ============================================================================
# ACTIVITY METRICS
# ============================================================================

def calculate_activity_metrics(
    base_steps: int,
    base_xp: int,
    max_efficiency: float,
    total_stats: Optional[Dict[str, float]] = None,
    # Legacy individual parameters (deprecated, use total_stats instead)
    work_efficiency: Optional[float] = None,
    double_action: Optional[float] = None,
    double_rewards: Optional[float] = None,
    steps_add: Optional[int] = None,
    steps_percent: Optional[float] = None,
    bonus_xp_percent: float = 0.0,
    bonus_xp_add: float = 0.0
) -> Dict[str, float]:
    """
    Calculate all activity efficiency metrics from base stats and gear bonuses.
    
    Pure mathematical calculation with no side effects.
    All percentage values should be in decimal format (0.15 = 15%).
    
    Can be called two ways:
    1. New way: calculate_activity_metrics(base_steps, base_xp, max_eff, total_stats=stats_dict)
    2. Legacy way: calculate_activity_metrics(base_steps, base_xp, max_eff, work_efficiency=0.5, ...)
    
    Args:
        base_steps: Base steps from activity
        base_xp: Base XP from activity
        max_efficiency: Maximum work efficiency cap (e.g., 0.60 = 60%)
        total_stats: Dictionary of all stats (new way, preferred)
        work_efficiency: Total WE as decimal (legacy, deprecated)
        double_action: Total DA as decimal (legacy, deprecated)
        double_rewards: Total DR as decimal (legacy, deprecated)
        steps_add: Flat steps modifier (legacy, deprecated)
        steps_percent: Percentage steps modifier (legacy, deprecated)
        bonus_xp_percent: Bonus XP percentage as decimal (0.10 = 10%)
        bonus_xp_add: Flat bonus XP (e.g., 5)
        
    Returns:
        Dictionary with calculated metrics:
        - expected_steps_per_action: Expected steps per action (with DA)
        - steps_per_reward_roll: Steps per reward roll
        - primary_xp_per_step: XP gained per step
        - reward_rolls_per_step: Reward rolls per step (inverse of steps_per_reward_roll)
    """
    # If total_stats provided, extract values from it
    if total_stats is not None:
        work_efficiency = total_stats.get('work_efficiency', 0.0)
        double_action = total_stats.get('double_action', 0.0)
        double_rewards = total_stats.get('double_rewards', 0.0)
        steps_add = int(total_stats.get('steps_add', 0))
        steps_percent = total_stats.get('steps_percent', 0.0)
        bonus_xp_percent = total_stats.get('bonus_xp_percent', 0.0)
        bonus_xp_add = total_stats.get('bonus_xp_add', 0.0)
    else:
        # Use legacy parameters (with defaults for backward compatibility)
        if work_efficiency is None:
            work_efficiency = 0.0
        if double_action is None:
            double_action = 0.0
        if double_rewards is None:
            double_rewards = 0.0
        if steps_add is None:
            steps_add = 0
        if steps_percent is None:
            steps_percent = 0.0
    
    # Apply work efficiency (capped at max)
    capped_we = min(work_efficiency, max_efficiency)
    total_efficiency = 1.0 + capped_we
    steps_with_efficiency = math.ceil(base_steps / total_efficiency)
    
    # Enforce minimum steps (at max efficiency)
    min_steps = math.ceil(base_steps / (1 + max_efficiency))
    steps_after_min = max(steps_with_efficiency, min_steps)
    
    # Apply percentage and flat modifiers
    steps_with_pct = steps_after_min * (1 + steps_percent)
    steps_with_flat = steps_with_pct + steps_add
    steps_per_single_action = max(steps_with_flat, 10)  # Minimum 10 steps
    
    # Calculate expected steps with double action
    expected_paid_actions = 1.0 / (1 + double_action)
    expected_steps_per_action = math.ceil(expected_paid_actions * steps_per_single_action)
    
    # Calculate reward efficiency
    rewards_per_completion = (1 + double_rewards) * (1 + double_action)
    steps_per_reward_roll = steps_per_single_action / rewards_per_completion
    
    # Calculate XP efficiency
    total_xp = base_xp * (1 + bonus_xp_percent) + bonus_xp_add
    primary_xp_per_step = total_xp / expected_steps_per_action if expected_steps_per_action > 0 else 0
    
    return {
        'expected_steps_per_action': expected_steps_per_action,
        'steps_per_reward_roll': steps_per_reward_roll,
        'primary_xp_per_step': primary_xp_per_step,
        'reward_rolls_per_step': 1.0 / steps_per_reward_roll if steps_per_reward_roll > 0 else 0,
    }

# ============================================================================
# CRAFTING METRICS
# ============================================================================

def calculate_crafting_metrics(
    base_steps: int,
    base_xp: float,
    max_efficiency: float,
    total_stats: Optional[Dict[str, float]] = None,
    # Legacy individual parameters (deprecated, use total_stats instead)
    work_efficiency: Optional[float] = None,
    double_action: Optional[float] = None,
    double_rewards: Optional[float] = None,
    no_materials_consumed: Optional[float] = None,
    quality_outcome: Optional[float] = None,
    steps_add: Optional[int] = None,
    steps_percent: Optional[float] = None,
    bonus_xp_percent: float = 0.0,
    bonus_xp_add: float = 0.0
) -> Dict[str, float]:
    """
    Calculate all crafting efficiency metrics from base stats and gear bonuses.
    
    Can be called two ways:
    1. New way: calculate_crafting_metrics(base_steps, base_xp, max_eff, total_stats=stats_dict)
    2. Legacy way: calculate_crafting_metrics(base_steps, base_xp, max_eff, work_efficiency=0.5, ...)
    
    Pure mathematical calculation with no side effects.
    All percentage values should be in decimal format (0.15 = 15%).
    
    Args:
        base_steps: Base steps from recipe
        base_xp: Base XP from recipe
        max_efficiency: Maximum work efficiency cap (e.g., 0.60 = 60%)
        work_efficiency: Total WE as decimal (0.15 = 15%)
        double_action: Total DA as decimal (0.10 = 10%)
        double_rewards: Total DR as decimal (0.05 = 5%)
        no_materials_consumed: Total NMC as decimal (0.03 = 3%)
        quality_outcome: Total QO as integer (e.g., 5)
        steps_add: Flat steps modifier (e.g., -2)
        steps_percent: Percentage steps modifier as decimal (e.g., -0.01 = -1%)
        bonus_xp_percent: Bonus XP percentage as decimal (0.10 = 10%)
        bonus_xp_add: Flat bonus XP (e.g., 5)
        
    Returns:
        Dictionary with calculated metrics:
        - current_steps: Steps per craft action
        - expected_steps_per_action: Expected steps per action (with DA)
        - materials_per_craft: Materials consumed per craft (accounting for DR and NMC)
        - crafts_per_material: Crafts per material unit
        - primary_xp_per_step: XP gained per step
        - quality_outcome: Total quality outcome bonus
    """
    # If total_stats provided, extract values from it
    if total_stats is not None:
        work_efficiency = total_stats.get('work_efficiency', 0.0)
        double_action = total_stats.get('double_action', 0.0)
        double_rewards = total_stats.get('double_rewards', 0.0)
        no_materials_consumed = total_stats.get('no_materials_consumed', 0.0)
        quality_outcome = total_stats.get('quality_outcome', 0.0)
        steps_add = int(total_stats.get('steps_add', 0))
        steps_percent = total_stats.get('steps_percent', 0.0)
        bonus_xp_percent = total_stats.get('bonus_xp_percent', 0.0)
        bonus_xp_add = total_stats.get('bonus_xp_add', 0.0)
    
    # Apply work efficiency (capped at max)
    capped_we = min(work_efficiency, max_efficiency)
    total_efficiency = 1.0 + capped_we
    steps_with_efficiency = math.ceil(base_steps / total_efficiency)
    
    # Apply percentage and flat modifiers
    steps_with_pct = steps_with_efficiency * (1 + steps_percent)
    steps_with_flat = steps_with_pct + steps_add
    current_steps = max(math.ceil(steps_with_flat), 1)  # Minimum 1 step
    
    # Calculate expected steps with double action
    expected_paid_actions = 1.0 / (1 + double_action)
    expected_steps_per_action = math.ceil(expected_paid_actions * current_steps)
    
    # Calculate material efficiency
    # DR gives extra crafts, NMC reduces material consumption
    crafts_per_material = (1 + double_rewards) / (1 - no_materials_consumed)
    materials_per_craft = 1.0 / crafts_per_material if crafts_per_material > 0 else 1.0
    
    # Calculate expected steps per item (only DR affects items, not DA)
    # DA gives bonus actions, but each action crafts same number of items
    # DR gives bonus items per action
    expected_steps_per_item = expected_steps_per_action / (1 + double_rewards) if double_rewards > 0 else expected_steps_per_action
    
    # Calculate XP efficiency
    total_xp = base_xp * (1 + bonus_xp_percent) + bonus_xp_add
    primary_xp_per_step = total_xp / expected_steps_per_action if expected_steps_per_action > 0 else 0
    
    # Calculate chest finding efficiency
    # Chest finding works like other finding bonuses - increases drop rate
    chest_finding = total_stats.get('chest_finding', 0.0) if total_stats else 0.0
    # Base chest drop rate is typically 1% (0.01), modified by chest_finding
    base_chest_rate = 0.01
    chest_rate_with_bonus = base_chest_rate * (1 + chest_finding)
    # Steps per chest = steps per action / (chest rate * (1 + DR))
    # DR affects all drops including chests
    steps_per_chest = expected_steps_per_action / (chest_rate_with_bonus * (1 + double_rewards)) if chest_rate_with_bonus > 0 else 999999
    
    return {
        'current_steps': current_steps,
        'expected_steps_per_action': expected_steps_per_action,
        'expected_steps_per_item': expected_steps_per_item,
        'materials_per_craft': materials_per_craft,
        'crafts_per_material': crafts_per_material,
        'primary_xp_per_step': primary_xp_per_step,
        'quality_outcome': quality_outcome,
        'steps_for_chest': steps_per_chest,
    }

# ============================================================================
# STAT AGGREGATION
# ============================================================================

# ============================================================================
# GEARSET STAT AGGREGATION (MOVED TO gearset_utils.py)
# ============================================================================

# For backward compatibility, import from gearset_utils
from util.gearset_utils import aggregate_gearset_stats

# Note: aggregate_gearset_stats has been moved to util/gearset_utils.py
# This import is kept for backward compatibility with existing code
