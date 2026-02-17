#!/usr/bin/env python3
"""
Scrape icons from Walkscape wiki and organize into directory structure.

Downloads SVG icons from cached HTML files and organizes them into:
- assets/icons/items/equipment/
- assets/icons/items/consumables/
- assets/icons/items/collectibles/
- assets/icons/items/containers/

Generates icon_map.py mapping item names to icon paths.
"""

import os
import re
import requests
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, List, Tuple

from scraper_utils import (
    get_cache_dir, sanitize_filename, clean_text
)

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False  # Set to True to re-download icons
WIKI_BASE_URL = 'https://wiki.walkscape.app'

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_icon_url_from_html(html_content: str, item_type: str = 'equipment') -> str | None:
    """Extract icon URL from cached HTML page."""
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # For containers, look for the first img with the item name in alt text
    if item_type == 'container':
        # Find all images
        images = soup.find_all('img')
        for img in images:
            alt = img.get('alt', '').lower()
            src = img.get('src', '')
            
            # Skip type icons and small icons
            if 'type_' in src.lower() or 'chest_finding' in src.lower():
                continue
            
            # This should be the item icon
            if src and '/images/' in src:
                # Convert to full URL if relative
                if src.startswith('/'):
                    src = WIKI_BASE_URL + src
                return src
        
        return None
    
    # For equipment/consumables, look for ANY image in the page
    # (many equipment pages have Lua errors so no infobox)
    images = soup.find_all('img')
    for img in images:
        src = img.get('src', '')
        alt = img.get('alt', '').lower()
        
        # Skip UI icons, type icons, and tiny icons
        if any(skip in src.lower() for skip in ['type_', 'ui-', 'icon-', 'magnify-clip']):
            continue
        
        # Skip very small images (likely UI elements)
        width = img.get('width', '')
        if width and width.isdigit() and int(width) < 50:
            continue
        
        # This should be the item icon
        if src and '/images/' in src:
            # Convert to full URL if relative
            if src.startswith('/'):
                src = WIKI_BASE_URL + src
            return src
    
    return None


def download_icon_by_name(item_name: str, output_path: str) -> bool:
    """
    Download an icon by constructing the direct wiki image URL.
    
    Wiki stores images at: /images/X/XY/Filename.svg
    We need the direct file URL, not the wiki page URL
    """
    if os.path.exists(output_path) and not RESCRAPE:
        return True
    
    # Convert item name to wiki filename format
    filename = item_name.replace(' ', '_') + '.svg'
    
    # Get first character and first two characters (lowercase)
    first_char = filename[0].lower()
    first_two = filename[:2].lower()
    
    # Construct DIRECT image URL (not wiki page)
    url = f"{WIKI_BASE_URL}/images/{first_char}/{first_two}/{filename}"
    
    try:
        response = requests.get(url, timeout=10)
        
        # Check if we got HTML instead of SVG
        content_type = response.headers.get('content-type', '')
        if 'text/html' in content_type:
            # We got a wiki page, not the image
            return False
        
        response.raise_for_status()
        
        # Verify it's actually SVG content
        content = response.content
        if b'<!DOCTYPE html>' in content[:100] or b'<html' in content[:100]:
            # This is HTML, not SVG
            return False
        
        # Create directory if needed
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Write file
        with open(output_path, 'wb') as f:
            f.write(content)
        
        return True
    except Exception as e:
        return False


def process_items_by_name(item_names: List[str], output_dir: str, item_type: str) -> Dict[str, str]:
    """
    Download icons for items by name (when cache doesn't have proper HTML).
    
    Returns:
        Dict mapping item names to icon paths
    """
    icon_map = {}
    
    print(f"  Processing {len(item_names)} items by name")
    
    for item_name in item_names:
        # Sanitize filename (lowercase)
        filename = sanitize_filename(item_name.replace(' ', '_') + '.svg').lower()
        
        # Build output path
        output_path = os.path.join(output_dir, filename)
        
        # Try to download
        if download_icon_by_name(item_name, output_path):
            # Store mapping
            relative_path = output_path.replace('assets/', '')
            icon_map[item_name] = relative_path
            print(f"  ✓ {item_name}")
        else:
            # Try from cache as fallback
            pass
    
    return icon_map


def download_icon(url: str, output_path: str) -> bool:
    """Download an icon from URL to output path."""
    if os.path.exists(output_path) and not RESCRAPE:
        return True
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        # Create directory if needed
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Write file
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        return True
    except Exception as e:
        print(f"  ✗ Failed to download {url}: {e}")
        return False


def process_cache_directory(cache_dir: str, output_dir: str, item_type: str) -> Dict[str, str]:
    """
    Process all HTML files in a cache directory and download icons.
    
    Returns:
        Dict mapping item names to icon paths
    """
    icon_map = {}
    cache_path = Path(cache_dir)
    
    if not cache_path.exists():
        print(f"  ⚠ Cache directory not found: {cache_dir}")
        return icon_map
    
    html_files = list(cache_path.glob('*.html'))
    print(f"  Found {len(html_files)} cached HTML files")
    
    for html_file in html_files:
        # Get item name from filename
        item_name = html_file.stem
        
        # Read HTML
        with open(html_file, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # Extract icon URL
        icon_url = get_icon_url_from_html(html_content, item_type)
        if not icon_url:
            print(f"  ⚠ No icon found for {item_name}")
            continue
        
        # Determine output filename
        # Convert URL like /images/thumb/a/ab/Item.svg/150px-Item.svg.png to Item.svg
        filename = icon_url.split('/')[-1]
        
        # URL decode the filename (handles %27 -> ')
        from urllib.parse import unquote
        filename = unquote(filename)
        
        # Remove size prefix if present (150px-Item.svg.png -> Item.svg)
        if filename.startswith(('150px-', '200px-', '300px-')):
            filename = filename.split('-', 1)[1]
        
        # Remove .png extension if it's a .svg.png
        if filename.endswith('.svg.png'):
            filename = filename[:-4]  # Remove .png, keep .svg
        
        # Sanitize filename (removes problematic chars but keeps apostrophes)
        filename = sanitize_filename(filename).lower()  # Convert to lowercase
        
        # Build output path
        output_path = os.path.join(output_dir, filename)
        
        # Download icon
        if download_icon(icon_url, output_path):
            # Store mapping (item name -> relative path from assets/)
            relative_path = output_path.replace('assets/', '')
            icon_map[item_name] = relative_path
            print(f"  ✓ {item_name} -> {filename}")
        else:
            print(f"  ✗ Failed: {item_name}")
    
    return icon_map


# ============================================================================
# MAIN FUNCTIONS
# ============================================================================

def scrape_equipment_icons() -> Dict[str, str]:
    """Scrape equipment icons from cached HTML files."""
    print("\n=== Scraping Equipment Icons ===")
    cache_dir = 'util/cache/equipment_cache'
    output_dir = 'assets/icons/items/equipment'
    return process_cache_directory(cache_dir, output_dir, 'equipment')


def scrape_consumable_icons() -> Dict[str, str]:
    """Scrape consumable icons from cached HTML files."""
    print("\n=== Scraping Consumable Icons ===")
    cache_dir = 'util/cache/consumables_cache'
    output_dir = 'assets/icons/items/consumables'
    return process_cache_directory(cache_dir, output_dir, 'consumable')


def scrape_material_icons() -> Dict[str, str]:
    """Scrape material icons from cached HTML files."""
    print("\n=== Scraping Material Icons ===")
    cache_dir = 'util/cache/materials_cache'
    output_dir = 'assets/icons/items/materials'
    return process_cache_directory(cache_dir, output_dir, 'material')


def scrape_collectible_icons() -> Dict[str, str]:
    """Scrape collectible icons from the main collectibles page."""
    print("\n=== Scraping Collectible Icons ===")
    
    cache_file = 'util/cache/collectibles_cache.html'
    output_dir = 'assets/icons/items/collectibles'
    
    if not os.path.exists(cache_file):
        print(f"  ⚠ Cache file not found: {cache_file}")
        return {}
    
    # Read the collectibles page HTML
    with open(cache_file, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    soup = BeautifulSoup(html_content, 'html.parser')
    icon_map = {}
    
    # Find the collectibles table
    tables = soup.find_all('table', class_='wikitable')
    if not tables:
        print("  ⚠ No wikitable found")
        return {}
    
    print(f"  Found {len(tables)} tables")
    
    # Parse ALL tables (collectibles are in multiple tables)
    for table_idx, table in enumerate(tables):
        print(f"  Processing table {table_idx + 1}...")
        
        for row in table.find_all('tr')[1:]:  # Skip header
            cells = row.find_all('td')
            if len(cells) < 2:
                continue
            
            # First cell has the icon
            img = cells[0].find('img')
            if not img or not img.get('src'):
                continue
            
            # Second cell has the name
            name_cell = cells[1]
            name_link = name_cell.find('a')
            if not name_link:
                continue
            
            collectible_name = clean_text(name_link.get_text())
            icon_url = img['src']
            
            # Convert to full URL
            if icon_url.startswith('/'):
                icon_url = WIKI_BASE_URL + icon_url
            
            # Determine output filename
            filename = icon_url.split('/')[-1]
            from urllib.parse import unquote
            filename = unquote(filename)
            
            # Remove size prefix
            if filename.startswith(('150px-', '200px-', '300px-')):
                filename = filename.split('-', 1)[1]
            
            # Remove .png extension if it's a .svg.png
            if filename.endswith('.svg.png'):
                filename = filename[:-4]
            
            filename = sanitize_filename(filename).lower()  # Convert to lowercase
            output_path = os.path.join(output_dir, filename)
            
            # Download icon
            if download_icon(icon_url, output_path):
                relative_path = output_path.replace('assets/', '')
                icon_map[collectible_name] = relative_path
                print(f"  ✓ {collectible_name} -> {filename}")
            else:
                print(f"  ✗ Failed: {collectible_name}")
    
    return icon_map


def scrape_container_icons() -> Dict[str, str]:
    """Scrape container icons from cached HTML files."""
    print("\n=== Scraping Container Icons ===")
    cache_dir = 'util/cache/containers_cache'
    output_dir = 'assets/icons/items/containers'
    return process_cache_directory(cache_dir, output_dir, 'container')

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("Walkscape Icon Scraper")
    print("=" * 60)
    
    all_icons = {}
    
    # Scrape all icon types
    equipment_icons = scrape_equipment_icons()
    print(f"  Equipment: {len(equipment_icons)} icons")
    all_icons.update(equipment_icons)
    
    consumable_icons = scrape_consumable_icons()
    print(f"  Consumables: {len(consumable_icons)} icons")
    all_icons.update(consumable_icons)
    
    material_icons = scrape_material_icons()
    print(f"  Materials: {len(material_icons)} icons")
    all_icons.update(material_icons)
    
    collectible_icons = scrape_collectible_icons()
    print(f"  Collectibles: {len(collectible_icons)} icons")
    all_icons.update(collectible_icons)
    
    container_icons = scrape_container_icons()
    print(f"  Containers: {len(container_icons)} icons")
    all_icons.update(container_icons)
    
    print("\n" + "=" * 60)
    print(f"✓ Downloaded {len(all_icons)} icons total")
    print(f"  Equipment: {len(equipment_icons)}")
    print(f"  Consumables: {len(consumable_icons)}")
    print(f"  Materials: {len(material_icons)}")
    print(f"  Collectibles: {len(collectible_icons)}")
    print(f"  Containers: {len(container_icons)}")
    print("✓ Icon scraping complete!")
