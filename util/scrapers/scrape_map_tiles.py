#!/usr/bin/env python3
"""
Walkscape Map Tile Scraper

Downloads map tiles from map.walkscape.app for local rendering with Leaflet.
Tile URL pattern: https://map.walkscape.app/tiles/main/{z}/{x}_{y}.png

Zoom levels 0-4, x and y start at 0.
Origin (0,0) is top-left corner, +X goes right, +Y goes down.

Auto-generated tiles are stored in ui/static/assets/map/tiles/{z}/
"""

import os
import sys
import time
import requests
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

RESCRAPE = False  # Set True to re-download all tiles
BASE_URL = "https://map.walkscape.app/tiles/main"
DATA_BASE_URL = "https://map.walkscape.app/data"
MIN_ZOOM = 0
MAX_ZOOM = 4
OUTPUT_DIR = Path(__file__).parent.parent.parent / "ui" / "static" / "assets" / "map" / "tiles"
DATA_OUTPUT_DIR = Path(__file__).parent.parent.parent / "ui" / "static" / "assets" / "map" / "data"
REQUEST_DELAY = 0.05  # seconds between requests to be polite

# Data files to download (the timestamp may change, so we discover them)
# These contain location coordinates, route pathpoints, services, buildings, activities
DATA_FILES = [
    "locations",
    "routes",
    "activities",
    "buildings",
    "services",
]

# ============================================================================
# DATA FILE SCRAPER
# ============================================================================

def discover_data_urls():
    """Discover current data file URLs by fetching the main page JS bundle.
    
    The data files have a timestamp suffix that changes on updates, e.g.:
    /data/locations-1766468346.json
    
    We find these by fetching the index page and looking for /data/ references
    in the JS bundle, or by trying known patterns.
    """
    print("\nDiscovering data file URLs...")
    
    # Try to find the JS bundle first
    try:
        resp = requests.get("https://map.walkscape.app", timeout=15)
        resp.raise_for_status()
        html = resp.text
        
        # Look for the JS bundle URL
        import re
        js_match = re.search(r'/assets/index-[^"\']+\.js', html)
        if js_match:
            js_url = f"https://map.walkscape.app{js_match.group()}"
            print(f"  Found JS bundle: {js_url}")
            
            # Fetch the JS bundle and look for data file references
            js_resp = requests.get(js_url, timeout=30)
            js_resp.raise_for_status()
            js_content = js_resp.text
            
            # Find data file URLs like /data/locations-1766468346.json
            data_urls = {}
            for name in DATA_FILES:
                pattern = rf'/data/{name}-(\d+)\.json'
                match = re.search(pattern, js_content)
                if match:
                    timestamp = match.group(1)
                    url = f"{DATA_BASE_URL}/{name}-{timestamp}.json"
                    data_urls[name] = url
                    print(f"  Found {name}: timestamp={timestamp}")
            
            if data_urls:
                return data_urls
    except Exception as e:
        print(f"  Warning: Could not discover URLs from JS bundle: {e}")
    
    # Fallback: try known timestamp
    print("  Falling back to known timestamp pattern...")
    data_urls = {}
    known_timestamp = "1766468346"
    for name in DATA_FILES:
        url = f"{DATA_BASE_URL}/{name}-{known_timestamp}.json"
        try:
            resp = requests.head(url, timeout=10)
            if resp.status_code == 200:
                data_urls[name] = url
                print(f"  Found {name} at known timestamp")
        except Exception:
            pass
    
    return data_urls


def download_data_files(data_urls):
    """Download all map data JSON files."""
    print(f"\nDownloading {len(data_urls)} data files...")
    DATA_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    downloaded = 0
    for name, url in data_urls.items():
        out_file = DATA_OUTPUT_DIR / f"{name}.json"
        
        if out_file.exists() and not RESCRAPE:
            print(f"  {name}.json already exists (skip)")
            downloaded += 1
            continue
        
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            
            with open(out_file, 'w', encoding='utf-8') as f:
                f.write(resp.text)
            
            print(f"  ✓ {name}.json ({len(resp.text)} bytes)")
            downloaded += 1
            time.sleep(REQUEST_DELAY)
        except Exception as e:
            print(f"  ✗ {name}.json: {e}")
    
    return downloaded


# ============================================================================
# TILE SCRAPER
# ============================================================================

def download_tile(z: int, x: int, y: int) -> bool:
    """Download a single tile. Returns True if successful, False if 404."""
    url = f"{BASE_URL}/{z}/{x}_{y}.png"
    out_dir = OUTPUT_DIR / str(z)
    out_file = out_dir / f"{x}_{y}.png"

    if out_file.exists() and not RESCRAPE:
        return True

    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 404:
            return False
        resp.raise_for_status()

        out_dir.mkdir(parents=True, exist_ok=True)
        with open(out_file, 'wb') as f:
            f.write(resp.content)
        return True
    except requests.exceptions.HTTPError:
        return False
    except Exception as e:
        print(f"  Error downloading {url}: {e}")
        return False


def scrape_zoom_level(z: int) -> dict:
    """Scrape all tiles for a zoom level. Returns {tiles_downloaded, max_x, max_y}."""
    print(f"\nZoom level {z}:")
    tiles = 0
    max_x = 0
    max_y = 0

    x = 0
    while True:
        # Check if this column exists by trying y=0
        if not download_tile(z, x, 0):
            break

        tiles += 1
        max_x = x

        # Download all y values in this column
        y = 1
        while True:
            if download_tile(z, x, y):
                tiles += 1
                max_y = max(max_y, y)
                time.sleep(REQUEST_DELAY)
                y += 1
            else:
                break

        print(f"  Column x={x}: {y} tiles (y=0..{y-1})")
        time.sleep(REQUEST_DELAY)
        x += 1

    print(f"  Total: {tiles} tiles, grid {max_x+1}x{max_y+1}")
    return {'tiles': tiles, 'max_x': max_x, 'max_y': max_y}


def main():
    global RESCRAPE
    if '--rescrape' in sys.argv:
        RESCRAPE = True
        print("RESCRAPE mode: re-downloading all files")

    print(f"Tile output directory: {OUTPUT_DIR}")
    print(f"Data output directory: {DATA_OUTPUT_DIR}")
    print(f"Tile URL pattern: {BASE_URL}/{{z}}/{{x}}_{{y}}.png")

    # Step 1: Download data files (locations, routes, etc.)
    data_urls = discover_data_urls()
    if data_urls:
        data_count = download_data_files(data_urls)
        print(f"\nData files: {data_count}/{len(DATA_FILES)} downloaded")
    else:
        print("\nWARNING: Could not discover any data file URLs")

    # Step 2: Download map tiles
    total_tiles = 0
    zoom_info = {}

    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        info = scrape_zoom_level(z)
        zoom_info[z] = info
        total_tiles += info['tiles']

    # Write metadata file
    meta_file = OUTPUT_DIR / "tile_metadata.json"
    import json
    metadata = {
        'source': BASE_URL,
        'data_source': DATA_BASE_URL,
        'data_urls': data_urls if data_urls else {},
        'zoom_levels': {},
        'total_tiles': total_tiles,
    }
    for z, info in zoom_info.items():
        metadata['zoom_levels'][str(z)] = {
            'max_x': info['max_x'],
            'max_y': info['max_y'],
            'tile_count': info['tiles'],
        }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(meta_file, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\n{'='*50}")
    print(f"Done! Downloaded {total_tiles} tiles + {data_count if data_urls else 0} data files")
    print(f"Tile metadata: {meta_file}")
    print(f"Data files: {DATA_OUTPUT_DIR}")
    print(f"{'='*50}")
    print(f"\nData files contain:")
    print(f"  locations.json - Location coordinates, icons, services, activities")
    print(f"  routes.json    - Route pathpoints (curved lines), distances, requirements")
    print(f"  activities.json - Activity details, skill requirements")
    print(f"  buildings.json  - Building types, shops, banks")
    print(f"  services.json   - Service types (forges, kitchens, etc.)")


if __name__ == '__main__':
    main()
