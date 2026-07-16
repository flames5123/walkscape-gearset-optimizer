#!/usr/bin/env python3
# ============================================================================
# ⚠️  RETIRED WIKI SCRAPER — NOT part of the normal update flow.
# ----------------------------------------------------------------------------
# Pets are now sourced from the WalkScape tools API, not the wiki.
# The live path (run by scrape_all.py) is:
#     util/scrapers/ingest_pets_from_api.py  -> pets.py
# This wiki scraper is kept for reference / emergency fallback only.
# See ai-specs/features/scrapers.md.
# ============================================================================
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
    """Parse the main pets page to get list of pets from the wiki table."""
    html = download_page(PETS_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    pets = []
    
    # The pets page has a wikitable with columns:
    # Pet Name (icon + link) | Rare Pet Name (icon + link) | Pet Egg Name (icon + link)
    table = soup.find('table', class_='wikitable')
    if not table:
        print("⚠ Warning: Could not find pets wikitable")
        return []
    
    print("\nParsing pets table...")
    for row in table.find_all('tr')[1:]:  # Skip header row
        cells = row.find_all('td')
        if len(cells) < 5:
            continue
        
        # Cell 0: pet icon, Cell 1: pet name link
        # Cell 2: rare pet icon, Cell 3: rare pet name link
        # Cell 4: egg icon + egg name link
        pet_link = cells[1].find('a')
        rare_link = cells[3].find('a')
        egg_link = cells[4].find('a', href=True)
        
        if not pet_link:
            continue
        
        pet_name = clean_text(pet_link.get_text())
        rare_name = clean_text(rare_link.get_text()) if rare_link else None
        egg_name = None
        egg_url = None
        
        # Egg link - find the text link (not the image link)
        for link in cells[4].find_all('a'):
            href = link.get('href', '')
            if '/wiki/File:' in href:
                continue
            text = clean_text(link.get_text())
            if text:
                egg_name = text
                egg_url = 'https://wiki.walkscape.app' + href.replace('/wiki/Special:MyLanguage/', '/wiki/')
                break
        
        # Build pet URL from the link href
        href = pet_link.get('href', '')
        # Handle Special:MyLanguage redirects
        url = 'https://wiki.walkscape.app' + href.replace('/wiki/Special:MyLanguage/', '/wiki/')
        
        pet_info = {
            'name': pet_name,
            'url': url,
            'rare_name': rare_name,
            'egg_name': egg_name,
        }
        if egg_url:
            pet_info['_egg_url'] = egg_url
        
        pets.append(pet_info)
        print(f"  Found pet: {pet_name} (rare: {rare_name}, egg: {egg_name})")
    
    return pets


def _parse_ability_stats(effect_cell):
    """Parse stat buffs from an ability's effect cell HTML.
    
    Some pet abilities give temporary stat buffs (e.g., Tiger's "The Hunt Is On"
    gives +6% WE, +3% DA, -2 Steps while Hunting). This function extracts those
    stats into the standard nested format: {skill: {location: {stat: value}}}.
    
    Args:
        effect_cell: BeautifulSoup element for the effect <td> cell
        
    Returns:
        dict: Nested stats dict, or empty dict if no stats found
    """
    # Replace <br> with newlines to split stat lines
    for br in effect_cell.find_all('br'):
        br.replace_with('\n')
    text = effect_cell.get_text()
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    stats = {}
    
    for line in lines:
        line_lower = line.lower()
        
        # Skip non-stat lines (flavor text, duration info)
        if not any(c in line for c in ['%', '+', '-']):
            continue
        if 'effect lasts for' in line_lower:
            continue
        
        # Extract value (e.g., "+6%", "-2", "+3%")
        value_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*(%?)', line)
        if not value_match:
            continue
        
        value_str = value_match.group(1)
        has_percent = value_match.group(2) == '%'
        value_with_percent = value_str + ('%' if has_percent else '')
        
        # Normalize stat name
        stat_name = normalize_stat_name(line_lower)
        if not stat_name:
            continue
        
        # Parse stat value using shared utility
        final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
        
        # Determine skill context from "While doing X" on the same line
        skill = 'global'
        if 'while doing' in line_lower:
            skill_text = extract_skill_from_text(line)
            if skill_text:
                skill = skill_text.lower()
        
        # Determine location context from "While in X" on the same line
        location = 'global'
        if 'while in' in line_lower:
            loc_text = extract_location_from_text(line)
            if loc_text:
                location = normalize_location_name(loc_text)
        
        # Store in nested format
        if skill not in stats:
            stats[skill] = {}
        if location not in stats[skill]:
            stats[skill][location] = {}
        stats[skill][location][final_stat_name] = final_value
    
    return stats


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
        'species': None,  # NEW: lowercase species string (e.g. "chicken", "tortoise")
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
    
    # Extract species from the pet page — look for "Species" in infobox or intro text.
    # The species is typically the animal type (e.g. "Chicken", "Tortoise").
    # Strategy: check infobox table rows for a "Species" label, then fall back to
    # deriving species from the pet name itself (most pets are named after their species).
    species_found = False
    if intro:
        # Check infobox-style tables for a "Species" row
        for table in intro.find_all('table'):
            for row in table.find_all('tr'):
                cells = row.find_all(['th', 'td'])
                if len(cells) >= 2:
                    label = clean_text(cells[0].get_text()).lower()
                    if 'species' in label:
                        species_text = clean_text(cells[1].get_text()).lower()
                        if species_text:
                            pet_data['species'] = species_text
                            species_found = True
                            print(f"    ✓ Species (infobox): {species_text}")
                            break
            if species_found:
                break
        
        if not species_found:
            # Check intro paragraphs for "species" keyword
            for p in intro.find_all('p'):
                text_lower = p.get_text().lower()
                if 'species' in text_lower:
                    # Try to extract the species value after "species:"
                    species_match = re.search(r'species[:\s]+([a-z]+)', text_lower)
                    if species_match:
                        pet_data['species'] = species_match.group(1).strip()
                        species_found = True
                        print(f"    ✓ Species (paragraph): {pet_data['species']}")
                        break
    
    if not species_found:
        # Fall back: derive species from the pet name (most pets are named after their species)
        # e.g. "Chicken" -> "chicken", "Tortoise" -> "tortoise"
        pet_data['species'] = name.lower()
        print(f"    ✓ Species (fallback from name): {pet_data['species']}")
    
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
                                
                                # Parse ability stats from the effect cell HTML
                                # Some abilities give stat buffs (e.g., Tiger's "The Hunt Is On")
                                if len(data_cells) > 1:
                                    ability_stats = _parse_ability_stats(data_cells[1])
                                    if ability_stats:
                                        ability_data['ability_stats'] = ability_stats
                                        print(f"    ✓ Parsed ability stats: {ability_stats}")
                                    
                                    # Parse duration (actions) from effect cell
                                    effect_text = clean_text(data_cells[1].get_text())
                                    duration_match = re.search(r'Effect lasts for:\s*(\d+)', effect_text)
                                    if duration_match:
                                        ability_data['duration'] = int(duration_match.group(1))
                                        print(f"    ✓ Ability duration: {ability_data['duration']} actions")
                                
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
                                
                                # Tag instant-actions abilities.
                                # Detection: effect text matches "Completes N X actions instantly"
                                if ability_data.get('effect'):
                                    ia_match = re.search(
                                        r'Completes\s+(\d+)\s+(\w+)\s+actions?\s+instantly',
                                        ability_data['effect'],
                                        re.IGNORECASE
                                    )
                                    if ia_match:
                                        ia_count = int(ia_match.group(1))
                                        ia_skill = ia_match.group(2).lower()
                                        ability_data['instant_actions'] = True
                                        ability_data['instant_actions_skill'] = ia_skill
                                        ability_data['instant_actions_count'] = ia_count
                                        print(f"    ✓ Instant-actions ability: {ia_count} {ia_skill} actions")
                                
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
                            elif 'while traveling' in line_lower:
                                skill = 'traveling'
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
            # Find content after parent div — wiki uses <ul> or <p>
            parent = h1.find_parent()
            next_elem = parent.find_next_sibling() if parent else None
            if next_elem:
                if next_elem.name == 'p':
                    pet_data['requirement_to_gain_xp'] = clean_text(next_elem.get_text())
                elif next_elem.name == 'ul':
                    # Wiki wraps the requirement in a <ul><li>
                    li = next_elem.find('li')
                    if li:
                        pet_data['requirement_to_gain_xp'] = clean_text(li.get_text())
            break
    
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
            '    def __init__(self, name: str, egg_name: str, levels: Dict[int, PetInfo],',
            '                 rare_name: Optional[str] = None, rare_export_name: Optional[str] = None,',
            '                 species: Optional[str] = None):',
            '        self.name = name',
            '        self.egg_name = egg_name',
            '        self.rare_name = rare_name  # Display name of the rare variant (e.g. "Precious Tortoise")',
            '        self.rare_export_name = rare_export_name  # Normalized for matching (e.g. "precious_tortoise")',
            '        self.species = species  # Lowercase animal species (e.g. "chicken", "tortoise")',
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
            rare_name = pet.get('rare_name')
            # Normalize rare name for export matching (e.g. "Precious Tortoise" -> "precious_tortoise")
            rare_export_name = rare_name.lower().replace(' ', '_').replace('-', '_') if rare_name else None
            
            # Create PetInfo instances for each level
            lines.append(f"    {enum_name} = PetLevels(")
            lines.append(f"        name={escape_str(pet['name'])},")
            lines.append(f"        egg_name={escape_str(pet.get('egg_name'))},")
            if rare_name:
                lines.append(f"        rare_name={escape_str(rare_name)},")
                lines.append(f"        rare_export_name={escape_str(rare_export_name)},")
            species = pet.get('species')
            if species:
                lines.append(f"        species={escape_str(species)},")
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
                
                lines.append(f"                requirement_to_gain_xp={escape_str(pet.get('requirement_to_gain_xp'))},")
                
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
                        if ability.get('duration') is not None:
                            lines.append(f"                        'duration': {ability['duration']},")
                        if ability.get('ability_stats'):
                            lines.append(f"                        'ability_stats': {{")
                            for skill, locations in ability['ability_stats'].items():
                                lines.append(f"                            '{skill}': {{")
                                for location, stat_values in locations.items():
                                    lines.append(f"                                '{location}': {{")
                                    for stat_name, stat_value in stat_values.items():
                                        lines.append(f"                                    '{stat_name}': {stat_value},")
                                    lines.append(f"                                }},")
                                lines.append(f"                            }},")
                            lines.append(f"                        }},")
                        # Instant-actions fields
                        if ability.get('instant_actions'):
                            lines.append(f"                        'instant_actions': True,")
                            lines.append(f"                        'instant_actions_skill': {escape_str(ability['instant_actions_skill'])},")
                            lines.append(f"                        'instant_actions_count': {ability['instant_actions_count']},")
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
            '# Lookup by rare export name (e.g. "precious_tortoise" -> Pet.TORTOISE)',
            'PETS_BY_RARE_EXPORT_NAME = {',
        ])
        
        for pet in pets:
            rare_name = pet.get('rare_name')
            if rare_name:
                enum_name = name_to_enum(pet['name'])
                rare_export = rare_name.lower().replace(' ', '_').replace('-', '_')
                lines.append(f"    '{rare_export}': Pet.{enum_name},")
        
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
        
        # Add SMELTING_RECIPE_NAMES constant and get_instant_actions_pet utility function
        lines.extend([
            '',
            '',
            '# Smelting recipes — the subset of Smithing recipes that the Tortoise\'s',
            '# "Shell Forge" ability applies to (from the Smelting Keyword wiki page).',
            'SMELTING_RECIPE_NAMES = {',
            "    'Smelt a copper bar',",
            "    'Create a copper bar (Scrap)',",
            "    'Smelt a silver bar',",
            "    'Smelt a bronze bar',",
            "    'Create a bronze bar (Scrap)',",
            "    'Smelt a gold bar',",
            "    'Smelt an iron bar',",
            "    'Create an iron bar (Scrap)',",
            "    'Smelt a steel bar',",
            "    'Create a steel bar (Scrap)',",
            "    'Smelt a tarsilium bar',",
            "    'Create a tarsilium bar (Scrap)',",
            "    'Smelt a hydrilium bar',",
            "    'Smelt a farganite bar',",
            "    'Smelt into ectoplasm',",
            "    'Smelt an adamant bar',",
            "    'Smelt a violite bar',",
            '}',
        ])
        lines.extend([
            '',
            '',
            'def get_instant_actions_pet(skill_type: str) -> Optional[dict]:',
            '    """Return info about the pet with an instant-actions ability for the given skill.',
            '    ',
            '    Args:',
            '        skill_type: lowercase skill name, e.g. "foraging", "smithing"',
            '    ',
            '    Returns:',
            '        dict with keys: pet_name, species, ability_name, effect, cooldown, charges,',
            '                        required_level, instant_actions_count, instant_actions_skill',
            '        or None if no matching pet exists.',
            '    """',
            '    # Skill aliases: "smelting" is a sub-skill of "smithing" in the game.',
            '    # Recipes are categorized as "smithing" but the Tortoise ability says "smelting".',
            '    SKILL_ALIASES = {',
            "        'smithing': ['smithing', 'smelting'],",
            "        'smelting': ['smelting', 'smithing'],",
            '    }',
            '    candidate_skills = SKILL_ALIASES.get(skill_type, [skill_type])',
            '    for pet_name, pet_levels in PETS_BY_NAME.items():',
            '        for level, pet_info in pet_levels.get_all_levels().items():',
            '            if not pet_info.abilities:',
            '                continue',
            '            for ability in pet_info.abilities:',
            '                if (ability.get("instant_actions") and',
            '                        ability.get("instant_actions_skill") in candidate_skills):',
            '                    return {',
            '                        "pet_name": pet_levels.name,',
            '                        "species": pet_levels.species,',
            '                        "ability_name": ability.get("name"),',
            '                        "effect": ability.get("effect"),',
            '                        "cooldown": ability.get("cooldown"),',
            '                        "charges": ability.get("charges"),',
            '                        "required_level": level,',
            '                        "instant_actions_count": ability.get("instant_actions_count"),',
            '                        "instant_actions_skill": ability.get("instant_actions_skill"),',
            '                    }',
            '    return None',
        ])
        lines.extend([
            '',
            '',
            'def get_ability_stats_pet(skill_type: str) -> Optional[dict]:',
            '    """Return info about the pet whose activatable ability grants flat stats',
            '    for the given skill.',
            '',
            '    Unlike get_instant_actions_pet (which completes actions instantly), these',
            '    abilities add flat stats (e.g. work efficiency / double action / steps)',
            '    to actions of a skill while the ability is active. Currently this is the',
            '    Tiger\'s "The Hunt Is On" ability for Hunting.',
            '',
            '    Args:',
            '        skill_type: lowercase skill name, e.g. "hunting"',
            '',
            '    Returns:',
            '        dict with keys: pet_name, species, ability_name, effect, duration,',
            '                        cooldown, charges, required_level, ability_stats',
            '        or None if no matching pet exists.',
            '    """',
            '    if not skill_type:',
            '        return None',
            '    skill = skill_type.lower()',
            '    for pet_name, pet_levels in PETS_BY_NAME.items():',
            '        for level, pet_info in pet_levels.get_all_levels().items():',
            '            if not pet_info.abilities:',
            '                continue',
            '            for ability in pet_info.abilities:',
            '                ability_stats = ability.get("ability_stats")',
            '                if ability_stats and skill in ability_stats:',
            '                    return {',
            '                        "pet_name": pet_levels.name,',
            '                        "species": pet_levels.species,',
            '                        "ability_name": ability.get("name"),',
            '                        "effect": ability.get("effect"),',
            '                        "duration": ability.get("duration"),',
            '                        "cooldown": ability.get("cooldown"),',
            '                        "charges": ability.get("charges"),',
            '                        "required_level": level,',
            '                        "ability_stats": ability_stats,',
            '                    }',
            '    return None',
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
            # Carry rare_name from the main table into pet_data
            pet_data['rare_name'] = pet_info.get('rare_name')
            pets.append(pet_data)
            print(f"  ✓ Rare name: {pet_data.get('rare_name', 'None')}")
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

    # Refresh stats_report precomputed tables after scrape completes.
    # See util/stats_report/ for details. No-op if sessions.db not present.
    try:
        from util.stats_report.precompute.scraper_hook import refresh_after_scrape
        refresh_after_scrape()
    except Exception as _e:
        print(f"[stats_report precompute] hook failed: {_e}")
