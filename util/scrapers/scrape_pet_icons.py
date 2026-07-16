#!/usr/bin/env python3
"""
Download pet icons (all variants) from Walkscape wiki.

Discovers pets from cached HTML pages and downloads juvenile + adult icons
for all 4 color variants: Normal, Light, Dark, Rare.

Icons are saved to: assets/icons/items/pets/{name}_{stage}_{variant}.svg
  e.g. camel_juvenile_normal.svg, camel_adult_rare.svg

Also maintains backward-compatible symlink-style copies:
  {name}_juvenile.svg -> {name}_juvenile_normal.svg
  {name}_adult.svg    -> {name}_adult_normal.svg

Uses regex on cached HTML to avoid BeautifulSoup import chain issues.
"""

import re
import os
import shutil
import requests
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
CACHE_DIR = Path(__file__).parent.parent / 'cache' / 'pets_cache'
OUTPUT_DIR = Path(__file__).parent.parent.parent / 'assets' / 'icons' / 'items' / 'pets'
WIKI_BASE = 'https://wiki.walkscape.app'

PETS = ['Camel', 'Chicken', 'Dolphin', 'Reindeer', 'Tortoise', 'Tiger', 'Mummy']
VARIANTS = ['Normal', 'Light', 'Dark', 'Rare']
STAGES = ['Juvenile', 'Adult']

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_icon(url: str, output_path: Path) -> bool:
    """Download a single icon SVG file."""
    if not url:
        return False
    try:
        if url.startswith('/'):
            url = WIKI_BASE + url
        print(f"  Downloading: {url}")
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'wb') as f:
            f.write(response.content)
        print(f"    ✓ Saved to {output_path}")
        return True
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False


def extract_icon_urls(html: str, pet_name: str) -> dict:
    """
    Extract all pet icon URLs from HTML using regex.
    Returns dict like: {('Juvenile', 'Normal'): '/images/...svg', ...}
    """
    icons = {}
    # Pattern: src="/images/.../Pet_{Name}_{Stage}_{Variant}_Static.svg"
    pattern = re.compile(
        rf'src="(/images/[^"]*Pet_{re.escape(pet_name)}_(\w+)_(\w+)_Static\.svg)"',
        re.IGNORECASE
    )
    for match in pattern.finditer(html):
        url = match.group(1)
        stage = match.group(2)   # Juvenile, Adult, Egg
        variant = match.group(3) # Normal, Light, Dark, Rare
        if stage in ('Juvenile', 'Adult') and variant in VARIANTS:
            key = (stage, variant)
            if key not in icons:
                icons[key] = url
    return icons

# ============================================================================
# MAIN
# ============================================================================

def scrape_all_pet_icons():
    """Discover and download all pet variant icons from cached HTML."""
    print("=== Pet Icon Scraper (All Variants) ===\n")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    total = 0
    success = 0
    skipped = 0

    for pet_name in PETS:
        cache_file = CACHE_DIR / f"{pet_name}.html"
        if not cache_file.exists():
            print(f"⚠ No cached HTML for {pet_name}, skipping")
            continue

        html = cache_file.read_text(encoding='utf-8')
        icons = extract_icon_urls(html, pet_name)
        print(f"{pet_name}: found {len(icons)} variant icons")

        for stage in STAGES:
            for variant in VARIANTS:
                key = (stage, variant)
                url = icons.get(key)
                filename = f"{pet_name.lower()}_{stage.lower()}_{variant.lower()}.svg"
                dest = OUTPUT_DIR / filename
                total += 1

                if not url:
                    print(f"  ⚠ No icon found for {pet_name} {stage} {variant}")
                    continue

                if not RESCRAPE and dest.exists():
                    print(f"  ✓ {filename} already exists, skipping")
                    skipped += 1
                    success += 1
                    continue

                if download_icon(url, dest):
                    success += 1

        # Create backward-compatible copies (name_juvenile.svg -> name_juvenile_normal.svg)
        for stage in STAGES:
            compat_name = f"{pet_name.lower()}_{stage.lower()}.svg"
            normal_name = f"{pet_name.lower()}_{stage.lower()}_normal.svg"
            compat_path = OUTPUT_DIR / compat_name
            normal_path = OUTPUT_DIR / normal_name
            if normal_path.exists():
                shutil.copy2(normal_path, compat_path)
                print(f"  ✓ Copied {normal_name} → {compat_name}")

        print()

    print(f"✓ {success}/{total} icons downloaded ({skipped} skipped)")
    print(f"✓ Icons saved to {OUTPUT_DIR}/")


if __name__ == '__main__':
    scrape_all_pet_icons()
