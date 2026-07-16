#!/usr/bin/env python3
"""
Character export utilities for Walkscape
"""

import json
from typing import Dict, List, Optional, Union
from util.walkscape_constants import *
import util.walkscape_globals as walkscape_globals


class Character:
    """Represents a Walkscape character from export data"""
    
    def __init__(self, export_json: str):
        """
        Initialize character from export JSON
        
        Args:
            export_json: JSON string of character export
        """
        data = json.loads(export_json)
        
        self.name = data.get('name', 'Unknown')
        self.game_version = data.get('game_version', 'Unknown')
        self.steps = data.get('steps', 0)
        self.achievement_points = data.get('achievement_points', 0)
        self.coins = data.get('coins', 0)
        # Currencies the player holds (chips, tokens, etc.). Shape is the
        # in-game export's { "<Currency name>": qty } map, e.g.
        # {"Agility chip": 12, "Chest chips": 3}. Stored raw; the sell-for-chips
        # feature maps these names to chip ids.
        self._currencies_raw = data.get('currencies', {})
        self.currencies = self._currencies_raw
        self._all_items = {}
        
        # Custom stats (UI toggles like activity completions)
        # Format: {'screwdriver_underwater_basket_weaving': True, 'skate_skiing': True}
        # None means "not set by UI, fall back to my_config"
        # {} means "set by UI but empty, don't fall back to my_config"
        self.custom_stats = data.get('custom_stats', None)
        
        # Set global achievement points for AchievementItem defaults
        walkscape_globals.set_achievement_points(self.achievement_points)
        
        # Set global custom stats for gated stats (only if not None)
        if self.custom_stats is not None:
            walkscape_globals.set_custom_stats(self.custom_stats)
        
        # Skills
        self.skills = data.get('skills', {})
        
        # Calculate and set global total skill level (must be after self.skills is set)
        self._total_skill_level = sum(xp_to_level(xp) for xp in self.skills.values())
        walkscape_globals.set_total_skill_level(self._total_skill_level)
        
        # Gear (equipped items)
        self._gear_raw = data.get('gear', {})
        self.gear = self._parse_gear(self._gear_raw)
        
        # Inventory
        self._inventory_raw = data.get('inventory', {})
        self.inventory = self._parse_items(self._inventory_raw)
        
        # Bank
        self._bank_raw = data.get('bank', {})
        self.bank = self._parse_items(self._bank_raw)
        
        # Consumables
        self._consumables_raw = data.get('consumables', {})
        self.consumables = self._parse_items(self._consumables_raw)  # TODO: Parse consumables
        
        # Collectibles - parse to CollectibleInstance objects
        self._collectibles_raw = data.get('collectibles', [])
        self.collectibles = self._parse_collectibles(self._collectibles_raw)

        # Set global total obtained-collectibles count (for CollectibleOwned
        # gated stats, e.g. the item collection ring). Use the raw export list
        # length so brand-new/unknown collectibles still count toward the total.
        walkscape_globals.set_total_collectibles(len(self._collectibles_raw))
        
        # Pets - parse from export (supports both old list format and new dict format)
        # New format has "pets" with active pet, plus "available_pets" and "available_eggs" at root level
        self._pets_raw = data.get('pets', [])
        self._available_pets_raw = data.get('available_pets', [])
        self._available_eggs_raw = data.get('available_eggs', [])
        self.pets = self._parse_pets(self._pets_raw, self._available_pets_raw, self._available_eggs_raw)
        
        # # Chests
        # self.chests = data.get('chests', {})  # TODO: Parse chests
        
        # Reputation
        self.reputation = data.get('reputation', {})
        
        # Cache expensive calculations for performance
        self._tool_slots = None  # Cached tool slots count
    
    def _parse_gear(self, gear_dict: Dict[str, str]) -> Dict[str, object]:
        """Parse equipped gear from export names"""
        parsed = {}
        for slot, export_name in gear_dict.items():
            if export_name:
                item = get_item_from_export_name(export_name)
                if item:
                    # Handle AchievementItem (like Omni-Tool)
                    if hasattr(item, '__class__') and item.__class__.__name__ == 'AchievementItem':
                        # Use character's achievement points
                        item = item[self.achievement_points]
                    parsed[slot] = item
                else:
                    print(f"Warning: Could not find gear item '{export_name}' for slot {slot}")
        return parsed
    
    def _parse_items(self, items_dict: Dict[str, int]) -> Dict[Union[object, str], int]:
        """Parse items from export names to Item/Material/Consumable objects with quantities"""
        parsed = {}
        for export_name, quantity in items_dict.items():
            # Try equipment first
            item = get_item_from_export_name(export_name)
            if item:
                parsed[item] = quantity
            else:
                # Try materials
                material = Material.by_export_name(export_name)
                if material:
                    parsed[material] = quantity
                else:
                    # Try consumables
                    consumable = Consumable.by_export_name(export_name)
                    if consumable:
                        parsed[consumable] = quantity
                    else:
                        # Keep unknown items as strings for now
                        parsed[export_name] = quantity
        return parsed
    
    def _parse_collectibles(self, collectibles_list: List[str]) -> List[object]:
        """Parse collectibles from export names to CollectibleInstance objects"""
        from util.walkscape_constants import collectible_by_export_name as by_export_name
        parsed = []
        for collectible_name in collectibles_list:
            collectible = by_export_name(collectible_name)
            if collectible:
                parsed.append(collectible)
            else:
                print(f"Warning: Collectible '{collectible_name}' not found")
        return parsed
    
    def _parse_pets(self, pets_data, available_pets=None, available_eggs=None) -> List[Dict]:
        """Parse pets from export data into normalized list of pet dicts.
        
        Supports two formats:
        - New format: "pets": {"pet": {...}}, "available_pets": [...], "available_eggs": [...]
          (available_pets and available_eggs are at root level, not inside pets)
        - Old format (list): [{"name": ..., "level": ...}, ...] or ["pet_name", ...]
        
        Returns list of dicts with: name, species, level, xp, stage, abilities
        """
        try:
            from util.autogenerated.pets import PETS_BY_NAME, PETS_BY_RARE_EXPORT_NAME
        except ImportError:
            PETS_BY_NAME = {}
            PETS_BY_RARE_EXPORT_NAME = {}
        
        if available_pets is None:
            available_pets = []
        if available_eggs is None:
            available_eggs = []
        
        def _resolve_pet(pet_entry):
            """Resolve a single pet entry to a normalized dict with abilities."""
            if isinstance(pet_entry, str):
                # Old format: just a name string — try rare name lookup too
                normalized = pet_entry.lower().replace(' ', '_').replace('-', '_')
                if normalized in PETS_BY_RARE_EXPORT_NAME:
                    pet_levels = PETS_BY_RARE_EXPORT_NAME[normalized]
                    return {'name': pet_entry, 'species': pet_levels.name.lower(), 'level': 0, 'xp': 0, 'stage': 'egg'}
                return {'name': pet_entry, 'species': pet_entry.lower(), 'level': 0, 'xp': 0, 'stage': 'egg'}
            if not isinstance(pet_entry, dict):
                return None
            
            species = pet_entry.get('species', '').lower()
            name = pet_entry.get('name', species.capitalize())
            level = pet_entry.get('level', 0)
            xp = pet_entry.get('xp', 0)
            stage = pet_entry.get('stage', 'egg')
            
            # Look up abilities from our pet data using species
            abilities = []
            species_title = species.capitalize()
            pet_levels = PETS_BY_NAME.get(species_title)
            
            # If species didn't match, try matching by rare export name
            # (handles cases where species or name is the rare variant)
            found_via_rare_name = False
            if not pet_levels:
                normalized = species.replace(' ', '_').replace('-', '_')
                pet_levels = PETS_BY_RARE_EXPORT_NAME.get(normalized)
                if pet_levels:
                    found_via_rare_name = True
                else:
                    # Also try the display name
                    normalized_name = name.lower().replace(' ', '_').replace('-', '_')
                    pet_levels = PETS_BY_RARE_EXPORT_NAME.get(normalized_name)
                    if pet_levels:
                        found_via_rare_name = True
                if pet_levels:
                    # Found via rare name — fix species to the canonical name
                    species = pet_levels.name.lower()
            
            # Detect rare variant:
            # - If the pet's name matches the rare display name (e.g. "Regal Tiger"), OR
            # - If the species field in the export was a rare export name (e.g. "regal_tiger" for an egg)
            is_rare = found_via_rare_name
            if not is_rare and pet_levels and pet_levels.rare_name:
                name_lower = name.lower()
                if name_lower == pet_levels.rare_name.lower():
                    is_rare = True
            
            if pet_levels:
                pet_info = pet_levels.get_level(level)
                if pet_info and pet_info.abilities:
                    abilities = pet_info.abilities
            
            return {
                'name': name,
                'species': species,
                'level': level,
                'xp': xp,
                'stage': stage,
                'abilities': abilities,
                'variant': 'rare' if is_rare else 'normal',
            }
        
        result = []
        
        if isinstance(pets_data, dict):
            # New format: "pets": {"pet": {...}, "egg": {...}} with available_pets/available_eggs at root
            active_pet = pets_data.get('pet')
            if active_pet:
                parsed = _resolve_pet(active_pet)
                if parsed:
                    parsed['active'] = True
                    result.append(parsed)
            
            # Parse the egg nested inside the pets dict (e.g. "pets": {"pet": {...}, "egg": {...}})
            active_egg = pets_data.get('egg')
            if active_egg:
                parsed = _resolve_pet(active_egg)
                if parsed:
                    parsed['active'] = False
                    parsed['stage'] = 'egg'
                    parsed['level'] = 0
                    result.append(parsed)
            
            # Also check if available_pets/available_eggs are nested inside pets (just in case)
            for pet_entry in pets_data.get('available_pets', []):
                parsed = _resolve_pet(pet_entry)
                if parsed:
                    parsed['active'] = False
                    result.append(parsed)
            
            for egg_entry in pets_data.get('available_eggs', []):
                parsed = _resolve_pet(egg_entry)
                if parsed:
                    parsed['active'] = False
                    if parsed['level'] == 0:
                        parsed['stage'] = 'egg'
                    result.append(parsed)
        
        elif isinstance(pets_data, list):
            # Old format: list of pet entries
            for pet_entry in pets_data:
                parsed = _resolve_pet(pet_entry)
                if parsed:
                    result.append(parsed)
        
        # Process root-level available_pets (new format)
        for pet_entry in available_pets:
            parsed = _resolve_pet(pet_entry)
            if parsed:
                parsed['active'] = False
                result.append(parsed)
        
        # Process root-level available_eggs (new format)
        for egg_entry in available_eggs:
            parsed = _resolve_pet(egg_entry)
            if parsed:
                parsed['active'] = False
                if parsed['level'] == 0:
                    parsed['stage'] = 'egg'
                result.append(parsed)
        
        return result
    
    @property
    def items(self) -> Dict[object, int]:
        """
        Get all items (gear + inventory + bank) with quantities
        Gear items have quantity 1
        """
        if self._all_items: 
            return self._all_items
        self._all_items = {}
        
        # Add gear (quantity 1 each)
        for slot, item in self.gear.items():
            self._all_items[item] = self._all_items.get(item, 0) + 1
        
        # Add inventory
        for item, qty in self.inventory.items():
            self._all_items[item] = self._all_items.get(item, 0) + qty
        
        # Add bank
        for item, qty in self.bank.items():
            self._all_items[item] = self._all_items.get(item, 0) + qty
        
        return self._all_items
    
    @property
    def equipment_items(self) -> Dict[object, int]:
        """Get only equipment items with quantities"""
        return {item: qty for item, qty in self.items.items() if hasattr(item, 'slot')}
    
    @property
    def material_items(self) -> Dict[object, int]:
        """Get only materials with quantities"""
        # Material already imported from walkscape_constants
        return {item: qty for item, qty in self.items.items() if isinstance(item, Material)}
    
    @property
    def consumable_items(self) -> Dict[object, int]:
        """Get only consumables with quantities"""
        # Consumable already imported from walkscape_constants
        return {item: qty for item, qty in self.items.items() if isinstance(item, Consumable)}
    
    def get_skill_level(self, skill: str) -> int:
        """Get level for a skill from XP"""
        skillName = skill
        if hasattr(skill, "name"): 
            skillName = skill.name
        skill_key = skillName.lower()
        # Smelting is a sub-skill of Smithing — it has no XP track of its own.
        # Smelting actions grant Smithing XP, so resolve the Smithing level when
        # a "smelting" scope is queried (e.g. when optimizing a bar-smelting
        # recipe with Skill.SMELTING for the Tortoise L4 bonus-XP scope).
        if skill_key == "smelting":
            skill_key = "smithing"
        xp = self.skills.get(skill_key, 0)
        return xp_to_level(xp)
    
    def get_total_skill_level(self) -> int:
        """Get total skill level (sum of all skill levels)"""
        return self._total_skill_level
    
    def get_character_level(self) -> int:
        """Get character level based on total steps"""
        # character_level_from_steps already imported from walkscape_constants
        return 1 + character_level_from_steps(self.steps)
    
    def get_tool_slots(self) -> int:
        """Get number of tool slots available based on character level (cached for performance)"""
        if self._tool_slots is None:
            self._tool_slots = tool_slots_for_level(self.get_character_level())
        return self._tool_slots
    
    def get_total_value(self) -> int:
        """Get total coin value of all items (gear + inventory + bank)"""
        total = 0
        for item, qty in self.items.items():
            if hasattr(item, 'value'):
                total += item.value * qty
        return total
    
    def get_duplicate_value(self, min_quantity: int = 2) -> int:
        """Get total value of items with quantity >= min_quantity"""
        total = 0
        for item, qty in self.items.items():
            if qty >= min_quantity and hasattr(item, 'value'):
                total += item.value * qty
        return total
    
    def get_equipment_value(self) -> int:
        """Get total value of equipped gear (with duplicates if any)"""
        total = 0
        for slot, item in self.gear.items():
            if hasattr(item, 'value'):
                # Count how many of this item we have total
                qty = self.items.get(item, 0)
                total += item.value * qty
        return total
    
    def get_equipment_duplicate_value(self, min_quantity: int = 2) -> int:
        """Get total value of equipment items with quantity >= min_quantity"""
        # Item already imported from walkscape_constants
        total = 0
        for item, qty in self.items.items():
            if qty >= min_quantity and hasattr(item, 'value'):
                # Check if it's equipment (not material or consumable)
                if hasattr(item, 'slot'):
                    total += item.value * qty
        return total
    
    def __repr__(self):
        return f"Character({self.name}, {self.steps:,} steps, {self.achievement_points} AP)"
