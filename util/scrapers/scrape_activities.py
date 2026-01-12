#!/usr/bin/env python3
"""
Scrape Activities from Walkscape wiki and generate activities.py

Activities are the core gameplay actions in Walkscape. Each activity has:
- Name and icon
- Location(s) where it can be performed
- Skill level requirements
- Drop tables (primary and secondary)
- Requirements (gear, tools, reputation, etc.)
- Base steps and XP rewards

This scraper downloads the main Activities page and individual activity pages
to extract all relevant information.
"""

from bs4 import BeautifulSoup
import re
import os
from pathlib import Path
from scraper_utils import *

# Configuration
RESCRAPE = False
ACTIVITIES_URL = 'https://wiki.walkscape.app/wiki/Activities'
CACHE_DIR = get_cache_dir('activities')
MAIN_CACHE_FILE = get_cache_file('activities_cache.html')

# Activities to skip (handled elsewhere or not real activities)
SKIP_ACTIVITIES = [
    'Traveling',  # Handled by route system
]

# Folder scanning - set to True to also scan cache folder for individual activity files
SCAN_FOLDER_FOR_NEW_ITEMS = True

# Create validator instance
validator = ScraperValidator()

def parse_activities_list():
    """Parse the main activities list to get all activity names and basic info."""
    print("Downloading activities list...")
    html = download_page(ACTIVITIES_URL, MAIN_CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    activities = []
    
    # Find the activities table (it's the second wikitable, first is skills)
    tables = soup.find_all('table', class_='wikitable')
    if len(tables) < 2:
        print(f"ERROR: Expected 2 tables, found {len(tables)}")
        return []
    
    table = tables[1]  # Second table is activities
    
    rows = table.find_all('tr')[1:]  # Skip header
    print(f"Found {len(rows)} activities in table")
    
    for row in rows:
        cols = row.find_all('td')
        if len(cols) < 4:
            continue
        
        # Extract activity link
        activity_link = cols[1].find('a')
        if not activity_link:
            continue
        
        activity_name = activity_link.get_text(strip=True)
        
        # Skip activities in the skip list
        if activity_name in SKIP_ACTIVITIES:
            continue
        activity_url = 'https://wiki.walkscape.app' + activity_link.get('href', '')
        
        # Extract locations
        locations_text = cols[2].get_text(strip=True)
        
        # Extract skill requirements
        skill_req_text = cols[3].get_text(strip=True)
        
        activities.append({
            'name': activity_name,
            'url': activity_url,
            'locations_text': locations_text,
            'skill_req_text': skill_req_text
        })
    
    return activities


def scan_folder_for_activities():
    """
    Scan the cache folder for individual activity HTML files.
    
    This allows adding new activities before they appear on the main wiki page.
    Files should be named like "Activity_Name.html" in the cache folder.
    
    Returns:
        List of activity dicts with name and url (url will be None for folder-scanned activities)
    """
    if not SCAN_FOLDER_FOR_NEW_ITEMS:
        return []
    
    print("\nScanning cache folder for additional activity files...")
    
    cache_path = Path(CACHE_DIR)
    if not cache_path.exists():
        print(f"  Cache folder doesn't exist: {cache_path}")
        return []
    
    activities = []
    html_files = list(cache_path.glob('*.html'))
    
    # Filter out the main cache file
    main_cache_name = MAIN_CACHE_FILE.name if hasattr(MAIN_CACHE_FILE, 'name') else str(MAIN_CACHE_FILE).split('/')[-1]
    html_files = [f for f in html_files if f.name != main_cache_name]
    
    print(f"  Found {len(html_files)} HTML files in cache folder")
    
    for html_file in html_files:
        # Extract activity name from filename (remove .html extension)
        activity_name = html_file.stem
        
        # Convert underscores back to spaces if needed
        activity_name = activity_name.replace('_', ' ')
        
        # Skip if in skip list
        if activity_name in SKIP_ACTIVITIES:
            continue
        
        print(f"  Found: {activity_name}")
        
        activities.append({
            'name': activity_name,
            'url': None,  # No URL for folder-scanned activities
            'locations_text': '',
            'skill_req_text': '',
            'from_folder': True,  # Mark as folder-scanned
            'cache_file': html_file  # Store the file path
        })
    
    return activities


def parse_activity_page(activity):
    """Download and parse individual activity page for detailed information."""
    activity_name = activity['name']
    print(f"\nParsing: {activity_name}")
    
    # Check if this is a folder-scanned activity
    if activity.get('from_folder'):
        # Read from the cached file directly
        cache_path = activity['cache_file']
        print(f"  Reading from folder: {cache_path.name}")
        
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                html = f.read()
        except Exception as e:
            validator.add_item_issue(activity_name, [f"Failed to read file: {e}"])
            return None
    else:
        # Create cache filename
        cache_filename = sanitize_filename(activity_name) + '.html'
        cache_path = Path(CACHE_DIR) / cache_filename
        
        # Download page
        html = download_page(activity['url'], cache_path, rescrape=RESCRAPE)
        if not html:
            validator.add_item_issue(activity_name, ["Failed to download page"])
            return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Initialize activity data
    activity_data = {
        'name': activity_name,
        'enum_name': name_to_enum(activity_name),  # Keep for code generation
        'primary_skill': None,
        'locations': [],
        'skill_requirements': {},
        'requirements': {
            'keyword_counts': {},  # {keyword: count} - unified gear requirements
            'achievement_points': 0,
            'reputation': {},  # {faction: amount}
            'activity_completions': {}  # {activity_name: count}
        },
        'drop_table': [],
        'secondary_drop_table': [],
        'base_steps': None,
        'base_xp': None,
        'secondary_xp': {},  # Dict of skill -> base_xp for secondary skills
        'max_efficiency': None,
        'faction_reputation_reward': None,  # Tuple of (faction_name, amount) or None
        'description': None
    }
    
    # Extract description and primary skill from first paragraph
    content = soup.find('div', class_='mw-parser-output')
    if content:
        # Find the paragraph with "activity" in it (usually second <p>)
        paragraphs = content.find_all('p')
        for p in paragraphs:
            text = p.get_text()
            if 'activity' in text.lower():
                # This is the activity description paragraph
                # Extract primary skill from text like "is a Agility activity"
                # Handle multiple spaces with \s+
                skill_match = re.search(r'is\s+an?\s+(\w+)\s+activity', text, re.IGNORECASE)
                if skill_match:
                    activity_data['primary_skill'] = skill_match.group(1)
                break
        
        # Use first paragraph as description (the quote)
        if paragraphs:
            activity_data['description'] = clean_text(paragraphs[0].get_text())
    
    # Find ItemInfobox
    infobox = soup.find('table', class_='ItemInfobox')
    if infobox:
        parse_infobox(infobox, activity_data, activity_name)
    
    # Parse locations from Location section
    parse_locations_section(soup, activity_data, activity_name)
    
    # Parse requirements from Requirement section
    parse_requirements_section(soup, activity_data, activity_name)
    
    # Parse base XP and steps from Experience Information table
    parse_experience_table(soup, activity_data, activity_name)
    
    # Parse faction reputation rewards
    parse_faction_reputation(soup, activity_data)
    
    # Parse drop tables
    parse_drop_tables(soup, activity_data, activity_name)
    
    return activity_data


def parse_infobox(infobox, activity_data, activity_name):
    """Parse an infobox table for activity details."""
    rows = infobox.find_all('tr')
    
    for row in rows:
        header = row.find('th')
        data = row.find('td')
        
        if not header or not data:
            continue
        
        header_text = clean_text(header.get_text())
        data_text = clean_text(data.get_text())
        
        # Parse different fields
        if 'Main Skill' in header_text:
            # Extract primary skill from link
            skill_link = data.find('a', href=re.compile(r'/wiki/(Special:MyLanguage/)?(Agility|Carpentry|Cooking|Crafting|Fishing|Foraging|Mining|Smithing|Trinketry|Woodcutting)'))
            if skill_link:
                activity_data['primary_skill'] = skill_link.get_text(strip=True)
        
        elif 'Location' in header_text:
            # Extract location names
            location_links = data.find_all('a')
            for link in location_links:
                loc_name = clean_text(link.get_text())
                if loc_name and loc_name not in activity_data['locations']:
                    activity_data['locations'].append(loc_name)
        
        elif 'Skill' in header_text and 'Level' in header_text:
            # Parse skill requirements
            parse_skill_requirements(data, activity_data)
        
        elif 'Requirements' in header_text or 'Requirement' in header_text:
            # Parse requirements (gear, tools, etc.)
            parse_requirements(data_text, activity_data, activity_name)
        
        elif 'Base Steps' in header_text or 'Steps' in header_text:
            # Parse base steps
            try:
                steps = parse_number(data_text)
                if steps:
                    activity_data['base_steps'] = steps
            except:
                pass
        
        elif 'Base XP' in header_text or 'Experience' in header_text:
            # Parse base XP
            try:
                xp = parse_number(data_text)
                if xp:
                    activity_data['base_xp'] = xp
            except:
                pass
        
        elif 'Max Efficiency' in header_text or 'Maximum Efficiency' in header_text:
            # Parse max efficiency
            try:
                # Parse percentage like "150%" or "70%"
                max_eff_match = re.search(r'(\d+(?:\.\d+)?)\s*%', data_text)
                if max_eff_match:
                    # Convert percentage to bonus (150% -> 0.5, 200% -> 1.0)
                    max_eff_pct = float(max_eff_match.group(1))
                    # Round to 2 decimal places to avoid floating point errors
                    activity_data['max_efficiency'] = round((max_eff_pct / 100.0) - 1.0, 2)
            except:
                pass
        
        elif 'Reputation' in header_text and 'Faction' not in header_text:
            # Parse faction reputation rewards (e.g., "Halfling Rebels +1")
            try:
                # Look for patterns like "Faction Name +X" or "Faction Name: +X"
                rep_matches = re.findall(r'([A-Za-z\s]+?)\s*[:\+]\s*\+?(\d+)', data_text)
                for faction, amount in rep_matches:
                    faction = faction.strip()
                    if faction and amount:
                        activity_data['faction_reputation'][faction] = int(amount)
            except:
                pass


def parse_skill_requirements(data_td, activity_data):
    """Parse skill level requirements from infobox."""
    # Look for skill icons and levels
    skill_links = data_td.find_all('a', href=re.compile(r'/wiki/(Agility|Carpentry|Cooking|Crafting|Fishing|Foraging|Mining|Smithing|Trinketry|Woodcutting)'))
    
    for link in skill_links:
        skill_name = link.get('title', '').strip()
        if not skill_name:
            continue
        
        # Find level text near the skill link
        parent = link.parent
        if parent:
            text = parent.get_text()
            # Look for "lvl XX" or "level XX"
            level_match = re.search(r'lvl?\s*(\d+)', text, re.IGNORECASE)
            if level_match:
                level = int(level_match.group(1))
                activity_data['skill_requirements'][skill_name] = level


def parse_requirements(req_text, activity_data, activity_name):
    """Parse requirements text for gear, tools, reputation, etc."""
    if not req_text or req_text == 'None':
        return
    
    # Common requirement patterns
    requirements = []
    
    # Diving gear
    if 'diving gear' in req_text.lower():
        match = re.search(r'(\d+)\s+diving gear', req_text, re.IGNORECASE)
        if match:
            count = int(match.group(1))
            requirements.append(f"diving_gear:{count}")
        else:
            requirements.append("diving_gear:1")
    
    # Tools
    if 'tool' in req_text.lower():
        # "Have Carpentry tool equipped"
        tool_match = re.search(r'Have\s+(\w+)\s+tool\s+equipped', req_text, re.IGNORECASE)
        if tool_match:
            skill = tool_match.group(1)
            requirements.append(f"tool:{skill}")
        # "X unique tools"
        unique_match = re.search(r'(\d+)\s+unique\s+tools?', req_text, re.IGNORECASE)
        if unique_match:
            count = int(unique_match.group(1))
            requirements.append(f"unique_tools:{count}")
    
    # Light sources
    light_match = re.search(r'(\d+)\s+(?:unique\s+)?light\s+sources?', req_text, re.IGNORECASE)
    if light_match:
        count = int(light_match.group(1))
        requirements.append(f"light_sources:{count}")
    
    # Reputation
    rep_match = re.search(r'(\d+)\s+reputation\s+with\s+([^,\.]+)', req_text, re.IGNORECASE)
    if rep_match:
        amount = int(rep_match.group(1))
        faction = clean_text(rep_match.group(2))
        requirements.append(f"reputation:{faction}:{amount}")
    
    # Activity completions
    completion_match = re.search(r'completed?\s+(?:the\s+)?(.+?)\s+activity\s+\((\d+)\)\s+times', req_text, re.IGNORECASE)
    if completion_match:
        activity = clean_text(completion_match.group(1))
        count = int(completion_match.group(2))
        requirements.append(f"activity_completion:{activity}:{count}")
    
    # Store all requirements
    if requirements:
        activity_data['requirements'].extend(requirements)
    
    # Also store raw text for validation
    if req_text not in ['None', '']:
        activity_data['requirements_raw'] = req_text


def parse_quantity(qty_str):
    """Parse quantity string into Quantity object."""
    if not qty_str or qty_str.strip() == 'N/A':
        return {'is_na': True, 'min_qty': None, 'max_qty': None}
    
    # Check for range (e.g., "1-4", "10-100")
    range_match = re.match(r'(\d+)-(\d+)', qty_str.strip())
    if range_match:
        min_qty = int(range_match.group(1))
        max_qty = int(range_match.group(2))
        return {'is_na': False, 'min_qty': min_qty, 'max_qty': max_qty}
    
    # Check for single number
    num_match = re.match(r'(\d+)', qty_str.strip())
    if num_match:
        qty = int(num_match.group(1))
        return {'is_na': False, 'min_qty': qty, 'max_qty': qty}
    
    # Default to N/A
    return {'is_na': True, 'min_qty': None, 'max_qty': None}


def parse_chance(chance_str):
    """Parse chance string into float percentage."""
    if not chance_str:
        return None
    
    # Remove % sign and parse
    chance_str = chance_str.strip().replace('%', '')
    try:
        return float(chance_str)
    except ValueError:
        return None


def parse_locations_section(soup, activity_data, activity_name):
    """Parse locations from the Location/Locations section."""
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        return
    
    # Find Location or Locations heading
    location_heading = content.find('h1', id='Location')
    if not location_heading:
        location_heading = content.find('h1', id='Locations')
    if not location_heading:
        return
    
    # Find the list after the heading
    next_elem = location_heading.parent.find_next_sibling()
    while next_elem:
        if next_elem.name == 'ul':
            # Extract location links
            for li in next_elem.find_all('li'):
                location_link = li.find('a', href=re.compile(r'/wiki/(?!File:)'))
                if location_link:
                    loc_name = clean_text(location_link.get_text())
                    if loc_name and loc_name not in activity_data['locations']:
                        activity_data['locations'].append(loc_name)
            break
        elif next_elem.name in ['h1', 'h2']:
            # Hit next section
            break
        next_elem = next_elem.find_next_sibling()


def parse_requirements_section(soup, activity_data, activity_name):
    """Parse skill requirements and gear requirements from Requirement/Requirements section."""
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        return
    
    # Find Requirement or Requirements heading
    req_heading = content.find('h1', id='Requirement')
    if not req_heading:
        req_heading = content.find('h1', id='Requirements')
    if not req_heading:
        return
    
    # Find content after heading
    next_elem = req_heading.parent.find_next_sibling()
    while next_elem:
        if next_elem.name in ['h1', 'h2']:
            # Hit next section
            break
        
        text = next_elem.get_text()
        
        # Parse skill level requirements: "At least Agility lvl. 40"
        skill_matches = re.findall(r'At least.*?(\w+)\s+lvl?\.\s*(\d+)', text, re.IGNORECASE)
        for skill_name, level in skill_matches:
            activity_data['skill_requirements'][skill_name] = int(level)
        
        # Parse keyword requirements (climbing gear, skis, etc.)
        # Look for links to keyword pages
        if next_elem.name == 'ul':
            for li in next_elem.find_all('li'):
                li_text = li.get_text()
                
                # Check for keyword requirements - look for links with "Keyword" in href
                # There are multiple links per li: one for the icon, one for the keyword page
                keyword_links = li.find_all('a', href=re.compile(r'Keyword', re.I))
                for keyword_link in keyword_links:
                    # Skip file/image links
                    if '/wiki/File:' in keyword_link.get('href', ''):
                        continue
                    keyword_name = clean_text(keyword_link.get_text())
                    if keyword_name:
                        # Normalize keyword to lowercase
                        keyword_lower = keyword_name.lower()
                        
                        # Check if there's a count specified like "[3] Diving gear"
                        count_match = re.search(r'\[(\d+)\].*?' + re.escape(keyword_name), li_text, re.IGNORECASE)
                        if count_match:
                            count = int(count_match.group(1))
                        else:
                            count = 1  # Default to 1 if no count specified
                        
                        # Add to keyword_counts (use max if already exists)
                        current = activity_data['requirements']['keyword_counts'].get(keyword_lower, 0)
                        activity_data['requirements']['keyword_counts'][keyword_lower] = max(current, count)
                        print(f"  Found keyword requirement: {keyword_lower} x{count}")
                
                # Check for achievement points
                if 'achievement point' in li_text.lower():
                    ap_match = re.search(r'\[(\d+)\].*?achievement point', li_text, re.IGNORECASE)
                    if ap_match:
                        activity_data['requirements']['achievement_points'] = int(ap_match.group(1))
                        print(f"  Found AP requirement: {ap_match.group(1)}")
        
        # Parse light source requirements (not handled by keyword links)
        # Note: diving gear is handled by keyword links above, don't duplicate here
        if 'light source' in text.lower():
            match = re.search(r'\[(\d+)\].*?light\s+sources?', text, re.IGNORECASE)
            if match:
                count = int(match.group(1))
                current = activity_data['requirements']['keyword_counts'].get('light source', 0)
                activity_data['requirements']['keyword_counts']['light source'] = max(current, count)
                print(f"  Found light source requirement: {count}")
        
        # Reputation requirements
        rep_match = re.search(r'(\d+)\s+reputation\s+with\s+([^,\.]+)', text, re.IGNORECASE)
        if rep_match:
            amount = int(rep_match.group(1))
            faction = clean_text(rep_match.group(2))
            activity_data['requirements']['reputation'][faction] = amount
        
        # Activity completion requirements
        completion_match = re.search(r'completed?\s+(?:the\s+)?(.+?)\s+activity\s+\((\d+)\)\s+times', text, re.IGNORECASE)
        if completion_match:
            activity_name = clean_text(completion_match.group(1))
            count = int(completion_match.group(2))
            activity_data['requirements']['activity_completions'][activity_name] = count
        
        next_elem = next_elem.find_next_sibling()


def parse_experience_table(soup, activity_data, activity_name):
    """Parse base XP and steps from Experience Information table."""
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        return
    
    # Find Experience Information heading
    exp_heading = content.find('h1', id='Experience_Information')
    if not exp_heading:
        return
    
    # Find the table after the heading
    next_elem = exp_heading.parent.find_next_sibling()
    while next_elem:
        if next_elem.name == 'table' and 'wikitable' in next_elem.get('class', []):
            # Parse the table
            rows = next_elem.find_all('tr')
            if len(rows) < 2:
                break
            
            # Skip header row, process data rows
            data_rows = rows[1:]
            
            # Collect all skills and their XP values
            skills_and_xp = []
            base_steps = None
            
            for row_idx, row in enumerate(data_rows):
                cols = row.find_all('td')
                if len(cols) < 3:
                    continue
                
                # Find skill link in col 1
                skill_link = cols[1].find('a', href=re.compile(r'/wiki/(Special:MyLanguage/)?(Agility|Carpentry|Cooking|Crafting|Fishing|Foraging|Mining|Smithing|Trinketry|Woodcutting)'))
                if not skill_link:
                    continue
                
                skill_name = skill_link.get_text(strip=True)
                
                # Parse XP (col 2)
                try:
                    xp = int(clean_text(cols[2].get_text()))
                    skills_and_xp.append((skill_name, xp))
                except:
                    pass
                
                # Parse base steps (col 3, but only in first row due to rowspan)
                if base_steps is None and row_idx == 0 and len(cols) > 3:
                    try:
                        steps_text = clean_text(cols[3].get_text())
                        base_steps = int(steps_text)
                    except:
                        pass
            
            # Set base steps
            if base_steps:
                activity_data['base_steps'] = base_steps
            
            # First skill is primary, rest are secondary
            if skills_and_xp:
                primary_skill, primary_xp = skills_and_xp[0]
                activity_data['base_xp'] = primary_xp
                
                # Add secondary skills
                for skill_name, xp in skills_and_xp[1:]:
                    activity_data['secondary_xp'][skill_name] = xp
            
            break
        elif next_elem.name in ['h1', 'h2']:
            break
        next_elem = next_elem.find_next_sibling()


def parse_faction_reputation(soup, activity_data):
    """Parse faction reputation rewards from activity page."""
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        return
    
    # Find "Faction Reputation Reward" heading (can be h1, h2, or h3)
    rep_heading = content.find('h3', id='Faction_Reputation_Reward')
    if not rep_heading:
        rep_heading = content.find('h2', id='Faction_Reputation_Reward')
    if not rep_heading:
        rep_heading = content.find('h1', id='Faction_Reputation_Reward')
    if not rep_heading:
        # Try without underscores
        rep_heading = content.find('h3', string=re.compile(r'Faction.*Reputation.*Reward', re.I))
        if not rep_heading:
            rep_heading = content.find('h2', string=re.compile(r'Faction.*Reputation.*Reward', re.I))
            if not rep_heading:
                rep_heading = content.find('h1', string=re.compile(r'Faction.*Reputation.*Reward', re.I))
    
    if not rep_heading:
        # Try looking for any heading with "Faction" in it
        all_headings = content.find_all(['h1', 'h2', 'h3'])
        for heading in all_headings:
            if 'faction' in heading.get_text().lower():
                rep_heading = heading
                break
    
    if not rep_heading:
        return
    
    # Find the table after the heading (need to go through parent div first)
    next_elem = rep_heading.parent.find_next_sibling()
    while next_elem:
        if next_elem.name == 'table' and 'wikitable' in next_elem.get('class', []):
            # Parse the table
            rows = next_elem.find_all('tr')
            if len(rows) >= 2:
                # Second row has the data
                data_row = rows[1]
                cols = data_row.find_all('td')
                
                # Table format: Icon | Faction Name | Quantity
                # So we need cols[1] for faction name and cols[2] for amount
                if len(cols) >= 3:
                    faction_name = clean_text(cols[1].get_text())
                    amount_text = clean_text(cols[2].get_text())
                    
                    try:
                        # Parse amount (could be "+1", "1", or "0.01")
                        amount_match = re.search(r'\+?([\d.]+)', amount_text)
                        if amount_match and faction_name:
                            amount = float(amount_match.group(1))
                            # Store as tuple (faction_name, amount)
                            activity_data['faction_reputation_reward'] = (faction_name, amount)
                            print(f"  Found faction reputation: {faction_name} = {amount}")
                    except Exception as e:
                        print(f"  Error parsing faction reputation: {e}")
            break
        elif next_elem.name in ['h1', 'h2', 'h3']:
            break
        next_elem = next_elem.find_next_sibling()


def parse_drop_tables(soup, activity_data, activity_name):
    """Parse drop tables from activity page."""
    # Look for drop table sections
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        return
    
    # Find all tables
    tables = content.find_all('table', class_='wikitable')
    
    # Known faction names to filter out from drop tables
    faction_names = ['Erdwise', 'Halfling Rebels', 'Jarvonia', 'Syrenthia', 'Trellin']
    
    for table in tables:
        # Check if this is a drop table
        caption = table.find('caption')
        if caption:
            caption_text = clean_text(caption.get_text())
        else:
            # Check previous heading
            prev_heading = table.find_previous(['h2', 'h3', 'h4'])
            caption_text = clean_text(prev_heading.get_text()) if prev_heading else ''
        
        is_secondary = 'secondary' in caption_text.lower() or 'rare' in caption_text.lower()
        
        # Parse table rows
        rows = table.find_all('tr')[1:]  # Skip header
        
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 3:
                continue
            
            # Column 0 is icon, Column 1 is item name
            item_link = cols[1].find('a')
            if item_link:
                item_name = clean_text(item_link.get_text())
            else:
                item_name = clean_text(cols[1].get_text())
            
            # Skip empty rows
            if not item_name or item_name == '':
                continue
            
            # Skip skill/XP rows (first row in drop tables)
            # These have skill names like "Agility", "Crafting", etc.
            skill_names = ['Agility', 'Carpentry', 'Cooking', 'Crafting', 'Fishing', 
                          'Foraging', 'Mining', 'Smithing', 'Trinketry', 'Woodcutting']
            if item_name in skill_names:
                continue
            
            # Skip faction reputation entries (they should be in faction_reputation_reward field)
            if item_name in faction_names:
                continue
            
            # For secondary drops: Item Name, Item Type, Quantity, Chance...
            # For main drops: Item Name, Quantity, Chance...
            if is_secondary and len(cols) >= 4:
                # Secondary: col 1=name, col 2=type, col 3=quantity, col 4=chance
                quantity_text = clean_text(cols[3].get_text())
                chance_text = clean_text(cols[4].get_text()) if len(cols) > 4 else None
            else:
                # Main: col 1=name, col 2=quantity, col 3=chance
                quantity_text = clean_text(cols[2].get_text())
                chance_text = clean_text(cols[3].get_text()) if len(cols) > 3 else None
            
            drop_entry = {
                'item': item_name,
                'quantity': parse_quantity(quantity_text),
                'chance': parse_chance(chance_text)
            }
            
            if is_secondary:
                activity_data['secondary_drop_table'].append(drop_entry)
            else:
                activity_data['drop_table'].append(drop_entry)


def link_items_and_locations(activities):
    """Link items and locations to their objects, report missing ones."""
    # Build lookup dictionaries for all item types
    lookups = build_all_item_lookups()
    
    if not lookups:
        print("Warning: Could not build item lookups")
        return
    
    locations_by_name = lookups.get('Location', {})
    
    # Link items in drop tables
    for activity in activities:
        if not activity:
            continue
        
        # Validate locations exist
        for loc_name in activity['locations']:
            if loc_name.lower() not in locations_by_name:
                validator.add_item_issue(activity['name'], [f"Location not found: {loc_name}"])
                print(f"  ⚠ {activity['name']}: Location not found: {loc_name}")
        
        # Link drop table items
        for drop in activity['drop_table']:
            item_name = drop['item']
            if item_name in ['Nothing', 'Coins']:
                continue  # Skip special items
            
            # Use the shared resolve function
            item_ref = resolve_item_reference(item_name, lookups)
            
            if item_ref:
                drop['item_object'] = item_ref
            else:
                validator.add_item_issue(activity['name'], [f"Drop item not found: {item_name}"])
                print(f"  ⚠ {activity['name']}: Drop item not found: {item_name}")
                drop['item_object'] = None
        
        # Link secondary drop table items
        for drop in activity['secondary_drop_table']:
            item_name = drop['item']
            if item_name in ['Nothing', 'Coins']:
                continue
            
            # Use the shared resolve function
            item_ref = resolve_item_reference(item_name, lookups)
            
            if item_ref:
                drop['item_object'] = item_ref
            else:
                validator.add_item_issue(activity['name'], [f"Secondary drop item not found: {item_name}"])
                print(f"  ⚠ {activity['name']}: Secondary drop item not found: {item_name}")
                drop['item_object'] = None


def generate_module(activities):
    """Generate the activities.py module."""
    output_file = get_output_file('activities.py')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Activities data from Walkscape wiki', 'scrape_activities.py')
        
        imports = [
            'from typing import Dict, List, Optional, Any',
            'from dataclasses import dataclass, field',
            'from util.autogenerated.locations import Location',
            'from util.item_utils import Quantity, DropEntry',
        ]
        write_imports(f, imports)
        
        lines = []
        lines.extend([
        '@dataclass',
        'class FactionReward:',
        '    """Represents faction reputation reward per action."""',
        '    name: str',
        '    value: float',
        '    ',
        '    def __str__(self) -> str:',
        '        return f"{self.name}: {self.value}"',
        '',
        '',
        '@dataclass',
        'class ActivityInfo:',
        '    """Detailed information about an activity."""',
        '    name: str',
        '    primary_skill: Optional[str]',
        '    locations: List[Any]  # List of Location enum values',
        '    skill_requirements: Dict[str, int]',
        '    requirements: Dict[str, Any]  # Structured requirements dict',
        '    drop_table: List[DropEntry]',
        '    secondary_drop_table: List[DropEntry]',
        '    base_steps: Optional[int] = None',
        '    base_xp: Optional[int] = None',
        '    secondary_xp: Dict[str, int] = field(default_factory=dict)  # Dict of skill -> base_xp',
        '    max_efficiency: Optional[float] = None',
        '    faction_reputation_reward: Optional[FactionReward] = None',
        '    description: Optional[str] = None',
        '    ',
        '    def get_expected_drop_rate(self, stats: Dict[str, float], location: Optional[str] = None, ',
        '                               target_item = None, verbose: bool = False, character=None, consumable=None):',
        '        """',
        '        Calculate expected steps per item drop.',
        '        ',
        '        Automatically includes fine materials as separate entries (e.g., "Coral (Fine)").',
        '        ',
        '        Args:',
        '            stats: Dict with keys "we", "da", "dr", "flat", "pct" for the primary skill',
        '            location: Optional location name for location-specific bonuses',
        '            target_item: Optional item name (str) or Material object to calculate for specific item',
        '            verbose: If True, return (results, details) tuple with calculation breakdown',
        '            character: Optional Character object (if not provided, will load from config)',
        '            consumable: Optional Consumable object to add consumable stats',
        '        ',
        '        Returns:',
        '            If verbose=False: Dict mapping item names to expected steps per item (includes fine materials)',
        '            If verbose=True: Tuple of (results_dict, details_dict)',
        '        """',
        '        import math',
        '        ',
        '        # Convert target_item to string if it\'s an object',
        '        if target_item is not None and hasattr(target_item, \'name\'):',
        '            target_item = target_item.name',
        '        ',
        '        # Get character if not provided',
        '        if character is None:',
        '            from my_config import get_character',
        '            character = get_character()',
        '        ',
        '        skill_level = 1',
        '        if self.primary_skill and character:',
        '            skill_attr = self.primary_skill.lower()',
        '            skill_level = character.get_skill_level(skill_attr)',
        '        ',
        '        # Get activity required level for the primary skill',
        '        activity_level = self.skill_requirements.get(self.primary_skill, 1)',
        '        ',
        '        # Calculate level-based WE bonus: levels ABOVE activity requirement * 1.25%, capped at 20 levels (25% max)',
        '        levels_above = max(0, skill_level - activity_level)',
        '        level_bonus_we = min(levels_above, 20) * 0.0125',
        '        ',
        '        # Calculate collectible stats (get all stats dynamically)',
        '        collectible_stats = {}',
        '        if character and self.primary_skill:',
        '            try:',
        '                for collectible in character.collectibles:',
        '                    coll_stats = collectible.get_stats_for_skill(self.primary_skill, location=location)',
        '                    for stat_name, stat_value in coll_stats.items():',
        '                        collectible_stats[stat_name] = collectible_stats.get(stat_name, 0.0) + stat_value',
        '            except:',
        '                pass',
        '        ',
        '        # Calculate consumable stats if provided',
        '        consumable_stats = {}',
        '        if consumable and self.primary_skill:',
        '            try:',
        '                cons_stats = consumable.get_stats_for_skill(self.primary_skill, location=location)',
        '                for stat_name, stat_value in cons_stats.items():',
        '                    consumable_stats[stat_name] = consumable_stats.get(stat_name, 0.0) + stat_value',
        '            except:',
        '                pass',
        '        ',
        '        # Extract stats (already in decimal form from gearset_utils) and add all bonuses',
        '        we = stats.get("work_efficiency", 0.0) + level_bonus_we + collectible_stats.get("work_efficiency", 0.0) + consumable_stats.get("work_efficiency", 0.0)',
        '        da = stats.get("double_action", 0.0) + collectible_stats.get("double_action", 0.0) + consumable_stats.get("double_action", 0.0)',
        '        dr = stats.get("double_rewards", 0.0) + collectible_stats.get("double_rewards", 0.0) + consumable_stats.get("double_rewards", 0.0)',
        '        flat = stats.get("steps_add", 0) + int(collectible_stats.get("steps_add", 0.0)) + int(consumable_stats.get("steps_add", 0.0))',
        '        pct = stats.get("steps_percent", 0.0) + collectible_stats.get("steps_percent", 0.0) + consumable_stats.get("steps_percent", 0.0)',
        '        bonus_xp_add = stats.get("bonus_xp_add", 0.0) + collectible_stats.get("bonus_xp_add", 0.0) + consumable_stats.get("bonus_xp_add", 0.0)',
        '        bonus_xp_pct = stats.get("bonus_xp_percent", 0.0) + collectible_stats.get("bonus_xp_percent", 0.0) + consumable_stats.get("bonus_xp_percent", 0.0)',
        '        ',
        '        # Find stats (affect drop chances)',
        '        find_collectibles = stats.get("find_collectibles", 0.0) + collectible_stats.get("find_collectibles", 0.0) + consumable_stats.get("find_collectibles", 0.0)',
        '        find_gems = stats.get("find_gems", 0.0) + collectible_stats.get("find_gems", 0.0) + consumable_stats.get("find_gems", 0.0)',
        '        find_bird_nests = stats.get("find_bird_nests", 0.0) + collectible_stats.get("find_bird_nests", 0.0) + consumable_stats.get("find_bird_nests", 0.0)',
        '        chest_finding = stats.get("chest_finding", 0.0) + collectible_stats.get("chest_finding", 0.0) + consumable_stats.get("chest_finding", 0.0)',
        '        fine_material_finding = stats.get("fine_material_finding", 0.0) + collectible_stats.get("fine_material_finding", 0.0) + consumable_stats.get("fine_material_finding", 0.0)',
        '        fine_chance_multiplier = 1.0 + fine_material_finding',
        '        ',
        '        # Calculate steps per action (corrected formula matching Excel)',
        '        # Step 1: Calculate total efficiency',
        '        total_efficiency = 1.0 + we',
        '        ',
        '        # Step 2: Calculate base steps with efficiency',
        '        steps_with_efficiency = math.ceil(self.base_steps / total_efficiency)',
        '        ',
        '        # Step 3: Calculate min_steps',
        '        min_steps = math.ceil(self.base_steps * math.pow(1 + self.max_efficiency, -1))',
        '        ',
        '        # Step 4: Take max of steps_with_efficiency and min_steps',
        '        steps_after_min = max(steps_with_efficiency, min_steps)',
        '        ',
        '        # Step 5: Apply percentage reduction',
        '        steps_with_pct = math.ceil(steps_after_min * (1 + pct))',
        '        ',
        '        # Step 6: Apply flat reduction',
        '        steps_with_flat = steps_with_pct + flat',
        '        ',
        '        # Step 7: Ensure minimum of 10 steps',
        '        steps_per_single_action = max(steps_with_flat, 10)',
        '        ',
        '        # Apply double action (reduces steps per paid action)',
        '        expected_paid_actions = 1.0 / (1 + da)',
        '        expected_steps_per_action = math.ceil(expected_paid_actions * steps_per_single_action)',
        '        ',
        '        # Calculate effective rewards with DA and DR interaction',
        '        # When DA triggers, you get another action that can also proc DR',
        '        rewards_per_completion = (1 + dr) * (1 + da)',
        '        steps_per_reward_roll = steps_per_single_action / rewards_per_completion',
        '        ',
        '        # XP Calculation',
        '        primary_xp_per_action = (self.base_xp * (1.0 + bonus_xp_pct)) + bonus_xp_add',
        '        primary_xp_per_step = primary_xp_per_action / expected_steps_per_action',
        '        ',
        '        # Calculate drop rates',
        '        results = {}',
        '        all_drops = self.drop_table + self.secondary_drop_table',
        '        ',
        '        # Store comprehensive calculation details for verbose mode',
        '        details = {',
        '            "primary_skill": self.primary_skill,',
        '            "skill_level": skill_level,',
        '            "base_steps": self.base_steps,',
        '            "base_xp": self.base_xp,',
        '            "min_steps": min_steps,',
        '            "level_bonus_we_pct": level_bonus_we * 100,',
        '            "work_efficiency_before_max_pct": we * 100,',
        '            "work_efficiency_pct": total_efficiency * 100,',
        '            "work_efficiency_max_pct": self.max_efficiency * 100,',
        '            "double_action_pct": da * 100,',
        '            "double_rewards_pct": dr * 100,',
        '            "flat_steps": flat,',
        '            "pct_steps_reduction": pct * 100,',
        '            "find_collectibles_pct": find_collectibles * 100,',
        '            "find_gems_pct": find_gems * 100,',
        '            "find_bird_nests_pct": find_bird_nests * 100,',
        '            "fine_material_finding_pct": fine_material_finding * 100,',
        '            "current_efficiency": total_efficiency,',
        '            "current_steps": steps_per_single_action,',
        '            "expected_steps_per_action": expected_steps_per_action,',
        '            "steps_with_efficiency": steps_with_efficiency,',
        '            "steps_after_min": steps_after_min,',
        '            "steps_with_pct": steps_with_pct,',
        '            "steps_with_flat": steps_with_flat,',
        '            "expected_paid_actions": expected_paid_actions,',
        '            "steps_per_reward_roll": steps_per_reward_roll,',
        '            "rewards_per_completion": rewards_per_completion,',
        '            "primary_xp_per_action": primary_xp_per_action,',
        '            "primary_xp_per_step": primary_xp_per_step,',
        '        }',
        '        ',
        '        # Calculate secondary XP per step for each secondary skill',
        '        secondary_xp_per_step = {}',
        '        secondary_xp_per_action = {}',
        '        total_xp = primary_xp_per_step',
        '        ',
        '        if self.secondary_xp:',
        '            for skill, xp in self.secondary_xp.items():',
        '                xp_per_action = xp * (1 + bonus_xp_pct) + bonus_xp_add',
        '                xp_per_step = xp_per_action / expected_steps_per_action',
        '                secondary_xp_per_action[skill] = xp_per_action',
        '                secondary_xp_per_step[skill] = xp_per_step',
        '                total_xp += xp_per_step',
        '        ',
        '        details["secondary_xp_per_step"] = secondary_xp_per_step',
        '        details["secondary_xp_per_action"] = secondary_xp_per_action',
        '        details["total_xp_per_step"] = total_xp',
        '        ',
        '        # Add all collectible stats to details (with "collectible_" prefix)',
        '        for stat_name, stat_value in collectible_stats.items():',
        '            details[f"collectible_{stat_name}_pct"] = stat_value * 100',
        '        ',
        '        for drop in all_drops:',
        '            if drop.item_name == "Nothing":',
        '                continue  # Skip Nothing, but include Coins',
        '            ',
        '            # If targeting a specific item, filter drops',
        '            # BUT: If targeting a fine material, we need to process the base material',
        '            # so it can add the fine variant',
        '            if target_item:',
        '                if target_item.endswith(" (Fine)"):',
        '                    # Targeting fine material - check if this is the base material',
        '                    base_name = target_item[:-7]  # Remove " (Fine)"',
        '                    if drop.item_name != base_name:',
        '                        continue',
        '                    # Don\'t skip - we need to process this to get the fine variant',
        '                else:',
        '                    # Targeting regular material - exact match',
        '                    if drop.item_name != target_item:',
        '                        continue',
        '            ',
        '            # Calculate average quantity per drop',
        '            if drop.quantity.is_na:',
        '                avg_qty = 0',
        '            elif drop.quantity.is_static:',
        '                avg_qty = drop.quantity.min_qty',
        '            else:',
        '                avg_qty = (drop.quantity.min_qty + drop.quantity.max_qty) / 2.0',
        '            ',
        '            # Apply double rewards',
        '            # When DA triggers, you get another action which can also proc DR',
        '            # So effective DR = DR * (1 + DA)',
        '            effective_qty = avg_qty * rewards_per_completion',
        '            ',
        '            # Calculate steps per item',
        '            if drop.chance_percent and drop.chance_percent > 0:',
        '                # Apply find bonuses based on item type',
        '                base_chance = drop.chance_percent / 100.0',
        '                find_bonus = 0.0',
        '                ',
        '                # Check actual item type if item_object is available',
        '                try:',
        '                    if drop.item_object:',
        '                        from util.autogenerated.collectibles import CollectibleInstance',
        '                        # Check if item is a Collectible',
        '                        if isinstance(drop.item_object, CollectibleInstance):',
        '                            find_bonus = find_collectibles',
        '                        # Check if item name contains gem keywords',
        '                        elif any(gem in drop.item_name.lower() for gem in ["gem", "opal", "pearl", "jade", "topaz", "ruby", "sapphire", "emerald", "diamond", "wrentmarine"]):',
        '                            find_bonus = find_gems',
        '                        # Check if item is a bird nest',
        '                        elif "bird nest" in drop.item_name.lower() or "nest" in drop.item_name.lower():',
        '                            find_bonus = find_bird_nests',
        '                except:',
        '                    # Fallback to string-based detection if item_object check fails',
        '                    if drop.item_ref and "Collectible." in drop.item_ref:',
        '                        find_bonus = find_collectibles',
        '                    elif any(gem in drop.item_name.lower() for gem in ["gem", "opal", "pearl", "jade", "topaz", "ruby", "sapphire", "emerald", "diamond", "wrentmarine"]):',
        '                        find_bonus = find_gems',
        '                    elif "bird nest" in drop.item_name.lower() or "nest" in drop.item_name.lower():',
        '                        find_bonus = find_bird_nests',
        '                ',
        '                # Calculate steps per item using formula:',
        '                # steps_per_item = (1/drop_rate) * steps_per_single_action / ((1 + find_bonus) * rewards_per_completion * avg_qty)',
        '                drop_rate_inverse = 1.0 / base_chance',
        '                steps_per_item = drop_rate_inverse * steps_per_single_action / ((1 + find_bonus) * rewards_per_completion * avg_qty)',
        '                ',
        '                # Add regular material to results',
        '                results[drop.item_name] = steps_per_item',
        '                ',
        '                # Check if this material has a fine counterpart - if so, add it too',
        '                has_fine = False',
        '                try:',
        '                    if drop.item_object and hasattr(drop.item_object, "has_fine_material"):',
        '                        has_fine = drop.item_object.has_fine_material()',
        '                except:',
        '                    pass',
        '                ',
        '                if has_fine:',
        '                    # Fine materials have 1% base chance when finding regular material',
        '                    # Fine Material Finding bonus applies multiplicatively',
        '                    base_fine_chance = 0.01',
        '                    fine_material_finding = stats.get("fine_material_finding", 0.0) + collectible_stats.get("fine_material_finding", 0.0)',
        '                    fine_chance_multiplier = 1.0 + fine_material_finding',
        '                    fine_chance = base_fine_chance * fine_chance_multiplier',
        '                    ',
        '                    # Steps per fine = steps per regular / fine_chance',
        '                    steps_per_fine = steps_per_item / fine_chance',
        '                    ',
        '                    # Add fine material with " (Fine)" suffix',
        '                    results[f"{drop.item_name} (Fine)"] = steps_per_fine',
        '        ',
        '        if verbose:',
        '            return results, details',
        '        return results',
        '    ',
        '    def get_all_drops(self, include_nothing: bool = False) -> List[DropEntry]:',
        '        """Get all drops (main + secondary), optionally excluding Nothing."""',
        '        all_drops = self.drop_table + self.secondary_drop_table',
        '        if not include_nothing:',
        '            all_drops = [d for d in all_drops if d.item_name != "Nothing"]',
        '        return all_drops',
        '    ',
        '    def has_requirement(self, keyword: str) -> bool:',
        '        """Check if activity has a specific keyword requirement."""',
        '        keyword_counts = self.requirements.get("keyword_counts", {})',
        '        return keyword_counts.get(keyword.lower(), 0) > 0',
        '    ',
        '    def get_keyword_count(self, keyword: str) -> int:',
        '        """Get required count for a keyword (0 if not required)."""',
        '        keyword_counts = self.requirements.get("keyword_counts", {})',
        '        return keyword_counts.get(keyword.lower(), 0)',
        '    ',
        '    def meets_requirements(self, character) -> bool:',
        '        """Check if character meets all requirements for this activity."""',
        '        # Check skill requirements',
        '        for skill, level in self.skill_requirements.items():',
        '            char_level = getattr(character, skill.lower() + "_level", 0)',
        '            if char_level < level:',
        '                return False',
        '        ',
        '        # Check reputation requirements',
        '        for faction, amount in self.requirements.get("reputation", {}).items():',
        '            char_rep = character.reputation.get(faction, 0)',
        '            if char_rep < amount:',
        '                return False',
        '        ',
        '        return True',
        '    ',
        '    def is_unlocked(self, gearset_export: Optional[str] = None, gearset: Optional[\"Gearset\"] = None, character=None) -> bool:',
        '        """',
        '        Check if activity is unlocked for the character with the given gearset.',
        '        ',
        '        Args:',
        '            gearset_export: Optional gearset export string to check gear requirements',
        '            gearset: Optional Gearset object (more efficient than export string)',
        '            character: Optional character object (will auto-load if not provided)',
        '        ',
        '        Returns:',
        '            True if activity is unlocked, False otherwise',
        '        """',
        '        # Auto-load character if not provided',
        '        if character is None:',
        '            try:',
        '                from my_config import get_character',
        '                character = get_character()',
        '            except Exception:',
        '                return True  # If cant load character, assume unlocked',
        '        ',
        '        # Check skill level requirements',
        '        for skill, required_level in self.skill_requirements.items():',
        '            char_level = character.get_skill_level(skill.lower())',
        '            if char_level < required_level:',
        '                return False',
        '        ',
        '        # Check reputation requirements',
        '        for faction, required_amount in self.requirements.get("reputation", {}).items():',
        '            char_rep = character.reputation.get(faction, 0)',
        '            if char_rep < required_amount:',
        '                return False',
        '        ',
        '        # Check achievement points requirement',
        '        required_ap = self.requirements.get("achievement_points", 0)',
        '        if required_ap > 0:',
        '            try:',
        '                from util.walkscape_globals import ACHIEVEMENT_POINTS',
        '                if ACHIEVEMENT_POINTS < required_ap:',
        '                    return False',
        '            except Exception:',
        '                # If cant check AP, assume requirement is met',
        '                pass',
        '        ',
        '        # Check activity completion requirements',
        '        for activity_name, required_count in self.requirements.get("activity_completions", {}).items():',
        '            # This would need to be tracked in character export or my_config',
        '            # For now, assume these are met',
        '            pass',
        '        ',
        '        # Check gearset requirements if gearset provided',
        '        if gearset or gearset_export:',
        '            # Use Gearset object if provided, otherwise decode export string',
        '            if not gearset and gearset_export:',
        '                from util.gearset_utils import Gearset',
        '                gearset = Gearset(gearset_export)',
        '            ',
        '            try:',
        '                # Check all keyword requirements from keyword_counts',
        '                keyword_counts = self.requirements.get("keyword_counts", {})',
        '                for keyword, required_count in keyword_counts.items():',
        '                    if required_count <= 0:',
        '                        continue',
        '                    ',
        '                    # Count items with this keyword',
        '                    count = sum(',
        '                        1 for slot, item in gearset.get_all_items()',
        '                        if item and hasattr(item, "keywords") and',
        '                        any(keyword.lower() == kw.lower() for kw in item.keywords)',
        '                    )',
        '                    if count < required_count:',
        '                        return False',
        '            ',
        '            except Exception:',
        '                # If cant check gearset, assume requirements are met',
        '                pass',
        '        ',
        '        return True',
        '',
        '',
        'class Activity:',
        '    """Enum-like class for all activities."""',
        '',
        ])
        
        # Generate activity constants
        for activity in activities:
            if not activity:
                continue
            
            enum_name = activity['enum_name']
            
            # Build ActivityInfo constructor
            # Escape strings properly
            def escape_str(s):
                return s.replace("\\", "\\\\").replace("'", "\\'")
            
            # Locations - use Location enum objects directly
            from util.autogenerated.locations import Location
            location_objs = []
            for loc in activity['locations']:
                loc_enum = name_to_enum(loc)
                location_objs.append(f"Location.{loc_enum}")
            locations_str = ', '.join(location_objs)
            
            # Skill requirements
            skill_reqs = ', '.join([f"'{skill}': {level}" for skill, level in activity['skill_requirements'].items()])
            
            # Requirements - structured dict (only include if non-empty)
            reqs = activity['requirements']
            keyword_counts = reqs.get('keyword_counts', {})
            has_reqs = (keyword_counts or 
                       reqs.get('achievement_points', 0) > 0 or
                       reqs['reputation'] or reqs['activity_completions'])
            
            if has_reqs:
                # Format keyword_counts as dict
                kw_items = ', '.join([f"'{k}': {v}" for k, v in keyword_counts.items()])
                rep_str = ', '.join([f"'{f}': {a}" for f, a in reqs['reputation'].items()])
                comp_str = ', '.join([f"'{a}': {c}" for a, c in reqs['activity_completions'].items()])
                reqs_dict = f"{{'keyword_counts': {{{kw_items}}}, 'achievement_points': {reqs.get('achievement_points', 0)}, 'reputation': {{{rep_str}}}, 'activity_completions': {{{comp_str}}}}}"
            else:
                reqs_dict = "{}"
            
            # Primary skill
            primary_skill = activity.get('primary_skill')
            primary_skill_str = f"'{primary_skill}'" if primary_skill else 'None'
            
            lines.extend([
            f"    {enum_name} = ActivityInfo(",
            f"        name='{escape_str(activity['name'])}'," ,
            f"        primary_skill={primary_skill_str},",
            f"        locations=[{locations_str}],",
            f"        skill_requirements={{{skill_reqs}}},",
            f"        requirements={reqs_dict},",
            ])
            
            # Drop tables
            if activity['drop_table']:
                lines.append(f"        drop_table=[")
                for drop in activity['drop_table']:
                    item_name = escape_str(drop['item'])
                    item_ref = drop.get('item_object')
                    item_ref_str = f'"{item_ref}"' if item_ref else 'None'
                    
                    # Format quantity
                    qty = drop['quantity']
                    if qty['is_na']:
                        qty_str = "Quantity(is_na=True)"
                    elif qty['min_qty'] == qty['max_qty']:
                        qty_str = f"Quantity(min_qty={qty['min_qty']}, max_qty={qty['max_qty']})"
                    else:
                        qty_str = f"Quantity(min_qty={qty['min_qty']}, max_qty={qty['max_qty']})"
                    
                    # Format chance
                    chance = drop['chance']
                    chance_str = f", chance_percent={chance}" if chance is not None else ""
                    
                    lines.append(f"            DropEntry(item_name='{item_name}', item_ref={item_ref_str}, quantity={qty_str}{chance_str}),")
                lines.append(f"        ],")
            else:
                lines.append(f"        drop_table=[],")
            
            if activity['secondary_drop_table']:
                lines.append(f"        secondary_drop_table=[")
                for drop in activity['secondary_drop_table']:
                    item_name = escape_str(drop['item'])
                    item_ref = drop.get('item_object')
                    item_ref_str = f'"{item_ref}"' if item_ref else 'None'
                    
                    # Format quantity
                    qty = drop['quantity']
                    if qty['is_na']:
                        qty_str = "Quantity(is_na=True)"
                    elif qty['min_qty'] == qty['max_qty']:
                        qty_str = f"Quantity(min_qty={qty['min_qty']}, max_qty={qty['max_qty']})"
                    else:
                        qty_str = f"Quantity(min_qty={qty['min_qty']}, max_qty={qty['max_qty']})"
                    
                    # Format chance
                    chance = drop['chance']
                    chance_str = f", chance_percent={chance}" if chance is not None else ""
                    
                    lines.append(f"            DropEntry(item_name='{item_name}', item_ref={item_ref_str}, quantity={qty_str}{chance_str}),")
                lines.append(f"        ],")
            else:
                lines.append(f"        secondary_drop_table=[],")
            
            # Optional fields
            if activity['base_steps']:
                lines.append(f"        base_steps={activity['base_steps']},")
            if activity['base_xp']:
                lines.append(f"        base_xp={activity['base_xp']},")
            if activity.get('secondary_xp'):
                # Format as dict
                sec_xp_items = ', '.join([f"'{skill}': {xp}" for skill, xp in activity['secondary_xp'].items()])
                lines.append(f"        secondary_xp={{{sec_xp_items}}},")
            if activity['max_efficiency'] is not None:
                lines.append(f"        max_efficiency={activity['max_efficiency']},")
            if activity.get('faction_reputation_reward'):
                # Format as FactionReward object
                faction, amount = activity['faction_reputation_reward']
                lines.append(f"        faction_reputation_reward=FactionReward(name='{faction}', value={amount}),")
            if activity['description']:
                # Escape single quotes in description
                desc = activity['description'].replace("'", "\\'")
                lines.append(f"        description='{desc}',")
            if activity.get('requirements_raw'):
                req_raw = activity['requirements_raw'].replace("'", "\\'")
                lines.append(f"        requirements_raw='{req_raw}',")
            
            lines.append(f"    )")
            lines.append('')
        
        # Add lookup dictionaries
        lines.extend([
        '',
        '',
        '# Lookup dictionaries',
        'ACTIVITIES_BY_NAME: Dict[str, ActivityInfo] = {',
        ])
        for activity in activities:
            if activity:
                lines.append(f"    '{activity['name']}': Activity.{activity['enum_name']},")
        lines.extend([
        '}',
        '',
        'ACTIVITIES_BY_LOCATION: Dict[str, List[ActivityInfo]] = {}',
        'for activity in ACTIVITIES_BY_NAME.values():',
        '    for location in activity.locations:',
        '        if location not in ACTIVITIES_BY_LOCATION:',
        '            ACTIVITIES_BY_LOCATION[location] = []',
        '        ACTIVITIES_BY_LOCATION[location].append(activity)',
        '',
        'ACTIVITIES_BY_SKILL: Dict[str, List[ActivityInfo]] = {}',
        'for activity in ACTIVITIES_BY_NAME.values():',
        '    for skill in activity.skill_requirements.keys():',
        '        if skill not in ACTIVITIES_BY_SKILL:',
        '            ACTIVITIES_BY_SKILL[skill] = []',
        '        ACTIVITIES_BY_SKILL[skill].append(activity)',
        ])
        
        f.write('\n'.join(lines))
    
    print(f"\n✓ Generated {output_file} with {len(activities)} activities")


if __name__ == '__main__':
    print("=" * 60)
    print("Walkscape Activities Scraper")
    print("=" * 60)
    
    # Parse main activities list
    activities_list = parse_activities_list()
    print(f"\nFound {len(activities_list)} activities from main page")
    
    # Scan folder for additional activities
    folder_activities = scan_folder_for_activities()
    if folder_activities:
        print(f"Found {len(folder_activities)} additional activities from folder")
        
        # Merge, avoiding duplicates (folder activities take precedence)
        existing_names = {a['name'] for a in activities_list}
        for folder_activity in folder_activities:
            if folder_activity['name'] not in existing_names:
                activities_list.append(folder_activity)
                print(f"  Added new activity: {folder_activity['name']}")
            else:
                print(f"  Skipping duplicate: {folder_activity['name']} (already in main list)")
    
    print(f"\nTotal activities to process: {len(activities_list)}")
    
    # Parse each activity page
    activities_data = []
    for i, activity in enumerate(activities_list, 1):
        source = "folder" if activity.get('from_folder') else "wiki"
        print(f"\n[{i}/{len(activities_list)}] Processing: {activity['name']} (from {source})")
        activity_data = parse_activity_page(activity)
        if activity_data:
            activities_data.append(activity_data)
    
    print(f"\n{'=' * 60}")
    print(f"Successfully parsed {len(activities_data)} activities")
    print(f"{'=' * 60}")
    
    # Link items and locations
    print("\nLinking items and locations...")
    try:
        link_items_and_locations(activities_data)
    except Exception as e:
        print(f"Warning: Could not link items/locations: {e}")
        print("Continuing without object linking...")
    
    # Generate module
    generate_module(activities_data)
    
    # Report validation issues grouped by item
    print("\n" + "=" * 60)
    print("Missing Items Report (grouped by item)")
    print("=" * 60)
    
    # Group missing items by item name
    missing_items = {}
    for item_data in validator.items_with_issues:
        activity_name = item_data['name']
        for issue in item_data['reasons']:
            if 'not found:' in issue:
                # Extract item name from issue
                item_name = issue.split('not found: ')[-1]
                if item_name not in missing_items:
                    missing_items[item_name] = []
                if activity_name not in missing_items[item_name]:
                    missing_items[item_name].append(activity_name)
    
    if missing_items:
        # Sort by number of activities (most common first)
        sorted_items = sorted(missing_items.items(), key=lambda x: len(x[1]), reverse=True)
        
        print(f"\nFound {len(missing_items)} unique missing items")
        print()
        
        for item_name, activities in sorted_items:
            print(f"{item_name} ({len(activities)} activities):")
            for activity in sorted(activities)[:5]:  # Show first 5
                print(f"  - {activity}")
            if len(activities) > 5:
                print(f"  ... and {len(activities) - 5} more")
            print()
    else:
        print("\n✅ All items found!")
    
    print("✓ Scraping complete!")
