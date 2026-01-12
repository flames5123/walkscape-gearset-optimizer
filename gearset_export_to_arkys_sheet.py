#!/usr/bin/env python3
"""
Gearset Export to Arky's Sheet Format

Converts a gearset export string to the format used in Arky's spreadsheet.
Prints gear names in the specific order required by the sheet with detailed suffixes.

Suffix patterns:
- Skill-specific: (Glo), (Carp), (Craft), (Mine), (Smith), (Trink), (Trv), (Agl)
- Region-specific: (Jarvonia), (Syrenthia), (Underwater), (GDTE)
- Crafted items: (T1-Normal), (T5-Perfect), etc.
- Set bonuses: (Base), (Proper Set), (Treasure Hunter Set), (Adventuring Tool Set)
- Hydrilium gear: (T5-Perfect) or (T5-Perfect) (NMC-only) for underwater
"""

from util.gearset_utils import Gearset
from util.walkscape_constants import *

# ============================================================================
# CONFIGURATION
# ============================================================================

# Paste your gearset export string here
GEARSET_EXPORT = "H4sIAAAAAAAAE82W227bMAyGX6XwdQnoLHmvshQGJVGJUcfObKddUPTdR6cXG4a0c4sE2I0tyKb08edBeqnamfZT9e3u+0s1nw7Eo2pHmKv7u6rtM/3kCbGM+bfl28umavOGR5vzFDwPQ34exse23zbbDqeJJqiFVjUpAQI1ggnZAmJWy7yJJZVQEm54g03144hdO5/e1kvDfj/0bx9m3C6T/bHrXhcUGsdhPGM+vN7f/UZNyO+VqGkYsWsWCyheqoRSQdBBghFJQ+2jACOl1sUnZUy5EmHE9Pge4WL8oXc7mua17u1OeWy79rhvcvu0hGPmNQeIsfbK1haE1DWYTA6iLBwRGQyKGIqV+YKrHW2pzziePuftYWz3bPRVhydKw3nXry6wwz5PKxQLThXhYgFdZwITQwDUwQMF0k6gFzmrKyUAK7mG6HIM2XjL7wlU8pyvS57a7BnYaoiOCBQV60tWJZpLwCOO9Dncnt7P1z9wo8s+WU2Qki1cQblAzKJwjaeghBcelb2SgIVoTRH4VLw3xYPTpMGcq7s2AWpji3TRCGuuRTRySNaGdOhys10eixEo1LU3jiGRuDXa6ACFEaBdzJFstMVeqzX+DSn/R8h5GLq1Sk47HA9N2rUTdRCF8iEp4j5mljNGSMBgIsQUo8w6xeTdjRg/EhLzE/XzcZGxmfAZtOQzT2sDLtgAxjErRoGgYuKCDmSd0TfCVB9J2e4PHTXjsaMRgkAipSRrR8zoHUvJ1Q2SRyWxlkbHGzHqy4xZSBuksOBsncCQ4+7sIhNpq3OtHZmUbkRkLhOR524XOb9MCHxNEI4TT1MNWKzSfNuJRdyqJOw/jr+H118zWX2/xQkAAA=="
SKILL = Skill.CARPENTRY
CONSUMABLE = None
LOCATION = Location.HALFLING_CAMPGROUNDS  # Set to Location.VASTALUME or similar for location-specific stats

# ============================================================================
# SUFFIX GENERATION
# ============================================================================

def get_skill_abbreviation(skill_name: str) -> str:
    """Convert skill name to abbreviation."""
    skill_map = {
        'global': 'Glo',
        'carpentry': 'Carp',
        'crafting': 'Craft',
        'mining': 'Mine',
        'smithing': 'Smith',
        'trinketry': 'Trink',
        'traveling': 'Trv',
        'agility': 'Agl',
        'woodcutting': 'WC',
        'fishing': 'Fish',
        'foraging': 'Forg',
        'cooking': 'Cook'
    }
    return skill_map.get(skill_name.lower(), skill_name[:4].capitalize())

def get_region_name(location_key: str) -> str:
    """Convert location key to display name."""
    region_map = {
        'jarvonia': 'Jarvonia',
        'syrenthia': 'Syrenthia',
        'underwater': 'Underwater',
        'gdte': 'GDTE',
        'trellin': 'Trellin',
        'erdwise': 'Erdwise',
        'halfling rebels': 'Halfling Rebels'
    }
    return region_map.get(location_key.lower(), location_key.capitalize())

def get_tier_from_name(name: str) -> str:
    """Extract tier from crafted item name or quality level."""
    # For crafted items, the quality IS the tier
    # Normal=T1, Good=T2, Great=T3, Excellent=T4, Perfect=T5, Eternal=T6
    quality_to_tier = {
        'normal': 'T1',
        'good': 'T2',
        'great': 'T3',
        'excellent': 'T4',
        'perfect': 'T5',
        'eternal': 'T6'
    }
    
    name_lower = name.lower()
    for quality, tier in quality_to_tier.items():
        if quality in name_lower:
            return tier
    
    # Fallback: check material tier patterns
    tier_map = {
        'copper': 'T1', 'bronze': 'T1', 'iron': 'T1',
        'steel': 'T2', 'black steel': 'T3',
        'mithril': 'T4', 'adamantine': 'T5',
        'birch': 'T1', 'pine': 'T2', 'oak': 'T3',
        'maple': 'T4', 'yew': 'T5'
    }
    
    for material, tier in tier_map.items():
        if material in name_lower:
            return tier
    
    return 'T1'  # Default

def get_quality_from_name(name: str) -> str:
    """Extract quality from item name."""
    qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']
    name_lower = name.lower()
    for quality in qualities:
        if quality.lower() in name_lower:
            return quality
    return None

def get_set_name(item) -> str:
    """Get set name from gated_stats."""
    if not hasattr(item, 'gated_stats') or not item.gated_stats:
        return None
    
    if 'set_pieces' in item.gated_stats:
        set_names = list(item.gated_stats['set_pieces'].keys())
        if set_names:
            set_name = set_names[0]
            # Convert to display format
            set_map = {
                'proper set': 'Proper Set',
                'treasure hunter set': 'Treasure Hunter Set',
                'adventuring tool set': 'Adventuring Tool Set'
            }
            return set_map.get(set_name.lower(), set_name.title())
    
    return None

def analyze_item_stats(item, location=None, skill=None) -> dict:
    """
    Analyze item stats to determine what suffixes to add.
    
    Args:
        item: Item instance
        location: LocationInfo object for location-specific checks
        skill: SkillInstance to filter for skill-specific stats
    
    Returns dict with:
    - skills: list of skill abbreviations
    - regions: list of region names
    - tier: tier string (T1-T6)
    - quality: quality string
    - set_name: set name or None
    - is_hydrilium: bool
    - has_nmc_only: bool (for underwater hydrilium)
    """
    result = {
        'skills': [],
        'regions': [],
        'tier': None,
        'quality': None,
        'set_name': None,
        'is_hydrilium': False,
        'has_nmc_only': False
    }
    
    # Check if it's a hydrilium item
    if 'hydrilium' in item.name.lower():
        result['is_hydrilium'] = True
        result['quality'] = get_quality_from_name(item.name)
        result['tier'] = get_tier_from_name(item.name)
        
        # Check if it has NMC-only stats (underwater location)
        if location and hasattr(location, 'is_underwater') and location.is_underwater:
            # Get stats for this location
            stats = item.get_stats_for_skill(skill=skill, location=location)
            # Check if ONLY NMC stat exists
            if stats and len(stats) == 1 and 'no_materials_consumed' in stats:
                result['has_nmc_only'] = True
        
        return result
    
    # Check for set bonuses
    set_name = get_set_name(item)
    if set_name:
        result['set_name'] = set_name
    
    # Check for crafted item quality
    quality = get_quality_from_name(item.name)
    if quality:
        result['quality'] = quality
        result['tier'] = get_tier_from_name(item.name)
        return result
    
    # Analyze stats structure to find skill-specific and region-specific stats
    if not hasattr(item, '_stats') or not item._stats:
        return result
    
    # If skill filter is provided, only check that skill
    if skill:
        skill_name = skill.name.lower()
        
        # Check if item has stats for this skill
        for stats_skill, skill_data in item._stats.items():
            if not isinstance(skill_data, dict):
                continue
            
            # Check if this skill matches
            if skill.matches_skill(stats_skill):
                # Check for region-specific stats that apply at current location
                for location_key, stats in skill_data.items():
                    if isinstance(stats, dict) and stats and location_key != 'global':
                        # Only add region if we're at that location OR no location specified
                        if location is None:
                            # No location filter - show all regions
                            result['regions'].append(get_region_name(location_key))
                        elif location.is_in_region(location_key.lower()):
                            # We're at this location - show the region
                            result['regions'].append(get_region_name(location_key))
                
                # If we found regions, we're done
                if result['regions']:
                    return result
        
        # No region-specific stats for this skill at current location, no suffix needed
        return result
    
    # No skill filter - use original logic
    skills_with_non_global_locations = set()
    regions_found = set()
    skills_with_only_global = set()
    
    for skill_name, skill_data in item._stats.items():
        if not isinstance(skill_data, dict):
            continue
        
        # Check what locations this skill has
        has_non_global_location = False
        has_global_location = False
        
        for location_key, stats in skill_data.items():
            if isinstance(stats, dict) and stats:
                if location_key == 'global':
                    has_global_location = True
                else:
                    has_non_global_location = True
                    regions_found.add(location_key)
        
        # Track skills based on their location scope (including 'global' skill for regions)
        if has_non_global_location:
            skills_with_non_global_locations.add(skill_name)
        elif has_global_location and skill_name != 'global':
            # Only track non-global skills with global location
            skills_with_only_global.add(skill_name)
    
    # Priority: Region > Multiple Skills > Nothing
    # If item has region-specific stats, show region
    if regions_found:
        result['regions'] = [get_region_name(r) for r in sorted(regions_found)]
    # If item has multiple skills (even if all global), show them
    elif len(skills_with_only_global) > 1:
        result['skills'] = [get_skill_abbreviation(s) for s in sorted(skills_with_only_global)]
    # Single skill with only global location = no suffix (it's effectively a global item)
    
    return result

def format_item_name(item, location=None, skill=None) -> str:
    """
    Format item name with appropriate suffixes.
    
    Args:
        item: Item instance
        location: LocationInfo object for location-specific checks
        skill: SkillInstance to filter for skill-specific stats
    
    Examples:
    - "Sharp Chisel (Carp, Trink)"
    - "Trusty Tent (GDTE)"
    - "Iron Sickle (T1-Normal)"
    - "Adventuring Amulet (Base)" or "Adventuring Amulet (Adventuring Tool Set)"
    - "Hydrilium Diving Helm (T5-Perfect)"
    - "Hydrilium Diving Helm (T5-Perfect) (NMC-only)"
    """
    base_name = item.name
    
    # Remove quality from base name if present
    for quality in ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']:
        if f'({quality})' in base_name:
            base_name = base_name.replace(f'({quality})', '').strip()
    
    # Analyze item
    analysis = analyze_item_stats(item, location, skill)
    
    suffixes = []
    
    # Hydrilium items (special case)
    if analysis['is_hydrilium']:
        if analysis['tier'] and analysis['quality']:
            suffixes.append(f"{analysis['tier']}-{analysis['quality']}")
        if analysis['has_nmc_only']:
            suffixes.append("NMC-only")
        return f"{base_name} ({') ('.join(suffixes)})" if suffixes else base_name
    
    # Crafted items with quality
    if analysis['quality']:
        if analysis['tier']:
            suffixes.append(f"{analysis['tier']}-{analysis['quality']}")
        else:
            suffixes.append(analysis['quality'])
        return f"{base_name} ({suffixes[0]})"
    
    # Set bonuses
    if analysis['set_name']:
        # Check if item has base stats (non-set stats)
        has_base_stats = False
        if hasattr(item, '_stats') and item._stats:
            for skill_data in item._stats.values():
                if isinstance(skill_data, dict):
                    for location_data in skill_data.values():
                        if isinstance(location_data, dict) and location_data:
                            has_base_stats = True
                            break
        
        if has_base_stats:
            suffixes.append("Base")
        else:
            suffixes.append(analysis['set_name'])
        return f"{base_name} ({suffixes[0]})"
    
    # Skill-specific stats
    if analysis['skills']:
        suffixes.extend(analysis['skills'])
    
    # Region-specific stats
    if analysis['regions']:
        suffixes.extend(analysis['regions'])
    
    # Return with suffixes
    if suffixes:
        return f"{base_name} ({', '.join(suffixes)})"
    
    return base_name

# ============================================================================
# CONVERSION
# ============================================================================

# Slot order for Arky's sheet
SLOT_ORDER = [
    'cape',
    'back',
    'head',
    'hands',
    'neck',
    'chest',
    'primary',
    'secondary',
    'legs',
    'ring1',
    'ring2',
    'feet',
    'tool0',
    'tool1',
    'tool2',
    'tool3',
    'tool4',
    'tool5'
]

def main():
    if not GEARSET_EXPORT:
        print("⚠ No gearset export provided")
        print("Please set GEARSET_EXPORT in the script")
        return
    
    # Decode gearset
    gearset = Gearset(GEARSET_EXPORT)
    
    # Map slots to item names
    slot_map = {}
    
    # Process all items
    for slot, item in gearset.get_all_items():
        item_name = format_item_name(item, LOCATION, SKILL)
        slot_map[slot] = item_name
    
    # Print in Arky's sheet order
    print("Gearset for Arky's Sheet:")
    print("-" * 40)
    
    for slot in SLOT_ORDER:
        item_name = slot_map.get(slot, 'None')
        print(item_name)

    if CONSUMABLE: 
        print(CONSUMABLE.name)
    else: 
        print('None')
    
    print("-" * 40)
    print(f"Total items: {len([v for v in slot_map.values() if v != 'None'])}")
    if SKILL:
        print(f"Skill filter: {SKILL.name}")
    if LOCATION:
        print(f"Location: {LOCATION.name}")


if __name__ == '__main__':
    main()
