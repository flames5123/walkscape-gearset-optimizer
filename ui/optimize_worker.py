#!/usr/bin/env python3
"""
Optimization worker script.

Runs optimization by calling the EXACT functions from optimize_activity_gearsets.py
and optimize_craft_gearsets.py with their full configuration.
"""

import sys
import json
import math
import os
import re
from time import sleep

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ============================================================================
# PRIORITY ENTRY TARGET RESOLUTION
# ============================================================================
#
# The UI sends category targets like 'cat:chests' or 'cat:collectibles'.
# These are logical categories that need to be resolved against a specific
# activity's drop table to pick the right chest/collectible/gem to score
# against. Without this resolution, the scorer falls back to a generic
# synthetic rate (e.g. 0.4% for any "primary chest") that may not match
# the activity's actual drop rate, causing incorrect optimization.
# ============================================================================

def _resolve_pet_variant_from_request(request, pet_name: str) -> str:
    """
    Resolve the user's preferred variant ('normal'/'light'/'dark'/'rare')
    for a given pet so that optimizer results don't clobber the user's
    chosen skin. Order of preference:
      1. request.currentGear.pet.variant (what is currently equipped)
      2. request.gearset2.pet.variant (comparison slot)
      3. ui_config.user_overrides.items[<pet_id>].variant
      4. character_config.pets[*].variant for matching species
      5. 'normal' as a last resort.
    """
    if not pet_name:
        return 'normal'
    pet_name_lower = pet_name.lower()
    ui_config = request.get('ui_config') or {}

    # 1 + 2: walk the two gearset slots
    for gearset_key in ('currentGear', 'gearset2'):
        gs = ui_config.get(gearset_key) or request.get(gearset_key) or {}
        pet = gs.get('pet') if isinstance(gs, dict) else None
        if isinstance(pet, dict):
            pet_match_name = (pet.get('name') or '').lower()
            pet_match_id = (pet.get('itemId') or pet.get('id') or '').lower()
            if pet_match_name == pet_name_lower or pet_match_id == pet_name_lower:
                variant = pet.get('variant')
                if variant:
                    return variant

    # 3: user_overrides by pet id (lowercase pet name)
    user_overrides = (ui_config.get('user_overrides') or {}).get('items') or {}
    for key, val in user_overrides.items():
        if not isinstance(val, dict):
            continue
        if str(key).lower() == pet_name_lower:
            variant = val.get('variant')
            if variant:
                return variant

    # 4: character export pets by species
    character_config = request.get('character_config') or {}
    pets = character_config.get('pets') or []
    if isinstance(pets, list):
        for p in pets:
            if not isinstance(p, dict):
                continue
            species = (p.get('species') or '').lower()
            if species == pet_name_lower:
                variant = p.get('variant')
                if variant:
                    return variant

    return 'normal'


def _resolve_category_target_for_activity(target, activity):
    """Resolve a UI category target (e.g. 'cat:chests') to a concrete
    scoring target for the given activity.
    
    Returns the resolved string:
      - 'cat:normal_items' → None (signals "no specific target")
      - 'cat:chests'       → first chest item name in the drop table,
                             or 'primary_chest' synthetic fallback
      - 'cat:collectibles' → first collectible name in the drop table,
                             or 'collectible' synthetic fallback
      - 'cat:fine'         → 'fine_item' synthetic
      - 'cat:gems'         → first gem material name in the drop table,
                             or None (raw rewards) if no gems drop
      - 'cat:gems_fine'    → 'fine_item' synthetic
      - 'cat:if:*'         → None (raw rewards) or 'fine_item' if _fine suffix
    
    Non-category targets (item names, synthetic names like 'primary_chest')
    pass through unchanged. None passes through as None.
    """
    if not target or not isinstance(target, str) or not target.startswith('cat:'):
        return target
    
    if target == 'cat:normal_items':
        return 'raw_rewards'
    
    if target == 'cat:chests':
        all_drops = list(activity.drop_table) + list(activity.secondary_drop_table)
        for drop in all_drops:
            if drop.item_ref and drop.item_ref.startswith('Container.') and drop.item_name != 'Nothing':
                return drop.item_name
        return 'primary_chest'
    
    if target == 'cat:collectibles':
        all_drops = list(activity.drop_table) + list(activity.secondary_drop_table)
        for drop in all_drops:
            if drop.item_ref and drop.item_ref.startswith('Collectible.') and drop.item_name != 'Nothing':
                return drop.item_name
        return 'collectible'
    
    if target == 'cat:fine':
        return 'fine_item'
    
    if target == 'cat:gems':
        gem_refs = {'Material.ROUGH_OPAL', 'Material.ROUGH_STAR_PEARL', 'Material.ROUGH_TOPAZ',
                    'Material.ROUGH_WRENTMARINE', 'Material.ROUGH_JADE', 'Material.ROUGH_RUBY',
                    'Material.ROUGH_SUN_STONE', 'Material.ROUGH_ETHERNITE'}
        all_drops = list(activity.drop_table) + list(activity.secondary_drop_table)
        for drop in all_drops:
            if drop.item_ref and drop.item_ref in gem_refs and drop.item_name != 'Nothing':
                return drop.item_name
        return None  # No gems — fall back to raw rewards
    
    if target == 'cat:gems_fine':
        return 'fine_item'

    # Sea Shells aggregator. Replaces the old per-item lookup +
    # fine-fold multiplier with a single synthetic 'cat:sea_shells'
    # key injected into drop_rates by
    # util.shell_value.compute_shell_targets_for_activity. The synthetic
    # rolls up direct sea shell drops (incl. IF expansion via flatpack
    # shark / shell snatcher), fine sea shells (10x), and shell-bearing
    # chests (Coral chest, Sunken chest, Chest of Syrenthia).
    #
    # Always resolves to the synthetic key — the aggregator returns
    # float('inf') when no shell sources exist (no native drops, no IF
    # expansion), which the scorer treats as the "no target" sentinel.
    # Activities like flatpack shark fishing where shells only appear
    # via IF expansion still work because IF-expanded drops feed into
    # drop_rates['Sea shell'] via Activity.get_expected_drop_rate.
    if target == 'cat:sea_shells':
        return 'cat:sea_shells'

    # cat:sea_shells_fine REMOVED (2026-05-31): fine sea shells are now
    # automatically folded into cat:sea_shells via the shell aggregator.
    # Saved settings carrying this target are migrated to cat:sea_shells
    # by ui/optimization_settings_migration.py.

    # Coin and shell aggregate targets — the scorer recognises them
    # via util.coin_value / util.shell_value and injects synthetic
    # entries into drop_rates.
    if target in ('cat:coins', 'cat:coins_no_chests', 'cat:sea_shells'):
        return target

    if target.startswith('cat:if:'):
        # Single-item IF categories whose item is also droppable directly
        # from an activity's drop_table. When the activity drops the item
        # directly, route the scorer to the item name so it reads the
        # combined drop rate from drop_rates (regular drop_table chance +
        # IF expansion contribution, harmonic-mean combined inside
        # get_expected_drop_rate). Without this redirect, the scorer's
        # cat:if:* branch reads only the ItemFindingCategory.* stat and
        # ignores any direct drop of the same item — so e.g. wreck diving
        # (44.94% Sea shell drop) optimized for cat:if:sea_shells used
        # only the IF rate (~100 steps/shell) and missed the much faster
        # combined path.
        #
        # For activities that DON'T drop the item directly, drop_rates
        # still holds the IF-expansion-only rate (because get_expected_drop_rate
        # processes equipment_drops driven by ItemFindingCategory.* gear
        # stats), so behaviour matches the original IF-only path.
        #
        # Multi-item IF categories (random_gem, crustacean, fibrous_plant,
        # fishing_bait, random_piece_of_junk, skill_chest) and fine
        # variants are NOT redirected — the IF stat formula is the
        # correct semantic for those.
        # NOTE: 'cat:if:adventurers_guild_tokens' is intentionally NOT in this
        # map. AGT is a value currency (tokens come from selling the activity's
        # drops, fine variants worth more) — it is scored as a value aggregate
        # by util.ag_token_value.compute_agt_targets_for_activity, keyed under
        # the raw 'cat:if:adventurers_guild_tokens' string. Redirecting it to
        # the single "Adventurers' guild token" drop name would score only that
        # one drop's rate and ignore the special_sell value (and FMF-boosted
        # fine value) of every other drop — the exact bug this fix addresses.
        _SINGLE_ITEM_IF_TO_DROP_NAME = {
            'cat:if:bird_nest':                'Bird nest',
            'cat:if:ectoplasm':                'Ectoplasm',
            'cat:if:gold_nugget':              'Gold nugget',
            'cat:if:sea_shells':               'Sea shell',
        }
        item_name = _SINGLE_ITEM_IF_TO_DROP_NAME.get(target)
        if item_name is not None:
            all_drops = list(activity.drop_table) + list(activity.secondary_drop_table)
            for drop in all_drops:
                if drop.item_name == item_name and drop.item_name != 'Nothing':
                    return item_name
            # Item not in regular drop_table — fall through to IF-only
            # scoring below.
        # Keep the raw 'cat:if:<snake>' string so the scorer's
        # _compute_spr_for_target can read the corresponding
        # ItemFindingCategory.<CAT> stat from total_stats directly.
        # Previously we collapsed non-fine IF categories to None and
        # fine variants to 'fine_item', which lost all information about
        # which IF category the user actually selected — producing a
        # gearset with 0% of the requested category's drop stat.
        return target
    
    # Unknown category
    return None


def _resolve_entry_target_for_activity(entry, activity):
    """Return a new SortingEntry whose target has been resolved against
    the activity's drop table. Leaves non-category targets untouched.
    
    This is only meaningful for duplicable metrics that carry a target
    (currently just steps_per_reward_roll). Other entries pass through
    unchanged.
    """
    from util.walkscape_constants import SortingEntry
    import dataclasses
    
    if not entry.target or not entry.target.startswith('cat:'):
        return entry
    
    resolved = _resolve_category_target_for_activity(entry.target, activity)
    if resolved == entry.target:
        return entry
    return dataclasses.replace(entry, target=resolved)


def _resolve_input_items_for_activity(input_items_raw, activity, use_fine_inputs):
    """Resolve UI input_items_raw into a concrete Item/Material instance.
    
    Mirrors the resolution logic used by the standard activity optimization
    path so the crafting-tree-node activity path can use the same helper.
    
    Args:
        input_items_raw: dict from request — {idx_str: {name, id?, export_name?}, ...}.
            Keys are stringified indices (from JSON round-trip). Values are the
            UI's selected input item (or auto-picked default).
        activity: ActivityInfo. Skipped if the activity has no input_items
            requirement.
        use_fine_inputs: bool — when True, prefer the "<name> (Fine)" variant
            if the catalog has one.
    
    Returns: resolved Item/Material instance, or None if nothing resolved.
    """
    if not input_items_raw or not activity:
        return None
    if not getattr(activity, 'input_items', None):
        return None
    from util.autogenerated.equipment import Item
    from util.autogenerated.materials import Material
    
    resolved_input_item = None
    for _idx, item_info in input_items_raw.items():
        if not item_info:
            continue
        item_name = item_info.get('name')
        item_id = item_info.get('id') or item_info.get('itemId')
        export_name = item_info.get('export_name') or item_info.get('exportName')
        
        if export_name:
            found = Item.by_export_name(export_name)
            if not found and hasattr(Material, 'by_export_name'):
                found = Material.by_export_name(export_name)
            if found:
                resolved_input_item = found
                break
        if item_id and not resolved_input_item:
            found = Item.by_uuid(item_id)
            if found:
                resolved_input_item = found
                break
        if item_name and not resolved_input_item:
            for attr_name in dir(Item):
                if attr_name.startswith('_'):
                    continue
                it = getattr(Item, attr_name)
                if hasattr(it, 'name') and it.name == item_name:
                    resolved_input_item = it
                    break
            if not resolved_input_item:
                for attr_name in dir(Material):
                    if attr_name.startswith('_'):
                        continue
                    mat = getattr(Material, attr_name)
                    if hasattr(mat, 'name') and mat.name == item_name:
                        resolved_input_item = mat
                        break
        if resolved_input_item:
            break
    
    # Fine variant lookup: if the user opted for fine inputs, prefer the
    # "<name> (Fine)" entry from the same catalog the resolved item came from.
    if resolved_input_item and use_fine_inputs:
        fine_name = resolved_input_item.name + ' (Fine)'
        fine_found = None
        for attr_name in dir(Item):
            if attr_name.startswith('_'):
                continue
            it = getattr(Item, attr_name)
            if hasattr(it, 'name') and it.name == fine_name:
                fine_found = it
                break
        if not fine_found:
            for attr_name in dir(Material):
                if attr_name.startswith('_'):
                    continue
                mat = getattr(Material, attr_name)
                if hasattr(mat, 'name') and mat.name == fine_name:
                    fine_found = mat
                    break
        if fine_found:
            resolved_input_item = fine_found
    
    return resolved_input_item


def _extract_pet_consumable_meta(gearset_dict, request):
    """Pull the optimizer's chosen pet + consumable out of a gearset dict.

    encode_gearset() can only serialize gear/tool/ring slots — `Gearset`
    has no `_pet` or `_consumable` attribute. Without persisting these
    separately on the result, the worker's choice is silently dropped
    when the frontend re-decodes the export string later (bug d3ce19e5
    "no pets and consumables. Please fix").

    Returns: (selected_pet_meta, selected_consumable_meta) — either dict
    or None. The dict shape matches what app.py persists onto the node
    so _decode_gearset_stats can re-apply them via the same overlay
    path locked_slots uses.
    """
    selected_pet = None
    selected_consumable = None
    if not isinstance(gearset_dict, dict):
        return None, None
    pet_obj = gearset_dict.get('pet')
    if pet_obj is not None:
        try:
            selected_pet = {
                'name': getattr(pet_obj, 'name', '') or '',
                'level': int(getattr(pet_obj, 'level', 1) or 1),
                'variant': _resolve_pet_variant_from_request(
                    request, getattr(pet_obj, 'name', '') or ''
                ),
                # Pets are rarity=common in the catalog; surface it on
                # the meta so the gear-slot-grid can apply the
                # .rarity-common class (drives slot border + background).
                # Bug b788d037: pet slot had no styling because rarity
                # wasn't carried.
                'rarity': 'common',
                'type': 'pet',
            }
        except Exception:
            selected_pet = None
    cons_obj = gearset_dict.get('consumable')
    if cons_obj is not None:
        try:
            cons_name = getattr(cons_obj, 'name', '') or ''
            # Detect the Fine variant by suffix. Both "Sweet carrot pie"
            # and "Sweet carrot pie (Fine)" share the same catalog entry
            # in /api/catalog (consumables.py builds one row per BASE
            # name with a `has_fine` flag), so the itemId must use the
            # base name — otherwise the frontend's catalog lookup
            # (`it.id === itemId`) misses on Fine variants and falls
            # back to an empty icon_path. That's why bug 3bb938f4
            # follow-up reported "no img" for Fine consumables.
            is_fine = cons_name.endswith('(Fine)') or cons_name.endswith(' (Fine)')
            base_name = cons_name.replace(' (Fine)', '').replace('(Fine)', '').strip()
            # Match ui/catalog.ItemCatalog._name_to_id exactly so the
            # frontend's `catalogItems.find(it => it.id === itemId)`
            # resolves. ItemCatalog strips parens, dashes, apostrophes
            # and lowercases. Without the strip, Fine variants emitted
            # itemId="sweet_carrot_pie_(fine)" which never matched the
            # catalog id "sweet_carrot_pie".
            cons_export = (
                base_name.lower()
                .replace(' ', '_')
                .replace('(', '')
                .replace(')', '')
                .replace('-', '_')
                .replace("'", '')
            )
            # Provide icon_path directly so the tree-node tile renders
            # even when the catalog cache is empty / not yet loaded.
            # Mirrors ui.catalog.get_icon_path('consumable') so the
            # path is "/assets/icons/items/consumables/<base>.svg".
            cons_icon = (
                '/assets/icons/items/consumables/'
                f"{base_name.replace(' ', '_').lower()}.svg"
            )
            selected_consumable = {
                'name': cons_name,        # display name (may include "(Fine)")
                'itemId': cons_export,    # catalog id (Fine-stripped)
                'id': getattr(cons_obj, 'id', None),
                'is_fine': is_fine,       # drives the fine outline in the tile
                'icon_path': cons_icon,   # fallback when catalog lookup misses
                'type': 'consumable',
                # rarity drives the .gear-slot.rarity-* class which sets
                # the slot's background + border. Bug b788d037: without
                # this the catalog's base 'common' rarity rode through
                # for Fine variants — slot rendered with no fine outline
                # / fine background.
                'rarity': 'fine' if is_fine else 'common',
            }
        except Exception:
            selected_consumable = None
    return selected_pet, selected_consumable


def _species_to_pet_id(species: str) -> str:
    """Convert a pet species name to the lowercase item-id used in
    ui_config.items / user_overrides keys.

    Mirrors state.js line ~451:
        species.toLowerCase().replace(/ /g, '_').replace(/[()'-]/g, '')
    """
    if not species:
        return ''
    out = species.lower().replace(' ', '_')
    for ch in "()'-":
        out = out.replace(ch, '')
    return out


def _get_hidden_pet_ids(ui_config):
    """Return the set of pet ids (lowercase species, snake-case) the user
    has flagged as hidden via the column-1 eye icon / hide checkbox.

    Pets are not in `character.items`, so the existing `hidden_items` set
    (built around line 1891) never covers them. This helper is used by
    every pet-collection site so that hidden pets (e.g. Tortoise) never
    enter PET_ITEMS for the optimizer.
    """
    if not ui_config:
        return set()
    ui_items = ui_config.get('items', {}) or {}
    user_override_items = (ui_config.get('user_overrides') or {}).get('items') or {}
    hidden = set()
    for source in (ui_items, user_override_items):
        for item_id, state in source.items():
            if isinstance(state, dict) and state.get('hide'):
                hidden.add(item_id)
    return hidden


def build_hidden_items_set(ui_config):
    """Return the set of Item / Material / Consumable objects the user has
    flagged as hidden via the column-1 eye icon / hide checkbox.

    Single source of truth for the optimizer's IGNORED_ITEMS. Used by:
      - the column-2/3 optimizer (run_optimization_background)
      - the goals report worker (stats_report_worker.run_optimizer_for_job /
        run_recipe_optimizer_for_job)
      - the goals report non-owned/locked upgrades panel
        (app.stats_report_slot_alternatives)

    Pets are NOT covered here (they aren't in the Item/Material/Consumable
    catalogs) — use `_get_hidden_pet_ids` for those. `hide_fine` is honored
    by also hiding the matching `*_FINE` consumable variant.
    """
    hidden_items = set()
    if not ui_config:
        return hidden_items

    from util.autogenerated.equipment import Item
    from util.autogenerated.materials import Material
    from util.autogenerated.consumables import Consumable

    ui_items = ui_config.get('items', {}) or {}
    user_override_items = (ui_config.get('user_overrides') or {}).get('items') or {}
    all_ui_items = {**ui_items, **user_override_items}

    def _check_id(name):
        return (name.lower().replace(' ', '_').replace('(', '').replace(')', '')
                .replace('-', '_').replace("'", ''))

    for item_id, item_state in all_ui_items.items():
        if not isinstance(item_state, dict) or not item_state.get('hide'):
            continue
        # A single item_id can match across catalogs; mirror the original
        # behavior of checking Item, Material and Consumable independently.
        for catalog in (Item, Material, Consumable):
            for attr_name in dir(catalog):
                if attr_name.startswith('_'):
                    continue
                obj = getattr(catalog, attr_name)
                if hasattr(obj, 'name') and _check_id(obj.name) == item_id:
                    hidden_items.add(obj)
                    break

    # hide_fine -> also hide the fine consumable variant
    for item_id, item_state in all_ui_items.items():
        if isinstance(item_state, dict) and item_state.get('hide_fine'):
            fine_enum_name = item_id.upper() + '_FINE'
            if hasattr(Consumable, fine_enum_name):
                hidden_items.add(getattr(Consumable, fine_enum_name))

    return hidden_items


def _build_pet_items_from_character_config(character_config, ui_config):
    """Build the PET_ITEMS list the same way the column-2 path does.

    Pets aren't stored in character.items (the gear/tools/rings dict);
    they live in character_config.pets[*] with species + level, plus
    any user_overrides[species] = {has, level} the user manually set
    via the Column 1 pet-level dropdown. Without this helper, the
    tree-node path was setting PET_ITEMS from `character.items` filtered
    by slot=='pet' — which returns the empty list because pets don't
    populate that dict.

    Mirrors the logic at optimize_worker.py around line 2080 (the
    column-2 `include_pets` branch). Returns a list of PetLevelInfo
    instances ready to be passed to optimize_activity_gearsets.PET_ITEMS.
    """
    from util.autogenerated.pets import PETS_BY_NAME
    pet_items = []
    seen_species = set()
    hidden_pet_ids = _get_hidden_pet_ids(ui_config)
    pets_data = (character_config or {}).get('pets', []) or []
    if isinstance(pets_data, list):
        for pet_data in pets_data:
            if not isinstance(pet_data, dict):
                continue
            species = (pet_data.get('species') or '').capitalize()
            level = int(pet_data.get('level') or 0)
            if level <= 0:
                continue
            # Skip pets the user has hidden via the column-1 eye icon.
            if _species_to_pet_id(species) in hidden_pet_ids:
                continue
            pet_levels = PETS_BY_NAME.get(species)
            if not pet_levels:
                continue
            pet_info = pet_levels.get_level(level)
            if pet_info:
                key = (species, level)
                if key in seen_species:
                    continue
                seen_species.add(key)
                pet_items.append(pet_info)
    # user_overrides — pets the user manually flagged as owned via the
    # column-1 dropdown but that aren't in their game export yet.
    override_items = ((ui_config or {}).get('user_overrides') or {}).get('items') or {}
    for override_id, override_state in override_items.items():
        if not isinstance(override_state, dict):
            continue
        if not override_state.get('has'):
            continue
        level = int(override_state.get('level') or 0)
        if level <= 0:
            continue
        # Skip pets the user has hidden — override_id is already the snake_case id.
        if override_id in hidden_pet_ids:
            continue
        species = str(override_id).capitalize()
        pet_levels = PETS_BY_NAME.get(species)
        if not pet_levels:
            continue
        key = (species, level)
        if key in seen_species:
            continue
        pet_info = pet_levels.get_level(level)
        if pet_info:
            seen_species.add(key)
            pet_items.append(pet_info)
    return pet_items


# Skill groups used by stat scoping. Keys are group names; values are the
# specific skills that belong to the group. Mirrors `SKILL_GROUPS` in
# ui/static/js/components/item-selection-popup.js — keep these in sync.
_SKILL_GROUPS = {
    'gathering': frozenset({'fishing', 'foraging', 'hunting', 'mining', 'woodcutting'}),
    'artisan': frozenset({'carpentry', 'cooking', 'crafting', 'smithing', 'tailoring', 'trinketry'}),
    'utility': frozenset({'agility', 'traveling'}),
}

# Universal "find" stats. When scoped to 'global' on a pet, these genuinely
# apply to ANY activity (or chest recipe) producing the corresponding drop,
# regardless of the pet's skill specialization — the ONE exception to the pet
# global-scope exclusion the Tortoise fix (bug 9ce474f8) introduced. A pet whose
# only relevant stat is a global find_collectibles (e.g. the Level 4 Mummy,
# Tailoring-specialized but with a global +5% find_collectibles) IS applicable
# to collectibles activities. Bug dd01d8e6. Mirrors GLOBAL_FIND_STATS in
# ui/static/js/components/item-selection-popup.js — keep in sync.
_GLOBAL_FIND_STATS = frozenset({
    'find_collectibles', 'find_gems', 'find_bird_nests', 'find_bird_nest',
    'fine_material_finding', 'chest_finding',
})
# Of the find stats, these apply to activities only (never recipes) — dropped
# from the allowance for recipe contexts. Mirrors ACTIVITY_ONLY_STATS in the JS.
_ACTIVITY_ONLY_FIND_STATS = frozenset({
    'find_collectibles', 'find_gems', 'find_bird_nests', 'find_bird_nest',
    'fine_material_finding',
})


def _stats_have_global_find_stat(stats, allowed) -> bool:
    """True if the nested stat tree has a find stat (in ``allowed``) scoped to
    the 'global' skill. Structure: {skill: {location: {stat: value}}}."""
    glob = stats.get('global')
    if not isinstance(glob, dict):
        return False
    for by_loc in glob.values():
        if isinstance(by_loc, dict):
            for stat_name in by_loc:
                if stat_name in allowed:
                    return True
    return False


def _stat_skill_matches_target(stat_skill: str, target_skill: str, allow_global: bool) -> bool:
    """True if a stat scoped to ``stat_skill`` applies to a node with primary
    skill ``target_skill``.

    A stat scoped to:
      * 'global'     → applies if ``allow_global`` is True (always for consumables,
                       never for pets — see ``_filter_pet_consumable_candidates_by_skill``).
      * the target   → matches.
      * a group name → matches if the target is a member of that group
                       (e.g. stat_skill='artisan' matches target='crafting').

    Stats scoped to an UNRELATED specific skill do NOT match — that's the
    Tortoise-on-Crafting case (Tortoise has 'smithing'-scoped stats; smithing
    is in the artisan group, but a stat scoped to the *specific* skill 'smithing'
    only applies when the node IS smithing, not for sibling crafting/cooking).
    """
    s = (stat_skill or '').lower()
    t = (target_skill or '').lower()
    if not t:
        # No target → can't narrow, accept everything.
        return True
    if s == 'global':
        return allow_global
    if s == t:
        return True
    members = _SKILL_GROUPS.get(s)
    if members and t in members:
        return True
    return False


def _filter_pet_consumable_candidates_by_skill(items, target_skill, *, item_kind: str, is_recipe: bool = False):
    """Filter a pet-or-consumable candidate pool to those skill-relevant for the
    given target skill (e.g. the recipe's skill or the activity's primary skill).

    item_kind controls the strictness:

    * 'consumable' → keep items that have ANY stat scoped to the target skill,
      a group containing it, OR 'global'. Most consumables (Beer, Wine,
      Roasted bell pepper, etc.) are global-scoped and ARE broadly applicable
      across skills, so we keep the global-scoped path.

    * 'pet' → keep items only if they have at least one stat scoped to the
      target skill or a group containing it. Pets that are skill-specialized
      to a *different* skill but happen to also carry a tiny global stat
      (e.g. Tortoise — smithing-focused, with a global +inventory_space) are
      excluded. This is the bug 9ce474f8 fix: without this, the tree-node
      auto-optimizer picked Tortoise on Crafting / Cooking nodes because its
      global inventory_space stat technically registered as "applicable" and
      the optimizer's tiebreaker preferred any pet over no pet.

      EXCEPTION (bug dd01d8e6): a global-scoped universal "find" stat
      (find_collectibles, find_gems, chest_finding, bird nests, fine material
      finding) DOES make a pet applicable, because those stats apply to any
      activity / chest recipe producing that drop regardless of skill. So the
      Level 4 Mummy (Tailoring-specialized + global find_collectibles) is kept
      for collectibles activities. ``is_recipe`` drops the activity-only find
      stats so e.g. find_collectibles doesn't pollute recipe candidate pools.

    A None or empty target_skill returns the input unchanged (no filtering).
    Items without a ``_stats`` attribute are kept as-is (defensive — should
    not happen for real pet/consumable instances).
    """
    if not target_skill or not items:
        return list(items) if items else []
    allow_global = (item_kind == 'consumable')
    target = target_skill.lower()
    # Pets: a global-scoped universal "find" stat (find_collectibles, etc.) makes
    # the pet applicable to any activity / chest recipe producing that drop, even
    # though global utility stats (inventory_space) stay excluded. Bug dd01d8e6
    # (Level 4 Mummy). Activity-only find stats are dropped for recipe contexts.
    relevant_global_find = _GLOBAL_FIND_STATS
    if is_recipe:
        relevant_global_find = _GLOBAL_FIND_STATS - _ACTIVITY_ONLY_FIND_STATS
    filtered = []
    for it in items:
        stats = getattr(it, '_stats', None)
        if not stats:
            # Defensive: keep items we can't introspect.
            filtered.append(it)
            continue
        matched = any(
            _stat_skill_matches_target(skill, target, allow_global=allow_global)
            for skill in stats.keys()
        )
        if (not matched and item_kind == 'pet'
                and _stats_have_global_find_stat(stats, relevant_global_find)):
            matched = True
        if matched:
            filtered.append(it)
    return filtered


def _select_best_service_for_recipe(recipe, character):
    """Pick the best valid+unlocked service for `recipe`, or None.

    Worker-side mirror of crafting_tree._resolve_best_service_for_recipe
    (the display's single source of truth): among services that are valid
    for the recipe and unlocked for the character, choose the one with the
    highest service work_efficiency for the recipe's skill, tie-broken by
    total (abs) stat magnitude.

    Bug fix (report df39440d, follow-up to 613a1e83): the worker previously
    grabbed the FIRST valid+unlocked service in SERVICES_BY_NAME order and
    scoped the whole gear optimization to THAT service's location — while
    the service-stat row displayed the BEST-by-WE service. For "cut willow
    logs into planks", the first valid sawmill is Basic Sawmill (Everhaven,
    'gdte' region) but the best-by-WE sawmill is Sawmill of Barbantok
    (Barbantok, 'jarvonia'). That mismatch let the optimizer credit
    gdte-scoped tools (Seth's swamp compass, Makeup set) at Everhaven and
    then label the node Barbantok — where those items contribute zero.
    Selecting the service the same way the display does treats the service
    like a jointly-resolved slot and keeps gear scoped to the location the
    node actually reports. See crafting_tree._resolve_best_service_for_recipe
    for the elderhide/Spectral-needle sibling of this bug.
    """
    from util.autogenerated.services import SERVICES_BY_NAME

    skill = (getattr(recipe, 'skill', None) or 'crafting').lower()
    best_svc = None
    best_we = -float('inf')
    best_total = -float('inf')
    for svc in SERVICES_BY_NAME.values():
        if not (svc.is_valid_for_recipe(recipe) and svc.is_unlocked(character)):
            continue
        try:
            svc_stats = svc.get_stats_for_skill(
                skill, location=getattr(svc, 'location', None), character=character,
            )
        except Exception:
            svc_stats = {}
        svc_we = svc_stats.get('work_efficiency', 0.0) or 0.0
        total = sum(abs(v) for v in svc_stats.values() if isinstance(v, (int, float)))
        # Highest WE wins; ties broken by total stat magnitude. Mirrors
        # crafting_tree._resolve_best_service_for_recipe exactly so the
        # worker's gear-scope location always equals the displayed service.
        if svc_we > best_we or (svc_we == best_we and total > best_total):
            best_we = svc_we
            best_total = total
            best_svc = svc
    return best_svc


def _candidate_services_for_recipe(recipe, character):
    """Return the distinct valid+unlocked services worth optimizing for `recipe`.

    Dedupes services that would produce an identical result: gear stats key on
    region, and a service also contributes its OWN stats (WE/DR/NMC/DA/QO...),
    so two services collapse only when BOTH their location-region signature AND
    their per-skill service-stat signature match. This is the "…or region if
    the services are identical in that region" collapse — e.g. two plain Basic
    Sawmills in the same region are optimized once, but a Basic vs an Advanced
    sawmill in the same region (different service stats) are both kept.
    """
    from util.autogenerated.services import SERVICES_BY_NAME

    skill = (getattr(recipe, 'skill', None) or 'crafting').lower()
    seen = set()
    candidates = []
    for svc in SERVICES_BY_NAME.values():
        if not (svc.is_valid_for_recipe(recipe) and svc.is_unlocked(character)):
            continue
        loc = getattr(svc, 'location', None)
        regions = tuple(sorted(getattr(loc, 'regions', []) or []))
        try:
            svc_stats = svc.get_stats_for_skill(skill, location=loc, character=character)
        except Exception:
            svc_stats = {}
        stat_sig = frozenset(
            (k, round(v, 6)) for k, v in (svc_stats or {}).items()
            if isinstance(v, (int, float))
        )
        key = (regions, stat_sig)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(svc)
    return candidates


def _optimize_best_service_over_candidates(recipe, character, child_input_specs):
    """Joint-optimize a full gearset for each candidate service and return the best.

    This treats the service like a gear slot: rather than pre-selecting one
    service by a single stat (work_efficiency), it builds an optimized gearset
    for EACH distinct candidate service (see _candidate_services_for_recipe) —
    scoping gear to that service's location and adding that service's own stats
    — then keeps the service+gearset with the best score. That is the only way
    to correctly weigh a service that trades lower WE for higher NMC / DR / DA /
    QO, which a WE-only pre-pick silently ignores (report df39440d follow-up).

    Assumes the optimize_craft_gearsets module config (RECIPE, SORTING_PRIORITY,
    SORTING_WEIGHTS, TARGET_QUALITY, CHILD_INPUT_SPECS, INCLUDE_PETS/CONSUMABLES,
    PET_ITEMS/CONSUMABLE_ITEMS, LOCKED_SLOTS, IGNORED_ITEMS) is ALREADY set by
    the caller, so every per-service optimize uses identical scoring.

    Returns (service, gearset, metrics, iterations); all None if no candidate
    could be optimized.
    """
    import optimize_craft_gearsets

    candidates = _candidate_services_for_recipe(recipe, character)
    best = None  # (score, svc, gearset, metrics, iterations)
    for svc in candidates:
        optimize_craft_gearsets.SERVICE = svc
        optimize_craft_gearsets.SELECTED_LOCATION = getattr(svc, 'location', None)
        try:
            gs, m, iters = optimize_craft_gearsets.optimize_for_service(
                recipe, svc, character, consumable=None,
            )
        except Exception as _svc_exc:
            print(f"[ct-worker] service candidate {getattr(svc, 'name', svc)!r} "
                  f"optimize failed: {_svc_exc!r}", flush=True)
            continue
        # Minimize total tree steps for the target quantity. This metric is
        # always emitted and already folds in downstream child cost when
        # CHILD_INPUT_SPECS is set (tree-aware), degrading to the local recipe
        # steps otherwise — so it's the right single objective in both cases.
        # Fall back through the local step metrics if it's ever absent/inf.
        score = m.get('total_tree_steps_for_target')
        if score is None or score == float('inf'):
            score = m.get('expected_steps_per_item')
        if score is None or score == float('inf'):
            score = m.get('steps_for_target', float('inf'))
        if score is None:
            score = float('inf')
        loc_name = getattr(getattr(svc, 'location', None), 'name', None)
        print(f"[ct-worker] service candidate {getattr(svc, 'name', svc)!r} "
              f"@ {loc_name}: score={score}", flush=True)
        if best is None or score < best[0]:
            best = (score, svc, gs, m, iters)
    if best is None:
        return None, None, None, None
    print(f"[ct-worker] best service: {getattr(best[1], 'name', best[1])!r} "
          f"@ {getattr(getattr(best[1], 'location', None), 'name', None)} "
          f"(score={best[0]})", flush=True)
    return best[1], best[2], best[3], best[4]


# Module-level helper used by compute_slot_alternatives' top_n cap to
# preserve all quality variants of base items that make the cut. Strips
# the trailing " (Normal|Good|Great|Excellent|Perfect|Eternal)" suffix
# so e.g. "Spectral vest (Eternal)" and "Spectral vest (Perfect)" both
# resolve to "Spectral vest". Idempotent and safe on names without a
# quality suffix.
_QUALITY_SUFFIX_RE = re.compile(r'\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)\s*$')


def _base_name_strip_quality(name):
    if not name:
        return ''
    return _QUALITY_SUFFIX_RE.sub('', str(name)).strip()


def _category_component_names(activity, cat_str):
    """Enumerate the individual drop names that make up a category target,
    in drop-table order, matching the keys used in the activity's
    drop_rates map (so 'cat:fine' yields "<name> (Fine)" keys).

    Supports the multi-drop categories the non-owned upgrade "List per
    item" display mode breaks down: fine / gems / chests / collectibles /
    normal. Coins are intentionally excluded (aggregate-only).

    Returns [] for unsupported categories (xp, coins, single-item / IF
    targets, recipes) — callers then simply omit component_values and the
    popup falls back to the aggregate old ⟶ new.
    """
    if not cat_str or not isinstance(cat_str, str) or not cat_str.startswith('cat:'):
        return []
    if activity is None:
        return []
    all_drops = list(getattr(activity, 'drop_table', None) or []) \
        + list(getattr(activity, 'secondary_drop_table', None) or [])
    names = []
    seen = set()

    def _add(n):
        if n and n != 'Nothing' and n not in seen:
            seen.add(n)
            names.append(n)

    def _is_gem(d):
        ref = getattr(d, 'item_ref', '') or ''
        if ref.startswith('Material.ROUGH_'):
            return True
        try:
            kws = getattr(d.item_object, 'keywords', None) or []
            return any(str(k).lower() in ('gem', 'rough gem') for k in kws)
        except Exception:
            return False

    for d in all_drops:
        iname = getattr(d, 'item_name', '') or ''
        if iname == 'Nothing':
            continue
        ref = getattr(d, 'item_ref', '') or ''
        is_chest = ref.startswith('Container.') and 'BIRD_NEST' not in ref
        is_collectible = ref.startswith('Collectible.')

        if cat_str in ('cat:fine', 'cat:gems_fine'):
            has_fine = False
            try:
                if d.item_object and hasattr(d.item_object, 'has_fine_material'):
                    has_fine = d.item_object.has_fine_material()
            except Exception:
                has_fine = False
            if has_fine:
                _add(f"{iname} (Fine)")
        elif cat_str == 'cat:gems':
            if _is_gem(d):
                _add(iname)
        elif cat_str == 'cat:chests':
            if is_chest:
                _add(iname)
        elif cat_str == 'cat:collectibles':
            if is_collectible:
                _add(iname)
        elif cat_str == 'cat:normal_items':
            # "Normal items" = regular reward drops, excluding chests and
            # collectibles (those have their own categories).
            if not is_chest and not is_collectible:
                _add(iname)

    return names


def _normalize_category_target(activity, target):
    """Map a headline target (which the worker often passes in its
    RESOLVED form) back to a 'cat:*' category string for component
    enumeration.

    The activity optimizer resolves UI categories before scoring, so a
    priority entry's `.target` is usually the resolved value, not the
    original 'cat:*' string:
      - 'cat:fine' / 'cat:gems_fine' -> 'fine_item'
      - 'cat:normal_items'           -> 'raw_rewards'
      - 'cat:chests'                 -> a concrete chest item name (or 'primary_chest')
      - 'cat:collectibles'           -> a collectible name (or 'collectible')
      - 'cat:gems'                   -> a gem material name

    Returns a 'cat:*' string the enumerator understands, or None when the
    target is a specific non-category item (no per-category breakdown).
    """
    if not target or not isinstance(target, str):
        return None
    if target.startswith('cat:'):
        return target
    _SYNTH = {
        'fine_item': 'cat:fine',
        'raw_rewards': 'cat:normal_items',
        'primary_chest': 'cat:chests',
        'collectible': 'cat:collectibles',
    }
    if target in _SYNTH:
        return _SYNTH[target]
    # A concrete drop name resolved from cat:chests / collectibles / gems —
    # classify it by its drop-table entry so we can enumerate the whole
    # category, not just the one resolved item.
    if activity is not None:
        all_drops = list(getattr(activity, 'drop_table', None) or []) \
            + list(getattr(activity, 'secondary_drop_table', None) or [])
        for d in all_drops:
            if getattr(d, 'item_name', '') != target:
                continue
            ref = getattr(d, 'item_ref', '') or ''
            if ref.startswith('Container.') and 'BIRD_NEST' not in ref:
                return 'cat:chests'
            if ref.startswith('Collectible.'):
                return 'cat:collectibles'
            if ref.startswith('Material.ROUGH_'):
                return 'cat:gems'
            try:
                kws = getattr(d.item_object, 'keywords', None) or []
                if any(str(k).lower() in ('gem', 'rough gem') for k in kws):
                    return 'cat:gems'
            except Exception:
                pass
            return None  # specific non-category item — no breakdown
    return None


def _recipe_category_component_names(recipe, cat_str):
    """Component name(s) for a recipe category target.

    Recipes have no real side-drop table — the scorer collapses each
    category to a single aggregate (generic rate × finding stat). The
    only meaningfully-named component is the recipe's OUTPUT item, so:
      - cat:fine / cat:gems_fine -> ["<output> (Fine)"] when the output
        has a fine variant
      - cat:normal_items         -> ["<output>"]
      - cat:chests / collectibles / gems -> [] (no named drop; the popup
        falls back to the aggregate old ⟶ new for those)

    Returns [] for unsupported / non-category / quality targets.
    """
    if not cat_str or not isinstance(cat_str, str) or not cat_str.startswith('cat:'):
        return []
    if recipe is None:
        return []
    try:
        output_obj = recipe.get_output_item_object()
        output_name = getattr(output_obj, 'name', None)
    except Exception:
        output_obj, output_name = None, None
    if not output_name:
        return []
    if cat_str in ('cat:fine', 'cat:gems_fine'):
        has_fine = False
        try:
            if output_obj is not None and hasattr(output_obj, 'has_fine_material'):
                has_fine = output_obj.has_fine_material()
        except Exception:
            has_fine = False
        return [f"{output_name} (Fine)"] if has_fine else []
    if cat_str == 'cat:normal_items':
        return [output_name]
    return []


def compute_slot_alternatives(final_gearset, character, opt_type, activity=None, recipe=None, service=None,
                               consumable=None, sorting_priority=None, sorting_weights=None,
                               target_item=None, target_drop_rate=0, target_quality='Perfect',
                               budget_materials=0, budget_target=0, selected_location=None,
                               input_item=None, use_fine_inputs=False, hidden_items=None,
                               top_n=10):
    """Compute ALL non-owned items that improve each slot, ranked by improvement.
    Also computes owned-but-locked items that would improve each slot.
    
    For each slot in the optimized gearset, locks all other slots and tests
    every non-owned, non-hidden item (including all crafted qualities).
    Returns a dict of {slot_name: [{name, uuid, quality, improvement, metrics_delta}, ...]}.
    Items are sorted from smallest improvement (top) to biggest improvement (bottom).
    
    Also returns locked_alternatives: owned items that are locked behind requirements
    (reputation, skill level, AP, activity completion, etc.) that would be upgrades.
    
    Args:
        top_n: Cap on the number of alternatives returned per slot. Applied
            identically to both passes (`alternatives` and `locked_alternatives`)
            and uniformly across all opt_types (activity / recipe / travel).
            Tail-slice (`slot_alts[-top_n:]`) keeps the BIGGEST `top_n`
            improvements because lists are sorted smallest→biggest delta.
            Pass `top_n=None` to disable the cap. Default `10` is a perf/UI
            guardrail — see slot-alternatives-notes/T2-scope.md.
    """
    from util.autogenerated.equipment import Item, ItemInstance, CraftedItem, AchievementItem
    from util.walkscape_constants import Sorting
    
    print(f"\n{'='*70}")
    print(f"COMPUTING NON-OWNED ALTERNATIVES")
    print(f"{'='*70}")
    
    alternatives = {}
    locked_alternatives = {}
    hidden_names = set()
    if hidden_items:
        for hi in hidden_items:
            if hasattr(hi, 'name'):
                hidden_names.add(hi.name)
    
    # Log character skill levels for debugging lock issues
    if hasattr(character, 'skills'):
        skill_levels = {}
        for skill_name in ['agility', 'carpentry', 'cooking', 'crafting', 'fishing', 'foraging', 'hunting', 'mining', 'smithing', 'tailoring', 'trinketry', 'woodcutting']:
            skill_levels[skill_name] = character.get_skill_level(skill_name)
        print(f"Character skill levels for lock checks: {skill_levels}")
    
    # Collect ALL items in the game (including all crafted quality variants)
    # all_game_items: tested for non-owned alternatives (includes locked items too,
    #   since a non-owned locked item is still a valid "non-owned upgrade" suggestion)
    # all_locked_items: tested separately for owned-but-locked alternatives
    all_game_items = []
    all_locked_items = []  # Items that fail is_unlocked
    for attr_name in dir(Item):
        if attr_name.startswith('_'):
            continue
        item = getattr(Item, attr_name)
        # Only process actual item instances (ItemInstance, CraftedItem, AchievementItem)
        if not isinstance(item, (ItemInstance, CraftedItem, AchievementItem)):
            continue
        
        # Skip hidden items
        if item.name in hidden_names:
            continue
        
        # Check if item is unlocked (level/rep requirements)
        # CraftedItem base objects don't inherit StatsMixin, so check requirements directly
        is_locked = False
        if hasattr(item, 'is_unlocked'):
            if not item.is_unlocked(character, ignore_gear_requirements=True):
                is_locked = True
        elif isinstance(item, CraftedItem) and hasattr(item, 'requirements') and item.requirements:
            # CraftedItem doesn't have is_unlocked — check via a quality variant
            # (quality variants are ItemInstance which inherits StatsMixin)
            test_variant = item.NORMAL
            if hasattr(test_variant, 'is_unlocked'):
                if not test_variant.is_unlocked(character, ignore_gear_requirements=True):
                    is_locked = True
        
        # Debug: log lock status for ALL neck amulets to diagnose "owned but locked" bug
        if hasattr(item, 'slot') and item.slot == 'neck' and 'amulet' in item.name.lower():
            reqs = getattr(item, 'requirements', [])
            missing = []
            for req in reqs:
                if req.get('type') == 'skill':
                    skill_name = req.get('skill', '')
                    req_level = req.get('level', 0)
                    char_level = character.get_skill_level(skill_name)
                    status = 'PASS' if char_level >= req_level else 'FAIL'
                    missing.append(f"{skill_name} {req_level} (have {char_level}) {status}")
                elif req.get('type') == 'activity_completion':
                    activity = req.get('activity', '')
                    completions = req.get('completions', 0)
                    activity_normalized = activity.lower().replace(' ', '_').replace("'", "")
                    has_completed = False
                    if hasattr(character, 'custom_stats') and character.custom_stats is not None:
                        has_completed = character.custom_stats.get(activity_normalized, False)
                    status = 'PASS' if has_completed else 'FAIL'
                    missing.append(f"activity_completion:{activity} x{completions} (custom_stats={has_completed}) {status}")
                else:
                    missing.append(f"{req.get('type')}: {req}")
            item_type = type(item).__name__
            print(f"  DEBUG amulet: {item.name} (type={item_type}) is_locked={is_locked} — reqs: {missing}")
        
        # For CraftedItem base objects, expand into all quality variants
        if isinstance(item, CraftedItem) and hasattr(item, 'NORMAL'):
            for quality_attr in ['NORMAL', 'GOOD', 'GREAT', 'EXCELLENT', 'PERFECT', 'ETERNAL']:
                variant = getattr(item, quality_attr, None)
                if variant and variant.name not in hidden_names:
                    all_game_items.append(variant)
                    if is_locked:
                        all_locked_items.append(variant)
        else:
            all_game_items.append(item)
            if is_locked:
                all_locked_items.append(item)
    
    print(f"Total game items to consider (incl. quality variants): {len(all_game_items)}")
    print(f"Total locked items to check for owned-but-locked: {len(all_locked_items)}")
    
    # Build set of owned item object ids for filtering
    owned_item_ids = set()
    # Also build a UUID+name based ownership set for CraftedItem variants
    # (CraftedItem._get_quality is a @property that creates new objects each time,
    # so id() matching fails for crafted items)
    owned_item_keys = set()  # (uuid, quality_name) tuples
    for item, qty in character.items.items():
        if qty > 0:
            owned_item_ids.add(id(item))
            # Build a key from uuid + name for reliable matching
            item_uuid = getattr(item, 'uuid', None)
            item_name = getattr(item, 'name', None)
            if item_uuid and item_name:
                owned_item_keys.add((item_uuid, item_name))

    # Also track the best owned quality per crafted base item.
    # The worker only adds the *selected* quality to character.inventory, so lower
    # quality variants of the same item are not in owned_item_ids even though the
    # player owns them.  We must not suggest those as "non-owned upgrades".
    quality_rank = {'NORMAL': 0, 'GOOD': 1, 'GREAT': 2, 'EXCELLENT': 3, 'PERFECT': 4, 'ETERNAL': 5}
    quality_attr_for_name = {
        'Normal': 'NORMAL', 'Good': 'GOOD', 'Great': 'GREAT',
        'Excellent': 'EXCELLENT', 'Perfect': 'PERFECT', 'Eternal': 'ETERNAL',
    }

    # Precompute: base item name → base CraftedItem object (for fast lookup)
    crafted_base_by_name = {}
    for attr_name in dir(Item):
        if attr_name.startswith('_'):
            continue
        base = getattr(Item, attr_name)
        if isinstance(base, CraftedItem):
            crafted_base_by_name[base.name] = base

    # Map: id(base CraftedItem) → best owned quality rank (0-5)
    owned_crafted_best_rank = {}
    for owned_item, qty in character.items.items():
        if qty <= 0:
            continue
        for q_name, q_attr in quality_attr_for_name.items():
            if f'({q_name})' in getattr(owned_item, 'name', ''):
                base_name = owned_item.name.replace(f' ({q_name})', '').strip()
                base = crafted_base_by_name.get(base_name)
                if base is not None:
                    rank = quality_rank.get(q_attr, -1)
                    if rank > owned_crafted_best_rank.get(id(base), -1):
                        owned_crafted_best_rank[id(base)] = rank
                break
    
    # Determine slots to check (skip consumable, pet, input, collectible)
    skip_slots = {'consumable', 'pet', 'input', 'collectible'}
    slots_to_check = [s for s in final_gearset.keys() if s not in skip_slots]
    
    if opt_type == 'activity':
        import optimize_activity_gearsets as opt_mod
        
        def score_gearset(gs):
            # 2026-06-04 (jwbail): when scoring a chest-target activity
            # (goals-report "chest farming for activities" rows), the
            # chest-specific composite key steps_per_reward_roll::<chest>
            # is only emitted by calculate_gearset_metrics when the
            # module-global TARGET_ITEM drives it (branch 2 of
            # _effective_targets_for_scoring). compute_slot_alternatives
            # historically left TARGET_ITEM at whatever stale value the
            # process last set, so the chest composite was absent and the
            # comparator fell back to the bare steps_per_reward_roll
            # (raw_rewards headline) -> almost nothing scored as an
            # improvement -> empty "non-owned upgrades" section. Set
            # TARGET_ITEM to the requested target for the duration of the
            # score, then restore. Mirrors stats_report_worker's
            # run_optimizer_for_job which sets TARGET_ITEM = job.chest_name.
            # No-op when target_item is None (xp/coins paths).
            _saved_target = opt_mod.TARGET_ITEM
            if target_item is not None:
                opt_mod.TARGET_ITEM = target_item
            try:
                metrics, _ = opt_mod.calculate_gearset_metrics(gs, activity, character, consumable=consumable)
            finally:
                opt_mod.TARGET_ITEM = _saved_target
            return metrics
        
        def is_valid(gs):
            from util.optimization_utils import validate_tool_keywords
            tools_list = [item for slot, item in gs.items() if item is not None and slot.startswith('tool')]
            if not validate_tool_keywords(tools_list):
                return False
            keyword_counts = activity.requirements.get('keyword_counts', {})
            # Build set of keywords satisfied by the input item (e.g. arrows for hunting).
            # 2026-06-05 (jwbail): normalize underscores<->spaces. keyword_counts keys
            # and gear keywords use the SPACE form ('hunting net', 'diving gear'), but
            # InputItem.reference uses the UNDERSCORE form ('hunting_net', 'hunting_trap').
            # Without normalizing, a required keyword satisfiable ONLY by an input item
            # (no gear carries it) could never be matched -> is_valid returned False for
            # EVERY candidate -> "No better alternatives" on EVERY slot of those rows.
            # Affected activities: 'Drift net hunting' (hunting net, drops Dolphin egg)
            # and 'Box trapping' (hunting trap). User-reported 2026-06-05.
            def _norm_kw(s):
                return str(s).lower().replace('_', ' ').strip()
            input_item_keywords = set()
            if input_item and hasattr(input_item, 'keywords'):
                input_item_keywords = {_norm_kw(kw) for kw in input_item.keywords}
            elif not input_item and hasattr(activity, 'input_items') and activity.input_items:
                # No input selected — pre-satisfy keywords from activity's input_items definitions
                for ii in activity.input_items:
                    if getattr(ii, 'type', '') == 'keyword':
                        kw = _norm_kw(getattr(ii, 'reference', ''))
                        if kw:
                            input_item_keywords.add(kw)
            for kw, required in keyword_counts.items():
                if required <= 0:
                    continue
                count = sum(
                    1 for s, it in gs.items()
                    if it and hasattr(it, 'keywords') and
                    any(_norm_kw(kw) == _norm_kw(k) for k in it.keywords)
                )
                # Input item (e.g. arrows) can satisfy keyword requirements
                if count < required and _norm_kw(kw) in input_item_keywords:
                    count += 1
                if count < required:
                    return False
            # Enforce tool keyword minimum-skill-level requirements, e.g. a
            # pickaxe that itself requires at least Mining level 60.
            from util.optimization_utils import gearset_meets_keyword_level_requirements
            gs_items = [it for s, it in gs.items() if it is not None]
            if not gearset_meets_keyword_level_requirements(gs_items, activity):
                return False
            return True
        
    elif opt_type == 'recipe':
        import optimize_craft_gearsets as opt_mod
        
        def score_gearset(gs):
            # 2026-06-05 (jwbail): the recipe optimizer only emits the
            # per-target composite key (e.g. steps_per_chest_recipe::cat:chests)
            # for targets present in the MODULE GLOBAL SORTING_PRIORITY —
            # calculate_craft_metrics calls _target_item_targets_for_scoring()
            # which reads that global, NOT the priority passed to the
            # comparator. The stats-report slot-alternatives endpoint passes
            # the target via the sorting_priority arg but never set the
            # global, so the composite was ABSENT: primary_key lookup
            # returned 0 -> old/new rendered as "2,116 -> 0.000" AND the
            # comparator scored on a missing axis, surfacing the wrong items
            # (e.g. Red skydisc not flagged as an upgrade). Mirror the
            # activity path (which sets TARGET_ITEM): set SORTING_PRIORITY /
            # SORTING_WEIGHTS for the duration of the score, then restore.
            _saved_sp = opt_mod.SORTING_PRIORITY
            _saved_sw = opt_mod.SORTING_WEIGHTS
            if sorting_priority:
                opt_mod.SORTING_PRIORITY = sorting_priority
            if sorting_weights:
                opt_mod.SORTING_WEIGHTS = sorting_weights
            try:
                metrics, _ = opt_mod.calculate_craft_metrics(
                    gs, recipe, service, character,
                    target_quality, 1, consumable,
                    budget_materials=budget_materials,
                    budget_target=budget_target
                )
            finally:
                opt_mod.SORTING_PRIORITY = _saved_sp
                opt_mod.SORTING_WEIGHTS = _saved_sw
            return metrics
        
        def is_valid(gs):
            from util.optimization_utils import validate_tool_keywords
            from util.gearset_utils import is_gearset_valid
            tools_list = [item for slot, item in gs.items() if item is not None and slot.startswith('tool')]
            if not validate_tool_keywords(tools_list):
                return False
            # Validate service requirements (e.g. diving gear count for underwater services)
            if service:
                keyword_counts = service.requirements.get('keyword_counts', {})
                if any(v > 0 for v in keyword_counts.values()):
                    if not is_gearset_valid(gs, character, activity=None, service=service, check_requirements=True):
                        return False
            return True
    elif opt_type == 'travel':
        import optimize_travel_gearsets as opt_mod

        # `selected_location` is repurposed to carry the route_tuples list for
        # travel (travel doesn't use selected_location for anything else here).
        route_tuples = selected_location if isinstance(selected_location, list) else []

        def score_gearset(gs):
            metrics, _ = opt_mod.calculate_travel_metrics(gs, route_tuples, character)
            return metrics

        def is_valid(gs):
            from util.optimization_utils import validate_tool_keywords
            tools_list = [item for slot, item in gs.items() if item is not None and slot.startswith('tool')]
            if not validate_tool_keywords(tools_list):
                return False
            # Check route keyword requirements (skis, light sources, diving gear)
            if route_tuples:
                required_keywords = opt_mod._union_requirements(
                    [f"route-{t[0].name.lower()}-{t[1].name.lower()}-00000000-0000-0000-0000-000000000000"
                     for t in route_tuples]
                )
                items = [item for item in gs.values() if item is not None]
                for kw, required_count in required_keywords.items():
                    if required_count <= 0:
                        continue
                    count = sum(
                        1 for item in items
                        if hasattr(item, 'keywords') and
                        any(kw.lower() in k.lower() for k in item.keywords)
                    )
                    if count < required_count:
                        return False
            return True

        # Use the travel optimizer's own sorting priority
        sorting_priority = opt_mod.SORTING_PRIORITY
        sorting_weights = opt_mod.SORTING_WEIGHTS

    else:
        print(f"  Alternatives not supported for opt_type={opt_type}")
        return {}, {}

    priority = sorting_priority or opt_mod.SORTING_PRIORITY
    weights = sorting_weights or getattr(opt_mod, 'SORTING_WEIGHTS', {})
    # Any entry with sub-100% weight activates the floor logic. Entries
    # are either SortingEntry (has .weight) or bare Sorting enums (look
    # up in the legacy weights dict).
    def _entry_weight(entry):
        if hasattr(entry, 'weight'):
            return entry.weight
        return weights.get(entry, 100)
    use_floors = any(_entry_weight(e) < 100 for e in priority)
    primary_key = priority[0].metric_key if priority else None
    primary_reverse = priority[0].is_reverse if priority else False
    primary_display = priority[0].display_name if priority else None

    # Travel reuses Sorting.TOTAL_STEPS whose display_name is a recipe
    # template ("Total Steps for X Quality"). For travel that label is
    # nonsensical — traveling has no target quality. Substitute a plain
    # "Total Steps" label so the item popup shows the correct metric name.
    # See bug report d18bb288 (follow-up to 1d271940).
    if opt_type == 'travel' and primary_display:
        primary_display = 'Total Steps'

    try:
        current_metrics = score_gearset(final_gearset)
    except Exception as e:
        print(f"  Failed to score current gearset: {e}")
        return {}, {}

    # ── Per-component (per-individual-drop) breakdown setup ──────────────
    # For the non-owned upgrade popup's "List per item" display mode, emit
    # a `component_values` map on each accepted alt for multi-drop category
    # targets (fine / gems / chests / collectibles / normal — NOT coins).
    #
    # ACTIVITY path: real per-drop steps via the EMIT_COMPONENT_STEPS
    # side-channel on calculate_gearset_metrics (reuses the exact same
    # total_stats the scorer used, target_item=None so every drop incl.
    # "<name> (Fine)" is present).
    #
    # RECIPE path: the recipe scorer collapses each category to a SINGLE
    # aggregate (generic rate × finding stat) — there is no per-drop table —
    # so we label that aggregate with the recipe's component name(s)
    # (e.g. "Adamant bar (Fine)") reusing the alt's old/new. Single line in
    # practice; identical values group on the frontend.
    #
    # The headline category comes from the first priority entry's target.
    _component_names = []
    _current_comp = {}
    _component_mode = None  # 'activity' (per-drop) | 'recipe' (aggregate label)
    _component_steps_for_gs = None
    if opt_type == 'activity':
        _headline_target = getattr(priority[0], 'target', None) if priority else None
        _component_names = _category_component_names(
            activity, _normalize_category_target(activity, _headline_target))
        if _component_names:
            def _component_steps_for_gs(gs):
                opt_mod.EMIT_COMPONENT_STEPS = True
                try:
                    m = score_gearset(gs)
                except Exception:
                    return {}
                finally:
                    opt_mod.EMIT_COMPONENT_STEPS = False
                return m.get('_component_steps') or {}
            try:
                _current_comp = _component_steps_for_gs(final_gearset)
            except Exception:
                _current_comp = {}
            if _current_comp:
                _component_mode = 'activity'
            else:
                # Nothing to break down (e.g. drop-rate eval failed) —
                # disable the feature for this run so we don't do useless
                # per-alt work.
                _component_names = []
    elif opt_type == 'recipe':
        _headline_target = getattr(priority[0], 'target', None) if priority else None
        # Recipes resolve cat:fine -> 'fine_item' / cat:normal -> 'raw_rewards'
        # too; normalize the synthetic forms back to a category string.
        _recipe_cat = _headline_target
        if _recipe_cat == 'fine_item':
            _recipe_cat = 'cat:fine'
        elif _recipe_cat == 'raw_rewards':
            _recipe_cat = 'cat:normal_items'
        _component_names = _recipe_category_component_names(recipe, _recipe_cat)
        if _component_names:
            _component_mode = 'recipe'

    def _build_component_values(test_gs, agg_old=None, agg_new=None):
        """Per-component {name: {old, new}} for the selected category.

        Activity: real per-drop steps (current vs test), sorted by new asc.
        Recipe: the single aggregate old/new labeled with the recipe's
        component name(s) — the frontend groups identical values into one
        "/"-joined line.
        """
        if not _component_names:
            return None
        if _component_mode == 'recipe':
            if agg_old is None or agg_new is None:
                return None
            if not (math.isfinite(agg_old) and math.isfinite(agg_new)):
                return None
            ov = round(agg_old, 4)
            nv = round(agg_new, 4)
            return {nm: {'old': ov, 'new': nv} for nm in _component_names}
        # activity per-drop
        try:
            test_comp = _component_steps_for_gs(test_gs)
        except Exception:
            return None
        pairs = []
        for nm in _component_names:
            ov = _current_comp.get(nm)
            nv = test_comp.get(nm)
            if ov is None or nv is None:
                continue
            if not (math.isfinite(ov) and math.isfinite(nv)):
                continue
            pairs.append((nm, round(ov, 4), round(nv, 4)))
        if not pairs:
            return None
        pairs.sort(key=lambda p: p[2])
        return {nm: {'old': ov, 'new': nv} for nm, ov, nv in pairs}


    # gearset, so we don't re-suggest an item that's already worn in
    # ANOTHER slot. Per-slot alternatives lock all other slots, so the
    # same physical item can't occupy two slots (a 2nd copy is only
    # supported on the ring path below). Key = (uuid, quality) so a HIGHER
    # quality of an equipped crafted tool still surfaces as an upgrade,
    # while the exact same item (incl. Omni-tool's AchievementItem variant,
    # which shares the base uuid and has no quality suffix) is excluded.
    # User-reported: collectibles row re-suggested Omni-tool + Flowing
    # pocketwatch that were already equipped in other tool slots.
    def _equip_identity(it):
        if it is None:
            return None
        uid = getattr(it, 'uuid', None)
        qn = getattr(it, '_quality_name', None)
        if qn is None:
            nm = getattr(it, 'name', '') or ''
            for q in ('Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'):
                if f'({q})' in nm:
                    qn = q
                    break
        return (uid or getattr(it, 'name', None), qn)
    equipped_identity_by_slot = {}
    for _s, _it in final_gearset.items():
        _k = _equip_identity(_it)
        if _k is not None:
            equipped_identity_by_slot[_s] = _k

    # 2026-06-20 (jwbail): equip-identity (uuid+quality) set of everything the
    # user owns. Robust fallback for the owned-skip below. id()-based ownership
    # (owned_item_ids) fails when the owned object is a DIFFERENT instance than
    # the Item.<attr> singleton enumerated into all_game_items — most notably an
    # AchievementItem like Omni-tool, whose AP-indexed variant ("Omni-tool
    # (300)") shares the base uuid but has a different name AND object id. The
    # (uuid, name) owned_item_keys fallback the locked-pass loop uses ALSO misses
    # it because the names diverge. Keying on (uuid, quality) catches it. Without
    # this, owned tools (Omni-tool, piggy bank, small sack) leaked into the
    # non-owned upgrade list (bug 299a4b8f). A higher crafted quality the user
    # does NOT own has a different quality key, so it is still surfaced.
    owned_equip_identities = set()
    for _oit, _oqty in character.items.items():
        if _oqty and _oqty > 0:
            _oek = _equip_identity(_oit)
            if _oek is not None:
                owned_equip_identities.add(_oek)

    for slot in slots_to_check:
        current_item = final_gearset.get(slot)
        
        # Determine which item slot type to search
        if slot.startswith('ring'):
            item_slot = 'ring'
        elif slot.startswith('tool'):
            item_slot = 'tools'
        else:
            item_slot = slot
        
        slot_alts = []
        
        for item in all_game_items:
            if not hasattr(item, 'slot'):
                continue
            item_slot_type = item.slot
            if item_slot_type == 'tool':
                item_slot_type = 'tools'
            if item_slot_type != item_slot:
                continue
            
            # Skip if this is the current item
            if item is current_item:
                continue

            # 2026-06-20 (jwbail): also skip a candidate that matches the
            # current item by equip-identity (uuid+quality) even when it is a
            # different Python object. The 'is' check above fails for
            # identity-divergent instances — e.g. Omni-tool (AchievementItem):
            # the equipped AP-indexed variant ("Omni-tool (300)") shares the
            # base uuid but is a different object than the Item.<attr> singleton
            # in all_game_items, so the omni-tool slot suggested the omni-tool
            # to replace itself (bug 299a4b8f). Rings are excluded — they have
            # the legitimate 2nd-copy path below.
            if current_item is not None and not slot.startswith('ring'):
                _cur_key = _equip_identity(current_item)
                if _cur_key is not None and _equip_identity(item) == _cur_key:
                    continue

            # Skip if owned (exact match)
            # SPECIAL CASE for ring slots: if the user owns exactly 1 copy and that copy
            # is already equipped in the OTHER ring slot, a second copy would be a real
            # upgrade. Include it as a "non-owned alternative" (meaning "acquire another
            # copy of this ring"), since the user would need to obtain a 2nd copy to use
            # it in both slots.
            is_ring_slot = slot.startswith('ring')
            # 2026-06-05 (jwbail): skip a candidate already equipped in a
            # DIFFERENT slot of this gearset (non-ring slots only — rings
            # have the 2nd-copy path below). Mainly tool slots: items like
            # Omni-tool / Flowing pocketwatch carry no conflicting keyword
            # so validate_tool_keywords won't catch the duplicate, and
            # Omni-tool's AchievementItem variant dodges the owned-id skip.
            if not is_ring_slot:
                _cand_key = _equip_identity(item)
                if _cand_key is not None and any(
                    k == _cand_key
                    for s2, k in equipped_identity_by_slot.items()
                    if s2 != slot
                ):
                    continue
            if id(item) in owned_item_ids or _equip_identity(item) in owned_equip_identities:
                suggest_second_copy = False
                if is_ring_slot:
                    # Find the other ring slot
                    other_ring_slot = 'ring2' if slot == 'ring1' else ('ring1' if slot == 'ring2' else None)
                    if other_ring_slot is not None:
                        other_item = final_gearset.get(other_ring_slot)
                        if other_item is item:
                            # Same specific object in the other ring slot. Check owned qty.
                            owned_qty = 0
                            for inv_item, qty in character.items.items():
                                if inv_item is item:
                                    owned_qty = qty
                                    break
                            if owned_qty < 2:
                                suggest_second_copy = True
                if not suggest_second_copy:
                    continue

            # Skip if this is a crafted quality variant that the user already owns.
            # The worker only stores the *selected* quality in character.inventory, so
            # other owned qualities are absent from owned_item_ids.  We must not suggest
            # those as "non-owned upgrades" — but we SHOULD suggest qualities the user
            # genuinely doesn't own (e.g. Great/Excellent when they only own Perfect+Good).
            #
            # For non-ring slots: also skip qualities LOWER than the best owned quality,
            # since the user already has a better version of this item.
            # Rings are excluded because both ring slots may need different qualities.
            for q_name, q_attr in quality_attr_for_name.items():
                if f'({q_name})' in item.name:
                    base_name = item.name.replace(f' ({q_name})', '').strip()
                    base = crafted_base_by_name.get(base_name)
                    if base is not None:
                        candidate_rank = quality_rank.get(q_attr, -1)
                        # Build the set of ranks the user actually owns for this base item
                        owned_ranks_for_base = set()
                        owned_qty_this_quality = 0
                        for owned_item_obj, qty in character.items.items():
                            if qty <= 0:
                                continue
                            for oq_name, oq_attr in quality_attr_for_name.items():
                                if f'({oq_name})' in getattr(owned_item_obj, 'name', ''):
                                    obase_name = owned_item_obj.name.replace(f' ({oq_name})', '').strip()
                                    if obase_name == base_name:
                                        owned_ranks_for_base.add(quality_rank.get(oq_attr, -1))
                                        if quality_rank.get(oq_attr, -1) == candidate_rank:
                                            owned_qty_this_quality += qty
                        # Skip if user owns this exact quality.
                        # RING EXCEPTION: if the other ring slot has this exact item and the
                        # user owns < 2, suggest acquiring a second copy as an upgrade.
                        if candidate_rank in owned_ranks_for_base:
                            suggest_second_copy = False
                            if is_ring_slot:
                                other_ring_slot = 'ring2' if slot == 'ring1' else ('ring1' if slot == 'ring2' else None)
                                if other_ring_slot is not None:
                                    other_item = final_gearset.get(other_ring_slot)
                                    if other_item is not None and getattr(other_item, 'name', None) == item.name:
                                        if owned_qty_this_quality < 2:
                                            suggest_second_copy = True
                            if not suggest_second_copy:
                                item = None
                        # For non-ring slots: skip qualities lower than best owned
                        elif not is_ring_slot and owned_ranks_for_base:
                            best_owned_rank = max(owned_ranks_for_base)
                            if candidate_rank < best_owned_rank:
                                item = None
                    break
            if item is None:
                continue
            
            # Try this item in the slot
            test_gs = final_gearset.copy()
            test_gs[slot] = item
            
            if not is_valid(test_gs):
                continue
            
            try:
                test_metrics = score_gearset(test_gs)
            except Exception:
                continue
            
            # Check if better than current optimized gearset
            if use_floors:
                is_better = Sorting.is_better_with_floors(
                    test_metrics, current_metrics, priority, weights, {}
                )
            else:
                is_better = Sorting.is_better(test_metrics, current_metrics, priority)
            
            if not is_better:
                continue
            
            # Compute improvement delta on primary metric
            delta = 0
            delta_pct = 0
            if primary_key and primary_key in current_metrics and primary_key in test_metrics:
                old_val = current_metrics[primary_key]
                new_val = test_metrics[primary_key]
                delta = new_val - old_val
                if old_val != 0:
                    delta_pct = ((new_val - old_val) / abs(old_val)) * 100
            
            # Get quality name for crafted items
            quality = None
            rarity = None
            if hasattr(item, '_quality_name'):
                quality = item._quality_name
            else:
                for q in ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']:
                    if f'({q})' in item.name:
                        quality = q
                        break
            
            quality_to_rarity = {
                'Eternal': 'ethereal', 'Perfect': 'legendary', 'Excellent': 'epic',
                'Great': 'rare', 'Good': 'uncommon', 'Normal': 'common'
            }
            if quality:
                rarity = quality_to_rarity.get(quality, 'common')
            else:
                rarity = getattr(item, 'rarity', 'common') or 'common'
            
            alt_data = {
                'name': item.name,
                'uuid': item.uuid if hasattr(item, 'uuid') else None,
                'quality': quality,
                'rarity': rarity,
                'slot': slot,
                'replaces': current_item.name if current_item else None,
                'primary_metric': primary_key,
                'primary_display': primary_display,
                'old_value': round(current_metrics.get(primary_key, 0), 4) if primary_key and math.isfinite(current_metrics.get(primary_key, 0)) else None,
                'new_value': round(test_metrics.get(primary_key, 0), 4) if primary_key and math.isfinite(test_metrics.get(primary_key, 0)) else None,
                'delta': round(delta, 4) if math.isfinite(delta) else None,
                'delta_pct': round(delta_pct, 2) if math.isfinite(delta_pct) else None,
            }
            # Per-individual-drop breakdown for the "List per item" popup
            # display mode (multi-drop category targets). Activity = real
            # per-drop steps; recipe = single aggregate labeled with the
            # output component name. Omitted for unsupported targets —
            # popup falls back to the aggregate old ⟶ new.
            _cv = _build_component_values(
                test_gs,
                agg_old=alt_data.get('old_value'),
                agg_new=alt_data.get('new_value'),
            )
            if _cv:
                alt_data['component_values'] = _cv
            slot_alts.append(alt_data)
        
        if slot_alts:
            # Sort by absolute improvement: smallest first, biggest last
            # For minimize metrics (is_reverse=False), delta is negative (lower=better), 
            # so sort by delta descending (closest to 0 first)
            # For maximize metrics (is_reverse=True), delta is positive (higher=better),
            # so sort by delta ascending (closest to 0 first)
            if primary_reverse:
                slot_alts.sort(key=lambda a: a['delta'] if a['delta'] is not None else 0)  # smallest positive first
            else:
                slot_alts.sort(key=lambda a: a['delta'] if a['delta'] is not None else 0, reverse=True)  # smallest negative first (closest to 0)

            # Cap to top_n biggest improvements per slot. Sort order is
            # smallest→biggest, so tail-slice keeps the BIGGEST top_n while
            # preserving the existing render order (most-impactful at end).
            # See slot-alternatives-notes/T2-scope.md decision #1.
            #
            # Quality preservation: when slicing, expand the kept set to
            # include ALL quality variants of any BASE item that has at
            # least one variant in the cap. Without this, the cap can
            # silently drop Eternal Spectral vest while keeping Perfect
            # and Excellent (chest-slot has many quality variants and
            # the deltas can put the lower tiers at the boundary). User
            # 2026-05-19: "chest is saying spectral vest perfect and
            # excellent, but no spectral vest eternal."
            if top_n is not None and len(slot_alts) > top_n:
                kept = list(slot_alts[-top_n:])
                kept_base_names = {
                    _base_name_strip_quality(a.get('name', '')) for a in kept
                }
                kept_ids = {id(a) for a in kept}
                for a in slot_alts[:-top_n]:
                    if _base_name_strip_quality(a.get('name', '')) in kept_base_names \
                            and id(a) not in kept_ids:
                        kept.append(a)
                # Re-sort kept to match the SAME order as the un-capped
                # list above. The previous unconditional reverse=True
                # flipped maximize-metric slots to biggest→smallest, so a
                # slot that tripped the cap (e.g. many quality variants of
                # one base item) rendered reversed vs a slot that didn't.
                # Mirror the primary_reverse branch exactly so every slot
                # renders smallest→biggest. User-reported 2026-06-25.
                if primary_reverse:
                    kept.sort(key=lambda a: a['delta'] if a.get('delta') is not None else 0)
                else:
                    kept.sort(key=lambda a: a['delta'] if a.get('delta') is not None else 0, reverse=True)
                slot_alts = kept

            alternatives[slot] = slot_alts
            print(f"  {slot}: {len(slot_alts)} non-owned alternatives found")
        else:
            print(f"  {slot}: No better non-owned alternatives")
    
    total = sum(len(v) for v in alternatives.values())
    print(f"\nFound {total} total alternatives across {len(alternatives)} slots")
    
    # ========================================================================
    # COMPUTE OWNED-BUT-LOCKED ALTERNATIVES
    # ========================================================================
    # These are items the user owns but can't use due to unmet requirements
    # (reputation, skill level, AP, activity completion, etc.)
    print(f"\n{'='*70}")
    print(f"COMPUTING OWNED-BUT-LOCKED ALTERNATIVES")
    print(f"{'='*70}")
    
    for slot in slots_to_check:
        current_item = final_gearset.get(slot)
        
        if slot.startswith('ring'):
            item_slot = 'ring'
        elif slot.startswith('tool'):
            item_slot = 'tools'
        else:
            item_slot = slot
        
        slot_locked = []
        
        for item in all_locked_items:
            if not hasattr(item, 'slot'):
                continue
            item_slot_type = item.slot
            if item_slot_type == 'tool':
                item_slot_type = 'tools'
            if item_slot_type != item_slot:
                continue
            
            # Skip if this is the current item
            if item is current_item:
                continue
            
            # Only include if the user OWNS this item
            is_owned = id(item) in owned_item_ids
            
            # Also check by UUID+name (needed for CraftedItem variants which are
            # created fresh by @property, so id() never matches)
            if not is_owned:
                item_uuid = getattr(item, 'uuid', None)
                item_name = getattr(item, 'name', None)
                if item_uuid and item_name and (item_uuid, item_name) in owned_item_keys:
                    is_owned = True
            
            # Also check crafted quality ownership
            if not is_owned:
                for q_name, q_attr in quality_attr_for_name.items():
                    if f'({q_name})' in item.name:
                        base_name = item.name.replace(f' ({q_name})', '').strip()
                        base = crafted_base_by_name.get(base_name)
                        if base is not None:
                            candidate_rank = quality_rank.get(q_attr, -1)
                            owned_ranks_for_base = set()
                            for owned_item_obj, qty in character.items.items():
                                if qty <= 0:
                                    continue
                                for oq_name, oq_attr in quality_attr_for_name.items():
                                    if f'({oq_name})' in getattr(owned_item_obj, 'name', ''):
                                        obase_name = owned_item_obj.name.replace(f' ({oq_name})', '').strip()
                                        if obase_name == base_name:
                                            owned_ranks_for_base.add(quality_rank.get(oq_attr, -1))
                            if candidate_rank in owned_ranks_for_base:
                                is_owned = True
                        break
            
            if not is_owned:
                continue
            
            # Get missing requirements
            missing_reqs = []
            if hasattr(item, 'get_missing_requirements'):
                missing_reqs = item.get_missing_requirements(character, ignore_gear_requirements=True)
            if not missing_reqs:
                continue  # Shouldn't happen since item is locked, but safety check
            
            # Double-check: verify the item is actually locked by re-testing is_unlocked
            # This catches cases where all_locked_items was built with stale/wrong data
            if hasattr(item, 'is_unlocked') and item.is_unlocked(character, ignore_gear_requirements=True):
                print(f"    WARNING: {item.name} was in all_locked_items but is_unlocked=True now! Skipping.")
                continue
            
            # Try this item in the slot
            test_gs = final_gearset.copy()
            test_gs[slot] = item
            
            if not is_valid(test_gs):
                continue
            
            try:
                test_metrics = score_gearset(test_gs)
            except Exception:
                continue
            
            # Check if better than current
            if use_floors:
                better = Sorting.is_better_with_floors(
                    test_metrics, current_metrics, priority, weights, {}
                )
            else:
                better = Sorting.is_better(test_metrics, current_metrics, priority)
            
            if not better:
                continue
            
            # Compute improvement delta
            delta = 0
            delta_pct = 0
            if primary_key and primary_key in current_metrics and primary_key in test_metrics:
                old_val = current_metrics[primary_key]
                new_val = test_metrics[primary_key]
                delta = new_val - old_val
                if old_val != 0:
                    delta_pct = ((new_val - old_val) / abs(old_val)) * 100
            
            # Get quality/rarity
            quality = None
            rarity = None
            if hasattr(item, '_quality_name'):
                quality = item._quality_name
            else:
                for q in ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']:
                    if f'({q})' in item.name:
                        quality = q
                        break
            
            quality_to_rarity = {
                'Eternal': 'ethereal', 'Perfect': 'legendary', 'Excellent': 'epic',
                'Great': 'rare', 'Good': 'uncommon', 'Normal': 'common'
            }
            if quality:
                rarity = quality_to_rarity.get(quality, 'common')
            else:
                rarity = getattr(item, 'rarity', 'common') or 'common'
            
            # Check if this item is locked specifically due to custom stats
            # (activity_completion, access) vs other reasons (rep, skill, AP)
            custom_stats_reqs = []
            if hasattr(item, 'get_custom_stats_requirements'):
                custom_stats_reqs = item.get_custom_stats_requirements(character, ignore_gear_requirements=True)
            
            locked_data = {
                'name': item.name,
                'uuid': item.uuid if hasattr(item, 'uuid') else None,
                'quality': quality,
                'rarity': rarity,
                'slot': slot,
                'replaces': current_item.name if current_item else None,
                'primary_metric': primary_key,
                'primary_display': primary_display,
                'old_value': round(current_metrics.get(primary_key, 0), 4) if primary_key and math.isfinite(current_metrics.get(primary_key, 0)) else None,
                'new_value': round(test_metrics.get(primary_key, 0), 4) if primary_key and math.isfinite(test_metrics.get(primary_key, 0)) else None,
                'delta': round(delta, 4) if math.isfinite(delta) else None,
                'delta_pct': round(delta_pct, 2) if math.isfinite(delta_pct) else None,
                'missing_requirements': missing_reqs,
                'is_locked': True,
                'is_custom_stats_locked': len(custom_stats_reqs) > 0,
                'custom_stats_needed': [r['stat_id'] for r in custom_stats_reqs],
            }
            slot_locked.append(locked_data)
        
        if slot_locked:
            if primary_reverse:
                slot_locked.sort(key=lambda a: a['delta'] if a['delta'] is not None else 0)
            else:
                slot_locked.sort(key=lambda a: a['delta'] if a['delta'] is not None else 0, reverse=True)

            # Cap to top_n biggest improvements per slot — same rule as the
            # non-owned pass, applied identically across all opt_types so the
            # popup never has to scroll past the highest-impact upgrade.
            # See slot-alternatives-notes/T2-scope.md decision #1.
            # Quality preservation: same expansion as the non-owned cap
            # so all quality variants of base items in the cap stay
            # together. User 2026-05-19 regression.
            if top_n is not None and len(slot_locked) > top_n:
                kept = list(slot_locked[-top_n:])
                kept_base_names = {
                    _base_name_strip_quality(a.get('name', '')) for a in kept
                }
                kept_ids = {id(a) for a in kept}
                for a in slot_locked[:-top_n]:
                    if _base_name_strip_quality(a.get('name', '')) in kept_base_names \
                            and id(a) not in kept_ids:
                        kept.append(a)
                # Mirror the primary_reverse branch (same as the non-owned
                # cap) so capped slots render smallest→biggest like the
                # un-capped ones. Was unconditional reverse=True.
                if primary_reverse:
                    kept.sort(key=lambda a: a['delta'] if a.get('delta') is not None else 0)
                else:
                    kept.sort(key=lambda a: a['delta'] if a.get('delta') is not None else 0, reverse=True)
                slot_locked = kept

            locked_alternatives[slot] = slot_locked
            print(f"  {slot}: {len(slot_locked)} owned-but-locked alternatives found")
        else:
            print(f"  {slot}: No owned-but-locked alternatives")
    
    locked_total = sum(len(v) for v in locked_alternatives.values())
    print(f"\nFound {locked_total} locked alternatives across {len(locked_alternatives)} slots")

    # ---- Required-but-locked keyword detection -------------------------------
    # The score-better loop above only surfaces a locked item when a SINGLE slot
    # swap both passes is_valid() AND scores better. That structurally misses
    # multi-count keyword REQUIREMENTS (e.g. an underwater activity needs 3x
    # advanced diving gear): the optimizer can't equip the locked gear, so the
    # gearset has 0 of the keyword, and swapping in one piece still fails
    # is_valid (1 < 3) -> the gear never reaches locked_alternatives and the
    # "you own the required gear but it's locked behind a custom stat" toast
    # never fires (reported 2026-06-25, bug 77a7021e).
    #
    # Detect it explicitly: for each REQUIRED keyword the optimized gearset
    # can't satisfy, find owned items carrying that keyword that are locked
    # specifically due to a custom stat (activity_completion / access) and feed
    # them to the toast flagged is_requirement=True. Lock status is read through
    # the item's own is_unlocked / get_custom_stats_requirements, which honor
    # character.custom_stats (the UI toggle), so this fires ONLY when the stat
    # is genuinely unchecked — not for users who have completed the requirement.
    try:
        if opt_type == 'activity' and activity is not None:
            _req_keyword_counts = dict(activity.requirements.get('keyword_counts', {}) or {})
        elif opt_type == 'recipe' and service is not None:
            _req_keyword_counts = dict(service.requirements.get('keyword_counts', {}) or {})
        else:
            _req_keyword_counts = {}
    except Exception:
        _req_keyword_counts = {}

    if _req_keyword_counts:
        def _norm_kw(s):
            return str(s).lower().replace('_', ' ').strip()

        # How many of each required keyword the optimized gearset already equips.
        _equipped_kw_counts = {}
        for _it in final_gearset.values():
            if not _it or not hasattr(_it, 'keywords') or not _it.keywords:
                continue
            for _kw in _it.keywords:
                _nk = _norm_kw(_kw)
                _equipped_kw_counts[_nk] = _equipped_kw_counts.get(_nk, 0) + 1

        # Base names already present in locked_alternatives (avoid duplicates).
        _existing_locked_bases = set()
        for _entries in locked_alternatives.values():
            for _e in _entries:
                _existing_locked_bases.add(_base_name_strip_quality(_e.get('name', '')))

        _quality_to_rarity = {
            'Eternal': 'ethereal', 'Perfect': 'legendary', 'Excellent': 'epic',
            'Great': 'rare', 'Good': 'uncommon', 'Normal': 'common',
        }

        # Collected separately from the locked (yellow-toast) entries: required
        # keywords the user owns ZERO gear for. These can't be unlocked via a
        # custom stat — the user simply doesn't have the gear — so they drive a
        # RED "can't optimize, you don't own the required gear" toast instead.
        # Stashed under a reserved, non-slot key so it rides along to the toast
        # via slots_json['_locked_alternatives'] without touching any of the
        # optimize call sites. The frontend popover only ever reads this dict by
        # real slot name, so the reserved key is inert there.
        _unmet_required = []

        for _kw, _required in _req_keyword_counts.items():
            try:
                _required = int(_required)
            except (TypeError, ValueError):
                continue
            if _required <= 0:
                continue
            _nk = _norm_kw(_kw)
            if _equipped_kw_counts.get(_nk, 0) >= _required:
                continue  # requirement already satisfied — nothing to warn about

            _owned_with_kw = 0
            for _item, _qty in character.items.items():
                if _qty <= 0:
                    continue
                if not hasattr(_item, 'keywords') or not _item.keywords:
                    continue
                if not any(_norm_kw(_k) == _nk for _k in _item.keywords):
                    continue
                # The user owns at least one piece of gear for this keyword.
                _owned_with_kw += 1
                # Must be locked...
                if hasattr(_item, 'is_unlocked') and _item.is_unlocked(character, ignore_gear_requirements=True):
                    continue
                # ...specifically due to a custom stat (not skill / rep / AP — those
                # aren't toggleable in the Custom Stats popup, so the toast can't help).
                _cs_reqs = []
                if hasattr(_item, 'get_custom_stats_requirements'):
                    _cs_reqs = _item.get_custom_stats_requirements(character, ignore_gear_requirements=True)
                if not _cs_reqs:
                    continue

                _base = _base_name_strip_quality(getattr(_item, 'name', ''))
                if _base in _existing_locked_bases:
                    continue

                _islot = getattr(_item, 'slot', None)
                if not _islot:
                    continue
                if _islot == 'tool':
                    _islot = 'tools'
                _slot_key = _islot
                if _islot == 'ring':
                    _slot_key = 'ring1'
                elif _islot == 'tools':
                    _slot_key = 'tool0'

                _quality = getattr(_item, '_quality_name', None)
                if not _quality:
                    for _q in ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']:
                        if f'({_q})' in getattr(_item, 'name', ''):
                            _quality = _q
                            break
                _rarity = _quality_to_rarity.get(_quality, getattr(_item, 'rarity', 'common') or 'common')

                _missing = []
                if hasattr(_item, 'get_missing_requirements'):
                    _missing = _item.get_missing_requirements(character, ignore_gear_requirements=True)

                locked_alternatives.setdefault(_slot_key, []).append({
                    'name': _item.name,
                    'uuid': getattr(_item, 'uuid', None),
                    'quality': _quality,
                    'rarity': _rarity,
                    'slot': _slot_key,
                    'replaces': None,
                    'primary_metric': None,
                    'primary_display': None,
                    'old_value': None,
                    'new_value': None,
                    'delta': None,
                    'delta_pct': None,
                    'missing_requirements': _missing,
                    'is_locked': True,
                    'is_custom_stats_locked': True,
                    'custom_stats_needed': [r['stat_id'] for r in _cs_reqs],
                    # Distinguishes the toast copy: this gear is REQUIRED for the
                    # activity (not merely a better-stats upgrade).
                    'is_requirement': True,
                    'required_keyword': _kw,
                })
                _existing_locked_bases.add(_base)
                print(f"  [required-locked] {_item.name} carries required '{_kw}' "
                      f"but is custom-stats-locked ({[r['stat_id'] for r in _cs_reqs]})")

            # The requirement is unmet AND the user owns no gear carrying the
            # keyword at all -> red "you don't own the required gear" toast.
            if _owned_with_kw == 0:
                _unmet_required.append({
                    'keyword': _kw,
                    'required': _required,
                    'reason': 'not_owned',
                })
                print(f"  [unmet-required] '{_kw}' x{_required} required but user owns none")

        if _unmet_required:
            # Reserved, non-slot key — see comment above.
            locked_alternatives['__unmet_required__'] = _unmet_required

    return alternatives, locked_alternatives

def save_result_to_db(response_data, session_uuid, db_path, sorting_priority, opt_type):
    """Save optimization result directly to the database.
    
    This allows the worker to persist results even if the parent uvicorn
    process restarts (e.g., due to --reload after a git pull).

    Returns the persisted gearset dict (with 'id' and 'name') on success, or
    None. The local (Pyodide) path uses the returned id to render the result
    deterministically — save_gear_set upserts optimized gearsets BY NAME, so a
    re-optimize reuses the same id and the "new gearset id" poll detection can
    never see it (bug 30add94e symptom #1).
    """
    from datetime import datetime

    saved_gearset = None
    try:
        if not response_data.get('success'):
            print(f"Optimization failed, not saving to DB: {response_data.get('error')}")
            return None
        
        from ui.database import DatabaseManager
        db = DatabaseManager(db_path)
        
        # Generate gearset name (same logic as app.py)
        activity_name = response_data.get('activity_name') or response_data.get('recipe_name', 'Unknown')
        date_str = datetime.now().strftime('%Y-%m-%d %H:%M')
        
        # Get sorting priority names
        sort_names = []
        if sorting_priority:
            from util.walkscape_constants import (
                Sorting as SortingEnum,
                xy_entry_to_sorting_entry,
                xy_activity_entry_to_sorting_entry,
            )
            metric_names = {}
            for s in SortingEnum:
                metric_names[s.metric_key] = s.display_name.replace('Minimize ', '').replace(' (or target item)', '').replace(' (of all skills)', '').replace(' for X Quality', '')
            metric_key_aliases = {'current_steps': 'expected_steps_per_item'}

            def _entry_metric_key(entry):
                """Extract a metric key from any sorting entry shape.

                Supports three forms:
                  - plain string (legacy)
                  - [key, weight, target] tuple/list (legacy)
                  - {mode, x, y, ...} dict (new X-per-Y form, recipe OR activity)

                Dict entries get translated via xy_entry_to_sorting_entry
                (recipe) with fallback to xy_activity_entry_to_sorting_entry
                so the display code can look up either kind. Without this
                branch, `m[0]` raises KeyError on dicts and the whole save
                crashes, leaving the UI stuck on "Optimization failed".
                """
                if isinstance(entry, dict):
                    se = xy_entry_to_sorting_entry(entry)
                    if se is None:
                        se = xy_activity_entry_to_sorting_entry(entry)
                    return se.sort.metric_key if se is not None else None
                if isinstance(entry, (list, tuple)) and entry:
                    return entry[0] if isinstance(entry[0], str) else None
                if isinstance(entry, str):
                    return entry
                return None

            sort_names = []
            for m in sorting_priority[:2]:
                key = _entry_metric_key(m)
                if not key:
                    continue
                aliased = metric_key_aliases.get(key, key)
                sort_names.append(metric_names.get(aliased, key))
        
        if sort_names:
            sort_str = f" [{' > '.join(sort_names)}]"
        else:
            if opt_type == 'activity':
                sort_str = " [Steps/Reward > XP/Step]"
            else:
                sort_str = " [Materials > Steps]"
        
        gearset_name = f"{activity_name} - {date_str}{sort_str}"
        
        # Check for duplicate names
        existing_names = {gs['name'] for gs in db.get_gear_sets(session_uuid)}
        if gearset_name in existing_names:
            counter = 1
            while f"{gearset_name} ({counter})" in existing_names:
                counter += 1
            gearset_name = f"{gearset_name} ({counter})"
        
        export_string = response_data['gearset_export']
        
        # Build slots_json — only consumable info needed
        # Generic items are resolved from store by generic::item::UUID on frontend load
        slots_json = {}
        
        if response_data.get('consumable'):
            consumable_info = response_data['consumable']
            from ui.catalog import ItemCatalog
            catalog = ItemCatalog()
            
            def find_in_catalog(obj, name, item_type=None):
                if isinstance(obj, dict):
                    if obj.get('name') == name and (item_type is None or obj.get('type') == item_type):
                        return obj
                    for value in obj.values():
                        result = find_in_catalog(value, name, item_type)
                        if result:
                            return result
                elif isinstance(obj, list):
                    for item in obj:
                        result = find_in_catalog(item, name, item_type)
                        if result:
                            return result
                return None
            
            consumable_item = find_in_catalog(catalog.categories, consumable_info['name'], 'consumable')
            if consumable_item:
                slots_json['consumable'] = {
                    'itemId': consumable_item.get('id'),
                    'name': consumable_item.get('name'),
                    'icon_path': consumable_item.get('icon_path'),
                    'rarity': consumable_item.get('rarity', 'common'),
                    'stats': consumable_item.get('stats', {}),
                    'slot': 'consumable',
                    'type': 'consumable',
                    'keywords': consumable_item.get('keywords', []),
                }
            else:
                # Try fine consumable
                is_fine = consumable_info['name'].endswith('(Fine)')
                if is_fine:
                    base_name = consumable_info['name'].replace(' (Fine)', '')
                    base_item = find_in_catalog(catalog.categories, base_name, 'consumable')
                    if base_item:
                        slots_json['consumable'] = {
                            'itemId': base_item.get('id') + '_fine',
                            'name': consumable_info['name'],
                            'icon_path': base_item.get('icon_path'),
                            'rarity': 'fine',
                            'stats': base_item.get('stats_fine', base_item.get('stats', {})),
                            'slot': 'consumable',
                            'type': 'consumable',
                            'is_fine': True,
                            'keywords': base_item.get('keywords', []),
                        }
        
        if response_data.get('pet'):
            pet_info = response_data['pet']
            from ui.catalog import ItemCatalog
            if 'catalog' not in dir():
                catalog = ItemCatalog()
            
            def find_in_catalog_local(obj, name, item_type=None):
                if isinstance(obj, dict):
                    if obj.get('name') == name and (item_type is None or obj.get('type') == item_type):
                        return obj
                    for value in obj.values():
                        result = find_in_catalog_local(value, name, item_type)
                        if result:
                            return result
                elif isinstance(obj, list):
                    for item in obj:
                        result = find_in_catalog_local(item, name, item_type)
                        if result:
                            return result
                return None
            
            pet_catalog_item = find_in_catalog_local(catalog.categories, pet_info['name'], 'pet')
            if pet_catalog_item:
                pet_level = pet_info.get('level', 1)
                pet_max_level = pet_catalog_item.get('max_level', 3)
                pet_variant = pet_info.get('variant') or 'normal'
                # Determine correct icon based on level (not egg) + user's variant
                pet_base = pet_info['name'].lower()
                is_adult = pet_level >= pet_max_level if pet_max_level > 0 else pet_level >= 3
                if is_adult:
                    pet_icon = f"/assets/icons/items/pets/{pet_base}_adult_{pet_variant}.svg"
                else:
                    pet_icon = f"/assets/icons/items/pets/{pet_base}_juvenile_{pet_variant}.svg"
                
                slots_json['pet'] = {
                    'itemId': pet_catalog_item.get('id'),
                    'name': pet_catalog_item.get('name'),
                    'icon_path': pet_icon,
                    'slot': 'pet',
                    'type': 'pet',
                    'rarity': 'common',
                    'level': pet_level,
                    'variant': pet_variant,
                    'max_level': pet_max_level,
                    'levels': pet_catalog_item.get('levels', {}),
                    'stats': (pet_catalog_item.get('levels', {}).get(str(pet_level), {}) or {}).get('stats', {}),
                    'useAbility': pet_info.get('useAbility', False),
                }
        
        # Store alternatives in slots_json if present.
        # Use `is not None` (not truthy) so empty dicts are preserved — this lets
        # the client distinguish "alternatives computed but none found" from
        # "alternatives never computed".
        if response_data.get('alternatives') is not None:
            slots_json['_alternatives'] = response_data['alternatives']
        if response_data.get('locked_alternatives') is not None:
            slots_json['_locked_alternatives'] = response_data['locked_alternatives']
        
        db.save_gear_set(
            session_uuid=session_uuid,
            name=gearset_name,
            slots_json=slots_json,
            export_string=export_string,
            is_optimized=True
        )
        
        # Verify the save worked by reading it back
        saved_gearsets = db.get_gear_sets(session_uuid)
        saved_match = [gs for gs in saved_gearsets if gs['name'] == gearset_name]
        if saved_match:
            gs = saved_match[0]
            saved_gearset = gs
            print(f"✓ Worker saved gearset to DB: {gearset_name}")
            print(f"  DB id: {gs['id']}, created_at: {gs['created_at']}, is_optimized: {gs['is_optimized']}")
        else:
            print(f"⚠ Worker called save_gear_set but gearset NOT found in DB after save!")
            print(f"  Expected name: {gearset_name}")
            print(f"  All gearset names: {[gs['name'] for gs in saved_gearsets]}")
        
        # If there's a requirements warning, store it in the gearset metadata
        if response_data.get('requirements_warning'):
            # Update the gearset with the warning flag
            try:
                gearsets = db.get_gear_sets(session_uuid)
                for gs in gearsets:
                    if gs['name'] == gearset_name:
                        existing_slots = gs.get('slots_json', {})
                        if isinstance(existing_slots, str):
                            existing_slots = json.loads(existing_slots)
                        existing_slots['_requirements_warning'] = True
                        conn = db._get_connection()
                        # Sanitize to prevent inf/nan from breaking JSON serialization
                        from ui.database import _sanitize_for_json
                        conn.execute(
                            "UPDATE gear_sets SET slots_json = ? WHERE id = ? AND session_uuid = ?",
                            (json.dumps(_sanitize_for_json(existing_slots)), gs['id'], session_uuid)
                        )
                        conn.commit()
                        break
            except Exception as warn_err:
                print(f"⚠ Failed to save requirements warning: {warn_err}")
        
        # Clean up active optimization record
        db.finish_optimization(session_uuid)
        print(f"✓ Cleared active optimization for {session_uuid}")
        
    except Exception as e:
        import traceback
        print(f"⚠ Worker failed to save to DB: {e}")
        print(traceback.format_exc())
        # Still try to clean up the active optimization record
        try:
            from ui.database import DatabaseManager
            db = DatabaseManager(db_path)
            db.finish_optimization(session_uuid)
        except Exception:
            pass

    return saved_gearset


def main():
    # Sleep for my own grabbing of files testing
    # sleep(5)
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No input file specified'}))
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    # Parse optional --db-save flag for direct DB persistence
    db_save_session = None
    db_save_path = None
    db_save_sorting = None
    if '--db-save' in sys.argv:
        idx = sys.argv.index('--db-save')
        if idx + 2 < len(sys.argv):
            db_save_session = sys.argv[idx + 1]
            db_save_path = sys.argv[idx + 2]
        if idx + 3 < len(sys.argv):
            try:
                db_save_sorting = json.loads(sys.argv[idx + 3])
            except (json.JSONDecodeError, IndexError):
                db_save_sorting = []
    
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
        target_drop_rate = request.get('target_drop_rate', 0)
        target_quality = request.get('target_quality', 'Perfect')
        service_id = request.get('service_id')
        sorting_priority = request.get('sorting_priority', [])
        include_consumables = request.get('include_consumables', False)
        include_pets = request.get('include_pets', False)
        instant_actions = request.get('instant_actions', False)  # Instant-actions optimization mode
        pet_ability_stats = request.get('pet_ability_stats', False)  # Ability-stats pet mode (e.g. Tiger hunting buff)
        budget_materials = request.get('budget_materials', 0)
        budget_target = request.get('budget_target', 0)
        locked_slots = request.get('locked_slots', {})
        selected_location = request.get('selected_location')
        input_items_raw = request.get('input_items', {})
        use_fine_inputs = request.get('use_fine_inputs', False)
        # Tree-node opt-in toggles (default off — matches the long-
        # standing behavior of the crafting_tree_node paths). When the
        # user turns these on in the global settings panel, the
        # tree-node activity/recipe optimizers consider pets/consumables
        # alongside gear/tools/rings instead of leaving those slots
        # empty.
        optimize_pets_flag = bool(request.get('optimize_pets', False))
        optimize_consumables_flag = bool(request.get('optimize_consumables', False))
        # User-reported 2026-05-15: "OPTIMIZE PETS AND CONSUMABLES DOES
        # NOT WORK STILL". Print the resolved flags + raw include_*
        # request keys so the engineer can correlate the worker log
        # to the request payload. Always logged (no debug gate) so
        # we don't have to ask the user to flip a flag mid-debug.
        print(f"[ct-worker] flags resolved: optimize_pets={optimize_pets_flag} "
              f"optimize_consumables={optimize_consumables_flag} "
              f"include_pets={request.get('include_pets')} "
              f"include_consumables={request.get('include_consumables')}",
              flush=True)
        
        # Parse sorting_priority: supports three formats:
        #   - Old legacy: plain strings
        #   - Tuple legacy: [key, weight, target]
        #   - New dict form: {mode, x, y, weight, quality, targetItem, ...}
        # The new dict form is what recipe sorting uses after the X-per-Y redesign.

        # Filter helper: for non-quality recipes (e.g. bake bread, twine,
        # fry a perch) every quality tier scores as `float('inf')` (the
        # target-quality percentage is 0%). That means ANY gearset ties
        # on the quality metrics, and the local-search comparator can't
        # tell two candidates apart — effectively freezing the search
        # on whatever the greedy init happened to pick. By dropping
        # y=quality entries (and their legacy equivalents) before the
        # optimizer sees them, the user's next priority (e.g. materials
        # per craft) becomes the actual primary score.
        LEGACY_QUALITY_KEYS = {'materials_for_target', 'steps_for_target', 'total_crafts'}

        def filter_sorting_for_non_quality_recipe(sorting_priority):
            """Drop y=quality entries so non-quality recipes use real metrics.

            Both the new dict form (mode=ratio, y=quality) and the legacy
            tuple/string form (keys in LEGACY_QUALITY_KEYS) are filtered.
            Other entries pass through untouched.
            """
            if not sorting_priority:
                return sorting_priority
            filtered = []
            dropped = 0
            for entry in sorting_priority:
                if isinstance(entry, dict) and entry.get('mode') == 'ratio' and entry.get('y') == 'quality':
                    dropped += 1
                    continue
                if isinstance(entry, (list, tuple)) and entry and isinstance(entry[0], str) and entry[0] in LEGACY_QUALITY_KEYS:
                    dropped += 1
                    continue
                if isinstance(entry, str) and entry in LEGACY_QUALITY_KEYS:
                    dropped += 1
                    continue
                filtered.append(entry)
            if dropped > 0:
                print(f"[worker] Dropped {dropped} quality-targeted sorting entries (non-quality recipe)")
            return filtered

        def parse_sorting_priority(sorting_priority):
            """Convert the UI sorting_priority payload into a List[SortingEntry].
            
            Input shape: list of entries where each entry is either
              - a plain string metric key (old legacy format)
              - a [key, weight] tuple
              - a [key, weight, target] tuple
              - a new-form dict {mode, x, y, weight, quality, targetItem,
                budgetMats, budgetTarget, hiddenInQuick} (recipe only)
            
            Each input entry becomes one SortingEntry. Duplicates with
            different targets are preserved (this is the whole point of
            the rewrite: duplicable metrics like steps_per_reward_roll
            can appear twice with different category targets, and we
            must NOT collapse them).
            
            For new-form dict entries, `hiddenInQuick` is ignored by the
            optimizer (it's a UI-only concept). Novel X/Y combinations
            that don't yet map to a scored metric are silently skipped.
            
            Returns:
                (priority_entries, legacy_weights_dict) where:
                - priority_entries: List[SortingEntry] in input order
                - legacy_weights_dict: Dict[Sorting, int] — retained for
                  any downstream code that still reads a flat weights
                  dict (e.g. is_better_with_floors fallback). When a
                  Sorting enum appears in multiple entries, the first
                  entry's weight wins; per-entry weights on the
                  SortingEntry itself are authoritative.
            """
            from util.walkscape_constants import (
                Sorting,
                SortingEntry,
                xy_entry_to_sorting_entry,
                xy_activity_entry_to_sorting_entry,
            )
            
            # Aliases for backward compatibility (UI may send old metric keys)
            METRIC_KEY_ALIASES = {
                'current_steps': 'expected_steps_per_item',  # Steps/Craft now uses expected_steps_per_item
            }

            # Deprecated activity metric keys. When we see these in an activity
            # sorting list, remap to steps_per_reward_roll with the matching category.
            DEPRECATED_ACTIVITY_MIGRATION = {
                'steps_for_fine_material': ('steps_per_reward_roll', 'cat:fine'),
                'steps_for_collectible': ('steps_per_reward_roll', 'cat:collectibles'),
                'steps_for_chest': ('steps_per_reward_roll', 'cat:chests'),
            }
            
            # Build a lookup from metric_key → Sorting enum once.
            sorting_by_metric_key = {s.metric_key: s for s in Sorting}

            priority_entries = []
            legacy_weights = {}
            for entry in sorting_priority:
                # New X-per-Y dict form. Recipe and activity dicts share
                # the same shape but different X/Y catalogs — try recipe
                # bridge first, fall back to activity bridge. The two
                # tables only overlap on (xp, action) → PRIMARY_XP and
                # produce identical SortingEntry results there, so the
                # order doesn't matter for shared entries.
                if isinstance(entry, dict) and entry.get('mode') in ('ratio', 'budget'):
                    se = xy_entry_to_sorting_entry(entry)
                    if se is None:
                        se = xy_activity_entry_to_sorting_entry(entry)
                    if se is None:
                        # Novel X/Y combo that doesn't map to a scored metric yet.
                        # Keep the entry on the session (the UI still shows it)
                        # but skip it from the active priority list.
                        continue
                    priority_entries.append(se)
                    legacy_weights.setdefault(se.sort, se.weight)
                    continue

                # Legacy tuple / string form (activity sorting, and recipe
                # sorting that wasn't migrated yet).
                if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                    key = entry[0]
                    weight = int(entry[1])
                    target = entry[2] if len(entry) >= 3 else None
                elif isinstance(entry, str):
                    key, weight, target = entry, 100, None
                else:
                    continue

                # Apply aliases
                key = METRIC_KEY_ALIASES.get(key, key)

                # Apply deprecated metric migration (activity-only metrics)
                if key in DEPRECATED_ACTIVITY_MIGRATION:
                    new_key, new_target = DEPRECATED_ACTIVITY_MIGRATION[key]
                    key = new_key
                    if not target:
                        target = new_target
                
                # Clamp weight to 0-100
                weight = max(0, min(100, weight))
                
                sort = sorting_by_metric_key.get(key)
                if sort is None:
                    continue
                
                priority_entries.append(SortingEntry(sort=sort, target=target, weight=weight))
                # Fill legacy weights dict only if the enum isn't already
                # present, so duplicate entries don't trample each other.
                legacy_weights.setdefault(sort, weight)
            
            return priority_entries, legacy_weights
        
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
        # Crafted items ticked in column 1 (user_overrides has=True) often arrive
        # with NO quality. Adding them under the bare item_id resolves to the
        # stat-less CraftedItem BASE object (no is_unlocked / custom-stats /
        # equippable stats), so the optimizer never selects them and the
        # locked-gear toast never fires. Detect craftedness so we can default
        # such items to Normal quality below. (bug 4445d4cc / f7bf00c8)
        from util.autogenerated.equipment import CraftedItem as _CraftedItem
        from util.character_export_util import get_item_from_export_name as _get_item_by_export
        _crafted_cache = {}

        def _is_crafted_item(_iid):
            if _iid not in _crafted_cache:
                try:
                    _crafted_cache[_iid] = isinstance(_get_item_by_export(_iid), _CraftedItem)
                except Exception:
                    _crafted_cache[_iid] = False
            return _crafted_cache[_iid]

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
                # No explicit quality/ring data. A CRAFTED item here (e.g. the
                # user just ticked it in column 1 without importing a quality)
                # must default to Normal so it resolves to a real quality
                # variant instead of the unusable CraftedItem base object.
                if _is_crafted_item(item_id):
                    suffix = quality_to_suffix.get('Normal', '_common')
                    export_name = f"{item_id}{suffix}"
                    qty = state.get('ring_quantity', 1)
                    minimal_export['inventory'][export_name] = (
                        minimal_export['inventory'].get(export_name, 0) + qty
                    )
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
                # Respect hide_fine — if user has hidden the fine variant
                # (via the "Hide Fine" checkbox or via the eye icon, which
                # toggles both `hide` and `hide_fine`), skip injecting the
                # fine consumable. Without this check, hiding "fine creme
                # brulee" still let the optimizer pick it because the fine
                # variant was injected unconditionally.
                # Note: `hide` alone (without `hide_fine`) means the user
                # only hid the *normal* variant — fine should remain visible.
                if item_state.get('hide_fine'):
                    print(f"Skipping hidden fine consumable: {item_id}_fine")
                    continue
                # Try to find the fine version of this consumable
                fine_enum_name = item_id.upper() + '_FINE'
                if hasattr(Consumable, fine_enum_name):
                    fine_consumable = getattr(Consumable, fine_enum_name)
                    character._all_items[fine_consumable] = character._all_items.get(fine_consumable, 0) + 1
                    print(f"Added fine consumable to character: {fine_consumable.name}")
        
        # Build set of hidden items from ui_config (gear / materials /
        # consumables flagged hide / hide_fine). Shared with the goals
        # report worker + slot-alternatives panel via build_hidden_items_set.
        hidden_items = build_hidden_items_set(ui_config)
        print(f"Found {len(hidden_items)} hidden items from UI config")

        # 2026-06-18 (jwbail): the generic/community-item injection blocks
        # below (and the recipe path) reference `all_ui_items`, but it was
        # only ever a LOCAL var inside build_hidden_items_set() — never
        # defined in main(). So every generic-items load raised
        # `NameError: name 'all_ui_items' is not defined`, was swallowed as
        # "Failed to load generic items", and generic/community items were
        # silently never injected (surfaced in a prod bug report's forwarded
        # worker log). Reconstruct it here the same way build_hidden_items_set
        # does so both use-sites (the activity and recipe generic-item blocks)
        # actually run.
        _ui_items = ui_config.get('items', {}) or {}
        _user_override_items = (ui_config.get('user_overrides') or {}).get('items') or {}
        all_ui_items = {**_ui_items, **_user_override_items}

        # Set global character for optimization scripts
        import my_config
        my_config._CHARACTER_INSTANCE = character
        
        # Resolve locked slots to Item objects (shared by activity + recipe paths)
        locked_items = {}
        if locked_slots:
            from util.autogenerated.equipment import Item, CraftedItem
            
            # Quality name mappings (frontend may send either format)
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
            
            for slot_name, slot_info in locked_slots.items():
                # Null sentinel = user-unequipped this slot via the
                # popup. The frontend renders the slot empty; the
                # optimizer is free to re-pick on next run.
                if not slot_info or not isinstance(slot_info, dict):
                    continue
                item_id = slot_info.get('itemId')
                quality = slot_info.get('quality')
                if not item_id:
                    continue
                
                # Handle generic items (generic::item::<db_id>)
                if item_id.startswith('generic::item::'):
                    try:
                        from ui.database import DatabaseManager
                        from ui.generic_definitions import GenericDefinitionManager, GenericCraftedItem
                        gen_db = DatabaseManager(db_save_path) if db_save_path else None
                        if gen_db:
                            generic_db_id = item_id[len('generic::item::'):]
                            gen_def = gen_db.get_generic_definition('item', generic_db_id)
                            if gen_def:
                                found_item = GenericDefinitionManager.to_item_instance(gen_def)
                                # For crafted generic items, resolve quality variant
                                if isinstance(found_item, GenericCraftedItem) and quality:
                                    quality_attr = quality_name_to_attr.get(quality)
                                    if quality_attr and hasattr(found_item, quality_attr):
                                        found_item = getattr(found_item, quality_attr)
                                    else:
                                        found_item = found_item.NORMAL
                                if found_item:
                                    locked_items[slot_name] = found_item
                                    print(f"Locked slot {slot_name}: generic item {found_item.name}")
                                    continue
                    except Exception as e:
                        print(f"⚠ Error resolving generic item {item_id}: {e}")
                    continue
                
                # Handle consumable slot — look up from Consumable module, not Item
                if slot_name == 'consumable':
                    from util.autogenerated.consumables import Consumable as ConsumableLookup
                    found_item = None
                    # Try by_export_name first (handles exact enum names like SWEET_CARROT_PIE)
                    found_item = ConsumableLookup.by_export_name(item_id)
                    # If not found, search by name-based ID
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
                    # Handle Fine variant: quality="Fine" means use the _FINE version
                    if not found_item and quality and quality.lower() == 'fine':
                        found_item = ConsumableLookup.by_export_name(item_id + '_fine')
                    if found_item:
                        locked_items[slot_name] = found_item
                        print(f"Locked slot {slot_name}: {found_item.name}")
                    else:
                        print(f"⚠ Could not resolve locked consumable {slot_name}: itemId={item_id}, quality={quality}")
                    continue
                
                # Handle pet slot — look up from Pet module
                if slot_name == 'pet':
                    from util.autogenerated.pets import Pet as PetLookup, PETS_BY_NAME
                    found_item = None
                    # Try enum name first (e.g., 'camel' → Pet.CAMEL)
                    pet_enum_name = item_id.upper()
                    if hasattr(PetLookup, pet_enum_name):
                        found_item = getattr(PetLookup, pet_enum_name)
                    # Try by name lookup
                    if not found_item:
                        for pet_name, pet_levels in PETS_BY_NAME.items():
                            check_id = pet_name.lower().replace(' ', '_').replace("'", '')
                            if check_id == item_id:
                                found_item = pet_levels
                                break
                    # Resolve to specific level if quality contains level info
                    if found_item and hasattr(found_item, 'get_level'):
                        pet_level = None
                        if quality and quality.isdigit():
                            pet_level = int(quality)
                        # Also check slot_info for explicit level
                        level_from_info = slot_info.get('level')
                        if level_from_info is not None:
                            pet_level = int(level_from_info)
                        if pet_level:
                            level_info = found_item.get_level(pet_level)
                            if level_info:
                                found_item = level_info
                                print(f"Locked slot {slot_name}: {found_item.name} (Level {pet_level})")
                            else:
                                # Fall back to highest available level
                                all_levels = found_item.get_all_levels()
                                if all_levels:
                                    highest = max(all_levels.keys())
                                    found_item = all_levels[highest]
                                    print(f"Locked slot {slot_name}: {found_item.name} (Level {highest}, requested {pet_level})")
                        else:
                            # No level specified — check character's pet data for this species
                            pet_species = item_id.lower()
                            char_pet_level = None
                            pets_data = character_config.get('pets', [])
                            if isinstance(pets_data, list):
                                for pd in pets_data:
                                    if isinstance(pd, dict) and pd.get('species', '').lower() == pet_species:
                                        char_pet_level = pd.get('level', 0)
                                        break
                            if char_pet_level and char_pet_level > 0:
                                level_info = found_item.get_level(char_pet_level)
                                if level_info:
                                    found_item = level_info
                                    print(f"Locked slot {slot_name}: {found_item.name} (Level {char_pet_level}, from character data)")
                                else:
                                    all_levels = found_item.get_all_levels()
                                    if all_levels:
                                        highest = max(all_levels.keys())
                                        found_item = all_levels[highest]
                                        print(f"Locked slot {slot_name}: {found_item.name} (Level {highest}, char level {char_pet_level} not in data)")
                            else:
                                # Truly no info — fall back to highest
                                all_levels = found_item.get_all_levels()
                                if all_levels:
                                    highest = max(all_levels.keys())
                                    found_item = all_levels[highest]
                                    print(f"Locked slot {slot_name}: {found_item.name} (Level {highest}, no level info)")
                    if found_item:
                        locked_items[slot_name] = found_item
                        if not hasattr(found_item, 'level'):
                            print(f"Locked slot {slot_name}: {found_item.name}")
                    else:
                        print(f"⚠ Could not resolve locked pet {slot_name}: itemId={item_id}, quality={quality}")
                    continue
                
                # Try Item.by_uuid first (works for actual UUIDs)
                rarity = quality_name_to_rarity.get(quality, quality) if quality else None
                found_item = Item.by_uuid(item_id, quality=rarity)
                
                # If by_uuid didn't find it, search by name-based ID
                if not found_item:
                    for attr_name in dir(Item):
                        if attr_name.startswith('_'):
                            continue
                        item = getattr(Item, attr_name)
                        if hasattr(item, 'name'):
                            check_id = item.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                            if check_id == item_id:
                                found_item = item
                                break
                
                # If we got a CraftedItem, resolve to the correct quality
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
                    print(f"Locked slot {slot_name}: {found_item.name}")
                else:
                    print(f"⚠ Could not resolve locked slot {slot_name}: itemId={item_id}, quality={quality}")
            
            if locked_items:
                print(f"Total locked slots: {len(locked_items)}")
        
        if opt_type == 'activity':
            from util.autogenerated.activities import Activity
            from util.autogenerated.materials import Material
            from util.autogenerated.equipment import Item
            import optimize_activity_gearsets
            from util.gearset_utils import encode_gearset
            
            # Find activity — check for generic:: prefix first
            activity = None
            if opt_id and opt_id.startswith('generic::'):
                generic_uuid = opt_id[len('generic::'):]
                try:
                    from ui.database import DatabaseManager
                    from ui.generic_definitions import GenericDefinitionManager
                    gen_db = DatabaseManager(db_save_path) if db_save_path else None
                    if gen_db:
                        gen_def = gen_db.get_generic_definition('activity', generic_uuid)
                        if gen_def:
                            activity = GenericDefinitionManager.to_activity_info(gen_def)
                            print(f"Loaded generic activity: {activity.name}")
                except Exception as e:
                    print(f"Error loading generic activity: {e}")
            
            if not activity:
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
                # Clean up active optimization record before exiting
                if db_save_session and db_save_path:
                    try:
                        from ui.database import DatabaseManager
                        db = DatabaseManager(db_save_path)
                        db.finish_optimization(db_save_session)
                    except Exception:
                        pass
                sys.stdout = old_stdout
                print(json.dumps({'success': False, 'error': f'Activity not found: {opt_id}'}))
                sys.exit(1)
            
            # Parse sorting priority early to extract per-entry target overrides
            if sorting_priority:
                priority_entries, weights_dict = parse_sorting_priority(sorting_priority)
                
                # Resolve each entry's category target into the concrete
                # target that the scorer expects (e.g. 'cat:chests' →
                # 'Agility chest' using this activity's drop table, or
                # 'primary_chest' synthetic fallback when no chest is in
                # the drop table). This MUST happen after the activity is
                # known and BEFORE the scorer runs, because otherwise the
                # generic 'cat:chests' synthetic uses a 0.4% base rate
                # that may not match the activity's real chest drop rate.
                priority_entries = [
                    _resolve_entry_target_for_activity(e, activity)
                    for e in priority_entries
                ]
                
                if priority_entries:
                    # Filter weight=0 entries from the priority list entirely.
                    # They are invisible to greedy, local search, and all comparisons.
                    # Keep them out of SORTING_PRIORITY so is_better() in greedy
                    # never sees them.
                    active_entries = [e for e in priority_entries if e.weight > 0]
                    optimize_activity_gearsets.SORTING_PRIORITY = active_entries if active_entries else priority_entries
                    optimize_activity_gearsets.SORTING_WEIGHTS = weights_dict
                
                # Pick the first steps_per_reward_roll entry's target as the
                # "headline" display target (used by the results panel).
                # The scorer already evaluates every entry independently
                # via composite keys — we just need the legacy
                # target_item set for the CLI display code path.
                for entry in priority_entries:
                    if entry.sort.metric_key == 'steps_per_reward_roll' and entry.target:
                        print(f"[worker] Headline display target (first SPR entry): {entry.target}")
                        target_item = entry.target
                        break
                
                # Log the full parsed priority so we can always see what
                # the optimizer is actually scoring against.
                print(f"[worker] Parsed sorting priority ({len(priority_entries)} entries):")
                for i, entry in enumerate(priority_entries):
                    print(f"  {i+1}. {entry!r}")
            
            # Parse target item — resolve categories to actual items/synthetic targets
            target_obj = None
            if target_item and target_item != 'raw_rewards':
                if isinstance(target_item, str) and target_item.startswith('cat:'):
                    # Use the shared resolver so category handling stays
                    # consistent with the priority-entry path above.
                    resolved = _resolve_category_target_for_activity(target_item, activity)
                    if resolved != target_item:
                        print(f"[worker] Resolved {target_item} to: {resolved!r}")
                    target_item = resolved

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
            optimize_activity_gearsets.TARGET_DROP_RATE = target_drop_rate
            optimize_activity_gearsets.VERBOSE = False
            print(f"[worker] TARGET_ITEM set to: {target_obj!r} (from request target_item: {target_item!r})")
            print(f"[worker] TARGET_DROP_RATE set to: {target_drop_rate!r}")
            optimize_activity_gearsets.IGNORED_ITEMS = hidden_items  # Use UI hide states
            optimize_activity_gearsets.INCLUDE_CONSUMABLES = include_consumables  # Use UI checkbox
            
            # Log consumable setting
            if include_consumables:
                print(f"Including consumables in optimization")
            else:
                print(f"Excluding consumables from optimization")
            
            # Collect consumables for the consumable slot
            # If consumable slot is locked, force it as the only option
            locked_consumable = locked_items.get('consumable')
            if locked_consumable:
                optimize_activity_gearsets.CONSUMABLE_ITEMS = [locked_consumable]
                optimize_activity_gearsets.INCLUDE_CONSUMABLES = True
                print(f"Consumable locked to: {locked_consumable.name} — skipping consumable search")
            elif include_consumables:
                consumable_items = []
                for item, qty in character.items.items():
                    if qty > 0 and hasattr(item, 'duration') and item not in hidden_items:
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
                # Not optimizing consumables — if one is directly sent AND include is false,
                # skip it entirely (user explicitly unchecked "include consumables")
                equipped_cons_direct = request.get('equipped_consumable')
                equipped_cons_slot = None  # Always initialize before any branch
                if not include_consumables and equipped_cons_direct:
                    print(f"Skipping directly-sent consumable (include_consumables=False): {equipped_cons_direct.get('name')}")
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = []
                    print(f"No consumable equipped, excluding from optimization")
                elif equipped_cons_direct and equipped_cons_direct.get('itemId'):
                    equipped_cons_slot = equipped_cons_direct
                    print(f"Using directly-sent equipped consumable: {equipped_cons_direct.get('name')}")
                else:
                    # Fallback to database
                    target_slot = request.get('target_slot')
                    if target_slot == 2:
                        current_gear = ui_config.get('gearset2', {})
                        print(f"Reading consumable from gearset2 (target_slot=2), consumable slot: {current_gear.get('consumable')}")
                    else:
                        current_gear = ui_config.get('currentGear', {})
                        print(f"Reading consumable from currentGear (target_slot={target_slot}), consumable slot: {current_gear.get('consumable')}")
                    equipped_cons_slot = current_gear.get('consumable')
                if equipped_cons_slot and isinstance(equipped_cons_slot, dict) and equipped_cons_slot.get('itemId'):
                    from util.autogenerated.consumables import Consumable as ConsumableLookup
                    cons_item_id = equipped_cons_slot['itemId']
                    found_cons = None
                    # Check for fine variant
                    is_fine = equipped_cons_slot.get('is_fine', False) or cons_item_id.endswith('_fine')
                    if is_fine:
                        base_id = cons_item_id.replace('_fine', '') if cons_item_id.endswith('_fine') else cons_item_id
                        fine_enum = base_id.upper() + '_FINE'
                        if hasattr(ConsumableLookup, fine_enum):
                            found_cons = getattr(ConsumableLookup, fine_enum)
                    if not found_cons:
                        found_cons = ConsumableLookup.by_export_name(cons_item_id)
                    if not found_cons:
                        for attr_name in dir(ConsumableLookup):
                            if attr_name.startswith('_'):
                                continue
                            cons = getattr(ConsumableLookup, attr_name)
                            if hasattr(cons, 'name'):
                                check_id = cons.name.lower().replace(' ', '_').replace('(', '').replace(')', '').replace('-', '_').replace("'", '')
                                if check_id == cons_item_id:
                                    found_cons = cons
                                    break
                    if found_cons:
                        locked_items['consumable'] = found_cons
                        optimize_activity_gearsets.CONSUMABLE_ITEMS = [found_cons]
                        optimize_activity_gearsets.INCLUDE_CONSUMABLES = True
                        print(f"Keeping equipped consumable locked: {found_cons.name}")
                    else:
                        optimize_activity_gearsets.CONSUMABLE_ITEMS = []
                        print(f"Could not resolve equipped consumable: {cons_item_id}")
                else:
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = []
                    print(f"No consumable equipped, excluding from optimization")
            
            # Collect pets for the pet slot
            equipped_pet_slot = None  # Initialize before the if/elif/else branches
            locked_pet = locked_items.get('pet')
            if locked_pet:
                optimize_activity_gearsets.PET_ITEMS = [locked_pet]
                optimize_activity_gearsets.INCLUDE_PETS = True
                print(f"Pet locked to: {locked_pet.name} — skipping pet search")
            elif include_pets:
                from util.autogenerated.pets import PETS_BY_NAME
                pet_items = []
                seen_species = set()  # Avoid duplicate (species, level) entries
                hidden_pet_ids = _get_hidden_pet_ids(ui_config)
                # Get owned pets from character config
                pets_data = character_config.get('pets', [])
                if isinstance(pets_data, list):
                    for pet_data in pets_data:
                        if not isinstance(pet_data, dict):
                            continue
                        species = pet_data.get('species', '').capitalize()
                        level = pet_data.get('level', 0)
                        if level <= 0:
                            continue  # Skip eggs
                        # Skip pets the user has hidden via column-1 eye icon.
                        if _species_to_pet_id(species) in hidden_pet_ids:
                            print(f"Skipping hidden pet: {species}")
                            continue
                        pet_levels = PETS_BY_NAME.get(species)
                        if pet_levels:
                            pet_info = pet_levels.get_level(level)
                            if pet_info:
                                key = (species, level)
                                if key in seen_species:
                                    continue
                                seen_species.add(key)
                                pet_items.append(pet_info)
                                print(f"Added pet for optimization: {pet_info.name} Level {level}")
                # Also pull pets from user_overrides (manually-set via Column 1 pet
                # level dropdown). This is critical for pets not yet in the user's
                # game export (e.g. a freshly released pet like Gecko).
                override_items = (ui_config.get('user_overrides') or {}).get('items') or {}
                for override_id, override_state in override_items.items():
                    if not isinstance(override_state, dict):
                        continue
                    # Only consider overrides explicitly marked as owned
                    if not override_state.get('has'):
                        continue
                    level = int(override_state.get('level') or 0)
                    if level <= 0:
                        continue
                    # Skip pets the user has hidden — override_id is the snake_case id.
                    if override_id in hidden_pet_ids:
                        print(f"Skipping hidden pet (override): {override_id}")
                        continue
                    # override_id is typically the lowercase species name (e.g. 'gecko')
                    species = str(override_id).capitalize()
                    pet_levels = PETS_BY_NAME.get(species)
                    if not pet_levels:
                        continue
                    key = (species, level)
                    if key in seen_species:
                        continue
                    pet_info = pet_levels.get_level(level)
                    if pet_info:
                        seen_species.add(key)
                        pet_items.append(pet_info)
                        print(f"Added pet from user_overrides: {pet_info.name} Level {level}")

                if pet_items:
                    optimize_activity_gearsets.PET_ITEMS = pet_items
                    optimize_activity_gearsets.INCLUDE_PETS = True
                    print(f"Added {len(pet_items)} pets as a slot option")
                else:
                    optimize_activity_gearsets.PET_ITEMS = []
                    optimize_activity_gearsets.INCLUDE_PETS = False
                    print(f"No pets available for optimization")
            else:
                # Not optimizing pets — if one is directly sent AND include is false,
                # skip it entirely (user explicitly unchecked "include pets")
                equipped_pet_direct = request.get('equipped_pet')
                equipped_pet_slot = None  # Always initialize before any branch
                if not include_pets and equipped_pet_direct:
                    print(f"Skipping directly-sent pet (include_pets=False): {equipped_pet_direct.get('name')}")
                    optimize_activity_gearsets.PET_ITEMS = []
                    optimize_activity_gearsets.INCLUDE_PETS = False
                    print(f"No pet equipped, excluding pets from optimization")
                elif equipped_pet_direct and equipped_pet_direct.get('itemId'):
                    equipped_pet_slot = equipped_pet_direct
                    print(f"Using directly-sent equipped pet: {equipped_pet_direct.get('name')}")
                else:
                    target_slot_pet = request.get('target_slot')
                    if target_slot_pet == 2:
                        current_gear = ui_config.get('gearset2', {})
                    else:
                        current_gear = ui_config.get('currentGear', {})
                    equipped_pet_slot = current_gear.get('pet')
                if equipped_pet_slot and isinstance(equipped_pet_slot, dict) and equipped_pet_slot.get('itemId'):
                    from util.autogenerated.pets import Pet as PetLookup, PETS_BY_NAME
                    pet_item_id = equipped_pet_slot['itemId']
                    pet_enum_name = pet_item_id.upper()
                    found_pet = None
                    if hasattr(PetLookup, pet_enum_name):
                        found_pet = getattr(PetLookup, pet_enum_name)
                    if not found_pet:
                        for pn, pl in PETS_BY_NAME.items():
                            if pn.lower().replace(' ', '_').replace("'", '') == pet_item_id:
                                found_pet = pl
                                break
                    if found_pet and hasattr(found_pet, 'get_level'):
                        pet_level = equipped_pet_slot.get('level')
                        if pet_level is None:
                            # Check character data
                            pets_data = character_config.get('pets', [])
                            if isinstance(pets_data, list):
                                for pd in pets_data:
                                    if isinstance(pd, dict) and pd.get('species', '').lower() == pet_item_id:
                                        pet_level = pd.get('level', 0)
                                        break
                        if pet_level and int(pet_level) > 0:
                            level_info = found_pet.get_level(int(pet_level))
                            if level_info:
                                # If useAbility is checked, merge ability stats into pet stats
                                use_ability = equipped_pet_slot.get('useAbility', False)
                                if use_ability and level_info.abilities:
                                    import copy
                                    level_info = copy.copy(level_info)
                                    merged_stats = copy.deepcopy(level_info._stats) if hasattr(level_info, '_stats') else {}
                                    for ability in level_info.abilities:
                                        ability_stats = ability.get('ability_stats', {})
                                        if ability_stats:
                                            for skill, locations in ability_stats.items():
                                                if skill not in merged_stats:
                                                    merged_stats[skill] = {}
                                                for location, stat_values in locations.items():
                                                    if location not in merged_stats[skill]:
                                                        merged_stats[skill][location] = {}
                                                    for stat, value in stat_values.items():
                                                        merged_stats[skill][location][stat] = merged_stats[skill][location].get(stat, 0) + value
                                            print(f"  Merged ability '{ability.get('name')}' stats into pet")
                                    level_info._stats = merged_stats
                                
                                locked_items['pet'] = level_info
                                optimize_activity_gearsets.PET_ITEMS = [level_info]
                                optimize_activity_gearsets.INCLUDE_PETS = True
                                print(f"Keeping equipped pet locked: {level_info.name} Level {pet_level}")
                            else:
                                optimize_activity_gearsets.PET_ITEMS = []
                                optimize_activity_gearsets.INCLUDE_PETS = False
                        else:
                            optimize_activity_gearsets.PET_ITEMS = []
                            optimize_activity_gearsets.INCLUDE_PETS = False
                    else:
                        optimize_activity_gearsets.PET_ITEMS = []
                        optimize_activity_gearsets.INCLUDE_PETS = False
                else:
                    optimize_activity_gearsets.PET_ITEMS = []
                    optimize_activity_gearsets.INCLUDE_PETS = False
                    print(f"No pet equipped, excluding pets from optimization")
            
            optimize_activity_gearsets.LOCKED_SLOTS = locked_items
            
            # Instant-actions mode: zero step stats and force-equip the relevant pet.
            # The pet must be owned at level 4+ and the skill must match.
            optimize_activity_gearsets.INSTANT_ACTIONS = False
            optimize_activity_gearsets.FORCED_PET = None
            # Ability-stats pet mode (e.g. Tiger "The Hunt Is On" for Hunting):
            # tracks whether we force-equipped an ability-stats pet so the
            # saved gearset's pet slot is marked useAbility=True (keeps the
            # displayed combined stats consistent with what the optimizer used).
            ability_stats_pet_active = False
            if instant_actions:
                from util.autogenerated.pets import get_instant_actions_pet, PETS_BY_NAME
                activity_skill = activity.primary_skill.lower() if activity and activity.primary_skill else ''
                ia_info = get_instant_actions_pet(activity_skill)
                if ia_info:
                    # Find the user's highest owned level >= required level
                    pet_name = ia_info['pet_name']
                    required_level = ia_info['required_level']
                    pet_levels_obj = PETS_BY_NAME.get(pet_name)
                    forced_pet_info = None
                    if pet_levels_obj:
                        pets_data = character_config.get('pets', [])
                        best_level = 0
                        if isinstance(pets_data, list):
                            for pd in pets_data:
                                if not isinstance(pd, dict):
                                    continue
                                species = pd.get('species', '').capitalize()
                                level = pd.get('level', 0)
                                if species == pet_name and level >= required_level and level > best_level:
                                    best_level = level
                        # Also check ui_config user_overrides (manually-set pet levels via UI dropdown)
                        pet_id = pet_name.lower()
                        override_items = ui_config.get('user_overrides', {}).get('items', {})
                        override_level = override_items.get(pet_id, {}).get('level', 0)
                        if override_level >= required_level and override_level > best_level:
                            best_level = override_level
                        if best_level >= required_level:
                            forced_pet_info = pet_levels_obj.get_level(best_level)
                    if forced_pet_info:
                        optimize_activity_gearsets.INSTANT_ACTIONS = True
                        optimize_activity_gearsets.FORCED_PET = forced_pet_info
                        # Override pet slot in locked_items so it's treated as locked
                        locked_items['pet'] = forced_pet_info
                        optimize_activity_gearsets.LOCKED_SLOTS = locked_items
                        print(f"Instant-actions mode: forcing {forced_pet_info.name} Level {forced_pet_info.level}, zeroing step stats")
                    else:
                        print(f"⚠ Instant-actions requested but {pet_name} not owned at level {required_level}+, ignoring flag")
                else:
                    print(f"⚠ Instant-actions requested but no matching pet for skill '{activity_skill}', ignoring flag")

            # Ability-stats pet mode (e.g. Tiger "The Hunt Is On" for Hunting):
            # force-equip the owned pet and merge its activatable ability stats
            # (work efficiency / double action / steps) into the pet's stats so
            # the optimizer scores with the buff in mind. Unlike instant-actions,
            # step-influencing stats are NOT zeroed. Mutually exclusive with
            # instant-actions (no skill has both kinds of pet).
            if pet_ability_stats and not optimize_activity_gearsets.INSTANT_ACTIONS:
                from util.autogenerated.pets import get_ability_stats_pet, PETS_BY_NAME as _AS_PETS_BY_NAME
                as_activity_skill = activity.primary_skill.lower() if activity and activity.primary_skill else ''
                as_info = get_ability_stats_pet(as_activity_skill)
                if as_info:
                    as_pet_name = as_info['pet_name']
                    as_required_level = as_info['required_level']
                    as_pet_levels_obj = _AS_PETS_BY_NAME.get(as_pet_name)
                    as_forced_pet = None
                    if as_pet_levels_obj:
                        # Find the user's highest owned level >= required level
                        best_level = 0
                        pets_data = character_config.get('pets', [])
                        if isinstance(pets_data, list):
                            for pd in pets_data:
                                if not isinstance(pd, dict):
                                    continue
                                species = pd.get('species', '').capitalize()
                                level = pd.get('level', 0)
                                if species == as_pet_name and level >= as_required_level and level > best_level:
                                    best_level = level
                        # Also check ui_config user_overrides (manually-set pet levels via UI dropdown)
                        as_pet_id = as_pet_name.lower()
                        as_override_items = ui_config.get('user_overrides', {}).get('items', {})
                        as_override_level = as_override_items.get(as_pet_id, {}).get('level', 0)
                        if as_override_level >= as_required_level and as_override_level > best_level:
                            best_level = as_override_level
                        if best_level >= as_required_level:
                            as_forced_pet = as_pet_levels_obj.get_level(best_level)
                    if as_forced_pet:
                        import copy as _as_copy
                        as_forced_pet = _as_copy.copy(as_forced_pet)
                        merged_stats = _as_copy.deepcopy(as_forced_pet._stats) if hasattr(as_forced_pet, '_stats') else {}
                        if as_forced_pet.abilities:
                            for ability in as_forced_pet.abilities:
                                a_stats = ability.get('ability_stats', {})
                                if a_stats:
                                    for skill, locations in a_stats.items():
                                        if skill not in merged_stats:
                                            merged_stats[skill] = {}
                                        for location, stat_values in locations.items():
                                            if location not in merged_stats[skill]:
                                                merged_stats[skill][location] = {}
                                            for stat, value in stat_values.items():
                                                merged_stats[skill][location][stat] = merged_stats[skill][location].get(stat, 0) + value
                        as_forced_pet._stats = merged_stats
                        optimize_activity_gearsets.FORCED_PET = as_forced_pet
                        locked_items['pet'] = as_forced_pet
                        optimize_activity_gearsets.LOCKED_SLOTS = locked_items
                        ability_stats_pet_active = True
                        print(f"Ability-stats mode: forcing {as_forced_pet.name} Level {as_forced_pet.level} with merged ability stats")
                    else:
                        print(f"⚠ pet_ability_stats requested but {as_pet_name} not owned at level {as_required_level}+, ignoring flag")
                else:
                    print(f"⚠ pet_ability_stats requested but no ability-stats pet for skill '{as_activity_skill}', ignoring flag")
            if selected_location:
                from util.autogenerated.locations import Location
                for attr_name in dir(Location):
                    if attr_name.startswith('_'):
                        continue
                    loc = getattr(Location, attr_name)
                    if hasattr(loc, 'name'):
                        # Match using same ID format as /api/activities endpoint
                        loc_id = loc.name.lower().replace(' ', '_').replace("'", '')
                        if loc_id == selected_location:
                            optimize_activity_gearsets.SELECTED_LOCATION = loc
                            print(f"Using user-selected location: {loc.name}")
                            break
                else:
                    print(f"⚠ Could not resolve selected location: {selected_location}")
            else:
                optimize_activity_gearsets.SELECTED_LOCATION = None
            
            # Resolve input items (e.g., arrows for hunting activities)
            resolved_input_item = None
            if input_items_raw and activity and hasattr(activity, 'input_items') and activity.input_items:
                from util.autogenerated.equipment import Item
                from util.autogenerated.materials import Material
                
                # Take the first input item (most activities have only one)
                for idx, item_info in input_items_raw.items():
                    if not item_info:
                        continue
                    item_name = item_info.get('name')
                    item_id = item_info.get('id')
                    export_name = item_info.get('export_name')
                    
                    # Try to resolve by export_name first
                    if export_name:
                        found = Item.by_export_name(export_name)
                        if not found:
                            found = Material.by_export_name(export_name) if hasattr(Material, 'by_export_name') else None
                        if found:
                            resolved_input_item = found
                            print(f"Resolved input item by export_name '{export_name}': {found.name}")
                            break
                    
                    # Try by UUID
                    if item_id and not resolved_input_item:
                        found = Item.by_uuid(item_id)
                        if found:
                            resolved_input_item = found
                            print(f"Resolved input item by UUID '{item_id}': {found.name}")
                            break
                    
                    # Try by name (iterate Items, then Materials)
                    if item_name and not resolved_input_item:
                        for attr_name in dir(Item):
                            if attr_name.startswith('_'):
                                continue
                            it = getattr(Item, attr_name)
                            if hasattr(it, 'name') and it.name == item_name:
                                resolved_input_item = it
                                print(f"Resolved input item by name (Item) '{item_name}': {it.name}")
                                break
                    
                    if item_name and not resolved_input_item:
                        for attr_name in dir(Material):
                            if attr_name.startswith('_'):
                                continue
                            mat = getattr(Material, attr_name)
                            if hasattr(mat, 'name') and mat.name == item_name:
                                resolved_input_item = mat
                                print(f"Resolved input item by name (Material) '{item_name}': {mat.name}")
                                break
                    
                    if resolved_input_item:
                        break
                    
                    if not resolved_input_item:
                        print(f"⚠ Could not resolve input item: {item_info}")
                
                if resolved_input_item:
                    # Handle fine inputs: if use_fine_inputs, try to find the fine version
                    if use_fine_inputs:
                        fine_name = resolved_input_item.name + ' (Fine)'
                        fine_found = None
                        # Search Items
                        for attr_name in dir(Item):
                            if attr_name.startswith('_'):
                                continue
                            it = getattr(Item, attr_name)
                            if hasattr(it, 'name') and it.name == fine_name:
                                fine_found = it
                                break
                        # Search Materials
                        if not fine_found:
                            for attr_name in dir(Material):
                                if attr_name.startswith('_'):
                                    continue
                                mat = getattr(Material, attr_name)
                                if hasattr(mat, 'name') and mat.name == fine_name:
                                    fine_found = mat
                                    break
                        if fine_found:
                            print(f"Using fine input: {fine_found.name}")
                            resolved_input_item = fine_found
                        else:
                            print(f"Fine version not found for '{resolved_input_item.name}', using normal")
            
            optimize_activity_gearsets.INPUT_ITEM = resolved_input_item
            optimize_activity_gearsets.USE_FINE_INPUTS = use_fine_inputs
            if resolved_input_item:
                print(f"[worker] INPUT_ITEM set to: {resolved_input_item.name}")
            else:
                print(f"[worker] INPUT_ITEM set to: None")
            
            # Inject generic items into character's item pool
            # Respect UI owned/hidden state: skip items where has=false or hide=true
            # Also load community items that the user has checked "has" on
            if db_save_path:
                try:
                    from ui.database import DatabaseManager as _DB
                    from ui.generic_definitions import GenericDefinitionManager as _GDM
                    from ui.sheets_sync import SHEET_SESSION_UUID as _SHEET_UUID
                    _gen_db = _DB(db_save_path)
                    
                    # Load user's own generic items
                    _gen_items = _gen_db.get_generic_items_by_session(db_save_session) if db_save_session else []
                    _own_ids = {gi.get('id', '') for gi in _gen_items}
                    
                    # Load sheet-sourced items (shared community data from Google Sheets)
                    _sheet_items = _gen_db.get_generic_items_by_session(_SHEET_UUID)
                    _sheet_ids = {gi.get('id', '') for gi in _sheet_items}
                    
                    # Load community items that the user checked "has" on
                    _community_items = []
                    for state_key, gi_state in all_ui_items.items():
                        if not state_key.startswith('generic::item::'):
                            continue
                        gi_id = state_key.replace('generic::item::', '')
                        if gi_id in _own_ids or gi_id in _sheet_ids:
                            continue  # Already in user's own or sheet items
                        if gi_state.get('has', False):  # Community defaults to False
                            # Load this community item from DB
                            community_gi = _gen_db.get_generic_item_by_id(gi_id)
                            if community_gi:
                                _community_items.append(community_gi)
                    
                    _all_gen = _gen_items + _sheet_items + _community_items
                    _gen_injected = 0
                    _gen_hidden = 0
                    _gen_skipped = 0
                    
                    # Check if activity has input items (only inject input-slot items if so)
                    _activity_has_inputs = hasattr(activity, 'input_items') and activity.input_items and len(activity.input_items) > 0
                    
                    for gi in _all_gen:
                        gi_id = gi.get('id', '')
                        
                        # Skip input-slot items if activity has no input requirements
                        if gi.get('slot') == 'input' and not _activity_has_inputs:
                            continue
                        
                        state_key = f"generic::item::{gi_id}"
                        gi_state = all_ui_items.get(state_key, {})
                        # Only inject items that are explicitly marked has=true in UI state
                        # Items with no state entry are not injected (user must check them)
                        if not gi_state.get('has', False):
                            _gen_skipped += 1
                            continue  # User hasn't checked this item
                        # Skip hidden items entirely (don't inject into character)
                        if gi_state.get('hide', False):
                            _gen_hidden += 1
                            continue
                        gi_instance = _GDM.to_item_instance(gi)
                        if hasattr(gi_instance, 'NORMAL'):
                            # Crafted: only add the quality selected in Column 1
                            # Quality is stored as rarity name (common/uncommon/rare/epic/legendary/ethereal)
                            RARITY_TO_QUALITY_ATTR = {
                                'common': 'NORMAL', 'uncommon': 'GOOD', 'rare': 'GREAT',
                                'epic': 'EXCELLENT', 'legendary': 'PERFECT', 'ethereal': 'ETERNAL',
                                # Also accept quality display names directly
                                'normal': 'NORMAL', 'good': 'GOOD', 'great': 'GREAT',
                                'excellent': 'EXCELLENT', 'perfect': 'PERFECT', 'eternal': 'ETERNAL',
                            }
                            selected_quality = gi_state.get('quality', 'common')
                            q_attr = RARITY_TO_QUALITY_ATTR.get((selected_quality or 'common').lower(), 'NORMAL')
                            variant = getattr(gi_instance, q_attr, None)
                            if variant:
                                character._all_items[variant] = 1
                            else:
                                # Fallback: add Normal if selected quality not found
                                fallback = getattr(gi_instance, 'NORMAL', None)
                                if fallback:
                                    character._all_items[fallback] = 1
                            
                            # For rings: also add ring2 quality if set
                            if gi.get('slot') == 'ring':
                                ring2_quality = gi_state.get('ring2_quality')
                                if ring2_quality and ring2_quality != 'None':
                                    q_attr2 = RARITY_TO_QUALITY_ATTR.get(ring2_quality.lower(), 'NORMAL')
                                    variant2 = getattr(gi_instance, q_attr2, None)
                                    if variant2:
                                        character._all_items[variant2] = character._all_items.get(variant2, 0) + 1
                        else:
                            character._all_items[gi_instance] = 1
                        _gen_injected += 1
                    if _all_gen:
                        print(f"Injected {_gen_injected} generic items into candidate pool"
                              f" ({_gen_skipped} unowned, {_gen_hidden} hidden, {len(_community_items)} community)")
                except Exception as e:
                    print(f"⚠ Failed to load generic items: {e}")
                    import traceback
                    traceback.print_exc()
            
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
            
            # Check if requirements are met (may fail with locked slots)
            if locked_items:
                from util.optimization_utils import meets_activity_requirements
                reqs_met = meets_activity_requirements(final_gearset, activity, character,
                                                       input_item=optimize_activity_gearsets.INPUT_ITEM)
                if not reqs_met:
                    result['requirements_warning'] = True
                    print(f"⚠ Gearset generated but activity requirements not met (locked slots)")
            
            # Add consumable info if one was selected
            if best_consumable:
                result['consumable'] = {
                    'name': best_consumable.name,
                    'id': best_consumable.id if hasattr(best_consumable, 'id') else None
                }
            
            # Add pet info if one was selected
            best_pet = final_gearset.get('pet')
            if best_pet:
                result['pet'] = {
                    'name': best_pet.name,
                    'level': best_pet.level if hasattr(best_pet, 'level') else 1,
                    'variant': _resolve_pet_variant_from_request(request, best_pet.name),
                    # When the column-3 ability-stats checkbox forced this pet
                    # (e.g. Tiger for Hunting), mark useAbility so the saved
                    # gearset's combined stats reflect the merged buff.
                    'useAbility': ability_stats_pet_active,
                }
            
            # Compute non-owned alternatives if enabled
            show_alternatives = request.get('show_non_owned_alternatives', False)
            print(f"[activity] show_non_owned_alternatives flag: {show_alternatives}")
            if show_alternatives:
                try:
                    alts, locked_alts = compute_slot_alternatives(
                        final_gearset, character, 'activity',
                        activity=activity, consumable=best_consumable,
                        sorting_priority=optimize_activity_gearsets.SORTING_PRIORITY,
                        sorting_weights=optimize_activity_gearsets.SORTING_WEIGHTS if hasattr(optimize_activity_gearsets, 'SORTING_WEIGHTS') else {},
                        target_item=target_obj, target_drop_rate=target_drop_rate,
                        selected_location=optimize_activity_gearsets.SELECTED_LOCATION,
                        input_item=optimize_activity_gearsets.INPUT_ITEM,
                        use_fine_inputs=use_fine_inputs,
                        hidden_items=hidden_items,
                    )
                    # Always set these (even as empty dict) so the client can
                    # distinguish "alternatives computed but none found" from
                    # "alternatives never computed". Without this, the popup
                    # keeps showing "Optimize Slot & Equip" even after the
                    # optimizer ran and returned zero results.
                    result['alternatives'] = alts if alts else {}
                    result['locked_alternatives'] = locked_alts if locked_alts else {}
                    total_alts = sum(len(v) for v in (alts or {}).values())
                    total_locked = sum(len(v) for v in (locked_alts or {}).values())
                    print(f"[activity] Found {total_alts} non-owned alternatives across {len(alts or {})} slots; "
                          f"{total_locked} locked across {len(locked_alts or {})} slots")
                except Exception as e:
                    import traceback
                    print(f"⚠ Failed to compute alternatives: {e}")
                    traceback.print_exc()
                    # Honor the "always set" contract above even on failure —
                    # downstream save block keys off `is not None`, so leaving
                    # them unset would silently drop them from slots_json. An
                    # empty dict tells the client "we tried, found nothing".
                    result['alternatives'] = {}
                    result['locked_alternatives'] = {}
            
            sys.stdout = old_stdout
            print(json.dumps(result))
            
        elif opt_type == 'recipe':
            import util.autogenerated.recipes as recipes_module
            from util.walkscape_constants import Service
            import optimize_craft_gearsets
            from util.gearset_utils import encode_gearset
            
            # Find recipe — check for generic:: prefix first
            recipe = None
            if opt_id and opt_id.startswith('generic::'):
                generic_uuid = opt_id[len('generic::'):]
                try:
                    from ui.database import DatabaseManager
                    from ui.generic_definitions import GenericDefinitionManager
                    gen_db = DatabaseManager(db_save_path) if db_save_path else None
                    if gen_db:
                        gen_def = gen_db.get_generic_definition('recipe', generic_uuid)
                        if gen_def:
                            recipe = GenericDefinitionManager.to_recipe_instance(gen_def)
                            print(f"Loaded generic recipe: {recipe.name}")
                except Exception as e:
                    print(f"Error loading generic recipe: {e}")
            
            if not recipe:
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
                # Clean up active optimization record before exiting
                if db_save_session and db_save_path:
                    try:
                        from ui.database import DatabaseManager
                        db = DatabaseManager(db_save_path)
                        db.finish_optimization(db_save_session)
                    except Exception:
                        pass
                sys.stdout = old_stdout
                print(json.dumps({'success': False, 'error': f'Recipe not found: {opt_id}'}))
                sys.exit(1)
            
            # Find service
            service = None
            recipe_needs_service = recipe.service and recipe.service.lower() != 'none'
            
            if not recipe_needs_service:
                # Recipe doesn't require a service (e.g., boxtrap)
                # Skip service lookup entirely, even if frontend sent a stale service_id
                service = None
                print(f"Recipe has no service requirement (service='{recipe.service}'), skipping service lookup")
            elif service_id:
                # Check for generic:: prefix first
                if service_id.startswith('generic::'):
                    generic_svc_uuid = service_id[len('generic::'):]
                    try:
                        from ui.database import DatabaseManager
                        from ui.generic_definitions import GenericDefinitionManager
                        gen_db = DatabaseManager(db_save_path) if db_save_path else None
                        if gen_db:
                            gen_svc_def = gen_db.get_generic_definition('service', generic_svc_uuid)
                            if gen_svc_def:
                                service = GenericDefinitionManager.to_service_instance(gen_svc_def)
                                print(f"Loaded generic service: {service.name}")
                    except Exception as e:
                        print(f"Error loading generic service: {e}")
                
                if not service:
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
                # Find best available service (only if recipe needs one).
                # Best-by-WE (mirrors the displayed service) rather than
                # first-in-dict-order, so gear is scoped to the location the
                # node reports. See _select_best_service_for_recipe (report
                # df39440d).
                if recipe_needs_service:
                    service = _select_best_service_for_recipe(recipe, character)

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
            optimize_craft_gearsets.BUDGET_MATERIALS = budget_materials
            optimize_craft_gearsets.BUDGET_TARGET = budget_target
            optimize_craft_gearsets.LOCKED_SLOTS = locked_items  # Use locked slots from UI
            # Tree-aware downstream cost. Cleared here so the regular
            # (non-tree) recipe optimizer never accidentally reads stale
            # specs left over from a previous tree-node run in the same
            # process. The tree-node branch sets these explicitly from
            # request['child_input_specs']. See module docstring.
            optimize_craft_gearsets.CHILD_INPUT_SPECS = []

            # Instant-actions mode for crafting (Tortoise / Smelting)
            optimize_craft_gearsets.INSTANT_ACTIONS = False
            optimize_craft_gearsets.FORCED_PET = None
            if instant_actions:
                from util.autogenerated.pets import get_instant_actions_pet, PETS_BY_NAME as _PETS_BY_NAME, SMELTING_RECIPE_NAMES
                recipe_skill = recipe.skill.lower() if recipe and recipe.skill else ''
                recipe_name = recipe.name if recipe and hasattr(recipe, 'name') else ''
                # For smithing, only allow smelting recipes
                if recipe_skill == 'smithing' and recipe_name not in SMELTING_RECIPE_NAMES:
                    print(f"⚠ Instant-actions requested but '{recipe_name}' is not a smelting recipe, ignoring flag")
                    instant_actions = False
                if instant_actions:
                    ia_info = get_instant_actions_pet(recipe_skill)
                    if ia_info:
                        pet_name = ia_info['pet_name']
                        required_level = ia_info['required_level']
                        pet_levels_obj = _PETS_BY_NAME.get(pet_name)
                        forced_pet_info = None
                        if pet_levels_obj:
                            pets_data = character_config.get('pets', [])
                            best_level = 0
                            if isinstance(pets_data, list):
                                for pd in pets_data:
                                    if not isinstance(pd, dict):
                                        continue
                                    species = pd.get('species', '').capitalize()
                                    level = pd.get('level', 0)
                                    if species == pet_name and level >= required_level and level > best_level:
                                        best_level = level
                            # Also check ui_config user_overrides (manually-set pet levels via UI dropdown)
                            pet_id = pet_name.lower()
                            override_items = ui_config.get('user_overrides', {}).get('items', {})
                            override_level = override_items.get(pet_id, {}).get('level', 0)
                            if override_level >= required_level and override_level > best_level:
                                best_level = override_level
                            if best_level >= required_level:
                                forced_pet_info = pet_levels_obj.get_level(best_level)
                        if forced_pet_info:
                            optimize_craft_gearsets.INSTANT_ACTIONS = True
                            optimize_craft_gearsets.FORCED_PET = forced_pet_info
                            locked_items['pet'] = forced_pet_info
                            optimize_craft_gearsets.LOCKED_SLOTS = locked_items
                            print(f"Instant-actions mode (craft): forcing {forced_pet_info.name} Level {forced_pet_info.level}, zeroing step stats")
                        else:
                            print(f"⚠ Instant-actions requested but {pet_name} not owned at level {required_level}+, ignoring flag")
                    else:
                        print(f"⚠ Instant-actions requested but no matching pet for skill '{recipe_skill}', ignoring flag")

            # Handle pet slot for recipe optimization (mirrors activity path)
            locked_pet = locked_items.get('pet')
            if locked_pet:
                optimize_craft_gearsets.PET_ITEMS = [locked_pet]
                optimize_craft_gearsets.INCLUDE_PETS = True
                print(f"Pet locked to: {locked_pet.name} — skipping pet search")
            elif include_pets:
                from util.autogenerated.pets import PETS_BY_NAME
                pet_items = []
                seen_species = set()
                hidden_pet_ids = _get_hidden_pet_ids(ui_config)
                pets_data = character_config.get('pets', [])
                if isinstance(pets_data, list):
                    for pet_data in pets_data:
                        if not isinstance(pet_data, dict):
                            continue
                        species = pet_data.get('species', '').capitalize()
                        level = pet_data.get('level', 0)
                        if level <= 0:
                            continue
                        # Skip pets the user has hidden via column-1 eye icon.
                        if _species_to_pet_id(species) in hidden_pet_ids:
                            print(f"Skipping hidden pet (craft): {species}")
                            continue
                        pet_levels = PETS_BY_NAME.get(species)
                        if pet_levels:
                            pet_info = pet_levels.get_level(level)
                            if pet_info:
                                key = (species, level)
                                if key in seen_species:
                                    continue
                                seen_species.add(key)
                                pet_items.append(pet_info)
                                print(f"Added pet for optimization: {pet_info.name} Level {level}")
                # Also pull pets from user_overrides (mirrors the activity path —
                # picks up pets the user manually toggled on via the Column 1
                # pet level dropdown, e.g. Gecko before it lands in the export).
                override_items = (ui_config.get('user_overrides') or {}).get('items') or {}
                for override_id, override_state in override_items.items():
                    if not isinstance(override_state, dict):
                        continue
                    if not override_state.get('has'):
                        continue
                    level = int(override_state.get('level') or 0)
                    if level <= 0:
                        continue
                    # Skip hidden pets — override_id is the snake_case id.
                    if override_id in hidden_pet_ids:
                        print(f"Skipping hidden pet (craft override): {override_id}")
                        continue
                    species = str(override_id).capitalize()
                    pet_levels = PETS_BY_NAME.get(species)
                    if not pet_levels:
                        continue
                    key = (species, level)
                    if key in seen_species:
                        continue
                    pet_info = pet_levels.get_level(level)
                    if pet_info:
                        seen_species.add(key)
                        pet_items.append(pet_info)
                        print(f"Added pet from user_overrides: {pet_info.name} Level {level}")
                if pet_items:
                    optimize_craft_gearsets.PET_ITEMS = pet_items
                    optimize_craft_gearsets.INCLUDE_PETS = True
                    print(f"Added {len(pet_items)} pets as a slot option")
                else:
                    optimize_craft_gearsets.PET_ITEMS = []
                    optimize_craft_gearsets.INCLUDE_PETS = False
                    print(f"No pets available for optimization")
            else:
                # include_pets=False — keep currently equipped pet if one is sent
                equipped_pet_direct = request.get('equipped_pet')
                if equipped_pet_direct and equipped_pet_direct.get('itemId'):
                    from util.autogenerated.pets import Pet as PetLookup, PETS_BY_NAME
                    pet_item_id = equipped_pet_direct['itemId']
                    found_pet = None
                    if hasattr(PetLookup, pet_item_id.upper()):
                        found_pet = getattr(PetLookup, pet_item_id.upper())
                    if not found_pet:
                        for pn, pl in PETS_BY_NAME.items():
                            if pn.lower().replace(' ', '_').replace("'", '') == pet_item_id:
                                found_pet = pl
                                break
                    if found_pet and hasattr(found_pet, 'get_level'):
                        pet_level = equipped_pet_direct.get('level')
                        if pet_level and int(pet_level) > 0:
                            level_info = found_pet.get_level(int(pet_level))
                            if level_info:
                                # If useAbility is checked, merge ability stats into pet stats
                                use_ability = equipped_pet_direct.get('useAbility', False)
                                if use_ability and level_info.abilities:
                                    import copy
                                    level_info = copy.copy(level_info)
                                    merged_stats = copy.deepcopy(level_info._stats) if hasattr(level_info, '_stats') else {}
                                    for ability in level_info.abilities:
                                        ability_stats = ability.get('ability_stats', {})
                                        if ability_stats:
                                            for skill, locations in ability_stats.items():
                                                if skill not in merged_stats:
                                                    merged_stats[skill] = {}
                                                for location, stat_values in locations.items():
                                                    if location not in merged_stats[skill]:
                                                        merged_stats[skill][location] = {}
                                                    for stat, value in stat_values.items():
                                                        merged_stats[skill][location][stat] = merged_stats[skill][location].get(stat, 0) + value
                                            print(f"  Merged ability '{ability.get('name')}' stats into pet (crafting)")
                                    level_info._stats = merged_stats
                                
                                locked_items['pet'] = level_info
                                optimize_craft_gearsets.PET_ITEMS = [level_info]
                                optimize_craft_gearsets.INCLUDE_PETS = True
                                print(f"Keeping equipped pet locked: {level_info.name} Level {pet_level}")
                            else:
                                optimize_craft_gearsets.PET_ITEMS = []
                                optimize_craft_gearsets.INCLUDE_PETS = False
                        else:
                            optimize_craft_gearsets.PET_ITEMS = []
                            optimize_craft_gearsets.INCLUDE_PETS = False
                    else:
                        optimize_craft_gearsets.PET_ITEMS = []
                        optimize_craft_gearsets.INCLUDE_PETS = False
                else:
                    optimize_craft_gearsets.PET_ITEMS = []
                    optimize_craft_gearsets.INCLUDE_PETS = False
                    print(f"No pet equipped, excluding pets from optimization")
            
            # Resolve selected_location for no-service recipes
            optimize_craft_gearsets.SELECTED_LOCATION = None
            if not service and selected_location:
                from util.autogenerated.locations import Location
                for attr_name in dir(Location):
                    if attr_name.startswith('_'):
                        continue
                    loc = getattr(Location, attr_name)
                    if hasattr(loc, 'name'):
                        loc_id = loc.name.lower().replace(' ', '_').replace("'", '')
                        if loc_id == selected_location:
                            optimize_craft_gearsets.SELECTED_LOCATION = loc
                            print(f"Using user-selected location for no-service recipe: {loc.name}")
                            break
                else:
                    print(f"⚠ Could not resolve selected location: {selected_location}")
            elif not service:
                # Default to Kallaheim if no location provided for no-service recipe
                from util.autogenerated.locations import Location
                if hasattr(Location, 'KALLAHEIM'):
                    optimize_craft_gearsets.SELECTED_LOCATION = Location.KALLAHEIM
                    print(f"No service and no location selected, defaulting to Kallaheim")
            
            # Inject generic items into character's item pool for crafting
            # Respect UI owned/hidden state: skip items where has=false or hide=true
            # Also load community items that the user has checked "has" on
            if db_save_path:
                try:
                    from ui.database import DatabaseManager as _DB2
                    from ui.generic_definitions import GenericDefinitionManager as _GDM2
                    from ui.sheets_sync import SHEET_SESSION_UUID as _SHEET_UUID2
                    _gen_db2 = _DB2(db_save_path)
                    
                    _gen_items2 = _gen_db2.get_generic_items_by_session(db_save_session) if db_save_session else []
                    _own_ids2 = {gi.get('id', '') for gi in _gen_items2}
                    
                    # Load sheet-sourced items
                    _sheet_items2 = _gen_db2.get_generic_items_by_session(_SHEET_UUID2)
                    _sheet_ids2 = {gi.get('id', '') for gi in _sheet_items2}
                    
                    # Load community items that the user checked "has" on
                    _community_items2 = []
                    for state_key, gi_state in all_ui_items.items():
                        if not state_key.startswith('generic::item::'):
                            continue
                        gi_id = state_key.replace('generic::item::', '')
                        if gi_id in _own_ids2 or gi_id in _sheet_ids2:
                            continue
                        if gi_state.get('has', False):
                            community_gi = _gen_db2.get_generic_item_by_id(gi_id)
                            if community_gi:
                                _community_items2.append(community_gi)
                    
                    _all_gen2 = _gen_items2 + _sheet_items2 + _community_items2
                    _gen_injected2 = 0
                    for gi in _all_gen2:
                        gi_id = gi.get('id', '')
                        state_key = f"generic::item::{gi_id}"
                        gi_state = all_ui_items.get(state_key, {})
                        # Only inject items that are explicitly marked has=true in UI state
                        if not gi_state.get('has', False):
                            continue
                        if gi_state.get('hide', False):
                            continue
                        gi_instance = _GDM2.to_item_instance(gi)
                        if hasattr(gi_instance, 'NORMAL'):
                            # Crafted: only add the quality selected in Column 1
                            RARITY_TO_QUALITY_ATTR = {
                                'common': 'NORMAL', 'uncommon': 'GOOD', 'rare': 'GREAT',
                                'epic': 'EXCELLENT', 'legendary': 'PERFECT', 'ethereal': 'ETERNAL',
                                'normal': 'NORMAL', 'good': 'GOOD', 'great': 'GREAT',
                                'excellent': 'EXCELLENT', 'perfect': 'PERFECT', 'eternal': 'ETERNAL',
                            }
                            selected_quality = gi_state.get('quality', 'common')
                            q_attr = RARITY_TO_QUALITY_ATTR.get((selected_quality or 'common').lower(), 'NORMAL')
                            variant = getattr(gi_instance, q_attr, None)
                            if variant:
                                character._all_items[variant] = 1
                            else:
                                fallback = getattr(gi_instance, 'NORMAL', None)
                                if fallback:
                                    character._all_items[fallback] = 1
                            if gi.get('slot') == 'ring':
                                ring2_quality = gi_state.get('ring2_quality')
                                if ring2_quality and ring2_quality != 'None':
                                    q_attr2 = RARITY_TO_QUALITY_ATTR.get(ring2_quality.lower(), 'NORMAL')
                                    variant2 = getattr(gi_instance, q_attr2, None)
                                    if variant2:
                                        character._all_items[variant2] = character._all_items.get(variant2, 0) + 1
                        else:
                            character._all_items[gi_instance] = 1
                        _gen_injected2 += 1
                    if _all_gen2:
                        print(f"Injected {_gen_injected2} generic items into craft candidate pool"
                              f" ({len(_community_items2)} community)")
                except Exception as e:
                    print(f"⚠ Failed to load generic items for crafting: {e}")
            
            # Set sorting priority and weights if provided
            if sorting_priority:
                # Boundary log — what the worker actually received from the
                # POST handler. If this doesn't match what the user had in
                # their UI, the problem is upstream (frontend or POST).
                print(f"[worker] RAW sorting_priority received ({len(sorting_priority)} entries): {sorting_priority!r}"[:1800])

                # Detect non-quality recipes (bread, twine, fry a perch, etc.)
                # and strip y=quality priorities BEFORE parsing. Otherwise
                # every gearset scores float('inf') on the quality metrics
                # and the local-search comparator can't improve beyond the
                # greedy init.
                _has_output_recipe = hasattr(recipe, 'output_item') and isinstance(recipe.output_item, str)
                _recipe_is_quality = True
                if _has_output_recipe:
                    _recipe_is_quality = recipe.output_item.startswith('Item.')
                elif hasattr(recipe, 'is_quality_item'):
                    _recipe_is_quality = recipe.is_quality_item
                if not _recipe_is_quality:
                    sorting_priority = filter_sorting_for_non_quality_recipe(sorting_priority)
                    print(f"[worker] After non-quality filter: {len(sorting_priority)} entries: {sorting_priority!r}"[:1800])

                # Optimization priority follows the user's saved order
                # (`hiddenInQuick` is a UI-only Quick-view filter, not a
                # priority demotion). See bug 15cc9a42: when the user's
                # saved list has xp/step at position 0 with hiddenInQuick
                # toggled, the optimizer must still treat it as primary
                # because position 0 = "Settings #1" in the priority
                # numbering shown by `priorityNumberFor` in
                # xy-recipe-priority-list.js (1-based index in the FULL
                # list). The previous visible-first reorder (bug a03f6e57
                # fix from 2026-05-10) silently overrode that and
                # promoted Quick-visible entries to primary, contradicting
                # the saved order shown in Settings.

                priority_entries, weights_dict = parse_sorting_priority(sorting_priority)
                if priority_entries:
                    active_entries = [e for e in priority_entries if e.weight > 0]
                    optimize_craft_gearsets.SORTING_PRIORITY = active_entries if active_entries else priority_entries
                    optimize_craft_gearsets.SORTING_WEIGHTS = weights_dict
                
                # Pick first quality-related entry's target as headline display
                quality_keys = {'materials_for_target', 'steps_for_target', 'total_crafts'}
                for entry in priority_entries:
                    if entry.sort.metric_key in quality_keys and entry.target:
                        print(f"[worker] Headline display target quality: {entry.target}")
                        target_quality = entry.target
                        optimize_craft_gearsets.TARGET_QUALITY = target_quality
                        break
                
                print(f"[worker] Parsed craft sorting priority ({len(priority_entries)} entries):")
                for i, entry in enumerate(priority_entries):
                    print(f"  {i+1}. {entry!r}")
            
            # Determine consumables to test
            consumables_to_test = [None]  # Always test without consumable
            
            # If consumable slot is locked, only test the locked consumable
            locked_consumable = locked_items.get('consumable')
            if locked_consumable:
                consumables_to_test = [locked_consumable]
                print(f"Consumable locked to: {locked_consumable.name} — skipping consumable search")
            elif include_consumables:
                # Add all consumables from character inventory
                all_consumables = []
                for item, qty in character.items.items():
                    if qty > 0 and hasattr(item, 'duration') and item not in hidden_items:
                        all_consumables.append(item)
                print(f"Found {len(all_consumables)} consumables in inventory")
                # Bug 3bb938f4 fourth follow-up — the user reported Fine
                # consumables aren't picked in normal optimization. Surface
                # the candidate names so we can verify (a) the Fine variant
                # actually arrived in the candidate pool, and (b) it
                # survives the non-quality QO-only filter below. Without
                # this we're flying blind.
                print(f"[recipe-normal] candidate names: "
                      f"{[c.name for c in all_consumables]}")
                
                # For non-quality crafts, filter out consumables whose only stats are QO
                # (QO is useless when the output isn't a quality item)
                _has_output = hasattr(recipe, 'output_item') and isinstance(recipe.output_item, str)
                _is_quality = True
                if _has_output:
                    _is_quality = recipe.output_item.startswith('Item.')
                elif hasattr(recipe, 'is_quality_item'):
                    _is_quality = recipe.is_quality_item
                
                if not _is_quality:
                    _craft_skill = recipe.skill.lower() if hasattr(recipe, 'skill') else 'global'
                    _craft_loc = service.location if service and hasattr(service, 'location') else None
                    _before = len(all_consumables)
                    filtered = []
                    for _cons in all_consumables:
                        _stats = _cons.get_stats_for_skill(_craft_skill, location=_craft_loc, character=character) if hasattr(_cons, 'get_stats_for_skill') else {}
                        # Keep consumable if it has any non-QO stat with a nonzero value
                        _has_non_qo = any(v != 0 and k != 'quality_outcome' for k, v in _stats.items())
                        if _has_non_qo or not _stats:
                            filtered.append(_cons)
                    if len(filtered) < _before:
                        print(f"  Filtered {_before - len(filtered)} QO-only consumables (non-quality craft)")
                    all_consumables = filtered
                # Bug 3bb938f4 fourth follow-up: print is_quality verdict
                # + final candidate list so the user's worker logs make it
                # obvious whether Sweet carrot pie (Fine) was filtered out
                # for being on a non-quality recipe (Material/Consumable
                # output) or whether it survived to the smart-testing phase.
                print(f"[recipe-normal] is_quality={_is_quality} "
                      f"final_candidates={[c.name for c in all_consumables]}")
                
                # 2026-07-01 (jwbail): consumable is now a first-class search
                # slot inside optimize_for_service (folded into all_slots), so
                # we NO LONGER run an outer re-optimization loop per consumable
                # (the old Phase 1/2/3 "smart testing" re-ran the whole optimize
                # up to 5x -> the ~15s the user hit). Hand the candidate pool to
                # the optimizer's module global and let ONE optimize sweep
                # co-optimize gear + consumable together. A locked consumable is
                # already forced via optimize_craft_gearsets.LOCKED_SLOTS.
                optimize_craft_gearsets.CONSUMABLE_ITEMS = all_consumables
                print(f"[recipe-normal] consumable folded into search slot "
                      f"({len(all_consumables)} candidates) — single optimize pass")
            else:
                print(f"Testing without consumables")
            
            # Test each consumable and find the best
            # 2026-07-01 (jwbail): single optimize pass. The consumable is now a
            # search slot inside optimize_for_service (folded into all_slots),
            # and any locked consumable is forced via LOCKED_SLOTS, so we call
            # optimize_for_service exactly ONCE with consumable=None and read the
            # chosen consumable back off the resulting gearset. This replaces the
            # old outer loop that re-ran the full optimize per consumable.
            final_gearset, final_metrics, iterations = optimize_craft_gearsets.optimize_for_service(
                recipe, service, character, consumable=None
            )
            best_consumable = final_gearset.get('consumable') if final_gearset else None
            
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
                'service_name': service.name if service else None,
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

            # Add pet info if one was selected
            best_pet = final_gearset.get('pet')
            if best_pet:
                result['pet'] = {
                    'name': best_pet.name,
                    'level': best_pet.level if hasattr(best_pet, 'level') else 1,
                    'variant': _resolve_pet_variant_from_request(request, best_pet.name),
                }
            
            # Compute non-owned alternatives if enabled
            show_alternatives = request.get('show_non_owned_alternatives', False)
            print(f"[recipe] show_non_owned_alternatives flag: {show_alternatives}")
            if show_alternatives:
                try:
                    alts, locked_alts = compute_slot_alternatives(
                        final_gearset, character, 'recipe',
                        recipe=recipe, service=service, consumable=best_consumable,
                        sorting_priority=optimize_craft_gearsets.SORTING_PRIORITY,
                        sorting_weights=optimize_craft_gearsets.SORTING_WEIGHTS if hasattr(optimize_craft_gearsets, 'SORTING_WEIGHTS') else {},
                        target_quality=target_quality,
                        budget_materials=budget_materials,
                        budget_target=budget_target,
                        hidden_items=hidden_items,
                    )
                    # Always set these (even as empty dict) so the client can
                    # distinguish "alternatives computed but none found" from
                    # "alternatives never computed". Without this, the popup
                    # keeps showing "Optimize Slot & Equip" even after the
                    # optimizer ran and returned zero results.
                    result['alternatives'] = alts if alts else {}
                    result['locked_alternatives'] = locked_alts if locked_alts else {}
                    total_alts = sum(len(v) for v in (alts or {}).values())
                    total_locked = sum(len(v) for v in (locked_alts or {}).values())
                    print(f"[recipe] Found {total_alts} non-owned alternatives across {len(alts or {})} slots; "
                          f"{total_locked} locked across {len(locked_alts or {})} slots")
                except Exception as e:
                    import traceback
                    print(f"⚠ Failed to compute recipe alternatives: {e}")
                    traceback.print_exc()
                    # Honor the "always set" contract above even on failure —
                    # downstream save block keys off `is not None`, so leaving
                    # them unset would silently drop them from slots_json.
                    result['alternatives'] = {}
                    result['locked_alternatives'] = {}
            
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
                # Travel has no duplicable metrics; bare enums are fine.
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
        
        elif opt_type == 'crafting_tree_node':
            # Crafting tree per-node optimization
            # Reuses the same greedy + local search algorithm as activity/recipe
            from util.gearset_utils import encode_gearset
            import math
            
            def _sanitize_metrics(d):
                """Replace Infinity/NaN with None for JSON serialization."""
                if isinstance(d, dict):
                    return {k: _sanitize_metrics(v) for k, v in d.items()}
                if isinstance(d, (list, tuple)):
                    return [_sanitize_metrics(v) for v in d]
                if isinstance(d, float) and (math.isinf(d) or math.isnan(d)):
                    return None
                return d
            
            node_source_type = request.get('node_source_type', 'activity')
            # Fast ranking pass (bug f5a30d6b): when the caller only needs a
            # gear-aware ESTIMATE to RANK Best(auto) routes (not the final
            # gearset), run greedy + a single local-search iteration with the
            # 2/4-swap phases off. That is ~100x cheaper than the full deep
            # search; the winning route is re-optimized at full depth by the
            # caller afterward, so final gear quality is unchanged. The knobs
            # are set on EVERY request (fast -> 1, otherwise -> the module
            # defaults 100/True/True) so the persistent local-optimize worker
            # can never leak a fast setting into a later full run.
            _fast_rank = bool(request.get('fast_rank', False))
            try:
                import optimize_activity_gearsets as _ct_oag
                _ct_oag.MAX_ITERATIONS = 1 if _fast_rank else 100
                _ct_oag.ENABLE_2_SWAP = (not _fast_rank)
                _ct_oag.ENABLE_4_SWAP = (not _fast_rank)
            except Exception:
                pass
            try:
                import optimize_craft_gearsets as _ct_ocg
                _ct_ocg.MAX_ITERATIONS = 1 if _fast_rank else 100
            except Exception:
                pass
            node_activity_id = request.get('node_activity_id')
            node_recipe_id = request.get('node_recipe_id')
            node_service_id = request.get('node_service_id')
            node_location = request.get('node_location')
            # Tree-aware downstream cost specs — list of
            # {item_ref, req_amount, child_steps_per_item}. When non-empty,
            # the recipe-node optimizer prefers the tree-aware metric
            # (total_tree_steps_for_target) over the local-only
            # steps_for_target so QO-boosting gear gets credit for
            # reducing the count of input materials gathered downstream.
            # Built in ui/app.py:_run_crafting_tree_optimization from the
            # tree state (children's already-computed metrics + each
            # child's base_requirement_amount). See bug 86dc4be5 (spectral
            # wrench picking Protective glasses over Meltdown mask).
            child_input_specs = request.get('child_input_specs') or []
            
            if node_source_type == 'recipe' and node_recipe_id:
                # Recipe node optimization — reuse craft optimizer
                import util.autogenerated.recipes as recipes_module
                from util.walkscape_constants import Service
                import optimize_craft_gearsets
                
                # Try RECIPES_BY_NAME first (source_id is the recipe display name)
                from util.autogenerated.recipes import RECIPES_BY_NAME
                recipe = RECIPES_BY_NAME.get(node_recipe_id)
                
                if not recipe:
                    for attr_name in dir(recipes_module):
                        if attr_name.startswith('_'):
                            continue
                        rec = getattr(recipes_module, attr_name)
                        if hasattr(rec, 'name') and (attr_name == node_recipe_id or rec.name == node_recipe_id):
                            recipe = rec
                            break
                
                if not recipe:
                    if db_save_session and db_save_path:
                        try:
                            from ui.database import DatabaseManager
                            db = DatabaseManager(db_save_path)
                            db.finish_optimization(db_save_session)
                        except Exception:
                            pass
                    sys.stdout = old_stdout
                    print(json.dumps({'success': False, 'error': f'Recipe not found: {node_recipe_id}'}))
                    sys.exit(1)
                
                service = None
                if node_service_id:
                    service_attr = node_service_id.upper().replace(' ', '_')
                    if hasattr(Service, service_attr):
                        service = getattr(Service, service_attr)
                    if not service:
                        for attr_name in dir(Service):
                            if attr_name.startswith('_'):
                                continue
                            svc = getattr(Service, attr_name)
                            if hasattr(svc, 'name') and attr_name == node_service_id:
                                service = svc
                                break
                
                # Auto-service = the user did NOT pin a concrete service
                # ('__best__' / unset). In that case we jointly optimize a
                # gearset per candidate service below and pick the best combo,
                # rather than committing to one service up front. The
                # provisional pick immediately below only seeds the module
                # config (so the no-service branches don't fire); the joint
                # loop at the final optimize overrides it. Report df39440d.
                _ct_auto_service = service is None

                if not service:
                    # Provisional seed only: pick a valid+unlocked service so
                    # the module config below (and the no-service branches) see
                    # a service recipe. The joint per-service optimization at
                    # the final optimize (see _optimize_best_service_over_candidates)
                    # overrides this with the service whose full optimized
                    # gearset scores best. Report df39440d.
                    service = _select_best_service_for_recipe(recipe, character)

                if not service:
                    # No service found — optimize without service bonuses
                    # (some recipes may not need a service, or character hasn't unlocked any)
                    service = None
                
                optimize_craft_gearsets.RECIPE = recipe
                optimize_craft_gearsets.SERVICE = service
                # Honor the user's target_quality from the crafting tree's
                # global settings. Previously this was hardcoded to 'Normal',
                # which caused the per-node optimizer to pick gear optimized for
                # throughput (WE/DA/DR) and ignore Quality Outcome — so recipes
                # with target=Perfect silently optimized for max Normal crafts,
                # inflating the flax/material demand downstream.
                #
                # Only propagate the user's target_quality to recipes whose
                # output is equipment (Item.*). Material/Consumable outputs
                # don't have in-game quality tiers, so forcing Perfect would
                # make the optimizer pick QO gear that gives zero real benefit.
                requested_quality = request.get('target_quality', 'Normal')
                output_ref = getattr(recipe, 'output_item', None) or ''
                is_equipment_output = str(output_ref).startswith('Item.')
                optimize_craft_gearsets.TARGET_QUALITY = (
                    requested_quality if is_equipment_output else 'Normal'
                )
                optimize_craft_gearsets.VERBOSE = False
                optimize_craft_gearsets.IGNORED_ITEMS = hidden_items
                # Tree-aware downstream cost. When non-empty, the per-quality
                # loop in calculate_craft_metrics emits the
                # total_tree_steps_for_target::Q metric (recipe steps +
                # downstream cost of producing inputs). Without this, the
                # recipe-node optimizer scores only the local recipe and
                # misses the QO-vs-mats tradeoff. See module docstring on
                # CHILD_INPUT_SPECS in optimize_craft_gearsets.py and the
                # full-tree optimization fix for spectral-wrench-style
                # bug 86dc4be5.
                optimize_craft_gearsets.CHILD_INPUT_SPECS = list(child_input_specs) if child_input_specs else []
                # Tree-node opt-in toggles (Optimize Pets / Optimize
                # Consumables in the global settings panel). Same logic
                # as the activity tree-node path — off by default,
                # locked items force INCLUDE on regardless.
                _ct_locked_consumable = locked_items.get('consumable')
                _ct_locked_pet = locked_items.get('pet')
                _ct_include_consumables = optimize_consumables_flag or bool(_ct_locked_consumable)
                _ct_include_pets = optimize_pets_flag or bool(_ct_locked_pet)
                optimize_craft_gearsets.INCLUDE_CONSUMABLES = _ct_include_consumables
                # Skill-relevance filter target for the recipe node. Recipe.skill
                # is a display-cased string ("Cooking", "Crafting", etc.). The
                # filter helper lowercases internally.
                _ct_target_skill = getattr(recipe, 'skill', None)
                if _ct_locked_consumable:
                    optimize_craft_gearsets.CONSUMABLE_ITEMS = [_ct_locked_consumable]
                elif _ct_include_consumables:
                    _all_owned_consumables = [
                        _it for _it, _qty in character.items.items()
                        if _qty > 0 and hasattr(_it, 'duration') and _it not in hidden_items
                    ]
                    # Bug 9ce474f8: drop consumables whose stats don't apply to
                    # this recipe's skill (e.g. Cooked shrimp on a Crafting node).
                    # Globally-scoped consumables (Beer, Wine, etc.) still pass.
                    optimize_craft_gearsets.CONSUMABLE_ITEMS = (
                        _filter_pet_consumable_candidates_by_skill(
                            _all_owned_consumables, _ct_target_skill, item_kind='consumable',
                        )
                    )
                    print(
                        f"[ct-worker] recipe CONSUMABLE_ITEMS: "
                        f"{len(optimize_craft_gearsets.CONSUMABLE_ITEMS)}/{len(_all_owned_consumables)} "
                        f"consumables relevant to skill={_ct_target_skill!r}"
                    )
                    # Bug 3bb938f4 third follow-up: "doesn't seem to want to use
                    # fine consumables if the user has them now". Print every
                    # candidate by name (not just count) so we can verify the
                    # Fine variant is in the candidate pool. Also surface the
                    # owned-set so it's obvious whether the issue is upstream
                    # (Fine never made it to character.items) or downstream
                    # (the optimizer rejected Fine for some reason).
                    print(
                        f"[ct-worker] recipe candidate names: "
                        f"{[getattr(c, 'name', repr(c)) for c in optimize_craft_gearsets.CONSUMABLE_ITEMS]}"
                    )
                    _owned_names = [getattr(c, 'name', repr(c)) for c in _all_owned_consumables]
                    _filtered_out = [n for n in _owned_names if n not in {
                        getattr(c, 'name', '') for c in optimize_craft_gearsets.CONSUMABLE_ITEMS
                    }]
                    if _filtered_out:
                        print(f"[ct-worker] recipe consumables filtered OUT (skill mismatch): {_filtered_out}")
                else:
                    optimize_craft_gearsets.CONSUMABLE_ITEMS = []
                optimize_craft_gearsets.INCLUDE_PETS = _ct_include_pets
                if _ct_locked_pet:
                    optimize_craft_gearsets.PET_ITEMS = [_ct_locked_pet]
                elif _ct_include_pets:
                    # Pets live in character_config.pets[*] + user_overrides,
                    # NOT character.items. Shared helper mirrors column-2.
                    _all_owned_pets = _build_pet_items_from_character_config(
                        character_config, ui_config
                    )
                    # Bug 9ce474f8: stricter pet filter — exclude pets whose
                    # only matching stat scope is 'global'. Tortoise (smithing-
                    # focused, with a tiny global inventory_space) was being
                    # picked on Crafting / Cooking nodes because the optimizer's
                    # tiebreaker preferred any pet over no pet. The fix is to
                    # pre-filter so only pets with a stat scoped to the recipe
                    # skill (or its skill group, e.g. 'artisan' for Crafting)
                    # are candidates. If nothing matches the optimizer falls
                    # back to no pet, which is the intuitive answer.
                    optimize_craft_gearsets.PET_ITEMS = (
                        _filter_pet_consumable_candidates_by_skill(
                            _all_owned_pets, _ct_target_skill, item_kind='pet', is_recipe=True,
                        )
                    )
                    if not optimize_craft_gearsets.PET_ITEMS:
                        optimize_craft_gearsets.INCLUDE_PETS = False
                    print(
                        f"[ct-worker] recipe PET_ITEMS: "
                        f"{len(optimize_craft_gearsets.PET_ITEMS)}/{len(_all_owned_pets)} "
                        f"pets relevant to skill={_ct_target_skill!r}"
                    )
                else:
                    optimize_craft_gearsets.PET_ITEMS = []
                optimize_craft_gearsets.LOCKED_SLOTS = locked_items

                # Set location for no-service recipes
                #
                # Apply the tree-aware SORTING_PRIORITY rewrite NOW (before
                # the location-search loop below) so click-1 (which goes
                # through the `elif not service:` location-search loop and
                # exits via raise SystemExit(0) after picking best_loc) and
                # click-2 (which falls through to the rewrite block at
                # ~line 4380 + final optimize_for_service call) BOTH score
                # gear by the same metric. Without this, click-1's loop
                # uses the un-rewritten module-level SORTING_PRIORITY
                # (defaults to local STEPS_PER_CRAFT) so its
                # optimize_for_service calls pick gear that minimizes
                # local recipe steps, not tree-total. The user then sees
                # a worse result on click-1 than click-2 even though
                # click-2 inherits click-1's selected_location_id.
                # Spectral vest reproducer: click-1 gave 325k steps;
                # click-2 gave 277k. Bug 17231cb0.
                if not service and child_input_specs and sorting_priority:
                    try:
                        from util.walkscape_constants import (
                            Sorting as _Sorting, SortingEntry as _SortingEntry,
                        )
                        _local_recipe_sorts = {
                            _Sorting.TOTAL_STEPS, _Sorting.MATERIALS,
                            _Sorting.TOTAL_CRAFTS_FOR_TARGET, _Sorting.STEPS_PER_CRAFT,
                        }
                        _pe, _wd = parse_sorting_priority(sorting_priority)
                        _rewritten = []
                        for _entry in _pe:
                            if _entry.sort in _local_recipe_sorts:
                                _rewritten.append(_SortingEntry(
                                    sort=_Sorting.TOTAL_TREE_STEPS,
                                    target=_entry.target or getattr(
                                        optimize_craft_gearsets, 'TARGET_QUALITY', 'Normal',
                                    ),
                                    weight=_entry.weight,
                                ))
                            else:
                                _rewritten.append(_entry)
                        _active = [e for e in _rewritten if e.weight > 0]
                        optimize_craft_gearsets.SORTING_PRIORITY = (
                            _active if _active else _rewritten
                        )
                        optimize_craft_gearsets.SORTING_WEIGHTS = _wd
                        print(
                            f"[ct-worker] service-recipe pre-loop: rewrote "
                            f"{len(_pe)} sort entries to TOTAL_TREE_STEPS "
                            f"({len(child_input_specs)} child specs)",
                            flush=True,
                        )
                    except Exception as _pre_exc:
                        print(
                            f"[ct-worker] service-recipe pre-loop rewrite failed: "
                            f"{_pre_exc!r}",
                            flush=True,
                        )

                if not service and node_location:
                    from util.autogenerated.locations import Location
                    for attr_name in dir(Location):
                        if attr_name.startswith('_'):
                            continue
                        loc = getattr(Location, attr_name)
                        if hasattr(loc, 'name'):
                            loc_name = loc.name.lower().replace(' ', '_').replace("'", '')
                            if loc_name == node_location.lower().replace(' ', '_').replace("'", '') or attr_name.lower() == node_location.lower():
                                optimize_craft_gearsets.SELECTED_LOCATION = loc
                                break
                elif not service:
                    # No service and no specific location — test all unlocked regions,
                    # pick the one that gives the best gearset score. Gear bonuses in
                    # Walkscape key on region (see stats_mixin._location_matches
                    # which calls location.is_in_region), so two locations within
                    # the same region produce identical stats. Testing every
                    # unlocked location would be ~N× redundant work (N ≈ 46 for
                    # a character like Xav); collapse to one representative
                    # location per region.
                    from util.autogenerated.locations import Location, LocationInfo
                    unlocked_regions = set(character_config.get('region_unlocks', []))
                    # Dedupe by region — first LocationInfo we see for a region wins.
                    seen_regions = set()
                    candidate_locations = [None]  # no-location baseline
                    for attr_name in dir(Location):
                        if attr_name.startswith('_'):
                            continue
                        loc = getattr(Location, attr_name)
                        if not isinstance(loc, LocationInfo):
                            continue
                        if getattr(loc, 'is_underwater', False):
                            continue
                        loc_regions = getattr(loc, 'regions', []) or []
                        if unlocked_regions:
                            if loc_regions and not any(
                                r.lower() in {r2.lower() for r2 in unlocked_regions}
                                for r in loc_regions
                            ):
                                continue
                        # Pick the first unlocked region this location belongs
                        # to as its bucket. Collapse so we test one location per
                        # region (any location in the region produces identical
                        # gear stats).
                        region_key = None
                        for r in loc_regions:
                            r_lower = r.lower()
                            if not unlocked_regions or r_lower in {r2.lower() for r2 in unlocked_regions}:
                                region_key = r_lower
                                break
                        if region_key is None:
                            # Region-less location — treat as its own bucket
                            # (keyed by location name) so we still include it.
                            region_key = f'__loc__{loc.name}'
                        if region_key in seen_regions:
                            continue
                        seen_regions.add(region_key)
                        candidate_locations.append(loc)

                    best_loc = None
                    best_gearset = None
                    best_metrics = None
                    best_iterations = None
                    best_score = None

                    for candidate_loc in candidate_locations:
                        optimize_craft_gearsets.SELECTED_LOCATION = candidate_loc
                        try:
                            cand_gearset, cand_metrics, cand_iters = optimize_craft_gearsets.optimize_for_service(
                                recipe, None, character, consumable=None
                            )
                        except Exception:
                            continue
                        # Score: minimize the chosen metric (tree-aware when
                        # children are wired in, otherwise local steps/item).
                        # Without this, the loop scored locations by
                        # `steps_per_item` (LOCAL recipe steps) and could
                        # pick a location whose cheapest-LOCAL gear had a
                        # much higher TREE total than another location's
                        # tree-aware-best gear. Bug 17231cb0.
                        if child_input_specs:
                            cand_score = cand_metrics.get('total_tree_steps_for_target')
                            if cand_score is None or cand_score == float('inf'):
                                cand_score = cand_metrics.get('steps_per_item', float('inf'))
                        else:
                            cand_score = cand_metrics.get('steps_per_item', float('inf'))
                        if best_score is None or cand_score < best_score:
                            best_score = cand_score
                            best_loc = candidate_loc
                            best_gearset = cand_gearset
                            best_metrics = cand_metrics
                            best_iterations = cand_iters

                    # Fallback: if the best candidate is the no-location
                    # baseline (best_loc is None) but there's at least one
                    # real candidate that tied or nearly tied, prefer a real
                    # location so the UI can show "Best → <Region>". Happens
                    # when the recipe's gear stats don't vary by region at
                    # the user's current gear level — every region scores
                    # identically, the None baseline wins first-seen, and
                    # the dropdown falls back to "Best (auto)" with no
                    # visible winner. Ties the scoring to the first real
                    # candidate from the iteration order (alphabetical-ish
                    # via dir(Location)).
                    if best_gearset is not None and best_loc is None:
                        first_real = next(
                            (c for c in candidate_locations if c is not None),
                            None,
                        )
                        if first_real is not None:
                            optimize_craft_gearsets.SELECTED_LOCATION = first_real
                            try:
                                rerun = optimize_craft_gearsets.optimize_for_service(
                                    recipe, None, character, consumable=None
                                )
                            except Exception:
                                rerun = None
                            if rerun is not None:
                                best_loc = first_real
                                best_gearset, best_metrics, best_iterations = rerun

                    if best_gearset is not None:
                        # Use the best location's result
                        optimize_craft_gearsets.SELECTED_LOCATION = best_loc
                        gearset = best_gearset
                        metrics = best_metrics
                        iterations = best_iterations
                        export_string = encode_gearset(gearset)
                        from util.gearset_utils import aggregate_gearset_stats
                        skill = (recipe.skill or 'crafting').lower()
                        location_name = best_loc.name if best_loc and hasattr(best_loc, 'name') else None
                        gear_items_list = [item for item in gearset.values() if item is not None]
                        try:
                            # Gear+collectibles-only stats; tree applies
                            # level bonuses downstream (see sibling call
                            # below for rationale).
                            gear_stats = aggregate_gearset_stats(
                                items=gear_items_list, skill=skill,
                                location=location_name, character=character,
                                include_level_bonus=False,
                            )
                        except Exception:
                            gear_stats = {}
                        result = {
                            'success': True,
                            'type': 'crafting_tree_node',
                            'node_source_type': 'recipe',
                            'recipe_name': recipe.name,
                            'service_name': None,
                            'best_location': location_name,
                            'gearset_export': export_string,
                            'stats': gear_stats,
                            'metrics': _sanitize_metrics(metrics),
                            'items': {slot: item.name if item else None for slot, item in gearset.items()},
                        }
                        # Persist the optimizer's pet+consumable picks so
                        # the frontend can show them and stats can be
                        # re-aggregated on later context changes. See
                        # _extract_pet_consumable_meta docstring.
                        _sel_pet, _sel_cons = _extract_pet_consumable_meta(gearset, request)
                        if _sel_pet:
                            result['selected_pet'] = _sel_pet
                            print(f"[ct-worker] no-service recipe selected_pet: {_sel_pet}", flush=True)
                        if _sel_cons:
                            result['selected_consumable'] = _sel_cons
                            print(f"[ct-worker] no-service recipe selected_consumable: {_sel_cons}", flush=True)
                        # Compute non-owned + locked-upgrade alternatives so
                        # the slot popup's "Non-owned/Locked Upgrades" section
                        # works in the crafting-tree node context. Mirrors
                        # the standard activity/recipe paths (lines ~2667 /
                        # ~3359). Without this, gear_config.slot_alternatives
                        # ends up empty and the popup permanently shows the
                        # "Optimize Slot & Equip" button instead of upgrades.
                        try:
                            _alts, _locked_alts = compute_slot_alternatives(
                                gearset, character, 'recipe',
                                recipe=recipe, service=None,
                                consumable=gearset.get('consumable'),
                                sorting_priority=getattr(optimize_craft_gearsets, 'SORTING_PRIORITY', None),
                                sorting_weights=getattr(optimize_craft_gearsets, 'SORTING_WEIGHTS', {}),
                                target_quality=getattr(optimize_craft_gearsets, 'TARGET_QUALITY', 'Normal'),
                                selected_location=best_loc,
                                hidden_items=hidden_items,
                                top_n=30,
                            )
                            result['alternatives'] = _alts if _alts else {}
                            result['locked_alternatives'] = _locked_alts if _locked_alts else {}
                            _t1 = sum(len(v) for v in (_alts or {}).values())
                            _t2 = sum(len(v) for v in (_locked_alts or {}).values())
                            print(f"[ct-worker] no-service recipe alts: "
                                  f"{_t1} non-owned across {len(_alts or {})} slots; "
                                  f"{_t2} locked across {len(_locked_alts or {})} slots",
                                  flush=True)
                        except Exception as _alt_err:
                            import traceback
                            print(f"⚠ [ct-worker] no-service recipe alts failed: {_alt_err}")
                            traceback.print_exc()
                            result['alternatives'] = {}
                            result['locked_alternatives'] = {}
                        sys.stdout = old_stdout
                        print(json.dumps(result))
                        # Skip the normal result-building below
                        raise SystemExit(0)
                    else:
                        optimize_craft_gearsets.SELECTED_LOCATION = None
                
                if sorting_priority:
                    # Strip y=quality priorities when the recipe is
                    # non-quality — matches the main craft path above so
                    # stats-report bulk runs behave the same as one-off
                    # optimizations.
                    _has_output_recipe = hasattr(recipe, 'output_item') and isinstance(recipe.output_item, str)
                    _recipe_is_quality = True
                    if _has_output_recipe:
                        _recipe_is_quality = recipe.output_item.startswith('Item.')
                    elif hasattr(recipe, 'is_quality_item'):
                        _recipe_is_quality = recipe.is_quality_item
                    if not _recipe_is_quality:
                        sorting_priority = filter_sorting_for_non_quality_recipe(sorting_priority)

                    # Optimization priority follows the user's saved order;
                    # `hiddenInQuick` is a UI-only filter, not a priority
                    # demotion. Matches the main craft path above. See
                    # bug 15cc9a42 for the rationale.

                    priority_entries, weights_dict = parse_sorting_priority(sorting_priority)
                    # Tree-aware default seed: when filter_sorting_for_non_quality_recipe
                    # drops the entire user priority for a Material recipe (because every
                    # entry was quality-bearing — steps_for_target, materials_for_target,
                    # total_crafts), priority_entries lands empty and the worker would
                    # otherwise fall through to the module-level
                    # optimize_craft_gearsets.SORTING_PRIORITY default ([Sorting.MATERIALS]).
                    # That makes the alt entries come back with primary_metric=
                    # "materials_for_target" (no quality target), and the popup label code
                    # resolves the missing target via window.optimizeButton.targetQuality
                    # which lands on the user's global "Perfect" — yielding the misleading
                    # "Materials for Perfect: 264.30 → 263.14" display the user reported
                    # (a69d1fb8) on Birch plank (a Material recipe, can't be Perfect).
                    #
                    # Seed TOTAL_TREE_STEPS at this point so alt scoring stays in step
                    # units. The existing non-equipment-output enforcement below will
                    # rewrite the entry's target to "Normal" anyway, so the seeded value's
                    # target doesn't matter — pick the module's current TARGET_QUALITY for
                    # symmetry with the rewrite path. Only fires when child_input_specs is
                    # populated (otherwise tree-aware scoring has no children to consider
                    # and TOTAL_TREE_STEPS would degenerate to TOTAL_STEPS).
                    if not priority_entries and child_input_specs:
                        from util.walkscape_constants import Sorting as _Sorting, SortingEntry as _SortingEntry
                        _seed_target = getattr(
                            optimize_craft_gearsets, 'TARGET_QUALITY', 'Normal',
                        )
                        priority_entries = [_SortingEntry(
                            sort=_Sorting.TOTAL_TREE_STEPS,
                            target=_seed_target,
                            weight=100,
                        )]
                        weights_dict = {_Sorting.TOTAL_TREE_STEPS: 100}
                        print(
                            f"[ct-worker] Tree-aware default seed: priority dropped to "
                            f"empty for non-quality recipe with children; using "
                            f"TOTAL_TREE_STEPS::{_seed_target} so alt deltas stay in "
                            f"step units (a69d1fb8)",
                            flush=True,
                        )
                    if priority_entries:
                        # Tree-aware substitution: when this is a recipe
                        # tree node with child_input_specs wired in,
                        # rewrite any steps_for_target / TOTAL_STEPS
                        # entries so they score against the tree-aware
                        # metric instead of the local-only one. Without
                        # this rewrite the optimizer ignores the
                        # downstream cost of producing inputs and picks
                        # gear that's locally fast but globally
                        # expensive (the spectral-wrench bug 86dc4be5).
                        #
                        # ALSO rewrite MATERIALS / TOTAL_CRAFTS_FOR_TARGET /
                        # STEPS_PER_CRAFT to TOTAL_TREE_STEPS in tree
                        # context. Reason: when a node has children the
                        # alt-popup must show alt scores in TREE-STEP
                        # units so the user understands "Steps for
                        # crafting tree". If MATERIALS stays as the
                        # primary, alt entries carry materials/craft
                        # counts (e.g. 1.145 -> 1.144) which look
                        # nonsensical next to the "Steps for crafting
                        # tree" label and don't compose with the parent
                        # node's tree-step total. User report 948d02f1:
                        # "It's saying 'Steps for crafting tree: 1.145
                        # -> 1.144' but the whole crafting tree is
                        # 74,643 steps. So that's not right. Still
                        # looks like it's doing mats/target item."
                        if child_input_specs:
                            from util.walkscape_constants import Sorting as _Sorting, SortingEntry as _SortingEntry
                            # Set of enums whose primary metric stops
                            # making sense for a recipe node with
                            # children — they all describe local-only
                            # work and should be replaced by the
                            # tree-aware total. Any other primary
                            # (e.g. XP_PER_STEP) passes through.
                            _local_recipe_sorts = {
                                _Sorting.TOTAL_STEPS,
                                _Sorting.MATERIALS,
                                _Sorting.TOTAL_CRAFTS_FOR_TARGET,
                                _Sorting.STEPS_PER_CRAFT,
                            }
                            _rewritten = []
                            _rewrote_any = False
                            _rewrote_kinds = []
                            for _entry in priority_entries:
                                if _entry.sort in _local_recipe_sorts:
                                    _rewrote_kinds.append(_entry.sort.name)
                                    # MATERIALS / STEPS_PER_CRAFT have no
                                    # quality target on their own; keep
                                    # whatever target was on the entry,
                                    # falling back to the global
                                    # TARGET_QUALITY ("Normal" for
                                    # non-equipment recipes, the user's
                                    # quality otherwise).
                                    _new_target = _entry.target or getattr(
                                        optimize_craft_gearsets,
                                        'TARGET_QUALITY',
                                        'Normal',
                                    )
                                    _rewritten.append(_SortingEntry(
                                        sort=_Sorting.TOTAL_TREE_STEPS,
                                        target=_new_target,
                                        weight=_entry.weight,
                                    ))
                                    _rewrote_any = True
                                else:
                                    _rewritten.append(_entry)
                            if _rewrote_any:
                                print(
                                    f"[ct-worker] Tree-aware: rewrote "
                                    f"{','.join(_rewrote_kinds)}->TOTAL_TREE_STEPS in priority "
                                    f"({len(child_input_specs)} input specs)",
                                    flush=True,
                                )
                            priority_entries = _rewritten

                        active_entries = [e for e in priority_entries if e.weight > 0]
                        optimize_craft_gearsets.SORTING_PRIORITY = active_entries if active_entries else priority_entries
                        optimize_craft_gearsets.SORTING_WEIGHTS = weights_dict
                    # Apply first per-entry quality target as headline display
                    quality_keys = {'materials_for_target', 'steps_for_target', 'total_crafts', 'total_tree_steps_for_target'}
                    for entry in priority_entries:
                        if entry.sort.metric_key in quality_keys and entry.target:
                            optimize_craft_gearsets.TARGET_QUALITY = entry.target
                            break

                # Final enforcement: for Material/Consumable outputs the user's
                # requested quality is meaningless (no in-game quality tiers
                # for materials). The sorting_priority override above may have
                # set TARGET_QUALITY from a SortingEntry — force it back to
                # Normal for non-equipment outputs, and rewrite any
                # quality-bearing SortingEntry targets so the optimizer
                # doesn't waste gear slots chasing QO for a material craft.
                if not is_equipment_output:
                    optimize_craft_gearsets.TARGET_QUALITY = 'Normal'
                    from util.walkscape_constants import SortingEntry
                    _quality_keys = {'materials_for_target', 'steps_for_target', 'total_crafts', 'total_tree_steps_for_target'}
                    _fixed = []
                    for _e in (optimize_craft_gearsets.SORTING_PRIORITY or []):
                        # SORTING_PRIORITY may contain either SortingEntry
                        # objects (from parse_sorting_priority) or bare
                        # Sorting enums (the module-level default). Only
                        # SortingEntry wrappers carry a quality target, so
                        # enum entries pass through unchanged.
                        if not hasattr(_e, 'sort') or not hasattr(_e, 'target'):
                            _fixed.append(_e)
                            continue
                        if _e.sort.metric_key in _quality_keys and _e.target and _e.target != 'Normal':
                            _fixed.append(SortingEntry(sort=_e.sort, target='Normal', weight=_e.weight))
                        else:
                            _fixed.append(_e)
                    optimize_craft_gearsets.SORTING_PRIORITY = _fixed
                
                if _ct_auto_service and service is not None:
                    # Service auto-selected: jointly optimize a gearset per
                    # candidate service (deduped by region + service-stat
                    # signature) and take the best-scoring service+gearset.
                    # This weighs the full stat profile of each service
                    # (WE / NMC / DR / DA / QO ...), not just work_efficiency,
                    # so a lower-WE service with strong other bonuses can win.
                    # SELECTED_LOCATION is left on the winner so best_location
                    # (-> node.selected_location_id) matches the gear scope, and
                    # the display service row (scoped to that location) agrees.
                    _bs, _bg, _bm, _bi = _optimize_best_service_over_candidates(
                        recipe, character, child_input_specs,
                    )
                    if _bs is not None:
                        service = _bs
                        optimize_craft_gearsets.SERVICE = service
                        optimize_craft_gearsets.SELECTED_LOCATION = getattr(service, 'location', None)
                        gearset, metrics, iterations = _bg, _bm, _bi
                    else:
                        gearset, metrics, iterations = optimize_craft_gearsets.optimize_for_service(
                            recipe, service, character, consumable=None
                        )
                else:
                    gearset, metrics, iterations = optimize_craft_gearsets.optimize_for_service(
                        recipe, service, character, consumable=None
                    )
                export_string = encode_gearset(gearset)

                # Compute gear stats for the node's skill/location context
                from util.gearset_utils import aggregate_gearset_stats
                skill = (recipe.skill or 'crafting').lower()
                # `location` flows into `result_best_location` below
                # (which JSON-serializes), so keep it a string. For the
                # gear_stats aggregation specifically, prefer the
                # service's LocationInfo when present so ghostly-gated
                # stats survive (bug af9d3e86 / 79ec57d9 follow-up).
                location = node_location
                aggregation_location = node_location
                if service is not None and getattr(service, 'location', None) is not None:
                    aggregation_location = service.location
                # Resolve the emitted best_location from SELECTED_LOCATION
                # (the Location enum we set above) so the frontend always
                # gets the canonical .name form. Falls back to the raw
                # node_location string if SELECTED_LOCATION is somehow
                # missing. Without this, the recipe result dropped
                # best_location entirely, and re-optimizing a tree node
                # that already had a user-selected location would come
                # back with best_location=null — the frontend then cleared
                # last_auto_resolved_location and the dropdown showed
                # "Best (auto)" instead of "Best → <location>". Bug
                # e4644b9d.
                # Fix (bug e1846270, craft-tree-region): when the craft runs
                # at a SERVICE, the gear was scored against service.location
                # (optimize_for_service: `location = service.location if
                # service else SELECTED_LOCATION`). The emitted best_location
                # MUST match that craft region, NOT the node's stale
                # selected_location_id (node_location), which can point at a
                # different region. crafting_tree_optimize.py persists
                # best_location back into selected_location_id, so a mismatched
                # node_location (e.g. jarvonia "Azurazera") would feed forward
                # and cause out-of-region gear (Bert's skis) to be credited at
                # a gdte/trellin kitchen like Eberhart Mansion (Granfiddich).
                _service_loc = getattr(service, 'location', None) if service is not None else None
                _selected_loc = getattr(optimize_craft_gearsets, 'SELECTED_LOCATION', None)
                if _service_loc is not None and hasattr(_service_loc, 'name'):
                    result_best_location = _service_loc.name
                elif _selected_loc is not None and hasattr(_selected_loc, 'name'):
                    result_best_location = _selected_loc.name
                elif location:
                    result_best_location = location
                else:
                    result_best_location = None
                gear_items_list = [item for item in gearset.values() if item is not None]
                try:
                    # Return gear+collectibles-only stats. The crafting tree
                    # applies skill-level bonuses (WE, QO) downstream via
                    # _calculate_steps_per_action / calculate_node_metrics,
                    # so including them here would double-count.
                    gear_stats = aggregate_gearset_stats(
                        items=gear_items_list,
                        skill=skill,
                        location=aggregation_location,
                        character=character,
                        include_level_bonus=False,
                    )
                except Exception:
                    gear_stats = {}

                result = {
                    'success': True,
                    'type': 'crafting_tree_node',
                    'node_source_type': 'recipe',
                    'recipe_name': recipe.name,
                    'service_name': service.name if service else None,
                    'best_location': result_best_location,
                    'gearset_export': export_string,
                    'stats': gear_stats,
                    'metrics': _sanitize_metrics(metrics),
                    'items': {slot: item.name if item else None for slot, item in gearset.items()},
                }
                _sel_pet, _sel_cons = _extract_pet_consumable_meta(gearset, request)
                if _sel_pet:
                    result['selected_pet'] = _sel_pet
                    print(f"[ct-worker] recipe(service) selected_pet: {_sel_pet}", flush=True)
                if _sel_cons:
                    result['selected_consumable'] = _sel_cons
                    print(f"[ct-worker] recipe(service) selected_consumable: {_sel_cons}", flush=True)
                # Compute non-owned + locked-upgrade alternatives so the
                # slot popup's "Non-owned/Locked Upgrades" section works
                # in the crafting-tree node context. Mirrors the standard
                # recipe path (line ~3359). Without this,
                # gear_config.slot_alternatives ends up empty and the
                # popup permanently shows "Optimize Slot & Equip"
                # instead of the upgrades list.
                try:
                    _alts, _locked_alts = compute_slot_alternatives(
                        gearset, character, 'recipe',
                        recipe=recipe, service=service,
                        consumable=gearset.get('consumable'),
                        sorting_priority=getattr(optimize_craft_gearsets, 'SORTING_PRIORITY', None),
                        sorting_weights=getattr(optimize_craft_gearsets, 'SORTING_WEIGHTS', {}),
                        target_quality=getattr(optimize_craft_gearsets, 'TARGET_QUALITY', 'Normal'),
                        selected_location=getattr(optimize_craft_gearsets, 'SELECTED_LOCATION', None),
                        hidden_items=hidden_items,
                        top_n=30,
                    )
                    result['alternatives'] = _alts if _alts else {}
                    result['locked_alternatives'] = _locked_alts if _locked_alts else {}
                    _t1 = sum(len(v) for v in (_alts or {}).values())
                    _t2 = sum(len(v) for v in (_locked_alts or {}).values())
                    print(f"[ct-worker] recipe(service) alts: "
                          f"{_t1} non-owned across {len(_alts or {})} slots; "
                          f"{_t2} locked across {len(_locked_alts or {})} slots",
                          flush=True)
                except Exception as _alt_err:
                    import traceback
                    print(f"⚠ [ct-worker] recipe(service) alts failed: {_alt_err}")
                    traceback.print_exc()
                    result['alternatives'] = {}
                    result['locked_alternatives'] = {}
                sys.stdout = old_stdout
                print(json.dumps(result))
            
            elif node_source_type in ('activity', 'chest') and node_activity_id:
                from util.autogenerated.activities import Activity, ACTIVITIES_BY_NAME
                import optimize_activity_gearsets
                
                # Try ACTIVITIES_BY_NAME first (source_id is the display name)
                activity = ACTIVITIES_BY_NAME.get(node_activity_id)
                
                if not activity:
                    for attr_name in dir(Activity):
                        if attr_name.startswith('_'):
                            continue
                        act = getattr(Activity, attr_name)
                        if hasattr(act, 'name'):
                            if act.name == node_activity_id or attr_name == node_activity_id:
                                activity = act
                                break
                
                if not activity:
                    if db_save_session and db_save_path:
                        try:
                            from ui.database import DatabaseManager
                            db = DatabaseManager(db_save_path)
                            db.finish_optimization(db_save_session)
                        except Exception:
                            pass
                    sys.stdout = old_stdout
                    print(json.dumps({'success': False, 'error': f'Activity not found: {node_activity_id}'}))
                    sys.exit(1)
                
                optimize_activity_gearsets.ACTIVITY = activity
                # Chest-source tree nodes pass the specific chest to target
                # (request['target_item'], e.g. 'Gem pouch') so the optimizer
                # scores chests-per-step instead of any-reward. Resolve cat:*
                # categories against this activity's drop table, then use the
                # resulting drop-name string directly as the target (a chest
                # display name is a valid drop_rates key). None for plain
                # activity nodes (unchanged behavior). Bug b24a13f8.
                _ct_target_item = request.get('target_item')
                _ct_target_obj = None
                if _ct_target_item:
                    if isinstance(_ct_target_item, str) and _ct_target_item.startswith('cat:'):
                        _ct_target_item = _resolve_category_target_for_activity(_ct_target_item, activity)
                    if _ct_target_item and _ct_target_item != 'raw_rewards':
                        _ct_target_obj = _ct_target_item
                optimize_activity_gearsets.TARGET_ITEM = _ct_target_obj
                print(f"[ct-worker] activity/chest TARGET_ITEM set to: {_ct_target_obj!r} (from request target_item={request.get('target_item')!r})")
                optimize_activity_gearsets.VERBOSE = False
                optimize_activity_gearsets.IGNORED_ITEMS = hidden_items
                # Tree-node opt-in toggles (Optimize Pets / Optimize
                # Consumables in the global settings panel). Off by
                # default so existing tree results don't shift, but
                # when on the optimizer treats pet + consumable as
                # additional slots in its candidate pool. Locked
                # consumable / pet items also force INCLUDE on so the
                # optimizer respects the pin even when the global
                # toggle is off.
                _ct_locked_consumable = locked_items.get('consumable')
                _ct_locked_pet = locked_items.get('pet')
                _ct_include_consumables = optimize_consumables_flag or bool(_ct_locked_consumable)
                _ct_include_pets = optimize_pets_flag or bool(_ct_locked_pet)
                optimize_activity_gearsets.INCLUDE_CONSUMABLES = _ct_include_consumables
                # Skill-relevance filter target for the activity node.
                # activity.primary_skill is a display-cased string ("Hunting",
                # "Foraging", etc.). Helper lowercases internally.
                _ct_target_skill = getattr(activity, 'primary_skill', None)
                if _ct_locked_consumable:
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = [_ct_locked_consumable]
                elif _ct_include_consumables:
                    _all_owned_consumables = [
                        _it for _it, _qty in character.items.items()
                        if _qty > 0 and hasattr(_it, 'duration') and _it not in hidden_items
                    ]
                    # Bug 9ce474f8: drop consumables whose stats don't apply to
                    # this activity's skill. Globally-scoped consumables still pass.
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = (
                        _filter_pet_consumable_candidates_by_skill(
                            _all_owned_consumables, _ct_target_skill, item_kind='consumable',
                        )
                    )
                    print(
                        f"[ct-worker] activity CONSUMABLE_ITEMS: "
                        f"{len(optimize_activity_gearsets.CONSUMABLE_ITEMS)}/{len(_all_owned_consumables)} "
                        f"consumables relevant to skill={_ct_target_skill!r}"
                    )
                    # Bug 3bb938f4 follow-up: print candidate names so a Fine
                    # variant missing from the pool surfaces in worker logs.
                    print(
                        f"[ct-worker] activity candidate names: "
                        f"{[getattr(c, 'name', repr(c)) for c in optimize_activity_gearsets.CONSUMABLE_ITEMS]}"
                    )
                    _owned_names = [getattr(c, 'name', repr(c)) for c in _all_owned_consumables]
                    _filtered_out = [n for n in _owned_names if n not in {
                        getattr(c, 'name', '') for c in optimize_activity_gearsets.CONSUMABLE_ITEMS
                    }]
                    if _filtered_out:
                        print(f"[ct-worker] activity consumables filtered OUT (skill mismatch): {_filtered_out}")
                else:
                    optimize_activity_gearsets.CONSUMABLE_ITEMS = []
                optimize_activity_gearsets.INCLUDE_PETS = _ct_include_pets
                if _ct_locked_pet:
                    optimize_activity_gearsets.PET_ITEMS = [_ct_locked_pet]
                elif _ct_include_pets:
                    # Pets live in character_config.pets[*] + user_overrides,
                    # NOT character.items. Use the shared helper that
                    # mirrors the column-2 path's pet-collection logic.
                    _all_owned_pets = _build_pet_items_from_character_config(
                        character_config, ui_config
                    )
                    # Bug 9ce474f8: stricter pet filter — exclude pets whose
                    # only matching stat scope is 'global'. Same logic as the
                    # recipe path above; see comment there.
                    optimize_activity_gearsets.PET_ITEMS = (
                        _filter_pet_consumable_candidates_by_skill(
                            _all_owned_pets, _ct_target_skill, item_kind='pet', is_recipe=False,
                        )
                    )
                    if not optimize_activity_gearsets.PET_ITEMS:
                        # Nothing relevant — flip include OFF so the
                        # optimizer doesn't try to score an empty pool.
                        optimize_activity_gearsets.INCLUDE_PETS = False
                    print(
                        f"[ct-worker] activity PET_ITEMS: "
                        f"{len(optimize_activity_gearsets.PET_ITEMS)}/{len(_all_owned_pets)} "
                        f"pets relevant to skill={_ct_target_skill!r}"
                    )
                else:
                    optimize_activity_gearsets.PET_ITEMS = []
                optimize_activity_gearsets.LOCKED_SLOTS = locked_items
                # Resolve activity input items (arrows / plants / fabric / ...)
                # for activities that consume them. Without this, the
                # tree-node path ignored the auto-picked / user-locked
                # input items entirely — DR/DA stats from the input
                # weren't factored into the gearset score, AND the result
                # didn't echo back which input was used so the frontend
                # had no way to render the input slot. Mirrors the
                # standard activity path's behavior.
                _ct_input_item = _resolve_input_items_for_activity(
                    input_items_raw, activity, use_fine_inputs
                )
                optimize_activity_gearsets.INPUT_ITEM = _ct_input_item
                optimize_activity_gearsets.USE_FINE_INPUTS = use_fine_inputs
                if _ct_input_item:
                    print(f"[ct-worker] INPUT_ITEM resolved: {_ct_input_item.name}")
                
                # Resolve the best location for this activity. Three cases:
                #   1. User explicitly selected a location (node_location) → use it.
                #   2. No user selection, activity has locations → iterate over
                #      them (dedupe by region, since gear stats don't vary within
                #      a region) and pick the one whose gearset scores best.
                #      Emits best_location so the frontend dropdown can show
                #      "Best → <region>" instead of falling back to "Best (auto)".
                #   3. No user selection, activity has no locations → leave as None.
                # Without this, the activity crafting_tree_node path always
                # returned best_location=null when the tree had source_type='best'
                # (the common default), and the frontend location dropdown stayed
                # unresolved even though the tree already knew which activity
                # location was optimal. Bug 622875a0.
                from util.autogenerated.locations import Location, LocationInfo
                resolved_user_loc = None
                if node_location:
                    for attr_name in dir(Location):
                        if attr_name.startswith('_'):
                            continue
                        loc = getattr(Location, attr_name)
                        if hasattr(loc, 'name'):
                            loc_id = loc.name.lower().replace(' ', '_').replace("'", '')
                            if loc_id == node_location or attr_name == node_location:
                                resolved_user_loc = loc
                                break

                activity_locations = getattr(activity, 'locations', None) or []
                if resolved_user_loc is not None:
                    candidate_locations = [resolved_user_loc]
                elif activity_locations:
                    # Dedupe by region so we don't redundantly try multiple
                    # locations in the same region (gear stats are region-scoped).
                    seen_regions = set()
                    candidate_locations = []
                    for loc in activity_locations:
                        if not isinstance(loc, LocationInfo):
                            continue
                        loc_regions = getattr(loc, 'regions', []) or []
                        region_key = loc_regions[0].lower() if loc_regions else f'__loc__{loc.name}'
                        if region_key in seen_regions:
                            continue
                        seen_regions.add(region_key)
                        candidate_locations.append(loc)
                    if not candidate_locations:
                        candidate_locations = [None]
                else:
                    candidate_locations = [None]

                if sorting_priority:
                    priority_entries, weights_dict = parse_sorting_priority(sorting_priority)
                    if priority_entries:
                        active_entries = [e for e in priority_entries if e.weight > 0]
                        optimize_activity_gearsets.SORTING_PRIORITY = active_entries if active_entries else priority_entries
                        optimize_activity_gearsets.SORTING_WEIGHTS = weights_dict

                best_loc = None
                best_gearset = None
                best_metrics = None
                best_stats = None
                best_score = None

                for candidate_loc in candidate_locations:
                    optimize_activity_gearsets.SELECTED_LOCATION = candidate_loc
                    try:
                        cand_initial = optimize_activity_gearsets.get_greedy_initial_solution(activity, character)
                        cand_gearset = optimize_activity_gearsets.local_search_refine(
                            cand_initial, activity, character, optimize_activity_gearsets.MAX_ITERATIONS
                        )
                        cand_metrics, cand_stats = optimize_activity_gearsets.calculate_gearset_metrics(
                            cand_gearset, activity, character, final=True, consumable=None
                        )
                    except Exception:
                        continue
                    # Score: lower expected steps per reward is better. When a
                    # specific target is set (chest-source node), prefer the
                    # steps_per_reward_roll::<target> composite so auto-location
                    # picks the best location for THIS chest, not any-reward.
                    # Fall back to the bare metric, then expected_steps_per_action.
                    # Bug b24a13f8.
                    cand_score = None
                    if _ct_target_obj is not None:
                        _ct_tname = optimize_activity_gearsets.get_target_name(_ct_target_obj)
                        cand_score = cand_metrics.get(f"steps_per_reward_roll::{_ct_tname}")
                    if cand_score is None:
                        cand_score = cand_metrics.get('steps_per_reward_roll')
                    if cand_score is None or cand_score == float('inf'):
                        cand_score = cand_metrics.get('expected_steps_per_action', float('inf'))
                    if best_score is None or (cand_score is not None and cand_score < best_score):
                        best_score = cand_score
                        best_loc = candidate_loc
                        best_gearset = cand_gearset
                        best_metrics = cand_metrics
                        best_stats = cand_stats

                if best_gearset is None:
                    # Total fallback — no candidate optimized successfully.
                    # Run once with no location so we still return something.
                    optimize_activity_gearsets.SELECTED_LOCATION = None
                    initial_gearset = optimize_activity_gearsets.get_greedy_initial_solution(activity, character)
                    best_gearset = optimize_activity_gearsets.local_search_refine(
                        initial_gearset, activity, character, optimize_activity_gearsets.MAX_ITERATIONS
                    )
                    best_metrics, best_stats = optimize_activity_gearsets.calculate_gearset_metrics(
                        best_gearset, activity, character, final=True, consumable=None
                    )
                    best_loc = None
                else:
                    # Re-apply the winning location as the active selected-location
                    # so any downstream code (or re-runs) uses the correct setting.
                    optimize_activity_gearsets.SELECTED_LOCATION = best_loc

                export_string = encode_gearset(best_gearset)
                location_name = best_loc.name if best_loc and hasattr(best_loc, 'name') else None

                result = {
                    'success': True,
                    'type': 'crafting_tree_node',
                    'node_source_type': node_source_type,
                    'activity_name': activity.name,
                    'best_location': location_name,
                    'gearset_export': export_string,
                    'metrics': _sanitize_metrics(best_metrics),
                    'stats': _sanitize_metrics(best_stats) if best_stats else {},
                    'items': {slot: item.name if item else None for slot, item in best_gearset.items()},
                    # Echo the input items the optimizer used so the
                    # frontend can render them in the gear preview's
                    # input slot tile (next to consumable+pet) — mirrors
                    # what the standard activity path emits. We pass
                    # back the raw request shape (idx → item dict) since
                    # that's already JSON-serializable; the frontend's
                    # tree-node-card decoder expects this shape.
                    'selected_input_items': input_items_raw or {},
                }
                _sel_pet, _sel_cons = _extract_pet_consumable_meta(best_gearset, request)
                if _sel_pet:
                    result['selected_pet'] = _sel_pet
                    print(f"[ct-worker] activity selected_pet: {_sel_pet}", flush=True)
                if _sel_cons:
                    result['selected_consumable'] = _sel_cons
                    print(f"[ct-worker] activity selected_consumable: {_sel_cons}", flush=True)
                # Compute non-owned + locked-upgrade alternatives so the
                # slot popup's "Non-owned/Locked Upgrades" section works
                # in the crafting-tree node context. Mirrors the standard
                # activity path (line ~2667). Without this,
                # gear_config.slot_alternatives ends up empty and the
                # popup permanently shows "Optimize Slot & Equip" instead
                # of the upgrades list.
                try:
                    _alts, _locked_alts = compute_slot_alternatives(
                        best_gearset, character, 'activity',
                        activity=activity,
                        consumable=best_gearset.get('consumable'),
                        sorting_priority=getattr(optimize_activity_gearsets, 'SORTING_PRIORITY', None),
                        sorting_weights=getattr(optimize_activity_gearsets, 'SORTING_WEIGHTS', {}),
                        target_item=None, target_drop_rate=0,
                        selected_location=getattr(optimize_activity_gearsets, 'SELECTED_LOCATION', None),
                        input_item=getattr(optimize_activity_gearsets, 'INPUT_ITEM', None),
                        use_fine_inputs=use_fine_inputs,
                        hidden_items=hidden_items,
                        top_n=30,
                    )
                    result['alternatives'] = _alts if _alts else {}
                    result['locked_alternatives'] = _locked_alts if _locked_alts else {}
                    _t1 = sum(len(v) for v in (_alts or {}).values())
                    _t2 = sum(len(v) for v in (_locked_alts or {}).values())
                    print(f"[ct-worker] activity alts: "
                          f"{_t1} non-owned across {len(_alts or {})} slots; "
                          f"{_t2} locked across {len(_locked_alts or {})} slots",
                          flush=True)
                except Exception as _alt_err:
                    import traceback
                    print(f"⚠ [ct-worker] activity alts failed: {_alt_err}")
                    traceback.print_exc()
                    result['alternatives'] = {}
                    result['locked_alternatives'] = {}
                sys.stdout = old_stdout
                print(json.dumps(result))
            
            else:
                if db_save_session and db_save_path:
                    try:
                        from ui.database import DatabaseManager
                        db = DatabaseManager(db_save_path)
                        db.finish_optimization(db_save_session)
                    except Exception:
                        pass
                sys.stdout = old_stdout
                print(json.dumps({'success': False, 'error': f'Invalid crafting_tree_node config: source_type={node_source_type}'}))
                sys.exit(1)
        
        else:
            # Clean up active optimization record before exiting
            if db_save_session and db_save_path:
                try:
                    from ui.database import DatabaseManager
                    db = DatabaseManager(db_save_path)
                    db.finish_optimization(db_save_session)
                except Exception:
                    pass
            sys.stdout = old_stdout
            print(json.dumps({'success': False, 'error': f'Invalid type: {opt_type}'}))
            sys.exit(1)
    
    except Exception as e:
        import traceback
        # Print to stderr (log file) BEFORE restoring stdout
        traceback.print_exc()
        print(f"FATAL: {e}")
        sys.stdout = old_stdout
        result_json = json.dumps({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        })
        print(result_json)
        # Clean up active optimization on failure
        if db_save_session and db_save_path:
            try:
                from ui.database import DatabaseManager
                db = DatabaseManager(db_save_path)
                db.finish_optimization(db_save_session)
            except Exception:
                pass
        sys.exit(1)
    
    # If --db-save was requested, save the result directly to the database
    # This ensures the gearset is persisted even if uvicorn reloads mid-optimization
    if db_save_session and db_save_path:
        # Redirect stdout to stderr so save_result_to_db's print() calls
        # go to the worker log file instead of DEVNULL
        sys.stdout = sys.stderr
        try:
            save_result_to_db(result, db_save_session, db_save_path, db_save_sorting, opt_type)
        except Exception as e:
            print(f"⚠ Failed to save to DB: {e}", file=sys.stderr)
    
    # Clean up temp file
    try:
        os.unlink(input_file)
    except Exception:
        pass

if __name__ == '__main__':
    main()
