#!/usr/bin/env python3
"""
Ingest drop tables from HAR-cached gear.walkscape.app API data into activities.py.

Uses the cached loot data in temp_gear_app_cache/ (extracted by extract_from_har.py).
Patches the existing activities.py by running the full scrape_activities.py pipeline
with RESCRAPE=False (uses cached wiki HTML) + overlay from HAR cache.

Usage:
    python3 util/scrapers/ingest_har_drops.py
"""

import json
import os
import sys
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

CACHE_DIR = Path('temp_gear_app_cache')

# ============================================================================
# LOAD CACHED DATA
# ============================================================================

def load_cache(filename):
    """Load a JSON file from the cache directory."""
    path = CACHE_DIR / filename
    if not path.exists():
        print(f"  ⚠ Missing cache file: {filename}")
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_api_data_from_cache():
    """Build the api_data dict that overlay_gear_api.py expects, from local cache."""
    activities_list = load_cache('api_activities_list.json')
    if not activities_list:
        print("ERROR: No activities list in cache. Run extract_from_har.py first.")
        return {}

    print(f"  Activities in API: {len(activities_list)}")

    api_data = {}
    missing_detail = []
    missing_loot = []

    for activity in activities_list:
        activity_id = activity['id']
        activity_name = activity['name']

        if activity_id in ('none', 'travelling'):
            continue

        # Load activity detail
        detail = load_cache(f'api_activity_{activity_id}.json')
        if not detail:
            missing_detail.append(activity_name)
            continue

        # Load loot tables
        loot_data = load_cache(f'api_loot_{activity_id}.json')
        if not loot_data:
            missing_loot.append(activity_name)
            loot_data = []

        api_data[activity_name.lower()] = {
            'id': activity_id,
            'name': activity_name,
            'detail': detail,
            'loot_tables': loot_data,
            'skills': activity.get('relatedSkillsList', []),
        }

    if missing_detail:
        print(f"  ⚠ Missing detail for {len(missing_detail)} activities: {', '.join(missing_detail[:5])}")
    if missing_loot:
        print(f"  ⚠ Missing loot for {len(missing_loot)} activities: {', '.join(missing_loot[:5])}")

    print(f"  Loaded {len(api_data)} activities from cache")
    return api_data


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("=" * 60)
    print("Ingesting drop tables from HAR cache")
    print("=" * 60)

    # Build api_data from local cache
    print("\nLoading cached API data...")
    api_data = build_api_data_from_cache()
    if not api_data:
        print("ERROR: No API data loaded")
        return

    # Import scraper modules
    sys.path.insert(0, 'util/scrapers')
    import scrape_activities
    from overlay_gear_api import overlay_api_data

    # Patch RESCRAPE=False so it uses cached wiki HTML
    scrape_activities.RESCRAPE = False

    # Run the full scraper pipeline (uses cached wiki HTML)
    print("\nRunning full activities scraper (using cached wiki HTML)...")
    activities_data = scrape_activities.run_full_scrape()
    print(f"  Scraped activities: {len(activities_data)}")

    # Count empty drop tables before overlay
    empty_before = sum(1 for a in activities_data if a and not a.get('drop_table'))
    print(f"  Activities with empty primary drop_table: {empty_before}")

    # Overlay API data from HAR cache
    print("\nOverlaying API drop data from HAR cache...")
    patched, new_count = overlay_api_data(activities_data, api_data)

    # Count empty drop tables after
    empty_after = sum(1 for a in activities_data if a and not a.get('drop_table'))
    print(f"\n  Activities with empty primary drop_table after overlay: {empty_after}")
    print(f"  Filled: {empty_before - empty_after}")

    # Link items and locations
    print("\nLinking items and locations...")
    scrape_activities.link_items_and_locations(activities_data)

    # Generate module
    print("\nGenerating activities.py...")
    scrape_activities.generate_module(activities_data)

    print("\n✓ Done!")


if __name__ == '__main__':
    main()
