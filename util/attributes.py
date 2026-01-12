#!/usr/bin/env python3
"""
Walkscape Attribute Enum

Centralized definition of all attributes in Walkscape with metadata.
"""

from enum import Enum
from dataclasses import dataclass

@dataclass
class AttributeInfo:
    """Metadata about an attribute."""
    internal_name: str
    abbreviation: str
    display_name: str
    is_percentage: bool
    description: str = ""

class Attribute(Enum):
    """
    All attributes in Walkscape with their metadata.
    Generated from https://wiki.walkscape.app/wiki/Attributes
    """
    
    # 1. Bonus Experience (can be flat or percentage)
    BONUS_XP_ADD = AttributeInfo(
        'bonus_xp_add', 'XP', 'Bonus Experience (Flat)', False,
        'Changes the base experience rewarded on action completion.'
    )
    BONUS_XP_PERCENT = AttributeInfo(
        'bonus_xp_percent', 'XP%', 'Bonus Experience (%)', True,
        'Changes the percentage of experience rewarded on action completion.'
    )
    
    # 2. Chest Finding
    CHEST_FINDING = AttributeInfo(
        'chest_finding', 'CF', 'Chest Finding', True,
        'Changes the chance to find chests on action completion.'
    )
    
    # 3. Double Action
    DOUBLE_ACTION = AttributeInfo(
        'double_action', 'DA', 'Double Action', True,
        'On completion, changes the chance for an action to give full rewards (experience and loot table rolls) twice.'
    )
    
    # 4. Double Rewards
    DOUBLE_REWARDS = AttributeInfo(
        'double_rewards', 'DR', 'Double Rewards', True,
        'On completion, changes the chance for an action to give you two loot rolls instead of one.'
    )
    
    # 5. Find Bird Nests
    FIND_BIRD_NESTS = AttributeInfo(
        'find_bird_nests', 'FBN', 'Find Bird Nests', True,
        'Changes the chance to find Bird Nests on action completion.'
    )
    
    # 6. Find Collectibles
    FIND_COLLECTIBLES = AttributeInfo(
        'find_collectibles', 'FC', 'Find Collectibles', True,
        'Changes the chance to find Collectibles on action completion.'
    )
    
    # 7. Find Gems
    FIND_GEMS = AttributeInfo(
        'find_gems', 'FG', 'Find Gems', True,
        'Changes the chance to find gems on action completion.'
    )
    
    # 8. Fine Material Finding
    FINE_MATERIAL_FINDING = AttributeInfo(
        'fine_material_finding', 'FMF', 'Fine Material Finding', True,
        'Changes the chance to find fine materials on action completion.'
    )
    
    # 9. Inventory Space
    INVENTORY_SPACE = AttributeInfo(
        'inventory_space', 'INV', 'Inventory Space', False,
        'Adds additional maximum inventory spaces as long the item providing them is equipped.'
    )
    
    # 10. Item Finding
    # TODO: Implement and expand this
    ITEM_FINDING = AttributeInfo(
        'item_finding', 'IF', 'Item Finding', True,
        'Adds a chance to find the specified object after every action.'
    )
    
    # 11. No Materials Consumed
    NO_MATERIALS_CONSUMED = AttributeInfo(
        'no_materials_consumed', 'NMC', 'No Materials Consumed', True,
        'Adds a chance to not use up the materials required for an activity that requires them.'
    )
    
    # 12. Quality Outcome
    QUALITY_OUTCOME = AttributeInfo(
        'quality_outcome', 'QO', 'Quality Outcome', False,
        'Changes the probabilities of getting higher quality crafted items.'
    )
    
    # 13. Steps Required (can be flat or percentage)
    STEPS_ADD = AttributeInfo(
        'steps_add', 'Flat', 'Steps Required (Flat)', False,
        'Removes the listed amount of steps from the activity you are doing, great if you have capped on work efficiency!'
    )
    STEPS_PERCENT = AttributeInfo(
        'steps_percent', 'Pct', 'Steps Required (%)', True,
        'Removes the listed percentage of steps from the activity you are doing, great if you have capped on work efficiency!'
    )
    
    # 14. Work Efficiency
    WORK_EFFICIENCY = AttributeInfo(
        'work_efficiency', 'WE', 'Work Efficiency', True,
        'Changes the value of work that your steps produce. Positive work efficiency decreases the amount of steps required to complete an action, while negative work efficiency increases the amount of steps required to complete an action.'
    )
    
    @property
    def internal_name(self) -> str:
        """Get the internal name used in attribute dictionaries."""
        return self.value.internal_name
    
    @property
    def abbr(self) -> str:
        """Get the abbreviation (e.g., 'WE', 'DA')."""
        return self.value.abbreviation
    
    @property
    def display_name(self) -> str:
        """Get the human-readable display name."""
        return self.value.display_name
    
    @property
    def is_percentage(self) -> bool:
        """Check if this attribute is a percentage value."""
        return self.value.is_percentage
    
    @property
    def description(self) -> str:
        """Get the attribute description."""
        return self.value.description
    
    @classmethod
    def by_internal_name(cls, name: str) -> 'Attribute | None':
        """Look up a attribute by its internal name."""
        for attr in cls:
            if attr.internal_name == name:
                return attr
        return None
    
    @classmethod
    def by_abbreviation(cls, abbr: str) -> 'Attribute | None':
        """Look up a attribute by its abbreviation."""
        for attr in cls:
            if attr.abbr == abbr:
                return attr
        return None


# Convenience mappings for backward compatibility
ATTRIBUTE_BY_INTERNAL_NAME = {attr.internal_name: attr for attr in Attribute}
ATTRIBUTE_BY_ABBREVIATION = {attr.abbr: attr for attr in Attribute}

# All attr internal names (for validation)
ALL_ATTRIBUTE_NAMES = {attr.internal_name for attr in Attribute}
