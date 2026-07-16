#!/usr/bin/env python3
"""
Download region crest icons from Walkscape wiki.

Scrapes the Arenum wiki page and downloads SVG Coat of Arms icons
for each region.

Icons are saved to: assets/icons/regions/
"""

import requests
from pathlib import Path
from bs4 import BeautifulSoup
from scraper_utils import download_page, get_cache_file

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
WIKI_URL = 'https://wiki.walkscape.app/wiki/Arenum#Regions'
CACHE_FILE = get_cache_file('arenum_regions_cache.html')
OUTPUT_DIR = Path('assets/icons/regions')

# Region mappings: coat of arms filename fragment → output filename
REGION_MAP = {
    'Jarvonia_Coat_of_Arms': 'jarvonia',
    'GDTE_Coat_of_Arms': 'gdte',
    'Syrenthia_Coat_of_Arms': 'syrenthia',
    'Wallisia_Coat_of_Arms': 'wallisia',
    'Wrentmark_Coat_of_Arms': 'wrentmark',
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_icon(url: str, filename: str) -> bool:
    """Download a single icon SVG file."""
    if not url:
        return False

    try:
        if url.startswith('/'):
            url = 'https://wiki.walkscape.app' + url

        print(f"  Downloading: {url}")

        response = requests.get(url, timeout=10)
        response.raise_for_status()

        output_path = OUTPUT_DIR / filename
        with open(output_path, 'wb') as f:
            f.write(response.content)

        print(f"    ✓ Saved to {output_path}")
        return True
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False

# ============================================================================
# SCRAPING FUNCTIONS
# ============================================================================

def scrape_region_icons():
    """Scrape region crest icons from wiki."""
    print("Downloading region crest icons from wiki...")

    html = download_page(WIKI_URL, CACHE_FILE, rescrape=RESCRAPE)
    if not html:
        print("✗ Failed to download wiki page")
        return []

    soup = BeautifulSoup(html, 'html.parser')

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}\n")

    region_icons = []
    seen = set()

    for img in soup.find_all('img'):
        src = img.get('src', '')
        if 'Coat_of_Arms' not in src:
            continue

        # Match against our target regions
        for fragment, region_key in REGION_MAP.items():
            if fragment in src and region_key not in seen:
                seen.add(region_key)
                region_icons.append({
                    'src': src,
                    'region_key': region_key,
                })
                print(f"  Found: {region_key}")
                break

    if not region_icons:
        print("\n✗ No region crest icons found")

    return region_icons

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Region Crest Icon Scraper ===\n")

    icons = scrape_region_icons()

    if icons:
        print(f"\n✓ Found {len(icons)} region icons")
        print("\nDownloading icons...\n")

        success_count = 0
        for i, icon in enumerate(icons, 1):
            filename = f"{icon['region_key']}.svg"
            print(f"{i}. {icon['region_key']}")
            if download_icon(icon['src'], filename):
                success_count += 1

        print(f"\n✓ Downloaded {success_count}/{len(icons)} icons")
    else:
        print("\n✗ No icons to download")
