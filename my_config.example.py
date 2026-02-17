#!/usr/bin/env python3
"""
My Walkscape Configuration
Edit this file with your personal stats and routes.

SETUP:
1. Copy this file to my_config.py
2. Paste your character export below
3. Add your gearset exports
4. Edit service unlocks and shortcuts
"""

from util.walkscape_constants import *
from util.my_config_helpers import (
    # Service helper functions
    b, t, cook, carp, smith, craft,
    ta, cooka, carpa, smitha, crafta,
    base_service,
    # Gearset helpers
    from_to_location_gear_set_name,
    get_gearset, get_gearset_stats,
    # Shortcut constants
    RUN_SHORTCUT, EXPLORE_BOG_BOTTOM, EXPLORE_UNDERWATER_CAVE,
    RUN_FOR_YOUR_LIFE_STEPS, EXPLORE_BOG_BOTTOM_STEPS
)
from typing import Union

# ============================================================
# CHARACTER EXPORT - PASTE YOUR EXPORT HERE
# ============================================================
# Get this from the game: Settings > Account > Export Character Data
# Paste the entire JSON string between the triple quotes below
CHARACTER_EXPORT = """PASTE_YOUR_CHARACTER_EXPORT_HERE"""

# ============================================================
# SPECIAL REQUIREMENTS - EDIT THESE
# ============================================================
SCREWDRIVER_UNDERWATER_BASKET_WEAVING_50_COMPLETIONS = False
SCREWDRIVER_TINKERING_200_COMPLETIONS = False
CLASSIC_SKIING_50_COMPLETIONS = False
SKATE_SKIING_50_COMPLETIONS = False
UNDERWATER_SWIMMING_25_COMPLETIONS = False
FIREWOOD_MAKING_200_COMPLETIONS = False
ACCESS_SYRENTHIA = False

# ============================================================
# GEARSETS - PASTE YOUR GEARSET EXPORTS HERE
# ============================================================
# Get these from the game: Equipment > Export Gearset
#
# Gearset Types:
#
# 1. Regional gearsets (automatically selected based on starting location):
#    - 'GDTE': General GDTE region travel (Trellin, Erdwise, Halfling Rebels)
#    - 'Jarvonia': Jarvonia region (with skis)
#    - 'Diving': Underwater routes (Syrenthia locations)
#
# 2. Requirement-based gearsets (automatically selected based on route requirements):
#    - 'Swamp_2light': Swamp routes requiring 2 light sources
#    - 'Swamp_3light': Swamp routes requiring 3 light sources
#
# 3. Short variants (automatically selected for shorter distances):
#    - Add '_short' suffix to any gearset name (e.g., 'Jarvonia_short', 'Diving_short')
#
# 4. Custom route gearsets (highest priority - checked first):
#    - Use from_to_location_gear_set_name(from_loc, to_loc) as the key

GEARSETS = {
    # 'GDTE': "PASTE_GEARSET_EXPORT_HERE",
    # 'Jarvonia': "PASTE_GEARSET_EXPORT_HERE",
    # 'Diving': "PASTE_GEARSET_EXPORT_HERE",
}

# ============================================================
# SHORTCUTS - SPECIAL ROUTE SHORTCUTS
# ============================================================
HAS_UNDERWATER_MAP = False

SHORTCUTS = {
    (Location.WITCHED_WOODS, Location.OLD_ARENA_RUINS, RUN_SHORTCUT, True): RUN_FOR_YOUR_LIFE_STEPS,
    (Location.HALFLING_CAMPGROUNDS, Location.OLD_ARENA_RUINS, RUN_SHORTCUT, True): RUN_FOR_YOUR_LIFE_STEPS,
    (Location.BOG_TOP, Location.OLD_ARENA_RUINS, RUN_SHORTCUT, True): RUN_FOR_YOUR_LIFE_STEPS,
    (Location.BOG_BOTTOM, Location.OLD_ARENA_RUINS, RUN_SHORTCUT, True): RUN_FOR_YOUR_LIFE_STEPS,
    (Location.HALFMAW_HIDEOUT, Location.OLD_ARENA_RUINS, RUN_SHORTCUT, True): RUN_FOR_YOUR_LIFE_STEPS,
    (Location.BOG_BOTTOM, Location.UNDERWATER_CAVE, EXPLORE_BOG_BOTTOM, HAS_UNDERWATER_MAP): EXPLORE_BOG_BOTTOM_STEPS,
    (Location.UNDERWATER_CAVE, Location.BOG_BOTTOM, EXPLORE_UNDERWATER_CAVE, HAS_UNDERWATER_MAP): EXPLORE_BOG_BOTTOM_STEPS,
}

# ============================================================
# SERVICE UNLOCKS - EDIT THESE
# ============================================================
# Location services: {Location: {ServiceCategory: (ServiceTier, unlocked)}}
# Set unlocked=False for services you haven't unlocked yet
LOCATION_SERVICES = {
    # Example:
    # Location.KALLAHEIM: {
    #     ServiceCategory.BANK: (ServiceTier.BASIC, True),
    #     ServiceCategory.CARPENTRY: (ServiceTier.BASIC, True),
    #     ServiceCategory.COOKING: (ServiceTier.BASIC, True),
    #     ServiceCategory.SMITHING: (ServiceTier.BASIC, True),
    # },
}

# ============================================================
# CHARACTER LOADING HELPER
# ============================================================

def get_character():
    """Load character from export string"""
    from util.character_export_util import Character
    return Character(CHARACTER_EXPORT)

def get_agility_level():
    """Get agility level from config or character export"""
    return get_character().get_skill_level('agility')
