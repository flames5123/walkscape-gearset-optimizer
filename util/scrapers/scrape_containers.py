#!/usr/bin/env python3
"""
Scrape containers (chests) from Walkscape wiki and generate containers.py
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

from util.item_utils import Quantity, DropEntry

# Configuration
RESCRAPE = False
SCAN_FOLDER_FOR_NEW_ITEMS = True  # Scan cache folder for additional items
CONTAINERS_URL = 'https://wiki.walkscape.app/wiki/Chests'
CACHE_DIR = get_cache_dir('containers')
CACHE_FILE = get_cache_file('containers_cache.html')

# Create validator instance
validator = ScraperValidator()

# Loot table chances (from wiki)
LOOT_TABLE_CHANCES = {
    'Main': 50.00,
    'Valuables': 21.64,
    'Common': 20.00,
    'Uncommon': 5.00,
    'Rare': 2.50,
    'Epic': 0.75,
    'Legendary': 0.10,
    'Ethereal': 0.01,
}

# Number of rolls per chest
ROLLS_PER_CHEST = 4


def parse_containers_list():
    """Parse the main containers page to get list of containers."""
    html = download_page(CONTAINERS_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    containers = []
    
    # Find all tables with captions
    tables = soup.find_all('table', class_='wikitable')
    
    for table in tables:
        caption = table.find('caption')
        if not caption:
            continue
        
        caption_text = clean_text(caption.get_text())
        
        # Check if this is Skill Chests or Unique Openables (ignore Regional Chests)
        if 'Skill Chests' in caption_text:
            print("\nParsing Skill Chests table...")
            container_type = 'skill_chest'
        elif 'Unique Openables' in caption_text:
            print("\nParsing Unique Openables table...")
            container_type = 'unique_openable'
        else:
            continue
        
        # Parse the table rows
        for row in table.find_all('tr')[1:]:  # Skip header
            cells = row.find_all('td')
            if len(cells) < 2:  # Need at least 2 cells (icon + name)
                continue
            
            # Get name from SECOND column (index 1) - first column is icon
            name_cell = cells[1]
            link = name_cell.find('a')
            if not link:
                continue
            
            name = clean_text(link.get_text())
            url = 'https://wiki.walkscape.app' + link.get('href')
            
            if not name:
                continue
            
            containers.append({
                'name': name,
                'url': url,
                'type': container_type
            })
            print(f"  Found: {name}")
    
    return containers


def parse_container_page(container_info):
    """Parse individual container page for loot tables."""
    name = container_info['name']
    url = container_info.get('url')
    container_type = container_info['type']
    
    # Check if this is a folder-scanned container
    if container_info.get('from_folder'):
        # Read from the cached file directly
        cache_path = container_info['cache_file']
        print(f"  Reading from folder: {cache_path.name}")
        
        html = read_cached_html(cache_path)
        if not html:
            print(f"  ⚠ Failed to read {name}")
            return None
    else:
        # Create cache filename
        cache_filename = sanitize_filename(name) + '.html'
        cache_path = Path(CACHE_DIR) / cache_filename
        
        # Download page
        html = download_page(url, cache_path, rescrape=RESCRAPE)
        if not html:
            print(f"  ⚠ Failed to download {name}")
            return None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Find all h2 headers for loot tables (stop at "Sources")
    loot_tables = {}
    
    for h2 in soup.find_all('h2'):
        header_text = clean_text(h2.get_text())
        
        # Stop at Sources section
        if 'Sources' in header_text:
            break
        
        # Check if this is a loot table header
        if 'Loot Table' in header_text:
            # Extract table name (e.g., "Main Loot Table" -> "Main")
            table_name = header_text.replace('Loot Table', '').strip()
            
            # Find the table after this header
            table = h2.find_next('table', class_='wikitable')
            if not table:
                continue
            
            # Parse the loot table
            drops = []
            for row in table.find_all('tr')[1:]:  # Skip header
                cells = row.find_all('td')
                if len(cells) < 5:  # Need at least 5 columns
                    continue
                
                # Column 0: Icon (skip)
                # Column 1: Item name
                # Column 2: Quantity (per roll)
                # Column 3: Chance (Per Roll) - use this!
                # Column 4: Chance (Per Chest) - skip
                
                item_cell = cells[1]
                quantity_cell = cells[2]
                chance_per_roll_cell = cells[3]
                
                # Get item name
                item_link = item_cell.find('a')
                if not item_link:
                    continue
                
                item_name = clean_text(item_link.get_text())
                
                # Parse quantity (per roll)
                quantity_text = clean_text(quantity_cell.get_text())
                quantity = parse_quantity(quantity_text)
                
                # Parse chance per roll
                chance_text = clean_text(chance_per_roll_cell.get_text()).replace('%', '').strip()
                try:
                    chance_per_roll = float(chance_text)
                except ValueError:
                    chance_per_roll = 0.0
                
                # Store name, quantity, and chance per roll
                drops.append({
                    'item_name': item_name,
                    'quantity': quantity,
                    'chance_per_roll': chance_per_roll,
                    'item_object': None,  # Will be filled in by link_items()
                })
            
            loot_tables[table_name] = drops
    
    return {
        'name': name,
        'type': container_type,
        'loot_tables': loot_tables,
    }


def link_items(containers):
    """Link items to their objects, report missing ones."""
    # Build lookup dictionaries for all item types
    lookups = build_all_item_lookups()
    
    if not lookups:
        print("Warning: Could not build item lookups")
        return
    
    # Link items in loot tables
    for container in containers:
        if not container:
            continue
        
        # Link items in all loot tables
        for table_name, drops in container['loot_tables'].items():
            for drop in drops:
                item_name = drop['item_name']
                if item_name in ['Nothing', 'Coins', 'Gem pouch', 'Coin pouch']:
                    continue  # Skip special items
                
                # Use the shared resolve function
                item_ref = resolve_item_reference(item_name, lookups)
                
                if item_ref:
                    drop['item_object'] = item_ref
                else:
                    validator.add_item_issue(container['name'], [f"Drop item not found: {item_name}"])
                    print(f"  ⚠ {container['name']}: Drop item not found: {item_name}")
                    drop['item_object'] = None


def parse_quantity(text):
    """Parse quantity from text like '1', '1-4', 'N/A'."""
    text = text.strip()
    
    if text.upper() in ['N/A', 'NA', '']:
        return Quantity(is_na=True)
    
    # Check for range (e.g., "1-4")
    if '-' in text:
        parts = text.split('-')
        if len(parts) == 2:
            try:
                min_qty = int(parts[0].strip())
                max_qty = int(parts[1].strip())
                return Quantity(min_qty=min_qty, max_qty=max_qty)
            except ValueError:
                pass
    
    # Try single number
    try:
        qty = int(text)
        return Quantity(min_qty=qty, max_qty=qty)
    except ValueError:
        pass
    
    # Default to N/A
    return Quantity(is_na=True)


def generate_module(containers):
    """Generate the containers.py module."""
    output_file = get_output_file('containers.py')
    
    # Helper function to escape strings
    def escape_str(s):
        if s is None:
            return "None"
        return f"'{s.replace(chr(92), chr(92)*2).replace(chr(39), chr(92)+chr(39))}'"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Containers (chests) data from Walkscape wiki', 'scrape_containers.py')
        
        imports = [
            'from typing import Dict, List, Optional',
            'from dataclasses import dataclass',
            'from util.item_utils import Quantity, DropEntry',
        ]
        write_imports(f, imports)
        
        lines = []
        
        # Add constant
        lines.extend([
            '# Number of rolls per chest',
            'ROLLS_PER_CHEST = 4',
            '',
            '',
        ])
        
        # ContainerInfo class
        lines.extend([
            '@dataclass',
            'class ContainerInfo:',
            '    """Detailed information about a container (chest)."""',
            '    name: str',
            '    container_type: str  # "skill_chest" or "unique_openable"',
            '    main_table: List[DropEntry] = None  # DropEntry.chance_percent is per roll',
            '    valuables_table: List[DropEntry] = None',
            '    common_table: List[DropEntry] = None',
            '    uncommon_table: List[DropEntry] = None',
            '    rare_table: List[DropEntry] = None',
            '    epic_table: List[DropEntry] = None',
            '    legendary_table: List[DropEntry] = None',
            '    ethereal_table: List[DropEntry] = None',
            '    ',
            '    def __post_init__(self):',
            '        """Build lookup dictionaries for fast access."""',
            '        # Build _all_drops list from all tables',
            '        table_list = [self.main_table, self.valuables_table, self.common_table,',
            '                      self.uncommon_table, self.rare_table, self.epic_table,',
            '                      self.legendary_table, self.ethereal_table]',
            '        ',
            '        self._all_drops = []',
            '        for table in table_list:',
            '            if table:',
            '                self._all_drops.extend(table)',
            '        ',
            '        # Sort alphabetically by item name',
            '        self._all_drops.sort(key=lambda d: d.item_name.lower())',
            '        ',
            '        # Build _drop_rate_by_name dict (item_name -> chance_percent per roll)',
            '        self._drop_rate_by_name = {}',
            '        for drop in self._all_drops:',
            '            if drop.chance_percent and drop.chance_percent > 0:',
            '                self._drop_rate_by_name[drop.item_name.lower()] = drop.chance_percent',
            '    ',
            '    def get_all_drops(self) -> List[DropEntry]:',
            '        """Get all drops from all loot tables."""',
            '        return self._all_drops',
            '    ',
            '    def get_drop_rate(self, item) -> Optional[float]:',
            '        """',
            '        Get drop rate (chance percent per roll) for an item.',
            '        ',
            '        Args:',
            '            item: Can be a string (item name) or an object with .name attribute',
            '                  (e.g., Material.CORAL, Item.WALKING_STICK)',
            '        ',
            '        Returns:',
            '            Chance percent per roll (e.g., 6.0 for 6%), or None if not found',
            '        """',
            '        # Handle both string and object inputs',
            '        if isinstance(item, str):',
            '            item_name = item',
            '        elif hasattr(item, "name"):',
            '            item_name = item.name',
            '        else:',
            '            return None',
            '        ',
            '        return self._drop_rate_by_name.get(item_name.lower())',
            '    ',
            '    def get_chance_per_chest(self, item) -> Optional[float]:',
            '        """',
            '        Get chance per chest (across all 4 rolls) for an item.',
            '        ',
            '        Args:',
            '            item: Can be a string (item name) or an object with .name attribute',
            '        ',
            '        Returns:',
            '            Chance percent per chest, or None if not found',
            '        """',
            '        chance_per_roll = self.get_drop_rate(item)',
            '        if chance_per_roll:',
            '            # Formula: 1 - (1 - chance_per_roll/100)^4',
            '            # This accounts for 4 independent rolls',
            '            return (1 - pow(1 - chance_per_roll / 100.0, ROLLS_PER_CHEST)) * 100.0',
            '        return None',
            '    ',
            '    def get_expected_chests_per_item(self, item) -> Optional[float]:',
            '        """',
            '        Calculate expected chests needed to get one of the specified item.',
            '        ',
            '        Args:',
            '            item: Can be a string (item name) or an object with .name attribute',
            '        ',
            '        Returns:',
            '            Expected number of chests to open to get 1 of the item, or None if not found',
            '        """',
            '        chance_per_chest = self.get_chance_per_chest(item)',
            '        if chance_per_chest and chance_per_chest > 0:',
            '            return 1.0 / (chance_per_chest / 100.0)',
            '        return None',
            '',
            '',
        ])
        
        # Container class (enum-like)
        lines.extend([
            'class Container:',
            '    """Enum-like class for all containers."""',
            '',
        ])
        
        # Generate container instances
        for container in containers:
            enum_name = name_to_enum(container['name'])
            
            lines.append(f"    {enum_name} = ContainerInfo(")
            lines.append(f"        name={escape_str(container['name'])},")
            lines.append(f"        container_type={escape_str(container['type'])},")
            
            # Add each loot table as a separate attribute
            loot_tables = container['loot_tables']
            
            # Map table names to attribute names
            table_mapping = {
                'Main': 'main_table',
                'Valuables': 'valuables_table',
                'Common': 'common_table',
                'Uncommon': 'uncommon_table',
                'Rare': 'rare_table',
                'Epic': 'epic_table',
                'Legendary': 'legendary_table',
                'Ethereal': 'ethereal_table',
            }
            
            for table_name, attr_name in table_mapping.items():
                if table_name in loot_tables:
                    drops = loot_tables[table_name]
                    lines.append(f"        {attr_name}=[")
                    
                    for drop in drops:
                        item_name = escape_str(drop['item_name'])
                        item_ref = drop.get('item_object')
                        item_ref_str = f'"{item_ref}"' if item_ref else 'None'
                        qty = drop['quantity']
                        chance_per_roll = drop['chance_per_roll']
                        
                        # Build Quantity
                        if qty.is_na:
                            qty_str = "Quantity(is_na=True)"
                        elif qty.is_static:
                            qty_str = f"Quantity(min_qty={qty.min_qty}, max_qty={qty.max_qty})"
                        else:
                            qty_str = f"Quantity(min_qty={qty.min_qty}, max_qty={qty.max_qty})"
                        
                        # Store chance_per_roll from wiki
                        lines.append(f"            DropEntry(item_name={item_name}, item_ref={item_ref_str}, quantity={qty_str}, chance_percent={chance_per_roll:.4f}),")
                    
                    lines.append(f"        ],")
            
            lines.append(f"    )")
            lines.append('')
        
        # Add lookup dicts
        lines.extend([
            '',
            '# Lookup dictionaries',
            'CONTAINERS_BY_NAME = {',
        ])
        
        for container in containers:
            enum_name = name_to_enum(container['name'])
            name_str = escape_str(container['name'])
            lines.append(f"    {name_str}: Container.{enum_name},")
        
        lines.extend([
            '}',
            '',
            'SKILL_CHESTS = [c for c in CONTAINERS_BY_NAME.values() if c.container_type == "skill_chest"]',
            'UNIQUE_OPENABLES = [c for c in CONTAINERS_BY_NAME.values() if c.container_type == "unique_openable"]',
        ])
        
        f.write('\n'.join(lines))
    
    print(f"\n✓ Generated {output_file} with {len(containers)} containers")


if __name__ == '__main__':
    print("Scraping containers from Walkscape wiki...")
    
    # Parse main page
    containers_list = parse_containers_list()
    print(f"\nFound {len(containers_list)} containers from main page")
    
    # Scan folder for additional containers
    if SCAN_FOLDER_FOR_NEW_ITEMS:
        print("\nScanning cache folder for additional containers...")
        folder_containers = scan_cache_folder_for_items(CACHE_DIR, CACHE_FILE)
        if folder_containers:
            # Add type field to folder containers (default to 'chest')
            for container in folder_containers:
                container['type'] = 'chest'
            containers_list = merge_folder_items_with_main_list(containers_list, folder_containers)
    
    # Parse each container page
    containers = []
    for i, container_info in enumerate(containers_list, 1):
        source = "folder" if container_info.get('from_folder') else "wiki"
        print(f"\n[{i}/{len(containers_list)}] Parsing {container_info['name']} (from {source})...")
        container_data = parse_container_page(container_info)
        if container_data:
            containers.append(container_data)
            # Count total drops across all tables
            total_drops = sum(len(drops) for drops in container_data['loot_tables'].values())
            print(f"  ✓ Found {total_drops} drops across {len(container_data['loot_tables'])} tables")
    
    # Link items to their objects
    print("\nLinking items to Material/Item/Consumable objects...")
    try:
        link_items(containers)
        print("✓ Linking complete")
    except Exception as e:
        print(f"✗ Error during linking: {e}")
        import traceback
        traceback.print_exc()
    
    # Generate module
    print("\nGenerating module...")
    try:
        generate_module(containers)
        print("✓ Module generation complete")
    except Exception as e:
        print(f"✗ Error generating module: {e}")
        import traceback
        traceback.print_exc()
    
    # Report validation issues
    print("\nValidation report:")
    validator.report()
