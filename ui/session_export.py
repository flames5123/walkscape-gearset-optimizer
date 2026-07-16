#!/usr/bin/env python3
"""
Session SQL export utility.

Shared between the Discord bot and the admin web interface.
Generates SQL INSERT statements for a session and all related data.

Exports a faithful, reproducible copy of a session:
  - the sessions row (incl. all_items_raw + inventory_value -- the owned
    inventory the optimizer needs)
  - gear_sets + optimization_presets
  - the goals-report (stats_report_*) state: results, stale-badge scopes,
    and the character-state snapshot cache used for stale diffing

Previously only (uuid, character_config, ui_config, last_updated) + gear_sets
+ presets were exported, so a cloned/imported snapshot had an empty inventory
and no goals-report state -- running the optimizer against it produced no (or
degenerate 0-metric) results and the reporter's chest-farming options
disappeared. See bug 261c8504.
"""

from datetime import datetime
from ui.database import DatabaseManager


def _sql_literal(value):
    """Render a Python value as a SQLite literal.

    Handles BLOB columns (bytes/bytearray/memoryview) as X'<hex>' literals --
    plain str(value) would emit a Python bytes repr (b'...') and corrupt the
    data on import. Used for tables that carry BLOBs (stats_report_results
    .dominance_bitmap, stats_report_stale_scopes.added_item_ids /
    .removed_item_ids).
    """
    if value is None:
        return 'NULL'
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"X'{bytes(value).hex()}'"
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, (int, float)):
        return repr(value)
    s = str(value).replace("'", "''")
    return f"'{s}'"


# Backwards-compatible alias (older callers / tests import _sql_escape).
_sql_escape = _sql_literal


def _dump_table(cursor, table, where_col, where_val):
    """Return SQL lines that reproduce all rows of `table` matching
    `where_col = where_val`, prefixed by a scoped DELETE so re-import is
    idempotent. Column list is read live from PRAGMA table_info so the
    export tracks schema changes automatically. Returns (lines, row_count).
    """
    try:
        cols = [r[1] for r in cursor.execute(f"PRAGMA table_info({table})").fetchall()]
    except Exception:
        cols = []
    if not cols:
        return [], 0
    rows = cursor.execute(
        f"SELECT {', '.join(cols)} FROM {table} WHERE {where_col} = ?",
        (where_val,),
    ).fetchall()
    if not rows:
        return [], 0
    lines = [f"-- {table} ({len(rows)})",
             f"DELETE FROM {table} WHERE {where_col} = {_sql_literal(where_val)};"]
    col_list = ", ".join(cols)
    for row in rows:
        values = ", ".join(_sql_literal(v) for v in row)
        lines.append(f"INSERT OR REPLACE INTO {table} ({col_list}) VALUES ({values});")
    lines.append("")
    return lines, len(rows)


def generate_session_sql(db: DatabaseManager, uuid: str, session: dict) -> str:
    """Generate a full SQL export for a session including all related data.

    Exports: session row (incl. all_items_raw + inventory_value), gear_sets,
    optimization_presets, and the goals-report tables (stats_report_results,
    stats_report_stale_scopes, character_state_snapshot_cache).

    Args:
        db: DatabaseManager instance
        uuid: Session UUID
        session: Parsed session dict (from db.get_session)

    Returns:
        SQL string with INSERT statements wrapped in a transaction
    """
    conn = db._get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT uuid, character_config, ui_config, last_updated, all_items_raw, inventory_value "
        "FROM sessions WHERE uuid = ?",
        (uuid,)
    )
    session_row = cursor.fetchone()

    cursor.execute(
        "SELECT id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at "
        "FROM gear_sets WHERE session_uuid = ? ORDER BY updated_at DESC",
        (uuid,)
    )
    gear_set_rows = cursor.fetchall()

    cursor.execute(
        "SELECT id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at "
        "FROM optimization_presets WHERE session_uuid = ? ORDER BY updated_at DESC",
        (uuid,)
    )
    preset_rows = cursor.fetchall()

    # Goals-report (stats_report_*) state. Same session-keyed set that
    # DatabaseManager.copy_stats_report_data copies for in-prod snapshots, so
    # an exported/cloned session reproduces results + stale badges identically.
    stats_lines = []
    stats_counts = {}
    for tbl in ('stats_report_results',
                'stats_report_stale_scopes',
                'character_state_snapshot_cache'):
        tbl_lines, n = _dump_table(cursor, tbl, 'session_uuid', uuid)
        stats_lines.extend(tbl_lines)
        stats_counts[tbl] = n

    if not db._persistent_conn:
        conn.close()

    char_name = session['character_config'].get('name', 'Unknown') if session['character_config'] else 'Unknown'

    lines = []
    lines.append(f"-- Session export for UUID: {uuid}")
    lines.append(f"-- Character: {char_name}")
    lines.append(f"-- Exported: {datetime.now().isoformat()}")
    lines.append(f"-- Gear sets: {len(gear_set_rows)}")
    lines.append(f"-- Optimization presets: {len(preset_rows)}")
    lines.append(f"-- Goals-report rows: {stats_counts}")
    lines.append("")
    lines.append("BEGIN TRANSACTION;")
    lines.append("")

    # Session row -- now includes all_items_raw + inventory_value so the
    # imported session carries the reporter's full owned inventory.
    lines.append("-- Session data")
    lines.append(
        f"INSERT OR REPLACE INTO sessions "
        f"(uuid, character_config, ui_config, last_updated, all_items_raw, inventory_value) VALUES ("
        f"{_sql_literal(session_row[0])}, "
        f"{_sql_literal(session_row[1])}, "
        f"{_sql_literal(session_row[2])}, "
        f"{_sql_literal(session_row[3])}, "
        f"{_sql_literal(session_row[4])}, "
        f"{_sql_literal(session_row[5])}"
        f");"
    )
    lines.append("")

    # Gear sets
    if gear_set_rows:
        lines.append(f"-- Gear sets ({len(gear_set_rows)})")
        lines.append(f"DELETE FROM gear_sets WHERE session_uuid = {_sql_literal(uuid)};")
        for row in gear_set_rows:
            lines.append(
                f"INSERT INTO gear_sets (id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at) VALUES ("
                f"{_sql_literal(row[0])}, "
                f"{_sql_literal(row[1])}, "
                f"{_sql_literal(row[2])}, "
                f"{_sql_literal(row[3])}, "
                f"{_sql_literal(row[4])}, "
                f"{_sql_literal(row[5])}, "
                f"{_sql_literal(row[6])}, "
                f"{_sql_literal(row[7])}"
                f");"
            )
        lines.append("")

    # Optimization presets
    if preset_rows:
        lines.append(f"-- Optimization presets ({len(preset_rows)})")
        lines.append(f"DELETE FROM optimization_presets WHERE session_uuid = {_sql_literal(uuid)};")
        for row in preset_rows:
            lines.append(
                f"INSERT INTO optimization_presets (id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at) VALUES ("
                f"{_sql_literal(row[0])}, "
                f"{_sql_literal(row[1])}, "
                f"{_sql_literal(row[2])}, "
                f"{_sql_literal(row[3])}, "
                f"{_sql_literal(row[4])}, "
                f"{_sql_literal(row[5])}, "
                f"{_sql_literal(row[6])}, "
                f"{_sql_literal(row[7])}"
                f");"
            )
        lines.append("")

    # Goals-report (stats_report_*) state
    if stats_lines:
        lines.append("-- Goals-report (stats_report_*) state")
        lines.extend(stats_lines)

    lines.append("COMMIT;")
    return '\n'.join(lines)
