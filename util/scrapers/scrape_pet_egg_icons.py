#!/usr/bin/env python3
"""
Download pet egg icons from Walkscape wiki.

Scrapes the Pet Eggs wiki page and downloads SVG icons for each pet egg.
Icons are saved to: assets/icons/items/pet_eggs/{egg_name}.svg
"""

import requests
import sys
import os
from pathlib import Path
from bs4 import BeautifulSoup

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from util.scrapers.scraper_utils import download_page, get_cache_file, sanitize_filename

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
WIKI_URL = 'https://wiki.walkscape.app/wiki/Pet_Eggs'
CACHE_FILE = get_cache_file('pet_eggs_cache.html')
BASE_OUTPUT_DIR = Path('assets/icons/items/pet_eggs')

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_icon(url: str, output_path: Path) -> bool:
    """Download a single icon SVG file."""
    if not url:
        return False
    
    try:
        # Ensure URL is absolute
        if url.startswith('/'):
            url = 'https://wiki.walkscape.app' + url
        elif not url.startswith('http'):
            url = 'https://wiki.walkscape.app/' + url
        
        print(f"  Downloading: {url}")
        
        # Download the file
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        # Create parent directory if needed
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save to file
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"    ✓ Saved to {output_path}")
        return True
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False

# ============================================================================
# SCRAPING FUNCTIONS
# ============================================================================

def scrape_pet_egg_icons():
    """Scrape pet egg icons from wiki."""
    print("Downloading pet egg icons from wiki...")
    
    # Download wiki page
    html = download_page(WIKI_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        print("✗ Failed to download wiki page")
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Find the wikitable
    table = soup.find('table', class_='wikitable')
    if not table:
        print("✗ Could not find pet eggs table")
        return []
    
    print(f"Found pet eggs table\n")
    
    eggs = []
    
    # Parse table rows
    rows = table.find_all('tr')
    
    for row in rows:
        # Skip header rows
        if row.find('th'):
            continue
        
        # Get all cells in the row
        cells = row.find_all('td')
        if len(cells) < 2:
            continue
        
        # First cell contains the egg icon
        icon_cell = cells[0]
        img = icon_cell.find('img')
        
        if not img:
            continue
        
        # Get icon URL
        icon_src = img.get('src', '')
        if not icon_src or not icon_src.endswith('.svg'):
            continue
        
        # Get egg name from img alt text
        egg_name = img.get('alt', '').strip()
        
        if not egg_name:
            # Try getting from second cell
            name_cell = cells[1]
            egg_name = name_cell.get_text(strip=True)
        
        if not egg_name:
            continue
        
        eggs.append({
            'name': egg_name,
            'icon_url': icon_src
        })
        
        print(f"  Found: {egg_name}")
    
    if not eggs:
        print("\n✗ No pet egg icons found")
    
    return eggs

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Pet Egg Icon Scraper ===\n")
    
    eggs = scrape_pet_egg_icons()
    
    if eggs:
        print(f"\n✓ Found {len(eggs)} pet egg icons")
        print("\nDownloading icons...\n")
        
        success_count = 0
        for egg in eggs:
            name = egg['name']
            icon_url = egg['icon_url']
            
            # Create filename (lowercase)
            safe_name = name.replace(' ', '_').lower()
            filename = f"{safe_name}.svg"
            
            # Create output path
            output_path = BASE_OUTPUT_DIR / filename
            
            print(f"{name}")
            if download_icon(icon_url, output_path):
                success_count += 1
        
        print(f"\n✓ Downloaded {success_count}/{len(eggs)} icons")
        print(f"✓ Icons saved to {BASE_OUTPUT_DIR}/")
    else:
        print("\n✗ No icons to download")
