#!/usr/bin/env python3
"""
Download all item/material/activity icons from gear.walkscape.app API.

Uses the cached API data in temp_gear_app_cache/ to find all icon paths,
then downloads them from the live API (or uses cached PNGs if already present).

Icons are saved as PNGs to assets/icons/ matching the API path structure.
(SVG conversion is manual — this just gets the PNGs in place.)

Usage:
    python3 util/scrapers/download_har_icons.py
"""

import json
import os
import time
import urllib.request
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

CACHE_DIR = Path('temp_gear_app_cache')
ICONS_BASE = Path('assets/icons')
API_BASE = 'https://gear.walkscape.app/api/icons/'
REQUEST_DELAY = 0.1  # seconds between requests
RESCRAPE = False  # Set True to re-download existing icons

# ============================================================================
# COLLECT ALL ICON PATHS
# ============================================================================

def collect_icon_paths():
    """Collect all unique icon paths from cached API data."""
    icon_paths = set()

    def add_icon(path):
        if path and isinstance(path, str) and path.startswith('assets/icons/'):
            icon_paths.add(path)

    # From materials
    mat_file = CACHE_DIR / 'api_materials_detailed.json'
    if mat_file.exists():
        with open(mat_file) as f:
            materials = json.load(f)
        for m in materials:
            add_icon(m.get('icon'))
        print(f"  Materials: {len(materials)} items")

    # From activities list
    act_file = CACHE_DIR / 'api_activities_list.json'
    if act_file.exists():
        with open(act_file) as f:
            activities = json.load(f)
        for a in activities:
            add_icon(a.get('icon'))
        print(f"  Activities: {len(activities)} items")

    # From all_categorized_items (gear, collectibles, consumables, etc.)
    cat_file = CACHE_DIR / 'all_categorized_items.json'
    if cat_file.exists():
        with open(cat_file) as f:
            categories = json.load(f)
        count = 0
        for cat in categories:
            for subcat in cat.get('categories', []):
                for item in subcat.get('items', []):
                    add_icon(item.get('icon'))
                    count += 1
        print(f"  Categorized items: {count} items")

    # From recipes list
    rec_file = CACHE_DIR / 'api_recipes_list.json'
    if rec_file.exists():
        with open(rec_file) as f:
            recipes = json.load(f)
        for r in recipes:
            add_icon(r.get('icon'))
        print(f"  Recipes: {len(recipes)} items")

    # From loot tables — item icons in tableRows
    for loot_file in CACHE_DIR.glob('api_loot_*.json'):
        with open(loot_file) as f:
            tables = json.load(f)
        for table in tables:
            for row in table.get('tableRows', []):
                add_icon(row.get('icon'))

    # From locations
    loc_file = CACHE_DIR / 'api_locations.json'
    if loc_file.exists():
        with open(loc_file) as f:
            locations = json.load(f)
        for loc in locations:
            add_icon(loc.get('icon'))

    return sorted(icon_paths)


# ============================================================================
# DOWNLOAD
# ============================================================================

def download_icons(icon_paths):
    """Download all icons that don't already exist."""
    total = len(icon_paths)
    downloaded = 0
    skipped = 0
    failed = 0

    print(f"\nTotal unique icon paths: {total}")

    for i, icon_path in enumerate(icon_paths, 1):
        out_path = Path(icon_path)

        # Skip if already exists and not rescraping
        if out_path.exists() and not RESCRAPE:
            skipped += 1
            continue

        # Create parent directory
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # Download from API
        url = API_BASE + icon_path
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'WalkscapeOptimizer/1.0',
                'Accept': 'image/png,image/*',
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
            with open(out_path, 'wb') as f:
                f.write(data)
            downloaded += 1

            if downloaded % 50 == 0:
                print(f"  [{i}/{total}] Downloaded {downloaded}, skipped {skipped}, failed {failed}")

            time.sleep(REQUEST_DELAY)

        except Exception as e:
            failed += 1
            if failed <= 10:
                print(f"  ✗ {icon_path}: {e}")

    return downloaded, skipped, failed


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("=" * 60)
    print("Downloading icons from gear.walkscape.app")
    print("=" * 60)

    print("\nCollecting icon paths from cache...")
    icon_paths = collect_icon_paths()
    print(f"  Total unique icons: {len(icon_paths)}")

    # Show breakdown by type
    by_type = {}
    for p in icon_paths:
        parts = p.split('/')
        if len(parts) >= 3:
            key = '/'.join(parts[:3])
        else:
            key = p
        by_type[key] = by_type.get(key, 0) + 1
    print("\n  Breakdown:")
    for k, v in sorted(by_type.items(), key=lambda x: -x[1])[:15]:
        print(f"    {k}: {v}")

    # Check how many already exist
    existing = sum(1 for p in icon_paths if Path(p).exists())
    print(f"\n  Already downloaded: {existing}/{len(icon_paths)}")
    print(f"  Need to download: {len(icon_paths) - existing}")

    if len(icon_paths) - existing == 0:
        print("\n✓ All icons already downloaded!")
        return

    print("\nDownloading missing icons...")
    downloaded, skipped, failed = download_icons(icon_paths)

    print(f"\n{'=' * 60}")
    print(f"Done!")
    print(f"  Downloaded: {downloaded}")
    print(f"  Skipped (existing): {skipped}")
    print(f"  Failed: {failed}")


if __name__ == '__main__':
    main()
