#!/usr/bin/env python3
"""
Scrape pets from Walkscape wiki and generate pets.py

Pets are companions that provide bonuses. They hatch from eggs and grow with experience.
Each pet has requirements for gaining XP, abilities, and attributes.
"""

from bs4 import BeautifulSoup
import re
import sys
import os
from pathlib import Path
from scraper_utils import *

# Add parent directory to path for util imports
script_dir = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
parent_dir = os.path.dirname(os.path.dirname(script_dir))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
SCAN_FOLDER_FOR_NEW_ITEMS = True  # Scan cache folder for additional items
PETS_URL = 'https://wiki.walkscape.app/wiki/Pets'
CACHE_DIR = get_cache_dir('pets')
CACHE_FILE = get_cache_file('pets_cache.html')

# Create validator instance
validator = ScraperValidator()

# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def parse_pets_list():
    """Parse the main pets page to get list of pets."""
    html = download_page(PETS_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    pets = []
    
    # The pets page doesn't have a table - pets are linked in the content
    # Look for links in the main content area
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        print("⚠ Warning: Could not find content area")
        return []
    
    # Find all links that might be pets
    # Pets typically have their own pages
    print("\nSearching for pet links...")
    for link in content.find_all('a'):
        href = link.get('href', '')
        if not href.startswith('/wiki/'):
            continue
        
        # Skip common pages
        if any(skip in href for skip in ['/wiki/File:', '/wiki/Special:', '/wiki/Category:', 
                                          '/wiki/Pets', '/wiki/Activities', '/wiki/Egg']):
            continue
        
        name = clean_text(link.get_text())
        
        # Skip empty or very short names
        if not name or len(name) < 3:
            continue
        
        # Skip common words that aren't pets
        if name.lower() in ['pets', 'egg', 'eggs', 'activities', 'shops', 'arenum']:
            continue
        
        url = 'https://wiki.walkscape.app' + href
        
        # Check if this page has a pet infobox by looking for "Experience To Hatch"
        # We'll validate this when parsing the individual page
        pets.append({
            'name': name,
            'url': url,
        })
    
    # Remove duplicates
    seen = set()
    unique_pets = []
    for pet in pets:
        if pet['name'] not in seen:
            seen.add(pet['name'])
            unique_pets.append(pet)
            print(f"  Found potential pet: {pet['name']}")
    
    return unique_pets


def parse_pet_page(pet_info):
    """Parse individual pet page for details."""
    name = pet_info['name']
    
    # Check if folder-scanned
    if pet_info.get('from_folder'):
        cache_path = pet_info['cache_file']
        html = read_cached_html(cache_path)
        if not html:
            print(f"  ⚠ Failed to read {name}")
            return None
    else:
        url = pet_info['url']
        # Create cache filename
        cache_filename = sanitize_filename(name) + '.html'
        cache_path = Path(CACHE_DIR) / cache_filename
        
        # Download page
        html = download_page(url, cache_path, rescrape=RESCRAPE)
        if not html:
            print(f"  ⚠ Failed to download {name}")
            return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Pet pages have tabbed content - verify this is a pet page
    first_panel = soup.find('article', class_='tabber__panel')
    if not first_panel:
        print(f"  ⚠ No tabber panel found for {name} - not a pet page")
        return None
    
    # Extract data
    pet_data = {
        'name': name,
        'egg_name': None,
        'xp_to_hatch': None,
        'xp_by_level': {},
        'requirement_to_gain_xp': None,
        'abilities_by_level': {},
        'attributes_by_level': {},
    }
    
    # Find egg link in intro paragraphs
    intro = soup.find('div', class_='mw-parser-output')
    if intro:
        for p in intro.find_all('p'):
            text = p.get_text()
            if 'hatches from' in text.lower() or 'egg' in text.lower():
                # Look for any link with "egg" in the href
                egg_link = p.find('a', href=re.compile(r'egg', re.I))
                if egg_link:
                    pet_data['egg_name'] = clean_text(egg_link.get_text())
                    # Store egg URL temporarily for downloading
                    pet_data['_egg_url'] = 'https://wiki.walkscape.app' + egg_link.get('href')
                    break
    
    # Find "Experience To Hatch" section (level 0 -> 1)
    for h2 in soup.find_all('h2'):
        h2_text = clean_text(h2.get_text())
        
        if 'Experience To Hatch' in h2_text:
            # Content is in ul after the parent div
            parent = h2.find_parent()
            next_elem = parent.find_next_sibling() if parent else None
            if next_elem and next_elem.name == 'ul':
                for li in next_elem.find_all('li'):
                    text = clean_text(li.get_text())
                    # Extract level and XP (e.g., "Requires an additional 50,000 experience to advance to level 1")
                    level_match = re.search(r'level\s+(\d+)', text, re.I)
                    xp_match = re.search(r'([\d,]+)\s+experience', text)
                    
                    if level_match and xp_match:
                        level = int(level_match.group(1))
                        xp = int(xp_match.group(1).replace(',', ''))
                        
                        # Extract total XP if mentioned
                        total_match = re.search(r'\(([\d,]+)\s+total', text)
                        if total_match:
                            total_xp = int(total_match.group(1).replace(',', ''))
                            pet_data['xp_by_level'][level] = total_xp
                            
                            # Level 1 is hatch
                            if level == 1:
                                pet_data['xp_to_hatch'] = total_xp
        
        elif 'Experience To Grow' in h2_text:
            # Content is in ul after the parent div
            parent = h2.find_parent()
            next_elem = parent.find_next_sibling() if parent else None
            if next_elem and next_elem.name == 'ul':
                for li in next_elem.find_all('li'):
                    text = clean_text(li.get_text())
                    # Extract level and XP
                    level_match = re.search(r'level\s+(\d+)', text, re.I)
                    xp_match = re.search(r'([\d,]+)\s+experience', text)
                    
                    if level_match and xp_match:
                        level = int(level_match.group(1))
                        
                        # Extract total XP if mentioned
                        total_match = re.search(r'\(([\d,]+)\s+total', text)
                        if total_match:
                            total_xp = int(total_match.group(1).replace(',', ''))
                            pet_data['xp_by_level'][level] = total_xp
        
        elif h2_text == 'Ability':
            # Find content after parent div
            parent = h2.find_parent()
            current = parent.find_next_sibling() if parent else None
            
            while current:
                if current.name in ['h1', 'h2'] or (current.name == 'div' and 'mw-heading' in current.get('class', [])):
                    break
                
                # Look for "unlocked at level X" text
                if current.name == 'p':
                    text = clean_text(current.get_text())
                    level_match = re.search(r'level\s+(\d+)', text, re.I)
                    if level_match:
                        level = int(level_match.group(1))
                        
                        # Find the ability table after this paragraph
                        ability_table = current.find_next_sibling('table')
                        if ability_table:
                            # Get ability name from table caption
                            ability_name = None
                            caption = ability_table.find('caption')
                            if caption:
                                # Remove icon elements
                                for elem in caption.find_all(['span', 'img', 'a']):
                                    if 'File:' in str(elem):
                                        elem.decompose()
                                ability_name = clean_text(caption.get_text())
                            
                            # Parse ability table - columns are: Effect, Requirements, Cooldown, Charges
                            rows = ability_table.find_all('tr')
                            if len(rows) >= 2:
                                data_cells = rows[1].find_all(['th', 'td'])
                                
                                ability_data = {
                                    'name': ability_name,
                                    'effect': clean_text(data_cells[1].get_text()) if len(data_cells) > 1 else None,
                                    'requirements': clean_text(data_cells[2].get_text()) if len(data_cells) > 2 else None,
                                    'cooldown': clean_text(data_cells[3].get_text()) if len(data_cells) > 3 else None,
                                    'charges': clean_text(data_cells[4].get_text()) if len(data_cells) > 4 else None,
                                }
                                
                                # Clean up cooldown
                                if ability_data['cooldown']:
                                    if 'no cooldown' in ability_data['cooldown'].lower():
                                        ability_data['cooldown'] = None
                                    else:
                                        # Extract cooldown value (e.g., "12h")
                                        cooldown_match = re.search(r'(\d+h|\d+m|\d+s)', ability_data['cooldown'])
                                        if cooldown_match:
                                            ability_data['cooldown'] = cooldown_match.group(1)
                                
                                # Clean up charges
                                if ability_data['charges']:
                                    charge_match = re.search(r'(\d+)', ability_data['charges'])
                                    if charge_match:
                                        ability_data['charges'] = int(charge_match.group(1))
                                    else:
                                        ability_data['charges'] = None
                                
                                # Clean up requirements
                                if ability_data['requirements'] and 'no requirement' in ability_data['requirements'].lower():
                                    ability_data['requirements'] = None
                                
                                pet_data['abilities_by_level'][level] = ability_data
                
                current = current.find_next_sibling()
        
        elif h2_text == 'Attributes':
            # Find content after parent div - attributes are stats in a table
            parent = h2.find_parent()
            current = parent.find_next_sibling() if parent else None
            
            while current:
                if current.name in ['h1', 'h2'] or (current.name == 'div' and 'mw-heading' in current.get('class', [])):
                    break
                
                # Look for attribute table (Level | Attributes columns)
                if current.name == 'table':
                    for row in current.find_all('tr')[1:]:  # Skip header
                        cells = row.find_all('td')
                        if len(cells) < 2:
                            continue
                        
                        # Column 0: Level
                        # Column 1: Attributes (stat text)
                        level_text = clean_text(cells[0].get_text())
                        attr_cell = cells[1]
                        
                        try:
                            level = int(level_text)
                        except ValueError:
                            continue
                        
                        # Parse attributes using same approach as equipment
                        level_stats = {'skill_stats': {}}
                        
                        # Split by <br> tags to get individual stat lines
                        for br in attr_cell.find_all('br'):
                            br.replace_with('\n')
                        text = attr_cell.get_text()
                        lines = [l.strip() for l in text.split('\n') if l.strip()]
                        
                        # Debug output
                        print(f"    Level {level}: Found {len(lines)} stat lines")
                        for line in lines[:3]:
                            print(f"      - {line[:80]}")
                        
                        # Parse each stat line
                        i = 0
                        while i < len(lines):
                            line = lines[i]
                            line_lower = line.lower()
                            
                            # Skip lines that are just skill/location requirements
                            if 'while doing' in line_lower and not any(c in line for c in ['%', '+', '-']):
                                i += 1
                                continue
                            if 'while in' in line_lower and not any(c in line for c in ['%', '+', '-']):
                                i += 1
                                continue
                            
                            # Determine skill - check current line first, then next line
                            skill = 'global'
                            
                            # Check if skill is on the SAME line as the stat
                            if 'gathering skills' in line_lower:
                                skill = 'gathering'
                            elif 'artisan skills' in line_lower:
                                skill = 'artisan'
                            elif 'utility' in line_lower and 'while doing' in line_lower:
                                skill = 'utility'
                            elif 'while doing' in line_lower:
                                # Extract individual skill from current line (keep as-is)
                                skill_text = extract_skill_from_text(line)
                                if skill_text:
                                    skill = skill_text.lower()
                            # Check if skill is on the NEXT line
                            elif i + 1 < len(lines):
                                next_line = lines[i + 1].lower()
                                if 'gathering skills' in next_line:
                                    skill = 'gathering'
                                    i += 1  # Skip the skill line
                                elif 'artisan skills' in next_line:
                                    skill = 'artisan'
                                    i += 1  # Skip the skill line
                                elif 'utility' in next_line and 'while doing' in next_line:
                                    skill = 'utility'
                                    i += 1  # Skip the skill line
                                elif 'while doing' in next_line:
                                    # Extract individual skill from next line (keep as-is)
                                    skill_text = extract_skill_from_text(lines[i + 1])
                                    if skill_text:
                                        skill = skill_text.lower()
                                        i += 1  # Skip the skill line
                                    i += 1  # Skip the skill line
                                elif 'while doing' in next_line:
                                    # Extract individual skill from next line
                                    skill_text = extract_skill_from_text(lines[i + 1])
                                    if skill_text:
                                        skill_lower = skill_text.lower()
                                        if skill_lower in ['fishing', 'foraging', 'mining', 'woodcutting']:
                                            skill = 'gathering'
                                        elif skill_lower in ['carpentry', 'cooking', 'crafting', 'smithing', 'trinketry']:
                                            skill = 'artisan'
                                        elif skill_lower == 'agility':
                                            skill = 'utility'
                                        else:
                                            skill = skill_lower
                                        i += 1  # Skip the skill line
                            
                            # Check if next line (after skill) is a location requirement
                            location_req = None
                            if i + 1 < len(lines):
                                next_line = lines[i + 1].lower()
                                if 'while in' in next_line:
                                    # Extract location from next line
                                    loc_match = re.search(r'while in (?:the )?([^.]+?)(?:\s+(?:location|area))?\.?$', next_line)
                                    if loc_match:
                                        location_req = loc_match.group(1).strip()
                                        location_req = normalize_location_name(location_req)
                                        i += 1  # Skip the location line
                            
                            # Extract value
                            value_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*(%?)', line)
                            if value_match:
                                value_str = value_match.group(1)
                                has_percent = value_match.group(2) == '%'
                                value_with_percent = value_str + ('%' if has_percent else '')
                                
                                # Normalize stat name
                                stat_name = normalize_stat_name(line_lower)
                                if stat_name:
                                    # Parse stat value
                                    final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
                                    
                                    # Initialize structures
                                    if skill not in level_stats['skill_stats']:
                                        level_stats['skill_stats'][skill] = {}
                                    
                                    location_key = location_req if location_req else 'global'
                                    if location_key not in level_stats['skill_stats'][skill]:
                                        level_stats['skill_stats'][skill][location_key] = {}
                                    
                                    # Store stat
                                    level_stats['skill_stats'][skill][location_key][final_stat_name] = final_value
                            
                            i += 1
                        
                        # Store parsed stats for this level
                        if level_stats['skill_stats']:
                            pet_data['attributes_by_level'][level] = level_stats['skill_stats']
                    
                    break  # Only parse first table
                
                current = current.find_next_sibling()
    
    # Find "Requirement To Gain Experience" section (h1 header)
    for h1 in soup.find_all('h1'):
        h1_text = clean_text(h1.get_text())
        
        if 'Requirement To Gain Experience' in h1_text:
            # Find content after parent div
            parent = h1.find_parent()
            next_elem = parent.find_next_sibling() if parent else None
            if next_elem and next_elem.name == 'p':
                pet_data['requirement_to_gain_xp'] = clean_text(next_elem.get_text())
    
    return pet_data


def parse_egg_page(egg_name, egg_url):
    """Parse egg page for additional details."""
    # Create cache filename
    cache_filename = sanitize_filename(egg_name) + '.html'
    cache_path = Path(CACHE_DIR) / cache_filename
    
    # Download page
    html = download_page(egg_url, cache_path, rescrape=RESCRAPE)
    if not html:
        print(f"  ⚠ Failed to download egg: {egg_name}")
        return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Extract egg data (for now, just verify it exists)
    egg_data = {
        'name': egg_name,
        'url': egg_url,
    }
    
    return egg_data


# ============================================================================
# MODULE GENERATION
# ============================================================================

def generate_module(pets, eggs):
    """Generate the pets.py module."""
    output_file = get_output_file('pets.py')
    
    # Helper function to escape strings
    def escape_str(s):
        if s is None:
            return "None"
        return f"'{s.replace(chr(92), chr(92)*2).replace(chr(39), chr(92)+chr(39))}'"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Pets data from Walkscape wiki', 'scrape_pets.py')
        
        imports = [
            'from typing import List, Optional, Dict',
            'from dataclasses import dataclass',
            'from util.stats_mixin import StatsMixin',
        ]
        write_imports(f, imports)
        
        lines = []
        
        # EggInfo class
        lines.extend([
            '@dataclass',
            'class EggInfo:',
            '    """Information about a pet egg."""',
            '    name: str',
            '    pet_name: str  # Name of the pet that hatches from this egg',
            '    xp_to_hatch: Optional[int] = None  # XP required to hatch',
            '',
            '',
        ])
        
        # PetInfo class
        lines.extend([
            '@dataclass',
            'class PetInfo(StatsMixin):',
            '    """Detailed information about a pet at a specific level."""',
            '    name: str',
            '    level: int',
            '    egg_name: Optional[str] = None',
            '    xp_required: Optional[int] = None  # Cumulative XP to reach this level',
            '    requirement_to_gain_xp: Optional[str] = None',
            '    abilities: Optional[List[Dict[str, any]]] = None  # [{name, effect, requirements, cooldown, charges}, ...]',
            '    ',
            '    def __post_init__(self):',
            '        """Initialize StatsMixin."""',
            '        # _stats is set from attributes_by_level[self.level] during generation',
            '        # It will already be in the correct nested format',
            '        if not hasattr(self, "_stats"):',
            '            self._stats = {}',
            '        self.gated_stats = {}',
            '        self.requirements = []',
            '',
            '',
        ])
        
        # PetLevels class (like CraftedItem)
        lines.extend([
            'class PetLevels:',
            '    """Container for all levels of a pet (like CraftedItem for qualities)."""',
            '    def __init__(self, name: str, egg_name: str, levels: Dict[int, PetInfo]):',
            '        self.name = name',
            '        self.egg_name = egg_name',
            '        self._levels = levels',
            '        ',
            '        # Create LEVEL_X attributes for easy access',
            '        for level, pet_info in levels.items():',
            '            setattr(self, f"LEVEL_{level}", pet_info)',
            '    ',
            '    def get_level(self, level: int) -> Optional[PetInfo]:',
            '        """Get pet info for a specific level."""',
            '        return self._levels.get(level)',
            '    ',
            '    def get_all_levels(self) -> Dict[int, PetInfo]:',
            '        """Get all levels."""',
            '        return self._levels.copy()',
            '',
            '',
        ])
        
        # Pet class (enum-like, but with PetLevels instances)
        lines.extend([
            'class Pet:',
            '    """Enum-like class for all pets."""',
            '',
        ])
        
        # Generate pet instances (PetLevels with all levels)
        for pet in pets:
            enum_name = name_to_enum(pet['name'])
            
            # Create PetInfo instances for each level
            lines.append(f"    {enum_name} = PetLevels(")
            lines.append(f"        name={escape_str(pet['name'])},")
            lines.append(f"        egg_name={escape_str(pet.get('egg_name'))},")
            lines.append(f"        levels={{")
            
            # Generate a PetInfo for each level
            for level in sorted(pet.get('xp_by_level', {}).keys()):
                xp_required = pet['xp_by_level'][level]
                attributes = pet.get('attributes_by_level', {}).get(level, {})
                
                # Collect all abilities unlocked at or before this level
                cumulative_abilities = []
                for ability_level in sorted(pet.get('abilities_by_level', {}).keys()):
                    if ability_level <= level:
                        cumulative_abilities.append(pet['abilities_by_level'][ability_level])
                
                lines.append(f"            {level}: PetInfo(")
                lines.append(f"                name={escape_str(pet['name'])},")
                lines.append(f"                level={level},")
                lines.append(f"                egg_name={escape_str(pet.get('egg_name'))},")
                lines.append(f"                xp_required={xp_required},")
                
                if pet.get('requirement_to_gain_xp'):
                    lines.append(f"                requirement_to_gain_xp={escape_str(pet['requirement_to_gain_xp'])},")
                
                # Abilities (cumulative list)
                if cumulative_abilities:
                    lines.append(f"                abilities=[")
                    for ability in cumulative_abilities:
                        lines.append(f"                    {{")
                        if ability.get('name'):
                            lines.append(f"                        'name': {escape_str(ability['name'])},")
                        if ability.get('effect'):
                            lines.append(f"                        'effect': {escape_str(ability['effect'])},")
                        if ability.get('requirements'):
                            lines.append(f"                        'requirements': {escape_str(ability['requirements'])},")
                        if ability.get('cooldown'):
                            lines.append(f"                        'cooldown': {escape_str(ability['cooldown'])},")
                        if ability.get('charges') is not None:
                            lines.append(f"                        'charges': {ability['charges']},")
                        lines.append(f"                    }},")
                    lines.append(f"                ],")
                
                lines.append(f"            ),")
            
            lines.append(f"        }}")
            lines.append(f"    )")
            lines.append('')
            
            # Set _stats for each level's PetInfo
            for level in sorted(pet.get('xp_by_level', {}).keys()):
                attributes = pet.get('attributes_by_level', {}).get(level, {})
                if attributes:
                    lines.append(f"    {enum_name}._levels[{level}]._stats = {{")
                    for skill, locations in attributes.items():
                        lines.append(f"        '{skill}': {{")
                        for location, stat_values in locations.items():
                            lines.append(f"            '{location}': {{")
                            for stat_name, stat_value in stat_values.items():
                                lines.append(f"                '{stat_name}': {stat_value},")
                            lines.append(f"            }},")
                        lines.append(f"        }},")
                    lines.append(f"    }}")
            lines.append('')
        
        # Egg class (enum-like)
        lines.extend([
            '',
            'class Egg:',
            '    """Enum-like class for all eggs."""',
            '',
        ])
        
        # Generate egg instances
        for egg_name, egg_data in eggs.items():
            enum_name = name_to_enum(egg_name)
            
            # Find which pet this egg belongs to and get xp_to_hatch
            pet_name = None
            xp_to_hatch = None
            for pet in pets:
                if pet.get('egg_name') == egg_name:
                    pet_name = pet['name']
                    xp_to_hatch = pet.get('xp_to_hatch')
                    break
            
            if pet_name:
                lines.append(f"    {enum_name} = EggInfo(")
                lines.append(f"        name={escape_str(egg_name)},")
                lines.append(f"        pet_name={escape_str(pet_name)},")
                if xp_to_hatch is not None:
                    lines.append(f"        xp_to_hatch={xp_to_hatch},")
                lines.append(f"    )")
                lines.append('')
        
        # Add lookup dicts
        lines.extend([
            '',
            '# Lookup dictionaries',
            'PETS_BY_NAME = {',
        ])
        
        for pet in pets:
            enum_name = name_to_enum(pet['name'])
            name_str = escape_str(pet['name'])
            lines.append(f"    {name_str}: Pet.{enum_name},")
        
        lines.extend([
            '}',
            '',
            '# Convenience: Get all pet levels as flat list',
            'ALL_PET_LEVELS = []',
            'for pet_levels in PETS_BY_NAME.values():',
            '    ALL_PET_LEVELS.extend(pet_levels.get_all_levels().values())',
            '',
            'EGGS_BY_NAME = {',
        ])
        
        for pet in pets:
            if pet.get('egg_name'):
                egg_enum = name_to_enum(pet['egg_name'])
                egg_name_str = escape_str(pet['egg_name'])
                lines.append(f"    {egg_name_str}: Egg.{egg_enum},")
        
        lines.extend([
            '}',
        ])
        
        f.write('\n'.join(lines))
    
    print(f"\n✓ Generated {output_file} with {len(pets)} pets and {len(eggs)} eggs")


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("Scraping pets from Walkscape wiki...")
    
    # Parse main page
    pets_list = parse_pets_list()
    print(f"\nFound {len(pets_list)} pets from main page")
    
    # Scan folder for additional pets
    if SCAN_FOLDER_FOR_NEW_ITEMS:
        print("\nScanning cache folder for additional pets...")
        folder_pets = scan_cache_folder_for_items(CACHE_DIR, CACHE_FILE)
        if folder_pets:
            pets_list = merge_folder_items_with_main_list(pets_list, folder_pets)
    
    # Parse each pet page
    pets = []
    eggs_to_download = {}  # {egg_name: egg_url}
    
    for i, pet_info in enumerate(pets_list, 1):
        source = "folder" if pet_info.get('from_folder') else "wiki"
        print(f"\n[{i}/{len(pets_list)}] Parsing {pet_info['name']} (from {source})...")
        pet_data = parse_pet_page(pet_info)
        if pet_data:
            pets.append(pet_data)
            print(f"  ✓ Egg: {pet_data.get('egg_name', 'Unknown')}")
            print(f"  ✓ XP to hatch: {pet_data.get('xp_to_hatch', 'Unknown')}")
            print(f"  ✓ XP levels: {len(pet_data.get('xp_by_level', {}))}")
            print(f"  ✓ Requirement: {pet_data.get('requirement_to_gain_xp', 'None')}")
            print(f"  ✓ Abilities: {len(pet_data.get('abilities_by_level', {}))} levels")
            print(f"  ✓ Attributes: {len(pet_data.get('attributes_by_level', {}))} levels")
            
            # Track eggs to download
            if pet_data.get('egg_name') and pet_data.get('_egg_url'):
                eggs_to_download[pet_data['egg_name']] = pet_data['_egg_url']
    
    # Download and parse egg pages
    eggs = {}
    if eggs_to_download:
        print(f"\nDownloading {len(eggs_to_download)} egg pages...")
        for egg_name, egg_url in eggs_to_download.items():
            print(f"  Downloading {egg_name}...")
            egg_data = parse_egg_page(egg_name, egg_url)
            if egg_data:
                eggs[egg_name] = egg_data
    
    # Generate module
    print("\nGenerating module...")
    try:
        generate_module(pets, eggs)
        print("✓ Module generation complete")
    except Exception as e:
        print(f"✗ Error generating module: {e}")
        import traceback
        traceback.print_exc()
    
    # Report validation issues
    print("\nValidation report:")
    validator.report()
