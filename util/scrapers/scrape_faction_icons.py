#!/usr/bin/env python3
"""
Download faction icons from Walkscape wiki.

Scrapes the Faction Reputation wiki page and downloads SVG icons
for each faction from the "Faction Reward Tracks" section.

Icons are saved to: assets/icons/factions/
"""

import requests
from pathlib import Path
from bs4 import BeautifulSoup
from scraper_utils import download_page, get_cache_file

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
WIKI_URL = 'https://wiki.walkscape.app/wiki/Faction_Reputation'
CACHE_FILE = get_cache_file('faction_reputation_cache.html')
OUTPUT_DIR = Path('assets/icons/factions')

# Faction name mappings
FACTION_NAMES = {
    "jarvonia": "jarvonia",
    "trellin": "trellin",
    "erdwise": "erdwise",
    "halfling": "halfling_rebels",
    "syrenthia": "syrenthia",
    "herbert": "herberts_guiding_grounds"
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_icon(url: str, filename: str) -> bool:
    """Download a single icon SVG file."""
    if not url:
        return False
    
    try:
        # Ensure URL is absolute
        if url.startswith('/'):
            url = 'https://wiki.walkscape.app' + url
        elif not url.startswith('http'):
            url = 'https://wiki.walkscape.app' + url
        
        print(f"  Downloading: {url}")
        
        # Download the file
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        # Save to file
        output_path = OUTPUT_DIR / filename
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"    ✓ Saved to {output_path}")
        return True
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False

def extract_faction_name(text: str) -> str:
    """Extract faction name from text and return standardized filename."""
    text_lower = text.lower()
    
    for key, filename in FACTION_NAMES.items():
        if key in text_lower:
            return filename
    
    return None

# ============================================================================
# SCRAPING FUNCTIONS
# ============================================================================

def scrape_faction_icons():
    """Scrape faction icons from wiki."""
    print("Downloading faction icons from wiki...")
    
    # Download wiki page
    html = download_page(WIKI_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        print("✗ Failed to download wiki page")
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}\n")
    
    # Find the "Faction Reward Tracks" section
    faction_icons = []
    
    # Look for all images and their surrounding context
    images = soup.find_all('img')
    print(f"Found {len(images)} images on page")
    
    for img in images:
        src = img.get('src', '')
        alt = img.get('alt', '')
        
        # Look for Coat of Arms images
        if 'coat_of_arms' in src.lower():
            # Try to find faction name from alt text
            faction_name = extract_faction_name(alt)
            
            # If not found in alt, look in surrounding text
            if not faction_name:
                # Get parent elements and search for faction names
                parent = img.parent
                while parent and not faction_name:
                    text = parent.get_text()
                    faction_name = extract_faction_name(text)
                    parent = parent.parent
            
            faction_icons.append({
                'src': src,
                'alt': alt,
                'faction_name': faction_name,
                'title': img.get('title', '')
            })
            
            if faction_name:
                print(f"  Found: {faction_name}")
            else:
                print(f"  Found: {alt or src} (faction name unknown)")
    
    if not faction_icons:
        print("\n✗ No Coat of Arms icons found")
    
    return faction_icons

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Faction Icon Scraper ===\n")
    
    icons = scrape_faction_icons()
    
    if icons:
        print(f"\n✓ Found {len(icons)} faction icons")
        print("\nDownloading icons...\n")
        
        success_count = 0
        for i, icon in enumerate(icons, 1):
            # Use faction name if found, otherwise use generic name
            if icon['faction_name']:
                filename = f"{icon['faction_name']}.svg"
            else:
                filename = f"faction_{i}.svg"
            
            faction_display = icon['faction_name'] or icon['alt'] or f"faction_{i}"
            print(f"{i}. {faction_display}")
            if download_icon(icon['src'], filename):
                success_count += 1
        
        print(f"\n✓ Downloaded {success_count}/{len(icons)} icons")
    else:
        print("\n✗ No icons to download")
