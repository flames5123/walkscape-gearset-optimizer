#!/usr/bin/env python3
"""
Download service icons from Walkscape wiki.

Scrapes the Services wiki page and downloads SVG icons for each service.
Uses the services.py file to get the correct service reference names.

Icons are saved to: assets/icons/services/{service_ref_name}.svg
"""

import requests
import sys
import os
from pathlib import Path
from bs4 import BeautifulSoup

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from util.scrapers.scraper_utils import download_page, get_cache_file, sanitize_filename, name_to_enum

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
WIKI_URL = 'https://wiki.walkscape.app/wiki/Services'
CACHE_FILE = get_cache_file('services_cache.html')
BASE_OUTPUT_DIR = Path('assets/icons/services')

# Custom icon paths for services with non-standard naming
CUSTOM_ICON_PATHS = {
    'Frozen_Forge': 'Frozen_Forge_(Advanced).svg'
}

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

def get_service_ref_name(service_name: str) -> str:
    """Get service reference name (just sanitized filename, not enum name)."""
    # Use sanitized filename - replace spaces with underscores, keep normal capitalization
    ref_name = sanitize_filename(service_name.replace(' ', '_'))
    return ref_name

# ============================================================================
# SCRAPING FUNCTIONS
# ============================================================================

def scrape_service_icons():
    """Scrape service icons from wiki."""
    print("Downloading service icons from wiki...")
    
    # Download wiki page
    html = download_page(WIKI_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        print("✗ Failed to download wiki page")
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Find all wikitable tables
    tables = soup.find_all('table', class_='wikitable')
    print(f"Found {len(tables)} wikitable tables")
    
    services = []
    
    # Parse each table (one per service category)
    for table in tables:
        rows = table.find_all('tr')
        
        # Skip header row
        for row in rows[1:]:  # Skip first row (header)
            cells = row.find_all('td')
            if len(cells) < 2:
                continue
            
            # First cell contains the icon
            icon_cell = cells[0]
            img = icon_cell.find('img')
            
            if not img:
                continue
            
            # Get icon URL
            icon_src = img.get('src', '')
            if not icon_src or not icon_src.endswith('.svg'):
                continue
            
            # Second cell contains the service name
            name_cell = cells[1]
            # Get the link text (service name)
            link = name_cell.find('a')
            if not link:
                continue
            
            service_name = link.get_text(strip=True)
            
            if not service_name:
                continue
            
            # Get reference name from services.py
            ref_name = get_service_ref_name(service_name)
            
            services.append({
                'name': service_name,
                'ref_name': ref_name,
                'icon_url': icon_src
            })
            
            print(f"  Found: {service_name} → {ref_name}")
    
    if not services:
        print("\n✗ No service icons found")
    
    return services

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Service Icon Scraper ===\n")
    
    services = scrape_service_icons()
    
    if services:
        print(f"\n✓ Found {len(services)} service icons")
        print("\nDownloading icons...\n")
        
        success_count = 0
        for service in services:
            name = service['name']
            ref_name = service['ref_name']
            icon_url = service['icon_url']
            
            print(ref_name)
            # Check for custom icon path
            if ref_name in CUSTOM_ICON_PATHS:
                filename = CUSTOM_ICON_PATHS[ref_name].lower()
            else:
                # Create filename from ref_name (lowercase)
                filename = f"{ref_name.lower()}.svg"
            
            # Output path (flat structure in services directory)
            output_path = BASE_OUTPUT_DIR / filename
            
            print(f"{name} → {ref_name} → {filename}")
            if download_icon(icon_url, output_path):
                success_count += 1
        
        print(f"\n✓ Downloaded {success_count}/{len(services)} icons")
        print(f"✓ Icons saved to {BASE_OUTPUT_DIR}/")
    else:
        print("\n✗ No icons to download")
