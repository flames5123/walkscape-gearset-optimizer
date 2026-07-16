#!/usr/bin/env python3
"""
Scrape faction reputation reward tracks from Walkscape wiki.
Generates faction_rewards.py with all faction reward data.

Start page: https://wiki.walkscape.app/wiki/Faction_Reputation
Then follows links to individual faction reward pages.
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
FACTION_REP_URL = 'https://wiki.walkscape.app/wiki/Faction_Reputation'
CACHE_DIR = get_cache_dir('faction_rewards')

FACTION_REWARD_URLS = {
    "Herbert's Guiding Grounds": 'https://wiki.walkscape.app/wiki/Herbert%27s_Guiding_Grounds_Faction_Rewards',
    'Jarvonia': 'https://wiki.walkscape.app/wiki/Jarvonia_Faction_Rewards',
    'Trellin': 'https://wiki.walkscape.app/wiki/Trellin_Faction_Rewards',
    'Erdwise': 'https://wiki.walkscape.app/wiki/Erdwise_Faction_Rewards',
    'Halfling Rebels': 'https://wiki.walkscape.app/wiki/Halfling_Rebels_Faction_Rewards',
    'Syrenthia': 'https://wiki.walkscape.app/wiki/Syrenthia_Faction_Rewards',
}

# Create validator instance
validator = ScraperValidator()


# ============================================================================
# PARSING FUNCTIONS
# ============================================================================

def parse_faction_rewards(lookups):
    """Parse all faction reward tracks."""
    os.makedirs(CACHE_DIR, exist_ok=True)

    factions = {}
    for faction_name, url in FACTION_REWARD_URLS.items():
        cache_file = CACHE_DIR / f'{sanitize_filename(faction_name)}.html'
        html = download_page(url, cache_file, rescrape=RESCRAPE)
        if not html:
            print(f"  ⚠ Failed to download {faction_name} rewards page")
            continue

        soup = BeautifulSoup(html, 'html.parser')
        result = parse_faction_page(soup, faction_name, lookups)
        factions[faction_name] = result
        tier_count = len(result['tiers'])
        item_count = sum(len(t['rewards']) for t in result['tiers'])
        print(f"  ✓ {faction_name}: {tier_count} tiers, {item_count} rewards")

    return factions


def parse_faction_page(soup, faction_name, lookups):
    """Parse a single faction reward page into tiers.
    
    Structure:
    - h2 "Repeating_Reward" followed by table with the repeating reward item
    - h2 "{rep}_{title}" (e.g. "5_Penny_Pincher") followed by table with rewards
    - Each reward row: [icon_cell, item_text_cell]
    - Item text: optional "Nx " prefix, then <a>Item Name</a>, optional " Experience" suffix
    """
    result = {
        'repeating_reward': None,
        'repeating_interval': 3,
        'tiers': [],
    }

    # Find all h2 headings and their following tables
    headings = soup.find_all('div', class_='mw-heading')

    for heading_div in headings:
        h2 = heading_div.find('h2')
        if not h2:
            continue

        heading_id = h2.get('id', '')
        heading_text = clean_text(h2.get_text())

        # Skip non-tier headings
        if heading_id in ('Guides', 'See_also', 'References', 'Navigation'):
            continue

        # Find the next table after this heading
        table = heading_div.find_next_sibling('table')
        if not table:
            continue

        if heading_id == 'Repeating_Reward':
            # Parse repeating reward
            rewards = parse_reward_table(table, faction_name, lookups)
            if rewards:
                result['repeating_reward'] = rewards[0]['item_name']

            # Check for interval text
            interval_p = table.find_next_sibling('p')
            if interval_p:
                interval_text = clean_text(interval_p.get_text())
                match = re.search(r'every (\d+)', interval_text)
                if match:
                    result['repeating_interval'] = int(match.group(1))
            continue

        # Parse tier heading: "{rep_number} {title}"
        match = re.match(r'(\d+)\s+(.+)', heading_text)
        if not match:
            continue

        rep_required = int(match.group(1))
        title = match.group(2).strip()

        # Parse rewards from the table
        rewards = parse_reward_table(table, faction_name, lookups)

        result['tiers'].append({
            'reputation_required': rep_required,
            'title': title,
            'rewards': rewards,
        })

    return result


def parse_reward_table(table, faction_name, lookups):
    """Parse a reward table into a list of reward entries.
    
    Each row has 2 cells: [icon, item_text]
    Item text patterns:
    - "Item Name" (quantity 1)
    - "3x Item Name" (quantity 3)
    - "+500 Trinketry Experience" (experience reward)
    - "300 Coins" (currency reward)
    """
    rewards = []
    rows = table.find_all('tr')

    for row in rows:
        cells = row.find_all('td')
        if len(cells) < 2:
            continue

        text_cell = cells[1]
        cell_text = clean_text(text_cell.get_text())
        if not cell_text:
            continue

        # Find the item link
        link = text_cell.find('a')
        if not link:
            continue

        item_name = clean_text(link.get_text())
        if not item_name:
            continue

        # Parse quantity prefix (e.g. "3x " or "2x ")
        quantity = 1
        qty_match = re.match(r'(\d+)x\s+', cell_text)
        if qty_match:
            quantity = int(qty_match.group(1))

        # Detect item type from text patterns
        item_type = determine_item_type(cell_text, item_name, link, lookups)

        # Resolve item reference
        item_ref = None
        if item_type not in ('Experience', 'Currency'):
            item_ref = resolve_item_reference(item_name, lookups)
            if not item_ref:
                validator.add_item_issue(faction_name, [f"Could not resolve: {item_name}"])

        rewards.append({
            'item_name': item_name,
            'quantity': quantity,
            'item_type': item_type,
            'item_ref': item_ref,
        })

    return rewards


def determine_item_type(cell_text, item_name, link, lookups):
    """Determine the item type from context clues."""
    cell_lower = cell_text.lower()
    name_lower = item_name.lower()

    # Experience rewards: "+500 Trinketry Experience"
    if 'experience' in cell_lower:
        return 'Experience'

    # Currency: "300 Coins"
    if name_lower == 'coins' or name_lower == 'coin':
        return 'Currency'

    # Try to resolve and determine type from the reference
    ref = resolve_item_reference(item_name, lookups)
    if ref:
        if ref.startswith('Container.'):
            return 'Container'
        elif ref.startswith('Consumable.'):
            return 'Consumable'
        elif ref.startswith('Material.'):
            return 'Material'
        elif ref.startswith('Collectible.'):
            return 'Collectible'
        elif ref.startswith('Item.'):
            return 'Loot'

    # Fallback: check link href for clues
    href = link.get('href', '').lower()
    if 'chest' in href or 'container' in href:
        return 'Container'

    return 'Loot'


# ============================================================================
# MODULE GENERATION
# ============================================================================

def escape_str(s):
    """Escape a string for use in Python source code."""
    return s.replace("\\", "\\\\").replace("'", "\\'")


def generate_module(factions):
    """Generate the faction_rewards.py module."""
    output_file = get_output_file('faction_rewards.py')

    with open(output_file, 'w', encoding='utf-8') as f:
        write_module_header(f, 'Faction reputation reward track data', 'scrape_faction_rewards.py')
        write_imports(f, [
            'from dataclasses import dataclass, field',
            'from typing import List, Optional, Dict',
        ])

        lines = []
        lines.append('')
        lines.append('')
        lines.append('@dataclass')
        lines.append('class FactionRewardEntry:')
        lines.append('    """A single reward item from a faction reputation tier."""')
        lines.append('    item_name: str')
        lines.append('    quantity: int')
        lines.append("    item_type: str  # Loot, Collectible, Consumable, Material, Container, Currency, Experience, Cosmetic, Special")
        lines.append('    item_ref: Optional[str] = None')
        lines.append('')
        lines.append('')
        lines.append('@dataclass')
        lines.append('class FactionTier:')
        lines.append('    """A reputation tier with its rewards."""')
        lines.append('    reputation_required: int')
        lines.append('    title: str')
        lines.append('    rewards: List[FactionRewardEntry] = field(default_factory=list)')
        lines.append('')
        lines.append('')
        lines.append('@dataclass')
        lines.append('class FactionRewardTrack:')
        lines.append('    """Complete reward track for a faction."""')
        lines.append('    faction_name: str')
        lines.append('    repeating_reward: Optional[str] = None')
        lines.append('    repeating_interval: int = 3')
        lines.append('    tiers: List[FactionTier] = field(default_factory=list)')
        lines.append('')
        lines.append('')
        lines.append('# ============================================================================')
        lines.append('# FACTION REWARD TRACKS')
        lines.append('# ============================================================================')

        var_names = {}  # faction_name -> var_name

        for faction_name, data in factions.items():
            var_name = name_to_enum(faction_name)
            var_names[faction_name] = var_name

            lines.append('')
            rep_reward = f"'{escape_str(data['repeating_reward'])}'" if data['repeating_reward'] else 'None'
            lines.append(f'{var_name} = FactionRewardTrack(')
            lines.append(f"    faction_name='{escape_str(faction_name)}',")
            lines.append(f"    repeating_reward={rep_reward},")
            lines.append(f"    repeating_interval={data['repeating_interval']},")
            lines.append('    tiers=[')

            for tier in data['tiers']:
                lines.append(f"        FactionTier(reputation_required={tier['reputation_required']}, title='{escape_str(tier['title'])}', rewards=[")
                for reward in tier['rewards']:
                    ref_str = f"'{reward['item_ref']}'" if reward.get('item_ref') else 'None'
                    lines.append(f"            FactionRewardEntry('{escape_str(reward['item_name'])}', {reward['quantity']}, '{reward['item_type']}', {ref_str}),")
                lines.append('        ]),')

            lines.append('    ]')
            lines.append(')')
            lines.append('')

        # ALL_FACTION_TRACKS dict
        lines.append('')
        lines.append('# ============================================================================')
        lines.append('# LOOKUP HELPERS')
        lines.append('# ============================================================================')
        lines.append('')
        lines.append('ALL_FACTION_TRACKS: Dict[str, FactionRewardTrack] = {')
        for faction_name, var_name in var_names.items():
            # Use short display name for the dict key
            display_name = faction_name
            if display_name == "Herbert's Guiding Grounds":
                display_name = 'Herbert'
            lines.append(f"    '{escape_str(display_name)}': {var_name},")
        lines.append('}')
        lines.append('')
        lines.append('')
        lines.append("def get_all_faction_reward_items() -> Dict[str, List[str]]:")
        lines.append('    """')
        lines.append('    Get all equipment/collectible item names from faction rewards, grouped by faction.')
        lines.append('    ')
        lines.append('    Returns:')
        lines.append('        Dict mapping faction name to list of item names (equipment and collectibles only)')
        lines.append('    """')
        lines.append('    result = {}')
        lines.append('    for faction_name, track in ALL_FACTION_TRACKS.items():')
        lines.append('        items = []')
        lines.append('        for tier in track.tiers:')
        lines.append('            for reward in tier.rewards:')
        lines.append("                if reward.item_type in ('Loot', 'Collectible'):")
        lines.append('                    items.append(reward.item_name)')
        lines.append('        if items:')
        lines.append('            result[faction_name] = items')
        lines.append('    return result')
        lines.append('')
        lines.append('')
        lines.append('def get_faction_reward_item_names() -> set:')
        lines.append('    """Get flat set of all equipment/collectible item names from faction rewards."""')
        lines.append('    names = set()')
        lines.append('    for track in ALL_FACTION_TRACKS.values():')
        lines.append('        for tier in track.tiers:')
        lines.append('            for reward in tier.rewards:')
        lines.append("                if reward.item_type in ('Loot', 'Collectible'):")
        lines.append('                    names.add(reward.item_name)')
        lines.append('    return names')
        lines.append('')

        f.write('\n'.join(lines))

    total_tiers = sum(len(d['tiers']) for d in factions.values())
    total_rewards = sum(sum(len(t['rewards']) for t in d['tiers']) for d in factions.values())
    print(f"✓ Generated {output_file}")
    print(f"  {len(factions)} factions, {total_tiers} tiers, {total_rewards} rewards")


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("Scraping faction reward tracks...")
    print("Building item lookups...")
    lookups = build_all_item_lookups()
    factions = parse_faction_rewards(lookups)
    print(f"\nFound {len(factions)} factions")
    generate_module(factions)
    validator.report()
