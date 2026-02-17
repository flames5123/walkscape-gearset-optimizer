#!/usr/bin/env python3
"""
Display detailed stats for every item in a gearset
"""

from util.gearset_utils import Gearset, aggregate_gearset_stats
from util.walkscape_constants import Skill, Region, Attribute, Location
from util.collectibles_utils import calculate_collectible_stats
from my_config import get_character

# Paste your gearset export string here
GEARSET_EXPORT = "H4sIAAAAAAAAA62V3WrbQBCF30XXGdj/n9yXPkRdxOzurK1GllxJbmpC3r2jFAohcWNQLmzDelb6OGfmzFPTLXScm/tvT81yOVFz3xwIS3PXdEOh3829uHup4POnXdOVXXO/ezmA6TwM3bBvf3XzOIFyaFQJBF45D8bWAkkXC4GySlkKZYPaNXe75ucZ+265vDwnj8fjOLwcL7jno+Hc98/8bpqmcVqhvj/f/ePKyD8fc61l7VjbA/YVMB86+kUTZOUU6eqhYClgUtGAVCVUbXNV0kpZ3Ea+hPnhBr617MQfcFpan0IAQSGCkTXwfypBFDEWMlFGp7dKdqB5uYFpmQjn80Tt4TwsNLU/mI8WUCmRJxEhKc2iGfYz+SQBpZFKSkRMWwlPU3fE6XILI05z13fnYzs/jhPjoCkBbYBsC3ecKMhuZw3BVCsKZYoqv4H78jtT39Ow3Mo3Ux6HchvhvBD17cwd1xeIyXsvU2V30+quZzLvLGRhGRuJsotv8L6yDzejHXAo8/+xpLTaBRHAKYFglHcQg7JQvMeC3hkb5UYDe9p/APFuh51wWGaeSu2itQYiDwKY7AKExA0m2MDqTa7WpY18A300lSIxhkUWKUXF0WAEoOCxjCXLZIXzMb7j1DiWWxEq0S1DOOJDOz90M0iSqiIlEDJlztLErjnk6FIhlqSsL2Q3qjJxcv8fydsYUAUNKXru32wtj5etUAVrYl0habbO/msIeVWXvrT79WutB4U6esM7xiHhX3FQsGXapZLIJlstbuRaxrG/wa/aj4/rAjyNa1g+4pIPIF0mGwzvlUhrRAmCaGsEH7WKqnqf5VbVXtNdVY15eMzSuCw9gSETjGEiLN6AiciRTjlC1kKREFZlVz8VS13D2k9E5dKeuv3+0iYcHiBUKWOuBNVHZvPruslJgyZbU+WWS2VrRr1m01cb7Th0sNaCF1oWozQYpziXOMJ5BXKCqpilsui1E+ZTmcw1Jizj2vZtxaGdF1zOtIYjrz5ZQKiQeCvzZklGW3BGWFGDFiXSp8LZf3Drpaub/P2Qe3vl+/Mf1SrtUXUKAAA="

# Skill to display stats for
SKILL = Skill.CARPENTRY

# Region for location-aware stats (e.g., "Jarvonia", "Trellin", "Erdwise", "underwater", "global")
REGION = Location.BLACKSPELL_PORT

# Load character to get collectibles
character = get_character()

# Load gearset
gearset = Gearset(GEARSET_EXPORT)

print("="*80)
print(f"GEARSET DETAILED STATS (Region: {REGION})")
print("="*80)

# Get all items from gearset
items = [item for slot, item in gearset.get_all_items()]

# Use aggregate_gearset_stats to get total stats including collectibles
total_stats = aggregate_gearset_stats(
    items=items,
    skill=SKILL,
    location=REGION,
    character=character,
    include_level_bonus=False,  # Don't include level bonus for display
    include_collectibles=True
)

# Get collectible stats separately for display
collectible_stats = calculate_collectible_stats(
    character.collectibles,
    skill=SKILL,
    location=REGION
)

# Calculate set piece counts to show set bonuses
set_piece_counts = gearset._calculate_set_piece_counts()

# Collect individual item stats (WITH set bonuses per item)
stat_contributors = {}  # {stat_name: [(source, item/collectible, value), ...]}
item_totals = {}  # Track sum of individual items for comparison

for slot, item in gearset.get_all_items():
    # Get item stats WITH set bonuses
    stats = item.get_stats_for_skill(SKILL, location=REGION, character=character, set_piece_counts=set_piece_counts)
    
    for stat_name, stat_value in stats.items():
        # Track contributor
        if stat_name not in stat_contributors:
            stat_contributors[stat_name] = []
        stat_contributors[stat_name].append((slot, item, stat_value))
        
        # Track total from items
        item_totals[stat_name] = item_totals.get(stat_name, 0.0) + stat_value

# Add collectible contributions
for stat_name, stat_value in collectible_stats.items():
    if stat_name not in stat_contributors:
        stat_contributors[stat_name] = []
    stat_contributors[stat_name].append(('collectibles', None, stat_value))
    item_totals[stat_name] = item_totals.get(stat_name, 0.0) + stat_value

# Display stats grouped by stat type
print("\nSTATS BY TYPE:")
print("="*80)

for stat_name in sorted(total_stats.keys()):
    stat_value = total_stats[stat_name]
    
    # Format total value using Attribute definition
    stat_upper = stat_name.upper()
    if hasattr(Attribute, stat_upper):
        attr_obj = getattr(Attribute, stat_upper)
        if attr_obj.is_percentage:
            total_str = f"{stat_value*100:.2f}%"
        else:
            if isinstance(stat_value, float):
                total_str = f"{stat_value:+.2f}"
            else:
                total_str = f"{stat_value:+d}"
    else:
        # Unknown attribute - format based on value type
        if isinstance(stat_value, float):
            if abs(stat_value) < 1:
                total_str = f"{stat_value*100:.2f}%"
            else:
                total_str = f"{stat_value:+.2f}"
        else:
            total_str = f"{stat_value:+d}"
    
    print(f"\n{stat_name.upper()}: {total_str}")
    
    # Show items that contribute to this stat (if any)
    if stat_name in stat_contributors:
        print(f"  Contributors (including set bonuses and collectibles):")
        for source, item, value in stat_contributors[stat_name]:
            if source == 'collectibles':
                item_name = "Collectibles"
            else:
                item_name = item.display_name if hasattr(item, 'display_name') else item.name
            
            # Format item value using Attribute definition
            stat_upper = stat_name.upper()
            if hasattr(Attribute, stat_upper):
                attr_obj = getattr(Attribute, stat_upper)
                if attr_obj.is_percentage:
                    value_str = f"{value*100:.2f}%"
                else:
                    if isinstance(value, float):
                        value_str = f"{value:+.2f}"
                    else:
                        value_str = f"{value:+d}"
            else:
                # Unknown attribute - format based on value type
                if isinstance(value, float):
                    if abs(value) < 1:
                        value_str = f"{value*100:.2f}%"
                    else:
                        value_str = f"{value:+.2f}"
                else:
                    value_str = f"{value:+d}"
            
            print(f"    {source:12}: {item_name:40} {value_str}")
        
        # Check if there's a discrepancy (shouldn't be with new logic)
        if abs(item_totals.get(stat_name, 0.0) - stat_value) > 0.001:
            print(f"  Note: Total includes set bonuses and collectibles")
    else:
        print(f"  (No direct contributors - may be from set bonus only)")

print("\n" + "="*80)
print("TOTAL GEARSET STATS (including set bonuses and collectibles)")
print("="*80)
for stat_name, stat_value in sorted(total_stats.items()):
    # Format using Attribute definition
    stat_upper = stat_name.upper()
    if hasattr(Attribute, stat_upper):
        attr_obj = getattr(Attribute, stat_upper)
        if attr_obj.is_percentage:
            print(f"  {stat_name}: {stat_value*100:.1f}%")
        else:
            if isinstance(stat_value, float):
                print(f"  {stat_name}: {stat_value:+.1f}")
            else:
                print(f"  {stat_name}: {stat_value:+d}")
    else:
        # Unknown attribute - format based on value type
        if isinstance(stat_value, float):
            if abs(stat_value) < 1:
                print(f"  {stat_name}: {stat_value*100:.1f}%")
            else:
                print(f"  {stat_name}: {stat_value:+.1f}")
        else:
            print(f"  {stat_name}: {stat_value:+d}")
print("="*80)
