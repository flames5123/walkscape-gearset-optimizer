#!/usr/bin/env python3
"""
Walkscape Map Data Scraper

Downloads map overlay data (locations, routes, activities, buildings, services)
from map.walkscape.app JSON endpoints.

These JSON files contain:
- locations.json: Location coordinates, icons, services, activities per location
- routes.json: Route pathpoints (curved lines), distances, terrain requirements
- activities.json: Activity details, skill/level requirements, keywords
- buildings.json: Building types (banks, shops, taverns), wiki URLs
- services.json: Service types (forges, kitchens, sawmills), skill associations

The data files have a timestamp suffix that changes on updates, e.g.:
  /data/locations-1766468346.json

The scraper discovers the current timestamp from the JS bundle.

Usage:
  python3 util/scrapers/scrape_map_data.py              # Download if not exists
  python3 util/scrapers/scrape_map_data.py --rescrape    # Re-download all
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import requests

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False
BASE_URL = "https://map.walkscape.app"
DATA_BASE_URL = f"{BASE_URL}/data"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "ui" / "static" / "assets" / "map" / "data"
REQUEST_DELAY = 0.2  # seconds between requests

# Data files to download
DATA_FILES = [
    "locations",
    "routes",
    "activities",
    "buildings",
    "services",
]

HEADERS = {
    "Accept": "application/json",
    "Accept-Language": "en",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
}

# ============================================================================
# DISCOVERY
# ============================================================================

def discover_data_urls():
    """Discover current data file URLs.

    The data files use a shared timestamp suffix (e.g., locations-1766468346.json).
    Strategy:
    1. Try the last known working timestamp first (fast, no extra requests)
    2. If that fails, probe with HEAD requests to find the current timestamp

    Returns dict mapping data file name to full URL, e.g.:
      {"locations": "https://map.walkscape.app/data/locations-1766468346.json", ...}
    """
    print("Discovering data file URLs...")

    # Check if we have a cached timestamp from a previous run
    meta_file = OUTPUT_DIR / "metadata.json"
    cached_timestamp = None
    if meta_file.exists():
        try:
            with open(meta_file, 'r') as f:
                meta = json.load(f)
            # Extract timestamp from any cached URL
            for url in meta.get('data_urls', {}).values():
                ts_match = re.search(r'-(\d{8,})\.json', url)
                if ts_match:
                    cached_timestamp = ts_match.group(1)
                    break
        except Exception:
            pass

    # Try cached timestamp first, then known fallback
    timestamps_to_try = []
    if cached_timestamp:
        timestamps_to_try.append(cached_timestamp)
    timestamps_to_try.append("1766468346")  # Known working timestamp

    for timestamp in timestamps_to_try:
        print(f"  Trying timestamp {timestamp}...")
        data_urls = {}
        # Just test one file to see if timestamp is valid
        test_url = f"{DATA_BASE_URL}/locations-{timestamp}.json"
        try:
            resp = requests.head(test_url, headers=HEADERS, timeout=10)
            if resp.status_code == 200:
                # Timestamp works, build all URLs
                for name in DATA_FILES:
                    data_urls[name] = f"{DATA_BASE_URL}/{name}-{timestamp}.json"
                    print(f"  ✓ {name}: timestamp={timestamp}")
                return data_urls
            else:
                print(f"  ✗ timestamp {timestamp}: HTTP {resp.status_code}")
        except Exception as e:
            print(f"  ✗ timestamp {timestamp}: {e}")
        time.sleep(REQUEST_DELAY)

    print("  ERROR: No working timestamp found")
    print("  The map data URLs may have changed. Check map.walkscape.app")
    print("  in browser dev tools (Network tab) for current data file URLs,")
    print("  then update the fallback timestamp in this script.")
    return {}


# ============================================================================
# DOWNLOAD
# ============================================================================

def download_data_files(data_urls):
    """Download all map data JSON files.

    Returns number of files successfully downloaded.
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = 0

    for name, url in data_urls.items():
        out_file = OUTPUT_DIR / f"{name}.json"

        if out_file.exists() and not RESCRAPE:
            print(f"  {name}.json already exists (skip, use --rescrape to re-download)")
            downloaded += 1
            continue

        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()

            # Validate it's valid JSON
            data = resp.json()

            with open(out_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)

            size_kb = len(resp.text) / 1024
            print(f"  ✓ {name}.json ({size_kb:.1f} KB)")
            downloaded += 1
            time.sleep(REQUEST_DELAY)
        except json.JSONDecodeError:
            print(f"  ✗ {name}.json: invalid JSON response")
        except Exception as e:
            print(f"  ✗ {name}.json: {e}")

    return downloaded


# ============================================================================
# SUMMARY
# ============================================================================

def print_summary():
    """Print summary of downloaded data files."""
    print(f"\nData file summary:")

    for name in DATA_FILES:
        out_file = OUTPUT_DIR / f"{name}.json"
        if not out_file.exists():
            print(f"  ✗ {name}.json: MISSING")
            continue

        try:
            with open(out_file, 'r', encoding='utf-8') as f:
                data = json.load(f)

            if name == "locations":
                # Locations has two groups: Factions and Locations
                factions = 0
                locations = 0
                for group in data:
                    if group.get('name') == 'Factions':
                        factions = len(group.get('markers', []))
                    elif group.get('name') == 'Locations':
                        locations = len(group.get('markers', []))
                print(f"  ✓ {name}.json: {factions} factions, {locations} locations")

            elif name == "routes":
                routes = 0
                for group in data:
                    routes += len(group.get('markers', []))
                print(f"  ✓ {name}.json: {routes} routes")

            elif name == "activities":
                print(f"  ✓ {name}.json: {len(data)} activities")

            elif name == "buildings":
                print(f"  ✓ {name}.json: {len(data)} buildings")

            elif name == "services":
                print(f"  ✓ {name}.json: {len(data)} services")

        except Exception as e:
            print(f"  ? {name}.json: could not parse ({e})")


# ============================================================================
# ENTRY POINT
# ============================================================================

def main():
    global RESCRAPE
    if '--rescrape' in sys.argv:
        RESCRAPE = True
        print("RESCRAPE mode: re-downloading all data files\n")

    print(f"Output directory: {OUTPUT_DIR}")
    print()

    # Discover and download
    data_urls = discover_data_urls()
    if not data_urls:
        print("\nERROR: Could not discover any data file URLs")
        sys.exit(1)

    print(f"\nDownloading {len(data_urls)} data files...")
    downloaded = download_data_files(data_urls)

    # Write metadata
    meta_file = OUTPUT_DIR / "metadata.json"
    metadata = {
        'source': BASE_URL,
        'data_urls': data_urls,
        'files_downloaded': downloaded,
        'files_expected': len(DATA_FILES),
    }
    with open(meta_file, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    # Summary
    print_summary()

    print(f"\n{'='*50}")
    print(f"Done! {downloaded}/{len(DATA_FILES)} data files downloaded")
    print(f"Output: {OUTPUT_DIR}")
    print(f"{'='*50}")


if __name__ == '__main__':
    main()
