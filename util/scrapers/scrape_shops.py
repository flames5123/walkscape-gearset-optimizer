#!/usr/bin/env python3
"""
Scrape shop inventories from Walkscape wiki and generate shops.py.

Start page: https://wiki.walkscape.app/wiki/Shops
Then follows links to individual shop pages to parse inventory tables.
"""

import os
import re
from bs4 import BeautifulSoup
from scraper_utils import *
from util.misc_utils import build_all_item_lookups, resolve_item_reference, name_to_enum

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
SHOPS_URL = 'https://wiki.walkscape.app/wiki/Shops'
CACHE_DIR = get_cache_dir('shops')

# Create validator instance
validator = ScraperValidator()

# Caption text -> item_type mapping
CAPTION_TO_TYPE = {
    'loot': 'Loot',
    'tools': 'Tool',
    'tool': 'Tool',
    'consumables': 'Consumable',
    'consumable': 'Consumable',
    'materials': 'Material',
    'material': 'Material',
    'containers': 'Container',
    'container': 'Container',
    'collectibles': 'Collectible',
    'collectible': 'Collectible',
    'cosmetics': 'Cosmetic',
    'cosmetic': 'Cosmetic',
    'pets': 'Pet',
    'pet': 'Pet',
    'pet eggs': 'Pet',
}

# Rarity file names -> rarity string (for reference, not used in output)
RARITY_MAP = {
    'rarity_common': 'common',
    'rarity_uncommon': 'uncommon',
    'rarity_rare': 'rare',
    'rarity_epic': 'epic',
    'rarity_legendary': 'legendary',
    'rarity_ethereal': 'ethereal',
    'quality_normal': 'common',
    'quality_good': 'uncommon',
    'quality_great': 'rare',
    'quality_excellent': 'epic',
    'quality_perfect': 'legendary',
    'quality_eternal': 'ethereal',
}


# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def parse_shops_main():
    """Parse the main Shops page to get all shop names, links, and regions."""
    os.makedirs(CACHE_DIR, exist_ok=True)

    main_cache = CACHE_DIR / 'shops_main.html'
    html = download_page(SHOPS_URL, main_cache, rescrape=RESCRAPE)
    if not html:
        print("ERROR: Failed to download shops page")
        return []

    soup = BeautifulSoup(html, 'html.parser')
    shops = []

    # Find region headings (h1 with mw-heading) and their tables
    current_region = 'Unknown'

    for element in soup.find_all(['div', 'table']):
        # Check for region heading
        if element.name == 'div' and 'mw-heading' in element.get('class', []):
            heading = element.find(['h1', 'h2'])
            if heading:
                region_text = clean_text(heading.get_text())
                # Skip the generic "Shops" heading
                if region_text.lower() != 'shops':
                    current_region = region_text

        # Check for shop table
        if element.name == 'table' and 'wikitable' in element.get('class', []):
            rows = element.find_all('tr')
            for row in rows:
                cells = row.find_all('td')
                if len(cells) < 4:
                    continue

                # Cell layout: [icon, shop_name, building_type, location, description]
                # Shop name is in cell 1 with a link
                name_cell = cells[1]
                link = name_cell.find('a')
                if not link:
                    continue

                shop_name = clean_text(link.get_text())
                if not shop_name:
                    continue

                href = link.get('href', '')
                # Links use /wiki/Special:MyLanguage/Shop_Name format
                # Convert to direct wiki URL
                if '/Special:MyLanguage/' in href:
                    href = href.replace('/Special:MyLanguage/', '/')
                shop_url = 'https://wiki.walkscape.app' + href if href.startswith('/') else href

                building_type = clean_text(cells[2].get_text())
                location = clean_text(cells[3].get_text())

                shops.append({
                    'name': shop_name,
                    'building_type': building_type,
                    'location': location,
                    'region': current_region,
                    'url': shop_url,
                })

    return shops


def parse_shop_inventory(shop_html, shop_name):
    """Parse inventory tables from a shop page.
    
    Each shop page has multiple wikitable tables, each with a caption
    indicating the type (Loot, Tools, Material, Consumable, etc.).
    
    Row structure: [icon_cell, item_name_cell, rarity_icon_cell, stock_cell, price_cell]
    """
    soup = BeautifulSoup(shop_html, 'html.parser')
    inventory = []

    # Find all inventory tables (wikitable sortable, NOT the infobox)
    tables = soup.find_all('table', class_='wikitable')
    for table in tables:
        # Skip the infobox table
        if 'ItemInfobox' in table.get('class', []):
            continue

        # Get caption to determine item type
        caption = table.find('caption')
        if not caption:
            continue

        caption_text = clean_text(caption.get_text()).lower()

        # Map caption to item_type
        item_type = None
        for key, val in CAPTION_TO_TYPE.items():
            if key in caption_text:
                item_type = val
                break

        if not item_type:
            validator.add_item_issue(shop_name, [f"Unknown table caption: '{caption_text}'"])
            continue

        # Parse rows
        rows = table.find_all('tr')
        for row in rows:
            cells = row.find_all('td')
            if len(cells) < 4:
                continue

            # Extract item name from second cell (first is icon)
            name_cell = cells[1]
            item_link = name_cell.find('a')
            if not item_link:
                continue
            item_name = clean_text(item_link.get_text())
            if not item_name:
                continue

            # Extract stock and price
            # Stock is in cell index 3, price in cell index 4
            # But some tables have 5 cells (icon, name, rarity_icon, stock, price)
            # and some might have fewer
            if len(cells) >= 5:
                stock_text = clean_text(cells[3].get_text())
                price_text = clean_text(cells[4].get_text())
            elif len(cells) == 4:
                stock_text = clean_text(cells[2].get_text())
                price_text = clean_text(cells[3].get_text())
            else:
                continue

            # Parse stock (remove commas)
            try:
                stock = int(stock_text.replace(',', ''))
            except ValueError:
                stock = 1

            # Parse price (remove commas)
            try:
                price = int(price_text.replace(',', ''))
            except ValueError:
                price = 0

            # Determine currency from price cell links and images
            currency = 'coins'
            price_cell = cells[-1]
            price_links = price_cell.find_all('a')
            for pl in price_links:
                href = pl.get('href', '').lower()
                title = pl.get('title', '').strip()
                if 'adventurer' in href and 'guild' in href and 'token' in href:
                    currency = 'adventurers_guild_token'
                    break
                elif 'coin' not in href and href:
                    # Try link text first, then title attribute (wiki uses image-only links)
                    currency_name = clean_text(pl.get_text())
                    if not currency_name and title:
                        currency_name = title
                    if currency_name:
                        currency = currency_name.lower().replace(' ', '_')
                    break

            inventory.append({
                'item_name': item_name,
                'stock': stock,
                'price': price,
                'currency': currency,
                'item_type': item_type,
            })

    return inventory


def scrape_all_shops():
    """Scrape main page and all individual shop pages."""
    print("Parsing main shops page...")
    shops = parse_shops_main()
    print(f"  Found {len(shops)} shops")

    # Build item lookups for resolving references
    print("Building item lookups...")
    lookups = build_all_item_lookups()

    # Download and parse each shop page
    for shop in shops:
        cache_file = CACHE_DIR / f'{sanitize_filename(shop["name"])}.html'
        shop_html = download_page(shop['url'], cache_file, rescrape=RESCRAPE)

        if not shop_html:
            print(f"  ⚠ Failed to download: {shop['name']}")
            shop['inventory'] = []
            continue

        inventory = parse_shop_inventory(shop_html, shop['name'])
        shop['inventory'] = inventory

        # Resolve item references
        for item in inventory:
            item['item_ref'] = resolve_item_reference(item['item_name'], lookups)
            if not item['item_ref']:
                validator.add_item_issue(shop['name'], [f"Could not resolve: {item['item_name']}"])

        if inventory:
            print(f"  ✓ {shop['name']}: {len(inventory)} items")
        else:
            print(f"  - {shop['name']}: empty")

    return shops


# ============================================================================
# MODULE GENERATION
# ============================================================================

def escape_str(s):
    """Escape a string for use in Python source code."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


def generate_module(shops):
    """Generate the shops.py module."""
    output_file = get_output_file('shops.py')

    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Shop data from Walkscape wiki', 'scrape_shops.py')
        write_imports(f, [
            'from dataclasses import dataclass, field',
            'from typing import List, Optional, Dict',
        ])

        lines = []
        lines.append('')
        lines.append('')
        lines.append('@dataclass')
        lines.append('class ShopItem:')
        lines.append("    \"\"\"An item sold in a shop.\"\"\"")
        lines.append('    item_name: str')
        lines.append('    stock: int')
        lines.append('    price: int')
        lines.append("    currency: str  # 'coins' or 'adventurers_guild_token' or material name")
        lines.append("    item_type: str  # Loot, Tool, Consumable, Material, Container, Collectible, Cosmetic")
        lines.append('    item_ref: Optional[str] = None')
        lines.append('')
        lines.append('')
        lines.append('@dataclass')
        lines.append('class ShopInfo:')
        lines.append("    \"\"\"Information about a shop.\"\"\"")
        lines.append('    name: str')
        lines.append('    building_type: str')
        lines.append('    location: str')
        lines.append('    region: str')
        lines.append('    requirements: List[str] = field(default_factory=list)')
        lines.append('    inventory: List[ShopItem] = field(default_factory=list)')
        lines.append('')
        lines.append('')
        lines.append('# ============================================================================')
        lines.append('# SHOP DATA')
        lines.append('# ============================================================================')

        # Group shops by region
        regions = {}
        for shop in shops:
            region = shop['region']
            if region not in regions:
                regions[region] = []
            regions[region].append(shop)

        var_names = []

        for region, region_shops in regions.items():
            lines.append('')
            lines.append(f'# --- {region} ---')
            lines.append('')

            for shop in region_shops:
                var_name = name_to_enum(shop['name'])
                var_names.append(var_name)

                inventory = shop.get('inventory', [])

                if not inventory:
                    lines.append(f'{var_name} = ShopInfo(')
                    lines.append(f"    name='{escape_str(shop['name'])}', building_type='{escape_str(shop['building_type'])}',")
                    lines.append(f"    location='{escape_str(shop['location'])}', region='{escape_str(shop['region'])}',")
                    lines.append(')')
                else:
                    lines.append(f'{var_name} = ShopInfo(')
                    lines.append(f"    name='{escape_str(shop['name'])}', building_type='{escape_str(shop['building_type'])}',")
                    lines.append(f"    location='{escape_str(shop['location'])}', region='{escape_str(shop['region'])}',")
                    lines.append('    inventory=[')
                    for item in inventory:
                        ref_str = f"'{item['item_ref']}'" if item.get('item_ref') else 'None'
                        lines.append(f"        ShopItem('{escape_str(item['item_name'])}', {item['stock']}, {item['price']}, '{item['currency']}', '{item['item_type']}', {ref_str}),")
                    lines.append('    ],')
                    lines.append(')')
                lines.append('')

        # ALL_SHOPS list
        lines.append('')
        lines.append('# ============================================================================')
        lines.append('# LOOKUP HELPERS')
        lines.append('# ============================================================================')
        lines.append('')
        lines.append('ALL_SHOPS: List[ShopInfo] = [')
        # Write 4 per line
        for i in range(0, len(var_names), 4):
            chunk = var_names[i:i+4]
            lines.append('    ' + ', '.join(chunk) + ',')
        lines.append(']')
        lines.append('')
        lines.append("SHOPS_BY_NAME: Dict[str, ShopInfo] = {shop.name: shop for shop in ALL_SHOPS}")
        lines.append('')
        lines.append('')
        lines.append('def get_shop_item_names() -> set:')
        lines.append('    """Get flat set of all equipment/collectible item names sold in shops."""')
        lines.append('    names = set()')
        lines.append('    for shop in ALL_SHOPS:')
        lines.append('        for item in shop.inventory:')
        lines.append("            if item.item_type in ('Loot', 'Tool', 'Collectible'):")
        lines.append('                names.add(item.item_name)')
        lines.append('    return names')
        lines.append('')
        lines.append('')
        lines.append("def get_items_by_shop() -> Dict[str, List[str]]:")
        lines.append('    """Get equipment/collectible item names grouped by shop name."""')
        lines.append('    result = {}')
        lines.append('    for shop in ALL_SHOPS:')
        lines.append('        items = []')
        lines.append('        for item in shop.inventory:')
        lines.append("            if item.item_type in ('Loot', 'Tool', 'Collectible'):")
        lines.append('                items.append(item.item_name)')
        lines.append('        if items:')
        lines.append('            result[shop.name] = items')
        lines.append('    return result')
        lines.append('')

        f.write('\n'.join(lines))

    # Count stats
    total_items = sum(len(s.get('inventory', [])) for s in shops)
    populated = sum(1 for s in shops if s.get('inventory'))
    print(f"✓ Generated {output_file}")
    print(f"  {len(shops)} shops ({populated} with inventory, {len(shops) - populated} empty)")
    print(f"  {total_items} total items across all shops")


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("Scraping shop inventories...")
    shops = scrape_all_shops()
    print(f"\nFound {len(shops)} shops")
    generate_module(shops)
    validator.report()
