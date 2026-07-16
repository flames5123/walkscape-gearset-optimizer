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

# One-time activities: completed in a single action, so they never benefit
# from Double Action's long-run averaging. The optimizer neutralizes DA for
# these (steps metric == displayed steps). Source: movement + emergency
# activities (https://wiki.walkscape.app/wiki/Movement_Activities) plus the
# hidden single-completion activity "Repair the bank".
ONE_TIME_ACTIVITIES = {
    # Movement activities
    'Explore bog bottom',
    'Explore underwater cave',
    'Spring bat tracking',
    'Venture into the bog',
    'Venture into the hideout',
    'Venture into the woods',
    # Emergency (anti-soft-lock) movement activities
    'Emergency darkness escape (Swamp)',
    'Emergency desert escape',
    'Emergency swim escape',
    'Emergency swim escape (Swamp)',
    'Run for your life',
    # Hidden single-completion activities
    'Repair the bank',
}

# Single-completion activities: can only ever be performed ONCE per character.
# The game gates them via an `actionCompleted` history requirement (e.g.
# "Repair the bank" -> requirements.singulars.uniques.wraithwaterBankRebuild,
# opposite=true). These emit `single_completion=True` so the optimizer can drop
# them from recommendations once the player flags completion via a custom stat.
# This is a STRICT SUBSET of ONE_TIME_ACTIVITIES — movement activities are
# repeatable; only the hidden uniques are truly once-ever. Currently just
# "Repair the bank".
SINGLE_COMPLETION_ACTIVITIES = {
    'Repair the bank',
}

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
            'activity_completions': {},  # {activity_name: count}
            'item_requirements': [],  # List of specific item names required to be equipped
            'keyword_level_requirements': []  # [{keyword, skill, level}] - equipped tool of this keyword must itself require >= skill level
        },
        'drop_table': [],
        'secondary_drop_table': [],
        'base_steps': None,
        'base_xp': None,
        'secondary_xp': {},  # Dict of skill -> base_xp for secondary skills
        'max_efficiency': None,
        'faction_reputation_reward': None,  # Tuple of (faction_name, amount) or None
        'description': None,
        'input_items': [],  # List of {name, type, reference, quantity} consumed per action
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
    
    # Parse input items from Items Required section
    parse_input_items_section(soup, activity_data, activity_name)
    
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
                
                # Check for specific item requirements like "Have item Spectral saw equipped"
                # Pattern: "Have item X equipped" with link to /wiki/Special:MyLanguage/X (not a Keyword page)
                item_req_match = re.match(r'\s*Have\s+item\s+', li_text, re.IGNORECASE)
                if item_req_match:
                    # Find the item link (not a keyword link, not a file link)
                    item_links = li.find_all('a', href=True)
                    for item_link in item_links:
                        href = item_link.get('href', '')
                        if '/wiki/File:' in href or 'Keyword' in href:
                            continue
                        item_name = clean_text(item_link.get_text())
                        if item_name:
                            if item_name not in activity_data['requirements']['item_requirements']:
                                activity_data['requirements']['item_requirements'].append(item_name)
                                print(f"  Found item requirement: {item_name}")
                            break  # Only one item per "Have item X equipped" line
                    # Don't also parse this line as a keyword requirement
                    continue

                # Check for "tool keyword that itself requires a minimum skill level",
                # e.g. "Have <Pickaxe> equipped that requires at least <Mining> level [60]."
                # This is an Other Requirement gating on the equip-level (tier) of the
                # equipped tool, NOT the character's own skill level. We record it as a
                # structured keyword_level_requirement. We intentionally do NOT `continue`
                # here so the generic keyword logic below still records the keyword in
                # keyword_counts (the "have a pickaxe equipped" part), keeping all
                # existing tool-seeding/optimizer paths working; the level requirement
                # below is enforced as an additional, stricter gate.
                if re.search(r'equipped\s+that\s+requires\s+at\s+least', li_text, re.IGNORECASE):
                    tool_keyword = None
                    for kw_link in li.find_all('a', href=re.compile(r'Keyword', re.I)):
                        if '/wiki/File:' in kw_link.get('href', ''):
                            continue
                        tool_keyword = clean_text(kw_link.get_text())
                        if tool_keyword:
                            break
                    # Skill is the first non-File, non-Keyword wiki link (e.g. Mining)
                    tool_skill = None
                    for link in li.find_all('a', href=True):
                        href = link.get('href', '')
                        if '/wiki/File:' in href or 'Keyword' in href:
                            continue
                        link_text = clean_text(link.get_text())
                        if link_text:
                            tool_skill = link_text
                            break
                    level_match = re.search(r'level\s*\[?\s*(\d+)', li_text, re.IGNORECASE)
                    tool_level = int(level_match.group(1)) if level_match else None
                    if tool_keyword and tool_skill and tool_level:
                        entry = {
                            'keyword': tool_keyword.lower(),
                            'skill': tool_skill,
                            'level': tool_level,
                        }
                        klr = activity_data['requirements']['keyword_level_requirements']
                        if entry not in klr:
                            klr.append(entry)
                            print(f"  Found tool keyword level requirement: {tool_keyword} requiring {tool_skill} level {tool_level}")

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
        # Pattern 1: "Have [40] Erdwise faction reputation"
        rep_match = re.search(r'Have\s+\[(\d+)\]\s+([^\s]+(?:\s+[^\s]+)?)\s+faction\s+reputation', text, re.IGNORECASE)
        if rep_match:
            amount = int(rep_match.group(1))
            faction = clean_text(rep_match.group(2))
            activity_data['requirements']['reputation'][faction] = amount
            print(f"  Found reputation requirement: {faction} = {amount}")
        else:
            # Pattern 2: "40 reputation with Erdwise" (legacy format)
            rep_match = re.search(r'(\d+)\s+reputation\s+with\s+([^,\.]+)', text, re.IGNORECASE)
            if rep_match:
                amount = int(rep_match.group(1))
                faction = clean_text(rep_match.group(2))
                activity_data['requirements']['reputation'][faction] = amount
                print(f"  Found reputation requirement: {faction} = {amount}")
        
        # Activity completion requirements
        completion_match = re.search(r'completed?\s+(?:the\s+)?(.+?)\s+activity\s+\((\d+)\)\s+times', text, re.IGNORECASE)
        if completion_match:
            activity_name = clean_text(completion_match.group(1))
            count = int(completion_match.group(2))
            activity_data['requirements']['activity_completions'][activity_name] = count
        
        next_elem = next_elem.find_next_sibling()


def parse_input_items_section(soup, activity_data, activity_name):
    """Parse 'Item(s) Required' section for items consumed per action.
    
    Wiki format (keyword input):
    <h1 id="Item_Required">Item Required</h1>
    <p>This activity requires the following item be supplied for each action:</p>
    <ul>
        <li>Needs <b>1x</b> [skill icon] [skill] level <b>20</b> [keyword icon] [keyword link]</li>
    </ul>
    
    Wiki format (material input):
    <h1 id="Items_Required">Items Required</h1>
    <p>This activity requires the following items be supplied for each action:</p>
    <ul>
        <li>50x [icon] [link to Ectoplasm]</li>
    </ul>

    Optional inputs use "may use ... if supplied" phrasing instead of "requires ... be supplied".
    """
    from util.misc_utils import build_all_item_lookups, resolve_item_reference
    
    content = soup.find('div', class_='mw-parser-output')
    if not content:
        return
    
    # Check both singular and plural headings
    heading = content.find('h1', id='Items_Required') or content.find('h1', id='Item_Required')
    if not heading:
        return
    
    print(f"  Found '{heading.get_text().strip()}' section")

    # Detect optional vs required from the <p> between heading and <ul>
    is_optional = False
    probe = heading.parent.find_next_sibling()
    while probe:
        if probe.name and probe.name.startswith('h'):
            break
        if probe.name == 'p':
            phrase = probe.get_text(separator=' ', strip=True).lower()
            if 'may use' in phrase:
                is_optional = True
                print(f"  → input marked OPTIONAL")
            break
        if probe.name == 'ul':
            break
        probe = probe.find_next_sibling()

    activity_data['input_optional'] = is_optional

    # Find the <ul> after the heading
    next_elem = heading.parent.find_next_sibling()
    lookups = build_all_item_lookups()
    
    while next_elem:
        if next_elem.name and next_elem.name.startswith('h'):
            break  # Hit next section
        
        if next_elem.name == 'ul':
            for li in next_elem.find_all('li'):
                li_text = li.get_text(separator=' ', strip=True)
                
                # Check if this is a keyword input: link href contains "Keyword" (but not File:)
                keyword_link = None
                for link in li.find_all('a', href=re.compile(r'Keyword')):
                    href = link.get('href', '')
                    if 'File:' not in href:
                        keyword_link = link
                        break
                
                if keyword_link:
                    # Keyword-based input (e.g., "Needs 1x Hunting level 20 Arrows")
                    keyword_name = keyword_link.get_text(strip=True)
                    
                    # Parse quantity: "Needs 1x" or "Needs 2x"
                    qty_match = re.search(r'(\d+)\s*x', li_text)
                    quantity = int(qty_match.group(1)) if qty_match else 1
                    
                    # Parse optional level requirement: "level 20" or "level 30"
                    level_match = re.search(r'level\s+(\d+)', li_text)
                    level = int(level_match.group(1)) if level_match else None
                    
                    # Normalize keyword reference
                    keyword_ref = keyword_name.lower().replace(' ', '_')
                    
                    input_item = {
                        'name': keyword_name,
                        'type': 'keyword',
                        'reference': keyword_ref,
                        'quantity': quantity,
                    }
                    if level:
                        input_item['level'] = level
                    
                    if 'input_items' not in activity_data:
                        activity_data['input_items'] = []
                    activity_data['input_items'].append(input_item)
                    level_str = f" (level {level})" if level else ""
                    print(f"  Found input item: {quantity}x {keyword_name} (keyword: {keyword_ref}{level_str})")
                else:
                    # Material-based input (e.g., "50x Ectoplasm")
                    qty_match = re.match(r'(\d+)\s*x?\s*', li_text)
                    quantity = int(qty_match.group(1)) if qty_match else 1
                    
                    # Get item name from the link (skip icon links)
                    item_link = None
                    for link in li.find_all('a', href=re.compile(r'/wiki/')):
                        if 'File:' not in link.get('href', ''):
                            item_link = link
                            break
                    
                    if not item_link:
                        continue
                    
                    item_name = item_link.get_text(strip=True)
                    if not item_name:
                        continue
                    
                    # Resolve to a module reference
                    item_ref = resolve_item_reference(item_name, lookups)
                    item_type = 'material'
                    if item_ref:
                        if item_ref.startswith('Material.'):
                            item_type = 'material'
                        elif item_ref.startswith('Item.'):
                            item_type = 'item'
                        elif item_ref.startswith('Consumable.'):
                            item_type = 'consumable'
                    else:
                        item_ref = item_name
                        validator.add_item_issue(activity_name, [f"Could not resolve input item: {item_name}"])
                    
                    input_item = {
                        'name': item_name,
                        'type': item_type,
                        'reference': item_ref,
                        'quantity': quantity,
                    }
                    
                    if 'input_items' not in activity_data:
                        activity_data['input_items'] = []
                    activity_data['input_items'].append(input_item)
                    print(f"  Found input item: {quantity}x {item_name} ({item_type}: {item_ref})")
        
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
        is_bonus = 'bonus' in caption_text.lower()
        
        # Detect if this is a level-based table by checking headers
        header_row = table.find('tr')
        is_level_based = False
        is_percentage_summary = False
        if header_row:
            header_texts = [th.get_text().replace('\n', ' ').strip().lower() for th in header_row.find_all('th')]
            
            # Check if this is a percentage summary table (should be skipped)
            # These tables show calculated drop rates like "0.411%" and have headers like:
            # "Item", "Actual Drop Rate", "Rarity", "Drop Rate", etc.
            # They typically have very small percentages (< 1%) in the chance column
            has_actual_drop_rate = any('actual' in h and 'drop' in h for h in header_texts)
            has_rarity = any('rarity' in h for h in header_texts)
            has_drop_rate_only = any(h == 'drop rate' or h == 'droprate' for h in header_texts)
            
            # If it has these summary-style headers, it's a calculated table - skip it
            if has_actual_drop_rate or has_rarity or has_drop_rate_only:
                is_percentage_summary = True
                print(f"  Skipping percentage summary table (headers: {', '.join(header_texts[:5])})")
                continue
            
            # Check for level-based columns
            has_initial = any('initial' in h and 'appearance' in h for h in header_texts)
            has_max_level = any('max' in h and 'level' in h for h in header_texts)
            has_final = any('final' in h and 'chance' in h for h in header_texts)
            is_level_based = has_initial and has_max_level and has_final
            
            if is_level_based:
                print(f"  Found level-based drop table")
        
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
            
            # Skip "Nothing" rows from bonus drop tables — they represent the
            # bonus table's own no-drop chance, not a real drop entry.  The main
            # table already has its own "Nothing" row.
            if is_bonus and item_name.lower() == 'nothing':
                continue
            
            # Skip rows where the item name is a percentage (like "0.411%")
            # These are from calculated drop rate tables that should be ignored
            if re.match(r'^\d+\.\d+%$', item_name):
                continue
            
            # Skip skill/XP rows
            skill_names = ['Agility', 'Carpentry', 'Cooking', 'Crafting', 'Fishing', 
                          'Foraging', 'Mining', 'Smithing', 'Trinketry', 'Woodcutting']
            if item_name in skill_names:
                continue
            
            # Skip faction reputation entries
            if item_name in faction_names:
                continue
            
            drop_entry = {'item': item_name}
            
            if is_level_based:
                # Level-based table columns (based on 13-col structure):
                # Col 0=icon, 1=name, 2=quantity, 3=initial_appearance, 4=max_chance_level, 6=initial_chance, 8=final_chance
                quantity_text = clean_text(cols[2].get_text()) if len(cols) > 2 else 'N/A'
                drop_entry['quantity'] = parse_quantity(quantity_text)
                
                # Parse initial level (col 3) - format: "lvl. X" or "N/A"
                initial_level = None
                if len(cols) > 3:
                    initial_text = clean_text(cols[3].get_text())
                    if initial_text and initial_text.upper() != 'N/A':
                        level_match = re.search(r'(\d+)', initial_text)
                        if level_match:
                            initial_level = int(level_match.group(1))
                
                # Parse max chance level (col 4) - format: "lvl. X-Y" or "lvl. X" or "N/A"
                max_chance_level = None
                if len(cols) > 4:
                    max_text = clean_text(cols[4].get_text())
                    if max_text and max_text.upper() != 'N/A':
                        # Extract the STARTING number from "lvl. X-Y" format (item is at max for entire range)
                        range_match = re.search(r'(\d+)-(\d+)', max_text)
                        if range_match:
                            max_chance_level = int(range_match.group(1))  # Use the starting level
                        else:
                            # Try single number
                            level_match = re.search(r'(\d+)', max_text)
                            if level_match:
                                max_chance_level = int(level_match.group(1))
                
                # Parse final chance (col 8)
                final_chance = None
                if len(cols) > 8:
                    final_text = clean_text(cols[8].get_text())
                    final_chance = parse_chance(final_text)
                
                # Parse bonus XP (col 5)
                bonus_xp = None
                if len(cols) > 5:
                    bonus_xp_text = clean_text(cols[5].get_text())
                    if bonus_xp_text and bonus_xp_text.upper() != 'N/A':
                        try:
                            bonus_xp = int(bonus_xp_text)
                        except:
                            bonus_xp = None
                
                # Store bonus XP if present
                if bonus_xp is not None:
                    drop_entry['bonus_xp'] = bonus_xp
                
                # Only add level-based parameters if all three are present
                if initial_level is not None and max_chance_level is not None and final_chance is not None:
                    drop_entry['initial_level'] = initial_level
                    drop_entry['max_chance_level'] = max_chance_level
                    drop_entry['final_chance'] = final_chance
                    drop_entry['chance'] = None  # Calculated dynamically
                else:
                    # Static drop (like "Nothing") - use final_chance as static value
                    drop_entry['chance'] = final_chance if final_chance is not None else 10.0
            else:
                # Regular table parsing
                if is_secondary and len(cols) >= 4:
                    # Secondary: col 1=name, col 2=type, col 3=quantity, col 4=chance
                    # Note column is typically the last column (col 7 in 8-col tables)
                    quantity_text = clean_text(cols[3].get_text())
                    chance_text = clean_text(cols[4].get_text()) if len(cols) > 4 else None
                    
                    # Check for "Does X rolls" in the Note column (last column)
                    note_text = clean_text(cols[-1].get_text()) if len(cols) > 5 else ''
                    rolls_match = re.search(r'[Dd]oes\s+(\d+)\s+rolls?', note_text)
                    if rolls_match:
                        drop_entry['multi_roll_count'] = int(rolls_match.group(1))
                        print(f"    Found multi-roll drop: {item_name} ({drop_entry['multi_roll_count']} rolls)")
                else:
                    # Main: col 1=name, col 2=quantity, col 3=chance
                    quantity_text = clean_text(cols[2].get_text())
                    chance_text = clean_text(cols[3].get_text()) if len(cols) > 3 else None
                
                drop_entry['quantity'] = parse_quantity(quantity_text)
                drop_entry['chance'] = parse_chance(chance_text)
            
            if is_secondary:
                activity_data['secondary_drop_table'].append(drop_entry)
            else:
                # Bonus drops merge into the main drop table (Nothing already
                # filtered above), so they appear alongside the other main drops.
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
            if item_name == 'Nothing':
                continue  # Skip Nothing
            
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
            if item_name == 'Nothing':
                continue
            
            # Use the shared resolve function
            item_ref = resolve_item_reference(item_name, lookups)
            
            if item_ref:
                drop['item_object'] = item_ref
            else:
                validator.add_item_issue(activity['name'], [f"Secondary drop item not found: {item_name}"])
                print(f"  ⚠ {activity['name']}: Secondary drop item not found: {item_name}")
                drop['item_object'] = None


def _format_drop_entry(drop, escape_str):
    """Format a single drop dict as a DropEntry(...) constructor string."""
    item_name = escape_str(drop['item'])
    item_ref = drop.get('item_object')
    item_ref_str = f'"{item_ref}"' if item_ref else 'None'
    
    # Format quantity
    qty = drop['quantity']
    if qty['is_na']:
        qty_str = "Quantity(is_na=True)"
    else:
        qty_str = f"Quantity(min_qty={qty['min_qty']}, max_qty={qty['max_qty']})"
    
    # Build optional params
    parts = [f"item_name='{item_name}'", f"item_ref={item_ref_str}", f"quantity={qty_str}"]
    
    # Raw API fields (preferred over chance_percent)
    if 'no_drop_chance' in drop and drop['no_drop_chance'] is not None:
        parts.append(f"no_drop_chance={drop['no_drop_chance']}")
        parts.append(f"row_weight={drop['row_weight']}")
        parts.append(f"table_weight={drop['table_weight']}")
    elif drop.get('chance') is not None:
        # Legacy: direct chance_percent
        parts.append(f"chance_percent={drop['chance']}")
    
    if 'bonus_xp' in drop and drop.get('bonus_xp') is not None:
        parts.append(f"bonus_xp={drop['bonus_xp']}")
    
    # Level-based parameters
    if 'initial_level' in drop and 'max_chance_level' in drop and 'final_chance' in drop:
        parts.append(f"initial_level={drop['initial_level']}")
        parts.append(f"max_chance_level={drop['max_chance_level']}")
        parts.append(f"final_chance={drop['final_chance']}")
    
    # Multi-roll
    if 'multi_roll_count' in drop:
        parts.append(f"multi_roll_count={drop['multi_roll_count']}")
    
    return f"DropEntry({', '.join(parts)})"


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
        'class InputItem:',
        '    """Represents an item consumed per activity action."""',
        '    name: str        # Display name: "Ectoplasm"',
        '    type: str        # "material" or "keyword"',
        '    reference: str   # "Material.ECTOPLASM" or keyword like "arrow"',
        '    quantity: int = 1  # How many consumed per action',
        '    level: Optional[int] = None  # Minimum skill level required on the input item (e.g., lvl 20 arrows)',
        '    optional: bool = False  # True if "may use" (optional), False if "requires" (required)',
        '    ',
        '    def __str__(self) -> str:',
        '        return f"{self.quantity}x {self.name}"',
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
        '    input_items: List[Any] = field(default_factory=list)  # List of InputItem consumed per action',
        '    ',
        '    def get_expected_drop_rate(self, stats: Dict[str, float], location: Optional[str] = None, ',
        '                               target_item = None, verbose: bool = False, character=None, consumable=None, input_item=None,',
        '                               include_collectibles_from_character: bool = True):',
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
        '            input_item: Optional stat-bearing item consumed per action (like arrows)',
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
        '        # Skipped when caller pre-merged collectibles into `stats` to avoid double-count.',
        '        collectible_stats = {}',
        '        if include_collectibles_from_character and character and self.primary_skill:',
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
        '        # Calculate input item stats if provided (e.g., arrows with stats)',
        '        input_item_stats = {}',
        '        if input_item and self.primary_skill:',
        '            try:',
        '                if hasattr(input_item, "get_stats_for_skill"):',
        '                    ii_stats = input_item.get_stats_for_skill(self.primary_skill, location=location)',
        '                    for stat_name, stat_value in ii_stats.items():',
        '                        input_item_stats[stat_name] = input_item_stats.get(stat_name, 0.0) + stat_value',
        '            except:',
        '                pass',
        '        ',
        '        # Extract stats (already in decimal form from gearset_utils) and add all bonuses',
        '        we = stats.get("work_efficiency", 0.0) + level_bonus_we + collectible_stats.get("work_efficiency", 0.0) + consumable_stats.get("work_efficiency", 0.0) + input_item_stats.get("work_efficiency", 0.0)',
        '        da = stats.get("double_action", 0.0) + collectible_stats.get("double_action", 0.0) + consumable_stats.get("double_action", 0.0) + input_item_stats.get("double_action", 0.0)',
        '        dr = stats.get("double_rewards", 0.0) + collectible_stats.get("double_rewards", 0.0) + consumable_stats.get("double_rewards", 0.0) + input_item_stats.get("double_rewards", 0.0)',
        '        flat = stats.get("steps_add", 0) + int(collectible_stats.get("steps_add", 0.0)) + int(consumable_stats.get("steps_add", 0.0)) + int(input_item_stats.get("steps_add", 0.0))',
        '        pct = stats.get("steps_percent", 0.0) + collectible_stats.get("steps_percent", 0.0) + consumable_stats.get("steps_percent", 0.0) + input_item_stats.get("steps_percent", 0.0)',
        '        bonus_xp_add = stats.get("bonus_xp_add", 0.0) + collectible_stats.get("bonus_xp_add", 0.0) + consumable_stats.get("bonus_xp_add", 0.0) + input_item_stats.get("bonus_xp_add", 0.0)',
        '        bonus_xp_pct = stats.get("bonus_xp_percent", 0.0) + collectible_stats.get("bonus_xp_percent", 0.0) + consumable_stats.get("bonus_xp_percent", 0.0) + input_item_stats.get("bonus_xp_percent", 0.0)',
        '        ',
        '        # Find stats (affect drop chances)',
        '        find_collectibles = stats.get("find_collectibles", 0.0) + collectible_stats.get("find_collectibles", 0.0) + consumable_stats.get("find_collectibles", 0.0) + input_item_stats.get("find_collectibles", 0.0)',
        '        find_gems = stats.get("find_gems", 0.0) + collectible_stats.get("find_gems", 0.0) + consumable_stats.get("find_gems", 0.0) + input_item_stats.get("find_gems", 0.0)',
        '        find_bird_nests = stats.get("find_bird_nests", 0.0) + collectible_stats.get("find_bird_nests", 0.0) + consumable_stats.get("find_bird_nests", 0.0) + input_item_stats.get("find_bird_nests", 0.0)',
        '        chest_finding = stats.get("chest_finding", 0.0) + collectible_stats.get("chest_finding", 0.0) + consumable_stats.get("chest_finding", 0.0) + input_item_stats.get("chest_finding", 0.0)',
        '        fine_material_finding = stats.get("fine_material_finding", 0.0) + collectible_stats.get("fine_material_finding", 0.0) + consumable_stats.get("fine_material_finding", 0.0) + input_item_stats.get("fine_material_finding", 0.0)',
        '        fine_chance_multiplier = 1.0 + fine_material_finding',
        '        ',
        '        # Calculate steps per action — match the UI display formula in',
        '        # ui/static/js/components/activity-info-section.js, which does',
        '        # SINGLE ceil at the END of the chain (per KamiTzayig reference).',
        '        '
        '        # Step 1: Calculate total efficiency',
        '        total_efficiency = 1.0 + we',
        '        ',
        '        # Step 2: Calculate base steps with efficiency (NO ceil)',
        '        steps_with_efficiency = self.base_steps / total_efficiency',
        '        ',
        '        # Step 3: Calculate min_steps (NO ceil)',
        '        min_steps = self.base_steps / (1 + self.max_efficiency)',
        '        ',
        '        # Step 4: Take max of steps_with_efficiency and min_steps',
        '        steps_after_min = max(steps_with_efficiency, min_steps)',
        '        ',
        '        # Step 5: Apply percentage reduction (NO ceil)',
        '        steps_with_pct = steps_after_min * (1 + pct)',
        '        ',
        '        # Step 6: Apply flat reduction (NO ceil)',
        '        steps_with_flat = steps_with_pct + flat',
        '        ',
        '        # Step 7: SINGLE ceil at the end. Floor at 10 steps minimum.',
        '        steps_per_single_action = max(math.ceil(steps_with_flat), 10)',
        '        ',
        '        # Apply double action (reduces steps per paid action, no ceil for accurate XP/step)',
        '        expected_paid_actions = 1.0 / (1 + da)',
        '        expected_steps_per_action = expected_paid_actions * steps_per_single_action',
        '        ',
        '        # Calculate effective rewards with DA and DR interaction',
        '        # When DA triggers, you get another action that can also proc DR',
        '        rewards_per_completion = (1 + dr) * (1 + da)',
        '        steps_per_reward_roll = steps_per_single_action / rewards_per_completion',
        '        ',
        '        # XP Calculation',
        '        # Match UI: ui/static/js/components/activity-info-section.js does',
        '        # (base * (1+fineBonus) + add) * (1+percent). Activities do not',
        '        # consume Fine materials, so fineBonus is 0 here.',
        '        primary_xp_per_action = (self.base_xp + bonus_xp_add) * (1.0 + bonus_xp_pct)',
        '        primary_xp_per_step = primary_xp_per_action / expected_steps_per_action',
        '        ',
        '        # Calculate drop rates',
        '        results = {}',
        '        all_drops = self.drop_table + self.secondary_drop_table',
        '        ',
        '        # Add equipment item finding drops',
        '        # Check for ItemFindingCategory.* stats and expand them',
        '        equipment_drops = []',
        '        for stat_name, stat_value in stats.items():',
        '            if stat_name.startswith("ItemFindingCategory."):',
        '                # Extract category constant name',
        '                category_const = stat_name.split(".", 1)[1]',
        '                try:',
        '                    from util.autogenerated.item_finding import ItemFindingCategory',
        '                    if hasattr(ItemFindingCategory, category_const):',
        '                        category = getattr(ItemFindingCategory, category_const)',
        '                        # stat_value is already in percentage form (1.5 = 1.5%), not decimal',
        '                        expanded_drops = category.expand_with_chance(stat_value)',
        '                        equipment_drops.extend(expanded_drops)',
        '                except ImportError:',
        '                    pass',
        '        ',
        '        # Also check collectible and consumable stats for ItemFindingCategory',
        '        for stat_name, stat_value in collectible_stats.items():',
        '            if stat_name.startswith("ItemFindingCategory."):',
        '                category_const = stat_name.split(".", 1)[1]',
        '                try:',
        '                    from util.autogenerated.item_finding import ItemFindingCategory',
        '                    if hasattr(ItemFindingCategory, category_const):',
        '                        category = getattr(ItemFindingCategory, category_const)',
        '                        expanded_drops = category.expand_with_chance(stat_value * 100)  # Collectibles are in decimal',
        '                        equipment_drops.extend(expanded_drops)',
        '                except ImportError:',
        '                    pass',
        '        ',
        '        for stat_name, stat_value in consumable_stats.items():',
        '            if stat_name.startswith("ItemFindingCategory."):',
        '                category_const = stat_name.split(".", 1)[1]',
        '                try:',
        '                    from util.autogenerated.item_finding import ItemFindingCategory',
        '                    if hasattr(ItemFindingCategory, category_const):',
        '                        category = getattr(ItemFindingCategory, category_const)',
        '                        expanded_drops = category.expand_with_chance(stat_value * 100)  # Consumables are in decimal',
        '                        equipment_drops.extend(expanded_drops)',
        '                except ImportError:',
        '                    pass',
        '        ',
        '        # Combine equipment drops with activity drops',
        '        # Equipment drops are tracked separately so they don\'t get finding bonuses',
        '        # applied in the main loop (their chance already reflects the stat value).',
        '        equipment_drop_refs = {id(d) for d in equipment_drops}',
        '        all_drops = all_drops + equipment_drops',
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
        '        total_xp_per_step = primary_xp_per_step',
        '        total_xp_for_action = primary_xp_per_action',
        '        ',
        '        if self.secondary_xp:',
        '            for skill, xp in self.secondary_xp.items():',
        '                xp_per_action = xp * (1 + bonus_xp_pct) + bonus_xp_add',
        '                xp_per_step = xp_per_action / expected_steps_per_action',
        '                secondary_xp_per_action[skill] = xp_per_action',
        '                secondary_xp_per_step[skill] = xp_per_step',
        '                total_xp_per_step += xp_per_step',
        '                total_xp_for_action += xp_per_action',
        '        ',
        '        details["secondary_xp_per_step"] = secondary_xp_per_step',
        '        details["secondary_xp_per_action"] = secondary_xp_per_action',
        '        details["total_xp_per_step"] = total_xp_per_step',
        '        details["total_xp_for_action"] = total_xp_for_action',
        '        ',
        '        # Add all collectible stats to details (with "collectible_" prefix)',
        '        for stat_name, stat_value in collectible_stats.items():',
        '            details[f"collectible_{stat_name}_pct"] = stat_value * 100',
        '        ',
        '        # Track aggregate steps for finding metrics (average across all drops of each type)',
        '        total_steps_chest = 0.0',
        '        count_chest = 0',
        '        total_steps_fine = 0.0',
        '        count_fine = 0',
        '        total_steps_collectible = 0.0',
        '        count_collectible = 0',
        '        ',
        '        # For level-based drops, calculate total weight at current level',
        '        has_level_based = any(drop.is_level_based for drop in all_drops)',
        '        total_weight = 0.0',
        '        non_level_weighted_percent = 10.0',
        '        if has_level_based:',
        '            # Calculate total weight from level-based drops in main table only',
        '            for drop in self.drop_table:',
        '                if drop.is_level_based:',
        '                    total_weight += drop.calculate_weight(skill_level)',
        '            ',
        '            # Calculate non_level_weighted_percent: 100% - sum of all final_chance values',
        '            total_final_chance = sum(drop.final_chance for drop in self.drop_table if drop.final_chance)',
        '            non_level_weighted_percent = 100.0 - total_final_chance',
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
        '            # Get drop chance (static or level-based)',
        '            if drop.is_level_based:',
        '                drop_chance_percent = drop.get_chance_at_level(skill_level, total_weight, non_level_weighted_percent)',
        '            else:',
        '                drop_chance_percent = drop.chance_percent',
        '            ',
        '            # Calculate steps per item',
        '            if drop_chance_percent and drop_chance_percent > 0:',
        '                # Apply find bonuses based on item type',
        '                # Equipment drops (from ItemFindingCategory.* stats) do NOT get finding',
        '                # bonuses applied — their chance already reflects the stat value directly.',
        '                base_chance = drop_chance_percent / 100.0',
        '                find_bonus = 0.0',
        '                drop_category = None  # Track category for aggregate metrics',
        '                ',
        '                is_equipment_drop = id(drop) in equipment_drop_refs',
        '                ',
        '                if not is_equipment_drop:',
        '                    # Check actual item type if item_object is available',
        '                    try:',
        '                        if drop.item_object:',
        '                            from util.autogenerated.collectibles import CollectibleInstance',
        '                            from util.autogenerated.containers import Container',
        '                            # Check if item is a Collectible',
        '                            if isinstance(drop.item_object, CollectibleInstance):',
        '                                find_bonus = find_collectibles',
        '                                drop_category = "collectible"',
        '                            # Check if item is a Container (chest) - exclude bird nests',
        '                            elif drop.item_ref and "Container." in drop.item_ref and "BIRD_NEST" not in drop.item_ref:',
        '                                find_bonus = chest_finding',
        '                                drop_category = "chest"',
        '                            # Check if item has gem or rough gem keyword',
        '                            elif hasattr(drop.item_object, "keywords") and any(kw.lower() in ["gem", "rough gem"] for kw in drop.item_object.keywords):',
        '                                find_bonus = find_gems',
        '                            # Check if item is a bird nest',
        '                            elif "bird nest" in drop.item_name.lower() or "nest" in drop.item_name.lower():',
        '                                find_bonus = find_bird_nests',
        '                    except:',
        '                        # Fallback to string-based detection if item_object check fails',
        '                        if drop.item_ref and "Collectible." in drop.item_ref:',
        '                            find_bonus = find_collectibles',
        '                            drop_category = "collectible"',
        '                        elif drop.item_ref and "Container." in drop.item_ref and "BIRD_NEST" not in drop.item_ref:',
        '                            find_bonus = chest_finding',
        '                            drop_category = "chest"',
        '                        elif "bird nest" in drop.item_name.lower() or "nest" in drop.item_name.lower():',
        '                            find_bonus = find_bird_nests',
        '                ',
        '                # Calculate steps per item',
        '                if drop.is_multi_roll:',
        '                    # Multi-roll drop (e.g., "Does 100 rolls")',
        '                    # Each completion does N rolls, each with per-roll base chance',
        '                    # DA and DR are already factored into steps_per_reward_roll',
        '                    # CF (find_bonus) boosts the per-roll chance',
        '                    per_roll_chance = drop.base_roll_chance  # chance_percent / 100 (per-roll, from row_weight/table_weight)',
        '                    boosted_chance = per_roll_chance * (1 + find_bonus)',
        '                    # Formula: steps_per_item = steps_per_reward_roll / (N * boosted_chance * avg_qty)',
        '                    denominator = drop.multi_roll_count * boosted_chance * avg_qty',
        '                    if denominator > 0:',
        '                        steps_per_item = steps_per_reward_roll / denominator',
        '                    else:',
        '                        steps_per_item = float("inf")',
        '                else:',
        '                    # Normal drop: steps_per_item = (1/drop_rate) * steps_per_single_action / ((1 + find_bonus) * rewards_per_completion * avg_qty)',
        '                    drop_rate_inverse = 1.0 / base_chance',
        '                    steps_per_item = drop_rate_inverse * steps_per_single_action / ((1 + find_bonus) * rewards_per_completion * avg_qty)',
        '                ',
        '                # Add bonus XP from this drop to primary XP per step',
        '                if drop.bonus_xp and drop.bonus_xp > 0:',
        '                    bonus_xp_from_drop = (((drop.bonus_xp + bonus_xp_add) * (1.0 + bonus_xp_pct)) / expected_steps_per_action) * (drop_chance_percent / 100.0)',
        '                    primary_xp_per_step += bonus_xp_from_drop',
        '                ',
        '                # Add regular material to results (combine if multiple sources)',
        '                if drop.item_name in results and results[drop.item_name] != float("inf"):',
        '                    # Same item from multiple sources — combine drop rates',
        '                    # 1/combined_steps = 1/existing_steps + 1/new_steps',
        '                    existing = results[drop.item_name]',
        '                    if steps_per_item != float("inf"):',
        '                        results[drop.item_name] = (existing * steps_per_item) / (existing + steps_per_item)',
        '                    # else: keep existing (new source is inf, contributes nothing)',
        '                else:',
        '                    results[drop.item_name] = steps_per_item',
        '                ',
        '                # Track steps for aggregate finding metrics',
        '                if drop_category == "chest":',
        '                    total_steps_chest += steps_per_item',
        '                    count_chest += 1',
        '                elif drop_category == "collectible":',
        '                    total_steps_collectible += steps_per_item',
        '                    count_collectible += 1',
        '                ',
        '                # Check if this item has a fine counterpart - materials and consumables',
        '                has_fine = False',
        '                try:',
        '                    if drop.item_object and hasattr(drop.item_object, "has_fine_material"):',
        '                        has_fine = drop.item_object.has_fine_material()',
        '                    elif drop.item_ref and drop.item_ref.startswith("Consumable."):',
        '                        from util.autogenerated.consumables import Consumable as _Cons',
        '                        _cname = drop.item_ref.replace("Consumable.", "") + "_FINE"',
        '                        has_fine = hasattr(_Cons, _cname)',
        '                except:',
        '                    pass',
        '                ',
        '                if has_fine:',
        '                    # Fine materials have 1% base chance when finding regular material.',
        '                    # Fine Material Finding bonus applies multiplicatively.',
        '                    # Use the outer fine_chance_multiplier (computed at top of function)',
        '                    # which sums FMF from all sources (stats, collectibles, consumable, input_item).',
        '                    base_fine_chance = 0.01',
        '                    fine_chance = base_fine_chance * fine_chance_multiplier',
        '                    ',
        '                    # Steps per fine = steps per regular / fine_chance',
        '                    steps_per_fine = steps_per_item / fine_chance',
        '                    ',
        '                    # Add fine material with " (Fine)" suffix (combine if multiple sources)',
        '                    fine_key = f"{drop.item_name} (Fine)"',
        '                    if fine_key in results and results[fine_key] != float("inf"):',
        '                        existing_fine = results[fine_key]',
        '                        if steps_per_fine != float("inf"):',
        '                            results[fine_key] = (existing_fine * steps_per_fine) / (existing_fine + steps_per_fine)',
        '                    else:',
        '                        results[fine_key] = steps_per_fine',
        '                    total_steps_fine += steps_per_fine',
        '                    count_fine += 1',
        '        ',
        '        # Update details with final primary_xp_per_step (after bonus XP additions)',
        '        details["primary_xp_per_step"] = primary_xp_per_step',
        '        ',
        '        # Add aggregate finding metrics (average steps per chest/fine/collectible)',
        '        # Use inf when activity has no drops of that type (ignored as tiebreaker)',
        '        details["steps_for_chest"] = (total_steps_chest / count_chest) if count_chest > 0 else float("inf")',
        '        details["steps_for_fine_material"] = (total_steps_fine / count_fine) if count_fine > 0 else float("inf")',
        '        details["steps_for_collectible"] = (total_steps_collectible / count_collectible) if count_collectible > 0 else float("inf")',
        '        details["chest_finding_pct"] = chest_finding * 100',
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
        '        # Check reputation requirements (case-insensitive: requirement keys are',
        '        # capitalized like "Syrenthia" but character reputation is keyed lowercase)',
        '        _rep_lc = {str(k).lower(): v for k, v in (character.reputation or {}).items()}',
        '        for faction, amount in self.requirements.get("reputation", {}).items():',
        '            if _rep_lc.get(str(faction).lower(), 0) < amount:',
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
        '        # Check reputation requirements (case-insensitive: requirement keys are',
        '        # capitalized like "Syrenthia" but character reputation is keyed lowercase)',
        '        _rep_lc = {str(k).lower(): v for k, v in (character.reputation or {}).items()}',
        '        for faction, required_amount in self.requirements.get("reputation", {}).items():',
        '            if _rep_lc.get(str(faction).lower(), 0) < required_amount:',
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
        '                ',
        '                # Check tool keyword minimum-skill-level requirements, e.g.',
        '                # "Have a Pickaxe equipped that requires at least Mining level 60".',
        '                # At least one equipped item must carry the keyword AND have its',
        '                # own skill requirement for that skill be >= the required level.',
        '                for req in self.requirements.get("keyword_level_requirements", []):',
        '                    req_kw = str(req.get("keyword", "")).lower()',
        '                    req_skill = str(req.get("skill", "")).lower()',
        '                    req_level = req.get("level", 0)',
        '                    if not req_kw:',
        '                        continue',
        '                    satisfied = False',
        '                    for slot, item in gearset.get_all_items():',
        '                        if not item or not getattr(item, "keywords", None):',
        '                            continue',
        '                        if not any(req_kw == kw.lower() for kw in item.keywords):',
        '                            continue',
        '                        for r in (getattr(item, "requirements", []) or []):',
        '                            if (r.get("type") == "skill"',
        '                                    and str(r.get("skill", "")).lower() == req_skill',
        '                                    and r.get("level", 0) >= req_level):',
        '                                satisfied = True',
        '                                break',
        '                        if satisfied:',
        '                            break',
        '                    if not satisfied:',
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
            item_requirements = reqs.get('item_requirements', [])
            keyword_level_requirements = reqs.get('keyword_level_requirements', [])
            has_reqs = (keyword_counts or 
                       reqs.get('achievement_points', 0) > 0 or
                       reqs['reputation'] or reqs['activity_completions'] or
                       item_requirements or keyword_level_requirements)
            
            if has_reqs:
                # Format keyword_counts as dict
                kw_items = ', '.join([f"'{k}': {v}" for k, v in keyword_counts.items()])
                rep_str = ', '.join([f"'{f}': {a}" for f, a in reqs['reputation'].items()])
                comp_str = ', '.join([f"'{a}': {c}" for a, c in reqs['activity_completions'].items()])
                item_reqs_str = ', '.join([f"'{escape_str(name)}'" for name in item_requirements])
                klr_str = ', '.join([
                    f"{{'keyword': '{escape_str(e['keyword'])}', 'skill': '{escape_str(e['skill'])}', 'level': {e['level']}}}"
                    for e in keyword_level_requirements
                ])
                reqs_dict = (
                    f"{{'keyword_counts': {{{kw_items}}}, "
                    f"'achievement_points': {reqs.get('achievement_points', 0)}, "
                    f"'reputation': {{{rep_str}}}, "
                    f"'activity_completions': {{{comp_str}}}, "
                    f"'item_requirements': [{item_reqs_str}], "
                    f"'keyword_level_requirements': [{klr_str}]}}"
                )
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
                    lines.append(f"            {_format_drop_entry(drop, escape_str)},")
                lines.append(f"        ],")
            else:
                lines.append(f"        drop_table=[],")
            
            if activity['secondary_drop_table']:
                lines.append(f"        secondary_drop_table=[")
                for drop in activity['secondary_drop_table']:
                    lines.append(f"            {_format_drop_entry(drop, escape_str)},")
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
            if activity['name'] in ONE_TIME_ACTIVITIES:
                lines.append(f"        one_time=True,")
            if activity['name'] in SINGLE_COMPLETION_ACTIVITIES:
                lines.append(f"        single_completion=True,")
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
            if activity.get('input_items'):
                # Format as list of InputItem objects
                input_items_strs = []
                is_optional = activity.get('input_optional', False)
                for ii in activity['input_items']:
                    name_esc = ii['name'].replace("'", "\\'")
                    level_str = f", level={ii['level']}" if ii.get('level') else ""
                    optional_str = ", optional=True" if is_optional else ""
                    input_items_strs.append(
                        f"InputItem(name='{name_esc}', type='{ii['type']}', reference='{ii['reference']}', quantity={ii['quantity']}{level_str}{optional_str})"
                    )
                if len(input_items_strs) == 1:
                    lines.append(f"        input_items=[{input_items_strs[0]}],")
                else:
                    lines.append(f"        input_items=[")
                    for iis in input_items_strs:
                        lines.append(f"            {iis},")
                    lines.append(f"        ],")
            
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
        existing_names = {a['name'].lower() for a in activities_list}
        for folder_activity in folder_activities:
            if folder_activity['name'].lower() not in existing_names:
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
    
    # Overlay precise data from gear.walkscape.app API
    print("\nOverlaying gear API data...")
    try:
        from overlay_gear_api import overlay_api_data
        patched, new_added = overlay_api_data(activities_data)
        print(f"API overlay complete: {patched} patched, {new_added} new")
    except Exception as e:
        import traceback
        print(f"Warning: Could not overlay API data: {e}")
        traceback.print_exc()
        print("Continuing with wiki data only...")
    
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

    # Refresh stats_report precomputed tables after scrape completes.
    # See util/stats_report/ for details. No-op if sessions.db not present.
    try:
        from util.stats_report.precompute.scraper_hook import refresh_after_scrape
        refresh_after_scrape()
    except Exception as _e:
        print(f"[stats_report precompute] hook failed: {_e}")
