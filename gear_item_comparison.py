#!/usr/bin/env python3
"""Find optimal gear configuration by testing all combinations of new items"""

import math
from itertools import combinations
from util.walkscape_constants import *
from util.gearset_utils import Gearset
import my_config

AGILITY_LEVEL = my_config.get_agility_level()
LEVEL_WE = (AGILITY_LEVEL - 1) * 0.005

# Gearset export string (paste your base gearset here)
GEARSET_EXPORT = "H4sIAAAAAAAAE63V227jOAwG4HfxdQjoQJ3yKptBQIlUYsSxs7aznaDouw+cAWZRZLp1J3vjC5syPvyiqNemneU8Ndu/Xpv5dpFm2xyFuNk0bc/yvdmqzb2i2Tavu6blXbPd3V+AfJextJPsl/pMPUNSVlsfAiR2GRAtQnRRgKsJ1uuExodds9k1f1+pa+fb/V+dHKRnGm/3LzMdds22v3bdW7NpZByHcbF9e9v84hW6yAreUrYf6v5IXQUqx1b+kRGK8UZsDcDEDJjZAknVUK0r1WinNfvniZnKaQVxKbtQOYG32oUcIyiJCVDXCJlMhqRSYsGkk7f/Q3BHmeYVrPHa921/2E/HdpzBFbRo0YHWBQG1ZUhaC2jCkmLyGAI+2K59Gc7noV9Lu4ztmcbbClw7Dv1+ehlGBqUqCRmCUBQC2uCA2AoUV02JCtkYelo2SRnuKa+wTbNIt8QmHUPKIQSdKyjJy54GCzF4B0U5jkQixacH3UijrJUdqedphWoeRfZToW7Z09LRywQVSxJkB1pZBnRZQ3KewasafYnEFPjp5Do5rOH9223DOE9gvdE2i4VMQoC2GiCfBGoVUykGEalP03r57HwG8sUl5yH4oAAlCyRPFqJYNhSM5iJPM6rIJ+dRBaO4SAFWVABr9kDBVwghKjSBmepjGl9porHtD58k4VIkEy3kFBJgcQ6ouApVZaecZ9H4OJvk0pY/I+iP+mToeH9YHks9GLIpoA/g723ilmAUKrA+cxaXXXWPZ/8rwczD0K06XNdpvu1n6WeIriYlEkH7HAFVYIjaWahaMLucq/GPpq8k9d70YVJnuiwX34FngWxicjobMGVpIHEWsq8acjHKKpcU2sfd+2ofv3eZ37hqEfbBKEC/XCJsLESuFgxGcSmF4Onx2n2OYT+Kp3bDyzJwLkM5yfxCczmC9kVcRA01CQOSEkiuJgjJmmRqCEX/psnno4xC3Z/58D/m9en0E9jJBDkJ22gi2Jw9YHQVKFsDNakaCsZo/HMj4D3L/WIti96v+fb2A+/Qts0uCgAA"

test = Item.WANDERLUST_WALKING_STICK
# New items to test (add items here)
NEW_ITEMS = [
    Item.MEDIEVAL_SNEAKERS,
    # Add more items to test
]

# Routes to optimize for (use Location enums)
LOCATIONS = {
    Location.GRANFIDDICH, Location.WARRENFIELD, Location.MANGROVE_FOREST
}

ROUTES = []
for (start, end), route_data in RAW_ROUTES.items():
    if start in LOCATIONS and end in LOCATIONS:
        if route_data.get('requires') in ['skis', 'light_source', 'diving_gear']:
            continue
        ROUTES.append((start, end, route_data['distance']))


def calc_steps(base: int, gear: dict) -> float:
    """Calculate expected steps with DA."""
    we = gear.get('work_efficiency', 0.0)
    da = gear.get('double_action', 0.0)
    flat = gear.get('steps_add', 0)
    pct = gear.get('steps_percent', 0.0)
    
    eff = 1.00 + LEVEL_WE + we
    adj = (base / eff) * (1 - pct)
    rounded_total = math.ceil(adj)
    steps_per_node = rounded_total / 10 + flat
    steps_per_node = max(10, math.ceil(steps_per_node))
    expected_paid_nodes = 10 / (1 + da)
    return math.ceil(expected_paid_nodes * steps_per_node)


def format_stats(stats: dict) -> str:
    """Format stats dict for display."""
    we = stats.get('work_efficiency', 0.0)
    da = stats.get('double_action', 0.0)
    flat = stats.get('steps_add', 0.0)
    pct = stats.get('steps_percent', 0.0)
    return f"WE={we*100:.0f}% DA={da*100:.0f}% Flat={flat:+.0f} Pct={pct*100:.0f}%"


def find_best_gear_combination(gearset, new_items, routes):
    """
    Find the best combination of gear replacements
    
    Args:
        gearset: Current Gearset object
        new_items: List of new items to consider
        routes: List of (start, end, distance) tuples
        
    Returns:
        Best configuration and its total steps
    """
    # Calculate base total with location-aware stats per route
    base_total = 0
    print("\nDEBUG: Base route calculations:")
    for start, end, dist in routes:
        # Pass the Location object directly for location-aware stats
        route_stats = gearset.get_total_stats(Skill.TRAVEL, location=start)
        route_steps = calc_steps(dist, route_stats)
        start_name = start.name if hasattr(start, 'name') else str(start)
        end_name = end.name if hasattr(end, 'name') else str(end)
        print(f"  {start_name} → {end_name}: {route_steps:.0f} steps ({format_stats(route_stats)})")
        base_total += route_steps
    
    # For display, use first route's location
    first_location = routes[0][0] if routes else None
    base_stats = gearset.get_total_stats(Skill.TRAVEL, location=first_location)
    
    best_config = {
        'replacements': [],
        'total_steps': base_total,
        'improvement': 0,
        'stats': base_stats
    }
    
    equipped_items = gearset.get_all_items()
    
    # Group equipped items by slot for easy replacement
    items_by_slot = {}
    for slot, item in equipped_items:
        if item.slot not in items_by_slot:
            items_by_slot[item.slot] = []
        items_by_slot[item.slot].append((slot, item))
    
    # Group new items by slot
    new_by_slot = {}
    for new_item in new_items:
        if new_item.slot not in new_by_slot:
            new_by_slot[new_item.slot] = []
        new_by_slot[new_item.slot].append(new_item)
    
    # Generate all possible replacement combinations
    # For each slot with new items, try all combinations of replacements
    all_combinations = [{}]  # Start with no replacements
    
    for slot_type, new_items_in_slot in new_by_slot.items():
        if slot_type not in items_by_slot:
            continue
        
        equipped_in_slot = items_by_slot[slot_type]
        new_combinations = []
        
        for combo in all_combinations:
            # Keep current combo (no replacement in this slot)
            new_combinations.append(combo.copy())
            
            # Try replacing 1, 2, 3... items in this slot
            for num_replacements in range(1, min(len(equipped_in_slot), len(new_items_in_slot)) + 1):
                # Try all combinations of which equipped items to replace
                for equipped_combo in combinations(equipped_in_slot, num_replacements):
                    # Try all combinations of which new items to use
                    for new_combo in combinations(new_items_in_slot, num_replacements):
                        # Try all permutations of assignment
                        from itertools import permutations as perms
                        for new_perm in perms(new_combo):
                            new_config = combo.copy()
                            for (slot_name, old_item), new_item in zip(equipped_combo, new_perm):
                                new_config[slot_name] = (old_item, new_item)
                            new_combinations.append(new_config)
        
        all_combinations = new_combinations
    
    # Test each combination
    print(f"Testing {len(all_combinations)} gear combinations...\n")
    
    for combo in all_combinations:
        if not combo:
            continue  # Skip empty (current gear)
        
        # Calculate stats for this combination
        variant_stats = base_stats.copy()
        
        for slot_name, (old_item, new_item) in combo.items():
            old_stats = old_item.attr(Skill.TRAVEL)
            new_stats = new_item.get_stats_for_skill(Skill.TRAVEL)
            
            # Subtract old stats
            for stat_name, value in old_stats.items():
                variant_stats[stat_name] = variant_stats.get(stat_name, 0.0) - value
            
            # Add new stats
            for stat_name, value in new_stats.items():
                variant_stats[stat_name] = variant_stats.get(stat_name, 0.0) + value
        
        # Calculate total steps with location-aware stats per route
        variant_total = 0
        for start, end, dist in routes:
            # Calculate stats for this route with replacements
            route_stats = {}
            
            # Get stats from all items (with replacements applied)
            for slot, item in equipped_items:
                # Check if this slot is being replaced
                if slot in combo:
                    _, new_item = combo[slot]
                    item_stats = new_item.get_stats_for_skill(Skill.TRAVEL, location=start)
                else:
                    item_stats = item.get_stats_for_skill(Skill.TRAVEL, location=start)
                
                # Add item stats to route stats
                for stat_name, value in item_stats.items():
                    route_stats[stat_name] = route_stats.get(stat_name, 0.0) + value
            
            variant_total += calc_steps(dist, route_stats)
        improvement = base_total - variant_total
        
        if variant_total < best_config['total_steps']:
            best_config = {
                'replacements': list(combo.items()),
                'total_steps': variant_total,
                'improvement': improvement,
                'stats': variant_stats
            }
    
    return best_config, base_total


# Load gearset
gearset = Gearset(GEARSET_EXPORT)

print("=== Current Gearset ===")
for slot, item in gearset.get_all_items():
    stats = item.get_stats_for_skill(Skill.TRAVEL)
    print(f"{slot:12}: {item.name:35} {stats}")

base_stats = gearset.get_total_stats(Skill.TRAVEL)
print(f"\nBase Total: {format_stats(base_stats)}")

print("\n=== New Items to Test ===")
for item in NEW_ITEMS:
    # Use a representative location from LOCATIONS for location-aware stats
    test_location = list(LOCATIONS)[0] if LOCATIONS else None
    stats = item.get_stats_for_skill(Skill.TRAVEL, location=test_location)
    print(f"{item.name:35} (slot={item.slot:8}): {stats}")

# Find best combination
best, base_total = find_best_gear_combination(gearset, NEW_ITEMS, ROUTES)

print("\n" + "="*80)
print("OPTIMIZATION RESULTS")
print("="*80)
print(f"\nBase configuration: {base_total:.1f} steps")

if best['replacements']:
    print(f"Best configuration: {best['total_steps']:.1f} steps (saves {best['improvement']:.1f} steps)")
    print(f"\nReplacements:")
    for slot_name, (old_item, new_item) in best['replacements']:
        print(f"  {slot_name:12}: {old_item.name:30} → {new_item.name}")
    print(f"\nFinal Stats: {format_stats(best['stats'])}")
else:
    print("Best configuration: Keep current gear (no improvement found)")
print("="*80)
