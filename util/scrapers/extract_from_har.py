#!/usr/bin/env python3
"""
Extract all data from gear.walkscape.app HAR archive.

Extracts:
1. All API responses (activities, items, loot tables, materials, etc.) → temp_gear_app_cache/
2. All icon PNGs from batch responses → assets/icons/items/ (by type)

Usage:
    python3 util/scrapers/extract_from_har.py
"""

import json
import os
import base64
import re
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

HAR_FILE = "gear.walkscape.app_Archive [26-03-24 20-53-44].har"
CACHE_DIR = Path("temp_gear_app_cache")
ICONS_DIR = Path("assets/icons")

# API endpoints to extract as JSON files
API_EXTRACTS = {
    'api/activities': 'api_activities_list.json',
    'api/recipes': 'api_recipes_list.json',
    'api/lootTables': 'api_loot_tables_all.json',
    'api/items/item_value_mapping': 'api_item_value_mapping.json',
    'api/items/url_mapping': 'api_item_url_mapping.json',
    'api/items/categorized_items': 'api_items_categorized.json',
    'api/items/search?type=material&detailed=true': 'api_materials_detailed.json',
    'api/items/fine_materials': 'api_fine_materials.json',
    'api/locations': 'api_locations.json',
    'api/routes': 'api_routes.json',
    'api/skills': 'api_skills.json',
    'api/factions': 'api_factions.json',
    'api/keywords': 'api_keywords.json',
    'api/stats': 'api_stats.json',
    'api/global_variables': 'api_global_variables.json',
    'api/achievements/ap': 'api_achievements_ap.json',
    'api/terrain_modifiers': 'api_terrain_modifiers.json',
    'api/locations/realm_default_locations': 'api_realm_default_locations.json',
    'api/abilities': 'api_abilities.json',
}

# ============================================================================
# EXTRACTION
# ============================================================================

def extract_har():
    """Extract all useful data from the HAR file."""
    print(f"Reading HAR file: {HAR_FILE}")
    
    with open(HAR_FILE, 'r', encoding='utf-8') as f:
        har = json.load(f)
    
    entries = har['log']['entries']
    print(f"Total entries: {len(entries)}")
    
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    api_saved = 0
    icons_saved = 0
    icon_errors = 0
    
    for entry in entries:
        url = entry['request']['url']
        response = entry.get('response', {})
        content = response.get('content', {})
        mime = content.get('mimeType', '')
        text = content.get('text', '')
        
        if not text:
            continue
        
        # Strip base URL
        path = url.replace('https://gear.walkscape.app/', '')
        
        # ── JSON API responses ──────────────────────────────────────────────
        if 'application/json' in mime:
            # Check if this matches one of our target endpoints
            for api_path, filename in API_EXTRACTS.items():
                if path == api_path or path.startswith(api_path + '?') or path == api_path:
                    out_path = CACHE_DIR / filename
                    if not out_path.exists():
                        try:
                            data = json.loads(text)
                            with open(out_path, 'w', encoding='utf-8') as f:
                                json.dump(data, f, indent=2)
                            print(f"  ✓ {filename}")
                            api_saved += 1
                        except json.JSONDecodeError as e:
                            print(f"  ✗ {filename}: JSON error: {e}")
                    break
            
            # Also save individual activity/recipe detail pages
            m = re.match(r'api/activities/([^?]+)$', path)
            if m:
                activity_id = m.group(1)
                out_path = CACHE_DIR / f'api_activity_{activity_id}.json'
                if not out_path.exists():
                    try:
                        data = json.loads(text)
                        with open(out_path, 'w', encoding='utf-8') as f:
                            json.dump(data, f, indent=2)
                        api_saved += 1
                    except json.JSONDecodeError:
                        pass
            
            m = re.match(r'api/recipes/([^?]+)$', path)
            if m:
                recipe_id = m.group(1)
                out_path = CACHE_DIR / f'api_recipe_{recipe_id}.json'
                if not out_path.exists():
                    try:
                        data = json.loads(text)
                        with open(out_path, 'w', encoding='utf-8') as f:
                            json.dump(data, f, indent=2)
                        api_saved += 1
                    except json.JSONDecodeError:
                        pass
            
            # lootTables/multiple POST responses — name by activity ID from POST body
            if 'lootTables/multiple' in path:
                try:
                    data = json.loads(text)
                    if data and isinstance(data, list):
                        # Try to find the activity ID from the POST body
                        post_body = entry.get('request', {}).get('postData', {}).get('text', '')
                        activity_id = None
                        if post_body:
                            try:
                                body = json.loads(post_body)
                                ids = body.get('ids', [])
                                # The activity's primary table ID matches the activity ID
                                # Find which table ID matches an activity (not a chest/collectible)
                                for tid in ids:
                                    # Activity IDs don't contain 'chest', 'collectible', 'table', 'pouch', 'nest', 'egg'
                                    skip_words = ['chest', 'collectible', 'table', 'pouch', 'nest', 'egg', 'gem', 'coin', 'bird', 'rusty', 'sunken', 'coral', 'jarvonia', 'trellin', 'erdwise', 'syrenthia', 'halfling', 'wallisia', 'wrentmark', 'gdte', 'find_', 'gain_', 'guaranteed_', 'name_tags', 'unidentified', 'trash_', 'silver_ore_smithing']
                                    if not any(w in tid for w in skip_words):
                                        activity_id = tid
                                        break
                                # Fallback: use first ID
                                if not activity_id and ids:
                                    activity_id = ids[0]
                            except (json.JSONDecodeError, KeyError):
                                pass
                        
                        if not activity_id:
                            # Fallback: use first table ID from response
                            activity_id = data[0].get('id', 'unknown') if data else 'unknown'
                        
                        out_path = CACHE_DIR / f'api_loot_{activity_id}.json'
                        if not out_path.exists():
                            with open(out_path, 'w', encoding='utf-8') as f:
                                json.dump(data, f, indent=2)
                            api_saved += 1
                except (json.JSONDecodeError, IndexError, KeyError):
                    pass
            
            # locations/search responses
            m = re.match(r'api/locations/search\?activityList=([^&]+)', path)
            if m:
                activity_id = m.group(1)
                out_path = CACHE_DIR / f'api_locations_{activity_id}.json'
                if not out_path.exists():
                    try:
                        data = json.loads(text)
                        with open(out_path, 'w', encoding='utf-8') as f:
                            json.dump(data, f, indent=2)
                        api_saved += 1
                    except json.JSONDecodeError:
                        pass
            
            # items/{id} individual item pages
            m = re.match(r'api/items/([^/?]+)$', path)
            if m:
                item_id = m.group(1)
                if item_id not in ('item_value_mapping', 'url_mapping', 'categorized_items', 'fine_materials'):
                    out_path = CACHE_DIR / f'api_item_{item_id}.json'
                    if not out_path.exists():
                        try:
                            data = json.loads(text)
                            with open(out_path, 'w', encoding='utf-8') as f:
                                json.dump(data, f, indent=2)
                            api_saved += 1
                        except json.JSONDecodeError:
                            pass
        
        # ── PNG icons ───────────────────────────────────────────────────────
        elif 'image/png' in mime or path.endswith('.png'):
            # Single icon URL: api/icons/assets/icons/items/gear/...
            m = re.match(r'api/icons/(assets/icons/.+\.png)$', path)
            if m:
                icon_rel = m.group(1)  # e.g. assets/icons/items/gear/neck/amulet_of_root.png
                out_path = Path(icon_rel)
                if not out_path.exists():
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        # text may be base64 encoded
                        encoding = content.get('encoding', '')
                        if encoding == 'base64':
                            img_data = base64.b64decode(text)
                        else:
                            img_data = text.encode('latin-1')
                        with open(out_path, 'wb') as f:
                            f.write(img_data)
                        icons_saved += 1
                    except Exception as e:
                        icon_errors += 1
        
        # ── Icon batch responses ────────────────────────────────────────────
        # Batch responses are JSON with {iconPath: base64data}
        elif 'api/icons/batch' in path and 'application/json' in mime:
            try:
                batch_data = json.loads(text)
                if isinstance(batch_data, dict):
                    for icon_path, icon_b64 in batch_data.items():
                        # icon_path like "assets/icons/items/gear/neck/amulet_of_root.png"
                        out_path = Path(icon_path)
                        if not out_path.exists():
                            out_path.parent.mkdir(parents=True, exist_ok=True)
                            try:
                                img_data = base64.b64decode(icon_b64)
                                with open(out_path, 'wb') as f:
                                    f.write(img_data)
                                icons_saved += 1
                            except Exception:
                                icon_errors += 1
            except json.JSONDecodeError:
                pass
    
    print(f"\n{'='*50}")
    print(f"Extraction complete:")
    print(f"  API responses saved: {api_saved}")
    print(f"  Icons saved: {icons_saved}")
    if icon_errors:
        print(f"  Icon errors: {icon_errors}")
    
    # Report what we got
    print(f"\nCache contents ({CACHE_DIR}):")
    for f in sorted(CACHE_DIR.iterdir()):
        size = f.stat().st_size
        print(f"  {f.name} ({size:,} bytes)")


if __name__ == '__main__':
    extract_har()
