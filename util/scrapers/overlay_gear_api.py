#!/usr/bin/env python3
"""
Overlay precise drop rate data from gear.walkscape.app API onto wiki-scraped activities.

The wiki gives rounded percentages (e.g., 0.1% for Wire Saw).
The gear API gives exact values (e.g., noDropChance=0.75, rowWeight=0.08).

This module:
1. Fetches the activity list from /api/activities
2. For each activity, fetches detail from /api/activities/{id}
3. Fetches loot tables from /api/lootTables/multiple
4. Patches the wiki-scraped activity data with exact drop rates, base_steps, base_xp, max_efficiency

Usage:
    from overlay_gear_api import overlay_api_data
    overlay_api_data(activities_data)  # Mutates in-place
"""

import json
import time
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

# ============================================================================
# CONFIGURATION
# ============================================================================

API_BASE = 'https://gear.walkscape.app/api'
CACHE_DIR = Path(os.path.dirname(os.path.dirname(__file__))) / 'cache' / 'gear_api_cache'
RESCRAPE_API = False  # Set True to re-download from API even if cached
REQUEST_DELAY = 0.15  # Seconds between API requests (be nice to the server)

# Skill name mapping: API uses lowercase, wiki uses Title Case
SKILL_NAME_MAP = {
    'agility': 'Agility',
    'carpentry': 'Carpentry',
    'cooking': 'Cooking',
    'crafting': 'Crafting',
    'fishing': 'Fishing',
    'foraging': 'Foraging',
    'hunting': 'Hunting',
    'mining': 'Mining',
    'smithing': 'Smithing',
    'tailoring': 'Tailoring',
    'trinketry': 'Trinketry',
    'woodcutting': 'Woodcutting',
}

# ============================================================================
# API HELPERS
# ============================================================================

def api_get(path, cache_filename=None):
    """GET request to gear API with caching."""
    url = f"{API_BASE}/{path}"
    
    if cache_filename:
        cache_path = CACHE_DIR / cache_filename
        if not RESCRAPE_API and cache_path.exists():
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    
    try:
        req = Request(url, headers={
            'Accept': 'application/json',
            'User-Agent': 'WalkscapeOptimizer/1.0',
        })
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        
        if cache_filename:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f)
        
        time.sleep(REQUEST_DELAY)
        return data
    except (URLError, HTTPError) as e:
        print(f"  ⚠ API error for {url}: {e}")
        return None


def api_post(path, body, cache_filename=None):
    """POST request to gear API with caching."""
    url = f"{API_BASE}/{path}"
    
    if cache_filename:
        cache_path = CACHE_DIR / cache_filename
        if not RESCRAPE_API and cache_path.exists():
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
    
    try:
        data_bytes = json.dumps(body).encode('utf-8')
        req = Request(url, data=data_bytes, headers={
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'WalkscapeOptimizer/1.0',
        })
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        
        if cache_filename:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(data, f)
        
        time.sleep(REQUEST_DELAY)
        return data
    except (URLError, HTTPError) as e:
        print(f"  ⚠ API error for {url}: {e}")
        return None


# ============================================================================
# DROP TABLE CONVERSION
# ============================================================================

def calculate_drop_chance(no_drop_chance, row_weight, total_weight):
    """Calculate exact drop chance percentage for a single item.
    
    Args:
        no_drop_chance: Probability of getting nothing (0.0 to 1.0)
        row_weight: This item's weight in the table
        total_weight: Sum of all row weights in the table
    
    Returns:
        Drop chance as percentage (e.g., 25.526 for 25.526%)
    """
    if total_weight == 0:
        return 0.0
    drop_chance = (1.0 - no_drop_chance) * (row_weight / total_weight)
    return drop_chance * 100.0


def convert_loot_tables(activity_detail, loot_tables_data):
    """Convert API loot table data into our drop_table / secondary_drop_table format.
    
    Stores raw API values (no_drop_chance, row_weight, table_weight) so that
    chance_percent is computed on-the-fly without floating point noise.
    
    Args:
        activity_detail: The /api/activities/{id} response
        loot_tables_data: The /api/lootTables/multiple response (list of tables)
    
    Returns:
        (drop_table, secondary_drop_table) - lists of drop dicts in our format
    """
    drop_table = []
    secondary_drop_table = []
    
    # Build lookup of loot table data by ID
    tables_by_id = {t['id']: t for t in loot_tables_data}

    # Per-skill base level requirements + the activity's primary skill. Used to
    # restore level-gated drops (e.g. Raw stingray needs Fishing 45 in Sea
    # fishing (Spear)). The API encodes the gate in each row's
    # requirementsBonuses[].levelRequirement; this must be preserved or the
    # downstream level-scaling logic (is_level_based / get_chance_at_level) goes
    # inert and sub-level drops are wrongly shown as catchable (bug 1a799e8d).
    base_levels = {}
    for _req in (activity_detail.get('requirements') or []):
        if _req.get('type') == 'skillLevel':
            _rq = _req.get('requirement') or {}
            _sk = (_rq.get('skill') or '').lower()
            if _sk:
                base_levels[_sk] = _rq.get('level', 1)
    _related = activity_detail.get('relatedSkillsList') or []
    primary_skill = (_related[0].lower() if _related else (next(iter(base_levels), '')))
    primary_base = base_levels.get(primary_skill, 1)

    def _row_scaling(row):
        """Return (level_requirement, level_max_scaling, scaling_weight) for the
        activity's primary skill from a row's requirementsBonuses. level_max_scaling
        is the level at which the row reaches full weight (it ramps linearly from
        level_requirement to there). Returns (0, 0, 0) when the row has no gate."""
        req = max_sc = scal = 0
        for rb in (row.get('requirementsBonuses') or []):
            if (rb.get('relatedSkill') or '').lower() == primary_skill:
                v = rb.get('levelRequirement') or 0
                if v >= req:
                    req = v
                    max_sc = rb.get('levelMaxScaling') or 0
                    scal = rb.get('scalingWeight') or 0
        return req, max_sc, scal

    def _row_level_requirement(row):
        return _row_scaling(row)[0]
    
    # Build the list of table groups to process.
    # Some activities (especially embargoed ones) have a primary loot table with the
    # same ID as the activity itself that isn't listed in detail['tables'].
    # Detect it by checking if a table with the activity ID exists in loot_tables_data
    # and has rows but isn't already referenced in detail['tables'].
    activity_id = activity_detail.get('id', '')
    referenced_ids = set()
    for tg in activity_detail.get('tables', []):
        referenced_ids.update(tg.get('tables', []))
    
    table_groups = list(activity_detail.get('tables', []))
    
    # If there's a loot table matching the activity ID that isn't referenced, add it as primary
    if activity_id and activity_id in tables_by_id and activity_id not in referenced_ids:
        primary_table = tables_by_id[activity_id]
        if primary_table.get('tableRows'):
            table_groups.insert(0, {
                'isPrimary': True,
                'type': [],
                'rollAmount': 1,
                'tables': [activity_id],
            })
    
    # Process each table group from the activity detail
    for table_group in table_groups:
        is_primary = table_group.get('isPrimary', False)
        table_type = table_group.get('type', [])
        roll_amount = table_group.get('rollAmount', 1)
        table_ids = table_group.get('tables', [])
        
        is_first_table_in_group = True
        # Track item names already added from earlier tables in this group
        # so bonus/additional tables don't create duplicate entries.
        seen_primary_items = set()
        for table_id in table_ids:
            table_data = tables_by_id.get(table_id)
            if not table_data:
                continue
            
            no_drop_chance = table_data.get('noDropChance', 0)
            rows = table_data.get('tableRows', [])
            
            # Calculate total weight for this table
            total_weight = sum(r.get('rowWeight', 0) for r in rows)

            # A primary table is "level-gated" when at least one row only starts
            # dropping above the activity's own skill requirement (e.g. Raw
            # stingray at Fishing 45 in a Fishing-30 activity). When so, every
            # row in THIS table is encoded as a level-based drop so the existing
            # get_chance_at_level logic gates sub-level drops to 0% and
            # re-normalises the rest per character level. Bonus/secondary tables
            # (sea shell, chests) are independent rolls and stay static.
            table_is_level_gated = is_primary and any(
                _row_level_requirement(r) > primary_base for r in rows
            )
            
            # If noDropChance == 1.0, nothing ever drops
            if no_drop_chance >= 1.0:
                continue
            
            # Add "Nothing" entry only for the FIRST table in a primary group.
            # Bonus/additional tables within the same group (e.g. "shells_10_percent")
            # are merged into the main drop list without their own Nothing row.
            if is_primary and no_drop_chance > 0 and is_first_table_in_group:
                nothing_pct = no_drop_chance * 100.0
                drop_table.append({
                    'item': 'Nothing',
                    'quantity': {'min_qty': None, 'max_qty': None, 'is_na': True},
                    'chance': nothing_pct,
                    # No raw API fields for "Nothing" - it's derived from noDropChance directly
                })
            
            for row in rows:
                item_name = row.get('name')
                is_money = row.get('isMoney', False)
                row_weight = row.get('rowWeight', 0)
                min_amount = row.get('rowMinimumAmount', 1)
                max_amount = row.get('rowMaximumAmount', 1)
                
                if not item_name and is_money:
                    item_name = 'Coins'
                
                if not item_name:
                    continue
                
                drop_entry = {
                    'item': item_name,
                    'quantity': {
                        'min_qty': min_amount,
                        'max_qty': max_amount,
                        'is_na': False,
                    },
                    # Store raw API values - chance_percent computed at runtime
                    'no_drop_chance': no_drop_chance,
                    'row_weight': row_weight,
                    'table_weight': total_weight,
                    'chance': None,  # Will be computed from raw values
                }

                # Restore the level gate for level-gated primary tables onto the
                # existing level-based fields. The drop is absent below
                # initial_level and ramps its weight linearly up to full at
                # max_chance_level (= levelMaxScaling). Rows with no scaling range
                # (levelMaxScaling 0/<= requirement, e.g. Sea fishing Spear's
                # stingray) reach full weight immediately (max == initial).
                # final_chance is the resolved max-level percentage that
                # get_chance_at_level interpolates over the level range
                # (bug 1a799e8d).
                if table_is_level_gated and total_weight > 0:
                    _req, _max_sc, _scal = _row_scaling(row)
                    row_req = max(_req, primary_base)
                    if _scal and _max_sc and _max_sc > row_req:
                        max_chance_level = _max_sc
                    else:
                        max_chance_level = row_req
                    final_chance = (1.0 - no_drop_chance) * (row_weight / total_weight) * 100.0
                    drop_entry['initial_level'] = row_req
                    drop_entry['max_chance_level'] = max_chance_level
                    drop_entry['final_chance'] = round(final_chance, 3)

                # Multi-roll support
                if roll_amount > 1:
                    drop_entry['multi_roll_count'] = roll_amount
                
                if is_primary:
                    # Skip items already seen from an earlier table in this
                    # group (bonus tables often repeat an item from the main
                    # table with different odds).
                    item_key = item_name.lower()
                    if item_key in seen_primary_items:
                        continue
                    seen_primary_items.add(item_key)
                    drop_table.append(drop_entry)
                else:
                    secondary_drop_table.append(drop_entry)
            
            is_first_table_in_group = False
    
    return drop_table, secondary_drop_table


# ============================================================================
# MAIN OVERLAY FUNCTION
# ============================================================================

def fetch_all_api_activities():
    """Fetch all activity data from the gear API.
    
    Returns:
        Dict mapping activity name (lowercase) to full API data including loot tables.
    """
    print("\n" + "=" * 60)
    print("Fetching data from gear.walkscape.app API")
    print("=" * 60)
    
    # Step 1: Get activity list
    activities_list = api_get('activities', 'api_activities_list.json')
    if not activities_list:
        print("ERROR: Could not fetch activities list from API")
        return {}
    
    print(f"  API has {len(activities_list)} activities")
    
    # Include all activities (embargoed ones may have been manually added before)
    embargoed = [a for a in activities_list if a.get('embargo', False)]
    available = activities_list  # Include everything
    print(f"  Total: {len(available)} ({len(embargoed)} embargoed)")
    if embargoed:
        print(f"  Embargoed: {', '.join(a['name'] for a in embargoed)}")
    
    # Step 2: Fetch detail for each activity
    api_data = {}
    for i, activity in enumerate(available, 1):
        activity_id = activity['id']
        activity_name = activity['name']
        
        # Skip "None" and "Travelling" 
        if activity_id in ('none', 'travelling'):
            continue
        
        print(f"  [{i}/{len(available)}] {activity_name}...", end='', flush=True)
        
        detail = api_get(f'activities/{activity_id}', f'api_activity_{activity_id}.json')
        if not detail:
            print(" FAILED")
            continue
        
        # Collect all loot table IDs
        all_table_ids = []
        for table_group in detail.get('tables', []):
            all_table_ids.extend(table_group.get('tables', []))
        
        # Fetch loot tables
        loot_data = []
        if all_table_ids:
            loot_data = api_post(
                'lootTables/multiple',
                {'ids': all_table_ids},
                f'api_loot_{activity_id}.json'
            ) or []
        
        # Store everything
        api_data[activity_name.lower()] = {
            'id': activity_id,
            'name': activity_name,
            'detail': detail,
            'loot_tables': loot_data,
            'skills': activity.get('relatedSkillsList', []),
        }
        
        print(" ✓")
    
    print(f"\n  Fetched {len(api_data)} activities from API")
    return api_data


def _parse_input_items(detail):
    """Parse input items from API options field.
    
    API format:
        "options": [{"type": "inputActivity", "inputs": [
            {"keyword": "arrows", "type": "keyword", 
             "requirements": [{"type": "inputKeywordWithLevel", "requirement": {"skill": "hunting", "level": 20}}]}
        ]}]
    
    Returns list of dicts matching wiki InputItem format:
        [{'name': 'Arrows', 'type': 'keyword', 'reference': 'arrows', 'quantity': 1, 'level': 20}]
    """
    input_items = []
    for option in detail.get('options', []):
        if option.get('type') != 'inputActivity':
            continue
        for inp in option.get('inputs', []):
            inp_type = inp.get('type', '')
            keyword = inp.get('keyword', '')
            
            if not keyword:
                continue
            
            # Build InputItem dict
            item = {
                'name': keyword.replace('_', ' ').title(),
                'type': inp_type,  # "keyword" or "material"
                'reference': keyword,
                'quantity': inp.get('quantity', 1),
            }
            
            # Check for level requirement on the input
            for req in inp.get('requirements', []):
                if req.get('type') == 'inputKeywordWithLevel':
                    req_data = req.get('requirement', {})
                    level = req_data.get('level')
                    if level:
                        item['level'] = level
            
            input_items.append(item)
    
    return input_items


def overlay_api_data(activities_data, api_data=None):
    """Overlay API data onto wiki-scraped activities.
    
    Patches: drop_table, secondary_drop_table, base_steps, base_xp, max_efficiency,
             skill_requirements, primary_skill.
    
    Also adds new activities found in API but not in wiki.
    
    Args:
        activities_data: List of activity dicts from wiki scraper (mutated in-place)
        api_data: Optional pre-fetched API data dict. If None, fetches from API.
    
    Returns:
        Number of activities patched, number of new activities added
    """
    if api_data is None:
        api_data = fetch_all_api_activities()
    
    if not api_data:
        print("WARNING: No API data available, skipping overlay")
        return 0, 0
    
    print("\n" + "-" * 60)
    print("Overlaying API data onto wiki activities")
    print("-" * 60)
    
    patched = 0
    wiki_names = set()
    
    for activity in activities_data:
        if not activity:
            continue
        
        wiki_name = activity['name']
        wiki_names.add(wiki_name.lower())
        
        api_entry = api_data.get(wiki_name.lower())
        if not api_entry:
            print(f"  ⚠ No API data for: {wiki_name}")
            continue
        
        detail = api_entry['detail']
        loot_data = api_entry['loot_tables']
        
        # Patch base_steps (API: workRequired)
        work_required = detail.get('workRequired')
        if work_required is not None:
            old_steps = activity.get('base_steps')
            activity['base_steps'] = work_required
            if old_steps and old_steps != work_required:
                print(f"  {wiki_name}: base_steps {old_steps} → {work_required}")
        
        # Patch max_efficiency (API: maxWorkEfficiency, stored as multiplier like 1.8 meaning 80% max WE)
        # Our formula uses: 1 + max_efficiency, so we store as decimal (0.8 for 80%)
        # Round to avoid float noise (e.g., 1.9 - 1.0 = 0.8999999999999999)
        max_we = detail.get('maxWorkEfficiency')
        if max_we is not None:
            max_we_decimal = round(max_we - 1.0, 4)
            old_eff = activity.get('max_efficiency')
            activity['max_efficiency'] = max_we_decimal
            if old_eff is not None and abs(old_eff - max_we_decimal) > 0.001:
                print(f"  {wiki_name}: max_efficiency {old_eff} → {max_we_decimal}")
        
        # Patch base_xp (API: xpRewardsMap)
        xp_map = detail.get('xpRewardsMap', {})
        if xp_map:
            primary_skill_lower = (activity.get('primary_skill') or '').lower()
            # Primary XP
            if primary_skill_lower in xp_map:
                old_xp = activity.get('base_xp')
                activity['base_xp'] = xp_map[primary_skill_lower]
                if old_xp and old_xp != xp_map[primary_skill_lower]:
                    print(f"  {wiki_name}: base_xp {old_xp} → {xp_map[primary_skill_lower]}")
            
            # Secondary XP
            secondary_xp = {}
            for skill_lower, xp in xp_map.items():
                if skill_lower != primary_skill_lower:
                    skill_title = SKILL_NAME_MAP.get(skill_lower, skill_lower.title())
                    secondary_xp[skill_title] = xp
            if secondary_xp:
                activity['secondary_xp'] = secondary_xp
        
        # Patch skill requirements from API
        api_requirements = detail.get('requirements', [])
        for req in api_requirements:
            if req.get('type') == 'skillLevel':
                req_data = req.get('requirement', {})
                skill_lower = req_data.get('skill', '')
                level = req_data.get('level', 0)
                skill_title = SKILL_NAME_MAP.get(skill_lower, skill_lower.title())
                if skill_title and level:
                    activity['skill_requirements'][skill_title] = level
        
        # Patch keyword requirements from API
        keyword_counts = {}
        for req in api_requirements:
            if req.get('type') == 'keywordEquipped':
                req_data = req.get('requirement', {})
                keyword_id = req_data.get('keyword', '')
                # Convert camelCase keyword IDs to readable form
                keyword_readable = keyword_id.replace('_', ' ')
                keyword_counts[keyword_readable] = keyword_counts.get(keyword_readable, 0) + 1
        
        if keyword_counts:
            if 'keyword_counts' not in activity['requirements']:
                activity['requirements']['keyword_counts'] = {}
            activity['requirements']['keyword_counts'].update(keyword_counts)
        
        # Patch drop tables with exact API data
        if loot_data:
            new_drop_table, new_secondary = convert_loot_tables(detail, loot_data)
            
            if new_drop_table or new_secondary:
                old_primary_count = len(activity.get('drop_table', []))
                old_secondary_count = len(activity.get('secondary_drop_table', []))
                
                activity['drop_table'] = new_drop_table
                activity['secondary_drop_table'] = new_secondary
                
                new_primary_count = len(new_drop_table)
                new_secondary_count = len(new_secondary)
                
                if old_primary_count != new_primary_count or old_secondary_count != new_secondary_count:
                    print(f"  {wiki_name}: drops {old_primary_count}+{old_secondary_count} → {new_primary_count}+{new_secondary_count}")
        
        patched += 1
    
    # Step 2: Add new activities from API that aren't in wiki
    new_count = 0
    for api_name_lower, api_entry in api_data.items():
        if api_name_lower in wiki_names:
            continue
        
        detail = api_entry['detail']
        loot_data = api_entry['loot_tables']
        activity_name = api_entry['name']
        activity_id = api_entry['id']
        
        print(f"  + NEW from API: {activity_name}")
        
        # Build a new activity dict matching wiki format
        from scraper_utils import name_to_enum
        
        # Determine primary skill
        skills = api_entry.get('skills', [])
        primary_skill = SKILL_NAME_MAP.get(skills[0], skills[0].title()) if skills else None
        
        # Build skill requirements
        skill_reqs = {}
        keyword_counts = {}
        for req in detail.get('requirements', []):
            req_type = req.get('type')
            req_data = req.get('requirement', {})
            
            if req_type == 'skillLevel':
                skill_lower = req_data.get('skill', '')
                level = req_data.get('level', 0)
                skill_title = SKILL_NAME_MAP.get(skill_lower, skill_lower.title())
                if skill_title and level:
                    skill_reqs[skill_title] = level
            
            elif req_type == 'keywordEquipped':
                keyword_id = req_data.get('keyword', '')
                keyword_readable = keyword_id.replace('_', ' ')
                keyword_counts[keyword_readable] = keyword_counts.get(keyword_readable, 0) + 1
            
            elif req_type == 'distinctKeywordItemsEquipped':
                # e.g., {"quantity": 2, "keywords": ["light_source"]}
                quantity = req_data.get('quantity', 1)
                keywords = req_data.get('keywords') or []  # keywords may be absent OR null
                for kw in keywords:
                    keyword_readable = kw.replace('_', ' ')
                    keyword_counts[keyword_readable] = max(keyword_counts.get(keyword_readable, 0), quantity)
        
        requirements = {
            'keyword_counts': keyword_counts,
            'achievement_points': 0,
            'reputation': {},
            'activity_completions': {},
        }
        
        # XP
        xp_map = detail.get('xpRewardsMap', {})
        base_xp = xp_map.get(skills[0], 0) if skills else 0
        secondary_xp = {}
        for skill_lower, xp in xp_map.items():
            if skills and skill_lower != skills[0]:
                skill_title = SKILL_NAME_MAP.get(skill_lower, skill_lower.title())
                secondary_xp[skill_title] = xp
        
        # Drop tables
        drop_table, secondary_drop_table = [], []
        if loot_data:
            drop_table, secondary_drop_table = convert_loot_tables(detail, loot_data)
        
        # Fetch locations from API
        locations = []
        locations_data = api_get(
            f'locations/search?activityList={activity_id}&detailed=true',
            f'api_locations_{activity_id}.json'
        )
        if locations_data:
            for loc in locations_data:
                loc_name = loc.get('name', '')
                if loc_name:
                    locations.append(loc_name)
            if locations:
                print(f"    Locations: {', '.join(locations)}")
        
        # Parse input items from API options field
        input_items = _parse_input_items(detail)
        if input_items:
            print(f"    Input items: {', '.join(ii['name'] for ii in input_items)}")
        
        new_activity = {
            'name': activity_name,
            'enum_name': name_to_enum(activity_name),
            'primary_skill': primary_skill,
            'locations': locations,
            'skill_requirements': skill_reqs,
            'requirements': requirements,
            'drop_table': drop_table,
            'secondary_drop_table': secondary_drop_table,
            'base_steps': detail.get('workRequired'),
            'base_xp': base_xp,
            'secondary_xp': secondary_xp,
            'max_efficiency': round((detail.get('maxWorkEfficiency') or 1.0) - 1.0, 4),
            'description': None,
            'faction_reputation_reward': None,
            'input_items': input_items,
        }
        
        activities_data.append(new_activity)
        new_count += 1
    
    print(f"\n  Patched {patched} activities, added {new_count} new from API")
    return patched, new_count


# ============================================================================
# ENTRY POINT (standalone testing)
# ============================================================================

if __name__ == '__main__':
    # Standalone test: just fetch and display API data
    api_data = fetch_all_api_activities()
    
    print(f"\n{'=' * 60}")
    print(f"API Data Summary")
    print(f"{'=' * 60}")
    
    for name, data in sorted(api_data.items()):
        detail = data['detail']
        loot = data['loot_tables']
        tables_info = detail.get('tables', [])
        
        all_table_ids = []
        for tg in tables_info:
            all_table_ids.extend(tg.get('tables', []))
        
        print(f"\n{data['name']}:")
        print(f"  ID: {data['id']}")
        print(f"  Skills: {', '.join(data['skills'])}")
        print(f"  Base Steps: {detail.get('workRequired')}")
        print(f"  Max WE: {detail.get('maxWorkEfficiency')}")
        print(f"  XP: {detail.get('xpRewardsMap')}")
        print(f"  Loot tables: {len(all_table_ids)} ({', '.join(all_table_ids[:3])}{'...' if len(all_table_ids) > 3 else ''})")
        
        if loot:
            drop_table, secondary = convert_loot_tables(detail, loot)
            for d in drop_table:
                if d['item'] == 'Nothing':
                    print(f"    Nothing: {d['chance']:.3f}%")
                else:
                    qty = d['quantity']
                    qty_str = f"{qty['min_qty']}-{qty['max_qty']}" if qty['min_qty'] != qty['max_qty'] else str(qty['min_qty'])
                    print(f"    {d['item']}: {d['chance']:.4f}% (qty: {qty_str})")
            for d in secondary:
                qty = d['quantity']
                qty_str = f"{qty['min_qty']}-{qty['max_qty']}" if qty['min_qty'] != qty['max_qty'] else str(qty['min_qty'])
                print(f"    [secondary] {d['item']}: {d['chance']:.4f}% (qty: {qty_str})")
