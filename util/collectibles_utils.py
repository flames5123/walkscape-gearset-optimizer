#!/usr/bin/env python3
"""
Utilities for working with collectibles.
"""

from util.walkscape_constants import *

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
    total_stats = {}
    
    for collectible in collectibles:
        # Use StatsMixin API - returns all stats in decimal format
        coll_stats = collectible.get_stats_for_skill(skill, location=location)
        
        for stat_name, stat_value in coll_stats.items():
            total_stats[stat_name] = total_stats.get(stat_name, 0.0) + stat_value
    
    return total_stats