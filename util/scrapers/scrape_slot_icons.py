#!/usr/bin/env python3
"""
Scrape slot icons from Walkscape wiki and save as SVGs.

Downloads the infobox image from each slot's wiki page:
  https://wiki.walkscape.app/wiki/{Slot}_Slot

Saves SVGs to: assets/icons/slots/{slot}.svg
"""

import os
import re
import sys
import requests
from pathlib import Path
from bs4 import BeautifulSoup

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from util.scrapers.scraper_utils import download_page, get_cache_dir

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
WIKI_BASE = 'https://wiki.walkscape.app'

# Slot name -> wiki page suffix
# Wiki uses "Tools_Slot" (plural) not "Tool_Slot"
SLOTS = {
    'head': 'Head_Slot',
    'cape': 'Cape_Slot',
    'back': 'Back_Slot',
    'chest': 'Chest_Slot',
    'hands': 'Hands_Slot',
    'legs': 'Legs_Slot',
    'neck': 'Neck_Slot',
    'feet': 'Feet_Slot',
    'ring': 'Ring_Slot',
    'tool': 'Tools_Slot',
    'primary': 'Primary_Slot',
    'secondary': 'Secondary_Slot',
    # Crafting-tree popup needs these too — added 2026-05-14 so the
    # tree-node empty-slot tiles can render a centered 30x30 outline
    # icon (clear placeholder for unfilled slots like ring1/ring2,
    # tool0..5, plus pets and consumable).
    'pets': 'Pets_Slot',
    'consumable': 'Consumable_Slot',
}

CACHE_DIR = get_cache_dir('slot_icons')
OUTPUT_DIR = Path(__file__).parent.parent.parent / 'assets' / 'icons' / 'slots'

# ============================================================================
# SCRAPING
# ============================================================================

def find_infobox_image(html: str, slot_hint: str = '') -> str | None:
    """
    Find the slot icon image URL from the wiki page HTML.

    Looks for (in order):
    0. An image whose filename contains the slot name (e.g. 'consumable',
       'pets'). Prevents the strategy-1 catch-all from grabbing
       Slot_Cape.svg off a nav box on a Consumable_Slot page.
    1. An <img> inside a .mw-parser-output or infobox with 'slot' in the src/alt
    2. The first large-ish <img> that links to an SVG or PNG on the wiki
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Strategy 0: prefer images whose filename matches the slot name.
    if slot_hint:
        hint = slot_hint.lower()
        for img in soup.find_all('img'):
            src = img.get('src', '')
            # Filename only; the wiki path includes things like /images/A/AB/
            fname = src.rsplit('/', 1)[-1].lower()
            if hint in fname:
                return src

    # Strategy 1: Look for images with 'slot' in src or alt
    for img in soup.find_all('img'):
        src = img.get('src', '')
        alt = img.get('alt', '').lower()
        if 'slot' in src.lower() or 'slot' in alt:
            return src

    # Strategy 2: Look for the first image in the page content that's an icon
    # Wiki pages typically have the slot icon as one of the first images
    content = soup.find('div', class_='mw-parser-output')
    if content:
        for img in content.find_all('img'):
            src = img.get('src', '')
            # Skip tiny tracking pixels and badges
            width = img.get('width', '')
            try:
                w = int(width)
                if w < 16:
                    continue
            except (ValueError, TypeError):
                pass
            # Return first reasonable image
            if src and not src.endswith('.gif') and 'icon' not in src.lower():
                return src

    # Strategy 3: Just grab the first <img> with a wiki upload src
    for img in soup.find_all('img'):
        src = img.get('src', '')
        if '/images/' in src or '/media/' in src:
            return src

    return None


def download_svg(url: str, output_path: Path) -> bool:
    """Download an SVG/image from URL and save it."""
    if not url.startswith('http'):
        url = WIKI_BASE + url

    try:
        print(f"  Downloading {url}...")
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(r.content)
        print(f"  ✓ Saved {output_path}")
        return True
    except Exception as e:
        print(f"  ✗ Failed to download: {e}")
        return False


def scrape_slot_icons():
    """Scrape all slot icons from wiki."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    success = 0
    failed = 0

    for slot, page_name in SLOTS.items():
        print(f"\n--- {slot} ({page_name}) ---")
        url = f"{WIKI_BASE}/wiki/{page_name}"
        cache_path = CACHE_DIR / f"{page_name}.html"

        html = download_page(url, cache_path, rescrape=RESCRAPE)
        if not html:
            print(f"  ✗ Failed to download page")
            failed += 1
            continue

        img_src = find_infobox_image(html, slot_hint=slot)
        if not img_src:
            print(f"  ✗ No icon image found on page")
            failed += 1
            continue

        print(f"  Found image: {img_src}")

        # Determine output extension from source
        ext = '.svg' if '.svg' in img_src.lower() else '.png'
        output_path = OUTPUT_DIR / f"{slot}{ext}"

        if output_path.exists() and not RESCRAPE:
            print(f"  ⊘ Already exists: {output_path}")
            success += 1
            continue

        if download_svg(img_src, output_path):
            success += 1
        else:
            failed += 1

    print(f"\n{'='*50}")
    print(f"✓ {success} slot icons saved to {OUTPUT_DIR}")
    if failed:
        print(f"✗ {failed} failed")


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    scrape_slot_icons()
