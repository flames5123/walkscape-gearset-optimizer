#!/usr/bin/env python3
"""
Scrape locations from the Walkscape wiki.
Generates locations.py with location data including regions and factions.

Fetches individual location pages to extract:
- Primary region (from "is a location that can be found in the X region")
- Faction memberships (from "is a member of the following factions:")
- Underwater status (hardcoded for Syrenthia locations)
"""

from bs4 import BeautifulSoup
from pathlib import Path
import re
from urllib.parse import unquote
from scraper_utils import *

# Configuration
RESCRAPE = False
SCAN_FOLDER_FOR_NEW_ITEMS = True  # Scan cache folder for additional items

# URLs and cache
ROUTES_URL = 'https://wiki.walkscape.app/wiki/Routes'
ROUTES_CACHE = get_cache_file('routes_cache.html')
LOCATION_CACHE_DIR = Path(get_cache_dir('locations'))
print(LOCATION_CACHE_DIR)
# Region name on the page mapped to other regions
HARD_CODED_EXTRA_REGIONS = {
    'syrenthia': 'underwater',
    'wraithwater': 'spectral',
}

def get_location_names_from_routes():
    """Extract unique location names from the routes page."""
    html = download_page(ROUTES_URL, ROUTES_CACHE, rescrape=RESCRAPE)
    if not html:
        return []
    soup = BeautifulSoup(html, 'html.parser')
    
    locations = set()
    
    # Find all wikitable tables
    tables = soup.find_all('table', class_='wikitable')
    
    for table in tables:
        rows = table.find_all('tr')[1:]  # Skip header
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) < 4:
                continue
            
            # New format: 7 columns
            # 0: icon, 1: start location, 2: icon, 3: end location, 4: direction, 5: distance, 6: requirements
            start_loc = clean_text(cells[1].get_text())
            end_loc = clean_text(cells[3].get_text())
            
            if start_loc:
                locations.add(start_loc)
            if end_loc:
                locations.add(end_loc)
    
    return sorted(locations)

def parse_location_page(location_name, from_folder=False, cache_file_path=None):
    """
    Parse an individual location page to extract region and faction info.
    
    Args:
        location_name: Name of the location
        from_folder: If True, read from cache_file_path instead of downloading
        cache_file_path: Path to cached HTML file (for folder-scanned items)
    
    Returns dict with:
    - name: Location name
    - enum: Enum name
    - regions: List of region tags (primary region + factions)
    """
    loc_enum = name_to_enum(location_name)
    
    # Create cache directory if needed
    LOCATION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    # Get HTML
    if from_folder and cache_file_path:
        html = read_cached_html(cache_file_path)
    else:
        # Download location page
        url = f'https://wiki.walkscape.app/wiki/{location_name.replace(" ", "_")}'
        cache_file = LOCATION_CACHE_DIR / (sanitize_filename(location_name) + '.html')
        html = download_page(url, cache_file, rescrape=RESCRAPE)
    
    if not html:
        print(f"  ⚠ Failed to get HTML for {location_name}")
        return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Extract icon name - look for <a title="LOCATION_NAME" href="...svg">
    icon_name = None
    for link in soup.find_all('a', title=location_name, href=True):
        href = link.get('href', '')
        if '.svg' in href.lower():
            # Extract just the filename from the URL
            # Format: /wiki/File:Castle_White_Icon.svg
            parts = href.split('/')
            if parts:
                filename = parts[-1]
                # Remove "File:" prefix if present
                if filename.startswith('File:'):
                    filename = filename[5:]
                # Store as lowercase for consistency
                icon_name = filename.lower()
                break
    
    # Extract primary region from "is a location that can be found in the X region"
    primary_region = None
    # Use \s+ to match one or more whitespace characters
    region_pattern = re.compile(r'is\s+a\s+location\s+that\s+can\s+be\s+found\s+in\s+the\s+(.+?)\s+region', re.IGNORECASE)
    
    # Search in all paragraphs
    for p in soup.find_all('p'):
        text = p.get_text()
        match = region_pattern.search(text)
        if match:
            region_text = match.group(1).strip().lower()
            if 'grand duchy of trellin-erdwise' in region_text:
                primary_region = 'gdte'
            else:
                primary_region = region_text.replace(' ', '_')
            break
    
    if not primary_region:
        print(f"  ⚠ Could not find region for {location_name}, defaulting to jarvonia")
        primary_region = 'jarvonia'
    
    # Extract keywords - look for "Underwater" keyword in the Keyword section
    keywords = []
    
    # Find the "Keyword" or "Keywords" heading
    keyword_heading = soup.find(['h1', 'h2'], id='Keyword')
    if not keyword_heading:
        keyword_heading = soup.find(['h1', 'h2'], id='Keywords')
    
    if keyword_heading:
        # Get the parent div and then find next siblings
        keyword_div = keyword_heading.find_parent('div', class_='mw-heading')
        if keyword_div:
            current = keyword_div.find_next_sibling()
        else:
            current = keyword_heading.find_next_sibling()
        
        while current:
            # Stop if we hit another heading
            if current.name == 'div' and 'mw-heading' in current.get('class', []):
                break
            if current.name in ['h1', 'h2']:
                break
            
            # Look for keyword links (Special:MyLanguage/Underwater, etc.)
            for link in current.find_all('a', href=True):
                href = link.get('href', '')
                
                # Only process Special:MyLanguage links
                if 'Special:MyLanguage/' in href:
                    # Extract the keyword name from the URL
                    parts = href.split('/')
                    if len(parts) >= 2:
                        keyword_name = unquote(parts[-1])
                        keyword_name = keyword_name.lower().replace(' ', '_')
                        
                        # Skip generic keyword pages (not actual location keywords)
                        if 'keyword' in keyword_name and '#' in keyword_name:
                            continue
                        
                        # Add if not already in list
                        if keyword_name and keyword_name not in keywords:
                            keywords.append(keyword_name)
            
            current = current.find_next_sibling()
    
    # Extract factions - look for faction links ONLY in the Faction section
    # This dynamically finds faction links without hardcoding faction names
    factions = []
    
    # Find the "Faction" or "Factions" heading by looking for h1/h2 with id
    faction_heading = soup.find(['h1', 'h2'], id='Faction')
    if not faction_heading:
        faction_heading = soup.find(['h1', 'h2'], id='Factions')
    
    if faction_heading:
        # Get the parent div and then find next siblings
        faction_div = faction_heading.find_parent('div', class_='mw-heading')
        if faction_div:
            current = faction_div.find_next_sibling()
        else:
            current = faction_heading.find_next_sibling()
        while current:
            # Stop if we hit another heading (wrapped in mw-heading div)
            if current.name == 'div' and 'mw-heading' in current.get('class', []):
                break
            if current.name in ['h1', 'h2']:
                break
            
            # Look for Special:MyLanguage links (these are the faction links)
            for link in current.find_all('a', href=True):
                href = link.get('href', '')
                
                # Only process Special:MyLanguage links (not files, not coat of arms)
                if ('Special:MyLanguage/' in href and 
                    'File:' not in href and 
                    'Coat_of_Arms' not in href):
                    
                    # Extract the faction name from the URL
                    # Format: /wiki/Special:MyLanguage/FactionName
                    parts = href.split('/')
                    if len(parts) >= 2:
                        # URL decode and clean the faction name
                        faction_name = unquote(parts[-1])  # Decode %27 to '
                        faction_name = faction_name.replace("'", "")  # Remove apostrophes
                        faction_name = faction_name.lower().replace(' ', '_')
                        
                        # Skip non-faction pages (these are links to general info pages)
                        if 'reputation' in faction_name or 'faction' in faction_name:
                            continue
                        
                        # Normalize specific known faction names
                        if 'halfling' in faction_name:
                            faction_name = 'halfling_rebels'
                        
                        # Add if not already in list and not empty
                        if faction_name and faction_name not in factions:
                            factions.append(faction_name)
            
            current = current.find_next_sibling()

    # Build regions list: primary region first, then all factions, then keywords
    regions = [primary_region]
    
    # Add all factions (can be multiple, like Everhaven with both Trellin and Erdwise)
    for faction in factions:
        if faction not in regions:
            regions.append(faction)
    
    # Add all keywords (like 'underwater' for underwater locations)
    for keyword in keywords:
        if keyword not in regions:
            regions.append(keyword)
    
    # Add any hardcoded extra regions (like 'underwater' for Syrenthia)
    for region in list(regions):  # Use list() to avoid modifying while iterating
        if region in HARD_CODED_EXTRA_REGIONS:
            extra = HARD_CODED_EXTRA_REGIONS[region]
            if extra not in regions:
                regions.append(extra)
    
    if location_name.lower() in HARD_CODED_EXTRA_REGIONS.keys():
        extra = HARD_CODED_EXTRA_REGIONS[location_name.lower()]
        if extra not in regions:
            regions.append(extra)
    
    return {
        'name': location_name,
        'enum': loc_enum,
        'regions': regions,
        'primary_region': primary_region,
        'icon_name': icon_name
    }

def generate_locations_module(locations):
    """Generate the locations.py module."""
    output_file = get_output_file('locations.py')
    
    print(f"\nGenerating {output_file}...")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Walkscape Locations Data\nLocation data extracted from individual location pages on the game wiki.', 'scrape_locations.py')
        
        lines = [
        # LocationInfo class
        'class LocationInfo:',
        '    """Information about a location including all its region tags."""',
        '    def __init__(self, name: str, regions: list, icon_name: str = None):',
        '        self.name = name',
        '        self.regions = regions  # List of all region tags (primary + factions)',
        '        self.primary_region = regions[0] if regions else None',
        '        self.is_underwater = \'underwater\' in regions',
        '        self.icon_name = icon_name  # SVG icon filename (e.g., "Castle_White_Icon.svg")',
        '    ',
        '    def is_in_region(self, region: str) -> bool:',
        '        """Check if this location is in the specified region."""',
        '        return region.lower() in [r.lower() for r in self.regions]',
        '    ',
        '    def __str__(self):',
        '        return self.name',
        '    ',
        '    def __repr__(self):',
        '        return f"LocationInfo({self.name}, {self.regions})"',
        '',
        # Location class with all locations
        'class Location:',
        '    """Locations in Walkscape with region and faction information."""',
        '    ',
        '    @classmethod',
        '    def by_name(cls, name: str):',
        '        """Get location by name string."""',
        '        for attr_name in dir(cls):',
        '            if attr_name.startswith(\'_\'):',
        '                continue',
        '            attr = getattr(cls, attr_name)',
        '            if isinstance(attr, LocationInfo) and attr.name == name:',
        '                return attr',
        '        return None',
        '    ',
        ]
        
        # Group by first region in the regions list (most specific)
        by_region = {}
        for loc in locations:
            # Use first region in list as the grouping key
            first_region = loc['regions'][0] if loc['regions'] else 'jarvonia'
            if first_region not in by_region:
                by_region[first_region] = []
            by_region[first_region].append(loc)
        
        # Write locations grouped by first region (sorted alphabetically for consistency)
        for region in sorted(by_region.keys()):
            lines.append(f'    # {region.upper()}')
            for loc in sorted(by_region[region], key=lambda x: x['enum']):
                regions_str = str(loc['regions'])
                icon_str = f'"{loc["icon_name"]}"' if loc.get('icon_name') else 'None'
                lines.append(f'    {loc["enum"]} = LocationInfo("{loc["name"]}", {regions_str}, {icon_str})')
            lines.append('')
        
        write_lines(f, lines)
    
    print(f"✓ Generated {output_file} with {len(locations)} locations")

if __name__ == '__main__':
    print("Extracting location names from routes page...")
    location_names = get_location_names_from_routes()
    
    print(f"Found {len(location_names)} locations from routes page")
    
    # Scan folder for additional locations
    if SCAN_FOLDER_FOR_NEW_ITEMS:
        print("\nScanning cache folder for additional locations...")
        folder_locations = scan_cache_folder_for_items(LOCATION_CACHE_DIR, ROUTES_CACHE)
        if folder_locations:
            # Add folder locations to the list
            for loc in folder_locations:
                if loc['name'] not in location_names:
                    location_names.append(loc)  # Append dict, not just name
                    print(f"  ✓ Added: {loc['name']}")
    
    print(f"\nTotal locations to process: {len(location_names)}")
    print("\nFetching individual location pages...")
    
    locations = []
    for i, loc_item in enumerate(location_names, 1):
        # Handle both string names and dict items
        if isinstance(loc_item, dict):
            loc_name = loc_item['name']
            is_folder = loc_item.get('from_folder', False)
            cache_path = loc_item.get('cache_file')
        else:
            loc_name = loc_item
            is_folder = False
            cache_path = None
        
        source = "folder" if is_folder else "wiki"
        print(f"  [{i}/{len(location_names)}] {loc_name} (from {source})")
        
        if is_folder:
            loc_data = parse_location_page(loc_name, from_folder=True, cache_file_path=cache_path)
        else:
            loc_data = parse_location_page(loc_name)
        
        if loc_data:
            locations.append(loc_data)
            print(f"    → Regions: {loc_data['regions']}")
    
    print(f"\nSuccessfully parsed {len(locations)} locations")
    
    generate_locations_module(locations)
