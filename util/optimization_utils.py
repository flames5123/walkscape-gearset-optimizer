#!/usr/bin/env python3
"""
Shared optimization utilities for gearset optimization.

Provides common functions used across activity, crafting, and travel optimizers
including item filtering, quality ranking, and stat caching.
"""

# Standard library imports
from typing import Dict, List, Optional, Set, Tuple

# ============================================================================
# ITEM FILTERING
# ============================================================================

def filter_items_by_quality(items: list, keep_highest_only: bool = True) -> list:
    """
    Filter items to keep only highest quality per base item.
    
    Args:
        items: List of item objects
        keep_highest_only: If True, keep only highest quality per base
        
    Returns:
        Filtered list of items
    """
    if not keep_highest_only:
        return items
    
    # Group by base name (remove quality suffix)
    by_base = {}
    
    for item in items:
        # Extract base name (remove quality in parentheses)
        base_name = item.name
        if '(' in base_name and ')' in base_name:
            base_name = base_name[:base_name.index('(')].strip()
        
        if base_name not in by_base:
            by_base[base_name] = []
        by_base[base_name].append(item)
    
    # Keep highest quality per base
    filtered = []
    quality_order = {
        'Eternal': 6, 'Perfect': 5, 'Excellent': 4,
        'Great': 3, 'Good': 2, 'Normal': 1, None: 0
    }
    
    for base_name, base_items in by_base.items():
        # Sort by quality (highest first), then by value
        def get_quality_score(item):
            for quality_name, score in quality_order.items():
                if quality_name and f'({quality_name})' in item.name:
                    return (score, item.value)
            return (0, item.value)
        
        best_item = max(base_items, key=get_quality_score)
        filtered.append(best_item)
    
    return filtered

def filter_items_by_stats(
    items: list,
    skill: str,
    location,
    character,
    required_stats: Optional[Set[str]] = None
) -> list:
    """
    Filter items to only those with relevant stats for the skill.
    
    Args:
        items: List of item objects
        skill: Skill name (e.g., 'agility', 'carpentry')
        location: Location object or None
        character: Character object
        required_stats: Set of stat names to check for (None = any stat)
        
    Returns:
        Filtered list of items with relevant stats
    """
    filtered = []
    
    for item in items:
        stats = item.get_stats_for_skill(skill, location=location, character=character)
        
        if not stats:
            continue
        
        # If no required stats specified, include any item with stats
        if required_stats is None:
            filtered.append(item)
            continue
        
        # Check if item has any of the required stats
        has_required = any(stat_name in stats and stats[stat_name] != 0 
                          for stat_name in required_stats)
        
        if has_required:
            filtered.append(item)
    
    return filtered

def filter_ignored_items(items: list, ignored_set: Set) -> list:
    """
    Filter out items in the ignored set.
    
    Args:
        items: List of item objects
        ignored_set: Set of Item enum values to ignore
        
    Returns:
        Filtered list without ignored items
    """
    # Extract base names from ignored set
    ignored_names = set()
    for ignored_item in ignored_set:
        if hasattr(ignored_item, 'name'):
            # Remove quality suffix to match base name
            base_name = ignored_item.name
            if '(' in base_name and ')' in base_name:
                base_name = base_name[:base_name.index('(')].strip()
            ignored_names.add(base_name)
    
    # Filter items
    filtered = []
    for item in items:
        base_name = item.name
        if '(' in base_name and ')' in base_name:
            base_name = base_name[:base_name.index('(')].strip()
        
        if base_name not in ignored_names:
            filtered.append(item)
    
    return filtered

# ============================================================================
# KEYWORD VALIDATION
# ============================================================================

def validate_tool_keywords(tools: list, excluded_keywords: Optional[Set[str]] = None) -> bool:
    """
    Validate that tools don't share non-excluded keywords.
    
    Args:
        tools: List of tool items
        excluded_keywords: Set of keywords that can be shared (e.g., 'tool', 'light source')
        
    Returns:
        True if valid (no keyword conflicts), False otherwise
    """
    if excluded_keywords is None:
        from util.walkscape_constants import EXCLUDED_TOOL_KEYWORDS
        excluded_keywords = EXCLUDED_TOOL_KEYWORDS
    
    # Track keywords seen
    seen_keywords = set()
    
    for tool in tools:
        if tool is None:
            continue
        
        if not hasattr(tool, 'keywords'):
            continue
        
        for keyword in tool.keywords:
            keyword_lower = keyword.lower()
            
            # Skip excluded keywords
            if keyword_lower in excluded_keywords:
                continue
            
            # Check for conflict
            if keyword_lower in seen_keywords:
                return False
            
            seen_keywords.add(keyword_lower)
    
    return True

def validate_uuid_uniqueness(items: list, character, allow_ring_duplicates: bool = True) -> bool:
    """
    Validate that items don't exceed owned quantities.
    
    For tools: Each UUID can only be used once (strict uniqueness)
    For rings: Can use same UUID multiple times if owned quantity permits
    For gear: Each UUID can only be used once (strict uniqueness)
    
    Args:
        items: List of item objects (can include None)
        character: Character object with inventory
        allow_ring_duplicates: If True, allow multiple rings if quantity permits
        
    Returns:
        True if valid (within owned quantities), False otherwise
    """
    # Count UUIDs used
    uuid_counts = {}
    uuid_to_item = {}  # Track which item each UUID belongs to
    
    for item in items:
        if item is None:
            continue
        
        if not hasattr(item, 'uuid'):
            continue
        
        uuid = item.uuid
        uuid_counts[uuid] = uuid_counts.get(uuid, 0) + 1
        uuid_to_item[uuid] = item
    
    # Build UUID cache if not already cached on character (performance optimization)
    if not hasattr(character, '_uuid_cache'):
        character._uuid_cache = {}
        for inv_item, qty in character.items.items():
            if hasattr(inv_item, 'uuid'):
                uuid = inv_item.uuid
                character._uuid_cache[uuid] = character._uuid_cache.get(uuid, 0) + qty
    
    # Check against owned quantities using cache
    for uuid, count_used in uuid_counts.items():
        owned_qty = character._uuid_cache.get(uuid, 0)
        item = uuid_to_item[uuid]
        
        # For tools: strict uniqueness (can only use each UUID once)
        if hasattr(item, 'slot') and item.slot == 'tools':
            if count_used > 1:
                return False
        # For rings: allow duplicates if owned quantity permits
        elif hasattr(item, 'slot') and item.slot == 'ring' and allow_ring_duplicates:
            if count_used > owned_qty:
                return False
        # For all other gear: strict uniqueness (can only use each UUID once)
        else:
            if count_used > 1:
                return False
    
    return True

# ============================================================================
# STAT CACHING
# ============================================================================

class StatCache:
    """Cache for item stats to avoid repeated calculations."""
    
    def __init__(self):
        self._cache = {}
    
    def get(self, item, skill: str, location) -> Optional[Dict[str, float]]:
        """Get cached stats or None if not cached."""
        cache_key = (id(item), skill, location.name if location else None)
        return self._cache.get(cache_key)
    
    def set(self, item, skill: str, location, stats: Dict[str, float]):
        """Cache stats for an item."""
        cache_key = (id(item), skill, location.name if location else None)
        self._cache[cache_key] = stats
    
    def get_or_compute(self, item, skill: str, location, character) -> Dict[str, float]:
        """Get cached stats or compute and cache them."""
        cached = self.get(item, skill, location)
        if cached is not None:
            return cached
        
        stats = item.get_stats_for_skill(skill, location=location, character=character)
        self.set(item, skill, location, stats)
        return stats
    
    def clear(self):
        """Clear the cache."""
        self._cache.clear()

# ============================================================================
# GEARSET VALIDATION
# ============================================================================

def is_gearset_complete(gearset_dict: dict, character) -> bool:
    """
    Check if a gearset has all required slots filled.
    
    Args:
        gearset_dict: Dictionary mapping slot names to items
        character: Character object (for tool slot count)
        
    Returns:
        True if all slots filled, False otherwise
    """
    # Required gear slots (always 12)
    required_gear_slots = [
        'head', 'cape', 'neck', 'chest', 'hands', 'legs', 'feet',
        'ring1', 'ring2', 'back', 'primary', 'secondary'
    ]
    
    # Check gear slots
    for slot in required_gear_slots:
        if slot not in gearset_dict or gearset_dict[slot] is None:
            return False
    
    # Check tool slots (use cached value from character for performance)
    max_tool_slots = character.get_tool_slots()
    
    for i in range(max_tool_slots):
        slot = f'tool{i}'
        if slot not in gearset_dict or gearset_dict[slot] is None:
            return False
    
    return True

def meets_activity_requirements(gearset_dict: dict, activity, character) -> bool:
    """
    Check if a gearset meets activity requirements.
    
    Uses the unified keyword_counts structure where all gear requirements
    are stored as {keyword: count} pairs.
    
    Args:
        gearset_dict: Dictionary mapping slot names to items
        activity: Activity object with requirements
        character: Character object
        
    Returns:
        True if requirements met, False otherwise
    """
    # Check skill requirements
    for skill, required_level in activity.skill_requirements.items():
        char_level = character.get_skill_level(skill.lower())
        if char_level < required_level:
            return False
    
    # Check reputation requirements
    for faction, required_amount in activity.requirements.get("reputation", {}).items():
        char_rep = character.reputation.get(faction, 0)
        if char_rep < required_amount:
            return False
    
    # Check achievement points
    required_ap = activity.requirements.get("achievement_points", 0)
    if required_ap > 0:
        from util.walkscape_globals import ACHIEVEMENT_POINTS
        if int(ACHIEVEMENT_POINTS) < required_ap:
            return False
    
    # Check all keyword requirements from keyword_counts
    items = [item for item in gearset_dict.values() if item is not None]
    keyword_counts = activity.requirements.get("keyword_counts", {})
    
    for keyword, required_count in keyword_counts.items():
        if required_count <= 0:
            continue
        
        # Count items with this keyword
        count = sum(
            1 for item in items
            if hasattr(item, "keywords") and
            any(keyword.lower() in kw.lower() for kw in item.keywords)
        )
        if count < required_count:
            return False
    
    return True


# ============================================================================
# ACTIVITY OPTIMIZATION
# ============================================================================

def optimize_activity(
    activity,
    character,
    optimize_for='xp_per_step',  # 'xp_per_step', 'steps_per_action', 'steps_per_reward'
    target_item=None,
    max_iterations=100,
    verbose=False
):
    """
    Optimize gearset for an activity using greedy + local search.
    
    This is the shared optimization logic used by all activity optimizers.
    
    Args:
        activity: Activity object to optimize for
        character: Character object
        optimize_for: What to optimize ('xp_per_step', 'steps_per_action', 'steps_per_reward')
        target_item: Optional specific item to optimize drop rate for
        max_iterations: Max local search iterations
        verbose: Print debug output
    
    Returns:
        Tuple of (best_gearset_dict, metrics_dict, iterations)
    """
    from util.activity_metrics import calculate_activity_metrics
    from util.gearset_utils import aggregate_gearset_stats, encode_gearset
    from util.greedy_local_search import optimize_gearset_greedy_local_search, create_multi_level_comparator, prepare_items_by_slot
    from util.walkscape_constants import character_level_from_steps, tool_slots_for_level
    
    # Get tool slots
    total_steps = sum(character.skills.values())
    char_level = character_level_from_steps(total_steps)
    max_tool_slots = tool_slots_for_level(char_level)
    
    # Define slots
    gear_slots = ['head', 'cape', 'neck', 'chest', 'hands', 'legs', 'feet',
                  'ring1', 'ring2', 'back', 'primary', 'secondary']
    tool_slots = [f'tool{i}' for i in range(max_tool_slots)]
    all_slots = gear_slots + tool_slots
    
    # Get items
    all_items = []
    for item, qty in character.items.items():
        if qty == 0 or not hasattr(item, 'slot'):
            continue
        if hasattr(item, 'is_unlocked'):
            if not item.is_unlocked(character, ignore_gear_requirements=True):
                continue
        all_items.append(item)
    
    all_items = filter_items_by_quality(all_items, keep_highest_only=True)
    
    # Prepare items by slot
    items_by_slot = {}
    for slot in all_slots:
        items_by_slot[slot] = []
        for item in all_items:
            if slot.startswith('tool') and item.slot == 'tools':
                items_by_slot[slot].append(item)
            elif slot.startswith('ring') and item.slot == 'ring':
                items_by_slot[slot].append(item)
            elif item.slot == slot:
                items_by_slot[slot].append(item)
        items_by_slot[slot].append(None)
    
    # Scoring function
    def score_function(gearset_dict):
        items = [item for item in gearset_dict.values() if item is not None]
        
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
        
        metrics = calculate_activity_metrics(
            base_steps=activity.base_steps,
            base_xp=activity.base_xp,
            max_efficiency=activity.max_efficiency,
            work_efficiency=total_stats.get('work_efficiency', 0.0),
            double_action=total_stats.get('double_action', 0.0),
            double_rewards=total_stats.get('double_rewards', 0.0),
            steps_add=int(total_stats.get('steps_add', 0)),
            steps_percent=total_stats.get('steps_percent', 0.0)
        )
        
        # Return score based on optimization goal
        if optimize_for == 'xp_per_step':
            return (-metrics['primary_xp_per_step'],)  # Maximize = minimize negative
        elif optimize_for == 'steps_per_action':
            return (metrics['expected_steps_per_action'],)
        elif optimize_for == 'steps_per_reward':
            return (metrics['steps_per_reward_roll'],)
        else:
            return (metrics['expected_steps_per_action'],)
    
    # Validation function
    def validate_function(gearset_dict):
        # Get tools
        tools = [gearset_dict.get(f'tool{i}') for i in range(max_tool_slots)]
        
        # Check keyword uniqueness
        if not validate_tool_keywords(tools):
            return False
        
        # Check UUID uniqueness
        if not validate_uuid_uniqueness(list(gearset_dict.values()), character):
            return False
        
        # Check activity requirements (diving gear, light sources, etc.)
        if not meets_activity_requirements(gearset_dict, activity, character):
            return False
        
        return True
    
    # Optimize
    is_better = create_multi_level_comparator(primary_minimize=True)
    
    best_gearset, best_scores, iterations = optimize_gearset_greedy_local_search(
        all_items=items_by_slot,
        character=character,
        score_function=score_function,
        is_better=is_better,
        validate_function=validate_function,
        max_iterations=max_iterations,
        verbose=verbose
    )
    
    # Calculate final metrics
    items = [item for item in best_gearset.values() if item is not None]
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
    
    metrics = calculate_activity_metrics(
        base_steps=activity.base_steps,
        base_xp=activity.base_xp,
        max_efficiency=activity.max_efficiency,
        work_efficiency=total_stats.get('work_efficiency', 0.0),
        double_action=total_stats.get('double_action', 0.0),
        double_rewards=total_stats.get('double_rewards', 0.0),
        steps_add=int(total_stats.get('steps_add', 0)),
        steps_percent=total_stats.get('steps_percent', 0.0)
    )
    
    return best_gearset, metrics, iterations
