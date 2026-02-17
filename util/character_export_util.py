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
        xp = self.skills.get(skillName.lower(), 0)
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
