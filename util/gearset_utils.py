#!/usr/bin/env python3
"""
Utilities for working with Walkscape gearset exports
"""

import base64
import zlib
import json
from typing import Dict, List, Optional, Tuple, Union
from util.walkscape_constants import *

# Import validation functions at module level for performance
from util.optimization_utils import (
    validate_uuid_uniqueness,
    validate_tool_keywords,
    is_gearset_complete
)


def get_quality_rank(item_name: str) -> int:
    """
    Get quality rank for an item (lower rank = better quality).
    
    Args:
        item_name: Item name (may include quality like "Iron Sickle (Perfect)")
    
    Returns:
        Rank (0=Eternal, 1=Perfect, ..., 5=Normal, 999=no quality)
    """
    quality_order = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal']
    for rank, quality in enumerate(quality_order):
        if f'({quality})' in item_name:
            return rank
    return 999  # No quality = lowest priority


class Gearset:
    """Represents a complete equipment loadout"""
    
    def __init__(self, export_string: str = None):
        """
        Initialize gearset from export string or empty
        
        Args:
            export_string: Optional base64-encoded gearset export
        """
        self._head = None
        self._cape = None
        self._back = None
        self._chest = None
        self._primary = None
        self._secondary = None
        self._hands = None
        self._legs = None
        self._neck = None
        self._feet = None
        self._ring1 = None
        self._ring2 = None
        self._tool0 = None
        self._tool1 = None
        self._tool2 = None
        self._tool3 = None
        self._tool4 = None
        self._tool5 = None
        
        if export_string:
            self._load_from_export(export_string)
    
    @classmethod
    def from_dict(cls, gearset_dict: dict) -> 'Gearset':
        """
        Create a Gearset object from a dictionary.
        
        Args:
            gearset_dict: Dict with slot names as keys and Item objects as values
        
        Returns:
            Gearset object
        """
        gearset = cls()
        for slot, item in gearset_dict.items():
            if hasattr(gearset, f'_{slot}'):
                setattr(gearset, f'_{slot}', item)
        return gearset
    
    def _load_from_export(self, export_string: str):
        """Load gearset from export string"""
        data = decode_gearset(export_string)
        
        for item_data in data['items']:
            if item_data['item'] == 'null':
                continue
            
            item_json = json.loads(item_data['item'])
            uuid = item_json['id']
            quality = item_json.get('quality', 'uncommon')
            
            # Look up in equipment
            equipment_item = Item.by_uuid(uuid, quality)
            
            # Assign to appropriate slot
            slot_type = item_data['type']
            index = item_data.get('index', 0)
            
            if slot_type == 'ring':
                if index == 0:
                    self._ring1 = equipment_item
                elif index == 1:
                    self._ring2 = equipment_item
            elif slot_type == 'tool':
                setattr(self, f'_tool{index}', equipment_item)
            else:
                setattr(self, f'_{slot_type}', equipment_item)
    
    # Gear slot properties
    @property
    def head(self): return self._head
    
    @property
    def cape(self): return self._cape
    
    @property
    def back(self): return self._back
    
    @property
    def chest(self): return self._chest
    
    @property
    def primary(self): return self._primary
    
    @property
    def secondary(self): return self._secondary
    
    @property
    def hands(self): return self._hands
    
    @property
    def legs(self): return self._legs
    
    @property
    def neck(self): return self._neck
    
    @property
    def feet(self): return self._feet
    
    @property
    def ring1(self): return self._ring1
    
    @property
    def ring2(self): return self._ring2
    
    # Tool slot properties
    @property
    def tool0(self): return self._tool0
    
    @property
    def tool1(self): return self._tool1
    
    @property
    def tool2(self): return self._tool2
    
    @property
    def tool3(self): return self._tool3
    
    @property
    def tool4(self): return self._tool4
    
    @property
    def tool5(self): return self._tool5
    
    def get_all_items(self) -> List[Tuple[str, object]]:
        """Get all equipped items as (slot_name, item) tuples"""
        items = []
        slots = ['head', 'cape', 'back', 'chest', 'primary', 'secondary', 
                'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2',
                'tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5']
        
        for slot in slots:
            item = getattr(self, slot)
            if item:
                items.append((slot, item))
        
        return items
    
    def get_total_stats(self, skill: Union[Skill, str] = Skill.TRAVEL, location: str = None) -> Dict[str, float]:
        """
        Calculate total stats from all equipped items, including set bonuses
        
        Args:
            skill: Skill enum to filter stats for (default: Skill.TRAVEL for agility+traveling+global)
            location: Optional location for location-aware stats (e.g., 'Jarvonia', 'syrenthia')
        
        Returns:
            Dict with full stat names (work_efficiency, double_action, etc.)
        """
        total = {}
        
        # First, calculate set piece counts
        set_piece_counts = self._calculate_set_piece_counts()
        
        # Calculate stats from all items, including set bonuses per piece
        for slot, item in self.get_all_items():
            stats = item.get_stats_for_skill(skill, location=location, set_piece_counts=set_piece_counts)
            for stat_name, value in stats.items():
                total[stat_name] = total.get(stat_name, 0.0) + value
        
        # Round all values
        for stat_name in total:
            total[stat_name] = round(total[stat_name], 4)
        
        return total
    
    def _calculate_set_piece_counts(self) -> Dict[str, int]:
        """
        Calculate how many unique pieces of each set are equipped.
        
        Returns:
            Dict mapping set names (lowercase) to unique piece counts
        """
        set_counts = {}
        unique_items_per_set = {}  # Track unique item UUIDs per set
        
        for slot, item in self.get_all_items():
            if not hasattr(item, 'keywords'):
                continue
            
            for keyword in item.keywords:
                # Normalize keyword to lowercase for matching
                keyword_lower = keyword.lower()
                
                if keyword_lower not in unique_items_per_set:
                    unique_items_per_set[keyword_lower] = set()
                
                # Add item UUID to track uniqueness
                unique_items_per_set[keyword_lower].add(item.uuid)
        
        # Count unique items per set
        for set_name, uuids in unique_items_per_set.items():
            set_counts[set_name] = len(uuids)
        
        return set_counts
    
    def __repr__(self):
        items = self.get_all_items()
        return f"Gearset({len(items)} items equipped)"


# ============================================================================
# GEARSET STAT AGGREGATION
# ============================================================================

def aggregate_gearset_stats(
    items: list,
    skill: str,
    location,
    character,
    include_level_bonus: bool = True,
    include_collectibles: bool = True,
    activity_level: int = 1
) -> Dict[str, float]:
    """
    Aggregate stats from a list of items, character level, and collectibles.
    
    Includes set bonuses by calculating set piece counts first.
    
    Args:
        items: List of item objects (can include None)
        skill: Skill name (e.g., 'agility', 'carpentry')
        location: Location object or None
        character: Character object with skill levels and collectibles
        include_level_bonus: Whether to add level bonus WE
        include_collectibles: Whether to add collectible stats
        activity_level: Required level for the activity (default 1)
        
    Returns:
        Dictionary of aggregated stats in decimal format
    """
    total_stats = {}
    
    # Calculate set piece counts for set bonuses
    set_piece_counts = _calculate_set_piece_counts_from_items(items)
    
    # Aggregate item stats (including set bonuses)
    for item in items:
        if item is None:
            continue
        
        item_stats = item.get_stats_for_skill(
            skill, 
            location=location, 
            character=character,
            set_piece_counts=set_piece_counts
        )
        
        for stat_name, stat_value in item_stats.items():
            total_stats[stat_name] = total_stats.get(stat_name, 0.0) + stat_value
    
    # Add level bonus WE (capped at 20 levels ABOVE activity level)
    if include_level_bonus:
        skill_level = character.get_skill_level(skill.lower())
        levels_above = max(0, skill_level - activity_level)  # Levels above activity requirement
        level_bonus_we = min(levels_above, 20) * 0.0125  # 1.25% per level, capped at 20 levels
        total_stats['work_efficiency'] = total_stats.get('work_efficiency', 0.0) + level_bonus_we
        # Add level bonus QO
        level_bonus_qo = max(0, skill_level - activity_level)
        total_stats['quality_outcome'] = total_stats.get('quality_outcome', 0.0) + level_bonus_qo
    
    # Add collectible stats
    if include_collectibles:
        try:
            from util.collectibles_utils import calculate_collectible_stats
            collectible_stats = calculate_collectible_stats(character.collectibles, skill, location)
            for stat_name, stat_value in collectible_stats.items():
                total_stats[stat_name] = total_stats.get(stat_name, 0.0) + stat_value
        except:
            pass
    
    return total_stats


def _calculate_set_piece_counts_from_items(items: list) -> Dict[str, int]:
    """
    Calculate how many unique pieces of each set are in the item list.
    
    Args:
        items: List of item objects (can include None)
        
    Returns:
        Dict mapping set names (lowercase) to unique piece counts
    """
    set_counts = {}
    unique_items_per_set = {}  # Track unique item UUIDs per set
    
    for item in items:
        if item is None or not hasattr(item, 'keywords'):
            continue
        
        for keyword in item.keywords:
            # Normalize keyword to lowercase for matching
            keyword_lower = keyword.lower()
            
            if keyword_lower not in unique_items_per_set:
                unique_items_per_set[keyword_lower] = set()
            
            # Add item UUID to track uniqueness
            unique_items_per_set[keyword_lower].add(item.uuid)
    
    # Count unique items per set
    for set_name, uuids in unique_items_per_set.items():
        set_counts[set_name] = len(uuids)
    
    return set_counts


# ============================================================================
# GEARSET ENCODING/DECODING
# ============================================================================


def decode_gearset(export_string: str) -> dict:
    """
    Decode a gearset export string from Walkscape
    
    Args:
        export_string: Base64-encoded, gzip-compressed JSON string
        
    Returns:
        Dictionary with gearset data including items array
    """
    # Add padding if needed
    padding = len(export_string) % 4
    if padding:
        export_string += '=' * (4 - padding)
    
    # Decode base64
    decoded = base64.b64decode(export_string)
    
    # Decompress gzip
    decompressed = zlib.decompress(decoded, 16 + zlib.MAX_WBITS)
    
    # Parse JSON
    return json.loads(decompressed)


def extract_tools_from_gearset(export_string: str) -> Dict[str, dict]:
    """
    Extract tool items from a gearset export
    
    Args:
        export_string: Base64-encoded gearset export
        
    Returns:
        Dictionary mapping item names to their stats in format:
        {'Item Name': {'we': 0.0, 'da': 0.0, 'flat': 0, 'pct': 0.0}}
    """
    data = decode_gearset(export_string)
    tools = {}
    
    for item_data in data['items']:
        if item_data['type'] == 'tool' and item_data['item'] != 'null':
            item_json = json.loads(item_data['item'])
            uuid = item_json['id']
            quality = item_json.get('quality', 'uncommon')
            
            # Look up in equipment module
            equipment_item = Item.by_uuid(uuid, quality)
            
            if equipment_item:
                tools[equipment_item.name] = equipment_item.attr
    
    return tools


def get_tool_by_index(export_string: str, index: int) -> Optional[object]:
    """
    Get a specific tool from gearset by index (0-5)
    
    Args:
        export_string: Base64-encoded gearset export
        index: Tool slot index (0-5)
        
    Returns:
        ItemInstance object or None if slot is empty or not found
    """
    data = decode_gearset(export_string)
    
    for item_data in data['items']:
        if item_data['type'] == 'tool' and item_data['index'] == index:
            if item_data['item'] == 'null':
                return None
            
            item_json = json.loads(item_data['item'])
            uuid = item_json['id']
            quality = item_json.get('quality', 'uncommon')
            
            return Item.by_uuid(uuid, quality)
    
    return None



def gearset_to_stats(gearset_export: str, skill: Union[Skill, str] = Skill.TRAVEL, location: str = None) -> dict:
    """
    Convert a gearset export string to stats dict format
    
    Args:
        gearset_export: Base64-encoded gearset export string
        skill: Skill to filter stats for (default: Skill.TRAVEL for agility+traveling+global)
        location: Optional location for location-aware stats
        
    Returns:
        Dict with full stat names (work_efficiency, double_action, etc.)
        
    Example:
        stats = gearset_to_stats("H4sIAAAA...", Skill.TRAVEL)
        # Returns: {'double_action': 0.64, 'work_efficiency': 1.11, 'steps_add': 6, 'steps_percent': 0.01}
    """
    gearset = Gearset(gearset_export)
    return gearset.get_total_stats(skill, location=location)


def calculate_gear_stats(gearset_export: str, skill: str, location: str = None, return_breakdown: bool = False):
    """
    Calculate crafting-relevant stats from a gearset for a given skill.
    
    Args:
        gearset_export: Base64-encoded gearset export string
        skill: Skill name (e.g., 'Carpentry', 'Cooking', 'Crafting', 'Smithing', 'Trinketry')
        location: Optional location for location-aware stats
        return_breakdown: If True, returns (stats, breakdown) tuple
        
    Returns:
        Dict with keys: 'we', 'dr', 'nmc', 'qo' (all as percentages/values)
        Or tuple of (stats, breakdown) if return_breakdown=True
    """
    stats = {
        'we': 0.0,  # Work Efficiency
        'dr': 0.0,  # Double Rewards
        'da': 0.0,  # Double Action
        'nmc': 0.0,  # No Materials Consumed
        'qo': 0.0,  # Quality Outcome
        'flat': 0,  # Flat steps modifier
        'pct': 0.0,  # Percentage steps modifier
        'bonus_xp_percent': 0.0,  # Bonus XP percentage
        'bonus_xp_add': 0.0,  # Flat bonus XP
    }
    
    breakdown = []
    data = decode_gearset(gearset_export)
    
    for item_data in data['items']:
        if item_data['item'] == 'null':
            continue
        
        item_json = json.loads(item_data['item'])
        uuid = item_json['id']
        quality = item_json.get('quality', 'uncommon')
        
        # Look up in equipment
        equipment_item = Item.by_uuid(uuid, quality)
        if not equipment_item:
            continue
        
        # Get raw stats for this skill (need to access _stats directly for crafting stats)
        skill_lower = skill.lower()
        combined = {}
        
        # Handle different item types
        if hasattr(equipment_item, 'get_stats_for_skill'):
            # Use get_stats_for_skill which automatically includes global stats
            combined = equipment_item.get_stats_for_skill(skill_lower, location=location)
        elif hasattr(equipment_item, 'attr'):
            # AchievementItem or CraftedItem - use attr method
            # But attr only returns travel stats, so we need to get raw stats differently
            # For now, use attr and convert back
            attr_stats = equipment_item.attr(skill, location=location)
            # Convert attr format back to raw format
            if attr_stats.get('we', 0) > 0:
                combined['work_efficiency'] = attr_stats['we'] * 100
            if attr_stats.get('da', 0) > 0:
                combined['double_rewards'] = attr_stats['da'] * 100
        
        # Store breakdown
        breakdown.append((equipment_item.name, combined))
        
        # Accumulate stats
        if 'work_efficiency' in combined:
            stats['we'] += combined['work_efficiency']
        if 'double_rewards' in combined:
            stats['dr'] += combined['double_rewards']
        if 'double_action' in combined:
            stats['da'] += combined['double_action']
        if 'no_materials_consumed' in combined:
            stats['nmc'] += combined['no_materials_consumed']
        if 'quality_outcome' in combined:
            stats['qo'] += combined['quality_outcome']
        if 'steps_add' in combined:
            stats['flat'] += int(combined['steps_add'])
        if 'steps_percent' in combined:
            stats['pct'] += combined['steps_percent']
        if 'bonus_xp_percent' in combined:
            stats['bonus_xp_percent'] += combined['bonus_xp_percent']
        if 'bonus_xp_add' in combined:
            stats['bonus_xp_add'] += combined['bonus_xp_add']
    
    if return_breakdown:
        return stats, breakdown
    return stats



def encode_gearset(gearset_dict: Dict[str, object]) -> str:
    """
    Encode a gearset dictionary to export string
    
    Args:
        gearset_dict: Dictionary mapping slot names to items
                     e.g., {'head': item, 'tool0': item, 'ring1': item}
    
    Returns:
        Base64-encoded, gzip-compressed JSON string
    """
    # Build items array
    items = []
    
    # Map slot names to gearset export format
    slot_type_map = {
        'head': 'head',
        'cape': 'cape',
        'back': 'back',
        'chest': 'chest',
        'primary': 'primary',
        'secondary': 'secondary',
        'hands': 'hands',
        'legs': 'legs',
        'neck': 'neck',
        'feet': 'feet',
    }
    
    # Add gear slots
    for slot_name, slot_type in slot_type_map.items():
        if slot_name in gearset_dict and gearset_dict[slot_name] is not None:
            item = gearset_dict[slot_name]
            
            # Extract quality from item name using shared constant
            quality = 'common'  # Default for non-crafted items
            for quality_name, quality_value in QUALITY_NAME_TO_EXPORT.items():
                if f'({quality_name})' in item.name:
                    quality = quality_value
                    break
            
            items.append({
                'type': slot_type,
                'index': 0,
                'item': json.dumps({
                    'id': item.uuid,
                    'quality': quality,
                    'tag': None
                }),
                'errors': []
            })
        else:
            items.append({
                'type': slot_type,
                'index': 0,
                'item': 'null',
                'errors': []
            })
    
    # Add ring slots
    for ring_num in range(1, 3):
        slot_name = f'ring{ring_num}'
        if slot_name in gearset_dict and gearset_dict[slot_name] is not None:
            item = gearset_dict[slot_name]
            
            # Extract quality from item name using shared constant
            quality = 'common'  # Default for non-crafted items
            for quality_name, quality_value in QUALITY_NAME_TO_EXPORT.items():
                if f'({quality_name})' in item.name:
                    quality = quality_value
                    break
            
            items.append({
                'type': 'ring',
                'index': ring_num - 1,
                'item': json.dumps({
                    'id': item.uuid,
                    'quality': quality,
                    'tag': None
                }),
                'errors': []
            })
        else:
            items.append({
                'type': 'ring',
                'index': ring_num - 1,
                'item': 'null',
                'errors': []
            })
    
    # Add tool slots
    for tool_num in range(6):
        slot_name = f'tool{tool_num}'
        if slot_name in gearset_dict and gearset_dict[slot_name] is not None:
            item = gearset_dict[slot_name]
            
            # Extract quality from item name using shared constant
            quality = 'common'  # Default for non-crafted items
            for quality_name, quality_value in QUALITY_NAME_TO_EXPORT.items():
                if f'({quality_name})' in item.name:
                    quality = quality_value
                    break
            
            items.append({
                'type': 'tool',
                'index': tool_num,
                'item': json.dumps({
                    'id': item.uuid,
                    'quality': quality,
                    'tag': None
                }),
                'errors': []
            })
        else:
            items.append({
                'type': 'tool',
                'index': tool_num,
                'item': 'null',
                'errors': []
            })
    
    # Create full gearset JSON
    gearset_json = {'items': items}
    
    # Compress and encode
    json_str = json.dumps(gearset_json)
    compressed = zlib.compress(json_str.encode('utf-8'), wbits=16 + zlib.MAX_WBITS)
    encoded = base64.b64encode(compressed).decode('utf-8')
    
    return encoded


# ============================================================================
# GEARSET VALIDATION
# ============================================================================

def is_gearset_valid(
    gearset_dict: dict,
    character,
    activity=None,
    service=None,
    check_requirements: bool = True
) -> bool:
    """
    Validate gearset respects all constraints.
    
    Unified validation function that checks:
    - UUID uniqueness (respecting owned quantities)
    - Tool keyword uniqueness
    - Activity/Service requirements (if provided)
    
    Args:
        gearset_dict: Slot -> Item mapping
        character: Character object
        activity: Optional activity for requirement checking
        service: Optional service for requirement checking (TODO: implement)
        check_requirements: Whether to check activity/service requirements
    
    Returns:
        True if valid, False otherwise
    
    Note:
        Service validation is not yet implemented. Services need to be refactored
        to have an is_unlocked() method like Activities do.
    """
    # Validate UUID uniqueness
    if not validate_uuid_uniqueness(list(gearset_dict.values()), character):
        return False
    
    # Validate tool keywords
    tools = [gearset_dict.get(f'tool{i}') for i in range(6) if f'tool{i}' in gearset_dict]
    if not validate_tool_keywords(tools, EXCLUDED_TOOL_KEYWORDS):
        return False
    
    # Check activity requirements if requested
    if activity and check_requirements:
        # Check requirements even on incomplete gearsets
        # This is important for activities that don't use weapons (primary/secondary)
        gearset_obj = Gearset.from_dict(gearset_dict)
        if not activity.is_unlocked(gearset=gearset_obj, character=character):
            return False
    
    # Check service requirements if requested
    if service and check_requirements:
        # Check service requirements even on incomplete gearsets (like activities)
        gearset_obj = Gearset.from_dict(gearset_dict)
        if not service.is_unlocked(character, gearset=gearset_obj):
            return False
    
    return True
