#!/usr/bin/env python3
"""
Optimization worker script.

Runs optimization by calling the EXACT functions from optimize_activity_gearsets.py
and optimize_craft_gearsets.py with their full configuration.
"""

import sys
import json
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No input file specified'}))
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    # Redirect all print statements to stderr so only JSON goes to stdout
    import io
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    
    try:
        # Read request
        with open(input_file, 'r') as f:
            request = json.load(f)
        
        opt_type = request['type']
        opt_id = request['id']
        character_config = request['character_config']
        ui_config = request.get('ui_config', {})  # Get ui_config for hide states
        target_item = request.get('target_item')
        target_quality = request.get('target_quality', 'Perfect')
        service_id = request.get('service_id')
        sorting_priority = request.get('sorting_priority', [])
        include_consumables = request.get('include_consumables', False)
        
        # Parse sorting_priority: supports both old format (plain strings)
        # and new format ([key, weight] tuples)
        def parse_sorting_priority(sorting_priority):
            """Convert sorting_priority to (priority_objs, weights_dict).
            
            Handles both old format (list of string keys) and new format
            (list of [key, weight] tuples). Old format entries get weight 100.
            
            Returns:
                Tuple of (list of Sorting enums, dict of Sorting enum → int weight)
            """
            from util.walkscape_constants import Sorting
            
            priority_objs = []
            weights_dict = {}
            
            for entry in sorting_priority:
                if isinstance(entry, (list, tuple)) and len(entry) == 2:
                    key, weight = entry[0], int(entry[1])
                elif isinstance(entry, str):
                    key, weight = entry, 100
                else:
                    continue
                
                # Clamp weight to 0-100
                weight = max(0, min(100, weight))
                
                # Find matching Sorting enum
                for sort in Sorting:
                    if sort.metric_key == key:
                        priority_objs.append(sort)
                        weights_dict[sort] = weight
                        break
            
            return priority_objs, weights_dict
        
        # Create character
        from util.character_export_util import Character
        
        # Use XP if available, otherwise convert levels to XP
        # Some old sessions may have partial skills_xp (only some skills), so merge both
        skills_xp = character_config.get('skills_xp', {})
        skills_levels = character_config.get('skills', {})
        
        from util.walkscape_constants import level_to_xp
        skills_data = {}
        # Start with all skills from levels dict (converted to XP)
        for skill, level in skills_levels.items():
            skills_data[skill] = level_to_xp(level)
        # Override with actual XP where available
        for skill, xp in skills_xp.items():
            skills_data[skill] = xp
        
        # Reconstruct a minimal export JSON from character_config
        # The session stores parsed data, not the original export
        minimal_export = {
            "name": character_config.get('name', 'Player'),
            "game_version": character_config.get('game_version', '1.0'),
            "steps": character_config.get('steps', 0),
            "achievement_points": character_config.get('achievement_points', 0),
            "coins": character_config.get('coins', 0),
            "skills": skills_data,
            "reputation": character_config.get('reputation', {}),
            "inventory": {},  # Will be populated below
            "bank": {},
            "gear": {},  # Not needed - optimizer finds best gear from inventory
            "collectibles": character_config.get('collectibles', []),
            "custom_stats": ui_config.get('custom_stats', {})  # Pass custom_stats directly
        }
        
        # Reconstruct items state the same way the frontend does (state.js loadSession):
        # 1. Build base state from character_config (owned_items, item_qualities, item_quantities)
        # 2. Apply user overrides from ui_config.user_overrides.items
        # 3. Build inventory with only the selected quality per item (qty 1),
        #    except rings which get ring1_quality + ring2_quality
        
        # Quality suffix mappings
        quality_suffixes = ['_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal']
        quality_to_suffix = {
            'Normal': '_common', 'Good': '_uncommon', 'Great': '_rare',
            'Excellent': '_epic', 'Perfect': '_legendary', 'Eternal': '_ethereal',
            'common': '_common', 'uncommon': '_uncommon', 'rare': '_rare',
            'epic': '_epic', 'legendary': '_legendary', 'ethereal': '_ethereal',
        }
        
        # Step 1: Build base items state from character_config (mirrors state.js logic)
        items_state = {}
        
        # From owned_items: mark items as owned, detect crafted quality
        for export_name in character_config.get('owned_items', []):
            base_id = export_name
            quality = None
            for suffix in quality_suffixes:
                if export_name.endswith(suffix):
                    base_id = export_name[:-len(suffix)]
                    quality = suffix[1:]  # Remove leading underscore
                    break
            
            if quality:
                items_state[base_id] = {'has': True, 'quality': quality}
            else:
                items_state[base_id] = {'has': True}
        
        # From item_qualities: set ring1_quality, ring2_quality, and quality (highest)
        quality_hierarchy = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']
        for item_id, qualities_obj in character_config.get('item_qualities', {}).items():
            sorted_qualities = sorted(
                qualities_obj.keys(),
                key=lambda q: quality_hierarchy.index(q) if q in quality_hierarchy else 999
            )
            if sorted_qualities:
                if item_id not in items_state:
                    items_state[item_id] = {'has': True}
                highest = sorted_qualities[0]
                highest_qty = qualities_obj[highest]
                items_state[item_id]['quality'] = highest
                items_state[item_id]['ring1_quality'] = highest
                
                if highest_qty >= 2:
                    items_state[item_id]['ring2_quality'] = highest
                elif len(sorted_qualities) > 1:
                    items_state[item_id]['ring2_quality'] = sorted_qualities[1]
                else:
                    items_state[item_id]['ring2_quality'] = 'None'
        
        # From item_quantities: set ring_quantity for non-crafted items
        for item_id, quantity in character_config.get('item_quantities', {}).items():
            if item_id not in items_state:
                items_state[item_id] = {'has': True}
            items_state[item_id]['ring_quantity'] = min(quantity, 2)
        
        # Step 2: Apply user overrides from ui_config (user toggling has/hide/quality in UI)
        user_overrides = ui_config.get('user_overrides', {}).get('items', {})
        for item_id, overrides in user_overrides.items():
            if item_id not in items_state:
                items_state[item_id] = {}
            items_state[item_id].update(overrides)
        
        # Step 3: Build inventory from merged state
        for item_id, state in items_state.items():
            if not state.get('has', False):
                continue
            
            # Skip entirely hidden items
            if state.get('hide', False):
                continue
            
            quality = state.get('quality')
            ring1_quality = state.get('ring1_quality')
            
            if ring1_quality:
                # Crafted ring: add ring1_quality and ring2_quality as separate entries
                # Respect hide_ring1 and hide_ring2 flags
                ring2_quality = state.get('ring2_quality', 'None')
                
                if not state.get('hide_ring1', False):
                    suffix1 = quality_to_suffix.get(ring1_quality, '_common')
                    export_name1 = f"{item_id}{suffix1}"
                    minimal_export['inventory'][export_name1] = minimal_export['inventory'].get(export_name1, 0) + 1
                
                if ring2_quality and ring2_quality != 'None' and not state.get('hide_ring2', False):
                    suffix2 = quality_to_suffix.get(ring2_quality, '_common')
                    export_name2 = f"{item_id}{suffix2}"
                    minimal_export['inventory'][export_name2] = minimal_export['inventory'].get(export_name2, 0) + 1
            elif quality:
                # Crafted non-ring: add at selected quality, qty 1
                suffix = quality_to_suffix.get(quality, '_common')
                export_name = f"{item_id}{suffix}"
                minimal_export['inventory'][export_name] = 1
            else:
                # Non-crafted item: qty 1 (or ring_quantity for rings)
                ring_quantity = state.get('ring_quantity', 1)
                minimal_export['inventory'][item_id] = ring_quantity
        
        character = Character(json.dumps(minimal_export))
        
        # Add fine consumables to character's items based on UI state (has_fine flag)
        # The UI stores fine ownership separately from normal ownership,
        # so we inject fine consumables directly into the character's items cache
        from util.autogenerated.consumables import Consumable
        ui_items_for_fine = ui_config.get('items', {})
        user_override_items_for_fine = ui_config.get('user_overrides', {}).get('items', {})
        all_items_for_fine = {**ui_items_for_fine, **user_override_items_for_fine}
        
        # Force the items cache to build first (includes gear + inventory + bank)
        _ = character.items
        
        for item_id, item_state in all_items_for_fine.items():
            if item_state.get('has_fine'):
                # Try to find the fine version of this consumable
                fine_enum_name = item_id.upper() + '_FINE'
                if hasattr(Consumable, fine_enum_name):
                    fine_consumable = getattr(Consumable, fine_enum_name)
                    character._all_items[fine_consumable] = character._all_items.get(fine_consumable, 0) + 1
                    print(f"Added fine consumable to character: {fine_consumable.name}")
        
        # Build set of hidden items from ui_config
        hidden_items = set()
        ui_items = ui_config.get('items', {})
        user_override_items = ui_config.get('user_overrides', {}).get('items', {})
        
        # Merge ui_items and user_override_items
        all_ui_items = {**ui_items, **user_override_items}
        
        for item_id, item_state in all_ui_items.items():
            if item_state.get('hide'):
                # Find the Item object for this item_id
                from util.autogenerated.equipment import Item
                from util.autogenerated.materials import Material
                from util.autogenerated.consumables import Consumable
                
                # Try to find item by matching name
                for attr_name in dir(Item):
                    if attr_name.startswith('_'):
                        continue
                    item = getattr(Item, attr_name)
                    if hasattr(item, 'name'):
                        # Convert item name to item_id format for comparison
                        check_id = item.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                        if check_id == item_id:
                            hidden_items.add(item)
                            break
                
                # Also check materials and consumables
                for attr_name in dir(Material):
                    if attr_name.startswith('_'):
                        continue
                    mat = getattr(Material, attr_name)
                    if hasattr(mat, 'name'):
                        check_id = mat.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                        if check_id == item_id:
                            hidden_items.add(mat)
                            break
                
                for attr_name in dir(Consumable):
                    if attr_name.startswith('_'):
                        continue
                    cons = getattr(Consumable, attr_name)
                    if hasattr(cons, 'name'):
                        check_id = cons.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                        if check_id == item_id:
                            hidden_items.add(cons)
                            break
        
        print(f"Found {len(hidden_items)} hidden items from UI config")
        
        # Also hide fine consumables where hide_fine is set
        for item_id, item_state in all_ui_items.items():
            if item_state.get('hide_fine'):
                fine_enum_name = item_id.upper() + '_FINE'
                if hasattr(Consumable, fine_enum_name):
                    hidden_items.add(getattr(Consumable, fine_enum_name))
                    print(f"Hiding fine consumable: {fine_enum_name}")
        
        # Set global character for optimization scripts
        import my_config
        my_config._CHARACTER_INSTANCE = character
        
        if opt_type == 'activity':
            from util.autogenerated.activities import Activity
            from util.autogenerated.materials import Material
            from util.autogenerated.equipment import Item
            import optimize_activity_gearsets
            from util.gearset_utils import encode_gearset
            
            # Find activity
            activity = None
            for attr_name in dir(Activity):
                if attr_name.startswith('_'):
                    continue
                act = getattr(Activity, attr_name)
                if hasattr(act, 'name'):
                    act_id = act.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                    if act_id == opt_id:
                        activity = act
                        break
            
            if not activity:
                sys.stdout = old_stdout
                print(json.dumps({'success': False, 'error': f'Activity not found: {opt_id}'}))
                sys.exit(1)
            
            # Parse target item
            target_obj = None
            if target_item and target_item != 'raw_rewards':
                from util.autogenerated.collectibles import Collectible
                from util.autogenerated.consumables import Consumable
                from util.autogenerated.currency import Currency
                
                # Try materials
                for attr_name in dir(Material):
                    if attr_name.startswith('_'):
                        continue
                    mat = getattr(Material, attr_name)
                    if hasattr(mat, 'name') and mat.name == target_item:
                        target_obj = mat
                        break
                
                # Try items
                if not target_obj:
                    for attr_name in dir(Item):
                        if attr_name.startswith('_'):
                            continue
                        item = getattr(Item, attr_name)
                        if hasattr(item, 'name') and item.name == target_item:
                            target_obj = item
                            break
                
                # Try collectibles
                if not target_obj:
                    for attr_name in dir(Collectible):
                        if attr_name.startswith('_'):
                            continue
                        coll = getattr(Collectible, attr_name)
                        if hasattr(coll, 'name') and coll.name == target_item:
                            target_obj = coll
                            break
                
                # Try consumables
                if not target_obj:
                    for attr_name in dir(Consumable):
                        if attr_name.startswith('_'):
                            continue
                        cons = getattr(Consumable, attr_name)
                        if hasattr(cons, 'name') and cons.name == target_item:
                            target_obj = cons
                            break
                
                # Try currency
                if not target_obj:
                    for attr_name in dir(Currency):
                        if attr_name.startswith('_'):
                            continue
                        curr = getattr(Currency, attr_name)
                        if hasattr(curr, 'name') and curr.name == target_item:
                            target_obj = curr
                            break
                
                # If still not found, use the string name directly
                # (for item finding drops that may not have a direct object)
                if not target_obj:
                    target_obj = target_item
            
            # Set configuration in the module
            optimize_activity_gearsets.ACTIVITY = activity
            optimize_activity_gearsets.TARGET_ITEM = target_obj
            optimize_activity_gearsets.VERBOSE = False
            optimize_activity_gearsets.IGNORED_ITEMS = hidden_items  # Use UI hide states
            optimize_activity_gearsets.INCLUDE_CONSUMABLES = include_consumables  # Use UI checkbox
            
            # Set sorting priority and weights if provided
            if sorting_priority:
                priority_objs, weights_dict = parse_sorting_priority(sorting_priority)
                if priority_objs:
                    optimize_activity_gearsets.SORTING_PRIORITY = priority_objs
                    optimize_activity_gearsets.SORTING_WEIGHTS = weights_dict
            
            # Log consumable setting
            if include_consumables:
                print(f"Including consumables in optimization")
            else:
                print(f"Excluding consumables from optimization")
            
            # Collect consumables for the consumable slot
            if include_consumables:
                consumable_items = []
                for item, qty in character.items.items():
                    if qty > 0 and hasattr(item, 'duration'):
                        consumable_items.append(item)
                
                if consumable_items:
                    # Add consumable as a slot in the optimizer's item pool
                    # The greedy + local search will treat it like any other slot
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = consumable_items
                    print(f"Added {len(consumable_items)} consumables as a slot option")
                else:
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = []
                    print(f"No consumables available")
            else:
                optimize_activity_gearsets.CONSUMABLE_ITEMS = []
                print(f"Testing without consumables")
            
            # Run optimization ONCE - consumable is treated as a slot
            initial_gearset = optimize_activity_gearsets.get_greedy_initial_solution(activity, character)
            final_gearset = optimize_activity_gearsets.local_search_refine(initial_gearset, activity, character, optimize_activity_gearsets.MAX_ITERATIONS)
            final_metrics, final_stats = optimize_activity_gearsets.calculate_gearset_metrics(final_gearset, activity, character, final=True, consumable=final_gearset.get('consumable'))
            
            best_gearset = final_gearset
            best_metrics = final_metrics
            best_consumable = final_gearset.get('consumable')
            
            if best_consumable:
                print(f"Best consumable: {best_consumable.name}")
            else:
                print(f"Best result: No consumable")
            
            # Generate export (consumable is NOT included - export format doesn't support it)
            # Consumable info is passed separately in the result for slots_json storage
            export_string = encode_gearset(final_gearset)
            
            # Build result
            result = {
                'success': True,
                'type': 'activity',
                'activity_id': opt_id,
                'activity_name': activity.name,
                'gearset_export': export_string,
                'metrics': final_metrics,
                'stats': final_stats,
                'items': {slot: item.name if item else None for slot, item in final_gearset.items()}
            }
            
            # Add consumable info if one was selected
            if best_consumable:
                result['consumable'] = {
                    'name': best_consumable.name,
                    'id': best_consumable.id if hasattr(best_consumable, 'id') else None
                }
            
            sys.stdout = old_stdout
            print(json.dumps(result))
            
        elif opt_type == 'recipe':
            import util.autogenerated.recipes as recipes_module
            from util.walkscape_constants import Service
            import optimize_craft_gearsets
            from util.gearset_utils import encode_gearset
            
            # Find recipe
            recipe = None
            for attr_name in dir(recipes_module):
                if attr_name.startswith('_'):
                    continue
                rec = getattr(recipes_module, attr_name)
                if hasattr(rec, 'name'):
                    rec_id = attr_name.lower()
                    if rec_id == opt_id:
                        recipe = rec
                        break
            
            if not recipe:
                sys.stdout = old_stdout
                print(json.dumps({'success': False, 'error': f'Recipe not found: {opt_id}'}))
                sys.exit(1)
            
            # Find service
            service = None
            if service_id:
                from util.walkscape_constants import Service
                
                # Try direct lookup by attribute name (handles "basic_sawmill_kallaheim")
                service_attr = service_id.upper().replace(' ', '_')
                if hasattr(Service, service_attr):
                    service = getattr(Service, service_attr)
                    print(f"Found service by attribute: {service.name}")
                
                # Try matching by display name (handles "Basic Sawmill")
                if not service:
                    for attr_name in dir(Service):
                        if attr_name.startswith('_'):
                            continue
                        svc = getattr(Service, attr_name)
                        if hasattr(svc, 'name') and svc.name.lower() == service_id.lower():
                            if svc.is_valid_for_recipe(recipe) and svc.is_unlocked(character):
                                service = svc
                                print(f"Found service by name match: {service.name}")
                                break
                
                # Try partial match on attribute name
                if not service:
                    service_id_normalized = service_id.lower().replace(' ', '_').replace('-', '_')
                    for attr_name in dir(Service):
                        if attr_name.startswith('_'):
                            continue
                        if attr_name.lower() == service_id_normalized:
                            svc = getattr(Service, attr_name)
                            if hasattr(svc, 'is_valid_for_recipe') and svc.is_valid_for_recipe(recipe) and svc.is_unlocked(character):
                                service = svc
                                print(f"Found service by normalized match: {service.name}")
                                break
                
                if not service:
                    sys.stdout = old_stdout
                    print(json.dumps({'success': False, 'error': f'Service not found: {service_id}'}))
                    sys.exit(1)
            else:
                # Find first available
                from util.autogenerated.services import SERVICES_BY_NAME
                for svc in SERVICES_BY_NAME.values():
                    if svc.is_valid_for_recipe(recipe) and svc.is_unlocked(character):
                        service = svc
                        break
                
                if not service:
                    sys.stdout = old_stdout
                    print(json.dumps({'success': False, 'error': 'No available services'}))
                    sys.exit(1)
            
            # Set configuration in the module
            optimize_craft_gearsets.RECIPE = recipe
            optimize_craft_gearsets.SERVICE = service
            optimize_craft_gearsets.TARGET_QUALITY = target_quality
            optimize_craft_gearsets.VERBOSE = False
            optimize_craft_gearsets.IGNORED_ITEMS = hidden_items  # Use UI hide states
            optimize_craft_gearsets.INCLUDE_CONSUMABLES = include_consumables  # Use UI checkbox
            
            # Set sorting priority and weights if provided
            if sorting_priority:
                priority_objs, weights_dict = parse_sorting_priority(sorting_priority)
                if priority_objs:
                    optimize_craft_gearsets.SORTING_PRIORITY = priority_objs
                    optimize_craft_gearsets.SORTING_WEIGHTS = weights_dict
            
            # Determine consumables to test
            consumables_to_test = [None]  # Always test without consumable
            
            if include_consumables:
                # Add all consumables from character inventory
                for item, qty in character.items.items():
                    if qty > 0 and hasattr(item, 'duration'):
                        consumables_to_test.append(item)
                print(f"Testing {len(consumables_to_test)} consumable options (including None)")
            else:
                print(f"Testing without consumables")
            
            # Test each consumable and find the best
            best_gearset = None
            best_metrics = None
            best_consumable = None
            best_iterations = 0
            
            for consumable in consumables_to_test:
                if consumable:
                    print(f"  Testing with {consumable.name}...")
                
                # Run optimization for this consumable
                gearset, metrics, iterations = optimize_craft_gearsets.optimize_for_service(
                    recipe, service, character, consumable=consumable
                )
                
                # Check if this is better than current best
                if best_gearset is None:
                    best_gearset = gearset
                    best_metrics = metrics
                    best_consumable = consumable
                    best_iterations = iterations
                else:
                    # Use the same comparison logic as the optimizer
                    from util.walkscape_constants import Sorting
                    priority = optimize_craft_gearsets.SORTING_PRIORITY
                    
                    is_better = False
                    for sort in priority:
                        new_val = metrics.get(sort.metric_key, float('inf'))
                        old_val = best_metrics.get(sort.metric_key, float('inf'))
                        
                        if sort.is_reverse:
                            if new_val > old_val:
                                is_better = True
                                break
                            elif new_val < old_val:
                                break
                        else:
                            if new_val < old_val:
                                is_better = True
                                break
                            elif new_val > old_val:
                                break
                    
                    if is_better:
                        best_gearset = gearset
                        best_metrics = metrics
                        best_consumable = consumable
                        best_iterations = iterations
                        if consumable:
                            print(f"    → New best with {consumable.name}!")
            
            # Use the best result
            final_gearset = best_gearset
            final_metrics = best_metrics
            iterations = best_iterations
            
            if best_consumable:
                print(f"Best consumable: {best_consumable.name}")
            else:
                print(f"Best result: No consumable")
            
            # Generate export
            export_string = encode_gearset(final_gearset)
            
            # Build result
            result = {
                'success': True,
                'type': 'recipe',
                'recipe_id': opt_id,
                'recipe_name': recipe.name,
                'service_name': service.name,
                'gearset_export': export_string,
                'metrics': final_metrics,
                'items': {slot: item.name if item else None for slot, item in final_gearset.items()}
            }
            
            # Add consumable info if one was selected
            if best_consumable:
                result['consumable'] = {
                    'name': best_consumable.name,
                    'id': best_consumable.id if hasattr(best_consumable, 'id') else None
                }
            
            sys.stdout = old_stdout
            print(json.dumps(result))
        
        elif opt_type == 'travel':
            import optimize_travel_gearsets
            from util.gearset_utils import encode_gearset
            from util.walkscape_constants import Sorting
            
            # Parse segments from request
            segments = request.get('segments', [])
            if not segments:
                sys.stdout = old_stdout
                print(json.dumps({'success': False, 'error': 'No route segments provided'}))
                sys.exit(1)
            
            # Set sorting priority and weights if provided
            priority_objs = None
            weights_dict = {}
            if sorting_priority:
                priority_objs, weights_dict = parse_sorting_priority(sorting_priority)
            
            if not priority_objs:
                priority_objs = [Sorting.AVG_TRAVEL_STEPS, Sorting.XP_PER_STEP]
                weights_dict = {s: 100 for s in priority_objs}
            
            # Set weights on the travel optimizer module
            optimize_travel_gearsets.SORTING_WEIGHTS = weights_dict
            
            print(f"Travel optimization: {len(segments)} segments, priority={[s.display_name for s in priority_objs]}")
            
            # Run optimization
            gearset, metrics, iterations = optimize_travel_gearsets.optimize_for_route(
                segments=segments,
                character=character,
                sorting_priority=priority_objs,
                hidden_items=hidden_items,
                include_consumables=include_consumables,
            )
            
            print(f"Travel optimization complete in {iterations} iterations")
            print(f"  Total steps: {metrics.get('total_steps', 0)}")
            print(f"  Avg steps: {metrics.get('avg_travel_steps', 0):.1f}")
            
            # Generate export
            export_string = encode_gearset(gearset)
            
            # Calculate per-segment stats for the response
            from util.gearset_utils import aggregate_gearset_stats
            from optimize_travel_gearsets import calculate_route_steps, _segments_to_routes
            
            items = [item for item in gearset.values() if item is not None]
            routes = _segments_to_routes(segments)
            
            segment_stats = []
            for seg, route in zip(segments, routes):
                stats = aggregate_gearset_stats(
                    items=items,
                    skill='travel',
                    location=route[0],
                    character=character,
                    include_level_bonus=True,
                    include_collectibles=True,
                )
                steps = calculate_route_steps(route, stats, character)
                segment_stats.append({
                    'start': seg['start'],
                    'end': seg['end'],
                    'steps_avg': steps,
                    'work_efficiency': round(stats.get('work_efficiency', 0.0) * 100, 1),
                    'double_action': round(stats.get('double_action', 0.0) * 100, 1),
                })
            
            # Build result
            result = {
                'success': True,
                'type': 'travel',
                'gearset_export': export_string,
                'metrics': metrics,
                'stats': segment_stats,
                'items': {slot: item.name if item else None for slot, item in gearset.items()},
            }
            
            sys.stdout = old_stdout
            print(json.dumps(result))
        
        else:
            sys.stdout = old_stdout
            print(json.dumps({'success': False, 'error': f'Invalid type: {opt_type}'}))
            sys.exit(1)
    
    except Exception as e:
        import traceback
        sys.stdout = old_stdout
        print(json.dumps({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()
