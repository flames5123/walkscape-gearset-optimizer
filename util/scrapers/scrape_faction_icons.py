#!/usr/bin/env python3
"""
Download faction/region icons from Walkscape wiki.

Scrapes multiple wiki pages to find coat of arms SVG icons for all regions.
Sources:
  1. Faction Reputation page (has Jarvonia, Trellin, Erdwise, Halfling Rebels, Syrenthia, Herbert's)
  2. Arenum page (has GDTE and other regions)
  3. Individual region pages (Wallisia, Wrentmark, etc.)

Icons are saved to: assets/icons/factions/
"""

import requests
from pathlib import Path
from bs4 import BeautifulSoup
from scraper_utils import download_page, get_cache_file, get_cache_dir

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
OUTPUT_DIR = Path('assets/icons/factions')

# Pages to scrape for icons
WIKI_PAGES = [
    ('faction_reputation', 'https://wiki.walkscape.app/wiki/Faction_Reputation'),
    ('arenum', 'https://wiki.walkscape.app/wiki/Arenum'),
    ('wallisia', 'https://wiki.walkscape.app/wiki/Wallisia'),
    ('wrentmark', 'https://wiki.walkscape.app/wiki/Wrentmark'),
    ('galeforge', 'https://wiki.walkscape.app/wiki/Galeforge'),
]

# Faction/region name mappings — keys are substrings to match in alt text or surrounding text
REGION_NAMES = {
    "jarvonia": "jarvonia",
    "trellin": "trellin",
    "erdwise": "erdwise",
    "halfling": "halfling_rebels",
    "syrenthia": "syrenthia",
    "herbert": "herberts_guiding_grounds",
    "wallisia": "wallisia",
    "wrentmark": "wrentmark",
    "galeforge": "galeforge",
    "gdte": "gdte",
    "grand duchy": "gdte",
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def download_icon(url: str, filename: str) -> bool:
    """Download a single icon file (SVG or PNG)."""
    if not url:
        return False

    try:
        if url.startswith('/'):
            url = 'https://wiki.walkscape.app' + url
        elif not url.startswith('http'):
            url = 'https://wiki.walkscape.app/' + url

        print(f"  Downloading: {url}")
        response = requests.get(url, timeout=10)
        response.raise_for_status()

        output_path = OUTPUT_DIR / filename
        with open(output_path, 'wb') as f:
            f.write(response.content)

        print(f"    ✓ Saved to {output_path} ({len(response.content)} bytes)")
        return True
    except Exception as e:
        print(f"    ✗ Error: {e}")
        return False


def extract_region_name(text: str) -> str:
    """Extract region name from text and return standardized filename."""
    text_lower = text.lower()
    for key, filename in REGION_NAMES.items():
        if key in text_lower:
            return filename
    return None


def find_icons_on_page(html: str, page_name: str) -> list:
    """Find coat of arms or region icons on a wiki page."""
    soup = BeautifulSoup(html, 'html.parser')
    icons = []
    seen_regions = set()

    images = soup.find_all('img')
    print(f"  [{page_name}] Found {len(images)} images")

    for img in images:
        src = img.get('src', '')
        alt = img.get('alt', '')
        title = img.get('title', '')

        # Look for coat of arms images or region-related icons
        is_coat = 'coat_of_arms' in src.lower() or 'coat_of_arms' in alt.lower()
        is_region_icon = 'region' in src.lower() or 'emblem' in src.lower() or 'crest' in src.lower()
        is_svg = src.endswith('.svg')

        if not (is_coat or is_region_icon or is_svg):
            continue

        # Try to identify the region from alt, title, or surrounding text
        region = extract_region_name(alt) or extract_region_name(title)

        if not region:
            parent = img.parent
            depth = 0
            while parent and not region and depth < 5:
                text = parent.get_text()
                region = extract_region_name(text)
                parent = parent.parent
                depth += 1

        if not region:
            # For individual region pages, use the page name as fallback
            region = extract_region_name(page_name)

        if region and region not in seen_regions:
            seen_regions.add(region)
            icons.append({
                'src': src,
                'alt': alt,
                'region': region,
                'page': page_name,
            })
            print(f"    Found: {region} → {src[:80]}")

    return icons


# ============================================================================
# SCRAPING
# ============================================================================

def scrape_all_icons():
    """Scrape faction/region icons from all wiki pages."""
    print("Downloading faction/region icons from wiki...\n")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_icons = []
    seen_regions = set()

    for page_name, url in WIKI_PAGES:
        cache_file = get_cache_file(f'{page_name}_cache.html')
        html = download_page(url, cache_file, rescrape=RESCRAPE)
        if not html:
            print(f"  ✗ Failed to download {page_name}")
            continue

        icons = find_icons_on_page(html, page_name)
        for icon in icons:
            if icon['region'] not in seen_regions:
                seen_regions.add(icon['region'])
                all_icons.append(icon)

    return all_icons


# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=== Faction/Region Icon Scraper ===\n")

    icons = scrape_all_icons()

    if icons:
        print(f"\n✓ Found {len(icons)} region icons")
        print("\nDownloading icons...\n")

        # Check which we already have
        existing = {f.stem for f in OUTPUT_DIR.glob('*')}
        print(f"Already have: {', '.join(sorted(existing)) or 'none'}\n")

        success_count = 0
        for i, icon in enumerate(icons, 1):
            region = icon['region']
            ext = '.svg' if icon['src'].endswith('.svg') else '.png'
            filename = f"{region}{ext}"

            # Skip if we already have this one (unless RESCRAPE)
            if region in existing and not RESCRAPE:
                print(f"{i}. {region} — already exists, skipping")
                continue

            print(f"{i}. {region}")
            if download_icon(icon['src'], filename):
                success_count += 1

        print(f"\n✓ Downloaded {success_count} new icons")
        print(f"Total icons in {OUTPUT_DIR}: {len(list(OUTPUT_DIR.glob('*')))}")
    else:
        print("\n✗ No icons found")

    # Report missing
    needed = {'jarvonia', 'trellin', 'erdwise', 'halfling_rebels', 'syrenthia',
              'wallisia', 'wrentmark', 'herberts_guiding_grounds'}
    existing = {f.stem for f in OUTPUT_DIR.glob('*')}
    missing = needed - existing
    if missing:
        print(f"\n⚠ Still missing: {', '.join(sorted(missing))}")
        print("  You may need to download these manually from the wiki.")
    else:
        print(f"\n✓ All needed icons present!")
