#!/usr/bin/env python3
"""
Utilities for working with collectibles.
"""

from collections import OrderedDict

from util.walkscape_constants import *
from util.stats_mixin import StatsMixin

# (collectible ids, skill, location) -> (refs, total_stats), for all-static
# lists only. The refs keep each keyed object alive so its id() can't be reused.
_TOTALS_CACHE = OrderedDict()
_TOTALS_CACHE_MAX = 256


def _is_static(collectible):
    """True when the collectible's stats depend only on skill and location.

    Gated, achievement and composite stats read the character or global state.
    """
    return (
        isinstance(collectible, StatsMixin)
        and type(collectible).get_stats_for_skill is StatsMixin.get_stats_for_skill
        and not getattr(collectible, 'gated_stats', None)
        and not getattr(collectible, 'achievement_stats', None)
        and not hasattr(collectible, 'has_instance')
    )


def _key_part(value):
    return value if value is None or isinstance(value, str) else ('id', id(value))

def calculate_collectible_stats(collectibles, skill=None, location=None):
    """
    Calculate stat bonuses from a list of collectible objects.
    
    Args:
        collectibles: List of CollectibleInstance objects
        skill: Skill object or string to filter stats
        location: LocationInfo object or string for location-aware stats
        
    Returns:
        Dict with all stats in decimal format (0.05 = 5%)
    """
    collectibles = tuple(collectibles)
    key = (tuple(id(c) for c in collectibles), _key_part(skill), _key_part(location))
    hit = _TOTALS_CACHE.get(key)
    if hit is not None:
        _TOTALS_CACHE.move_to_end(key)
        return dict(hit[1])
    cacheable = all(_is_static(c) for c in collectibles)

    total_stats = {}
    
    for collectible in collectibles:
        # Use StatsMixin API - returns all stats in decimal format
        coll_stats = collectible.get_stats_for_skill(skill, location=location)
        
        for stat_name, stat_value in coll_stats.items():
            total_stats[stat_name] = total_stats.get(stat_name, 0.0) + stat_value
    
    if cacheable:
        _TOTALS_CACHE[key] = ((collectibles, skill, location), dict(total_stats))
        if len(_TOTALS_CACHE) > _TOTALS_CACHE_MAX:
            _TOTALS_CACHE.popitem(last=False)
    return total_stats