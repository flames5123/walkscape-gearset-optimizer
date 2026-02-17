#!/usr/bin/env python3
"""
Global runtime configuration for Walkscape
Set by Character initialization

Uses threading.local() to support multiple concurrent users in web environment.
"""

import threading

# Thread-local storage for character-specific data
_thread_locals = threading.local()

# Default values (used when no character is loaded)
DEFAULT_ACHIEVEMENT_POINTS = 0
DEFAULT_CUSTOM_STATS = {}


def set_achievement_points(ap: int):
    """Set achievement points for current thread/user"""
    _thread_locals.achievement_points = ap


def get_achievement_points() -> int:
    """Get the current achievement points value for this thread/user."""
    return getattr(_thread_locals, 'achievement_points', DEFAULT_ACHIEVEMENT_POINTS)


DEFAULT_TOTAL_SKILL_LEVEL = 0


def set_total_skill_level(level: int):
    """Set total skill level for current thread/user"""
    _thread_locals.total_skill_level = level


def get_total_skill_level() -> int:
    """Get the current total skill level value for this thread/user."""
    return getattr(_thread_locals, 'total_skill_level', DEFAULT_TOTAL_SKILL_LEVEL)


def set_custom_stats(custom_stats: dict):
    """
    Set custom stats for current thread/user.
    
    Args:
        custom_stats: Dict of custom stat toggles
                     e.g., {'screwdriver_underwater_basket_weaving': True, 'skate_skiing': True}
    """
    _thread_locals.custom_stats = custom_stats


def get_custom_stats() -> dict:
    """Get the current custom stats dict for this thread/user."""
    return getattr(_thread_locals, 'custom_stats', DEFAULT_CUSTOM_STATS.copy())


# For backward compatibility, provide ACHIEVEMENT_POINTS as a property-like access
# This allows existing code to continue working
class _APGetter:
    """Property-like class that returns thread-local AP value"""
    def __int__(self):
        return get_achievement_points()
    
    def __repr__(self):
        return str(get_achievement_points())
    
    def __str__(self):
        return str(get_achievement_points())
    
    def __eq__(self, other):
        return get_achievement_points() == other
    
    def __lt__(self, other):
        return get_achievement_points() < other
    
    def __le__(self, other):
        return get_achievement_points() <= other
    
    def __gt__(self, other):
        return get_achievement_points() > other
    
    def __ge__(self, other):
        return get_achievement_points() >= other


# Create a singleton instance that acts like an integer
ACHIEVEMENT_POINTS = _APGetter()


class _TSLGetter:
    """Property-like class that returns thread-local total skill level value"""
    def __int__(self):
        return get_total_skill_level()
    
    def __repr__(self):
        return str(get_total_skill_level())
    
    def __str__(self):
        return str(get_total_skill_level())
    
    def __eq__(self, other):
        return get_total_skill_level() == other
    
    def __lt__(self, other):
        return get_total_skill_level() < other
    
    def __le__(self, other):
        return get_total_skill_level() <= other
    
    def __gt__(self, other):
        return get_total_skill_level() > other
    
    def __ge__(self, other):
        return get_total_skill_level() >= other


# Create a singleton instance that acts like an integer
TOTAL_SKILL_LEVEL = _TSLGetter()
