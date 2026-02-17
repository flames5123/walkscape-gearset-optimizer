#!/usr/bin/env python3
"""
Download Item Finding icons from Walkscape wiki.
These are the Find_X.svg icons used for item finding stats.
"""

import os
import re
import requests
from pathlib import Path
from bs4 import BeautifulSoup

# Configuration
ITEM_FINDING_URL = 'https://wiki.walkscape.app/wiki/Item_Finding_Items'
ICONS_DIR = Path('assets/icons/attributes')  # Store with other attribute icons

# Icons to exclude (these are direct items, not categories)
EXCLUDE_ICONS = {
    'find_bird_nest.svg',
    'find_coin_pouch.svg',
}

# Ensure directory exists
ICONS_DIR.mkdir(parents=True, exist_ok=True)

def download_icon(icon_url, filename):
    """Download an icon from the wiki"""
    try:
        response = requests.get(icon_url, timeout=10)
        response.raise_for_status()
        
        filepath = ICONS_DIR / filename
        with open(filepath, 'wb') as f:
            f.write(response.content)
        
        print(f"  ✓ Downloaded: {filename}")
        return True
    except Exception as e:
        print(f"  ✗ Failed to download {filename}: {e}")
        return False


def main():
    """Main scraping logic"""
    print("Downloading Item Finding Items page...")
    
    try:
        response = requests.get(ITEM_FINDING_URL, timeout=10)
        response.raise_for_status()
        html = response.text
    except Exception as e:
        print(f"Failed to download page: {e}")
        return
    
    soup = BeautifulSoup(html, 'html.parser')
    
    # Find all images with "Find_" in the src
    icons_found = set()
    
    for img in soup.find_all('img'):
        src = img.get('src', '')
        if 'Find_' in src or 'find_' in src:
            # Extract the filename
            filename_match = re.search(r'(Find_[^/]+\.svg)', src, re.IGNORECASE)
            if filename_match:
                filename = filename_match.group(1)
                
                # Convert to lowercase
                filename_lower = filename.lower()
                
                # Skip excluded icons
                if filename_lower in EXCLUDE_ICONS:
                    print(f"  Skipping: {filename_lower}")
                    continue
                
                # Build full URL
                if src.startswith('http'):
                    icon_url = src
                else:
                    icon_url = 'https://wiki.walkscape.app' + src
                
                icons_found.add((filename_lower, icon_url))
    
    print(f"\nFound {len(icons_found)} unique Find_* icons")
    
    # Download each icon
    print("\nDownloading icons...")
    success_count = 0
    for filename, icon_url in sorted(icons_found):
        if download_icon(icon_url, filename):
            success_count += 1
    
    print(f"\n✓ Downloaded {success_count}/{len(icons_found)} icons to {ICONS_DIR}")
    
    # List what we got
    print("\nIcons downloaded:")
    for filepath in sorted(ICONS_DIR.glob('find_*.svg')):
        print(f"  - {filepath.name}")


if __name__ == '__main__':
    main()
