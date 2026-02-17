#!/usr/bin/env python3
"""
Download skill and category icons from Walkscape wiki.

Downloads icons for:
- Individual skills (Fishing, Mining, etc.)
- Skill categories (Gathering, Artisan, Utility)
"""

import os
import re
import requests
from pathlib import Path
from bs4 import BeautifulSoup

# ============================================================================
# CONFIGURATION
# ============================================================================

SKILLS_PAGE_URL = 'https://wiki.walkscape.app/wiki/Skills'
BASE_URL = 'https://wiki.walkscape.app'

# Output directories
SKILL_ICONS_DIR = Path('assets/icons/text/skill_icons')
SKILL_TYPES_DIR = Path('assets/icons/text/skill_types')

# ============================================================================
# SCRAPING FUNCTIONS
# ============================================================================

def scrape_skill_icons():
    """Scrape the Skills page to find all icon URLs."""
    print(f"Fetching {SKILLS_PAGE_URL}...")
    
    try:
        response = requests.get(SKILLS_PAGE_URL, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find all images that are SVG files
        icons = {}
        
        for img in soup.find_all('img'):
            src = img.get('src', '')
            
            # Only process SVG files
            if not src.endswith('.svg'):
                continue
            
            # Extract the filename (e.g., "Fishing.svg")
            filename = src.split('/')[-1]
            name = filename.replace('.svg', '').lower()
            
            # Store the full path
            icons[name] = src
            print(f"Found: {name} -> {src}")
        
        return icons
        
    except Exception as e:
        print(f"Error scraping page: {e}")
        return {}

# ============================================================================
# DOWNLOAD FUNCTIONS
# ============================================================================

def download_icon(url: str, output_path: Path):
    """Download an icon from the wiki."""
    full_url = BASE_URL + url if url.startswith('/') else url
    
    try:
        print(f"  Downloading {output_path.name}...")
        response = requests.get(full_url, timeout=10)
        response.raise_for_status()
        
        # Create parent directory if needed
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Write file
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"    ✓ Saved to {output_path}")
        return True
        
    except Exception as e:
        print(f"    ✗ Failed: {e}")
        return False

def download_all_icons():
    """Download all skill and category icons."""
    # Scrape the page to find icon URLs
    icons = scrape_skill_icons()
    
    if not icons:
        print("No icons found!")
        return
    
    print()
    print(f"Found {len(icons)} icons")
    print()
    
    # Define which icons go where
    skill_names = ['fishing', 'foraging', 'mining', 'woodcutting', 
                   'carpentry', 'cooking', 'crafting', 'smithing', 'trinketry', 'agility']
    category_names = ['gathering', 'artisan', 'utility']
    
    success_count = 0
    fail_count = 0
    
    # Download skill icons
    print("Downloading skill icons...")
    for skill_name in skill_names:
        if skill_name in icons:
            output_path = SKILL_ICONS_DIR / f"{skill_name}.svg"
            if download_icon(icons[skill_name], output_path):
                success_count += 1
            else:
                fail_count += 1
        else:
            print(f"  ⚠ Icon not found for: {skill_name}")
    
    print()
    print("Downloading category icons...")
    
    # Download category icons
    for category_name in category_names:
        if category_name in icons:
            output_path = SKILL_TYPES_DIR / f"{category_name}.svg"
            if download_icon(icons[category_name], output_path):
                success_count += 1
            else:
                fail_count += 1
        else:
            print(f"  ⚠ Icon not found for: {category_name}")
    
    print()
    print(f"✓ Downloaded {success_count} icons")
    if fail_count > 0:
        print(f"✗ Failed to download {fail_count} icons")

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    download_all_icons()
