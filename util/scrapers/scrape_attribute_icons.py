#!/usr/bin/env python3
"""
Download attribute icons from Walkscape wiki.

These icons represent the 14 game attributes that affect gameplay:
- Bonus Experience
- Chest Finding
- Double Action
- Double Rewards
- Find Bird Nests
- Find Collectibles
- Find Gems
- Fine Material Finding
- Inventory Space
- Item Finding
- No Materials Consumed
- Quality Outcome
- Steps Required
- Work Efficiency
"""

import requests
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

# Base URL for wiki images
WIKI_BASE = 'https://wiki.walkscape.app'

# Attribute icons: (wiki_path, output_filename)
# Output filenames use snake_case for consistency
ATTRIBUTE_ICONS = [
    ('/images/d/db/Bonus_Experience.svg', 'bonus_experience.svg'),
    ('/images/d/d9/Chest_Finding.svg', 'chest_finding.svg'),
    ('/images/6/64/Double_Action.svg', 'double_action.svg'),
    ('/images/a/a3/Double_Rewards.svg', 'double_rewards.svg'),
    ('/images/3/3f/Find_Bird_Nests.svg', 'find_bird_nests.svg'),
    ('/images/2/28/Find_Collectibles.svg', 'find_collectibles.svg'),
    ('/images/1/14/Find_Gems.svg', 'find_gems.svg'),
    ('/images/d/df/Fine_Material_Finding.svg', 'fine_material_finding.svg'),
    ('/images/2/2c/Inventory_Space.svg', 'inventory_space.svg'),
    ('/images/c/c2/Items.svg', 'item_finding.svg'),  # "Items" icon = Item Finding
    ('/images/b/b0/No_Materials_Consumed.svg', 'no_materials_consumed.svg'),
    ('/images/d/d2/Quality_Outcome.svg', 'quality_outcome.svg'),
    ('/images/5/59/Steps_Required.svg', 'steps_required.svg'),
    ('/images/8/89/Work_Efficiency.svg', 'work_efficiency.svg'),
]

# Output directory for attribute icons
OUTPUT_DIR = 'assets/icons/attributes'

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
    print("=== Attribute Icon Downloader ===\n")
    print(f"Downloading {len(ATTRIBUTE_ICONS)} attribute icons...\n")
    
    success_count = 0
    for wiki_path, filename in ATTRIBUTE_ICONS:
        url = WIKI_BASE + wiki_path
        output_path = f"{OUTPUT_DIR}/{filename}"
        
        if download_icon(url, output_path):
            success_count += 1
        print()
    
    print(f"✓ Downloaded {success_count}/{len(ATTRIBUTE_ICONS)} icons")
    print(f"✓ Icons saved to {OUTPUT_DIR}/")
