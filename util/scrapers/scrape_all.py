#!/usr/bin/env python3
"""
Master scraper runner — regenerates all WalkScape data files.

WalkScape data is now sourced primarily from the **tools API**, not the wiki.
A default run therefore does two phases:

  PHASE 1 — API path (the real scrapers + UUID resolution):
    1. update_from_api.py         Master API update: equipment (ingest_gear),
                                   materials cleanup/fine, and activities.
    2. ingest_pets_from_api.py    Pets            -> pets.py
    3. ingest_consumables_from_api.py  Consumables -> consumables.py
    4. ingest_shops_from_api.py   Shops           -> shops_from_api.py (sibling;
                                   the API now exposes prices)
    5. fix_equipment_uuids.py     Resolve real item UUIDs in equipment.py

  PHASE 2 — wiki scrapers that have NO API replacement yet (still the
            source of truth for their data files):
    recipes, services, collectibles, routes, locations, containers,
    ap_rewards, faction_rewards, shops (wiki shops.py — the API has no
    currency field), export_names, mysterious_merchant.

RETIRED wiki scrapers (renamed to OLD_*.py, NOT run):
    equipment    -> update_from_api.py (ingest_gear_from_api.py)
    pets         -> ingest_pets_from_api.py
    consumables  -> ingest_consumables_from_api.py
    materials    -> handled inside update_from_api.py
    activities   -> handled inside update_from_api.py

Usage:
    python3 util/scrapers/scrape_all.py                 # full default run (API + wiki)
    python3 util/scrapers/scrape_all.py --api-only      # just the API phase
    python3 util/scrapers/scrape_all.py --wiki-only     # just the wiki phase
    python3 util/scrapers/scrape_all.py update_from_api recipes   # specific steps by name
    python3 util/scrapers/scrape_all.py --no-cache recipes        # clear wiki cache first
"""

import shutil
import subprocess
import sys
from pathlib import Path

# ============================================================================
# PATHS
# ============================================================================

SCRAPERS_DIR = Path(__file__).resolve().parent          # util/scrapers/
REPO_ROOT = SCRAPERS_DIR.parent.parent                  # repo root

# ============================================================================
# PHASE 1 — API steps. (name, script_relpath_from_repo_root, description)
# These scripts use paths relative to the REPO ROOT, so they run with
# cwd=REPO_ROOT.
# ============================================================================

API_STEPS = [
    ('update_from_api',     'util/scrapers/update_from_api.py',            'Master API update: equipment + materials + activities'),
    ('ingest_pets',         'util/scrapers/ingest_pets_from_api.py',       'Pets from tools API -> pets.py'),
    ('ingest_consumables',  'util/scrapers/ingest_consumables_from_api.py','Consumables from tools API -> consumables.py'),
    ('ingest_shops',        'util/scrapers/ingest_shops_from_api.py',      'Shops from tools API -> shops_from_api.py (sibling)'),
    ('fix_uuids',           'util/scrapers/fix_equipment_uuids.py',        'Resolve real item UUIDs in equipment.py'),
]

# ============================================================================
# PHASE 2 — wiki scrapers with no API replacement yet.
# (name, script_filename, cache_path_from_scrapers_dir, description)
# These use `from scraper_utils import *`, so they run with cwd=SCRAPERS_DIR.
# ============================================================================

WIKI_SCRAPERS = [
    ('recipes',             'scrape_recipes.py',             '../cache/recipes_cache.html',      'Crafting recipes'),
    ('services',            'scrape_services.py',            '../cache/services_cache.html',     'Crafting benches (API services still non-prod)'),
    ('collectibles',        'scrape_collectibles.py',        '../cache/collectibles_cache.html', 'Collectibles'),
    ('routes',              'scrape_routes.py',              '../cache/routes_cache.html',       'Travel routes'),
    ('locations',           'scrape_locations.py',           '../cache/routes_cache.html',       'Location data'),
    ('containers',          'scrape_containers.py',          '../cache/containers',              'Chests and loot tables'),
    ('ap_rewards',          'scrape_ap_rewards.py',          '../cache/ap_rewards_cache.html',   'AP reward track'),
    ('faction_rewards',     'scrape_faction_rewards.py',     '../cache/faction_rewards_cache',   'Faction reward tracks'),
    ('shops',               'scrape_shops.py',               '../cache/shops_cache',             'Shop inventories (wiki; canonical shops.py — has currency)'),
    ('export_names',        'scrape_export_names.py',        '../cache/equipment_cache',         'Export name mappings'),
    ('mysterious_merchant', 'scrape_mysterious_merchant.py', '../cache/mysterious_merchant.html','Mysterious Merchant chip trades'),
]

# Retired wiki scrapers — kept as OLD_*.py for reference, never auto-run.
RETIRED = {
    'equipment':   'retired -> update_from_api.py (ingest_gear_from_api.py)',
    'pets':        'retired -> ingest_pets_from_api.py',
    'consumables': 'retired -> ingest_consumables_from_api.py',
    'materials':   'handled inside update_from_api.py',
    'activities':  'handled inside update_from_api.py',
}

# ============================================================================
# HELPERS
# ============================================================================

def clear_cache(cache_path_str):
    """Delete a wiki-scraper cache folder or file if it exists."""
    cache_path = Path(cache_path_str)
    if cache_path.exists():
        print(f"  Clearing cache: {cache_path_str}")
        if cache_path.is_dir():
            shutil.rmtree(cache_path)
        else:
            cache_path.unlink()
    else:
        print(f"  No cache to clear: {cache_path_str}")


def run_api_step(script_relpath):
    """Run a PHASE 1 API script from the repo root."""
    print(f"  Running (repo root): {script_relpath}")
    r = subprocess.run([sys.executable, script_relpath], cwd=REPO_ROOT)
    return _report(r.returncode)


def run_wiki_scraper(script_filename):
    """Run a PHASE 2 wiki scraper from util/scrapers/."""
    print(f"  Running (scrapers dir): {script_filename}")
    r = subprocess.run([sys.executable, script_filename], cwd=SCRAPERS_DIR)
    return _report(r.returncode)


def _report(returncode):
    if returncode != 0:
        print(f"  ❌ FAILED with exit code {returncode}")
        return False
    print("  ✅ Success")
    return True


# ============================================================================
# MAIN
# ============================================================================

def main():
    args = sys.argv[1:]

    if '--help' in args or '-h' in args:
        print(__doc__)
        return 0

    api_only = '--api-only' in args
    wiki_only = '--wiki-only' in args
    clear_caches = '--no-cache' in args or '--clear-cache' in args
    names = [a for a in args if not a.startswith('-')]

    # Resolve which steps to run.
    api_by_name = {s[0]: s for s in API_STEPS}
    wiki_by_name = {s[0]: s for s in WIKI_SCRAPERS}

    if names:
        api_run, wiki_run = [], []
        for name in names:
            if name in RETIRED:
                print(f"⚠ '{name}' is retired ({RETIRED[name]}). Skipping.")
                continue
            if name in api_by_name:
                api_run.append(api_by_name[name])
            elif name in wiki_by_name:
                wiki_run.append(wiki_by_name[name])
            else:
                print(f"Unknown step: {name}")
                print(f"  API steps: {', '.join(api_by_name)}")
                print(f"  Wiki scrapers: {', '.join(wiki_by_name)}")
                return 1
    else:
        api_run = [] if wiki_only else list(API_STEPS)
        wiki_run = [] if api_only else list(WIKI_SCRAPERS)

    print("=" * 60)
    print("WalkScape Data Scraper (API-first)")
    print("=" * 60)

    # Clear wiki caches if requested.
    if clear_caches and wiki_run:
        print("\nClearing wiki caches...")
        for _, _, cache, _ in wiki_run:
            clear_cache(SCRAPERS_DIR / cache)

    results = []

    if api_run:
        print(f"\n{'─'*60}\nPHASE 1 — API path ({len(api_run)} step(s))\n{'─'*60}")
        for name, script, desc in api_run:
            print(f"\n[{name.upper()}] {desc}")
            results.append((name, run_api_step(script)))

    if wiki_run:
        print(f"\n{'─'*60}\nPHASE 2 — wiki scrapers ({len(wiki_run)} step(s))\n{'─'*60}")
        for name, script, _cache, desc in wiki_run:
            print(f"\n[{name.upper()}] {desc}")
            results.append((name, run_wiki_scraper(script)))

    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    for name, ok in results:
        print(f"{'✅' if ok else '❌'} {name}")
    success = sum(1 for _, ok in results if ok)
    print(f"\nCompleted: {success}/{len(results)} successful")
    return 0 if success == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
