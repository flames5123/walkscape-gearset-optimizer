#!/usr/bin/env python3
"""Simple comparison of two items"""

from util.walkscape_constants import *

# Items to compare
ITEM1 = Item.HYDRILIUM_SICKLE.GREAT
ITEM2 = Item.IRON_SICKLE.PERFECT

# Skill to compare for
SKILL = Skill.FORAGING

# Location (optional)
LOCATION = None  # Set to 'jarvonia', 'underwater', etc. if needed


print("="*80)
print("ITEM COMPARISON")
print("="*80)

# Get abbreviated names using the mixin method
abbrev1 = ITEM1.abbreviate_name()
abbrev2 = ITEM2.abbreviate_name()

print(f"\nItem 1: {ITEM1.name}")
print(f"  Abbreviated: {abbrev1}")
print(f"  Slot: {ITEM1.slot}")

print(f"\nItem 2: {ITEM2.name}")
print(f"  Abbreviated: {abbrev2}")
print(f"  Slot: {ITEM2.slot}")

# Get stats using the StatsMixin API
stats1 = ITEM1.get_stats_for_skill(SKILL, location=LOCATION)
stats2 = ITEM2.get_stats_for_skill(SKILL, location=LOCATION)

# Get all unique stat keys from both items
all_stat_keys = set(stats1.keys()) | set(stats2.keys())

if not all_stat_keys:
    print(f"\n⚠️  No stats found for {SKILL} skill")
    print("="*80)
    exit(0)

print("\n" + "="*80)
print("STAT-BY-STAT COMPARISON")
print("="*80)
print(f"{'Stat':<25} {abbrev1:>15} {abbrev2:>15} {'Difference':>15}")
print("-"*80)

for stat_key in sorted(all_stat_keys):
    val1 = stats1.get(stat_key, 0.0)
    val2 = stats2.get(stat_key, 0.0)
    diff = val2 - val1

    # Check if this is a percentage attribute
    key_upper = stat_key.upper()
    suffix = " "
    if hasattr(Attribute, key_upper):
        attribute_obj = getattr(Attribute, key_upper)
        if attribute_obj.is_percentage:
            # Stats are stored as decimals (0.05 = 5%), display as percentages
            val1_display = val1 * 100
            val2_display = val2 * 100
            diff_display = diff * 100
            suffix = "%"
        else:
            val1_display = val1
            val2_display = val2
            diff_display = diff
    else:
        val1_display = val1
        val2_display = val2
        diff_display = diff

    # Format the stat name nicely
    stat_display = stat_key.replace('_', ' ').title()
    
    print(f"{stat_display:<25} {val1_display:>14.1f}{suffix} {val2_display:>14.1f}{suffix} {diff_display:>+14.1f}{suffix}")

# Show which item is better overall
print("\n" + "="*80)
print("SUMMARY")
print("="*80)

better_stats_item1 = 0
better_stats_item2 = 0

for stat_key in all_stat_keys:
    val1 = stats1.get(stat_key, 0.0)
    val2 = stats2.get(stat_key, 0.0)
    
    if val1 > val2:
        better_stats_item1 += 1
    elif val2 > val1:
        better_stats_item2 += 1

print(f"{abbrev1}: {better_stats_item1} stats better")
print(f"{abbrev2}: {better_stats_item2} stats better")

if ITEM1.slot != ITEM2.slot:
    print(f"\n⚠️  Warning: Items are in different slots ({ITEM1.slot} vs {ITEM2.slot})")
else:
    print(f"\n✓ Both items fit in {ITEM1.slot} slot")

print("="*80)
