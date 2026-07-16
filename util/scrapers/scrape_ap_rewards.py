#!/usr/bin/env python3
"""
Scrape Achievement Points reward track from Walkscape wiki.
Generates ap_rewards.py with all AP checkpoint and progress rewards.
"""

from bs4 import BeautifulSoup
from scraper_utils import *

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
AP_URL = 'https://wiki.walkscape.app/wiki/Achievement_Points'
CACHE_FILE = get_cache_file('ap_rewards_cache.html')

# Create validator instance
validator = ScraperValidator()

# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def parse_ap_rewards():
    """Parse AP reward track from wiki page."""
    html = download_page(AP_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        print("ERROR: Failed to download AP rewards page")
        return [], []

    soup = BeautifulSoup(html, 'html.parser')

    progress_rewards = []
    checkpoint_rewards = []

    # Find all tables on the page
    tables = soup.find_all('table', class_='wikitable')

    for table in tables:
        rows = table.find_all('tr')
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) < 4:
                continue

            # Skip header rows (th elements)
            if row.find('th'):
                continue

            # Table structure: Icon | Item Name | Quantity | Item Type | Requirements
            # The header has "Item Name" with colspan=2, so data rows have 5 td cells
            if len(cells) >= 5:
                # Standard row: icon, name, qty, type, requirements
                item_name_cell = cells[1]
                quantity_text = clean_text(cells[2].get_text())
                item_type = clean_text(cells[3].get_text())
                requirements = clean_text(cells[4].get_text())
            elif len(cells) == 4:
                # Special row with colspan (e.g., "Unlock access to..." spans icon+name)
                # Check if first cell has colspan
                first_colspan = int(cells[0].get('colspan', 1))
                if first_colspan >= 2:
                    # First cell spans icon+name+maybe more, treat as item name
                    item_name_cell = cells[0]
                    # Remaining cells shift
                    if first_colspan == 3:
                        # colspan=3 means icon+name+qty merged, so: merged | type | requirements
                        quantity_text = '1'
                        item_type = clean_text(cells[1].get_text())
                        requirements = clean_text(cells[2].get_text()) if len(cells) > 2 else ''
                    else:
                        quantity_text = clean_text(cells[1].get_text())
                        item_type = clean_text(cells[2].get_text())
                        requirements = clean_text(cells[3].get_text()) if len(cells) > 3 else ''
                else:
                    item_name_cell = cells[0]
                    quantity_text = clean_text(cells[1].get_text())
                    item_type = clean_text(cells[2].get_text())
                    requirements = clean_text(cells[3].get_text()) if len(cells) > 3 else ''
            else:
                continue

            # Extract item name from the cell — prefer link text
            link = item_name_cell.find('a')
            if link:
                item_name = clean_text(link.get_text())
            else:
                item_name = clean_text(item_name_cell.get_text())
            
            if not item_name:
                continue

            # Parse quantity
            try:
                quantity = int(quantity_text)
            except ValueError:
                quantity = 1

            # Parse AP requirement from requirements text
            # Format: "Have  [X] achievement points." or "Have  [X] achievement points (Y% of total)."
            import re
            ap_match = re.search(r'\[(\d+)\]', requirements)
            ap_required = int(ap_match.group(1)) if ap_match else 0

            reward = {
                'item_name': item_name,
                'quantity': quantity,
                'item_type': item_type,
                'ap_required': ap_required,
            }

            print(f"  Found: {item_name} (qty: {quantity}, type: {item_type}, AP: {ap_required})")

            # Determine if this is a progress or checkpoint reward
            # Progress rewards mention "% of total" in requirements
            if '% of total' in requirements:
                progress_rewards.append(reward)
            else:
                checkpoint_rewards.append(reward)

    # Sort by AP required
    progress_rewards.sort(key=lambda x: x['ap_required'])
    checkpoint_rewards.sort(key=lambda x: x['ap_required'])

    return progress_rewards, checkpoint_rewards


# ============================================================================
# MODULE GENERATION
# ============================================================================

def generate_module(progress_rewards, checkpoint_rewards):
    """Generate the ap_rewards.py module."""
    output_file = get_output_file('ap_rewards.py')

    # Build item lookups for resolving references
    lookups = build_all_item_lookups()

    def escape_str(s):
        return s.replace("\\", "\\\\").replace("'", "\\'")

    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Achievement Points reward track data', 'scrape_ap_rewards.py')
        write_imports(f, [
            'from dataclasses import dataclass',
            'from typing import List, Optional',
        ])

        lines = []
        lines.append('')
        lines.append('')
        lines.append('@dataclass')
        lines.append('class APReward:')
        lines.append('    """A reward from the Achievement Points track."""')
        lines.append('    item_name: str')
        lines.append('    quantity: int')
        lines.append('    item_type: str  # Loot, Currency, Collectible, Back accessories, Special')
        lines.append('    ap_required: int')
        lines.append('    item_ref: Optional[str] = None  # e.g. "Item.JUGGLING_BALLS"')
        lines.append('')
        lines.append('')

        # Generate progress rewards
        lines.append('# Total Progress Unlocks (lost if more AP becomes available)')
        lines.append('PROGRESS_REWARDS: List[APReward] = [')
        for reward in progress_rewards:
            item_ref = resolve_item_reference(reward['item_name'], lookups)
            ref_str = f"'{item_ref}'" if item_ref else 'None'
            lines.append(f"    APReward(item_name='{escape_str(reward['item_name'])}', quantity={reward['quantity']}, item_type='{reward['item_type']}', ap_required={reward['ap_required']}, item_ref={ref_str}),")
        lines.append(']')
        lines.append('')
        lines.append('')

        # Generate checkpoint rewards
        lines.append('# Check Point Unlocks (permanent)')
        lines.append('CHECKPOINT_REWARDS: List[APReward] = [')
        for reward in checkpoint_rewards:
            item_ref = resolve_item_reference(reward['item_name'], lookups)
            ref_str = f"'{item_ref}'" if item_ref else 'None'
            lines.append(f"    APReward(item_name='{escape_str(reward['item_name'])}', quantity={reward['quantity']}, item_type='{reward['item_type']}', ap_required={reward['ap_required']}, item_ref={ref_str}),")
        lines.append(']')
        lines.append('')
        lines.append('')

        # Combined list
        lines.append('# All rewards combined, sorted by AP required')
        lines.append('ALL_REWARDS: List[APReward] = sorted(PROGRESS_REWARDS + CHECKPOINT_REWARDS, key=lambda r: r.ap_required)')
        lines.append('')
        lines.append('')

        # Helper sets for quick lookup
        lines.append('# Quick lookup: item names that come from AP rewards')
        lines.append('AP_REWARD_ITEM_NAMES = {r.item_name for r in ALL_REWARDS if r.item_type in ("Loot", "Back accessories", "Collectible")}')
        lines.append('')

        f.write('\n'.join(lines))

    total = len(progress_rewards) + len(checkpoint_rewards)
    print(f"✓ Generated {output_file} with {total} rewards ({len(progress_rewards)} progress, {len(checkpoint_rewards)} checkpoint)")


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("Scraping Achievement Points rewards...")
    progress, checkpoint = parse_ap_rewards()
    print(f"\nFound {len(progress)} progress rewards, {len(checkpoint)} checkpoint rewards")
    generate_module(progress, checkpoint)
    validator.report()
