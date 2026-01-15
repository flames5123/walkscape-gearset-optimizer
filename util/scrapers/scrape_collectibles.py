#!/usr/bin/env python3
"""
Scrape collectibles from the Walkscape wiki Collectibles page.

Generates collectibles.py with collectible names and attributes.
Collectibles are permanent items that provide passive bonuses.
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
COLLECTIBLES_URL = 'https://wiki.walkscape.app/wiki/Collectibles'
CACHE_FILE = get_cache_file('collectibles_cache.html')

# Create validator instance
validator = ScraperValidator()

# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def extract_attributes(td):
    """
    Extract attribute bonuses from the attributes cell in nested format.
    Returns: {skill: {location: {stat: value}}}
    """
    stats = {}
    
    # Get the full text to parse
    full_text = td.get_text()
    
    # Split by line breaks to process each stat block
    lines = full_text.split('\n')
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        if not line or 'None' in line:
            i += 1
            continue
        
        # Extract stat: "+2% Double rewards" or "+10 Bonus experience"
        stat_match = re.search(r'([+-]?\d+(?:\.\d+)?)\s*(%?)\s+([A-Za-z\s]+)', line)
        if not stat_match:
            i += 1
            continue
        
        value_str = stat_match.group(1)
        has_percent = stat_match.group(2) == '%'
        stat_name_raw = clean_text(stat_match.group(3))
        
        # Remove trailing context from stat name
        stat_name_raw = re.sub(r'\s+While.*$', '', stat_name_raw, flags=re.IGNORECASE)
        stat_name = normalize_stat_name(stat_name_raw)
        
        if not stat_name:
            validator.add_unrecognized_stat('Unknown', line.strip())
            i += 1
            continue
        
        # Build value string with % if present for parse_stat_value
        value_with_percent = value_str
        if has_percent:
            value_with_percent += '%'
        
        # Determine skill using shared function (check current and next line)
        skill = extract_skill_from_text(line)
        if skill == 'global' and i + 1 < len(lines):
            next_skill = extract_skill_from_text(lines[i + 1])
            if next_skill and next_skill != 'global':
                skill = next_skill
        
        # Ensure skill is never None
        if not skill:
            skill = 'global'
        
        # Determine location using shared function (check current and next line)
        location_text, is_negated = extract_location_from_text(line)
        if not location_text and i + 1 < len(lines):
            location_text, is_negated = extract_location_from_text(lines[i + 1])
        
        # Normalize location using shared function
        if location_text:
            location = normalize_location_name(location_text)
            # Handle negation (though collectibles probably don't use this)
            if is_negated:
                location = '!' + location
        else:
            location = 'global'
        
        # Use shared function to parse value (handles dual-format stats)
        final_stat_name, final_value = parse_stat_value(value_with_percent, stat_name)
        
        # Build nested structure
        if skill not in stats:
            stats[skill] = {}
        if location not in stats[skill]:
            stats[skill][location] = {}
        stats[skill][location][final_stat_name] = final_value
        
        i += 1
    
    return stats

def parse_collectibles():
    """Parse all collectibles from the cached HTML file."""
    html = download_page(COLLECTIBLES_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return []
    soup = BeautifulSoup(html, 'html.parser')
    
    collectibles = []
    
    # Find the collectibles table
    content_div = soup.find('div', class_='mw-parser-output')
    if not content_div:
        print("Could not find main content div")
        return []
    
    # Find all collectibles tables (Activities and Rewards sections)
    tables = content_div.find_all('table', class_='wikitable')
    if not tables:
        print("Could not find collectibles tables")
        return []
    
    print(f"Found {len(tables)} collectibles tables")
    
    # Parse each collectible row from all tables
    for table in tables:
        rows = table.find_all('tr', {'data-achievement-id': True})
        
        # Track rowspan cells to skip
        rowspan_tracker = {}  # {col_index: rows_remaining}
        
        for row_idx, row in enumerate(rows):
            cells = row.find_all('td')
            
            # Adjust cell indices based on active rowspans
            actual_cells = []
            cell_idx = 0
            for col_idx in range(10):  # Assume max 10 columns
                # Check if this column is spanned from a previous row
                if col_idx in rowspan_tracker and rowspan_tracker[col_idx] > 0:
                    rowspan_tracker[col_idx] -= 1
                    # Skip this column, it's covered by rowspan
                    continue
                
                # Add the next actual cell
                if cell_idx < len(cells):
                    actual_cells.append(cells[cell_idx])
                    
                    # Check if this cell has rowspan
                    rowspan = cells[cell_idx].get('rowspan')
                    if rowspan:
                        rowspan_tracker[col_idx] = int(rowspan) - 1
                    
                    cell_idx += 1
            
            if len(actual_cells) < 3:
                continue
            
            # Extract data from cells
            # 0: Icon, 1: Name, 2: Attributes/Effect, 3+: Source info (we don't need)
            
            # Get name from link
            name_cell = actual_cells[1]
            name_link = name_cell.find('a')
            if name_link:
                # Get title and clean up Special:MyLanguage/ prefix
                title = name_link.get('title', '')
                if title:
                    # Remove Special:MyLanguage/ prefix
                    title = title.replace('Special:MyLanguage/', '')
                    collectible_name = clean_text(title)
                else:
                    collectible_name = clean_text(name_link.get_text())
            else:
                collectible_name = clean_text(name_cell.get_text())
            
            # Skip if name looks like a percentage (from rowspan confusion)
            if '%' in collectible_name or collectible_name.replace('.', '').replace(',', '').isdigit():
                continue
            
            # Get attributes
            attributes = extract_attributes(actual_cells[2])
            
            collectible = {
                'name': collectible_name,
                'attributes': attributes
            }
            
            # Validate attributes
            issues = validator.validate_item_stats(collectible_name, attributes)
            if issues:
                validator.add_item_issue(collectible_name, issues)
            
            collectibles.append(collectible)
            # Print summary
            if attributes:
                stat_count = sum(len(loc_stats) for skill_stats in attributes.values() for loc_stats in skill_stats.values())
                print(f"  {collectible_name}: {stat_count} stats")
            else:
                print(f"  {collectible_name}: No stats")
    
    return collectibles

# ============================================================================
# MODULE GENERATION
# ============================================================================

def generate_python_module(collectibles):
    """Generate the collectibles.py module."""
    output_file = get_output_file('collectibles.py')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Auto-generated collectible data from Walkscape wiki.', 'scrape_collectibles.py')
        write_imports(f, [
            'from dataclasses import dataclass',
            'from typing import List, Tuple',
            'from util.stats_mixin import StatsMixin'
        ])

        lines = [
        '@dataclass',
        'class CollectibleInstance(StatsMixin):',
        '    """Represents a collectible item with permanent effects."""',
        '    name: str',
        '    _stats: dict  # {skill: {location: {stat: value}}}',
        '    ',
        '    def __post_init__(self):',
        '        """Initialize after dataclass init"""',
        '        # StatsMixin expects self.gated_stats to exist',
        '        self.gated_stats = {}',
        '    ',
        '    # Keep stats as an alias for backward compatibility',
        '    @property',
        '    def stats(self):',
        '        return self._stats',
        '',
        '# All collectibles',
        'COLLECTIBLES = [',
        ]
        for collectible in collectibles:
            lines.extend([
            '    CollectibleInstance(',
            f'        name={repr(collectible["name"])},',
            f'        _stats={repr(collectible["attributes"])}',
            '    ),',
            ])
        
        lines.extend([
        ']',
        '',
        '# Index by name for quick lookup',
        'COLLECTIBLES_BY_NAME = {c.name: c for c in COLLECTIBLES}',
        '',
        # Generate enum-style access
        '# Enum-style access to collectibles',
        'class Collectible:',
        '    """Enum-style access to all collectibles."""',
        ])

        for collectible in collectibles:
            # Convert name to valid Python identifier
            attr_name = collectible['name'].upper().replace(' ', '_').replace('-', '_').replace("'", '').replace('(', '').replace(')', '').replace('.', '')
            # Prefix with underscore if starts with digit
            if attr_name and attr_name[0].isdigit():
                attr_name = '_' + attr_name
            if attr_name:  # Skip if empty after cleaning
                lines.append(f'    {attr_name} = COLLECTIBLES_BY_NAME[{repr(collectible["name"])}]')
            
        lines.extend([
        '',
        # Add helper function for export name lookup
        '# Export name lookup',
        'COLLECTIBLES_BY_EXPORT_NAME = {}',
        'for c in COLLECTIBLES:',
        '    # Convert display name to export name format (snake_case)',
        '    export_name = c.name.lower().replace(" ", "_").replace("-", "_").replace("\'", "").replace("(", "").replace(")", "")',
        '    COLLECTIBLES_BY_EXPORT_NAME[export_name] = c',
        '',
        'def by_export_name(export_name: str):',
        '    """Look up collectible by export name (snake_case format)"""',
        '    return COLLECTIBLES_BY_EXPORT_NAME.get(export_name)',
        ])

        write_lines(f, lines)
    
    print(f"\n✓ Generated {output_file} with {len(collectibles)} collectibles")

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    collectibles = parse_collectibles()
    print(f"\nFound {len(collectibles)} collectibles")
    generate_python_module(collectibles)
    
    # Report validation issues
    validator.report()
