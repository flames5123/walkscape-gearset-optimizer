#!/usr/bin/env python3
"""
Travel optimization worker script.

Reads a temp JSON config file, runs the appropriate optimization algorithm
(single or multi-region), and prints a JSON result to stdout.

Invoked by app.py as:
    python -m ui.travel_optimize_worker <temp_json_file>
"""

import sys
import json
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No input file specified'}))
        sys.exit(1)

    input_file = sys.argv[1]

    # Redirect print statements to stderr so only JSON goes to stdout
    old_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        with open(input_file, 'r') as f:
            request = json.load(f)

        task_key = request['task_key']
        region_id = request['region_id']
        gearset_slot = request['gearset_slot']
        mode = request['mode']
        route_ids = request['route_ids']
        breakpoint_val = request.get('breakpoint')
        multi_count = request.get('multi_count', 2)
        character_config = request['character_config']
        ui_config = request.get('ui_config', {})

        print(f"Travel optimization: task={task_key}, mode={mode}, routes={len(route_ids)}")
        if len(route_ids) <= 10:
            print(f"  Route IDs: {route_ids}")
        else:
            print(f"  Route IDs (first 5): {route_ids[:5]}...")

        # Build character from config (same pattern as optimize_worker.py)
        from util.character_export_util import Character
        from util.walkscape_constants import level_to_xp

        skills_xp = character_config.get('skills_xp', {})
        skills_levels = character_config.get('skills', {})

        skills_data = {}
        for skill, level in skills_levels.items():
            skills_data[skill] = level_to_xp(level)
        for skill, xp in skills_xp.items():
            skills_data[skill] = xp

        quality_suffixes = ['_common', '_uncommon', '_rare', '_epic', '_legendary', '_ethereal']
        quality_to_suffix = {
            'Normal': '_common', 'Good': '_uncommon', 'Great': '_rare',
            'Excellent': '_epic', 'Perfect': '_legendary', 'Eternal': '_ethereal',
            'common': '_common', 'uncommon': '_uncommon', 'rare': '_rare',
            'epic': '_epic', 'legendary': '_legendary', 'ethereal': '_ethereal',
        }

        minimal_export = {
            "name": character_config.get('name', 'Player'),
            "game_version": character_config.get('game_version', '1.0'),
            "steps": character_config.get('steps', 0),
            "achievement_points": character_config.get('achievement_points', 0),
            "coins": character_config.get('coins', 0),
            "skills": skills_data,
            "reputation": character_config.get('reputation', {}),
            "inventory": {},
            "bank": {},
            "gear": {},
            "collectibles": character_config.get('collectibles', []),
            "custom_stats": ui_config.get('custom_stats', {}),
        }

        # Build inventory from items state (mirrors optimize_worker.py logic)
        items_state = {}
        quality_hierarchy = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']

        for export_name in character_config.get('owned_items', []):
            base_id = export_name
            quality = None
            for suffix in quality_suffixes:
                if export_name.endswith(suffix):
                    base_id = export_name[:-len(suffix)]
                    quality = suffix[1:]
                    break
            if quality:
                items_state[base_id] = {'has': True, 'quality': quality}
            else:
                items_state[base_id] = {'has': True}

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

        for item_id, state in items_state.items():
            if not state.get('has', False) or state.get('hide', False):
                continue
            ring1_quality = state.get('ring1_quality')
            quality = state.get('quality')
            if ring1_quality:
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
                suffix = quality_to_suffix.get(quality, '_common')
                export_name = f"{item_id}{suffix}"
                minimal_export['inventory'][export_name] = 1
            else:
                ring_quantity = state.get('ring_quantity', 1)
                minimal_export['inventory'][item_id] = ring_quantity

        character = Character(json.dumps(minimal_export))

        # Set global character for optimization scripts
        import my_config
        my_config._CHARACTER_INSTANCE = character

        # Resolve locked slots from ui_config
        import optimize_travel_gearsets
        locked_items = {}
        if ui_config.get('lock_current_gear_slots', False):
            locked_slots_data = ui_config.get('locked_slots_data', {})
            if locked_slots_data:
                from util.autogenerated.equipment import Item as EquipItem, CraftedItem
                quality_name_to_rarity = {
                    'Normal': 'common', 'Good': 'uncommon', 'Great': 'rare',
                    'Excellent': 'epic', 'Perfect': 'legendary', 'Eternal': 'ethereal',
                }
                quality_name_to_attr = {
                    'Normal': 'NORMAL', 'Good': 'GOOD', 'Great': 'GREAT',
                    'Excellent': 'EXCELLENT', 'Perfect': 'PERFECT', 'Eternal': 'ETERNAL',
                    'common': 'NORMAL', 'uncommon': 'GOOD', 'rare': 'GREAT',
                    'epic': 'EXCELLENT', 'legendary': 'PERFECT', 'ethereal': 'ETERNAL',
                }
                for slot_name, slot_info in locked_slots_data.items():
                    item_id = slot_info.get('itemId')
                    quality = slot_info.get('quality')
                    if not item_id:
                        continue
                    
                    # Handle consumable slot — look up from Consumable module
                    if slot_name == 'consumable':
                        from util.autogenerated.consumables import Consumable as ConsumableLookup
                        found_item = ConsumableLookup.by_export_name(item_id)
                        if not found_item:
                            for attr_name in dir(ConsumableLookup):
                                if attr_name.startswith('_'):
                                    continue
                                cons = getattr(ConsumableLookup, attr_name)
                                if hasattr(cons, 'name'):
                                    check_id = cons.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                                    if check_id == item_id:
                                        found_item = cons
                                        break
                        if not found_item and quality and quality.lower() == 'fine':
                            found_item = ConsumableLookup.by_export_name(item_id + '_fine')
                        if found_item:
                            locked_items[slot_name] = found_item
                            print(f"Travel locked slot {slot_name}: {found_item.name}")
                        else:
                            print(f"⚠ Could not resolve travel locked consumable {slot_name}: itemId={item_id}")
                        continue
                    
                    # Handle pet slot — look up from Pet module
                    if slot_name == 'pet':
                        from util.autogenerated.pets import Pet as PetLookup, PETS_BY_NAME
                        found_item = None
                        pet_enum_name = item_id.upper()
                        if hasattr(PetLookup, pet_enum_name):
                            found_item = getattr(PetLookup, pet_enum_name)
                        if not found_item:
                            for pet_name, pet_levels in PETS_BY_NAME.items():
                                check_id = pet_name.lower().replace(' ', '_').replace("'", '')
                                if check_id == item_id:
                                    found_item = pet_levels
                                    break
                        if found_item and hasattr(found_item, 'get_level'):
                            pet_level = None
                            if quality and quality.isdigit():
                                pet_level = int(quality)
                            level_from_info = slot_info.get('level')
                            if level_from_info is not None:
                                pet_level = int(level_from_info)
                            all_levels = found_item.get_all_levels()
                            if pet_level and found_item.get_level(pet_level):
                                found_item = found_item.get_level(pet_level)
                            elif all_levels:
                                found_item = all_levels[max(all_levels.keys())]
                        if found_item:
                            locked_items[slot_name] = found_item
                            print(f"Travel locked slot {slot_name}: {found_item.name}")
                        else:
                            print(f"⚠ Could not resolve travel locked pet {slot_name}: itemId={item_id}")
                        continue
                    
                    rarity = quality_name_to_rarity.get(quality, quality) if quality else None
                    found_item = EquipItem.by_uuid(item_id, quality=rarity)
                    
                    if not found_item:
                        for attr_name in dir(EquipItem):
                            if attr_name.startswith('_'):
                                continue
                            item = getattr(EquipItem, attr_name)
                            if hasattr(item, 'name'):
                                check_id = item.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                                if check_id == item_id:
                                    found_item = item
                                    break
                    
                    if found_item and isinstance(found_item, CraftedItem):
                        if quality:
                            quality_attr = quality_name_to_attr.get(quality)
                            if quality_attr and hasattr(found_item, quality_attr):
                                found_item = getattr(found_item, quality_attr)
                            else:
                                found_item = found_item.NORMAL
                        else:
                            found_item = found_item.NORMAL
                    
                    if found_item:
                        locked_items[slot_name] = found_item
                        print(f"Travel locked slot {slot_name}: {found_item.name}")
            if locked_items:
                print(f"Total travel locked slots: {len(locked_items)}")
        optimize_travel_gearsets.LOCKED_SLOTS = locked_items

        # Resolve the column-3 travel optimization priorities from ui_config.
        # Persisted by /api/optimization-settings as
        # ui_config['optimize_sorting_travel'] — a list of
        # [metric_key, weight, target] tuples (same shape the activity worker
        # accepts), e.g.:
        #   [["total_steps", 100, null],
        #    ["travel_steps_per_target", 100, "cat:if:bird_nest"],
        #    ["travel_steps_per_target", 50, "cat:chests"]]
        # Empty/absent → leave the module default (minimize Total Steps), so
        # existing users and callers that don't send sorting are unchanged.
        try:
            from util.walkscape_constants import Sorting as _Sorting, SortingEntry as _SortingEntry
            travel_sorting = ui_config.get('optimize_sorting_travel') or []
            if travel_sorting:
                _sorting_by_key = {s.metric_key: s for s in _Sorting}
                _priority = []
                _weights = {}
                for _entry in travel_sorting:
                    if isinstance(_entry, (list, tuple)) and len(_entry) >= 2:
                        _key = _entry[0]
                        _weight = int(_entry[1])
                        _target = _entry[2] if len(_entry) >= 3 else None
                    elif isinstance(_entry, str):
                        _key, _weight, _target = _entry, 100, None
                    else:
                        continue
                    _weight = max(0, min(100, _weight))
                    _sort = _sorting_by_key.get(_key)
                    if _sort is None:
                        continue
                    _priority.append(_SortingEntry(sort=_sort, target=_target, weight=_weight))
                    _weights.setdefault(_sort, _weight)
                if _priority:
                    optimize_travel_gearsets.SORTING_PRIORITY = _priority
                    optimize_travel_gearsets.SORTING_WEIGHTS = _weights
                    print(f"Travel SORTING_PRIORITY set from ui_config: {_priority}")
        except Exception as _sort_err:
            print(f"⚠ Failed to parse travel_sorting from ui_config: {_sort_err!r}")

        # Resolve the equipped pet + consumable as FIXED (always-on, never
        # optimized) travel items so the optimizer scores with their WE/DA
        # (e.g. Reindeer +4% agility, Bagel +5% WE). Sent by the frontend as
        # ui_config['fixed_pet_consumable'] = {pet:{species,level}, consumable:
        # {id,is_fine}} from the current gearset. Resolution mirrors the
        # Gearset._load_from_export path so optimizer scoring stays consistent
        # with the /api/travel/stats display.
        fixed_items = []
        try:
            fixed_spec = ui_config.get('fixed_pet_consumable') or {}
            pet_spec = fixed_spec.get('pet') or {}
            pet_species = str(pet_spec.get('species') or pet_spec.get('id') or '').strip()
            pet_level = int(pet_spec.get('level') or 0)
            if pet_species and pet_level > 0:
                from util.autogenerated.pets import PETS_BY_NAME, PETS_BY_RARE_EXPORT_NAME
                pet_levels = (PETS_BY_NAME.get(pet_species.capitalize())
                              or PETS_BY_RARE_EXPORT_NAME.get(pet_species.lower()))
                if pet_levels:
                    pet_info = pet_levels.get_level(pet_level)
                    if pet_info is not None:
                        fixed_items.append(pet_info)
                        print(f"Fixed travel pet: {pet_info.name} L{pet_level}")

            cons_spec = fixed_spec.get('consumable') or {}
            cons_id = str(cons_spec.get('id') or cons_spec.get('name') or '').strip()
            cons_fine = bool(cons_spec.get('is_fine'))
            if cons_id.lower().endswith('_fine'):
                cons_id = cons_id[:-5]
                cons_fine = True
            if cons_id:
                from util.autogenerated.consumables import Consumable as ConsumableLookup
                cons = None
                if cons_fine:
                    cons = (ConsumableLookup.by_export_name(cons_id + '_fine')
                            or ConsumableLookup.by_export_name(cons_id))
                else:
                    cons = ConsumableLookup.by_export_name(cons_id)
                if cons is not None:
                    fixed_items.append(cons)
                    print(f"Fixed travel consumable: {cons.name}")
        except Exception as _fix_e:
            print(f"⚠ Could not resolve fixed pet/consumable: {_fix_e!r}")

        # Optimize-among-owned: when the global "Include pets/consumables in
        # optimization" toggles are on, build candidate pools and DROP the
        # equipped pet/consumable from the FIXED set so the optimizer picks the
        # best owned one for the route instead of pinning the equipped one.
        # (Toggle OFF keeps the pre-existing behavior: equipped pet/consumable
        # stay FIXED and are scored but not changed.)
        include_pets = bool(ui_config.get('include_pets', False))
        include_consumables = bool(ui_config.get('include_consumables', False))
        pet_candidates = []
        cons_candidates = []
        try:
            if include_pets:
                from ui.optimize_worker import _build_pet_items_from_character_config
                pet_candidates = _build_pet_items_from_character_config(character_config, ui_config) or []
                # PetLevelInfo exposes .level; ConsumableItem does not — use it
                # to drop the equipped pet from FIXED without touching the food.
                fixed_items = [it for it in fixed_items if not hasattr(it, 'level')]
                print(f"Travel optimize pets ON: {len(pet_candidates)} owned candidates")
            if include_consumables:
                cons_candidates = [
                    it for it, qty in getattr(character, 'items', {}).items()
                    if qty and hasattr(it, 'duration')
                ]
                # ConsumableItem exposes .duration — drop the equipped food.
                fixed_items = [it for it in fixed_items if not hasattr(it, 'duration')]
                print(f"Travel optimize consumables ON: {len(cons_candidates)} owned candidates")
        except Exception as _pool_e:
            print(f"⚠ Failed to build travel pet/consumable pools: {_pool_e!r}")

        optimize_travel_gearsets.FIXED_TRAVEL_ITEMS = fixed_items
        optimize_travel_gearsets.OPTIMIZE_PET_CANDIDATES = pet_candidates
        optimize_travel_gearsets.OPTIMIZE_CONSUMABLE_CANDIDATES = cons_candidates

        # [TRAVEL-DIAG] Log resolved locked_items so we know which slots are
        # actually locked at optimizer-entry time. If primary is missing here
        # while the client log shows it was sent, the resolution loop above
        # failed to find the item by itemId+quality.
        try:
            print(
                f"[TRAVEL-DIAG][worker] LOCKED_SLOTS keys={list(locked_items.keys()) or '(none)'} "
                f"primary={getattr(locked_items.get('primary'), 'name', None) if locked_items.get('primary') else None}"
            )
        except Exception as _diag_e:
            print(f"[TRAVEL-DIAG][worker] locked_items diag log failed: {_diag_e!r}")

        # Dispatch to appropriate optimizer
        from optimize_travel_gearsets import optimize_single_region, optimize_multi_region

        # For flipped cross-region routes, override the route tuple direction
        from_location = request.get('from_location')
        to_location = request.get('to_location')

        if mode == 'single' or mode == 'advanced' or mode == 'requirements':
            result = optimize_single_region(
                region_id=region_id,
                route_ids=route_ids,
                character=character,
                ignored_items=set(),
                from_location=from_location,
                to_location=to_location,
            )

            # Compute owned-but-locked alternatives so the frontend can show
            # the "you own X but it's locked behind custom stats" warning.
            # Also compute non-owned alternatives when requested (e.g. from the
            # "Optimize Slot & Equip" popup flow) so the popup can surface
            # upgrade suggestions for travel just like it does for activities.
            if result.get('success') and result.get('gearset_export'):
                try:
                    from util.gearset_utils import Gearset
                    from ui.optimize_worker import compute_slot_alternatives
                    from optimize_travel_gearsets import _route_ids_to_tuples

                    all_slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                                 'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2',
                                 'tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5']

                    # Prefer the raw slot→Item dict that optimize_single_region
                    # now attaches. The Gearset(export_string) decode path was
                    # lossy in a way that silently replaced the optimized ring
                    # slots with the player's in-game equipped rings (Ring of
                    # pandemonium etc.), which then showed up as the "replaces"
                    # value on every alternative. Only fall back to the decode
                    # if the raw dict isn't present — which shouldn't happen
                    # any more but keeps this resilient to future callers.
                    if isinstance(result.get('gearset'), dict):
                        final_gearset = {slot: result['gearset'].get(slot) for slot in all_slots}
                        print("[travel-alts] Using raw gearset dict from optimize_single_region (no round-trip)")
                    else:
                        gs_obj = Gearset(result['gearset_export'])
                        final_gearset = {slot: getattr(gs_obj, slot, None) for slot in all_slots}
                        print("[travel-alts] WARNING: falling back to Gearset(export) decode — raw gearset dict missing")

                    # DIAG: confirm what compute_slot_alternatives will see. If
                    # this line ever prints ring1/ring2 as Ring of pandemonium
                    # while optimize_single_route's DIAG post-* lines show the
                    # optimizer picking something else, the round-trip decode
                    # has regressed again.
                    def _n(it):
                        try: return it.name
                        except Exception: return None
                    print(f"[travel-alts] DIAG final_gearset ring1={_n(final_gearset.get('ring1'))} ring2={_n(final_gearset.get('ring2'))}")

                    route_tuples = _route_ids_to_tuples(route_ids)

                    show_non_owned = bool(ui_config.get('show_non_owned_alternatives', False))
                    print("\nComputing alternatives for travel gearset (non_owned={}, locked=True)...".format(show_non_owned))
                    alts, locked_alts = compute_slot_alternatives(
                        final_gearset=final_gearset,
                        character=character,
                        opt_type='travel',
                        # Pass route_tuples via selected_location (travel doesn't use it)
                        selected_location=route_tuples,
                    )
                    if show_non_owned:
                        # Always set (even as empty dict) so the client can
                        # distinguish "alternatives computed but none found"
                        # from "alternatives never computed". Without this,
                        # the popup keeps showing "Optimize Slot & Equip"
                        # even after the optimizer ran and found zero results.
                        result['alternatives'] = alts if alts else {}
                        total_alts = sum(len(v) for v in (alts or {}).values())
                        print(f"Found {total_alts} non-owned alternatives across {len(alts or {})} slots")
                    if locked_alts:
                        result['locked_alternatives'] = locked_alts
                        total = sum(len(v) for v in locked_alts.values())
                        print(f"Found {total} locked alternatives across {len(locked_alts)} slots")
                        for slot, items in locked_alts.items():
                            for alt in items:
                                print(f"  [{slot}] {alt['name']} — is_custom_stats_locked={alt.get('is_custom_stats_locked')} custom_stats_needed={alt.get('custom_stats_needed')}")
                    else:
                        print("No locked alternatives found")
                except Exception as alt_err:
                    import traceback
                    print(f"⚠ Failed to compute travel alternatives: {alt_err}")
                    traceback.print_exc()
        elif mode in ('long_short', 'multi'):
            n = multi_count if multi_count and multi_count >= 2 else 2
            result = optimize_multi_region(
                region_id=region_id,
                route_ids=route_ids,
                n_gearsets=n,
                character=character,
                ignored_items=set(),
                per_route_cache=None,
            )
        else:
            result = {'success': False, 'error': f'Unknown mode: {mode}'}

        # Extract optimizer-chosen pet / consumable (Optimize-among-owned) so
        # the endpoint can persist them into the saved gearset's slots_json and
        # the frontend can equip them. encode_gearset does NOT carry pet /
        # consumable, so they travel as explicit result fields (mirrors the
        # activity optimizer's result['pet'] / result['consumable']).
        #
        # IMPORTANT: this block runs BEFORE the stdout restore so its diagnostic
        # prints go to stderr. On the local (Pyodide) path the driver captures
        # everything printed to the restored stdout as the result JSON, so a
        # stray print here would corrupt it ("JSON parse error: Expecting value:
        # line 1 column 2 (char 1)" — bug df8947bf).
        if isinstance(result, dict) and isinstance(result.get('gearset'), dict):
            _chosen_pet = result['gearset'].get('pet')
            if _chosen_pet is not None:
                try:
                    _sp = getattr(_chosen_pet, 'name', '') or ''
                    _pet_id = _sp.lower().replace(' ', '_').replace("'", '')
                    result['pet'] = {
                        'name': _sp,
                        'species': _sp,
                        'itemId': _pet_id,
                        'id': _pet_id,
                        'level': getattr(_chosen_pet, 'level', None),
                        'variant': 'normal',
                    }
                    print(f"[travel] chosen pet -> {result['pet']}")
                except Exception as _pe:
                    print(f"⚠ Could not serialize chosen pet: {_pe!r}")
            _chosen_cons = result['gearset'].get('consumable')
            if _chosen_cons is not None:
                try:
                    _cn = getattr(_chosen_cons, 'name', '') or ''
                    # ConsumableItem carries no id/export_name/is_fine, but its
                    # enum attr name IS the canonical export id (e.g. BEER /
                    # BEER_FINE). Reverse-map it so we emit itemId='beer' +
                    # is_fine=true rather than deriving a bad id from the display
                    # name ('Beer (Fine)' -> 'beer_(fine)', which won't resolve).
                    _cons_attr = None
                    try:
                        from util.autogenerated.consumables import Consumable as _ConLookup
                        for _a in dir(_ConLookup):
                            if _a.startswith('_'):
                                continue
                            if getattr(_ConLookup, _a, None) is _chosen_cons:
                                _cons_attr = _a
                                break
                    except Exception:
                        _cons_attr = None
                    if _cons_attr:
                        _is_fine = _cons_attr.upper().endswith('_FINE')
                        _cons_id = (_cons_attr[:-5] if _is_fine else _cons_attr).lower()
                    else:
                        # Fallback: derive from the display name.
                        _is_fine = _cn.strip().endswith('(Fine)')
                        _base = _cn.replace(' (Fine)', '').strip()
                        _cons_id = _base.lower().replace(' ', '_').replace("'", '')
                    result['consumable'] = {
                        'name': _cn,
                        'itemId': _cons_id,
                        'id': _cons_id,
                        'is_fine': _is_fine,
                    }
                    print(f"[travel] chosen consumable -> {result['consumable']}")
                except Exception as _ce:
                    print(f"⚠ Could not serialize chosen consumable: {_ce!r}")

        sys.stdout = old_stdout
        # Strip non-JSON-serializable 'gearset' (raw Item objects) before
        # emitting the response. It's only used internally by the alternatives
        # computation above; the client consumes gearset_export / items.
        if isinstance(result, dict) and 'gearset' in result:
            result.pop('gearset', None)
        print(json.dumps(result))

    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.stdout = old_stdout
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
