#!/usr/bin/env python3
"""
Re-fetch all previously embargoed activities from the live API and update the cache.
Run this when embargo is lifted to get the real drop tables.
"""
import json
import time
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

CACHE_DIR = Path('temp_gear_app_cache')
API_BASE = 'https://gear.walkscape.app/api'
DELAY = 0.2

EMBARGOED = [
    'alligator_hunting', 'bear_hunting', 'bird_feeding', 'bird_watching',
    'box_trapping', 'crab_tracking', 'deer_hunting', 'drift_net_hunting',
    'ectoplasm_slime_hunting', 'halfmaw_tracking', 'large_sail_repair',
    'lizard_hunting', 'rabbit_tracking', 'small_sail_repair',
    'squirrel_hunting', 'unicorn_hunting', 'wolf_hunting',
]

def get(path):
    req = Request(f"{API_BASE}/{path}", headers={'Accept': 'application/json', 'User-Agent': 'WalkscapeOptimizer/1.0'})
    with urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def post(path, body):
    data = json.dumps(body).encode()
    req = Request(f"{API_BASE}/{path}", data=data, headers={'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'WalkscapeOptimizer/1.0'})
    with urlopen(req, timeout=10) as r:
        return json.loads(r.read())

updated = 0
for act_id in EMBARGOED:
    try:
        detail = get(f'activities/{act_id}')
        with open(CACHE_DIR / f'api_activity_{act_id}.json', 'w') as f:
            json.dump(detail, f)

        # Collect all table IDs
        table_ids = []
        for tg in detail.get('tables', []):
            table_ids.extend(tg.get('tables', []))

        if table_ids:
            loot = post('lootTables/multiple', {'ids': table_ids})
            with open(CACHE_DIR / f'api_loot_{act_id}.json', 'w') as f:
                json.dump(loot, f)

        primary = [t for t in detail.get('tables', []) if t.get('isPrimary')]
        print(f"  ✓ {act_id}: {len(primary)} primary tables, {len(table_ids)} total")
        updated += 1
        time.sleep(DELAY)
    except Exception as e:
        print(f"  ✗ {act_id}: {e}")

print(f"\nUpdated {updated}/{len(EMBARGOED)} activities")
