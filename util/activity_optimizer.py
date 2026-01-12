#!/usr/bin/env python3
"""
Complete activity optimization logic extracted from optimize_activity_gearsets.py.
This is the EXACT same code, just made into reusable functions.
"""

from typing import Dict, Tuple
from util.gearset_utils import Gearset, aggregate_gearset_stats

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def calculate_gearset_metrics(
    gearset_dict: dict,
    activity,
    character,
    target_item=None,
    verbose=False
) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Calculate metrics for a complete gearset.
    Returns (metrics_dict, stats_dict)
    """
    # Get all items from gearset
    items = [item for item in gearset_dict.values() if item is not None]
    
    # Aggregate all stats
    skill = activity.primary_skill.lower()
    location = activity.locations[0] if activity.locations else None
    
    total_stats = aggregate_gearset_stats(
        items=items,
        skill=skill,
        location=location,
        character=character,
        include_level_bonus=True,
        include_collectibles=True
    )
    
    # Use activity's get_expected_drop_rate with verbose=True to get all metrics
    # This includes secondary_xp_per_step, total_xp_per_step, and all drop rates
    drop_rates, details = activity.get_expected_drop_rate(
        stats=total_stats,
        location=location,
        character=character,
        target_item=None,  # Get all drops
        verbose=True
    )
    
    # Extract metrics from details
    metrics = {
        'expected_steps_per_action': details['expected_steps_per_action'],
        'steps_per_reward_roll': details['steps_per_reward_roll'],
        'primary_xp_per_step': details['primary_xp_per_step'],
        'reward_rolls_per_step': 1.0 / details['steps_per_reward_roll'] if details['steps_per_reward_roll'] > 0 else 0,
        'secondary_xp_per_step': details.get('secondary_xp_per_step', {}),
        'total_xp_per_step': details.get('total_xp_per_step', 0.0),
    }
    
    # If targeting a specific item, override steps_per_reward_roll
    if target_item is not None and is_gearset_complete(gearset_dict, character):
        target_name = target_item if isinstance(target_item, str) else target_item.name
        
        if target_name in drop_rates:
            metrics['steps_per_reward_roll'] = drop_rates[target_name]
            metrics['reward_rolls_per_step'] = 1.0 / drop_rates[target_name] if drop_rates[target_name] > 0 else 0
        else:
            metrics['steps_per_reward_roll'] = 999999.0
            metrics['reward_rolls_per_step'] = 0.0
    
    return metrics, total_stats

def is_gearset_complete(gearset_dict: dict, character) -> bool:
    """Check if gearset has all slots filled."""
    gear_slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                  'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2']
    tool_slots = character.get_tool_slots()
    
    for slot in gear_slots:
        if slot not in gearset_dict or gearset_dict[slot] is None:
            return False
    
    for i in range(tool_slots):
        if f'tool{i}' not in gearset_dict or gearset_dict[f'tool{i}'] is None:
            return False
    
    return True

def is_gearset_valid(gearset_dict: dict, character, activity=None, check_requirements=True) -> bool:
    """Check if gearset respects all constraints."""
    used_uuids = {}
    used_keywords = set()
    excluded_keywords = ['regional', 'tool', 'light source', 'achievement reward', 'faction reward', 'activity tool']
    
    for slot, item in gearset_dict.items():
        if item is None:
            continue
        
        # Check UUID constraint
        if hasattr(item, 'uuid'):
            uuid = item.uuid
            used_uuids[uuid] = used_uuids.get(uuid, 0) + 1
            
            if slot.startswith('ring'):
                total_owned = sum(qty for inv_item, qty in character.items.items() 
                                 if hasattr(inv_item, 'uuid') and inv_item.uuid == uuid)
                if used_uuids[uuid] > total_owned:
                    return False
            else:
                if used_uuids[uuid] > 1:
                    return False
        
        # Check keyword uniqueness for tools
        if slot.startswith('tool') and hasattr(item, 'keywords'):
            item_keywords = {kw.lower() for kw in item.keywords if kw.lower() not in excluded_keywords}
            if item_keywords & used_keywords:
                return False
            used_keywords.update(item_keywords)
    
    # Check activity requirements on complete gearsets
    if activity and check_requirements and is_gearset_complete(gearset_dict, character):
        gearset_obj = Gearset.from_dict(gearset_dict)
        if not activity.is_unlocked(gearset=gearset_obj, character=character):
            return False
    
    return True

# ============================================================================
# OPTIMIZATION
# ============================================================================

def optimize_activity_complete(
    activity,
    character,
    primary_sorting,
    secondary_sorting,
    tertiary_sorting,
    target_item=None,
    max_iterations=100,
    verbose=False
):
    """
    Complete activity optimization using greedy + local search.
    This is the EXACT same algorithm as optimize_activity_gearsets.py.
    
    Args:
        activity: Activity object
        character: Character object
        primary_sorting: Sorting enum (e.g., Sorting.XP_PER_STEP)
        secondary_sorting: Sorting enum for tie-breaking
        tertiary_sorting: Sorting enum for second tie-breaking
        target_item: Optional item to optimize drop rate for
        max_iterations: Max local search iterations
        verbose: Print debug output
    
    Returns:
        Tuple of (gearset_dict, metrics_dict, stats_dict, iterations)
    """
    # Metric mapping
    METRIC_MAPPING = {
        'reward_rolls_per_step': 'reward_rolls_per_step',
        'steps_per_reward_roll': 'steps_per_reward_roll',
        'xp_per_step': 'primary_xp_per_step',
        'expected_steps_per_action': 'expected_steps_per_action',
    }
    
    # Get all items
    all_items = []
    for item, qty in character.items.items():
        if qty > 0 and hasattr(item, 'get_stats_for_skill'):
            if hasattr(item, 'is_unlocked'):
                if not item.is_unlocked(character, ignore_gear_requirements=True):
                    continue
            all_items.append(item)
    
    # GREEDY INITIALIZATION
    gearset = {}
    gear_slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                  'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2']
    
    metric_key = METRIC_MAPPING.get(primary_sorting.stat_key, primary_sorting.stat_key)
    
    # Greedy fill gear slots
    for slot in gear_slots:
        item_slot = 'ring' if slot in ['ring1', 'ring2'] else slot
        
        best_item = None
        best_metric = float('inf') if not primary_sorting.is_reverse else float('-inf')
        
        for item in all_items:
            if not hasattr(item, 'slot') or item.slot != item_slot:
                continue
            
            test_gearset = gearset.copy()
            test_gearset[slot] = item
            
            if not is_gearset_valid(test_gearset, character, activity=None, check_requirements=False):
                continue
            
            metrics, _ = calculate_gearset_metrics(test_gearset, activity, character, target_item, verbose)
            metric_value = metrics[metric_key]
            
            if primary_sorting.is_reverse:
                if metric_value > best_metric:
                    best_metric = metric_value
                    best_item = item
            else:
                if metric_value < best_metric:
                    best_metric = metric_value
                    best_item = item
        
        gearset[slot] = best_item
    
    # Greedy fill tool slots
    tool_slots = character.get_tool_slots()
    
    for i in range(tool_slots):
        slot = f'tool{i}'
        best_tool = None
        best_metric = float('inf') if not primary_sorting.is_reverse else float('-inf')
        
        for item in all_items:
            if not hasattr(item, 'slot') or item.slot != 'tools':
                continue
            
            test_gearset = gearset.copy()
            test_gearset[slot] = item
            
            if not is_gearset_valid(test_gearset, character, activity=None, check_requirements=False):
                continue
            
            metrics, _ = calculate_gearset_metrics(test_gearset, activity, character, target_item, verbose)
            metric_value = metrics[metric_key]
            
            if primary_sorting.is_reverse:
                if metric_value > best_metric:
                    best_metric = metric_value
                    best_tool = item
            else:
                if metric_value < best_metric:
                    best_metric = metric_value
                    best_tool = item
        
        gearset[slot] = best_tool
    
    # POST-GREEDY FIX: If gearset doesn't meet activity requirements, try to fix it
    # by randomly swapping items until we find a valid configuration
    if is_gearset_complete(gearset, character):
        gearset_obj = Gearset.from_dict(gearset)
        if not activity.is_unlocked(gearset=gearset_obj, character=character):
            # Try to fix by swapping each slot with items that might help
            for slot in list(gearset.keys()):
                if slot.startswith('ring'):
                    item_slot = 'ring'
                elif slot.startswith('tool'):
                    item_slot = 'tools'
                else:
                    item_slot = slot
                
                # Try swapping this slot
                for item in all_items:
                    if not hasattr(item, 'slot') or item.slot != item_slot:
                        continue
                    
                    test_gearset = gearset.copy()
                    test_gearset[slot] = item
                    
                    if not is_gearset_valid(test_gearset, character, activity=None, check_requirements=False):
                        continue
                    
                    # Check if this makes the gearset valid
                    test_gearset_obj = Gearset.from_dict(test_gearset)
                    if activity.is_unlocked(gearset=test_gearset_obj, character=character):
                        gearset[slot] = item
                        break
                
                # Check if we're valid now
                gearset_obj = Gearset.from_dict(gearset)
                if activity.is_unlocked(gearset=gearset_obj, character=character):
                    break
    
    # LOCAL SEARCH REFINEMENT
    current_gearset = gearset.copy()
    current_metrics, current_stats = calculate_gearset_metrics(current_gearset, activity, character, target_item, verbose)
    current_value = current_metrics[metric_key]
    
    for iteration in range(max_iterations):
        improved = False
        best_swap = None
        best_value = current_value
        best_gearset = None
        best_gearset_metrics = None
        best_gearset_stats = current_stats
        
        current_metrics, current_stats = calculate_gearset_metrics(current_gearset, activity, character, target_item, verbose)
        
        # Try swapping each slot
        for slot in current_gearset.keys():
            current_item = current_gearset[slot]
            
            if slot.startswith('ring'):
                item_slot = 'ring'
            elif slot.startswith('tool'):
                item_slot = 'tools'
            else:
                item_slot = slot
            
            for new_item in all_items:
                if not hasattr(new_item, 'slot') or new_item.slot != item_slot:
                    continue
                if new_item == current_item:
                    continue
                
                test_gearset = current_gearset.copy()
                test_gearset[slot] = new_item
                
                # Debug specific swaps
                if current_item and 'jellyfishing' in current_item.name.lower() and 'wintry' in new_item.name.lower():
                    print(f"\n  DEBUG: Testing swap {current_item.name} → {new_item.name}")
                    print(f"    Checking validation...")
                    test_obj = Gearset.from_dict(test_gearset)
                    unlocked = activity.is_unlocked(gearset=test_obj, character=character)
                    print(f"    activity.is_unlocked: {unlocked}")
                    
                    # Check what keywords we have
                    all_keywords = []
                    for s, itm in test_gearset.items():
                        if itm and hasattr(itm, 'keywords'):
                            all_keywords.extend(itm.keywords)
                    print(f"    All keywords in gearset: {set(all_keywords)}")
                    print(f"    Required keywords: {activity.requirements.get('keywords', [])}")
                
                if not is_gearset_valid(test_gearset, character, activity, check_requirements=True):
                    if current_item and 'jellyfishing' in current_item.name.lower() and 'wintry' in new_item.name.lower():
                        print(f"    REJECTED by is_gearset_valid")
                    continue
                
                if current_item and 'jellyfishing' in current_item.name.lower() and 'wintry' in new_item.name.lower():
                    print(f"    PASSED validation!")
                
                # Calculate metrics
                test_metrics, test_stats = calculate_gearset_metrics(test_gearset, activity, character, target_item, verbose)
                test_value = test_metrics[metric_key]
                
                if current_item and 'jellyfishing' in current_item.name.lower() and 'wintry' in new_item.name.lower():
                    print(f"    Current metric ({metric_key}): {current_value:.4f}")
                    print(f"    Test metric ({metric_key}): {test_value:.4f}")
                    print(f"    Best so far: {best_value:.4f}")
                    print(f"    Is reverse (higher better): {primary_sorting.is_reverse}")
                    if primary_sorting.is_reverse:
                        print(f"    Would improve: {test_value > best_value}")
                    else:
                        print(f"    Would improve: {test_value < best_value}")
                    print(f"    PASSED validation!")
                
                test_metrics, test_stats = calculate_gearset_metrics(test_gearset, activity, character, target_item, verbose)
                test_value = test_metrics[metric_key]
                
                # Multi-level comparison
                is_better = False
                
                if primary_sorting.is_reverse:
                    if test_value > best_value:
                        is_better = True
                    elif test_value == best_value:
                        sec_key = METRIC_MAPPING.get(secondary_sorting.stat_key, secondary_sorting.stat_key)
                        test_sec = test_metrics[sec_key]
                        best_sec = best_gearset_metrics[sec_key] if best_gearset else current_metrics[sec_key]
                        
                        if secondary_sorting.is_reverse:
                            if test_sec > best_sec:
                                is_better = True
                            elif test_sec == best_sec:
                                ter_key = METRIC_MAPPING.get(tertiary_sorting.stat_key, tertiary_sorting.stat_key)
                                test_ter = test_metrics[ter_key]
                                best_ter = best_gearset_metrics[ter_key] if best_gearset else current_metrics[ter_key]
                                is_better = test_ter > best_ter if tertiary_sorting.is_reverse else test_ter < best_ter
                        else:
                            if test_sec < best_sec:
                                is_better = True
                            elif test_sec == best_sec:
                                ter_key = METRIC_MAPPING.get(tertiary_sorting.stat_key, tertiary_sorting.stat_key)
                                test_ter = test_metrics[ter_key]
                                best_ter = best_gearset_metrics[ter_key] if best_gearset else current_metrics[ter_key]
                                is_better = test_ter > best_ter if tertiary_sorting.is_reverse else test_ter < best_ter
                else:
                    if test_value < best_value:
                        is_better = True
                    elif test_value == best_value:
                        sec_key = METRIC_MAPPING.get(secondary_sorting.stat_key, secondary_sorting.stat_key)
                        test_sec = test_metrics[sec_key]
                        best_sec = best_gearset_metrics[sec_key] if best_gearset else current_metrics[sec_key]
                        
                        if secondary_sorting.is_reverse:
                            if test_sec > best_sec:
                                is_better = True
                            elif test_sec == best_sec:
                                ter_key = METRIC_MAPPING.get(tertiary_sorting.stat_key, tertiary_sorting.stat_key)
                                test_ter = test_metrics[ter_key]
                                best_ter = best_gearset_metrics[ter_key] if best_gearset else current_metrics[ter_key]
                                is_better = test_ter > best_ter if tertiary_sorting.is_reverse else test_ter < best_ter
                        else:
                            if test_sec < best_sec:
                                is_better = True
                            elif test_sec == best_sec:
                                ter_key = METRIC_MAPPING.get(tertiary_sorting.stat_key, tertiary_sorting.stat_key)
                                test_ter = test_metrics[ter_key]
                                best_ter = best_gearset_metrics[ter_key] if best_gearset else current_metrics[ter_key]
                                is_better = test_ter > best_ter if tertiary_sorting.is_reverse else test_ter < best_ter
                
                if is_better:
                    best_value = test_value
                    best_swap = (slot, current_item, new_item)
                    best_gearset = test_gearset.copy()
                    best_gearset_metrics = test_metrics
                    best_gearset_stats = test_stats
                    improved = True
        
        if improved:
            current_gearset = best_gearset
            current_value = best_value
            # Continue to next iteration (don't break - we want to keep searching until no improvements)
        else:
            # No improvements found - converged!
            break
    
    final_metrics, final_stats = calculate_gearset_metrics(current_gearset, activity, character, target_item, verbose)
    
    return current_gearset, final_metrics, final_stats, iteration + 1
