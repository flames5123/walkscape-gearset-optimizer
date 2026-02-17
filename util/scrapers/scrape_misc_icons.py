#!/usr/bin/env python3
"""
Download miscellaneous icons from Walkscape wiki.
"""

import requests
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

# Icons to download: (url, output_path)
ICONS = [
    (
        'https://wiki.walkscape.app/images/6/62/Coins.svg',
        'assets/icons/items/coins.svg'
    ),
    (
        'https://wiki.walkscape.app/images/5/55/Achievement_Point_Icon.svg',
        'assets/icons/text/general_icons/achievement_points.svg'
    ),
    (
        'https://wiki.walkscape.app/images/3/34/Adventurers%27_guild_token.svg',
        'assets/icons/items/adventurers\'_guild_token.svg'
    ),
    (
        'https://wiki.walkscape.app/images/c/c2/Items.svg',
        'assets/icons/items.svg'
    ),
    (
        'https://wiki.walkscape.app/images/1/13/Activities.svg',
        'assets/icons/activities.svg'
    ),
    (
        'https://wiki.walkscape.app/images/e/e5/Skills.svg',
        'assets/icons/character.svg'
    ),
]

# ============================================================================
# DOWNLOAD FUNCTION
# ============================================================================

def download_icon(url: str, output_path: str) -> bool:
    """Download a single icon SVG file."""
    try:
        print(f"Downloading: {url}")
        
        # Download the file
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        # Create output directory if needed
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Save to file
        with open(output_file, 'wb') as f:
            f.write(response.content)
        
        print(f"  ✓ Saved to {output_path}")
        return True
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Miscellaneous Icon Downloader ===\n")
    
    success_count = 0
    for url, output_path in ICONS:
        if download_icon(url, output_path):
            success_count += 1
        print()
    
    print(f"✓ Downloaded {success_count}/{len(ICONS)} icons")
