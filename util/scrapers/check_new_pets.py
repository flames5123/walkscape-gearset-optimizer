#!/usr/bin/env python3
"""Check what pets/eggs exist in the API vs our data."""
import json
from pathlib import Path

with open('temp_gear_app_cache/api_items_categorized_fresh.json') as f:
    categories = json.load(f)

# Find pet items
pets = []
eggs = []
for cat in categories:
    for subcat in cat.get('categories', []):
        title = subcat.get('title', '')
        for item in subcat.get('items', []):
            if 'pet' in title.lower() or 'pet' in item.get('type', ''):
                pets.append(item)
            if 'egg' in item.get('id', '') and item.get('type') != 'collectible':
                eggs.append(item)

print(f"Pets in API: {len(pets)}")
for p in pets:
    print(f"  {p['id']}: {p['name']} type={p.get('type')} gearType={p.get('gearType')}")
    # Show stats
    for attr in p.get('itemAttrs', []):
        for s in attr.get('stats', []):
            print(f"    {s['name']}: {s['value']} ({s['stat']})")

print(f"\nEggs in API: {len(eggs)}")
for e in eggs:
    print(f"  {e['id']}: {e['name']} type={e.get('type')}")
