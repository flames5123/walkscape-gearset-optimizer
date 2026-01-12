#!/usr/bin/env python3
"""
Greedy + Local Search optimization algorithm for gearset optimization.

This module provides a reusable optimization algorithm that:
1. Uses greedy initialization to find a good starting point (fast)
2. Refines using local search (swap each slot with all items)
3. Repeats until no improvements found (converges to local optimum)

This approach combines speed (greedy) with quality (local search refinement).
"""

# Standard library imports
from typing import Callable, Dict, List, Optional, Tuple

# ============================================================================
# CORE ALGORITHM
# ============================================================================

def optimize_gearset_greedy_local_search(
    all_items: Dict[str, List],
    character,
    score_function: Callable[[dict], Tuple[float, ...]],
    is_better: Callable[[Tuple[float, ...], Tuple[float, ...]], bool],
    validate_function: Optional[Callable[[dict], bool]] = None,
    max_iterations: int = 100,
    verbose: bool = False
) -> Tuple[dict, Tuple[float, ...], int]:
    """
    Optimize gearset using greedy initialization + local search refinement.
    
    This is a general-purpose optimization algorithm that works for any
    gearset optimization problem (activity, crafting, travel, etc.).
    
    Args:
        all_items: Dictionary mapping slot names to lists of items
                  e.g., {'head': [item1, item2], 'tool0': [tool1, tool2]}
        character: Character object with inventory and stats
        score_function: Function that takes gearset_dict and returns tuple of scores
                       e.g., (primary_score, secondary_score, tertiary_score)
        is_better: Function that compares two score tuples and returns True if first is better
                  e.g., lambda new, old: new[0] < old[0]  # Minimize primary score
        validate_function: Optional function to validate gearset (e.g., check requirements)
                          Returns True if valid, False otherwise
        max_iterations: Maximum local search iterations (default: 100)
        verbose: Print progress information (default: False)
        
    Returns:
        Tuple of (best_gearset_dict, best_scores, iterations_taken)
    """
    # Phase 1: Greedy initialization
    if verbose:
        print("Phase 1: Greedy initialization...")
    
    current_gearset = {}
    
    # Greedily pick best item for each slot
    for slot, items in all_items.items():
        best_item = None
        best_score = None
        errors = []
        
        for item in items:
            # Try this item in the slot
            test_gearset = current_gearset.copy()
            test_gearset[slot] = item
            
            # Validate if function provided
            if validate_function and not validate_function(test_gearset):
                continue
            
            # Score this configuration
            try:
                score = score_function(test_gearset)
                
                # Keep if better (or first valid item)
                if best_score is None or is_better(score, best_score):
                    best_item = item
                    best_score = score
            except Exception as e:
                errors.append(str(e))
                continue
        
        # Use best item found (or None if no valid items)
        current_gearset[slot] = best_item
        
        if verbose and best_item is None and len(items) > 1:
            print(f"  Warning: No valid item found for {slot} (tried {len(items)} items)")
            if errors:
                print(f"    Errors: {errors[0]}")  # Show first error
    
    # Get initial score
    try:
        current_score = score_function(current_gearset)
    except Exception as e:
        if verbose:
            print(f"  Error scoring initial gearset: {e}")
        raise
    
    if verbose:
        print(f"  Initial score: {current_score}")
    
    # Phase 2: Local search refinement
    if verbose:
        print("\nPhase 2: Local search refinement...")
    
    iteration = 0
    improved = True
    
    while improved and iteration < max_iterations:
        improved = False
        iteration += 1
        
        # Try swapping each slot
        for slot, items in all_items.items():
            current_item = current_gearset.get(slot)
            
            # Try each alternative item
            for item in items:
                # Skip if same as current
                if item is current_item:
                    continue
                
                # Try swap
                test_gearset = current_gearset.copy()
                test_gearset[slot] = item
                
                # Validate if function provided
                if validate_function and not validate_function(test_gearset):
                    continue
                
                # Score this configuration
                try:
                    test_score = score_function(test_gearset)
                    
                    # If better, keep it
                    if is_better(test_score, current_score):
                        current_gearset = test_gearset
                        current_score = test_score
                        improved = True
                        
                        if verbose:
                            print(f"  Iteration {iteration}: Improved to {current_score}")
                        
                        break  # Move to next slot
                except:
                    continue
            
            # If we improved, restart from first slot
            if improved:
                break
    
    if verbose:
        if iteration >= max_iterations:
            print(f"\n  Stopped: Max iterations ({max_iterations}) reached")
        else:
            print(f"\n  Converged after {iteration} iterations")
        print(f"  Final score: {current_score}")
    
    return current_gearset, current_score, iteration

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def create_multi_level_comparator(
    primary_minimize: bool = True,
    secondary_minimize: bool = False,
    tertiary_minimize: bool = True
) -> Callable[[Tuple[float, ...], Tuple[float, ...]], bool]:
    """
    Create a comparison function for multi-level sorting.
    
    Args:
        primary_minimize: True to minimize primary score, False to maximize
        secondary_minimize: True to minimize secondary score, False to maximize
        tertiary_minimize: True to minimize tertiary score, False to maximize
        
    Returns:
        Comparison function that returns True if first tuple is better
    """
    def compare(new_scores: Tuple[float, ...], old_scores: Tuple[float, ...]) -> bool:
        """Compare two score tuples with multi-level sorting."""
        # Primary comparison
        if primary_minimize:
            if new_scores[0] < old_scores[0]:
                return True
            elif new_scores[0] > old_scores[0]:
                return False
        else:
            if new_scores[0] > old_scores[0]:
                return True
            elif new_scores[0] < old_scores[0]:
                return False
        
        # Secondary comparison (if primary is equal)
        if len(new_scores) > 1 and len(old_scores) > 1:
            if secondary_minimize:
                if new_scores[1] < old_scores[1]:
                    return True
                elif new_scores[1] > old_scores[1]:
                    return False
            else:
                if new_scores[1] > old_scores[1]:
                    return True
                elif new_scores[1] < old_scores[1]:
                    return False
        
        # Tertiary comparison (if secondary is equal)
        if len(new_scores) > 2 and len(old_scores) > 2:
            if tertiary_minimize:
                if new_scores[2] < old_scores[2]:
                    return True
                elif new_scores[2] > old_scores[2]:
                    return False
            else:
                if new_scores[2] > old_scores[2]:
                    return True
                elif new_scores[2] < old_scores[2]:
                    return False
        
        # All equal - not better
        return False
    
    return compare

def prepare_items_by_slot(
    character,
    slots: List[str],
    filter_function: Optional[Callable[[object], bool]] = None
) -> Dict[str, List]:
    """
    Prepare items organized by slot from character inventory.
    
    Args:
        character: Character object with inventory
        slots: List of slot names (e.g., ['head', 'chest', 'tool0'])
        filter_function: Optional function to filter items (returns True to keep)
        
    Returns:
        Dictionary mapping slot names to lists of valid items
    """
    items_by_slot = {}
    
    for slot in slots:
        items_by_slot[slot] = []
        
        # Get items from character inventory
        for item, qty in character.items.items():
            if qty == 0:
                continue
            
            # Check if item fits this slot
            if not hasattr(item, 'slot'):
                continue
            
            # Match slot
            if slot.startswith('tool') and item.slot == 'tools':  # Note: slot is 'tools' (plural)
                pass  # Tools can go in any tool slot
            elif slot.startswith('ring') and item.slot == 'ring':
                pass  # Rings can go in any ring slot
            elif item.slot != slot:
                continue  # Slot mismatch
            
            # Apply filter if provided
            if filter_function and not filter_function(item):
                continue
            
            items_by_slot[slot].append(item)
    
    return items_by_slot


def optimize_for_activity_legacy(
    activity,
    character,
    score_function: Callable[[dict], Tuple[float, ...]],
    is_better: Callable[[Tuple[float, ...], Tuple[float, ...]], bool],
    validate_function: Optional[Callable[[dict], bool]] = None,
    max_iterations: int = 100,
    verbose: bool = False
) -> Tuple[dict, Tuple[float, ...], int]:
    """
    LEGACY: Optimize gearset for an activity with requirement handling.
    
    This function extends the basic greedy + local search algorithm with
    activity-specific requirement handling (skis, diving gear, light sources,
    fishing nets, etc.).
    
    NOTE: This is the legacy version. Use optimize_for_activity() instead,
    which supports SORTING_PRIORITY arrays and is more flexible.
    
    Args:
        activity: Activity object with requirements
        character: Character object with inventory and stats
        score_function: Function that takes gearset_dict and returns tuple of scores
        is_better: Function that compares two score tuples
        validate_function: Optional additional validation function
        max_iterations: Maximum local search iterations
        verbose: Print progress information
        
    Returns:
        Tuple of (best_gearset_dict, best_scores, iterations_taken)
    """
    """
    Optimize gearset for an activity with requirement handling.
    
    This function extends the basic greedy + local search algorithm with
    activity-specific requirement handling (skis, diving gear, light sources,
    fishing nets, etc.).
    
    Args:
        activity: Activity object with requirements
        character: Character object with inventory and stats
        score_function: Function that takes gearset_dict and returns tuple of scores
        is_better: Function that compares two score tuples
        validate_function: Optional additional validation function
        max_iterations: Maximum local search iterations
        verbose: Print progress information
        
    Returns:
        Tuple of (best_gearset_dict, best_scores, iterations_taken)
    """
    # Extract activity requirements
    needs_skis = 'Skis' in activity.requirements.get('keywords', [])
    required_diving_gear = activity.requirements.get('diving_gear', 0)
    required_light_sources = activity.requirements.get('light_sources', 0)
    
    # Get required keywords, filtering out ones handled separately
    all_keywords = activity.requirements.get('keywords', [])
    required_keywords = [kw for kw in all_keywords if kw.lower() not in ['light source', 'diving gear']]
    
    # Prepare slots
    gear_slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                  'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2']
    tool_slots_count = character.get_tool_slots()
    tool_slots = [f'tool{i}' for i in range(tool_slots_count)]
    all_slots = gear_slots + tool_slots
    
    # Get all items from inventory (filter by unlock status)
    all_items_list = []
    for item, qty in character.items.items():
        if qty > 0 and hasattr(item, 'get_stats_for_skill'):
            # Check if item is unlocked
            if hasattr(item, 'is_unlocked'):
                if not item.is_unlocked(character, ignore_gear_requirements=True):
                    continue
            all_items_list.append(item)
    
    if verbose:
        print(f"Found {len(all_items_list)} unlocked items")
        print(f"Activity requirements:")
        print(f"  Keywords: {required_keywords}")
        print(f"  Diving gear: {required_diving_gear}")
        print(f"  Light sources: {required_light_sources}")
        print(f"  Skis: {needs_skis}")
    
    # Phase 1: Greedy initialization with requirement handling
    if verbose:
        print("\nPhase 1: Greedy initialization with requirements...")
    
    current_gearset = {}
    diving_gear_count = 0
    light_source_count = 0
    diving_gear_slots = ['head', 'chest', 'hands', 'legs', 'feet', 'back']
    
    # Fill gear slots
    for slot in gear_slots:
        item_slot = 'ring' if slot in ['ring1', 'ring2'] else slot
        
        # Determine requirements for this slot
        must_have_skis = needs_skis and slot == 'feet'
        must_have_diving_gear = (required_diving_gear > 0 and 
                                 diving_gear_count < required_diving_gear and 
                                 slot in diving_gear_slots)
        need_light_sources = required_light_sources > 0 and light_source_count < required_light_sources
        
        best_item = None
        best_score = None
        
        for item in all_items_list:
            if not hasattr(item, 'slot') or item.slot != item_slot:
                continue
            
            # Check requirements
            has_skis = hasattr(item, 'keywords') and any('skis' in kw.lower() for kw in item.keywords)
            has_diving_gear = hasattr(item, 'keywords') and any('diving gear' in kw.lower() for kw in item.keywords)
            has_light_source = hasattr(item, 'keywords') and any('light source' in kw.lower() for kw in item.keywords)
            
            if must_have_skis and not has_skis:
                continue
            if must_have_diving_gear and not has_diving_gear:
                continue
            
            # Test item
            test_gearset = current_gearset.copy()
            test_gearset[slot] = item
            
            # Validate
            if validate_function and not validate_function(test_gearset):
                continue
            
            # Score
            try:
                score = score_function(test_gearset)
                
                # Prefer light sources when needed
                if need_light_sources and has_light_source:
                    # Boost score (assume first element is primary metric to minimize)
                    score = tuple([score[0] * 0.5] + list(score[1:]))
                
                if best_score is None or is_better(score, best_score):
                    best_item = item
                    best_score = score
            except:
                continue
        
        current_gearset[slot] = best_item
        
        # Update counts
        if best_item and hasattr(best_item, 'keywords'):
            if any('diving gear' in kw.lower() for kw in best_item.keywords):
                diving_gear_count += 1
            if any('light source' in kw.lower() for kw in best_item.keywords):
                light_source_count += 1
        
        if verbose and best_item:
            print(f"  {slot}: {best_item.name}")
    
    # Fill tool slots
    for i, slot in enumerate(tool_slots):
        # Check for required keyword tools
        must_have_keyword = None
        if i < len(required_keywords):
            must_have_keyword = required_keywords[i]
        
        need_light_sources = required_light_sources > 0 and light_source_count < required_light_sources
        
        best_tool = None
        best_score = None
        
        for item in all_items_list:
            if not hasattr(item, 'slot') or item.slot != 'tools':
                continue
            
            # Check keyword requirement
            if must_have_keyword:
                if not (hasattr(item, 'keywords') and any(must_have_keyword.lower() in kw.lower() for kw in item.keywords)):
                    continue
            
            has_light_source = hasattr(item, 'keywords') and any('light source' in kw.lower() for kw in item.keywords)
            
            # Test tool
            test_gearset = current_gearset.copy()
            test_gearset[slot] = item
            
            # Validate
            if validate_function and not validate_function(test_gearset):
                continue
            
            # Score
            try:
                score = score_function(test_gearset)
                
                # Prefer light sources when needed
                if need_light_sources and has_light_source:
                    score = tuple([score[0] * 0.5] + list(score[1:]))
                
                if best_score is None or is_better(score, best_score):
                    best_tool = item
                    best_score = score
            except:
                continue
        
        current_gearset[slot] = best_tool
        
        # Update light source count
        if best_tool and hasattr(best_tool, 'keywords'):
            if any('light source' in kw.lower() for kw in best_tool.keywords):
                light_source_count += 1
        
        if verbose and best_tool:
            print(f"  {slot}: {best_tool.name}")
    
    if verbose:
        print(f"\nRequirements met:")
        if required_diving_gear > 0:
            print(f"  Diving gear: {diving_gear_count}/{required_diving_gear}")
        if required_light_sources > 0:
            print(f"  Light sources: {light_source_count}/{required_light_sources}")
    
    # Get initial score
    try:
        current_score = score_function(current_gearset)
    except Exception as e:
        if verbose:
            print(f"  Error scoring initial gearset: {e}")
        raise
    
    if verbose:
        print(f"  Initial score: {current_score}")
    
    # Phase 2: Local search refinement
    if verbose:
        print("\nPhase 2: Local search refinement...")
    
    # Prepare items by slot for local search
    items_by_slot = {}
    for slot in all_slots:
        item_slot = 'ring' if slot.startswith('ring') else ('tools' if slot.startswith('tool') else slot)
        items_by_slot[slot] = [item for item in all_items_list 
                               if hasattr(item, 'slot') and item.slot == item_slot]
    
    # Run local search
    iteration = 0
    improved = True
    
    while improved and iteration < max_iterations:
        improved = False
        iteration += 1
        
        for slot in all_slots:
            current_item = current_gearset.get(slot)
            
            for item in items_by_slot[slot]:
                if item is current_item:
                    continue
                
                test_gearset = current_gearset.copy()
                test_gearset[slot] = item
                
                if validate_function and not validate_function(test_gearset):
                    continue
                
                try:
                    test_score = score_function(test_gearset)
                    
                    if is_better(test_score, current_score):
                        current_gearset = test_gearset
                        current_score = test_score
                        improved = True
                        
                        if verbose:
                            print(f"  Iteration {iteration}: Improved to {current_score}")
                        break
                except:
                    continue
            
            if improved:
                break
    
    if verbose:
        print(f"\n  Converged after {iteration} iterations")
        print(f"  Final score: {current_score}")
    
    return current_gearset, current_score, iteration


def optimize_for_activity(
    activity,
    character,
    sorting_priority: list,
    calculate_metrics_fn: Callable[[dict], Tuple[dict, dict]],
    is_gearset_valid_fn: Callable[[dict, object, object, bool], bool],
    item_has_keyword_fn: Callable[[object, str], bool],
    max_iterations: int = 100,
    verbose: bool = False
) -> Tuple[dict, dict, dict, int]:
    """
    Optimize gearset for an activity using SORTING_PRIORITY array.
    
    This is an EXACT COPY of the working code from optimize_activity_gearsets.py
    to ensure identical behavior and results.
    
    Args:
        activity: Activity object with requirements
        character: Character object with inventory and stats
        sorting_priority: List of Sorting enum values (e.g., [Sorting.XP_PER_STEP, ...])
        calculate_metrics_fn: Function that takes gearset_dict and returns (metrics_dict, stats_dict)
        is_gearset_valid_fn: Function for validation (signature: gearset, character, activity, check_requirements)
        item_has_keyword_fn: Function to check if item has keyword
        max_iterations: Maximum local search iterations
        verbose: Print progress information
        
    Returns:
        Tuple of (best_gearset_dict, best_metrics_dict, best_stats_dict, iterations_taken)
    """
    if verbose:
        print(f"\n{'='*70}")
        print(f"GREEDY INITIALIZATION")
        print(f"{'='*70}")
    
    # Get all items (filter by unlock status)
    all_items = []
    excluded_count = 0
    for item, qty in character.items.items():
        if qty > 0 and hasattr(item, 'get_stats_for_skill'):
            # Check if item is unlocked using the item's built-in method
            if hasattr(item, 'is_unlocked'):
                if not item.is_unlocked(character, ignore_gear_requirements=True):
                    excluded_count += 1
                    continue
            
            all_items.append(item)
    
    if verbose:
        print(f"Found {len(all_items)} items to choose from ({excluded_count} locked)")
    
    # For each slot, pick best item
    gear_slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                  'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2']
    
    # Check activity requirements using unified keyword_counts
    # Get required keywords from activity
    required_keywords = activity.requirements.get('keyword_counts', {})
    
    # Track how many of each keyword we've added so far
    current_keyword_counts = {kw: 0 for kw in required_keywords.keys()}
    
    gearset = {}
    
    for slot in gear_slots:
        item_slot = 'ring' if slot in ['ring1', 'ring2'] else slot
        
        # Check which keywords we still need
        needed_keywords = {kw for kw, required in required_keywords.items() 
                          if current_keyword_counts[kw] < required}
        
        best_item = None
        best_metric = float('inf') if not sorting_priority[0].is_reverse else float('-inf')
        
        for item in all_items:
            if not hasattr(item, 'slot') or item.slot != item_slot:
                continue
            
            # Check which needed keywords this item has
            item_keywords = {kw for kw in needed_keywords if item_has_keyword_fn(item, kw)}
            
            # Skip if we need keywords but this item doesn't have any
            if needed_keywords and not item_keywords:
                continue
            
            # Test this item in the slot
            test_gearset = gearset.copy()
            test_gearset[slot] = item
            
            # Only check UUID/keyword constraints during greedy (not activity requirements)
            if not is_gearset_valid_fn(test_gearset, character, None, False):
                continue
            
            metrics, _ = calculate_metrics_fn(test_gearset)
            metric_value = metrics[sorting_priority[0].metric_key]
            
            # Boost items that have needed keywords
            if item_keywords:
                if sorting_priority[0].is_reverse:
                    metric_value = metric_value * 1.5  # Boost for maximize metrics
                else:
                    metric_value = metric_value * 0.5  # Boost for minimize metrics (lower is better)
            
            if sorting_priority[0].is_reverse:
                if metric_value > best_metric:
                    best_metric = metric_value
                    best_item = item
            else:
                if metric_value < best_metric:
                    best_metric = metric_value
                    best_item = item
        
        gearset[slot] = best_item
        
        # Update keyword counts
        if best_item:
            for kw in required_keywords.keys():
                if item_has_keyword_fn(best_item, kw):
                    current_keyword_counts[kw] += 1
        
        if verbose and best_item:
            print(f"  {slot}: {best_item.name}")
        elif verbose:
            print(f"  {slot}: None (no valid items found)")
    
    # Verify we have enough of each required keyword
    if verbose:
        for kw, required in required_keywords.items():
            if required > 0:
                print(f"\n{kw}: {current_keyword_counts[kw]}/{required} required")
    
    # Add tools - fill them greedily too
    tool_slots = character.get_tool_slots()
    if verbose:
        print(f"\nAdding {tool_slots} tool slots...")
    
    for i in range(tool_slots):
        slot = f'tool{i}'
        
        # Check which keywords we still need
        needed_keywords = {kw for kw, required in required_keywords.items() 
                          if current_keyword_counts[kw] < required}
        
        best_tool = None
        best_metric = float('inf') if not sorting_priority[0].is_reverse else float('-inf')
        
        for item in all_items:
            if not hasattr(item, 'slot') or item.slot != 'tools':
                continue
            
            # Check which needed keywords this item has
            item_keywords = {kw for kw in needed_keywords if item_has_keyword_fn(item, kw)}
            
            # Skip if we need keywords but this item doesn't have any
            if needed_keywords and not item_keywords:
                continue
            
            # Test this tool
            test_gearset = gearset.copy()
            test_gearset[slot] = item
            
            # Validate
            if not is_gearset_valid_fn(test_gearset, character, None, False):
                continue
            
            metrics, _ = calculate_metrics_fn(test_gearset)
            metric_value = metrics[sorting_priority[0].metric_key]
            
            # Boost items that have needed keywords
            if item_keywords:
                if sorting_priority[0].is_reverse:
                    metric_value = metric_value * 1.5  # Boost for maximize metrics
                else:
                    metric_value = metric_value * 0.5  # Boost for minimize metrics (lower is better)
            
            if sorting_priority[0].is_reverse:
                if metric_value > best_metric:
                    best_metric = metric_value
                    best_tool = item
            else:
                if metric_value < best_metric:
                    best_metric = metric_value
                    best_tool = item
        
        gearset[slot] = best_tool
        
        # Update keyword counts
        if best_tool:
            for kw in required_keywords.keys():
                if item_has_keyword_fn(best_tool, kw):
                    current_keyword_counts[kw] += 1
        
        if verbose and best_tool:
            print(f"  {slot}: {best_tool.name}")
        elif verbose:
            print(f"  {slot}: None (no valid tools found)")
    
    if verbose:
        print(f"\nInitial gearset has {sum(1 for item in gearset.values() if item)} items")
    
    # LOCAL SEARCH REFINEMENT
    if verbose:
        print(f"\n{'='*70}")
        print(f"LOCAL SEARCH REFINEMENT")
        print(f"{'='*70}")
    
    current_gearset = gearset.copy()
    metric_key = sorting_priority[0].metric_key
    
    # Calculate initial metrics
    current_metrics, current_stats = calculate_metrics_fn(current_gearset)
    current_value = current_metrics[metric_key]
    
    if verbose:
        print(f"Initial {metric_key}: {current_value:.4f}")
    
    iteration = 0
    for iteration_num in range(max_iterations):
        improved = False
        best_swap = None
        best_value = current_value
        best_gearset = None
        best_gearset_metrics = current_metrics
        best_gearset_stats = None
        
        # Try swapping each slot
        for slot in current_gearset.keys():
            current_item = current_gearset[slot]
            
            # Determine slot type
            if slot.startswith('ring'):
                item_slot = 'ring'
            elif slot.startswith('tool'):
                item_slot = 'tools'
            else:
                item_slot = slot
            
            # Try every other item in this slot
            for new_item in all_items:
                if not hasattr(new_item, 'slot') or new_item.slot != item_slot:
                    continue
                
                if new_item == current_item:
                    continue
                
                # Create test gearset
                test_gearset = current_gearset.copy()
                test_gearset[slot] = new_item
                
                # Validate (check requirements only on complete gearsets)
                if not is_gearset_valid_fn(test_gearset, character, activity, True):
                    continue
                
                # Calculate metrics
                test_metrics, test_stats = calculate_metrics_fn(test_gearset)
                
                # Multi-level comparison using Sorting.is_better()
                from util.walkscape_constants import Sorting
                is_better = Sorting.is_better(test_metrics, best_gearset_metrics, sorting_priority)
                
                if is_better:
                    best_value = test_metrics[metric_key]
                    best_swap = (slot, current_item, new_item)
                    best_gearset = test_gearset.copy()
                    best_gearset_metrics = test_metrics
                    best_gearset_stats = test_stats
                    improved = True
        
        if improved:
            slot, old_item, new_item = best_swap
            old_name = old_item.name if old_item else "None"
            if verbose:
                print(f"  Iteration {iteration_num + 1}: Swapped {slot}: {old_name} → {new_item.name}")
                for sorting in sorting_priority:
                    metric_key_display = sorting.metric_key
                    val_a = current_metrics[metric_key_display]
                    val_b = best_gearset_metrics[metric_key_display]
                    print(f"    {sorting.display_name}: {val_a:.2f} → {val_b:.2f} (Δ {val_b - val_a:+.2f})")
                    if val_a != val_b:
                        break
            
            current_gearset = best_gearset
            current_value = best_value
            current_metrics = best_gearset_metrics
            current_stats = best_gearset_stats
            iteration = iteration_num + 1
        else:
            if verbose:
                print(f"  No improvements found. Converged!")
            iteration = iteration_num + 1
            break
    
    if verbose:
        print(f"\nFinal {sorting_priority[0].metric_key}: {current_value:.4f}")
    
    return current_gearset, current_metrics, current_stats, iteration

    """
    Optimize gearset for an activity using SORTING_PRIORITY array.
    
    This is the modern version that works with the refactored sorting system.
    It uses greedy initialization + local search refinement with activity
    requirement handling.
    
    Args:
        activity: Activity object with requirements
        character: Character object with inventory and stats
        sorting_priority: List of Sorting enum values (e.g., [Sorting.XP_PER_STEP, ...])
        calculate_metrics_fn: Function that takes gearset_dict and returns (metrics_dict, stats_dict)
        validate_function: Optional additional validation function
        max_iterations: Maximum local search iterations
        verbose: Print progress information
        
    Returns:
        Tuple of (best_gearset_dict, best_metrics_dict, best_stats_dict, iterations_taken)
    """
    from util.walkscape_constants import Sorting, item_has_keyword
    
    if verbose:
        print(f"\n{'='*70}")
        print(f"GREEDY + LOCAL SEARCH OPTIMIZATION")
        print(f"{'='*70}")
        priority_names = ' > '.join(s.display_name for s in sorting_priority)
        print(f"Sorting: {priority_names}")
    
    # Extract activity requirements
    keyword_counts = activity.keyword_counts if hasattr(activity, 'keyword_counts') else {}
    
    # Get required keywords (excluding special ones handled separately)
    required_keywords = {}
    for kw, count in keyword_counts.items():
        if count > 0 and kw.lower() not in ['light source', 'diving gear', 'advanced diving gear']:
            required_keywords[kw] = count
    
    if verbose and required_keywords:
        print(f"Required keywords: {required_keywords}")
    
    # Get all unlocked items
    all_items = []
    for item, qty in character.items.items():
        if qty > 0 and hasattr(item, 'get_stats_for_skill'):
            if hasattr(item, 'is_unlocked'):
                if not item.is_unlocked(character, ignore_gear_requirements=True):
                    continue
            all_items.append(item)
    
    if verbose:
        print(f"Found {len(all_items)} unlocked items")
    
    # Phase 1: Greedy initialization
    if verbose:
        print(f"\nPhase 1: Greedy initialization...")
    
    gear_slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                  'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2']
    tool_slots_count = character.get_tool_slots()
    tool_slots = [f'tool{i}' for i in range(tool_slots_count)]
    
    current_gearset = {}
    current_keyword_counts = {kw: 0 for kw in required_keywords.keys()}
    
    # Fill gear slots greedily
    for slot in gear_slots:
        item_slot = 'ring' if slot in ['ring1', 'ring2'] else slot
        
        # Check which keywords we still need
        needed_keywords = {kw for kw, required in required_keywords.items() 
                          if current_keyword_counts[kw] < required}
        
        best_item = None
        best_metric = float('inf') if not sorting_priority[0].is_reverse else float('-inf')
        
        for item in all_items:
            if not hasattr(item, 'slot') or item.slot != item_slot:
                continue
            
            # Check which needed keywords this item has
            item_keywords = {kw for kw in needed_keywords if item_has_keyword(item, kw)}
            
            # Test this item
            test_gearset = current_gearset.copy()
            test_gearset[slot] = item
            
            # Validate (skip activity requirements during greedy - only check UUID/keywords)
            # We'll check activity requirements in local search phase
            # Import at module level to avoid circular imports
            if validate_function:
                # During greedy, we need to skip activity requirements
                # The validate_function checks full requirements, so we skip it here
                # and only do basic validation in local search
                pass
            
            # Calculate metrics
            try:
                metrics, _ = calculate_metrics_fn(test_gearset)
                metric_value = metrics[sorting_priority[0].metric_key]
                
                # Boost items that have needed keywords
                if item_keywords:
                    if sorting_priority[0].is_reverse:
                        metric_value = metric_value * 1.5  # Boost for maximize
                    else:
                        metric_value = metric_value * 0.5  # Boost for minimize
                
                # Check if better
                if sorting_priority[0].is_reverse:
                    if metric_value > best_metric:
                        best_metric = metric_value
                        best_item = item
                else:
                    if metric_value < best_metric:
                        best_metric = metric_value
                        best_item = item
            except:
                continue
        
        current_gearset[slot] = best_item
        
        # Update keyword counts
        if best_item:
            for kw in required_keywords.keys():
                if item_has_keyword(best_item, kw):
                    current_keyword_counts[kw] += 1
        
        if verbose and best_item:
            print(f"  {slot}: {best_item.name}")
    
    # Fill tool slots greedily
    if verbose:
        print(f"\nAdding {tool_slots_count} tool slots...")
    
    for slot in tool_slots:
        # Check which keywords we still need
        needed_keywords = {kw for kw, required in required_keywords.items() 
                          if current_keyword_counts[kw] < required}
        
        best_tool = None
        best_metric = float('inf') if not sorting_priority[0].is_reverse else float('-inf')
        
        for item in all_items:
            if not hasattr(item, 'slot') or item.slot != 'tools':
                continue
            
            # Check which needed keywords this item has
            item_keywords = {kw for kw in needed_keywords if item_has_keyword(item, kw)}
            
            # Skip if we need keywords but this item doesn't have any
            if needed_keywords and not item_keywords:
                continue
            
            # Test this tool
            test_gearset = current_gearset.copy()
            test_gearset[slot] = item
            
            # Validate (skip activity requirements during greedy - only check UUID/keywords)
            # We'll check activity requirements in local search phase
            if validate_function:
                # During greedy, skip full validation
                pass
            
            # Calculate metrics
            try:
                metrics, _ = calculate_metrics_fn(test_gearset)
                metric_value = metrics[sorting_priority[0].metric_key]
                
                # Boost items that have needed keywords
                if item_keywords:
                    if sorting_priority[0].is_reverse:
                        metric_value = metric_value * 1.5
                    else:
                        metric_value = metric_value * 0.5
                
                # Check if better
                if sorting_priority[0].is_reverse:
                    if metric_value > best_metric:
                        best_metric = metric_value
                        best_tool = item
                else:
                    if metric_value < best_metric:
                        best_metric = metric_value
                        best_tool = item
            except:
                continue
        
        current_gearset[slot] = best_tool
        
        # Update keyword counts
        if best_tool:
            for kw in required_keywords.keys():
                if item_has_keyword(best_tool, kw):
                    current_keyword_counts[kw] += 1
        
        if verbose and best_tool:
            print(f"  {slot}: {best_tool.name}")
    
    # Get initial metrics
    try:
        current_metrics, current_stats = calculate_metrics_fn(current_gearset)
        current_value = current_metrics[sorting_priority[0].metric_key]
    except Exception as e:
        if verbose:
            print(f"  Error calculating initial metrics: {e}")
        raise
    
    if verbose:
        print(f"\nInitial {sorting_priority[0].display_name}: {current_value:.4f}")
    
    # Phase 2: Local search refinement
    if verbose:
        print(f"\nPhase 2: Local search refinement...")
    
    iteration = 0
    improved = True
    
    while improved and iteration < max_iterations:
        improved = False
        iteration += 1
        
        best_swap = None
        best_value = current_value
        best_gearset = None
        best_gearset_metrics = current_metrics
        best_gearset_stats = None
        
        # Try swapping each slot
        for slot in current_gearset.keys():
            current_item = current_gearset[slot]
            
            # Determine slot type
            if slot.startswith('ring'):
                item_slot = 'ring'
            elif slot.startswith('tool'):
                item_slot = 'tools'
            else:
                item_slot = slot
            
            # Try every other item in this slot
            for new_item in all_items:
                if not hasattr(new_item, 'slot') or new_item.slot != item_slot:
                    continue
                
                if new_item == current_item:
                    continue
                
                # Create test gearset
                test_gearset = current_gearset.copy()
                test_gearset[slot] = new_item
                
                # Validate (check activity requirements on complete gearsets)
                if validate_function and not validate_function(test_gearset):
                    continue
                
                # Calculate metrics
                try:
                    test_metrics, test_stats = calculate_metrics_fn(test_gearset)
                    
                    # Multi-level comparison using Sorting.is_better()
                    is_better = Sorting.is_better(test_metrics, best_gearset_metrics, sorting_priority)
                    
                    if is_better:
                        best_value = test_metrics[sorting_priority[0].metric_key]
                        best_swap = (slot, current_item, new_item)
                        best_gearset = test_gearset.copy()
                        best_gearset_metrics = test_metrics
                        best_gearset_stats = test_stats
                        improved = True
                except:
                    continue
        
        if improved:
            slot, old_item, new_item = best_swap
            old_name = old_item.name if old_item else "None"
            if verbose:
                print(f"  Iteration {iteration}: Swapped {slot}: {old_name} → {new_item.name}")
                for sorting in sorting_priority:
                    metric_key = sorting.metric_key
                    val_a = current_metrics[metric_key]
                    val_b = best_gearset_metrics[metric_key]
                    print(f"    {sorting.display_name}: {val_a:.2f} → {val_b:.2f} (Δ {val_b - val_a:+.2f})")
                    if val_a != val_b:
                        break
            
            current_gearset = best_gearset
            current_value = best_value
            current_metrics = best_gearset_metrics
            current_stats = best_gearset_stats
        else:
            if verbose:
                print(f"  No improvements found. Converged!")
            break
    
    if verbose:
        print(f"\nConverged after {iteration} iterations")
        print(f"Final {sorting_priority[0].display_name}: {current_value:.4f}")
    
    return current_gearset, current_metrics, current_stats, iteration

