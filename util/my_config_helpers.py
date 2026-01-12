#!/usr/bin/env python3
"""
Helper functions and constants for my_config.py
These are shared utilities that can be imported by other modules.
"""

from typing import Union
from util.walkscape_constants import *


# ============================================================
# SERVICE HELPER FUNCTIONS
# ============================================================

def base_service(service: ServiceCategory, location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring service visit."""
    loc_str = location.value if isinstance(location, Location) else location
    prefix = ServicePrefix[service.name].value
    tier_suffix = "A" if tier == ServiceTier.ADVANCED else ""
    return f"{prefix}{tier_suffix}:{loc_str}" if tier_suffix else f"{prefix}{loc_str}"

def b(location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring bank visit."""
    return base_service(ServiceCategory.BANK, location, tier)

def t(location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring trinketry bench visit."""
    return base_service(ServiceCategory.TRINKETRY, location, tier)

def cook(location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring cooking service visit."""
    return base_service(ServiceCategory.COOKING, location, tier)

def carp(location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring carpentry service visit."""
    return base_service(ServiceCategory.CARPENTRY, location, tier)

def smith(location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring smithing service visit."""
    return base_service(ServiceCategory.SMITHING, location, tier)

def craft(location: Union[Location, str], tier: ServiceTier = ServiceTier.BASIC) -> str:
    """Mark location as requiring crafting service visit."""
    return base_service(ServiceCategory.CRAFTING, location, tier)

# Advanced service shortcuts
def ta(location: Union[Location, str]) -> str:
    """Advanced trinketry bench."""
    return t(location, ServiceTier.ADVANCED)

def cooka(location: Union[Location, str]) -> str:
    """Advanced cooking service."""
    return cook(location, ServiceTier.ADVANCED)

def carpa(location: Union[Location, str]) -> str:
    """Advanced carpentry service."""
    return carp(location, ServiceTier.ADVANCED)

def smitha(location: Union[Location, str]) -> str:
    """Advanced smithing service."""
    return smith(location, ServiceTier.ADVANCED)

def crafta(location: Union[Location, str]) -> str:
    """Advanced crafting service."""
    return craft(location, ServiceTier.ADVANCED)

def from_to_location_gear_set_name(from_location, to_location) -> str:
    """Generate gearset name for a specific from/to location pair."""
    return from_location.name + " ⟶ " + to_location.name


# ============================================================
# GEARSET HELPER FUNCTIONS
# ============================================================

def get_gearset(gearsets_dict: dict, name: str = 'default') -> str:
    """Get a gearset export string by name from a gearsets dictionary."""
    return gearsets_dict.get(name, gearsets_dict.get('default', ''))

def get_gearset_stats(gearsets_dict: dict, name: str = 'default') -> dict:
    """Get stats dict for a gearset from a gearsets dictionary."""
    from util.gearset_utils import gearset_to_stats
    export_str = get_gearset(gearsets_dict, name)
    if export_str:
        return gearset_to_stats(export_str)
    return {}


# ============================================================
# SHORTCUT CONSTANTS
# ============================================================

RUN_SHORTCUT = "Run for your life"
EXPLORE_BOG_BOTTOM = "Explore bog bottom"
EXPLORE_UNDERWATER_CAVE = "Explore underwater cave"

RUN_FOR_YOUR_LIFE_STEPS = 264
EXPLORE_BOG_BOTTOM_STEPS = 1186
