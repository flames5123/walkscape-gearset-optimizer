#!/usr/bin/env python3
"""
Scrape equipment data from Walkscape wiki and generate equipment.py
Focus: Tools only, with Agility/Global skills
Stats: Double Action, Work Efficiency, +/- Steps, -% Steps
"""

from bs4 import BeautifulSoup
from scraper_utils import *
import re

# Configuration
RESCRAPE = False  # Set to True to re-download HTML pages
SCAN_FOLDER_FOR_NEW_ITEMS = True  # Scan cache folder for additional items
CACHE_DIR = get_cache_dir('equipment')
EQUIPMENT_URL = 'https://wiki.walkscape.app/wiki/Equipment'
CACHE_FILE = get_cache_file('equipment_cache.html')

# Note: Stat keywords and skill lists are now in scraper_utils.py
# We use normalize_stat_name(), parse_stat_value(), extract_skill_from_text(), etc.

# Items with activity-specific stats are now handled via gated_stats['activity']
# No longer need to exclude them - they're stored separately and not included in normal calculations

# Quality levels for crafted items
QUALITY_LEVELS = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']

# Set bonus definitions
# Structure: {set_keyword: {piece_count: {skill: {location: {stat: value}}}}}
SET_BONUS_DEFINITIONS = {
    'Proper gear': {
        # Bonuses at different piece counts
        1: {'trinketry': {'global': {'work_efficiency': 1.0, 'quality_outcome': 1.0}}},
        2: {'trinketry': {'global': {'work_efficiency': 2.0, 'quality_outcome': 2.0}}},
        3: {'trinketry': {'global': {'work_efficiency': 3.0, 'quality_outcome': 3.0}}},
        4: {'trinketry': {'global': {'work_efficiency': 4.0, 'quality_outcome': 4.0}}},
        5: {'global': {'global': {'chest_finding': 20.0, 'work_efficiency': 5.0}}},
    },
    'Treasure hunter set': {
        # Bonuses at different piece counts
        1: {'global': {'global': {'find_collectibles': 10.0}}},
        2: {'global': {'global': {'find_collectibles': 20.0}}},
        3: {'global': {'global': {'find_collectibles': 30.0, 'chest_finding': 10.0}}},
    },
}

# Create validator instance
validator = ScraperValidator()


def sanitize_filename(filename):
    """Remove invalid characters from filename"""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, '_')
    return filename


def extract_equipment_links(html_content):
    """Extract all equipment item links from Equipment page"""
    soup = BeautifulSoup(html_content, 'html.parser')
    equipment_links = []
    
    # The Equipment page now has all items in wikitables (no section headings)
    # Just extract from all wikitables
    tables = soup.find_all('table', class_='wikitable')
    print(f"  Found {len(tables)} tables")
    
    for table_idx, table in enumerate(tables):
        rows = table.find_all('tr')[1:]  # Skip header
        print(f"  Table {table_idx}: {len(rows)} rows")
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) >= 2:
                # Item name is in the second cell
                link = cells[1].find('a')
                if link and link.get('href'):
                    item_name = link.get_text().strip()
                    item_url = 'https://wiki.walkscape.app' + link['href']
                    uuid = row.get('data-achievement-id', '')
                    equipment_links.append((item_name, item_url, uuid))
    
    return equipment_links


def parse_item_page(html_content, item_name):
    """Parse an item page to extract stats"""
    soup = BeautifulSoup(html_content, 'html.parser')
    item_data = {
        'name': item_name,
        'skills': [],
        'slot': None,  # Equipment slot
        'keywords': [],  # Item keywords
        'value': 0,  # Coin value
        'location_requirements': [],  # Regions/locations where item works
        'stats': {},  # Legacy flat stats
        'skill_stats': {},  # New format: {skill: {stat: value}}
        'is_crafted': False,
        'is_achievement': False,
        'quality_stats': {},  # For crafted items: {quality: {skill: {stat: value}}}
        'quality_values': {},  # For crafted items: {quality: coin_value}
        'achievement_stats': {},  # For achievement items: {ap_threshold: {skill: {stat: value}}}
        'gated_stats': {},  # For gated items: {gate_type: {gate_key: {threshold: {skill: {location: {stat: value}}}}}}
    }
    
    # Try to find slot information from infobox
    infobox = soup.find('table', class_='ItemInfobox')
    if infobox:
        for row in infobox.find_all('tr'):
                header = row.find('th')
                if not header:
                    continue
                
                header_text = header.get_text()
                
                # Extract slot
                if 'Slot' in header_text:
                    slot_cell = row.find('td')
                    if slot_cell:
                        links = slot_cell.find_all('a')
                        for link in links:
                            link_text = link.get_text().strip()
                            if link_text and not link_text.endswith('.svg'):
                                slot_lower = link_text.lower()
                                if 'tool' in slot_lower:
                                    item_data['slot'] = 'tools'
                                elif 'ring' in slot_lower:
                                    item_data['slot'] = 'ring'
                                else:
                                    item_data['slot'] = slot_lower
                                break
                
                # Extract keywords
                if 'Keyword' in header_text:
                    keyword_cell = row.find('td')
                    if keyword_cell:
                        keyword_links = keyword_cell.find_all('a')
                        for link in keyword_links:
                            keyword_text = link.get_text().strip()
                            if keyword_text and not keyword_text.endswith('.svg'):
                                item_data['keywords'].append(keyword_text)
                
                # Extract value
                if 'Value' in header_text and 'Fine Value' not in header_text:
                    value_cell = row.find('td')
                    if value_cell:
                        value_text = value_cell.get_text()
                        value_match = re.search(r'(\d+)', value_text)
                        if value_match:
                            item_data['value'] = int(value_match.group(1))
    
    # Parse requirements section
    requirements = []
    requirement_section = soup.find('h1', id='Requirement') or soup.find('h1', id='Requirements')
    if requirement_section:
        # Find the list after the heading
        req_list = requirement_section.parent.find_next('ul')
        if req_list:
            for li in req_list.find_all('li', recursive=False):
                req_text = li.get_text().strip()
                
                # Parse reputation requirement: "Have (100) Syrenthia faction reputation" or "Have [100] Syrenthia faction reputation"
                rep_match = re.search(r'Have\s*[\(\[](\d+)[\)\]]\s*([^f]+?)\s+faction\s+reputation', req_text, re.IGNORECASE)
                if rep_match:
                    amount = int(rep_match.group(1))
                    faction = rep_match.group(2).strip().lower().replace(' ', '_')
                    requirements.append({
                        'type': 'reputation',
                        'faction': faction,
                        'amount': amount
                    })
                    continue
                
                # Parse character level requirement: "Have character level 40" or "Have character level [40]"
                char_level_match = re.search(r'Have character level\s+\[?(\d+)\]?', req_text, re.IGNORECASE)
                if char_level_match:
                    level = int(char_level_match.group(1))
                    requirements.append({
                        'type': 'character_level',
                        'level': level
                    })
                    continue
                
                # Parse skill requirement: "At least Agility lvl. 12" or "At least 50 lvl. Carpentry"
                skill_match = re.search(r'At least\s+(?:(\w+)\s+lvl\.\s+(\d+)|(\d+)\s+lvl\.\s+(\w+))', req_text, re.IGNORECASE)
                if skill_match:
                    if skill_match.group(1):  # Skill first format
                        skill = skill_match.group(1)
                        level = int(skill_match.group(2))
                    else:  # Level first format
                        level = int(skill_match.group(3))
                        skill = skill_match.group(4)
                    requirements.append({
                        'type': 'skill',
                        'skill': skill,
                        'level': level
                    })
                    continue
    
    item_data['requirements'] = requirements
    
    # Extract stats from the Attributes section (try both plural and singular)
    # Don't require infobox - some pages have Lua errors but still have attributes
    attributes_section = soup.find('h1', id='Attributes') or soup.find('h1', id='Attribute')
    if not attributes_section:
        print(f"      No Attributes/Attribute section")
        return None
    
    print(f"      Found Attributes section")
    
    # For crafted items with tabber, extract quality-specific values
    tabber = soup.find('div', class_='tabber')
    if tabber:
        # Check if this has quality tabs
        quality_tabs = tabber.find_all('a', class_='tabber__tab')
        has_quality_tabs = any(tab.get_text().strip() in QUALITY_LEVELS for tab in quality_tabs)
        
        if has_quality_tabs:
            panels = tabber.find_all('article', class_='tabber__panel')
            for panel in panels:
                panel_id = panel.get('id', '')
                quality_match = re.search(r'tabber-(\w+)', panel_id)
                if quality_match:
                    quality = quality_match.group(1)
                    if quality in QUALITY_LEVELS:
                        # Extract value from this quality's infobox
                        infobox = panel.find('table', class_='ItemInfobox')
                        if infobox:
                            for row in infobox.find_all('tr'):
                                header = row.find('th')
                                if header and 'Value' in header.get_text():
                                    value_cell = row.find('td')
                                    if value_cell:
                                        value_text = value_cell.get_text()
                                        value_match = re.search(r'(\d+)', value_text)
                                        if value_match:
                                            item_data['quality_values'][quality] = int(value_match.group(1))
                                            break
    
    # Check if this is a crafted item (has a table with quality levels)
    current = attributes_section.parent
    while current:
        current = current.find_next_sibling()
        if not current:
            break
        
        # Check for table (crafted items)
        if current.name == 'table' and 'wikitable' in current.get('class', []):
            item_data['is_crafted'] = True
            rows = current.find_all('tr')[1:]  # Skip header
            
            for row in rows:
                cells = row.find_all('td')
                if len(cells) >= 3:
                    # Get quality name from image alt text
                    quality_img = cells[1].find('img')
                    if quality_img:
                        quality = quality_img.get('alt', '').strip()
                        if quality in QUALITY_LEVELS:
                            # Parse attributes from third cell
                            attr_cell = cells[2]
                            quality_item_data = {'skill_stats': {}}
                            
                            # Split by <br> tags to get individual stat lines
                            for br in attr_cell.find_all('br'):
                                br.replace_with('\n')
                            text = attr_cell.get_text()
                            lines = [l.strip() for l in text.split('\n') if l.strip()]
                            
                            # Parse lines, looking ahead for location/activity requirements
                            i = 0
                            while i < len(lines):
                                line = lines[i]
                                line_lower = line.lower()
                                
                                # Check if next line is a location requirement
                                location_req = None
                                if i + 1 < len(lines):
                                    next_line = lines[i + 1].lower()
                                    if 'while in' in next_line or 'not in an' in next_line:
                                        # Check for (NOT) negation
                                        is_negated = '(not)' in next_line or 'not in an' in next_line
                                        # Extract location from next line
                                        loc_match = re.search(r'(?:while in (?:the )?|not in an\s+)([^.]+?)(?:\s+(?:location|area))?\.?$', next_line)
                                        if loc_match:
                                            location_req = loc_match.group(1).strip()
                                            # Add ! prefix for negated locations
                                            if is_negated:
                                                location_req = '!' + location_req
                                            i += 1  # Skip the location line
                                
                                # Check if current line has "while doing" for an activity (not skill)
                                # Activity stats are now stored in gated_stats['activity']
                                is_activity = is_activity_stat(line)
                                
                                # Parse the stat line with location context
                                # Activity stats will be handled specially in parse_stat_line_with_location
                                parse_stat_line_with_location(line, quality_item_data, location_req)
                                i += 1
                            
                            if quality_item_data['skill_stats']:
                                item_data['quality_stats'][quality] = quality_item_data['skill_stats']
            break
        
        # Check for paragraph (regular items or achievement items)
        elif current.name == 'p':
            # Split by <br> tags to get individual stat lines
            for br in current.find_all('br'):
                br.replace_with('\n')
            text = current.get_text()
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            
            # Check if this is an achievement item (has achievement point requirements)
            has_achievement_points = any('achievement point' in line.lower() for line in lines)
            
            if has_achievement_points:
                item_data['is_achievement'] = True
                print(f"      Detected achievement item")
                
                # Parse achievement-gated stats
                # The stat comes BEFORE its AP requirement
                # We need to look ahead to find which AP threshold each stat belongs to
                i = 0
                while i < len(lines):
                    line = lines[i]
                    
                    # Skip AP requirement lines
                    if re.search(r'[\(\[](\d+)[\)\]]\s*achievement point', line.lower()):
                        i += 1
                        continue
                    
                    # Check if next line is a location requirement
                    location_req = None
                    next_i = i + 1
                    if next_i < len(lines):
                        next_line = lines[next_i].lower()
                        if 'while in' in next_line or 'not in an' in next_line:
                            # Check for (NOT) negation
                            is_negated = '(not)' in next_line or 'not in an' in next_line
                            loc_match = re.search(r'(?:while in (?:the )?|not in an\s+)([^.]+?)(?:\s+(?:location|area))?\.?$', next_line)
                            if loc_match:
                                location_req = loc_match.group(1).strip()
                                # Add ! prefix for negated locations
                                if is_negated:
                                    location_req = '!' + location_req
                                next_i += 1  # Skip the location line
                    
                    # Check if current line has "while doing" for an activity (not skill)
                    is_activity = is_activity_stat(line)
                    
                    # Look ahead to find the AP requirement for this stat
                    # IMPORTANT: Only look 1 line ahead (next_i) to avoid misattributing base stats
                    # If the AP requirement is not immediately after the stat, it's a base stat (0 AP)
                    ap_threshold = 0  # Default to 0 AP (base stat)
                    if next_i < len(lines):
                        ap_match = re.search(r'[\(\[](\d+)[\)\]]\s*achievement point', lines[next_i].lower())
                        if ap_match:
                            ap_threshold = int(ap_match.group(1))
                            next_i += 1  # Skip the AP requirement line
                    
                    # Parse the stat line with location context for the found AP threshold
                    # Activity stats will be handled specially in parse_stat_line_with_location
                    if ap_threshold not in item_data['achievement_stats']:
                        item_data['achievement_stats'][ap_threshold] = {'skill_stats': {}}
                    parse_stat_line_with_location(line, item_data['achievement_stats'][ap_threshold], location_req)
                    
                    i = next_i  # Move to next unprocessed line
            else:
                # Regular item
                # Parse lines, looking ahead for location/activity requirements
                i = 0
                while i < len(lines):
                    line = lines[i]
                    line_lower = line.lower()
                    
                    # Skip requirement lines (total skill level, reputation, etc.)
                    if 'have a' in line_lower and 'total skill level' in line_lower:
                        i += 1
                        continue
                    if 'have' in line_lower and 'reputation' in line_lower:
                        i += 1
                        continue
                    
                    # Check if next line(s) are requirements (item ownership, location, activity, skill level)
                    location_req = None
                    is_activity = False
                    skill_level_req = None
                    item_ownership_req = None
                    
                    # Look ahead up to 3 lines for requirements
                    next_i = i + 1
                    while next_i < min(i + 4, len(lines)):
                        next_line = lines[next_i]
                        next_line_lower = next_line.lower()
                        
                        if 'own a' in next_line_lower or 'own an' in next_line_lower:
                            # Item ownership requirement: "Own a Map of Jarvonia"
                            own_match = re.search(r'own (?:a|an)\s+(.+?)\.?$', next_line_lower)
                            if own_match:
                                item_name = own_match.group(1).strip()
                                item_ownership_req = {
                                    'type': 'item_ownership',
                                    'item': item_name
                                }
                                next_i += 1
                                continue
                        
                        if 'while in' in next_line_lower or 'not in an' in next_line_lower:
                            # Extract location using shared function
                            loc_text, is_negated = extract_location_from_text(next_line)
                            if loc_text:
                                location_req = loc_text
                                # Add ! prefix for negated locations
                                if is_negated:
                                    location_req = '!' + location_req
                                next_i += 1
                                continue
                        
                        if 'while doing' in next_line_lower:
                            # Check if it's an activity (not skill) using shared function
                            if is_activity_stat(next_line):
                                # Activity-specific stat: extract activity name
                                activity_match = re.search(r'while doing\s+(\w+)', next_line_lower)
                                if activity_match:
                                    activity_name = activity_match.group(1).lower()
                                    # Store as activity gate
                                    skill_level_req = {
                                        'type': 'activity',
                                        'activity': activity_name
                                    }
                                is_activity = True
                                next_i += 1
                                continue
                        
                        if 'at least' in next_line_lower and 'lvl' in next_line_lower:
                            # Skill level requirement: "At least Crafting lvl. 50"
                            skill_match = re.search(r'at least\s+(\w+)\s+lvl\.\s*(\d+)', next_line_lower)
                            if skill_match:
                                skill_level_req = {
                                    'type': 'skill_level',
                                    'skill': skill_match.group(1),
                                    'level': int(skill_match.group(2))
                                }
                                next_i += 1
                                continue
                        
                        if 'have completed' in next_line_lower and 'activity' in next_line_lower:
                            # Activity completion requirement
                            activity_match = re.search(r'have completed the\s+(.+?)\s+activity\s+[\(\[](\d+)[\)\]]\s+times', next_line_lower)
                            if activity_match:
                                activity_name = activity_match.group(1).strip()
                                completions = int(activity_match.group(2))
                                skill_level_req = {
                                    'type': 'activity_completion',
                                    'activity': activity_name,
                                    'completions': completions
                                }
                                next_i += 1
                                continue
                        
                        if 'requires' in next_line_lower and 'unique' in next_line_lower and 'equipped' in next_line_lower:
                            # Set piece requirement
                            set_match = re.search(r'requires\s+[\(\[](\d+)[\)\]]\s+unique\s+(.+?)\s+equipped', next_line_lower)
                            if set_match:
                                piece_count = int(set_match.group(1))
                                set_name = set_match.group(2).strip()
                                skill_level_req = {
                                    'type': 'set_pieces',
                                    'set_name': set_name,
                                    'piece_count': piece_count
                                }
                                next_i += 1
                                continue
                        
                        # If we get here, this line is not a requirement - stop looking
                        break
                    
                    # Update i to skip all processed requirement lines
                    i = next_i
                    
                    # Parse the stat line with location context
                    # Activity stats will be handled specially in parse_stat_line_with_location
                    if skill_level_req or item_ownership_req:
                        # Parse as gated stat
                        gate_req = skill_level_req or item_ownership_req
                        parse_gated_stat_line(line, item_data, location_req, gate_req)
                    else:
                        # Parse as regular stat
                        parse_stat_line_with_location(line, item_data, location_req)
            break
    
    # For crafted items, extract common stats across all qualities into base_stats
    if item_data['is_crafted'] and item_data['quality_stats']:
        common_stats = {}
        qualities = list(item_data['quality_stats'].keys())
        
        if qualities:
            first_quality_stats = item_data['quality_stats'][qualities[0]]
            
            for skill, stats in first_quality_stats.items():
                for stat_key, stat_value in stats.items():
                    is_common = all(
                        item_data['quality_stats'][q].get(skill, {}).get(stat_key) == stat_value
                        for q in qualities[1:]
                    )
                    
                    if is_common:
                        if skill not in common_stats:
                            common_stats[skill] = {}
                        common_stats[skill][stat_key] = stat_value
            
            # Remove common stats from quality_stats and set as base_stats
            if common_stats:
                item_data['stats'] = common_stats
                for quality in qualities:
                    for skill in common_stats:
                        for stat_key in common_stats[skill]:
                            if skill in item_data['quality_stats'][quality]:
                                item_data['quality_stats'][quality][skill].pop(stat_key, None)
                                if not item_data['quality_stats'][quality][skill]:
                                    item_data['quality_stats'][quality].pop(skill, None)
    
    # Return item even if no stats (for items like Ring of Homesickness)
    if not item_data['slot']:
        item_data['slot'] = 'unknown'
    
    # Convert skill_stats to stats for non-crafted items
    if not item_data['is_crafted']:
        item_data['stats'] = item_data['skill_stats']
    
    return item_data


def parse_gated_stat_line(text, item_data, location_req=None, skill_level_req=None):
    """Parse a stat line with a skill level requirement"""
    text_lower = text.lower()
    
    # Skip lines that are just requirements
    if 'at least' in text_lower or 'have' in text_lower:
        return
    
    # Determine which skill this stat applies to
    skill = extract_skill_from_text(text)
    
    # Extract numeric value
    value_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*(%?)', text)
    if not value_match:
        return
    
    value_str = value_match.group(1)
    has_percent = value_match.group(2) == '%'
    
    # Normalize stat name
    stat_name = normalize_stat_name(text_lower)
    if not stat_name:
        validator.add_unrecognized_stat(item_data.get('name', 'Unknown'), text.strip())
        return
    
    # Parse the value
    value_with_percent = value_str + ('%' if has_percent else '')
    final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
    
    # Store in gated_stats based on requirement type
    if skill_level_req:
        req_type = skill_level_req.get('type', 'skill_level')
        
        if req_type == 'skill_level':
            gate_type = 'skill_level'
            gate_key = skill_level_req['skill']
            threshold = skill_level_req['level']
        elif req_type == 'activity_completion':
            gate_type = 'activity_completion'
            gate_key = skill_level_req['activity']
            threshold = skill_level_req['completions']
        elif req_type == 'activity':
            # Activity-specific stat (not gated by completion, just only applies during activity)
            gate_type = 'activity'
            gate_key = skill_level_req['activity']
            # Activity gates don't have thresholds - store directly under activity name
            
            # Initialize nested structure (no threshold level)
            if gate_type not in item_data['gated_stats']:
                item_data['gated_stats'][gate_type] = {}
            if gate_key not in item_data['gated_stats'][gate_type]:
                item_data['gated_stats'][gate_type][gate_key] = {}
            if skill not in item_data['gated_stats'][gate_type][gate_key]:
                item_data['gated_stats'][gate_type][gate_key][skill] = {}
            
            location_key = normalize_location_name(location_req) if location_req else 'global'
            if location_key not in item_data['gated_stats'][gate_type][gate_key][skill]:
                item_data['gated_stats'][gate_type][gate_key][skill][location_key] = {}
            
            item_data['gated_stats'][gate_type][gate_key][skill][location_key][final_stat_name] = final_value
            return  # Early return for activity gates
        elif req_type == 'item_ownership':
            # Item ownership requirement (e.g., "Own a Map of Jarvonia")
            gate_type = 'item_ownership'
            gate_key = skill_level_req['item']
            # Item ownership gates don't have thresholds - store directly under item name
            
            # Initialize nested structure (no threshold level)
            if gate_type not in item_data['gated_stats']:
                item_data['gated_stats'][gate_type] = {}
            if gate_key not in item_data['gated_stats'][gate_type]:
                item_data['gated_stats'][gate_type][gate_key] = {}
            if skill not in item_data['gated_stats'][gate_type][gate_key]:
                item_data['gated_stats'][gate_type][gate_key][skill] = {}
            
            location_key = normalize_location_name(location_req) if location_req else 'global'
            if location_key not in item_data['gated_stats'][gate_type][gate_key][skill]:
                item_data['gated_stats'][gate_type][gate_key][skill][location_key] = {}
            
            item_data['gated_stats'][gate_type][gate_key][skill][location_key][final_stat_name] = final_value
            return  # Early return for item ownership gates
        elif req_type == 'set_pieces':
            # Set piece requirement (e.g., "Requires (5) unique Proper gear equipped")
            gate_type = 'set_pieces'
            gate_key = skill_level_req['set_name']
            threshold = skill_level_req['piece_count']
        else:
            return  # Unknown gate type
        
        # Initialize nested structure (with threshold for skill_level and activity_completion)
        if gate_type not in item_data['gated_stats']:
            item_data['gated_stats'][gate_type] = {}
        if gate_key not in item_data['gated_stats'][gate_type]:
            item_data['gated_stats'][gate_type][gate_key] = {}
        if threshold not in item_data['gated_stats'][gate_type][gate_key]:
            item_data['gated_stats'][gate_type][gate_key][threshold] = {}
        if skill not in item_data['gated_stats'][gate_type][gate_key][threshold]:
            item_data['gated_stats'][gate_type][gate_key][threshold][skill] = {}
        
        location_key = normalize_location_name(location_req) if location_req else 'global'
        if location_key not in item_data['gated_stats'][gate_type][gate_key][threshold][skill]:
            item_data['gated_stats'][gate_type][gate_key][threshold][skill][location_key] = {}
        
        item_data['gated_stats'][gate_type][gate_key][threshold][skill][location_key][final_stat_name] = final_value


def parse_stat_line_with_location(text, item_data, location_req=None):
    """Parse a stat line with explicit location requirement"""
    text_lower = text.lower()
    
    # Skip lines that are just location requirements
    if 'while in' in text_lower and not any(kw in text_lower for kw in ['%', '+', '-']):
        return
    
    # Determine which skill this stat applies to using shared function
    skill = extract_skill_from_text(text)
    
    # Extract numeric value
    value_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*(%?)', text)
    if not value_match:
        return
    
    value_str = value_match.group(1)
    has_percent = value_match.group(2) == '%'
    
    # Initialize structures
    if 'skill_stats' not in item_data:
        item_data['skill_stats'] = {}
    if skill not in item_data['skill_stats']:
        item_data['skill_stats'][skill] = {}
    
    location_key = normalize_location_name(location_req) if location_req else 'global'
    if location_key not in item_data['skill_stats'][skill]:
        item_data['skill_stats'][skill][location_key] = {}
    
    # Check if this is an activity-specific stat
    item_name = item_data.get('name', '')
    if is_activity_stat(text):
        # Extract activity name from text (e.g., "While doing Sledding")
        activity_match = re.search(r'While doing\s+(\w+)', text, re.IGNORECASE)
        if activity_match:
            activity_name = activity_match.group(1).lower()
            
            # Store in gated_stats['activity'] instead of regular stats
            if 'activity' not in item_data['gated_stats']:
                item_data['gated_stats']['activity'] = {}
            if activity_name not in item_data['gated_stats']['activity']:
                item_data['gated_stats']['activity'][activity_name] = {}
            if skill not in item_data['gated_stats']['activity'][activity_name]:
                item_data['gated_stats']['activity'][activity_name][skill] = {}
            if location_key not in item_data['gated_stats']['activity'][activity_name][skill]:
                item_data['gated_stats']['activity'][activity_name][skill][location_key] = {}
            
            # Parse and store the stat
            value_with_percent = value_str
            if has_percent:
                value_with_percent += '%'
            
            stat_name = normalize_stat_name(text_lower)
            if stat_name:
                final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
                item_data['gated_stats']['activity'][activity_name][skill][location_key][final_stat_name] = final_value
            
            return  # Don't add to regular stats
    
    # Use shared function to normalize stat name
    stat_name = normalize_stat_name(text_lower)
    
    if not stat_name:
        # Track unrecognized stats
        validator.add_unrecognized_stat(item_name, text.strip())
        return
    
    if stat_name:
        # Build value string with % if present
        value_with_percent = value_str
        if has_percent:
            value_with_percent += '%'
        
        final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
        item_data['skill_stats'][skill][location_key][final_stat_name] = final_value


def parse_stat_line(text, item_data):
    """Parse a single stat line and add to item_data with skill and location context"""
    text_lower = text.lower()
    
    # Extract location requirement for this specific stat
    location_req = None
    if 'while in' in text_lower:
        # Check for (NOT) before "while in"
        is_negated = '(not)' in text_lower or 'not while in' in text_lower
        
        location_match = re.search(r'while in (?:the )?([^.]+?)(?:\s+(?:location|area))?\.?$', text_lower)
        if location_match:
            location_req = location_match.group(1).strip()
            # Add ! prefix for negated locations
            if is_negated:
                location_req = '!' + location_req
    
    # Determine which skill this stat applies to using shared function
    skill = extract_skill_from_text(text)
    
    # Extract numeric value and check if it has a % sign
    value_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*(%?)', text)
    if not value_match:
        return
    
    value_str = value_match.group(1)
    has_percent = value_match.group(2) == '%'
    
    # Initialize skill dict if needed
    if 'skill_stats' not in item_data:
        item_data['skill_stats'] = {}
    if skill not in item_data['skill_stats']:
        item_data['skill_stats'][skill] = {}
    
    # Create location key (None for global stats, location name for restricted)
    location_key = normalize_location_name(location_req) if location_req else 'global'
    
    # Initialize location dict within skill
    if location_key not in item_data['skill_stats'][skill]:
        item_data['skill_stats'][skill][location_key] = {}
    
    # Use shared function to normalize stat name
    stat_name = normalize_stat_name(text_lower)
    
    if not stat_name:
        # Track unrecognized stats
        item_name = item_data.get('name', 'Unknown')
        UNRECOGNIZED_STATS.append({
            'item': item_name,
            'text': text.strip()
        })
        return
    
    if stat_name:
        # Build value string with % if present
        value_with_percent = value_str
        if has_percent:
            value_with_percent += '%'
        
        # Special handling for steps on certain items
        if stat_name == 'steps':
            item_name = item_data.get('name', '')
            if item_name in STEPS_AS_PERCENTAGE:
                # Force percentage for these items
                item_data['skill_stats'][skill][location_key]['steps_percent'] = float(value_str)
            else:
                # Use shared function to determine if it's add or percent
                final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
                item_data['skill_stats'][skill][location_key][final_stat_name] = final_value
        else:
            # Use shared function for all other stats
            final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
            item_data['skill_stats'][skill][location_key][final_stat_name] = final_value


def generate_equipment_py(items):
    """Generate the equipment.py file"""
    output_file = get_output_file('equipment.py')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Auto-generated equipment data from Walkscape wiki', 'scrape_equipment.py')
        write_imports(f, [
            'from typing import Dict, Optional, Union, TYPE_CHECKING',
            'from util.walkscape_constants import Attribute, Skill, SkillInstance, LocationInfo, Location',
            'from util.stats_mixin import StatsMixin'
        ])
        
        lines = [
        '',
        'class ItemInstance(StatsMixin):',
        '    """Base class for item instances"""',
        '    def __init__(self, name: str, uuid: str, stats: Dict, slot: str = None, keywords: list = None, value: int = 0, location_reqs: list = None, gated_stats: Dict = None, requirements: list = None):',
        '        self.name = name',
        '        self.uuid = uuid',
        '        self.slot = slot',
        '        self.keywords = keywords or []',
        '        self.value = value  # Coin value',
        '        self.location_requirements = location_reqs or []  # Regions/locations where item works',
        '        self._stats = stats  # Nested dict: {skill: {location: {stat: value}}}',
        '        self.gated_stats = gated_stats or {}  # Stats with requirements (skill level, activity completion, etc.)',
        '        self.requirements = requirements or []  # Unlock requirements (reputation, skill level, etc.)',
        '    ',
        '    @property',
        '    def da(self) -> float:',
        '        """Double Action chance (combined from all skills)"""',
        '        stats = self.get_stats_for_skill()',
        '        return stats.get("double_action", 0.0)',
        '    ',
        '    @property',
        '    def we(self) -> float:',
        '        """Work Efficiency (combined from all skills)"""',
        '        stats = self.get_stats_for_skill()',
        '        return stats.get("work_efficiency", 0.0)',
        '    ',
        '    @property',
        '    def steps_add(self) -> float:',
        '        """+/- Steps (combined from all skills)"""',
        '        stats = self.get_stats_for_skill()',
        '        return stats.get("steps_add", 0.0)',
        '    ',
        '    @property',
        '    def steps_percent(self) -> float:',
        '        """-% Steps (combined from all skills)"""',
        '        stats = self.get_stats_for_skill()',
        '        return stats.get("steps_percent", 0.0)',
        '    ',
        '    def __repr__(self):',
        '        return f"ItemInstance({self.name}, {self._stats})"',
        '',
        # Generate achievement item class
        '',
        'class AchievementItem:',
        '    """Item with stats that unlock at achievement point thresholds"""',
        '    def __init__(self, name: str, uuid: str, slot: str, keywords: list, value: int, achievement_stats: Dict[int, Dict[str, float]], requirements: list = None):',
        '        self.name = name',
        '        self.uuid = uuid',
        '        self.slot = slot',
        '        self.keywords = keywords',
        '        self.value = value',
        '        self._achievement_stats = achievement_stats  # {ap_threshold: stats}',
        '        self.requirements = requirements or []  # Unlock requirements',
        '    ',
        '    def __getitem__(self, achievement_points: int):',
        '        """Allow accessing by achievement points like OMNI_TOOL[140]"""',
        '        return self._get_stats_for_ap(achievement_points)',
        '    ',
        '    def _get_stats_for_ap(self, achievement_points: int):',
        '        """Get item stats for given achievement points"""',
        '        # Accumulate all stats up to the achievement point threshold',
        '        accumulated_stats = {}',
        '        for threshold in sorted(self._achievement_stats.keys()):',
        '            if threshold <= achievement_points:',
        '                # Stats are in format {skill: {location: {stat: value}}}',
        '                for skill, skill_data in self._achievement_stats[threshold].items():',
        '                    if skill not in accumulated_stats:',
        '                        accumulated_stats[skill] = {}',
        '                    for location, location_data in skill_data.items():',
        '                        if location not in accumulated_stats[skill]:',
        '                            accumulated_stats[skill][location] = {}',
        '                        for stat, value in location_data.items():',
        '                            accumulated_stats[skill][location][stat] = accumulated_stats[skill][location].get(stat, 0.0) + value',
        '        ',
        '        return ItemInstance(f"{self.name} ({achievement_points})", self.uuid, accumulated_stats, self.slot, self.keywords, self.value, requirements=self.requirements)',
        '    ',
        '    @property',
        '    def display_name(self):',
        '        """Get name with current achievement points"""',
        '        import util.walkscape_globals',
        '        ap = util.walkscape_globals.ACHIEVEMENT_POINTS',
        '        return f"{self.name} ({ap} AP)"',
        '    ',
        '    def is_unlocked(self, character=None, ignore_gear_requirements=False):',
        '        """Check if achievement item is unlocked - delegates to current AP instance"""',
        '        import util.walkscape_globals',
        '        ap = util.walkscape_globals.ACHIEVEMENT_POINTS',
        '        instance = self._get_stats_for_ap(ap)',
        '        return instance.is_unlocked(character, ignore_gear_requirements)',
        '    ',
        '    def get_stats_for_skill(self, skill=None, location=None, activity=None, achievement_points=None):',
        '        """Get stats for achievement item at given AP level"""',
        '        if achievement_points is None:',
        '            import util.walkscape_globals',
        '            achievement_points = util.walkscape_globals.ACHIEVEMENT_POINTS',
        '        instance = self._get_stats_for_ap(achievement_points)',
        '        return instance.get_stats_for_skill(skill, location, activity)',
        '    ',
        '    def attr(self, skill=None, location=None, activity=None, achievement_points: int = None):',
        '        """Get attributes for achievement item at given AP level"""',
        '        if achievement_points is None:',
        '            import util.walkscape_globals',
        '            achievement_points = util.walkscape_globals.ACHIEVEMENT_POINTS',
        '        instance = self._get_stats_for_ap(achievement_points)',
        '        return instance.attr(skill, location=location, activity=activity)',
        '    ',
        '    def __repr__(self):',
        '        import util.walkscape_globals',
        '        ap = util.walkscape_globals.ACHIEVEMENT_POINTS',
        '        return f"AchievementItem({self.name} ({ap} AP))"',
        '',
        # Generate crafted item class
        '',
        'class CraftedItem:',
        '    """Item with quality levels"""',
        '    def __init__(self, name: str, uuid: str, slot: str, keywords: list, value: int, base_stats: Dict[str, float], quality_stats: Dict[str, Dict[str, float]], quality_values: Dict[str, int] = None):',
        '        self.name = name',
        '        self.uuid = uuid',
        '        self.slot = slot',
        '        self.keywords = keywords',
        '        self.value = value',
        '        self._base_stats = base_stats',
        '        self._quality_stats = quality_stats',
        '        self._quality_values = quality_values or {}',
        '    ',
        ]
        
        # Add quality properties
        for quality in QUALITY_LEVELS:
            quality_upper = quality.upper()
            lines.extend([
            f'    @property',
            f'    def {quality_upper}(self) -> ItemInstance:',
            f'        """Get {quality} quality version"""',
            f'        stats = self._base_stats.copy()',
            f'        stats.update(self._quality_stats.get("{quality}", {{}}))',
            f'        value = self._quality_values.get("{quality}", self.value)',
            f'        return ItemInstance(f"{{self.name}} ({quality})", self.uuid, stats, self.slot, self.keywords, value)',
            '    ',
            ])
    
        lines.extend([
        '    def __repr__(self):',
        '        return f"CraftedItem({self.name})"',
        '',
        # Generate Item class with all items
        'class Item:',
        '    """All equipment items"""',
        '    ',
        '    @classmethod',
        '    def by_uuid(cls, uuid: str, quality: str = None):',
        '        """Look up item by UUID and optional quality"""',
        '        # Build UUID lookup on first call',
        '        if not hasattr(cls, "_uuid_map"):',
        '            cls._uuid_map = {}',
        '            for attr_name in dir(cls):',
        '                if attr_name.startswith("_"):',
        '                    continue',
        '                attr = getattr(cls, attr_name)',
        '                if isinstance(attr, (ItemInstance, CraftedItem, AchievementItem)):',
        '                    cls._uuid_map[attr.uuid] = (attr_name, attr)',
        '        ',
        '        if uuid not in cls._uuid_map:',
        '            return None',
        '        ',
        '        attr_name, item = cls._uuid_map[uuid]',
        '        ',
        '        # Handle crafted items with quality',
        '        if isinstance(item, CraftedItem) and quality:',
        '            # Map gearset rarity to crafted quality levels',
        '            quality_map = {"common": "NORMAL", "uncommon": "GOOD", "rare": "GREAT",',
        '                          "epic": "EXCELLENT", "legendary": "PERFECT", "ethereal": "ETERNAL"}',
        '            quality_attr = quality_map.get(quality.lower(), "NORMAL")',
        '            return getattr(item, quality_attr)',
        '        ',
        '        # Handle achievement items - use global AP',
        '        if isinstance(item, AchievementItem):',
        '            import util.walkscape_globals',
        '            ap = util.walkscape_globals.ACHIEVEMENT_POINTS',
        '            return item[ap]',
        '        ',
        '        return item',
        '    ',
        ])
        
        for item in items:
            item_const = item['name'].upper().replace(' ', '_').replace("'", '').replace('-', '_')
            slot = item.get('slot', 'unknown')
            keywords = item.get('keywords', [])
            location_reqs = item.get('location_requirements', [])
            
            if item['is_crafted']:
                # Crafted item
                base_stats = item['stats']
                quality_stats = item['quality_stats']
                quality_values = item.get('quality_values', {})
                lines.extend([
                    f'    {item_const} = CraftedItem(',
                    f'        name="{item["name"]}",',
                    f'        uuid="{item["uuid"]}",',
                    f'        slot="{slot}",',
                    f'        keywords={keywords},',
                    f'        value={item.get("value", 0)},',
                    f'        base_stats={base_stats},',
                    f'        quality_stats={quality_stats},',
                    f'        quality_values={quality_values}',
                    '    )',
                ])
            elif item['is_achievement']:
                # Achievement item
                # Convert achievement_stats format from {ap: {'skill_stats': {...}}} to {ap: {...}}
                achievement_stats = {}
                for ap, data in item['achievement_stats'].items():
                    achievement_stats[ap] = data.get('skill_stats', {})
                lines.extend([
                    f'    {item_const} = AchievementItem(',
                    f'        name="{item["name"]}",',
                    f'        uuid="{item["uuid"]}",',
                    f'        slot="{slot}",',
                    f'        keywords={keywords},',
                    f'        value={item.get("value", 0)},',
                    f'        achievement_stats={achievement_stats}',
                    '    )',
                ])
            else:
                # Regular item
                stats = item['stats']
                gated_stats = item.get('gated_stats', {})
                requirements = item.get('requirements', [])
                
                lines.extend([
                    f'    {item_const} = ItemInstance(',
                    f'        name="{item["name"]}",',
                    f'        uuid="{item["uuid"]}",',
                    f'        stats={stats},',
                    f'        slot="{slot}",',
                    f'        keywords={keywords},',
                    f'        value={item.get("value", 0)},',
                    f'        location_reqs={location_reqs},',
                    f'        gated_stats={gated_stats},',
                    f'        requirements={requirements}',
                    '    )',
                ])
            lines.append('')
        
        write_lines(f, lines)
    
    print(f"✓ Generated {output_file} with {len(items)} items")


def main():
    """Main scraping logic"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Download Equipment page
    print("Step 1: Downloading Equipment page...")
    equipment_cache = get_cache_file('equipment_cache.html')
    equipment_html = download_page(EQUIPMENT_URL, equipment_cache, rescrape=RESCRAPE)
    
    if not equipment_html:
        print("Failed to download Equipment page")
        return
    
    # Step 2: Extract equipment links (gear + tools)
    print("\nStep 2: Extracting equipment links...")
    equipment_links = extract_equipment_links(equipment_html)
    print(f"Found {len(equipment_links)} items from main page")
    
    # Scan folder for additional items
    if SCAN_FOLDER_FOR_NEW_ITEMS:
        print("\nScanning cache folder for additional items...")
        folder_items = scan_cache_folder_for_items(CACHE_DIR, equipment_cache)
        if folder_items:
            # Build set of existing item names
            existing_names = {name for name, url, uuid in equipment_links}
            
            # Add folder items that aren't already in the list
            added_count = 0
            for item in folder_items:
                if item['name'] not in existing_names:
                    equipment_links.append((item['name'], None, ''))
                    added_count += 1
                    print(f"  ✓ Added: {item['name']}")
            
            if added_count > 0:
                print(f"  Total added: {added_count} items from folder")
    
    print(f"\nTotal items to process: {len(equipment_links)}")
    
    # Step 3: Download and parse each item page
    print("\nStep 3: Parsing item pages...")
    items = []
    
    for i, (item_name, item_url, uuid) in enumerate(equipment_links, 1):
        # Check if this is a folder item
        is_folder = item_url is None
        source = "folder" if is_folder else "wiki"
        print(f"  [{i}/{len(equipment_links)}] Processing: {item_name} (from {source})")
        
        cache_filename = sanitize_filename(item_name) + '.html'
        cache_path = CACHE_DIR / cache_filename
        
        if is_folder:
            # Read from cached file
            item_html = read_cached_html(cache_path)
        else:
            # Download from wiki
            item_html = download_page(item_url, cache_path)
        
        if not item_html:
            continue
        
        item_data = parse_item_page(item_html, item_name)
        
        # If no stats found, try re-downloading (might be corrupted cache)
        if not item_data:
            print(f"    ✗ No relevant stats found - retrying with fresh download...")
            cache_path.unlink(missing_ok=True)  # Delete corrupted cache
            item_html = download_page(item_url, cache_path, rescrape=True)
            if item_html:
                item_data = parse_item_page(item_html, item_name)
        
        if item_data:
            item_data['uuid'] = uuid
            
            # Validate item data for issues
            issue_reasons = validator.validate_item_stats(item_name, item_data.get('stats', {}))
            
            # Check quality stats for crafted items
            if item_data['is_crafted'] and item_data.get('quality_stats'):
                for quality, stats in item_data['quality_stats'].items():
                    if None in stats:
                        issue_reasons.append(f"None skill key in {quality} quality stats")
            
            if issue_reasons:
                validator.add_item_issue(item_name, issue_reasons)
            
            items.append(item_data)
            if item_data['is_crafted']:
                print(f"    ✓ Extracted crafted item with {len(item_data['quality_stats'])} qualities")
            else:
                print(f"    ✓ Extracted stats: {item_data['stats']}")
        else:
            print(f"    ✗ Still no stats after retry - skipping")
            validator.add_item_issue(item_name, ['No stats extracted'])
    
    # Step 4: Generate equipment.py
    print(f"\nStep 4: Generating equipment.py...")
    generate_equipment_py(items)
    
    # Step 5: Report items with issues
    validator.report()


if __name__ == "__main__":
    main()
