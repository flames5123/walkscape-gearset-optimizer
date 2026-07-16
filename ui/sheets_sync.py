#!/usr/bin/env python3
"""
Google Sheets sync manager for community generic definitions.

Reads from Google Sheets via Apps Script webhook (GET).
Writes back via Apps Script webhook (POST to deployed web app).

Sync cycle (runs every 5 minutes on the server):
1. Fetch all rows from the sheet (all ACTIVE_SYNC_TABS)
2. Upsert sheet data into DB with source='sheet'
   - Only overwrites definitions where source='sheet'
   - User-created definitions (source=NULL) are never touched
3. Publish local shared definitions (is_public=1, source IS NULL) to the sheet
4. Record sync timestamp

Multi-row format (Gear, Consumables, Collectibles, Pets):
- First row has item name + metadata
- Continuation rows have empty name column
- Quality rows have quality name in quality column
- Stat rows under a quality have empty quality (inherits from above)
- fetch_tab returns ALL rows for multi-row tabs (including empty-name rows)
"""

import json
import logging
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ui.sheets_config import (
    TABS, ACTIVE_SYNC_TABS, MULTI_ROW_TABS, get_sheet_id, get_apps_script_url
)

logger = logging.getLogger(__name__)

# System session UUID used for sheet-sourced definitions
# This is a fixed UUID that won't collide with real user sessions
SHEET_SESSION_UUID = '00000000-0000-0000-0000-sheet-sync-01'


class SheetsSyncManager:
    """Manages bidirectional sync between the database and Google Sheets.

    Args:
        db: A DatabaseManager instance.
        sheet_id: Override sheet ID (for testing). If None, uses get_sheet_id().
        webhook_url: Override webhook URL (for testing). If None, uses get_apps_script_url().
    """

    def __init__(self, db, sheet_id: str = None, webhook_url: str = None):
        self.db = db
        self.sheet_id = sheet_id or get_sheet_id()
        self.webhook_url = webhook_url or get_apps_script_url()
        self._last_sync: Optional[str] = None
        self._last_error: Optional[str] = None

    @property
    def last_sync(self) -> Optional[str]:
        return self._last_sync

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    # ================================================================
    # MAIN SYNC
    # ================================================================

    def sync(self) -> dict:
        """Run a full sync cycle: fetch from sheet → upsert DB → publish to sheet.

        Returns:
            Dict with sync report: fetched counts, upserted counts, published counts,
            errors, and timestamp.
        """
        report = {
            'timestamp': _utc_now(),
            'sheet_id': self.sheet_id,
            'fetched': {},
            'upserted': {},
            'published': {},
            'errors': [],
        }

        # Track names on the sheet per tab (Phase 1 populates, Phase 2 skips these)
        sheet_names_by_tab = {}

        # Phase 1: Fetch from sheet and upsert into DB
        for tab_name in ACTIVE_SYNC_TABS:
            try:
                rows = self.fetch_tab(tab_name)
                report['fetched'][tab_name] = len(rows)

                # Track names that exist on the sheet
                if tab_name in MULTI_ROW_TABS:
                    sheet_names_by_tab[tab_name] = {
                        r.get('name', '').strip().lower() for r in rows
                        if r.get('name', '').strip()
                    }
                else:
                    sheet_names_by_tab[tab_name] = {
                        r.get('name', '').strip().lower() for r in rows
                        if r.get('name', '').strip()
                    }

                upserted = self._upsert_from_sheet(tab_name, rows)
                report['upserted'][tab_name] = upserted
            except Exception as e:
                error_msg = f"Fetch/upsert {tab_name}: {e}"
                report['errors'].append(error_msg)
                logger.error(error_msg)

        # Phase 2: Publish local shared definitions to sheet (only NEW items not already on sheet)
        if self.webhook_url:
            for tab_name in ACTIVE_SYNC_TABS:
                try:
                    existing_names = sheet_names_by_tab.get(tab_name, set())
                    published = self._publish_to_sheet(tab_name, existing_names)
                    report['published'][tab_name] = published
                except Exception as e:
                    error_msg = f"Publish {tab_name}: {e}"
                    report['errors'].append(error_msg)
                    logger.error(error_msg)
        else:
            report['published'] = {'skipped': 'No webhook URL configured'}

        # Update sync state
        self._last_sync = report['timestamp']
        self._last_error = report['errors'][-1] if report['errors'] else None

        # Phase 3: Update sync status timestamp on the sheet
        if self.webhook_url:
            try:
                self._update_sync_status(report['timestamp'])
            except Exception as e:
                report['errors'].append(f"Sync status: {e}")
                logger.warning(f"Could not update sync status: {e}")

        logger.info(f"Sheets sync complete: fetched={report['fetched']}, "
                     f"upserted={report['upserted']}, published={report['published']}, "
                     f"errors={len(report['errors'])}")

        return report

    # ================================================================
    # FETCH (READ FROM SHEET)
    # ================================================================

    def fetch_tab(self, tab_name: str) -> List[Dict[str, Any]]:
        """Fetch all rows from a sheet tab via the Apps Script doGet() endpoint.

        For multi-row tabs (Gear, Consumables, Collectibles, Pets), ALL rows
        are returned including continuation rows with empty name. The caller
        groups them by item.

        For single-row tabs, rows with empty name are skipped.

        Args:
            tab_name: Tab name (must be in ACTIVE_SYNC_TABS).

        Returns:
            List of row dicts with column names as keys.
        """
        if not self.webhook_url:
            raise ValueError("No webhook URL configured. Cannot fetch sheet data.")

        url = f'{self.webhook_url}?tab={tab_name}'
        req = urllib.request.Request(url, headers={'User-Agent': 'WalkscapeSync/1.0'})

        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))

        if not result.get('success'):
            raise RuntimeError(f"Apps Script error: {result.get('error')}")

        rows = result.get('data', {}).get(tab_name, [])
        is_multi_row = tab_name in MULTI_ROW_TABS

        cleaned = []
        for row in rows:
            if is_multi_row:
                # Multi-row: keep ALL rows (including empty-name continuation rows)
                # Only skip completely empty rows
                if any(v not in (None, '', 0) for v in row.values()):
                    cleaned.append(row)
            else:
                # Single-row: skip rows with empty name
                name = row.get('name')
                if name is None or (isinstance(name, str) and not name.strip()):
                    continue
                row['name'] = str(row['name']).strip()
                cleaned.append(row)

        return cleaned

    # ================================================================
    # UPSERT (SHEET → DB)
    # ================================================================

    def _upsert_from_sheet(self, tab_name: str, rows: List[Dict[str, Any]]) -> int:
        """Upsert sheet rows into the database."""
        if not rows:
            return 0

        dispatch = {
            'Activities': self._upsert_activities,
            'Recipes': self._upsert_recipes,
            'Services': self._upsert_services,
            'Gear': self._upsert_gear,
            'Consumables': self._upsert_consumables,
            'Collectibles': self._upsert_collectibles,
            'Pets': self._upsert_pets,
            'Inputs': self._upsert_inputs,
            'Keywords': self._upsert_keywords,
        }
        fn = dispatch.get(tab_name)
        return fn(rows) if fn else 0

    def _upsert_activities(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert activity rows from the sheet."""
        count = 0
        existing = self._get_sheet_sourced('generic_activities')

        for row in rows:
            name = row.get('name', '').strip()
            if not name:
                continue

            try:
                # Parse additional_data — contains requirements_json and optionally secondary_xp
                additional_raw = str(row.get('additional_data', '')).strip()
                requirements_json = '{}'
                secondary_xp_json = '{}'
                if additional_raw and additional_raw.startswith('{'):
                    try:
                        additional = json.loads(additional_raw)
                        # Extract secondary_xp if present, rest is requirements
                        sec_xp = additional.pop('secondary_xp', None)
                        if sec_xp:
                            secondary_xp_json = json.dumps(sec_xp)
                        requirements_json = json.dumps(additional) if additional else '{}'
                    except json.JSONDecodeError:
                        pass

                data = {
                    'name': name,
                    'skill': str(row.get('skill', '')).strip().lower(),
                    'location': str(row.get('location', '')).strip(),
                    'base_steps': int(float(row.get('base_steps', 0))),
                    'base_xp': float(row.get('base_xp', 0)),
                    'max_efficiency': float(row.get('max_efficiency', 0)),
                    'required_level': int(float(row.get('required_level', 1) or 1)),
                    'icon': str(row.get('icon', '📋')).strip() or '📋',
                    'icon_color': str(row.get('icon_color', '')).strip() or None,
                    'contributed_by': str(row.get('contributed_by', '')).strip() or None,
                    'requirements_json': requirements_json,
                    'secondary_xp_json': secondary_xp_json,
                }
            except (ValueError, TypeError) as e:
                logger.warning(f"Skipping activity '{name}': invalid data: {e}")
                continue

            if not data['skill'] or data['base_steps'] <= 0:
                logger.warning(f"Skipping activity '{name}': missing skill or base_steps")
                continue

            existing_id = existing.get(name.lower())
            if existing_id:
                self.db.update_generic_activity(
                    SHEET_SESSION_UUID, existing_id,
                    **data, source='sheet'
                )
            else:
                self.db.save_generic_activity(
                    session_uuid=SHEET_SESSION_UUID,
                    source='sheet',
                    is_public=True,
                    **data,
                )
            count += 1

        self._remove_stale(rows, existing, 'generic_activities', 'activity')
        return count

    def _upsert_recipes(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert recipe rows from the sheet."""
        count = 0
        existing = self._get_sheet_sourced('generic_recipes')

        for row in rows:
            name = row.get('name', '').strip()
            if not name:
                continue

            try:
                is_quality = str(row.get('is_quality_item', '0')).strip()
                is_quality_item = is_quality in ('1', 'true', 'True', 'yes')

                # Parse additional_data as requirements_json if present
                additional_raw = str(row.get('additional_data', '')).strip()
                requirements_json = '{}'
                if additional_raw and additional_raw.startswith('{'):
                    try:
                        json.loads(additional_raw)  # validate
                        requirements_json = additional_raw
                    except json.JSONDecodeError:
                        pass

                data = {
                    'name': name,
                    'skill': str(row.get('skill', '')).strip().lower(),
                    'base_steps': int(float(row.get('base_steps', 0))),
                    'base_xp': float(row.get('base_xp', 0)),
                    'max_efficiency': float(row.get('max_efficiency', 0)),
                    'required_level': int(float(row.get('required_level', 1) or 1)),
                    'service_id': None,
                    'icon': str(row.get('icon', '📋')).strip() or '📋',
                    'icon_color': str(row.get('icon_color', '')).strip() or None,
                    'contributed_by': str(row.get('contributed_by', '')).strip() or None,
                    'is_quality_item': is_quality_item,
                    'requirements_json': requirements_json,
                }
            except (ValueError, TypeError) as e:
                logger.warning(f"Skipping recipe '{name}': invalid data: {e}")
                continue

            if not data['skill'] or data['base_steps'] <= 0:
                logger.warning(f"Skipping recipe '{name}': missing skill or base_steps")
                continue

            existing_id = existing.get(name.lower())
            if existing_id:
                self.db.update_generic_recipe(
                    SHEET_SESSION_UUID, existing_id,
                    **data, source='sheet'
                )
            else:
                self.db.save_generic_recipe(
                    session_uuid=SHEET_SESSION_UUID,
                    source='sheet',
                    is_public=True,
                    **data,
                )
            count += 1

        self._remove_stale(rows, existing, 'generic_recipes', 'recipe')
        return count

    def _upsert_services(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert service rows from the sheet."""
        count = 0
        existing = self._get_sheet_sourced('generic_services')

        for row in rows:
            name = row.get('name', '').strip()
            if not name:
                continue

            try:
                stats_raw = str(row.get('stats_json', '')).strip()
                if stats_raw and stats_raw.startswith('{'):
                    stats = json.loads(stats_raw)
                else:
                    stats = {}

                data = {
                    'name': name,
                    'skill': str(row.get('skill', '')).strip().lower(),
                    'location': str(row.get('location', '')).strip(),
                    'stats_json': json.dumps(stats),
                    'icon': str(row.get('icon', '📋')).strip() or '📋',
                    'icon_color': str(row.get('icon_color', '')).strip() or None,
                    'contributed_by': str(row.get('contributed_by', '')).strip() or None,
                    'tier': str(row.get('tier', 'basic')).strip().lower() or 'basic',
                }
            except (ValueError, TypeError, json.JSONDecodeError) as e:
                logger.warning(f"Skipping service '{name}': invalid data: {e}")
                continue

            if not data['skill']:
                logger.warning(f"Skipping service '{name}': missing skill")
                continue

            existing_id = existing.get(name.lower())
            if existing_id:
                self.db.update_generic_service(
                    SHEET_SESSION_UUID, existing_id,
                    **data, source='sheet'
                )
            else:
                self.db.save_generic_service(
                    session_uuid=SHEET_SESSION_UUID,
                    source='sheet',
                    is_public=True,
                    **data,
                )
            count += 1

        self._remove_stale(rows, existing, 'generic_services', 'service')
        return count

    def _upsert_gear(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert gear rows from the sheet (multi-row format).

        Multi-row format:
        - First row has name + metadata (slot, keywords, rarity, is_crafted, icon, icon_color)
        - Quality rows have quality name in 'quality' column
        - Stat rows have skill/location/stat/value (quality inherited from above)
        """
        return self._upsert_multi_row_items(rows, slot_filter=None,
                                             exclude_slots={'consumable', 'collectible', 'input'})

    def _upsert_consumables(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert consumable rows from the sheet (multi-row format).
        Consumables are stored as generic_items with slot='consumable'.
        """
        return self._upsert_multi_row_items(rows, force_slot='consumable',
                                             force_crafted=True)

    def _upsert_collectibles(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert collectible rows from the sheet (multi-row format).
        Collectibles are stored as generic_items with slot='collectible'.
        """
        return self._upsert_multi_row_items(rows, force_slot='collectible',
                                             force_crafted=False)

    def _upsert_pets(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert pet rows from the sheet (multi-row format with level tiers).
        Pets are stored as generic_items with slot='pet', is_crafted=True (uses level tabs).
        """
        return self._upsert_multi_row_items(rows, force_slot='pet',
                                             force_crafted=True)

    def _upsert_inputs(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert input item rows from the sheet (multi-row format).
        Inputs are stored as generic_items with slot='input', auto-crafted (Normal/Fine).
        """
        return self._upsert_multi_row_items(rows, force_slot='input',
                                             force_crafted=True)

    def _upsert_multi_row_items(self, rows: List[Dict[str, Any]],
                                 slot_filter: str = None,
                                 exclude_slots: set = None,
                                 force_slot: str = None,
                                 force_crafted: bool = None) -> int:
        """Shared upsert logic for multi-row item types (Gear, Consumables, Collectibles, Pets).

        Groups rows by item name, parses quality/stat rows, builds nested stats,
        and upserts into generic_items table.
        """
        count = 0
        existing = self._get_sheet_sourced('generic_items')

        # Group rows into item blocks
        items = _group_multi_rows(rows)

        seen_names = set()
        for item_group in items:
            meta = item_group['meta']
            name = str(meta.get('name', '')).strip()
            if not name:
                continue

            try:
                slot = force_slot or str(meta.get('slot', '')).strip().lower()
                if not slot:
                    logger.warning(f"Skipping item '{name}': missing slot")
                    continue

                if exclude_slots and slot in exclude_slots:
                    continue
                if slot_filter and slot != slot_filter:
                    continue

                keywords_raw = str(meta.get('keywords', '')).strip()
                keywords = [k.strip() for k in keywords_raw.split(',') if k.strip()] if keywords_raw else []

                if force_crafted is not None:
                    is_crafted = force_crafted
                else:
                    is_crafted = str(meta.get('is_crafted', '0')).strip() in ('1', 'true', 'True', 'yes')

                rarity = str(meta.get('rarity', 'common')).strip().lower() or 'common'
                # Map quality names to rarity names (kozz uses "Eternal", "Perfect" etc.)
                QUALITY_TO_RARITY = {'normal': 'common', 'good': 'uncommon', 'great': 'rare', 'excellent': 'epic', 'perfect': 'legendary', 'eternal': 'ethereal'}
                rarity = QUALITY_TO_RARITY.get(rarity, rarity)
                icon = str(meta.get('icon', '⚡')).strip() or '⚡'
                icon_color = str(meta.get('icon_color', '')).strip() or None
                icon_path = str(meta.get('icon_path', '')).strip() or None
                contributed_by = str(meta.get('contributed_by', '')).strip() or None
                export_item_name = str(meta.get('export_item_name', '')).strip() or None
                gear_set_export = str(meta.get('gear_set_export', '')).strip() or None

                # Parse additional_data as gated_stats_json if present
                additional_raw = str(meta.get('additional_data', '')).strip()
                gated_stats_json = '{}'
                if additional_raw and additional_raw.startswith('{'):
                    try:
                        json.loads(additional_raw)  # validate
                        gated_stats_json = additional_raw
                    except json.JSONDecodeError:
                        pass

                # Build nested stats from all rows
                # For pets, remap 'level' → 'quality' and extract XP requirements
                pet_xp_reqs = {}
                if force_slot == 'pet':
                    for sr in item_group['stat_rows']:
                        level = str(sr.get('level', '')).strip()
                        if level:
                            sr['quality'] = level  # Reuse quality parsing logic
                            try:
                                xp = int(float(sr.get('xp_to_next_level', 0) or 0))
                                if xp:
                                    pet_xp_reqs[level] = xp
                            except (ValueError, TypeError):
                                pass
                        elif not sr.get('quality'):
                            sr['quality'] = ''  # Continuation row

                stats, quality_stats, quality_values = _parse_multi_row_stats(
                    item_group['stat_rows'], is_crafted)

                # For force_crafted items (inputs), ensure Normal/Fine tiers always
                # exist even if no stats are defined (e.g. Copper arrows, Boxtrap).
                # Without this, the UI doesn't show quality tiers for stat-less items.
                if force_crafted and is_crafted and quality_stats is not None:
                    for tier in ('Normal', 'Fine'):
                        if tier not in quality_stats:
                            quality_stats[tier] = {}

                # For pets, store XP requirements in quality_values
                if force_slot == 'pet' and pet_xp_reqs:
                    if quality_values is None:
                        quality_values = {}
                    quality_values['_pet_xp_requirements'] = pet_xp_reqs

                # Parse duration for consumables
                try:
                    duration = int(float(meta.get('duration', 1000) or 1000))
                except (ValueError, TypeError):
                    duration = 1000

                # Parse item_value — for non-crafted, it's on the first row
                # For crafted, per-quality values are on quality rows (parsed below)
                # For pets, use egg_value instead of item_value
                try:
                    if force_slot == 'pet':
                        item_value = int(float(meta.get('egg_value', 0) or 0))
                    else:
                        item_value = int(float(meta.get('item_value', 0) or 0))
                except (ValueError, TypeError):
                    item_value = 0

                data = {
                    'name': name,
                    'slot': slot,
                    'keywords': json.dumps(keywords),
                    'stats_json': json.dumps(stats),
                    'quality_stats_json': json.dumps(quality_stats) if quality_stats else None,
                    'rarity': rarity,
                    'is_crafted': is_crafted,
                    'icon': icon,
                    'icon_color': icon_color,
                    'icon_path': icon_path,
                    'contributed_by': contributed_by,
                    'export_item_name': export_item_name,
                    'gear_set_export': gear_set_export,
                    'duration': duration,
                    'value': item_value,
                    'quality_values_json': json.dumps(quality_values) if quality_values else None,
                    'gated_stats_json': gated_stats_json,
                }

                # Build data_status from per-row statuses (quality → status)
                data_status_map = {}
                current_q = ''
                for sr in item_group['stat_rows']:
                    q = str(sr.get('quality', '')).strip()
                    if q:
                        current_q = q
                    ds = str(sr.get('data_status', '')).strip()
                    if ds and current_q:
                        # First status for this quality wins
                        if current_q not in data_status_map:
                            data_status_map[current_q] = ds
                    elif ds and not current_q:
                        # Non-crafted item status on first row
                        data_status_map['_base'] = ds
                if data_status_map:
                    data['data_status'] = json.dumps(data_status_map)
                else:
                    data['data_status'] = None

            except (ValueError, TypeError) as e:
                logger.warning(f"Skipping item '{name}': invalid data: {e}")
                continue

            seen_names.add(name.lower())
            existing_id = existing.get(name.lower())
            if existing_id:
                self.db.update_generic_item(
                    SHEET_SESSION_UUID, existing_id,
                    **data, source='sheet'
                )
            else:
                self.db.save_generic_item(
                    session_uuid=SHEET_SESSION_UUID,
                    source='sheet',
                    is_public=True,
                    **data,
                )
            count += 1

        # Remove stale sheet-sourced items (only for items matching our slot filter)
        for name_lower, def_id in existing.items():
            if name_lower not in seen_names:
                # Only delete if this item matches our slot filter
                if force_slot:
                    # Check if the existing item has the right slot
                    conn = self.db._get_connection()
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT slot FROM generic_items WHERE id = ? AND source = 'sheet'",
                        (def_id,)
                    )
                    row = cursor.fetchone()
                    if not self.db._persistent_conn:
                        conn.close()
                    if row and row[0] == force_slot:
                        self.db.delete_generic_item(SHEET_SESSION_UUID, def_id)
                        logger.info(f"Removed stale sheet item ({force_slot}): {name_lower}")
                elif not force_slot and not exclude_slots:
                    self.db.delete_generic_item(SHEET_SESSION_UUID, def_id)
                    logger.info(f"Removed stale sheet item: {name_lower}")

        return count

    def _upsert_keywords(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert keyword rows from the sheet.

        Keywords are stored in walkscape_constants.py as EXCLUDED_TOOL_KEYWORDS
        (not banned) and everything else is banned (unique per gearset).
        We store them in a simple DB table for runtime access.
        """
        count = 0
        existing = self._get_sheet_sourced_keywords()

        for row in rows:
            name = str(row.get('name', '')).strip().lower()
            if not name:
                continue

            banned_raw = str(row.get('banned', '1')).strip()
            banned = banned_raw not in ('0', 'false', 'False', 'no', 'FALSE')
            icon = str(row.get('icon', '')).strip() or None
            icon_color = str(row.get('icon_color', '')).strip() or None
            contributed_by = str(row.get('contributed_by', '')).strip() or None

            existing_id = existing.get(name)
            if existing_id:
                self._update_keyword(existing_id, name, banned, icon, icon_color, contributed_by)
            else:
                self._insert_keyword(name, banned, icon, icon_color, contributed_by)
            count += 1

        # Remove stale keywords
        sheet_names = {str(r.get('name', '')).strip().lower() for r in rows
                       if str(r.get('name', '')).strip()}
        for name_lower, kw_id in existing.items():
            if name_lower not in sheet_names:
                self._delete_keyword(kw_id)
                logger.info(f"Removed stale sheet keyword: {name_lower}")

        return count

    def _get_sheet_sourced_keywords(self) -> Dict[str, str]:
        """Get all sheet-sourced keywords. Returns dict of name → id."""
        conn = self.db._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT id, name FROM generic_keywords WHERE source = 'sheet'")
            rows = cursor.fetchall()
        except Exception:
            # Table might not exist yet
            return {}
        finally:
            if not self.db._persistent_conn:
                conn.close()
        return {row[1].lower(): row[0] for row in rows}

    def _insert_keyword(self, name: str, banned: bool, icon: str, icon_color: str, contributed_by: str):
        import uuid as _uuid
        conn = self.db._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            INSERT INTO generic_keywords (id, name, banned, icon, icon_color, contributed_by, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'sheet', ?, ?)
        """, (str(_uuid.uuid4()), name, 1 if banned else 0, icon, icon_color, contributed_by, now, now))
        conn.commit()
        if not self.db._persistent_conn:
            conn.close()

    def _update_keyword(self, kw_id: str, name: str, banned: bool, icon: str, icon_color: str, contributed_by: str):
        conn = self.db._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            UPDATE generic_keywords SET name=?, banned=?, icon=?, icon_color=?, contributed_by=?, updated_at=?
            WHERE id=? AND source='sheet'
        """, (name, 1 if banned else 0, icon, icon_color, contributed_by, now, kw_id))
        conn.commit()
        if not self.db._persistent_conn:
            conn.close()

    def _delete_keyword(self, kw_id: str):
        conn = self.db._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM generic_keywords WHERE id=? AND source='sheet'", (kw_id,))
        conn.commit()
        if not self.db._persistent_conn:
            conn.close()

    # ================================================================
    # HELPERS
    # ================================================================

    def _get_sheet_sourced(self, table: str) -> Dict[str, str]:
        """Get all sheet-sourced definitions from a table.
        Returns dict mapping lowercase name → definition id.
        """
        conn = self.db._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"SELECT id, name FROM {table} WHERE source = 'sheet'")
        rows = cursor.fetchall()
        if not self.db._persistent_conn:
            conn.close()
        return {row[1].lower(): row[0] for row in rows}

    def _update_sync_status(self, timestamp: str):
        """Update the Sync Status tab on the sheet with our last sync time.
        
        Uses GET with query params because Google Apps Script redirects POST
        to a GET URL, losing the POST body.
        """
        params = urllib.parse.urlencode({
            'action': 'update_sync_status',
            'tool': 'walkscape_optimizer',
            'timestamp': timestamp,
        })
        url = f'{self.webhook_url}?{params}'

        req = urllib.request.Request(url, headers={'User-Agent': 'WalkscapeSync/1.0'})

        class _RedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return urllib.request.Request(newurl, headers={'User-Agent': 'WalkscapeSync/1.0'})

        opener = urllib.request.build_opener(_RedirectHandler)
        with opener.open(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            if not result.get('success'):
                raise RuntimeError(f"Sync status update failed: {result.get('error')}")

    def _remove_stale(self, rows, existing, table, type_name):
        """Remove sheet-sourced definitions that are no longer in the sheet."""
        sheet_names = {str(r.get('name', '')).strip().lower()
                       for r in rows if str(r.get('name', '')).strip()}
        delete_fn = {
            'generic_activities': self.db.delete_generic_activity,
            'generic_recipes': self.db.delete_generic_recipe,
            'generic_services': self.db.delete_generic_service,
            'generic_items': self.db.delete_generic_item,
        }.get(table)
        if not delete_fn:
            return
        for name_lower, def_id in existing.items():
            if name_lower not in sheet_names:
                delete_fn(SHEET_SESSION_UUID, def_id)
                logger.info(f"Removed stale sheet {type_name}: {name_lower}")

    # ================================================================
    # PUBLISH (DB → SHEET)
    # ================================================================

    def _publish_to_sheet(self, tab_name: str, existing_sheet_names: set = None) -> int:
        """Publish local definitions to the sheet via Apps Script webhook.

        Publishes:
        - User-created public definitions (source IS NULL) that aren't already on the sheet
        - Sheet-sourced definitions (source='sheet') that may have been edited locally
          (always re-published to push edits back to the sheet)
        """
        if not self.webhook_url:
            return 0
        if existing_sheet_names is None:
            existing_sheet_names = set()

        # Keywords now publish user-created keywords too
        if tab_name == 'Keywords':
            rows = self._get_publishable_keywords()
            # Filter out keywords already on the sheet
            if existing_sheet_names:
                rows = [r for r in rows if r.get('name', '').lower() not in existing_sheet_names]
            if not rows:
                return 0
            sheet_rows = rows  # Already in sheet format
        else:
            rows = self._get_publishable(tab_name)
            # Filter out items already on the sheet
            if existing_sheet_names:
                rows = [r for r in rows if r.get('name', '').lower() not in existing_sheet_names]

            # Also include sheet-sourced items (to push back any local edits)
            sheet_sourced = self._get_sheet_sourced_rows(tab_name)
            rows.extend(sheet_sourced)

            if not rows:
                return 0

            # Convert to sheet row format
            sheet_rows = []
            for row in rows:
                if tab_name in MULTI_ROW_TABS:
                    sheet_rows.extend(self._db_item_to_sheet_rows(tab_name, row))
                else:
                    sheet_row = self._db_row_to_sheet_row(tab_name, row)
                    if sheet_row:
                        sheet_rows.append(sheet_row)

        if not sheet_rows:
            return 0

        payload = json.dumps({
            'action': 'upsert',
            'tab': tab_name,
            'rows': sheet_rows,
        }).encode('utf-8')

        req = urllib.request.Request(
            self.webhook_url,
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'WalkscapeSync/1.0',
            },
            method='POST',
        )

        class _PostRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                # Google Apps Script redirects POST to a GET URL that returns the result
                return urllib.request.Request(newurl, headers={'User-Agent': 'WalkscapeSync/1.0'})

        opener = urllib.request.build_opener(_PostRedirectHandler)
        try:
            with opener.open(req, timeout=60) as resp:
                result = json.loads(resp.read().decode('utf-8'))
                if not result.get('success'):
                    raise RuntimeError(f"Apps Script error: {result.get('error')}")
                return len(sheet_rows)
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')
            raise RuntimeError(f"Apps Script HTTP {e.code}: {body[:200]}")

    def _get_publishable_keywords(self) -> list:
        """Get user-created keywords (source IS NULL) for publishing to the sheet."""
        conn = self.db._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT name, banned, icon, icon_color, contributed_by FROM generic_keywords WHERE source IS NULL")
            rows = cursor.fetchall()
        except Exception:
            return []
        if not self.db._persistent_conn:
            conn.close()
        return [{'name': r[0], 'banned': r[1], 'icon': r[2] or '🏷️',
                 'icon_color': r[3] or '', 'contributed_by': r[4] or '',
                 'additional_data': '', 'kozz_data': ''} for r in rows]

    def _get_publishable(self, tab_name: str) -> list:
        """Get user-created public definitions that should be published to the sheet."""
        conn = self.db._get_connection()
        cursor = conn.cursor()

        table_map = {
            'Activities': 'generic_activities',
            'Recipes': 'generic_recipes',
            'Services': 'generic_services',
            'Gear': 'generic_items',
            'Consumables': 'generic_items',
            'Collectibles': 'generic_items',
            'Pets': 'generic_items',
            'Inputs': 'generic_items',
        }
        table = table_map.get(tab_name)
        if not table:
            return []

        # For item sub-types, filter by slot
        slot_filter = {
            'Consumables': 'consumable',
            'Collectibles': 'collectible',
            'Pets': 'pet',
            'Inputs': 'input',
        }.get(tab_name)

        if slot_filter:
            cursor.execute(
                f"SELECT * FROM {table} WHERE is_public = 1 AND source IS NULL AND slot = ?",
                (slot_filter,)
            )
        elif tab_name == 'Gear':
            cursor.execute(
                f"SELECT * FROM {table} WHERE is_public = 1 AND source IS NULL "
                f"AND slot NOT IN ('consumable', 'collectible', 'pet', 'input')"
            )
        else:
            cursor.execute(
                f"SELECT * FROM {table} WHERE is_public = 1 AND source IS NULL"
            )
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        if not self.db._persistent_conn:
            conn.close()

        return [dict(zip(columns, row)) for row in rows]

    def _get_sheet_sourced_rows(self, tab_name: str) -> list:
        """Get sheet-sourced definitions to re-publish (pushes local edits back to sheet)."""
        conn = self.db._get_connection()
        cursor = conn.cursor()

        table_map = {
            'Activities': 'generic_activities',
            'Recipes': 'generic_recipes',
            'Services': 'generic_services',
            'Gear': 'generic_items',
            'Consumables': 'generic_items',
            'Collectibles': 'generic_items',
            'Pets': 'generic_items',
            'Inputs': 'generic_items',
        }
        table = table_map.get(tab_name)
        if not table:
            return []

        slot_filter = {
            'Consumables': 'consumable',
            'Collectibles': 'collectible',
            'Pets': 'pet',
            'Inputs': 'input',
        }.get(tab_name)

        if slot_filter:
            cursor.execute(
                f"SELECT * FROM {table} WHERE source = 'sheet' AND slot = ?",
                (slot_filter,)
            )
        elif tab_name == 'Gear':
            cursor.execute(
                f"SELECT * FROM {table} WHERE source = 'sheet' "
                f"AND slot NOT IN ('consumable', 'collectible', 'pet', 'input')"
            )
        else:
            cursor.execute(
                f"SELECT * FROM {table} WHERE source = 'sheet'"
            )
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        if not self.db._persistent_conn:
            conn.close()

        return [dict(zip(columns, row)) for row in rows]

    def _db_row_to_sheet_row(self, tab_name: str, row: dict) -> Optional[dict]:
        """Convert a DB row to a sheet-compatible row dict (single-row tabs)."""
        if tab_name == 'Activities':
            req_json = row.get('requirements_json', '{}')
            if isinstance(req_json, dict):
                req_json = json.dumps(req_json)
            # Merge requirements and secondary_xp into additional_data
            additional = {}
            if req_json and req_json != '{}':
                try:
                    additional = json.loads(req_json)
                except (json.JSONDecodeError, TypeError):
                    pass
            sec_xp = row.get('secondary_xp_json', '{}')
            if isinstance(sec_xp, str):
                try:
                    sec_xp_dict = json.loads(sec_xp) if sec_xp else {}
                except (json.JSONDecodeError, TypeError):
                    sec_xp_dict = {}
            else:
                sec_xp_dict = sec_xp or {}
            if sec_xp_dict:
                additional['secondary_xp'] = sec_xp_dict
            additional_str = json.dumps(additional) if additional else ''
            return {
                'name': row.get('name', ''),
                'skill': row.get('skill', ''),
                'base_steps': row.get('base_steps', 0),
                'base_xp': row.get('base_xp', 0),
                'max_efficiency': row.get('max_efficiency', 0),
                'required_level': row.get('required_level', 1),
                'location': row.get('location', ''),
                'icon': row.get('icon', '⚡'),
                'icon_color': row.get('icon_color', '') or '',
                'contributed_by': row.get('contributed_by') or 'Walkscape Optimizer',
                'additional_data': additional_str,
                'kozz_data': '',
            }
        elif tab_name == 'Recipes':
            req_json = row.get('requirements_json', '{}')
            if isinstance(req_json, dict):
                req_json = json.dumps(req_json)
            return {
                'name': row.get('name', ''),
                'skill': row.get('skill', ''),
                'base_steps': row.get('base_steps', 0),
                'base_xp': row.get('base_xp', 0),
                'max_efficiency': row.get('max_efficiency', 0),
                'required_level': row.get('required_level', 1),
                'is_quality_item': '1' if row.get('is_quality_item') else '0',
                'icon': row.get('icon', '⚡'),
                'icon_color': row.get('icon_color', '') or '',
                'contributed_by': row.get('contributed_by') or 'Walkscape Optimizer',
                'additional_data': req_json if req_json and req_json != '{}' else '',
                'kozz_data': '',
            }
        elif tab_name == 'Services':
            stats = row.get('stats_json', '{}')
            if isinstance(stats, dict):
                stats = json.dumps(stats)
            return {
                'name': row.get('name', ''),
                'skill': row.get('skill', ''),
                'location': row.get('location', ''),
                'tier': row.get('tier', 'basic') or 'basic',
                'stats_json': stats,
                'icon': row.get('icon', '⚡'),
                'icon_color': row.get('icon_color', '') or '',
                'contributed_by': row.get('contributed_by') or 'Walkscape Optimizer',
                'kozz_data': '',
            }
        return None

    def _name_to_export_name(self, name: str) -> str:
        """Convert an item name to an export_item_name (lowercase, underscores)."""
        import re
        return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')

    def _db_item_to_sheet_rows(self, tab_name: str, row: dict) -> list:
        """Convert a generic_items DB row to multi-row sheet format.

        Format:
        1. First row: name + metadata + first quality name (or empty)
        2. Under each quality: one row per stat (skill/location/stat/value)
        3. Quality name only on first row of that quality block
        4. If a quality has no stats, still emit a blank quality row
        5. Metadata (name, slot, etc.) only on the very first row
        """
        name = row.get('name', '')
        export_item_name = row.get('export_item_name') or self._name_to_export_name(name)
        gear_set_export = row.get('gear_set_export') or ''
        slot = row.get('slot', '')
        keywords_raw = row.get('keywords', '[]')
        if isinstance(keywords_raw, list):
            keywords_str = ','.join(keywords_raw)
        elif isinstance(keywords_raw, str):
            try:
                keywords_str = ','.join(json.loads(keywords_raw))
            except (json.JSONDecodeError, TypeError):
                keywords_str = keywords_raw
        else:
            keywords_str = ''
        rarity = row.get('rarity', 'common')
        is_crafted = bool(row.get('is_crafted', False))
        icon = row.get('icon', '⚡')
        icon_color = row.get('icon_color', '') or ''
        icon_path = row.get('icon_path', '') or ''
        contributed_by = row.get('contributed_by') or 'Walkscape Optimizer'
        duration = row.get('duration', 1000) or 1000
        item_value = row.get('value', 0) or 0

        # Parse quality_values for crafted items
        qv_raw = row.get('quality_values_json') or row.get('quality_values') or '{}'
        if isinstance(qv_raw, str):
            try:
                quality_values = json.loads(qv_raw)
            except (json.JSONDecodeError, TypeError):
                quality_values = {}
        else:
            quality_values = qv_raw or {}

        # Parse gated stats for additional_data column
        gated_raw = row.get('gated_stats_json') or row.get('gated_stats') or '{}'
        if isinstance(gated_raw, str):
            try:
                gated_stats = json.loads(gated_raw)
            except (json.JSONDecodeError, TypeError):
                gated_stats = {}
        else:
            gated_stats = gated_raw or {}
        gated_stats_str = json.dumps(gated_stats) if gated_stats else ''

        # Parse stats
        stats_raw = row.get('stats_json') or row.get('stats') or '{}'
        if isinstance(stats_raw, str):
            try:
                base_stats = json.loads(stats_raw)
            except (json.JSONDecodeError, TypeError):
                base_stats = {}
        else:
            base_stats = stats_raw or {}

        qs_raw = row.get('quality_stats_json') or row.get('quality_stats') or '{}'
        if isinstance(qs_raw, str):
            try:
                quality_stats = json.loads(qs_raw)
            except (json.JSONDecodeError, TypeError):
                quality_stats = {}
        else:
            quality_stats = qs_raw or {}

        sheet_rows = []
        is_first = True

        # Parse data_status map from DB
        ds_raw = row.get('data_status') or '{}'
        if isinstance(ds_raw, str):
            try:
                data_status_map = json.loads(ds_raw)
            except (json.JSONDecodeError, TypeError):
                data_status_map = {}
        else:
            data_status_map = ds_raw or {}

        def _meta(first_only, quality=''):
            """Return metadata dict — only populated on the very first row."""
            # Look up data_status for this quality (or _base for non-crafted)
            ds = data_status_map.get(quality, data_status_map.get('_base', ''))
            if tab_name == 'Gear':
                return {
                    'name': name if first_only else '',
                    'export_item_name': export_item_name if first_only else '',
                    'gear_set_export': gear_set_export if first_only else '',
                    'slot': slot if first_only else '',
                    'keywords': keywords_str if first_only else '',
                    'rarity': rarity if first_only else '',
                    'is_crafted': ('1' if is_crafted else '0') if first_only else '',
                    'icon': icon if first_only else '',
                    'icon_color': icon_color if first_only else '',
                    'icon_path': icon_path if first_only else '',
                    'contributed_by': contributed_by if first_only else '',
                    'additional_data': gated_stats_str if first_only else '',
                    'data_status': ds,
                    'kozz_data': '',
                }
            elif tab_name == 'Consumables':
                return {
                    'name': name if first_only else '',
                    'export_item_name': export_item_name if first_only else '',
                    'duration': duration if first_only else '',
                    'icon': icon if first_only else '',
                    'icon_color': icon_color if first_only else '',
                    'icon_path': icon_path if first_only else '',
                    'contributed_by': contributed_by if first_only else '',
                    'additional_data': gated_stats_str if first_only else '',
                    'data_status': ds,
                    'kozz_data': '',
                }
            elif tab_name == 'Inputs':
                return {
                    'name': name if first_only else '',
                    'export_item_name': export_item_name if first_only else '',
                    'keywords': keywords_str if first_only else '',
                    'icon': icon if first_only else '',
                    'icon_color': icon_color if first_only else '',
                    'icon_path': icon_path if first_only else '',
                    'contributed_by': contributed_by if first_only else '',
                    'additional_data': gated_stats_str if first_only else '',
                    'data_status': ds,
                    'kozz_data': '',
                }
            else:
                # Collectibles
                return {
                    'name': name if first_only else '',
                    'export_item_name': export_item_name if first_only else '',
                    'icon': icon if first_only else '',
                    'icon_color': icon_color if first_only else '',
                    'icon_path': icon_path if first_only else '',
                    'contributed_by': contributed_by if first_only else '',
                    'additional_data': gated_stats_str if first_only else '',
                    'kozz_data': '',
                }

        def _stat_entries(stat_dict):
            """Flatten nested {skill: {location: {stat: value}}} to list of tuples."""
            entries = []
            if not isinstance(stat_dict, dict):
                return entries
            for skill, locations in stat_dict.items():
                if not isinstance(locations, dict):
                    continue
                for location, stat_map in locations.items():
                    if not isinstance(stat_map, dict):
                        continue
                    for stat, value in stat_map.items():
                        entries.append((skill, location, stat, value))
            return entries

        if tab_name == 'Pets' and quality_stats:
            # Pet-specific: level tiers with per-level stats and XP
            pet_xp_reqs = quality_values.get('_pet_xp_requirements', {})
            level_order = ['Egg', 'Level 1', 'Level 2', 'Level 3', 'Level 4']

            for level_name in level_order:
                if level_name not in quality_stats and level_name != 'Egg':
                    continue
                level_stats = quality_stats.get(level_name, {})
                xp_val = pet_xp_reqs.get(level_name, 0) if level_name != 'Egg' else quality_values.get('Egg', 0)
                entries = _stat_entries(level_stats)

                if entries:
                    for idx, (skill, location, stat, value) in enumerate(entries):
                        m = _meta(is_first)
                        m.update({
                            'egg_value': item_value if is_first else '',
                            'level': level_name if idx == 0 else '',
                            'xp_to_next_level': xp_val if idx == 0 else '',
                            'skill': skill, 'location': location,
                            'stat': stat, 'value': value,
                        })
                        sheet_rows.append(m)
                        is_first = False
                else:
                    # Level with no stats (e.g., Egg) — still emit a row
                    m = _meta(is_first)
                    m.update({
                        'egg_value': item_value if is_first else '',
                        'level': level_name,
                        'xp_to_next_level': xp_val,
                        'skill': '', 'location': '',
                        'stat': '', 'value': '',
                    })
                    sheet_rows.append(m)
                    is_first = False
        elif is_crafted and quality_stats:
            # Crafted items: quality tiers (Normal/Good/Great/etc or Normal/Fine)
            if slot in ('consumable', 'input'):
                quality_order = ['Normal', 'Fine']
            else:
                quality_order = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']

            # Include base stats under empty quality first (if any)
            base_entries = _stat_entries(base_stats)
            for skill, location, stat, value in base_entries:
                m = _meta(is_first)
                m.update({'quality': '', 'skill': skill, 'location': location,
                          'stat': stat, 'value': value})
                sheet_rows.append(m)
                is_first = False

            # Then each quality in order
            for quality_name in quality_order:
                q_stats = quality_stats.get(quality_name, {})
                entries = _stat_entries(q_stats)
                qv = quality_values.get(quality_name, 0)

                if entries:
                    for idx, (skill, location, stat, value) in enumerate(entries):
                        m = _meta(is_first, quality_name)
                        m.update({
                            'quality': quality_name if idx == 0 else '',
                            'item_value': qv if idx == 0 else '',
                            'skill': skill, 'location': location,
                            'stat': stat, 'value': value,
                        })
                        sheet_rows.append(m)
                        is_first = False
                else:
                    # Empty quality — still emit a row with just the quality name + value
                    m = _meta(is_first, quality_name)
                    m.update({'quality': quality_name, 'item_value': qv,
                              'skill': '', 'location': '',
                              'stat': '', 'value': ''})
                    sheet_rows.append(m)
                    is_first = False
        else:
            # Non-crafted or no quality stats: just base stats
            entries = _stat_entries(base_stats)
            has_quality_col = tab_name in ('Gear', 'Consumables', 'Inputs')

            for skill, location, stat, value in entries:
                m = _meta(is_first)
                if has_quality_col:
                    m['quality'] = ''
                m.update({'item_value': item_value if is_first else '',
                          'skill': skill, 'location': location,
                          'stat': stat, 'value': value})
                sheet_rows.append(m)
                is_first = False

        # If no stats at all, still emit one row with metadata
        if not sheet_rows:
            m = _meta(True)
            if tab_name in ('Gear', 'Consumables', 'Inputs'):
                m['quality'] = ''
                m.update({'item_value': item_value, 'skill': '', 'location': '', 'stat': '', 'value': ''})
            elif tab_name == 'Pets':
                m.update({'egg_value': item_value, 'level': 'Egg', 'xp_to_next_level': '',
                          'skill': '', 'location': '', 'stat': '', 'value': ''})
            else:
                m.update({'item_value': item_value, 'skill': '', 'location': '', 'stat': '', 'value': ''})
            sheet_rows.append(m)

        return sheet_rows


# ============================================================================
# MODULE-LEVEL HELPERS
# ============================================================================

def _group_multi_rows(rows: List[Dict[str, Any]]) -> list:
    """Group multi-row sheet data into item blocks.

    Returns list of {'meta': first_row_dict, 'stat_rows': [all_rows_for_item]}.
    """
    items = []
    current_item = None
    for row in rows:
        name = str(row.get('name', '')).strip()
        if name:
            if current_item:
                items.append(current_item)
            current_item = {'meta': row, 'stat_rows': [row]}
        elif current_item:
            current_item['stat_rows'].append(row)
    if current_item:
        items.append(current_item)
    return items


def _parse_multi_row_stats(stat_rows: list, is_crafted: bool):
    """Parse stat rows into nested stats, quality_stats, and quality_values dicts.

    Handles the quality inheritance: a quality row sets the current quality,
    subsequent stat rows without a quality inherit it.

    Returns:
        (stats, quality_stats, quality_values) where:
        - stats is base stats dict
        - quality_stats is per-quality stats (or None if not crafted)
        - quality_values is per-quality item values (or None if not crafted)
    """
    stats = {}
    quality_stats = {} if is_crafted else None
    quality_values = {} if is_crafted else None
    current_quality = ''

    for sr in stat_rows:
        quality = str(sr.get('quality', '')).strip()
        skill = str(sr.get('skill', '')).strip().lower()
        location = str(sr.get('location', '')).strip().lower() or 'global'
        stat = str(sr.get('stat', '')).strip()
        # Preserve ItemFindingCategory.* casing; lowercase everything else
        if stat.lower().startswith('itemfindingcategory.'):
            # Normalize to canonical form: ItemFindingCategory.UPPER_CASE
            parts = stat.split('.', 1)
            stat = 'ItemFindingCategory.' + parts[1].upper()
        else:
            stat = stat.lower()

        # Update current quality if this row specifies one
        if quality:
            current_quality = quality
            # Read item_value from quality rows
            if is_crafted and quality_values is not None:
                try:
                    qv = int(float(sr.get('item_value', 0) or 0))
                    if qv:
                        quality_values[quality] = qv
                except (ValueError, TypeError):
                    pass

        if not skill or not stat:
            continue

        try:
            value = float(sr.get('value', 0))
        except (ValueError, TypeError):
            continue

        if is_crafted and current_quality:
            if quality_stats is None:
                quality_stats = {}
            if current_quality not in quality_stats:
                quality_stats[current_quality] = {}
            if skill not in quality_stats[current_quality]:
                quality_stats[current_quality][skill] = {}
            if location not in quality_stats[current_quality][skill]:
                quality_stats[current_quality][skill][location] = {}
            quality_stats[current_quality][skill][location][stat] = value
        else:
            if skill not in stats:
                stats[skill] = {}
            if location not in stats[skill]:
                stats[skill][location] = {}
            stats[skill][location][stat] = value

    return stats, quality_stats, quality_values


def _utc_now() -> str:
    """ISO 8601 UTC timestamp."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
