#!/usr/bin/env python3
"""
Scrape consumables data from Walkscape wiki and generate consumables.py.

Consumables are temporary items (food, potions) that provide time-limited bonuses.
Extracts attributes, duration, and value for both normal and fine versions.
"""

# Third-party imports
from bs4 import BeautifulSoup

# Local imports
from scraper_utils import *
import re

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
SCAN_FOLDER_FOR_NEW_ITEMS = True  # Scan cache folder for additional items
CONSUMABLES_URL = 'https://wiki.walkscape.app/wiki/Consumables'
CACHE_DIR = get_cache_dir('consumables')
CACHE_FILE = get_cache_file('consumables_cache.html')

# Create validator instance
validator = ScraperValidator()

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================


def download_consumable_page(consumable_url, cache_dir):
    """Download individual consumable page using shared download function"""
    filename = sanitize_filename(consumable_url.split('/')[-1]) + '.html'
    cache_path = cache_dir / filename
    
    # Use shared download_with_retry for Lua error handling
    return download_with_retry(consumable_url, cache_path, max_retries=3, delay=5)


def extract_value_from_page(html_content):
    """Extract value from consumable page"""
    soup = BeautifulSoup(html_content, 'html.parser')
    value = 0
    fine_value = 0
    
    infobox = soup.find('table', class_='ItemInfobox')
    if infobox:
        for row in infobox.find_all('tr'):
            header = row.find('th')
            if header:
                header_text = header.get_text()
                if 'Value' in header_text and 'Fine Value' not in header_text:
                    value_cell = row.find('td')
                    if value_cell:
                        val_match = re.search(r'(\d+)', value_cell.get_text())
                        if val_match:
                            value = int(val_match.group(1))
                elif 'Fine Value' in header_text:
                    value_cell = row.find('td')
                    if value_cell:
                        val_match = re.search(r'(\d+)', value_cell.get_text())
                        if val_match:
                            fine_value = int(val_match.group(1))
    
    return value, fine_value


def parse_attributes(html_text):
    """Parse attributes from HTML text with skill context"""
    skill_stats = {}
    
    # Extract all stat lines
    lines = html_text.split('<br')
    for line in lines:
        # Remove HTML tags but keep text
        clean_line = re.sub(r'<[^>]+>', '', line).strip()
        if not clean_line or 'Attributes:' in clean_line:
            continue
        
        # Determine skill using shared function
        skill = extract_skill_from_text(clean_line)
        
        # Extract value and stat name
        value_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*%?\s+(.+?)(?:\s+while|$)', clean_line, re.IGNORECASE)
        if value_match:
            value_text = value_match.group(1)
            stat_text = value_match.group(2).strip()
            
            # Add % back if it was in the original line for proper parsing
            if '%' in clean_line:
                value_text += '%'
            
            # Normalize the stat name using shared function
            stat_name = normalize_stat_name(stat_text)
            
            if stat_name:
                # Initialize skill dict with location nesting
                if skill not in skill_stats:
                    skill_stats[skill] = {}
                if 'global' not in skill_stats[skill]:
                    skill_stats[skill]['global'] = {}
                
                # Parse the value (handles steps/bonus_xp dual format automatically)
                final_stat_name, final_value = parse_stat_value(value_text, stat_name)
                skill_stats[skill]['global'][final_stat_name] = final_value
            else:
                # Track unrecognized stat (we don't have item name here, will track as 'Unknown')
                validator.add_unrecognized_stat('Unknown', clean_line)
    
    return skill_stats

# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def extract_consumables(html_content):
    """Extract consumable names, keywords, and attributes from Consumables page"""
    soup = BeautifulSoup(html_content, 'html.parser')
    consumables = []
    
    # Create cache directory
    cache_dir = get_cache_dir('consumables')
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    # Find all wikitable tables
    tables = soup.find_all('table', class_='wikitable')
    
    for table in tables:
        rows = table.find_all('tr')[1:]  # Skip header
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) >= 3:
                # Consumable name and URL
                name_link = cells[1].find('a')
                if name_link:
                    consumable_name = name_link.get_text().strip()
                    consumable_url = 'https://wiki.walkscape.app' + name_link['href']
                    
                    print(f"  Processing: {consumable_name}")
                    
                    # Extract keywords (3rd cell)
                    keywords = []
                    if len(cells) >= 3:
                        keyword_cell = cells[2]
                        keyword_links = keyword_cell.find_all('a')
                        for link in keyword_links:
                            kw_text = link.get_text().strip()
                            if kw_text and not kw_text.endswith('.svg') and 'Keyword' not in kw_text:
                                keywords.append(kw_text)
                    
                    # Extract attributes, duration, and value
                    normal_attrs = {}
                    fine_attrs = {}
                    duration = 0
                    value = 0
                    fine_value = 0
                    
                    if len(cells) >= 4:
                        attr_cell = cells[3]
                        attr_html = str(attr_cell)
                        
                        # Split by Normal/Fine sections
                        normal_section = ""
                        fine_section = ""
                        
                        if "Normal Attributes:" in attr_html:
                            parts = attr_html.split("Fine Attributes:")
                            normal_section = parts[0]
                            fine_section = parts[1] if len(parts) > 1 else ""
                        else:
                            normal_section = attr_html
                        
                        # Parse normal attributes
                        normal_attrs = parse_attributes(normal_section)
                        
                        # Parse fine attributes
                        if fine_section:
                            fine_attrs = parse_attributes(fine_section)
                    
                    # Extract duration (5th cell)
                    if len(cells) >= 5:
                        duration_text = cells[4].get_text()
                        duration_match = re.search(r'(\d+)', duration_text)
                        if duration_match:
                            duration = int(duration_match.group(1))
                    
                    # Download consumable page to get value
                    consumable_html = download_consumable_page(consumable_url, cache_dir)
                    value, fine_value = extract_value_from_page(consumable_html) if consumable_html else (0, 0)
                    
                    # Validate normal attributes
                    issues = validator.validate_item_stats(consumable_name, normal_attrs)
                    if issues:
                        validator.add_item_issue(consumable_name, issues)
                    
                    # Add regular consumable
                    consumables.append({
                        'name': consumable_name,
                        'keywords': keywords,
                        'attributes': normal_attrs,
                        'duration': duration,
                        'value': value if value else 0
                    })
                    
                    # Only add fine version if fine attributes exist
                    if fine_attrs:
                        # Validate fine attributes
                        fine_issues = validator.validate_item_stats(consumable_name + ' (Fine)', fine_attrs)
                        if fine_issues:
                            validator.add_item_issue(consumable_name + ' (Fine)', fine_issues)
                        
                        consumables.append({
                            'name': consumable_name + ' (Fine)',
                            'keywords': keywords,
                            'attributes': fine_attrs,
                            'duration': duration,
                            'value': fine_value if fine_value else value
                        })
    
    return consumables

# ============================================================================
# MODULE GENERATION
# ============================================================================

def generate_consumables_py(consumables):
    """Generate the consumables.py file"""
    output_file = get_output_file('consumables.py')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Auto-generated consumables data from Walkscape wiki', 'scrape_consumables.py')
        write_imports(f, [
            'from typing import List, Dict',
            'from util.stats_mixin import StatsMixin'
        ])
        
        lines = [
        'class ConsumableItem(StatsMixin):',
        '    """Base class for consumable instances"""',
        '    def __init__(self, name: str, keywords: List[str], attributes: Dict, duration: int, value: int):',
        '        self.name = name',
        '        self.keywords = keywords',
        '        self._stats = attributes  # Skill-nested dict like equipment',
        '        self.duration = duration  # Duration in steps',
        '        self.value = value  # Coin value',
        '        self.gated_stats = {}  # Consumables don\'t have gated stats',
        '    ',
        '    # Keep attributes as an alias for backward compatibility',
        '    @property',
        '    def attributes(self):',
        '        return self._stats',
        '    ',
        '    def __repr__(self):',
        '        return f"Consumable({self.name})"',
        '',
        '',
        'class Consumable:',
        '    """All consumables"""',
        '    ',
        ]
        
        # Add consumables
        for consumable in consumables:
            const_name = consumable['name'].upper().replace(' ', '_').replace("'", '').replace('-', '_').replace('(', '').replace(')', '')
            lines.extend([
            f'    {const_name} = ConsumableItem(',
            f'        name="{consumable["name"]}",',
            f'        keywords={consumable["keywords"]},',
            f'        attributes={consumable["attributes"]},',
            f'        duration={consumable["duration"]},',
            f'        value={consumable["value"]}',
            '    )',
            '',
            ])
        
        lines.extend([
        # Add lookup function
        '    @classmethod',
        '    def by_export_name(cls, export_name: str):',
        '        """Look up consumable by export name"""',
        '        const_name = export_name.upper()',
        '        ',
        '        if hasattr(cls, const_name):',
        '            return getattr(cls, const_name)',
        '        return None',
        ])

        write_lines(f, lines)
    
    print(f"✓ Generated {output_file} with {len(consumables)} consumables")

# ============================================================================
# MAIN LOGIC
# ============================================================================

def main():
    """Main scraping logic"""
    print("Step 1: Downloading Consumables page...")
    html = download_page(CONSUMABLES_URL, CACHE_FILE, rescrape=RESCRAPE)
    
    if not html:
        print("Failed to download Consumables page")
        return
    
    print("\nStep 2: Extracting consumables...")
    consumables = extract_consumables(html)
    print(f"Found {len(consumables)} consumables from main page")
    
    # Scan folder for additional consumables
    if SCAN_FOLDER_FOR_NEW_ITEMS:
        print("\nScanning cache folder for additional consumables...")
        folder_consumables = scan_cache_folder_for_items(CACHE_DIR, CACHE_FILE)
        if folder_consumables:
            # Build set of existing consumable names (without " (Fine)" suffix)
            existing_names = set()
            for cons in consumables:
                base_name = cons['name'].replace(' (Fine)', '')
                existing_names.add(base_name)
            
            # Process folder consumables that aren't already in the list
            added_count = 0
            for item in folder_consumables:
                consumable_name = item['name']
                
                # Skip if already in main list
                if consumable_name in existing_names:
                    continue
                
                print(f"  Processing: {consumable_name} (from folder)")
                
                # Read cached HTML
                consumable_html = read_cached_html(item['cache_file'])
                if consumable_html:
                    value, fine_value = extract_value_from_page(consumable_html)
                else:
                    value, fine_value = 0, 0
                
                # Add regular consumable (no attributes from folder scan)
                consumables.append({
                    'name': consumable_name,
                    'attributes': {},
                    'duration': None,
                    'value': value
                })
                
                # Add fine version
                consumables.append({
                    'name': consumable_name + ' (Fine)',
                    'attributes': {},
                    'duration': None,
                    'value': fine_value if fine_value else value
                })
                
                added_count += 1
            
            if added_count > 0:
                print(f"  Added {added_count * 2} consumables from folder (regular + fine)")
    
    print(f"\nTotal consumables: {len(consumables)}")
    
    print("\nStep 3: Generating consumables.py...")
    generate_consumables_py(consumables)
    
    # Step 4: Report validation issues
    validator.report()

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    main()
