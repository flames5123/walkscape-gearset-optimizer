#!/usr/bin/env python3
"""
Master icon scraper - Downloads all icons from the Walkscape wiki.

Run this after cloning the repo to populate the assets/icons/ directory.
Icons are copyrighted game assets and are NOT included in the repository.

Usage:
    python3 util/scrapers/scrape_all_icons.py           # Run all icon scrapers
    python3 util/scrapers/scrape_all_icons.py equipment  # Run specific scraper only

Available scrapers:
    - items: Equipment, materials, consumables, collectibles, containers (main scraper)
    - activities: Activity icons organized by skill
    - keywords: Keyword icons (diving gear, light source, etc.)
    - services: Service/crafting station icons
    - factions: Faction reputation icons
    - skills: Skill category icons
    - pet_eggs: Pet egg icons
    - misc: Miscellaneous icons (coins, achievement points, etc.)
"""

import subprocess
import sys
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRAPERS_DIR = Path(__file__).parent

# (name, script_filename, description)
ICON_SCRAPERS = [
    ('items', 'scrape_icons.py', 'Equipment, materials, consumables, collectibles, containers'),
    ('activities', 'scrape_activity_icons.py', 'Activity icons by skill'),
    ('keywords', 'scrape_keyword_icons.py', 'Keyword icons'),
    ('services', 'scrape_service_icons.py', 'Service/crafting station icons'),
    ('factions', 'scrape_faction_icons.py', 'Faction reputation icons'),
    ('skills', 'scrape_skill_icons.py', 'Skill category icons'),
    ('pet_eggs', 'scrape_pet_egg_icons.py', 'Pet egg icons'),
    ('locations', 'scrape_location_icons.py', 'Location icons'),
    ('attributes', 'scrape_attribute_icons.py', 'Attribute icons'),
    ('item_finding_items', 'scrape_item_finding_icons.py', 'Item Finding Items icons'),
    ('misc', 'scrape_misc_icons.py', 'Misc icons'),
]

# ============================================================================
# MAIN LOGIC
# ============================================================================

def run_scraper(script_name, description):
    """Run a single icon scraper."""
    script_path = SCRAPERS_DIR / script_name
    if not script_path.exists():
        print(f"  ⚠ Script not found: {script_name}")
        return False

    print(f"  Running: {script_name}")
    result = subprocess.run(
        ['python3', str(script_path)],
        capture_output=True, text=True,
        cwd=str(SCRAPERS_DIR.parent.parent)  # Run from project root
    )

    if result.returncode != 0:
        print(f"  ✗ FAILED with exit code {result.returncode}")
        if result.stderr:
            # Show last few lines of error
            lines = result.stderr.strip().split('\n')
            for line in lines[-5:]:
                print(f"    {line}")
        return False
    else:
        lines = result.stdout.strip().split('\n')
        for line in lines[-3:]:
            print(f"    {line}")
        print(f"  ✓ Success")
        return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]

    if '--help' in sys.argv or '-h' in sys.argv:
        print(__doc__)
        return 0

    # Ensure required directories exist
    project_root = SCRAPERS_DIR.parent.parent
    icons_dir = project_root / 'assets' / 'icons'
    icons_dir.mkdir(parents=True, exist_ok=True)

    # Determine which scrapers to run
    if args:
        scrapers_to_run = []
        for name in args:
            scraper = next((s for s in ICON_SCRAPERS if s[0] == name), None)
            if scraper:
                scrapers_to_run.append(scraper)
            else:
                print(f"Unknown scraper: {name}")
                print(f"Available: {', '.join(s[0] for s in ICON_SCRAPERS)}")
                return 1
    else:
        scrapers_to_run = ICON_SCRAPERS

    print("=" * 60)
    print("Walkscape Icon Scraper")
    print("=" * 60)
    print(f"\nDownloading icons from wiki ({len(scrapers_to_run)} scrapers)...\n")

    results = []
    for name, script, desc in scrapers_to_run:
        print(f"[{name.upper()}] {desc}")
        success = run_scraper(script, desc)
        results.append((name, success))
        print()

    # Summary
    print("=" * 60)
    success_count = sum(1 for _, s in results if s)
    for name, success in results:
        print(f"  {'✓' if success else '✗'} {name}")
    print(f"\nCompleted: {success_count}/{len(results)} successful")

    return 0 if success_count == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
