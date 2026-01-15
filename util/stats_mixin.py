#!/usr/bin/env python3
"""
StatsMixin - Shared functionality for items with skill-based, location-aware stats.

This mixin provides:
- get_stats_for_skill(): Get stats filtered by skill and location
- attr(): Get stats in a standard format
- _location_matches(): Check if location matches
- _add_location_stats(): Add stats filtered by location

Used by: Equipment, Collectibles, Consumables, and future stat-bearing items.
"""

from __future__ import annotations
from typing import Dict, Optional, Union, TYPE_CHECKING

if TYPE_CHECKING:
    from util.walkscape_constants import SkillInstance, LocationInfo

# Global cache for get_stats_for_skill results
_STATS_CACHE = {}


class StatsMixin: 
    """
    Mixin class providing skill-based, location-aware stat functionality.
    
    Classes using this mixin must have:
    - self._stats: Dict with nested structure {skill: {location: {stat: value}}}
    - self.name: str (for error messages)
    - self.gated_stats: Dict (optional) with supported gates:
        - 'skill_level': {skill: {threshold: {skill: {location: {stat: value}}}}}
        - 'activity_completion': {activity: {threshold: {skill: {location: {stat: value}}}}}
        - 'activity': {activity_name: {skill: {location: {stat: value}}}} - stats only while doing activity
        - 'reputation': {faction: {threshold: {skill: {location: {stat: value}}}}}
        - 'set_pieces': {set_name: {threshold: {skill: {location: {stat: value}}}}}
        - 'item_ownership': {item_name: {skill: {location: {stat: value}}}} - stats when owning another item
    - self.requirements: List (optional, for unlock requirements like reputation, skill level)
    
    Note: 'activity' gates are NOT included in normal stat calculations - they're for
    activity-specific bonuses that only apply when doing that specific activity.
    """
    
    def is_unlocked(self, character=None, ignore_gear_requirements=False) -> bool:
        """
        Check if this item/service is unlocked for the character.
        
        Args:
            character: Character object (optional, will auto-load from my_config if not provided)
            ignore_gear_requirements: If True, skip diving_gear checks (useful for optimization)
        
        Returns:
            True if unlocked, False otherwise
        """
        if hasattr(self, 'has_instance'):
            self = self.get_instance(
                character=character, 
                ignore_gear_requirements=ignore_gear_requirements
            )

        if not hasattr(self, 'requirements') or not self.requirements:
            return True  # No requirements means always unlocked
        
        # Auto-load character if not provided
        if character is None:
            try:
                from my_config import get_character
                character = get_character()
            except Exception:
                return True  # If can't load character, assume unlocked
        
        for req in self.requirements:
            req_type = req.get('type')
            
            if req_type == 'reputation':
                # Check faction reputation
                faction = req.get('faction')
                required_amount = req.get('amount', 0)
                if character.reputation.get(faction, 0) < required_amount:
                    return False
            
            elif req_type == 'skill':
                # Check skill level
                skill = req.get('skill')
                required_level = req.get('level', 0)
                if character.get_skill_level(skill) < required_level:
                    return False
            
            elif req_type == 'character_level':
                # Check character level
                required_level = req.get('level', 0)
                try:
                    from util.walkscape_constants import character_level_from_steps
                    char_level = character_level_from_steps(character.total_steps)
                    if char_level < required_level:
                        return False
                except Exception:
                    # If can't determine character level, assume requirement is met
                    pass
            
            elif req_type == 'diving_gear':
                # Skip if ignoring gear requirements
                if ignore_gear_requirements:
                    continue
                
                # Check diving gear count
                required_count = req.get('count', 3)
                diving_count = sum(
                    1 for item in character.gear.values() 
                    if item and hasattr(item, 'keywords') and 
                    any('diving gear' in kw.lower() for kw in item.keywords)
                )
                if diving_count < required_count:
                    return False
            
            elif req_type == 'access':
                # Check region access using my_config variables
                region = req.get('region', '').lower()
                try:
                    import my_config
                    # Check for ACCESS_REGIONNAME variable (e.g., ACCESS_SYRENTHIA)
                    access_var = f'ACCESS_{region.upper()}'
                    has_access = getattr(my_config, access_var, True)  # Default to True if not specified
                    if not has_access:
                        return False
                except (ImportError, AttributeError):
                    # If can't check, assume accessible
                    pass
        
        return True

    
    def _location_matches(self, location_key: str, current_location) -> bool:
        """
        Check if a location key matches the current location.
        
        Args:
            location_key: Location key from stats dict (e.g., 'global', 'underwater', '!jarvonia')
            current_location: LocationInfo object or None
        
        Returns:
            True if stats should be included for this location
        """
        # Always include global stats
        if location_key == "global":
            return True
        
        # If no location specified, only include global stats
        if current_location is None:
            return False
        
        # Check for negation (! prefix means "NOT this location")
        is_negated = location_key.startswith("!")
        location_name = location_key[1:] if is_negated else location_key
        
        matches = current_location.is_in_region(location_name.lower())
        
        # Apply negation if needed
        return not matches if is_negated else matches
    
    def _add_location_stats(self, skill_data: dict, location, combined: dict) -> dict:
        """
        Add stats from skill_data to combined dict, filtering by location.
        
        Args:
            skill_data: Dict with location keys mapping to stat dicts
            location: LocationInfo object or None
            combined: Dict to accumulate stats into
        
        Returns:
            Updated combined dict
        """
        for location_key, stats in skill_data.items():
            if isinstance(stats, dict) and self._location_matches(location_key, location):
                for stat_name, stat_value in stats.items():
                    combined[stat_name] = combined.get(stat_name, 0.0) + stat_value
        
        return combined
    
    def get_stats_for_skill(
        self, 
        skill: Union[SkillInstance, str, None] = None, 
        location: Union[LocationInfo, str, None] = None,
        activity: Union[Activity, str, None] = None,
        set_piece_counts: dict = None,
        character=None,
        achievement_points=None,
    ) -> Dict[str, float]:
        """
        Get stats for a specific skill and location.
        
        Args:
            skill: Skill object, skill string, or None for all skills
            location: LocationInfo object, location string, or None
            activity: Activity name string or None
            set_piece_counts: Dict mapping set names to piece counts (for set bonuses)
            character: Character object (optional)
        
        Returns:
            Dict of stat names to values (percentages already converted to decimals)
        """
        if hasattr(self, 'has_instance'):
            self = self.get_instance(
                skill=skill,
                location=location,
                activity=activity,
                set_piece_counts=set_piece_counts,
                character=character,
                achievement_points=achievement_points
            )
        
        # Create cache key (exclude character to keep key simple)
        skill_key = skill.value if hasattr(skill, 'value') else (skill if skill else None)
        location_key = location.name if hasattr(location, 'name') else (location if location else None)
        activity_key = activity.name if hasattr(activity, 'name') else (activity if activity else None)
        set_key = frozenset(set_piece_counts.items()) if set_piece_counts else None
        
        cache_key = (id(self), skill_key, location_key, activity_key, set_key)
        
        # Check cache
        if cache_key in _STATS_CACHE:
            return _STATS_CACHE[cache_key]
        
        # Calculate stats (original logic)
        result = self._calculate_stats_uncached(skill, location, activity, set_piece_counts, character)
        
        # Store in cache
        _STATS_CACHE[cache_key] = result
        
        return result
    
    def _calculate_stats_uncached(
        self, 
        skill: Union[SkillInstance, str, None] = None, 
        location: Union[LocationInfo, str, None] = None,
        activity: Union[Activity, str, None] = None,
        set_piece_counts: dict = None,
        character=None,
    ) -> Dict[str, float]:
        """Internal method that does the actual stat calculation (uncached)."""
        if not skill:
            # Return combined stats from all skills and locations
            combined = {}
            if isinstance(self._stats, dict):
                for skill_name, skill_data in self._stats.items():
                    if isinstance(skill_data, dict):
                        for loc_or_stat, value in skill_data.items():
                            if isinstance(value, dict):
                                # Location-nested format
                                for stat, stat_val in value.items():
                                    combined[stat] = combined.get(stat, 0.0) + stat_val
                            else:
                                # Direct stat
                                combined[loc_or_stat] = combined.get(loc_or_stat, 0.0) + value
            return self._convert_percentages(combined)
        
        # Import Skill here to avoid circular dependency at module load time
        from util.walkscape_constants import Skill
        
        # Convert skill to SkillInstance object if it's a string
        if isinstance(skill, str):
            skill_upper = skill.upper()
            if hasattr(Skill, skill_upper):
                skill = getattr(Skill, skill_upper)
            else:
                # Unknown skill - this is a bug that should be fixed
                raise ValueError(
                    f"Unknown skill '{skill}'. Valid skills are: "
                    f"{', '.join([s for s in dir(Skill) if not s.startswith('_')])}"
                )
        
        combined = {}
        
        # Iterate through all stats and check if skill matches
        for stats_skill, skill_data in self._stats.items():
            if not isinstance(skill_data, dict):
                continue
            
            # Check if this skill should be included
            if skill.matches_skill(stats_skill):
                # Add location-filtered stats
                combined = self._add_location_stats(skill_data, location, combined)
        
        # Add gated stats if requirements are met (only for items that have them)
        if hasattr(self, 'gated_stats') and self.gated_stats:
            combined = self._add_gated_stats(skill, location, combined, activity, set_piece_counts, character)
        
        # Convert percentages to decimals
        return self._convert_percentages(combined)
    
    def _add_gated_stats(self, skill, location, combined: dict, activity=None, set_piece_counts: dict = None, character=None) -> dict:
        """
        Add gated stats (skill_level, activity_completion, reputation, activity, set_pieces) if requirements are met.
        
        Args:
            skill: SkillInstance object
            location: LocationInfo object or None
            combined: Dict to accumulate stats into
            activity: Activity name string or None
            set_piece_counts: Dict mapping set names to piece counts (for set bonuses)
            character: Character object (if not provided, will load from config)
        
        Returns:
            Updated combined dict
        """
        # Import character to check gates
        if character is None:
            try:
                from my_config import get_character
                character = get_character()
            except ImportError:
                return combined  # Character not available, skip all gated stats
        
        # Check skill_level gates
        if "skill_level" in self.gated_stats:
            for gate_skill, thresholds in self.gated_stats["skill_level"].items():
                char_level = character.get_skill_level(gate_skill)
                for threshold, threshold_stats in thresholds.items():
                    if char_level >= threshold:
                        # Add stats from this threshold
                        for stat_skill, locations in threshold_stats.items():
                            if skill.matches_skill(stat_skill):
                                combined = self._add_location_stats(locations, location, combined)
        
        # Check activity_completion gates
        if "activity_completion" in self.gated_stats:
            try:
                import my_config
                
                for activity_name, thresholds in self.gated_stats["activity_completion"].items():
                    # Build config variable name: SCREWDRIVER_UNDERWATER_BASKET_WEAVING_50_COMPLETIONS
                    item_name_upper = self.name.upper().replace(" ", "_").replace("'", "")
                    activity_upper = activity_name.upper().replace(" ", "_")
                    
                    for threshold, threshold_stats in thresholds.items():
                        var_name = f"{item_name_upper}_{activity_upper}_{threshold}_COMPLETIONS"
                        has_completed = getattr(my_config, var_name, False)
                        
                        if has_completed:
                            # Add stats from this threshold
                            for stat_skill, locations in threshold_stats.items():
                                if skill.matches_skill(stat_skill):
                                    combined = self._add_location_stats(locations, location, combined)
            except (ImportError, AttributeError):
                pass  # Config not available, skip activity_completion gated stats
        
        # Check activity gates (stats that only apply while doing a specific activity)
        # Structure: {'activity': {activity_name: {skill: {location: {stat: value}}}}}
        # Note: No threshold level - activity gates don't have thresholds
        if "activity" in self.gated_stats and activity:
            # Convert activity to lowercase string if it's an object
            activity_name = activity.lower() if isinstance(activity, str) else getattr(activity, 'name', str(activity)).lower()
            
            if activity_name in self.gated_stats["activity"]:
                activity_stats = self.gated_stats["activity"][activity_name]
                # Iterate through skills in activity stats
                for stat_skill, locations in activity_stats.items():
                    if skill.matches_skill(stat_skill):
                        combined = self._add_location_stats(locations, location, combined)
        
        # Check reputation gates
        if "reputation" in self.gated_stats:
            for faction, thresholds in self.gated_stats["reputation"].items():
                faction_rep = character.reputation.get(faction, 0)
                for threshold in sorted(thresholds.keys()):
                    if faction_rep >= threshold:
                        # Add stats from this threshold
                        threshold_stats = thresholds[threshold]
                        for stat_skill, locations in threshold_stats.items():
                            if skill.matches_skill(stat_skill):
                                combined = self._add_location_stats(locations, location, combined)
        
        # Check set_pieces gates (set bonuses based on equipped piece count)
        if "set_pieces" in self.gated_stats and set_piece_counts:
            for set_name, thresholds in self.gated_stats["set_pieces"].items():
                # Get the count of pieces for this set
                equipped_count = set_piece_counts.get(set_name, 0)
                
                # Apply ALL thresholds we qualify for (set bonuses are cumulative per piece)
                # Each threshold adds to the bonus that each equipped piece provides
                # Convert threshold keys to int for proper comparison
                for threshold_str in sorted(thresholds.keys(), key=int):
                    threshold = int(threshold_str)
                    if equipped_count >= threshold:
                        # Add stats from this threshold
                        threshold_stats = thresholds[threshold_str]
                        for stat_skill, locations in threshold_stats.items():
                            if skill.matches_skill(stat_skill):
                                combined = self._add_location_stats(locations, location, combined)
                    # Continue to next threshold (bonuses are cumulative)
        
        # Check item_ownership gates (stats that require owning another item)
        # Structure: {'item_ownership': {item_name: {skill: {location: {stat: value}}}}}
        # Note: No threshold level - item ownership gates don't have thresholds
        if "item_ownership" in self.gated_stats:
            # Check character.items for owned items
            owned_items = set()
            
            if hasattr(character, 'items') and character.items:
                for item in character.items:
                    if hasattr(item, 'name'):
                        owned_items.add(item.name.lower())
            
            # Check each item ownership requirement
            for required_item_name, item_stats in self.gated_stats["item_ownership"].items():
                if required_item_name.lower() in owned_items:
                    # Player owns this item, add its stats
                    for stat_skill, locations in item_stats.items():
                        if skill.matches_skill(stat_skill):
                            combined = self._add_location_stats(locations, location, combined)
        
        return combined
    
    def _convert_percentages(self, stats: dict) -> dict:
        """
        Convert percentage stats to decimal format based on Attribute definitions.
        
        Args:
            stats: Dict of stat names to values
        
        Returns:
            Dict with percentages converted to decimals
        """
        # Import here to avoid circular dependency
        from util.walkscape_constants import Attribute
        
        converted = {}
        for attribute_name, value in stats.items():
            attribute_upper = attribute_name.upper()
            if hasattr(Attribute, attribute_upper):
                attribute_obj = getattr(Attribute, attribute_upper)
                if attribute_obj.is_percentage:
                    converted[attribute_name] = value / 100.0
                else:
                    converted[attribute_name] = value
            else:
                # Unknown attribute, keep as-is
                converted[attribute_name] = value
        
        return converted
    
    def attr(
        self, 
        skill: Union[SkillInstance, str, None] = None, 
        location: Union[LocationInfo, str, None] = None,
        activity: Union[Activity, str, None] = None,
        set_piece_counts: dict = None,
    ) -> Dict[str, float]:
        """
        Get attributes in standard format.
        
        Args:
            skill: Skill object, skill string, or None for all skills
                   - Skill.TRAVEL: combines agility + traveling + global
                   - None: combines all skills
                   - specific skill: gets that skill + global
            location: Location string or LocationInfo object
            activity: Activity name string or Activity object (optional, for activity-specific stats)
            set_piece_counts: Dict mapping set names to piece counts (for set bonuses)
        
        Returns:
            Dict of stat names to values (percentages as decimals, flat stats as numbers)
        """
        return self.get_stats_for_skill(skill, location=location, activity=activity, set_piece_counts=set_piece_counts)
    
    def abbreviate_name(self) -> str:
        """
        Abbreviate item name by taking first 3 chars of each word,
        skipping prepositions/articles, and handling quality tiers.
        
        Examples:
        - "Hydrilium Sickle (Perfect)" -> "Hyd Sic Per"
        - "Iron Sickle (Great)" -> "Iro Sic Gre"
        - "Ring of Homesickness" -> "Rin Hom"
        
        Returns:
            Abbreviated name string
        """
        if not hasattr(self, 'name'):
            return "???"
        
        # Remove parentheses and split
        name = self.name.replace('(', '').replace(')', '')
        words = name.split()
        
        # Words to skip
        skip_words = {'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with'}
        
        # Take first 3 chars of each word (skip articles/prepositions)
        abbreviated = []
        for word in words:
            if word.lower() not in skip_words:
                abbreviated.append(word[:3].capitalize())
        
        return ' '.join(abbreviated)
