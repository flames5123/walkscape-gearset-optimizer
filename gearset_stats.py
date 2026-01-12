#!/usr/bin/env python3
"""
Display detailed stats for every item in a gearset
"""

from util.gearset_utils import Gearset, aggregate_gearset_stats
from util.walkscape_constants import Skill, Region, Attribute, Location
from util.collectibles_utils import calculate_collectible_stats
from my_config import get_character

# Paste your gearset export string here
GEARSET_EXPORT = "H4sIAAAAAAAAE8WWyW7bMBCGXyXwpZeMwX3pq9SBMSSHsWAtrqS0MYK8e0fuoWiQpkrhoCcRw+3jP5ueNs1M3bT5fPPlaTOfT8SjzYGwbG5vNk1f6JENYhnzsmXuabdpyo5Hu4sJDucyNm3z0O1L863p7/cHajsQOaqQSwJCn8BE5yEpjCCrU4TJGElqx1fsNl8fsG3m888TRxzpp3nG+8XUP7Tt84JC4ziMF8y759ubX6gZ+bsSdVm7H+r+gG0FzIeGvtEIWTGSrh4KlgImFQ1IVULVNlclrZTFvYKah64b+vfBJszHtbDD4/me+v2M/RGsMqFmciCFrWAwaEgiJ1CFghZZRpnElRDzgab5n30/85kDpBS9stGCkDqCKQyeZLWAMhgUKVQryyu4LfGDC47n9xGfxqbjTX9iXva/tX2iPFxu/dcDDtiXaYViUlrtggjglEAwyjuIQVko3mNB74yN8kpOZCXXEF182DU9jZ+m/Qn7eQKrDTPWAsQuBBOCBzQ+g84+6WyrTy5eCbKn9cnwO6SoAVXVyOkQOB2YCdBJCRGrVxk9p4u+EmQlWpMNWYtYC4e4csJzxDsCRMaSIaJwMUnU9irlbuQsW8GTqqJAIQBGzQrFEiFKCiDQhIRRGK4aV1LoJZH870TzMLRrA+vS/LYTv+GhxXHa5hHrTGU7HZu2ZeuWI2/5zDx5qXSnJh/xkbY9djSDLNnYZBC8Etw7jMoQow2g0VCMUltOmutVupcP+4PUl4dNTXdqaSnI+QDkjTWZJQ/RE5jKwCgztzjlVdFBF53rB4mvXmesLkh0qEBwvQGjPUIKsoKWSouiU1IlfRCRfkO12g7flz52GvKR5u84s3jSZbLBsFqR2McoCKKtEXzUKqrqfZbXqjYvUc2Kktjhfc+RyHqhN6T5t0WyoIgagnYRqsyqOmeEq+aDKO1fmuXd8w+xVlVEZQoAAA=="

# Skill to display stats for
SKILL = Skill.MINING

# Region for location-aware stats (e.g., "Jarvonia", "Trellin", "Erdwise", "underwater", "global")
REGION = Location.UNDERWATER_CAVE

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
