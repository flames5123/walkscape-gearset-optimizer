#!/usr/bin/env python3
"""
SQLite database manager for session persistence.

Manages user sessions with separate character_config and ui_config storage.
Each session is identified by a UUID and stores:
- character_config: Imported game export data (skills, items, reputation)
- ui_config: User preferences (hidden items, quality selections, custom stats)
"""

import json
import math
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any


def _utc_now() -> str:
    """Get current UTC time as ISO string with Z suffix for JavaScript compatibility."""
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def _sanitize_for_json(obj):
    """Recursively replace float('inf'), float('-inf'), and float('nan') with None.
    
    Python's json.dumps allows these by default, but they produce non-standard
    JSON tokens (Infinity, -Infinity, NaN) that fail when FastAPI serializes
    responses with allow_nan=False (the JSON spec default).
    """
    if isinstance(obj, float):
        if math.isinf(obj) or math.isnan(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(v) for v in obj]
    return obj


class DatabaseManager:
    """Manages SQLite database for session persistence."""
    
    def __init__(self, db_path: str = "sessions.db"):
        """Initialize database manager.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = db_path
        self._persistent_conn = None
        
        # For in-memory databases, keep connection open
        # Use check_same_thread=False for async/multi-threaded environments
        if db_path == ":memory:":
            self._persistent_conn = sqlite3.connect(db_path, check_same_thread=False)
            self._init_db_with_conn(self._persistent_conn)
        else:
            self._init_db()
    
    def _init_db(self):
        """Create sessions table if not exists (for file-based databases)."""
        conn = sqlite3.connect(self.db_path, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        self._init_db_with_conn(conn)
        conn.close()
    
    def _init_db_with_conn(self, conn):
        """Create sessions and gear_sets tables using provided connection."""
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                uuid TEXT PRIMARY KEY,
                character_config TEXT,
                ui_config TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Gear sets table for storing saved gear configurations
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS gear_sets (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                slots_json TEXT NOT NULL,
                export_string TEXT,
                is_optimized INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
                UNIQUE(session_uuid, name)
            )
        """)
        
        # Add columns if they don't exist (migrations)
        try:
            cursor.execute("ALTER TABLE gear_sets ADD COLUMN is_optimized INTEGER DEFAULT 0")
        except:
            pass  # Column already exists
        
        try:
            cursor.execute("ALTER TABLE gear_sets ADD COLUMN export_string TEXT")
        except:
            pass  # Column already exists
        
        # Bug reports table for user-submitted issues
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS optimization_presets (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                preset_type TEXT NOT NULL,
                sorting_json TEXT NOT NULL,
                include_consumables INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
                UNIQUE(session_uuid, name, preset_type)
            )
        """)
        
        # Bug reports table for user-submitted issues
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bug_reports (
                id TEXT PRIMARY KEY,
                original_session_uuid TEXT NOT NULL,
                snapshot_session_uuid TEXT NOT NULL,
                description TEXT NOT NULL,
                app_version TEXT NOT NULL,
                browser_info TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                screenshots_json TEXT,
                reviewed BOOLEAN DEFAULT 0,
                reviewed_at TIMESTAMP,
                reviewed_by TEXT,
                notes TEXT,
                server_logs TEXT,
                FOREIGN KEY (original_session_uuid) REFERENCES sessions(uuid),
                FOREIGN KEY (snapshot_session_uuid) REFERENCES sessions(uuid)
            )
        """)

        # Bug report notes (ticket-style comment chain on a bug report).
        # Append-only timeline. Replies allowed via parent_note_id self-FK.
        # Author is a self-reported string (e.g. 'meshclaw', 'jwbail').
        # thread_title lets an agent identify its own thread when replying
        # to itself in a future session.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS bug_report_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id TEXT NOT NULL,
                parent_note_id INTEGER,
                author TEXT NOT NULL,
                thread_title TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (report_id) REFERENCES bug_reports(id),
                FOREIGN KEY (parent_note_id) REFERENCES bug_report_notes(id)
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_report_notes_report
            ON bug_report_notes(report_id, created_at)
        """)

        # Per-device local-optimization speed benchmark samples. Append-only;
        # one row per benchmark run (auto on first load, or manual via the
        # settings button). Used to calibrate the "your device is faster than
        # the server" threshold against real device data.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS local_speed_benchmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid TEXT,
                count INTEGER NOT NULL,
                run_ms REAL,
                boot_ms REAL,
                faster BOOLEAN,
                threshold INTEGER,
                user_agent TEXT,
                source TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_local_speed_benchmarks_created
            ON local_speed_benchmarks(created_at)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_bug_report_notes_parent
            ON bug_report_notes(parent_note_id)
        """)

        # API access audit table for tracking usage
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS api_access_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_uuid TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_agent TEXT,
                ip_address TEXT,
                FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
            )
        """)
        
        # Create index for faster queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_access_session 
            ON api_access_audit(session_uuid)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_access_timestamp 
            ON api_access_audit(timestamp)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_api_access_endpoint 
            ON api_access_audit(endpoint)
        """)
        
        # Debug sessions table for remote debug mode toggling
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS debug_sessions (
                session_uuid TEXT PRIMARY KEY,
                enabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                enabled_by TEXT NOT NULL
            )
        """)
        
        # Broadcasts table for admin broadcast messages
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS broadcasts (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL,
                active BOOLEAN DEFAULT 1
            )
        """)
        
        # Broadcast dismissals table for per-session dismissal tracking
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS broadcast_dismissals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                broadcast_id TEXT NOT NULL,
                session_uuid TEXT NOT NULL,
                dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(broadcast_id, session_uuid)
            )
        """)
        
        # Feature flags table for per-session feature access
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feature_flags (
                session_uuid TEXT NOT NULL,
                feature TEXT NOT NULL,
                enabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                enabled_by TEXT NOT NULL,
                PRIMARY KEY (session_uuid, feature)
            )
        """)

        # Walkdle daily-puzzle attempts (see ui/migrations/*_create_daily_puzzle_attempts.sql).
        # One row per (session_uuid, puzzle_date, mode); state_json holds guesses + solved flag.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_puzzle_attempts (
                session_uuid TEXT NOT NULL,
                puzzle_date  TEXT NOT NULL,
                mode         TEXT NOT NULL,
                state_json   TEXT NOT NULL DEFAULT '{}',
                created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (session_uuid, puzzle_date, mode)
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_walkdle_session ON daily_puzzle_attempts(session_uuid)"
        )

        # Walkdle item availability: the first UTC date each guessable item was
        # seen. Lets the daily-target schedule pin each day to the items that
        # existed then, so adding items never reshuffles past days. Tiny
        # (one row per item, append-only); the per-day target is recomputed on
        # the fly, not stored.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS walkdle_item_first_seen (
                item_id    TEXT PRIMARY KEY,
                first_seen TEXT NOT NULL
            )
        """)

        # Notepad feature (FAC-gated): server-side multi-note rich-text notes.
        # One row per note; content_json holds the Quill Delta (entity links
        # live inside as custom embeds). title is derived server-side from the
        # first non-empty line. See .kiro/NOTEPAD_SPEC.md.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT 'Untitled',
                content_json TEXT NOT NULL DEFAULT '{}',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_session_updated "
            "ON notes(session_uuid, updated_at DESC)"
        )
        # Remembers which note a session had selected so reopening the notepad
        # returns to the same note.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notepad_state (
                session_uuid TEXT PRIMARY KEY,
                selected_note_id TEXT,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Targeted broadcasts — announcements visible only to specific sessions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS targeted_broadcasts (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                session_uuids TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL,
                active BOOLEAN DEFAULT 1
            )
        """)
        
        # Session groups — named collections of session UUIDs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS session_groups (
                name TEXT PRIMARY KEY,
                session_uuids TEXT NOT NULL DEFAULT '[]',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL
            )
        """)
        
        # Active optimizations — survives uvicorn reloads
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS active_optimizations (
                session_uuid TEXT PRIMARY KEY,
                opt_type TEXT NOT NULL,
                opt_id TEXT NOT NULL,
                pid INTEGER,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Doc comments — inline review comments on spec documents
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS doc_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL,
                selected_text TEXT NOT NULL,
                comment TEXT NOT NULL,
                line_num INTEGER,
                section TEXT,
                full_line TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_doc_comments_doc ON doc_comments(doc_id)")
        
        conn.commit()
    
    def _get_connection(self):
        """Get database connection (reuse for in-memory, create new for file-based).
        
        Uses WAL journal mode and a 5-second busy timeout to reduce
        'database is locked' errors under concurrent access.
        """
        if self._persistent_conn:
            return self._persistent_conn
        conn = sqlite3.connect(self.db_path, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    # XP table for skill level calculation (matches walkscape_constants.py)
    _LEVEL_XP = [
        0, 83, 174, 276, 388, 512, 650, 801, 969, 1154,
        1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973, 4470,
        5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031, 13363,
        14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648, 37224,
        41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721, 101333,
        111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886, 273742,
        302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051, 737627,
        814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808, 1986068,
        2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295, 5346332,
        5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431,
    ]

    @staticmethod
    def _xp_to_level(xp: int) -> int:
        """Convert XP to skill level."""
        for level, required_xp in enumerate(DatabaseManager._LEVEL_XP, start=1):
            if xp < required_xp:
                return level - 1
        return 99

    @staticmethod
    def _xp_equate(level: float) -> int:
        """XP equation for character level."""
        return int(level + 300 * (2 ** (level / 7)))

    @staticmethod
    def _character_level_from_steps(steps: int) -> int:
        """Calculate character level from total steps."""
        char_level = 1
        while char_level < 999:
            xp = 0.0
            for i in range(1, char_level + 2):
                xp += DatabaseManager._xp_equate(float(i))
            required_xp = int(xp / 4) * 4.6
            if steps < required_xp:
                break
            char_level += 1
        return char_level

    def get_session(self, session_uuid: str) -> Optional[Dict[str, Any]]:
        """Retrieve session data by UUID.
        
        Args:
            session_uuid: Session UUID to retrieve
            
        Returns:
            Dictionary with uuid, character_config, ui_config, last_updated
            or None if session doesn't exist
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT uuid, character_config, ui_config, last_updated, all_items_raw, inventory_value
            FROM sessions
            WHERE uuid = ?
        """, (session_uuid,))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        result = {
            'uuid': row[0],
            'character_config': json.loads(row[1]) if row[1] else None,
            'ui_config': json.loads(row[2]) if row[2] else {},
            'last_updated': row[3]
        }
        # Include all_items_raw only if column exists (migration may not have run yet)
        try:
            result['all_items_raw'] = row[4]
        except IndexError:
            pass
        try:
            result['inventory_value'] = row[5]
        except IndexError:
            pass
        return result
    
    def create_session(self, session_uuid: str) -> Dict[str, Any]:
        """Create a new session with empty configs.
        
        Args:
            session_uuid: UUID for the new session
            
        Returns:
            Dictionary with uuid, character_config (None), ui_config (empty dict)
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Create empty ui_config
        ui_config = {}
        
        cursor.execute("""
            INSERT INTO sessions (uuid, character_config, ui_config, last_updated)
            VALUES (?, NULL, ?, ?)
        """, (session_uuid, json.dumps(ui_config), _utc_now()))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return {
            'uuid': session_uuid,
            'character_config': None,
            'ui_config': ui_config,
            'last_updated': _utc_now()
        }
    
    def update_character_config(self, session_uuid: str, config: Dict[str, Any]):
        """Update character_config for a session.
        
        Args:
            session_uuid: Session UUID to update
            config: Character configuration dictionary
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE sessions
            SET character_config = ?, last_updated = ?
            WHERE uuid = ?
        """, (json.dumps(config), _utc_now(), session_uuid))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
    def update_inventory_value(self, session_uuid: str, value: int):
        """Update the inventory_value column for a session.

        Args:
            session_uuid: Session UUID to update
            value: Total coin value of all owned items
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE sessions
            SET inventory_value = ?
            WHERE uuid = ?
        """, (value, session_uuid))

        conn.commit()

        if not self._persistent_conn:
            conn.close()
    def update_all_items_raw(self, session_uuid: str, all_items_raw: dict):
        """Store the full inventory with quantities (backend-only, not sent to frontend).

        Args:
            session_uuid: Session UUID to update
            all_items_raw: Dict of {export_name: quantity}
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE sessions
            SET all_items_raw = ?
            WHERE uuid = ?
        """, (json.dumps(all_items_raw), session_uuid))

        conn.commit()

        if not self._persistent_conn:
            conn.close()
    
    def update_ui_config(self, session_uuid: str, config: Dict[str, Any]):
        """Update ui_config for a session.
        
        Args:
            session_uuid: Session UUID to update
            config: UI configuration dictionary
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE sessions
            SET ui_config = ?, last_updated = ?
            WHERE uuid = ?
        """, (json.dumps(config), _utc_now(), session_uuid))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
    
    def update_config_path(self, session_uuid: str, path: str, value: Any):
        """Update a specific path in the configuration.
        
        Supports nested paths like "items.TRAVELERS_KIT.has" or "skills.mining".
        Automatically determines whether to update character_config or ui_config
        based on the path prefix.
        
        Args:
            session_uuid: Session UUID to update
            path: Dot-separated path (e.g., "items.TRAVELERS_KIT.has")
            value: Value to set at the path
        """
        # Get current session
        session = self.get_session(session_uuid)
        if not session:
            return
        
        # Determine which config to update based on path
        # ui_config paths: ui.*, items.*.hide, quality_overrides.*
        # character_config paths: skills.*, reputation.*, items.*.has, achievement_points, coins
        
        parts = path.split('.')
        
        # Determine target config and adjust path
        if parts[0] == 'ui':
            config = session['ui_config']
            config_type = 'ui'
            # Skip the 'ui' prefix since we're already in ui_config
            parts = parts[1:]
        elif len(parts) >= 3 and parts[0] == 'items' and parts[2] == 'hide':
            config = session['ui_config']
            config_type = 'ui'
        elif parts[0] == 'quality_overrides':
            config = session['ui_config']
            config_type = 'ui'
        elif parts[0] == 'custom_stats':
            config = session['ui_config']
            config_type = 'ui'
        else:
            config = session['character_config']
            if config is None:
                config = {}
            config_type = 'character'
        
        # Navigate to the parent of the target path
        current = config
        for i, part in enumerate(parts[:-1]):
            if part not in current:
                current[part] = {}
            current = current[part]
        
        # Set the value
        current[parts[-1]] = value
        
        # Update the appropriate config
        if config_type == 'ui':
            self.update_ui_config(session_uuid, config)
        else:
            self.update_character_config(session_uuid, config)

    # ========================================================================
    # GEAR SET CRUD METHODS
    # ========================================================================

    def get_gear_sets(self, session_uuid: str, limit: Optional[int] = None, offset: int = 0) -> list:
        """Get gear sets for a session.

        Args:
            session_uuid: Session UUID to get gear sets for
            limit: When provided, limit the result to the N most-recently-updated
                gear sets. None returns all rows (legacy behavior).
            offset: Skip this many rows at the start of the ordered list.
                Only useful with `limit`.

        Returns:
            List of gear set dictionaries with id, name, slots_json, is_optimized, timestamps
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        if limit is not None and limit > 0:
            cursor.execute("""
                SELECT id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at
                FROM gear_sets
                WHERE session_uuid = ?
                ORDER BY updated_at DESC
                LIMIT ? OFFSET ?
            """, (session_uuid, limit, offset))
        else:
            cursor.execute("""
                SELECT id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at
                FROM gear_sets
                WHERE session_uuid = ?
                ORDER BY updated_at DESC
            """, (session_uuid,))
        
        rows = cursor.fetchall()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        gear_sets = []
        for row in rows:
            slots = json.loads(row[3]) if row[3] else {}
            gear_sets.append({
                'id': row[0],
                'session_uuid': row[1],
                'name': row[2],
                'slots_json': _sanitize_for_json(slots),
                'export_string': row[4],
                'is_optimized': bool(row[5]),
                'created_at': row[6],
                'updated_at': row[7]
            })
        
        return gear_sets

    def count_gear_sets(self, session_uuid: str) -> int:
        """Count gear sets for a session. Cheaper than get_gear_sets when the
        caller only needs a total to decide whether to render a "Load all"
        button alongside a paginated/limited list.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM gear_sets WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return int(row[0]) if row and row[0] is not None else 0

    def get_gear_set(self, session_uuid: str, gear_set_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific gear set by ID.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to retrieve
            
        Returns:
            Gear set dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, name, slots_json, created_at, updated_at
            FROM gear_sets
            WHERE id = ? AND session_uuid = ?
        """, (gear_set_id, session_uuid))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'slots_json': _sanitize_for_json(json.loads(row[3])) if row[3] else {},
            'created_at': row[4],
            'updated_at': row[5]
        }

    def get_gear_set_by_name(self, session_uuid: str, name: str) -> Optional[Dict[str, Any]]:
        """Get a gear set by name for a session.
        
        Args:
            session_uuid: Session UUID
            name: Gear set name
            
        Returns:
            Gear set dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, name, slots_json, created_at, updated_at
            FROM gear_sets
            WHERE session_uuid = ? AND name = ?
        """, (session_uuid, name))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'slots_json': _sanitize_for_json(json.loads(row[3])) if row[3] else {},
            'created_at': row[4],
            'updated_at': row[5]
        }

    def create_gear_set(self, session_uuid: str, name: str, slots_json: Dict[str, Any], is_optimized: bool = False, export_string: str = None) -> Dict[str, Any]:
        """Create a new gear set.
        
        Args:
            session_uuid: Session UUID
            name: Gear set name (must be unique per session)
            slots_json: Dictionary of slot configurations
            is_optimized: Whether this gearset was generated by optimization
            export_string: Optional gearset export string (for optimized gearsets)
            
        Returns:
            Created gear set dictionary
            
        Raises:
            ValueError: If a gear set with this name already exists
        """
        # Check for duplicate name
        existing = self.get_gear_set_by_name(session_uuid, name)
        if existing:
            raise ValueError(f"A gear set with name '{name}' already exists")
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        gear_set_id = str(uuid.uuid4())
        now = _utc_now()
        
        cursor.execute("""
            INSERT INTO gear_sets (id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (gear_set_id, session_uuid, name, json.dumps(_sanitize_for_json(slots_json)), export_string, 1 if is_optimized else 0, now, now))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return {
            'id': gear_set_id,
            'session_uuid': session_uuid,
            'name': name,
            'slots_json': slots_json,
            'export_string': export_string,
            'is_optimized': is_optimized,
            'created_at': now,
            'updated_at': now
        }

    def update_gear_set(self, session_uuid: str, gear_set_id: str, 
                        name: Optional[str] = None, 
                        slots_json: Optional[Dict[str, Any]] = None,
                        export_string: Optional[str] = None,
                        is_optimized: Optional[bool] = None) -> Optional[Dict[str, Any]]:
        """Update an existing gear set.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to update
            name: New name (optional)
            slots_json: New slot configuration (optional)
            export_string: New export string (optional)
            is_optimized: New is_optimized flag (optional)
            
        Returns:
            Updated gear set dictionary or None if not found
            
        Raises:
            ValueError: If new name conflicts with existing gear set
        """
        # Get existing gear set
        existing = self.get_gear_set(session_uuid, gear_set_id)
        if not existing:
            return None
        
        # Check for name conflict if name is being changed
        if name and name != existing['name']:
            conflict = self.get_gear_set_by_name(session_uuid, name)
            if conflict:
                raise ValueError(f"A gear set with name '{name}' already exists")
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Build update query
        updates = []
        params = []
        
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        
        if slots_json is not None:
            updates.append("slots_json = ?")
            params.append(json.dumps(_sanitize_for_json(slots_json)))
        
        if export_string is not None:
            updates.append("export_string = ?")
            params.append(export_string)
        
        if is_optimized is not None:
            updates.append("is_optimized = ?")
            params.append(1 if is_optimized else 0)
        
        updates.append("updated_at = ?")
        now = _utc_now()
        params.append(now)
        
        params.extend([gear_set_id, session_uuid])
        
        cursor.execute(f"""
            UPDATE gear_sets
            SET {', '.join(updates)}
            WHERE id = ? AND session_uuid = ?
        """, params)
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        # Return updated gear set
        return self.get_gear_set(session_uuid, gear_set_id)

    def save_gear_set(self, session_uuid: str, name: str, slots_json: Dict[str, Any], 
                      gear_set_id: Optional[str] = None, is_optimized: bool = False, export_string: str = None) -> Dict[str, Any]:
        """Save or update a gear set (upsert operation).
        
        If gear_set_id is provided and exists, updates that gear set.
        If name matches an existing gear set, updates that gear set.
        Otherwise, creates a new gear set.
        
        Args:
            session_uuid: Session UUID
            name: Gear set name
            slots_json: Dictionary of slot configurations
            gear_set_id: Optional gear set ID for updates
            is_optimized: Whether this gearset was generated by optimization
            
        Returns:
            Saved gear set dictionary
        """
        # If ID provided, try to update by ID
        if gear_set_id:
            existing = self.get_gear_set(session_uuid, gear_set_id)
            if existing:
                return self.update_gear_set(session_uuid, gear_set_id, name=name, slots_json=slots_json)
        
        # Check if name exists
        existing_by_name = self.get_gear_set_by_name(session_uuid, name)
        if existing_by_name:
            return self.update_gear_set(session_uuid, existing_by_name['id'], slots_json=slots_json, export_string=export_string, is_optimized=is_optimized if is_optimized else None)
        
        # Create new
        return self.create_gear_set(session_uuid, name, slots_json, is_optimized=is_optimized, export_string=export_string)

    def delete_gear_set(self, session_uuid: str, gear_set_id: str) -> bool:
        """Delete a gear set.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to delete
            
        Returns:
            True if deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            DELETE FROM gear_sets
            WHERE id = ? AND session_uuid = ?
        """, (gear_set_id, session_uuid))
        
        deleted = cursor.rowcount > 0
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return deleted

    def bulk_delete_gear_sets(self, session_uuid: str, gear_set_ids: list) -> int:
        """Delete multiple gear sets in a single transaction.
        Only deletes gear sets belonging to the specified session.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_ids: List of gear set IDs to delete
            
        Returns:
            Count of deleted rows
        """
        if not gear_set_ids:
            return 0
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        placeholders = ','.join('?' for _ in gear_set_ids)
        params = [session_uuid] + list(gear_set_ids)
        
        cursor.execute(f"""
            DELETE FROM gear_sets
            WHERE session_uuid = ? AND id IN ({placeholders})
        """, params)
        
        deleted_count = cursor.rowcount
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return deleted_count

    # ========================================================================
    # TRAVEL CONFIG METHODS
    # ========================================================================

    def get_travel_config(self, session_uuid: str) -> Optional[Dict[str, Any]]:
        """Get the Travel_Config_Store for a session.

        Args:
            session_uuid: Session UUID

        Returns:
            Parsed config dict, or None if no config exists yet
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT config_json FROM travel_config WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()

        if not self._persistent_conn:
            conn.close()

        if row is None:
            return None
        return json.loads(row[0])

    def save_travel_config(self, session_uuid: str, config_json: Dict[str, Any]) -> None:
        """Upsert the Travel_Config_Store for a session.

        Args:
            session_uuid: Session UUID
            config_json: Full Travel_Config_Store dict to persist
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO travel_config (session_uuid, config_json, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(session_uuid) DO UPDATE SET
                config_json = excluded.config_json,
                updated_at  = excluded.updated_at
        """, (session_uuid, json.dumps(config_json)))

        conn.commit()

        if not self._persistent_conn:
            conn.close()

    def get_travel_gearsets(self, session_uuid: str) -> list:
        """Get all travel gearsets for a session (gear_sets rows with is_travel=1).

        Args:
            session_uuid: Session UUID

        Returns:
            List of dicts with id, name, export_string, travel_route_ids, travel_region
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, export_string, travel_route_ids, travel_region,
                   created_at, updated_at
            FROM gear_sets
            WHERE session_uuid = ? AND is_travel = 1
            ORDER BY updated_at DESC
        """, (session_uuid,))

        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        result = []
        for row in rows:
            result.append({
                'id': row[0],
                'name': row[1],
                'export_string': row[2],
                'travel_route_ids': json.loads(row[3]) if row[3] else [],
                'travel_region': row[4],
                'created_at': row[5],
                'updated_at': row[6],
            })
        return result

    # ========================================================================
    # ACTIVE OPTIMIZATION TRACKING (survives uvicorn reloads)
    # ========================================================================

    def start_optimization(self, session_uuid: str, opt_type: str, opt_id: str, pid: int = None):
        """Mark an optimization as active for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO active_optimizations (session_uuid, opt_type, opt_id, pid, started_at)
            VALUES (?, ?, ?, ?, ?)
        """, (session_uuid, opt_type, opt_id, pid, _utc_now()))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def finish_optimization(self, session_uuid: str, exit_code: int = 0):
        """Remove the active optimization record and log to history."""
        conn = self._get_connection()
        cursor = conn.cursor()
        # Read current record before deleting so we can compute duration
        cursor.execute(
            "SELECT opt_type, opt_id, started_at FROM active_optimizations WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if row:
            opt_type, opt_id, started_at = row
            duration_ms = None
            if started_at:
                try:
                    from datetime import datetime, timezone
                    if isinstance(started_at, str):
                        started = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                    else:
                        started = started_at
                    if started.tzinfo is None:
                        started = started.replace(tzinfo=timezone.utc)
                    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
                except Exception:
                    pass
            try:
                cursor.execute("""
                    INSERT INTO optimization_history (session_uuid, opt_type, opt_id, duration_ms, exit_code)
                    VALUES (?, ?, ?, ?, ?)
                """, (session_uuid, opt_type, opt_id, duration_ms, exit_code))
            except Exception:
                pass  # Don't fail if history table doesn't exist yet
        cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def has_optimized_gearset_since(self, session_uuid: str, since_iso: str) -> bool:
        """Check whether an optimized gearset has been saved (or updated) for
        this session at or after the given ISO-8601 UTC timestamp.

        Used by the SSE endpoint to verify that a 'done' wakeup corresponds
        to an actual save by THIS click's worker, not a stale signal from a
        previously-running watcher thread that was still alive when a new
        optimization started.

        Compares both `created_at` and `updated_at` so that re-saved
        (named-collision overwrite) gearsets count as fresh — `save_gear_set`
        upserts by name and only `updated_at` advances on collision.

        Args:
            session_uuid: Session UUID
            since_iso: ISO-8601 UTC timestamp string from `_utc_now()`
                (format: 'YYYY-MM-DDTHH:MM:SS.fffZ'). Compared as a string;
                the format is monotonic so lexical compare is correct.

        Returns:
            True if any optimized gearset for this session has
            created_at >= since_iso OR updated_at >= since_iso.
        """
        if not since_iso:
            return False
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 1 FROM gear_sets
            WHERE session_uuid = ?
              AND is_optimized = 1
              AND (created_at >= ? OR updated_at >= ?)
            LIMIT 1
            """,
            (session_uuid, since_iso, since_iso),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row is not None

    def get_active_optimization_started_at(self, session_uuid: str) -> Optional[str]:
        """Return the started_at ISO timestamp for the session's active
        optimization, or None if no optimization is currently active.

        Used by the SSE endpoint to anchor the "save freshness" check at the
        moment THIS click was registered (POST endpoint pre-creates the row
        before the background task spawns the worker), so any existing
        gearsets from prior optimizations are excluded from the check.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT started_at FROM active_optimizations WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return row[0] if row[0] else None

    def is_optimization_active(self, session_uuid: str) -> bool:
        """Check if an optimization is currently running for a session.
        
        Also cleans up stale entries where the process is no longer running.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT pid, started_at FROM active_optimizations WHERE session_uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False

        pid, started_at = row

        # Check if the process is still alive
        if pid:
            import os
            import signal
            try:
                os.kill(pid, 0)  # Signal 0 = check existence, don't kill
            except OSError:
                # Process is dead — clean up stale record
                cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return False

        # Also clean up if started more than 3 minutes ago (safety net)
        from datetime import datetime, timezone
        try:
            if isinstance(started_at, str):
                started = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
            else:
                started = started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - started).total_seconds()
            if age > 180:  # 3 minutes
                cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return False
        except Exception:
            pass  # If we can't parse the timestamp, assume it's still running

        if not self._persistent_conn:
            conn.close()
        return True

    def cleanup_stale_optimizations(self):
        """Remove all stale optimization records (dead processes or too old)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT session_uuid, pid FROM active_optimizations")
        rows = cursor.fetchall()
        for session_uuid, pid in rows:
            if pid:
                import os
                try:
                    os.kill(pid, 0)
                except OSError:
                    cursor.execute("DELETE FROM active_optimizations WHERE session_uuid = ?", (session_uuid,))
        # Also clean up anything older than 3 minutes
        cursor.execute("""
            DELETE FROM active_optimizations 
            WHERE started_at < datetime('now', '-3 minutes')
        """)
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    # ========================================================================
    # OPTIMIZATION PRESET CRUD METHODS
    # ========================================================================

    def get_optimization_presets(self, session_uuid: str, preset_type: str) -> list:
        """Get all optimization presets for a session and type.
        
        Args:
            session_uuid: Session UUID
            preset_type: 'activity' or 'recipe'
            
        Returns:
            List of preset dictionaries
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at
            FROM optimization_presets
            WHERE session_uuid = ? AND preset_type = ?
            ORDER BY updated_at DESC
        """, (session_uuid, preset_type))
        
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        
        return [{
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'preset_type': row[3],
            'sorting': json.loads(row[4]) if row[4] else [],
            'include_consumables': bool(row[5]),
            'created_at': row[6],
            'updated_at': row[7]
        } for row in rows]

    def save_optimization_preset(self, session_uuid: str, name: str, preset_type: str,
                                  sorting: list, include_consumables: bool = False,
                                  preset_id: str = None) -> dict:
        """Save or update an optimization preset (upsert by name+type).
        
        Args:
            session_uuid: Session UUID
            name: Preset name
            preset_type: 'activity' or 'recipe'
            sorting: List of [metric_key, weight] tuples
            include_consumables: Whether to include consumables
            preset_id: Optional preset ID for updates
            
        Returns:
            Saved preset dictionary
            
        Raises:
            ValueError: If name conflicts
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        sorting_json = json.dumps(sorting)
        
        # If ID provided, update by ID
        if preset_id:
            cursor.execute("""
                SELECT id FROM optimization_presets WHERE id = ? AND session_uuid = ?
            """, (preset_id, session_uuid))
            if cursor.fetchone():
                # Check name conflict with other presets
                cursor.execute("""
                    SELECT id FROM optimization_presets
                    WHERE session_uuid = ? AND name = ? AND preset_type = ? AND id != ?
                """, (session_uuid, name, preset_type, preset_id))
                if cursor.fetchone():
                    if not self._persistent_conn:
                        conn.close()
                    raise ValueError(f"A preset with name '{name}' already exists")
                
                cursor.execute("""
                    UPDATE optimization_presets
                    SET name = ?, sorting_json = ?, include_consumables = ?, updated_at = ?
                    WHERE id = ? AND session_uuid = ?
                """, (name, sorting_json, 1 if include_consumables else 0, now, preset_id, session_uuid))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return self._get_preset_by_id(session_uuid, preset_id)
        
        # Check for existing by name+type
        cursor.execute("""
            SELECT id FROM optimization_presets
            WHERE session_uuid = ? AND name = ? AND preset_type = ?
        """, (session_uuid, name, preset_type))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing
            cursor.execute("""
                UPDATE optimization_presets
                SET sorting_json = ?, include_consumables = ?, updated_at = ?
                WHERE id = ? AND session_uuid = ?
            """, (sorting_json, 1 if include_consumables else 0, now, existing[0], session_uuid))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return self._get_preset_by_id(session_uuid, existing[0])
        
        # Create new
        new_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO optimization_presets (id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, preset_type, sorting_json, 1 if include_consumables else 0, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return self._get_preset_by_id(session_uuid, new_id)

    def _get_preset_by_id(self, session_uuid: str, preset_id: str) -> dict:
        """Get a single preset by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, preset_type, sorting_json, include_consumables, created_at, updated_at
            FROM optimization_presets
            WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'id': row[0], 'session_uuid': row[1], 'name': row[2], 'preset_type': row[3],
            'sorting': json.loads(row[4]) if row[4] else [], 'include_consumables': bool(row[5]),
            'created_at': row[6], 'updated_at': row[7]
        }

    def delete_optimization_preset(self, session_uuid: str, preset_id: str) -> bool:
        """Delete an optimization preset.
        
        Returns:
            True if deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM optimization_presets WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # PINNED SAVES CRUD METHODS
    # ========================================================================

    def get_pinned_saves(self, session_uuid: str) -> list:
        """Get all pinned-save presets for a session, newest first.

        Args:
            session_uuid: Session UUID

        Returns:
            List of preset dictionaries, ordered by updated_at DESC.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, pin_paths_json, created_at, updated_at
            FROM pinned_saves
            WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'pin_paths': json.loads(row[3]) if row[3] else [],
            'created_at': row[4],
            'updated_at': row[5],
        } for row in rows]

    def save_pinned_save(self, session_uuid: str, name: str, pin_paths: list,
                         preset_id: str = None) -> dict:
        """Create or update a pinned-save preset.

        Upsert semantics mirror save_optimization_preset:
          1. If preset_id is provided AND owned by this session: update it.
             Reject on name clash with a different preset.
          2. Else if a preset with the same name already exists in this session:
             update that one in place.
          3. Else: insert a new row.

        Args:
            session_uuid: Session UUID.
            name: Preset name (1..60 chars after trim).
            pin_paths: JSON-serializable list of Pin Path descriptors.
            preset_id: Optional preset ID for targeted updates.

        Returns:
            The saved preset dictionary.

        Raises:
            ValueError: If name is empty, too long, pin_paths is not a list,
                        or a rename would collide with another preset's name.
        """
        name = (name or '').strip()
        if not name:
            raise ValueError('Preset name cannot be empty')
        if len(name) > 60:
            raise ValueError('Preset name must be at most 60 characters')
        if not isinstance(pin_paths, list):
            raise ValueError('pin_paths must be a list')

        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        pin_paths_json = json.dumps(pin_paths)

        # Path 1: targeted update by id.
        if preset_id:
            cursor.execute(
                "SELECT id FROM pinned_saves WHERE id = ? AND session_uuid = ?",
                (preset_id, session_uuid),
            )
            if cursor.fetchone():
                cursor.execute(
                    """SELECT id FROM pinned_saves
                       WHERE session_uuid = ? AND name = ? AND id != ?""",
                    (session_uuid, name, preset_id),
                )
                if cursor.fetchone():
                    if not self._persistent_conn:
                        conn.close()
                    raise ValueError(f'A preset named "{name}" already exists')
                cursor.execute(
                    """UPDATE pinned_saves
                       SET name = ?, pin_paths_json = ?, updated_at = ?
                       WHERE id = ? AND session_uuid = ?""",
                    (name, pin_paths_json, now, preset_id, session_uuid),
                )
                conn.commit()
                result = self.get_pinned_save_by_id(session_uuid, preset_id)
                if not self._persistent_conn:
                    conn.close()
                return result

        # Path 2: upsert by (session_uuid, name).
        cursor.execute(
            "SELECT id FROM pinned_saves WHERE session_uuid = ? AND name = ?",
            (session_uuid, name),
        )
        existing = cursor.fetchone()
        if existing:
            eid = existing[0]
            cursor.execute(
                """UPDATE pinned_saves
                   SET pin_paths_json = ?, updated_at = ?
                   WHERE id = ? AND session_uuid = ?""",
                (pin_paths_json, now, eid, session_uuid),
            )
            conn.commit()
            result = self.get_pinned_save_by_id(session_uuid, eid)
            if not self._persistent_conn:
                conn.close()
            return result

        # Path 3: insert new.
        new_id = str(uuid.uuid4())
        cursor.execute(
            """INSERT INTO pinned_saves
               (id, session_uuid, name, pin_paths_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (new_id, session_uuid, name, pin_paths_json, now, now),
        )
        conn.commit()
        result = self.get_pinned_save_by_id(session_uuid, new_id)
        if not self._persistent_conn:
            conn.close()
        return result

    def get_pinned_save_by_id(self, session_uuid: str, preset_id: str) -> dict:
        """Get a single pinned-save preset by id.

        Returns None if the preset does not exist or belongs to a different session.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, session_uuid, name, pin_paths_json, created_at, updated_at
               FROM pinned_saves WHERE id = ? AND session_uuid = ?""",
            (preset_id, session_uuid),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'id': row[0],
            'session_uuid': row[1],
            'name': row[2],
            'pin_paths': json.loads(row[3]) if row[3] else [],
            'created_at': row[4],
            'updated_at': row[5],
        }

    def delete_pinned_save(self, session_uuid: str, preset_id: str) -> bool:
        """Delete a pinned-save preset.

        Returns:
            True if a row was deleted, False if no matching preset was found.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM pinned_saves WHERE id = ? AND session_uuid = ?",
            (preset_id, session_uuid),
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # COLOR THEME PRESET CRUD METHODS
    # ========================================================================

    def get_color_theme_presets(self, session_uuid: str) -> list:
        """Get all color theme presets for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, line_colors, custom_colors, created_at, updated_at
            FROM color_theme_presets
            WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{
            'id': row[0], 'name': row[1],
            'lineColors': row[2],
            'customColors': json.loads(row[3]) if row[3] else None,
            'created_at': row[4], 'updated_at': row[5],
        } for row in rows]

    def save_color_theme_preset(self, session_uuid: str, name: str,
                                 line_colors: str, custom_colors,
                                 preset_id: str = None) -> dict:
        """Save or update a color theme preset (upsert by name or id)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        custom_json = json.dumps(custom_colors) if custom_colors else None

        if preset_id:
            cursor.execute("""
                SELECT id FROM color_theme_presets WHERE id = ? AND session_uuid = ?
            """, (preset_id, session_uuid))
            if cursor.fetchone():
                cursor.execute("""
                    UPDATE color_theme_presets
                    SET name = ?, line_colors = ?, custom_colors = ?, updated_at = ?
                    WHERE id = ? AND session_uuid = ?
                """, (name, line_colors, custom_json, now, preset_id, session_uuid))
                conn.commit()
                if not self._persistent_conn:
                    conn.close()
                return self._get_color_preset_by_id(session_uuid, preset_id)

        # Upsert by name
        cursor.execute("""
            SELECT id FROM color_theme_presets WHERE session_uuid = ? AND name = ?
        """, (session_uuid, name))
        existing = cursor.fetchone()
        if existing:
            cursor.execute("""
                UPDATE color_theme_presets
                SET line_colors = ?, custom_colors = ?, updated_at = ?
                WHERE id = ? AND session_uuid = ?
            """, (line_colors, custom_json, now, existing[0], session_uuid))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return self._get_color_preset_by_id(session_uuid, existing[0])

        new_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO color_theme_presets (id, session_uuid, name, line_colors, custom_colors, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, line_colors, custom_json, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return self._get_color_preset_by_id(session_uuid, new_id)

    def _get_color_preset_by_id(self, session_uuid: str, preset_id: str) -> dict:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, line_colors, custom_colors, created_at, updated_at
            FROM color_theme_presets WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'id': row[0], 'name': row[1],
            'lineColors': row[2],
            'customColors': json.loads(row[3]) if row[3] else None,
            'created_at': row[4], 'updated_at': row[5],
        }

    def delete_color_theme_preset(self, session_uuid: str, preset_id: str) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM color_theme_presets WHERE id = ? AND session_uuid = ?
        """, (preset_id, session_uuid))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # BUG REPORT CRUD METHODS
    # ========================================================================

    def record_local_speed_benchmark(self, session_uuid, count, run_ms=None,
                                     boot_ms=None, faster=None, threshold=None,
                                     user_agent=None, source=None):
        """Append a local-speed benchmark sample. Best-effort; never raises.

        Defensively creates the table if a running DB predates it.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_speed_benchmarks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_uuid TEXT,
                    count INTEGER NOT NULL,
                    run_ms REAL,
                    boot_ms REAL,
                    faster BOOLEAN,
                    threshold INTEGER,
                    user_agent TEXT,
                    source TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                INSERT INTO local_speed_benchmarks
                    (session_uuid, count, run_ms, boot_ms, faster, threshold, user_agent, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_uuid, int(count), run_ms, boot_ms,
                1 if faster else 0, threshold, user_agent, source, _utc_now()
            ))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return True
        except Exception:
            return False

    def create_bug_report(self, original_session_uuid: str, snapshot_session_uuid: str,
                          description: str, app_version: str, browser_info: str,
                          screenshots_json: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a new bug report.
        
        Args:
            original_session_uuid: Original session UUID
            snapshot_session_uuid: Snapshot session UUID (frozen state)
            description: User's description of the issue
            app_version: Application version
            browser_info: Browser information
            screenshots_json: Dictionary of tab -> base64 screenshot data
            
        Returns:
            Created bug report dictionary
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        report_id = str(uuid.uuid4())
        now = _utc_now()
        
        cursor.execute("""
            INSERT INTO bug_reports (
                id, original_session_uuid, snapshot_session_uuid, description,
                app_version, browser_info, timestamp, screenshots_json, reviewed
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (
            report_id, original_session_uuid, snapshot_session_uuid, description,
            app_version, browser_info, now, 
            json.dumps(screenshots_json) if screenshots_json else None
        ))
        
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return {
            'id': report_id,
            'original_session_uuid': original_session_uuid,
            'snapshot_session_uuid': snapshot_session_uuid,
            'description': description,
            'app_version': app_version,
            'browser_info': browser_info,
            'timestamp': now,
            'screenshots_json': screenshots_json,
            'reviewed': False,
            'reviewed_at': None,
            'reviewed_by': None,
            'notes': None
        }

    def get_bug_reports(self, reviewed: Optional[bool] = None) -> list:
        """Get all bug reports, optionally filtered by reviewed status.
        
        Args:
            reviewed: If True, only reviewed reports. If False, only unreviewed. If None, all reports.
            
        Returns:
            List of bug report dictionaries
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        if reviewed is None:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid, description,
                       app_version, browser_info, timestamp, screenshots_json,
                       reviewed, reviewed_at, reviewed_by, notes
                FROM bug_reports
                ORDER BY timestamp DESC
            """)
        else:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid, description,
                       app_version, browser_info, timestamp, screenshots_json,
                       reviewed, reviewed_at, reviewed_by, notes
                FROM bug_reports
                WHERE reviewed = ?
                ORDER BY timestamp DESC
            """, (1 if reviewed else 0,))
        
        rows = cursor.fetchall()
        
        if not self._persistent_conn:
            conn.close()
        
        reports = []
        for row in rows:
            reports.append({
                'id': row[0],
                'original_session_uuid': row[1],
                'snapshot_session_uuid': row[2],
                'description': row[3],
                'app_version': row[4],
                'browser_info': row[5],
                'timestamp': row[6],
                'screenshots_json': json.loads(row[7]) if row[7] else None,
                'reviewed': bool(row[8]),
                'reviewed_at': row[9],
                'reviewed_by': row[10],
                'notes': row[11]
            })
        
        return reports

    def get_bug_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific bug report by ID.
        
        Args:
            report_id: Bug report ID
            
        Returns:
            Bug report dictionary or None if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, original_session_uuid, snapshot_session_uuid, description,
                   app_version, browser_info, timestamp, screenshots_json,
                   reviewed, reviewed_at, reviewed_by, notes, server_logs
            FROM bug_reports
            WHERE id = ?
        """, (report_id,))
        
        row = cursor.fetchone()
        
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'id': row[0],
            'original_session_uuid': row[1],
            'snapshot_session_uuid': row[2],
            'description': row[3],
            'app_version': row[4],
            'browser_info': row[5],
            'timestamp': row[6],
            'screenshots_json': json.loads(row[7]) if row[7] else None,
            'reviewed': bool(row[8]),
            'reviewed_at': row[9],
            'reviewed_by': row[10],
            'notes': row[11],
            'server_logs': row[12]
        }

    def mark_report_reviewed(self, report_id: str, reviewed_by: str, notes: Optional[str] = None) -> bool:
        """Mark a bug report as reviewed.
        
        Args:
            report_id: Bug report ID
            reviewed_by: Name/identifier of reviewer
            notes: Optional review notes
            
        Returns:
            True if updated, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE bug_reports
            SET reviewed = 1, reviewed_at = ?, reviewed_by = ?, notes = ?,
                screenshots_json = NULL, server_logs = NULL
            WHERE id = ?
        """, (_utc_now(), reviewed_by, notes, report_id))
        
        updated = cursor.rowcount > 0
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return updated

    # ------------------------------------------------------------------
    # Bug report notes (ticket-style append-only comment chain)
    # ------------------------------------------------------------------

    def add_bug_report_note(
        self,
        report_id: str,
        author: str,
        content: str,
        thread_title: Optional[str] = None,
        parent_note_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Append a note (or threaded reply) to a bug report.

        Args:
            report_id: Bug report ID the note belongs to.
            author: Self-reported author string (e.g. 'meshclaw', 'jwbail').
            content: Markdown body of the note. Required, non-empty.
            thread_title: Optional short label so an agent can identify its
                own thread on a later visit. Replies inherit nothing
                automatically — pass it again if you want it on the reply.
            parent_note_id: If set, this note is a reply to that note.
                Must reference a note on the same report.

        Returns:
            The inserted note dict, or None if the report does not exist
            or the parent note is invalid.
        """
        if not content or not content.strip():
            return None
        if not author or not author.strip():
            return None
        conn = self._get_connection()
        cursor = conn.cursor()

        # Verify the report exists.
        cursor.execute("SELECT 1 FROM bug_reports WHERE id = ?", (report_id,))
        if not cursor.fetchone():
            if not self._persistent_conn:
                conn.close()
            return None

        # If a parent is provided, it must belong to the same report.
        if parent_note_id is not None:
            cursor.execute(
                "SELECT report_id FROM bug_report_notes WHERE id = ?",
                (parent_note_id,),
            )
            row = cursor.fetchone()
            if not row or row[0] != report_id:
                if not self._persistent_conn:
                    conn.close()
                return None

        now = _utc_now()
        cursor.execute(
            """
            INSERT INTO bug_report_notes
                (report_id, parent_note_id, author, thread_title, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (report_id, parent_note_id, author.strip(), (thread_title or None), content, now),
        )
        note_id = cursor.lastrowid
        conn.commit()

        if not self._persistent_conn:
            conn.close()

        return {
            'id': note_id,
            'report_id': report_id,
            'parent_note_id': parent_note_id,
            'author': author.strip(),
            'thread_title': thread_title or None,
            'content': content,
            'created_at': now,
        }

    def get_bug_report_notes(self, report_id: str) -> List[Dict[str, Any]]:
        """Return all notes for a bug report ordered chronologically (oldest first).

        Tree shape is up to the caller — this returns a flat list with
        parent_note_id so the UI can render replies under their parent.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, report_id, parent_note_id, author, thread_title, content, created_at
            FROM bug_report_notes
            WHERE report_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (report_id,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'id': r[0],
                'report_id': r[1],
                'parent_note_id': r[2],
                'author': r[3],
                'thread_title': r[4],
                'content': r[5],
                'created_at': r[6],
            }
            for r in rows
        ]

    def get_bug_report_note_counts(self, report_ids: List[str]) -> Dict[str, int]:
        """Batch-fetch note counts for many bug reports in a single query.

        Powers the unread-comment badge on the admin list view: the client
        compares this count to a localStorage-stored "last seen on detail
        page" count and shows the diff as a red badge.

        Returns a dict mapping report_id -> count. Reports with no notes
        are NOT in the dict (caller can default to 0).
        """
        if not report_ids:
            return {}
        conn = self._get_connection()
        cursor = conn.cursor()
        placeholders = ','.join('?' * len(report_ids))
        cursor.execute(
            f"""
            SELECT report_id, COUNT(*)
            FROM bug_report_notes
            WHERE report_id IN ({placeholders})
            GROUP BY report_id
            """,
            list(report_ids),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return {r[0]: r[1] for r in rows}

    def delete_session(self, session_uuid: str) -> bool:
        """Delete a session and all associated data (gear_sets, debug_sessions, etc).
        
        Args:
            session_uuid: Session UUID to delete
            
        Returns:
            True if session was deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Delete associated gear sets
        cursor.execute("DELETE FROM gear_sets WHERE session_uuid = ?", (session_uuid,))
        
        # Delete associated debug session entry if exists
        cursor.execute("DELETE FROM debug_sessions WHERE session_uuid = ?", (session_uuid,))
        
        # Delete associated broadcast dismissals
        cursor.execute("DELETE FROM broadcast_dismissals WHERE session_uuid = ?", (session_uuid,))
        
        # Delete associated stats report data (added 2026-05-22 with stale-detection feature)
        # Note: codebase doesn't use PRAGMA foreign_keys = ON, so FK CASCADE doesn't fire.
        # Explicit cleanup is required.
        self._reset_stats_report_data_with_cursor(cursor, session_uuid)

        # Clear active_debug_links row if this session was either side of a link.
        # When a bug-report is reviewed, the snapshot session is deleted via this
        # method — auto-clearing the link removes the swap-session nav button on
        # next main-site reload (per spec: "When the bug report is resolved
        # (snapshot is deleted), the button no longer appears on my main session").
        cursor.execute(
            "DELETE FROM active_debug_links "
            "WHERE main_session_uuid = ? OR snapshot_session_uuid = ?",
            (session_uuid, session_uuid),
        )

        # Delete the session itself
        cursor.execute("DELETE FROM sessions WHERE uuid = ?", (session_uuid,))
        deleted = cursor.rowcount > 0
        
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return deleted

    def _reset_stats_report_data_with_cursor(self, cursor, session_uuid: str) -> dict:
        """Internal: wipe all stats_report_* rows for a session using an existing cursor.
        
        Caller is responsible for commit + connection lifecycle. Used by both
        delete_session (full session deletion) and reset_stats_report_data
        (debug reset that preserves the session row).
        
        Returns counts of deleted rows per table for logging.
        """
        counts = {}
        for tbl in (
            'stats_report_results',
            'stats_report_gearsets',
            'stats_report_stale_scopes',
            'character_state_snapshot_cache',
            'stats_report_runs',
        ):
            cursor.execute(f"DELETE FROM {tbl} WHERE session_uuid = ?", (session_uuid,))
            counts[tbl] = cursor.rowcount
        return counts

    # ------------------------------------------------------------------
    # Active Debug Links (admin-managed bug-report snapshot ↔ main session)
    # ------------------------------------------------------------------
    def get_active_debug_link(self, main_session_uuid: str) -> Optional[Dict[str, Any]]:
        """Return the active debug link for a given main session, or None.

        Validates that the linked snapshot session still exists in `sessions`;
        if the snapshot row is gone (e.g. the bug-report was reviewed and its
        snapshot got hard-deleted between requests), the orphan link row is
        cleaned up here as a defensive belt-and-suspenders, and None returned.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT main_session_uuid, snapshot_session_uuid, bug_report_id, linked_at "
                "FROM active_debug_links WHERE main_session_uuid = ?",
                (main_session_uuid,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            link = dict(row) if hasattr(row, 'keys') else {
                'main_session_uuid': row[0],
                'snapshot_session_uuid': row[1],
                'bug_report_id': row[2],
                'linked_at': row[3],
            }
            # Defensive: if the snapshot session was deleted out from under us,
            # treat the link as gone and clean up.
            cursor.execute(
                "SELECT 1 FROM sessions WHERE uuid = ?",
                (link['snapshot_session_uuid'],),
            )
            if cursor.fetchone() is None:
                cursor.execute(
                    "DELETE FROM active_debug_links WHERE main_session_uuid = ?",
                    (main_session_uuid,),
                )
                conn.commit()
                return None
            return link
        finally:
            if not self._persistent_conn:
                conn.close()

    def set_active_debug_link(
        self,
        main_session_uuid: str,
        snapshot_session_uuid: str,
        bug_report_id: Optional[str] = None,
    ) -> None:
        """Create or replace the active debug link for a main session.

        Per spec: single active link at a time — POST replaces any existing
        row for the same main_session_uuid via INSERT OR REPLACE.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT OR REPLACE INTO active_debug_links "
                "(main_session_uuid, snapshot_session_uuid, bug_report_id, linked_at) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (main_session_uuid, snapshot_session_uuid, bug_report_id),
            )
            conn.commit()
        finally:
            if not self._persistent_conn:
                conn.close()

    def clear_active_debug_link(self, main_session_uuid: str) -> bool:
        """Delete the active debug link for a main session. Returns True if a row was removed."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM active_debug_links WHERE main_session_uuid = ?",
                (main_session_uuid,),
            )
            removed = cursor.rowcount > 0
            conn.commit()
            return removed
        finally:
            if not self._persistent_conn:
                conn.close()

    def is_bug_report_snapshot_session(self, session_uuid: str) -> bool:
        """Return True if session_uuid is the snapshot_session_uuid of any bug report.

        Used by the main-site nav to decide whether to show the green "swap
        back to main session" button. It shows on every bug-report snapshot
        session (so the admin is never stranded after delinking) and never on
        normal sessions. Independent of the active_debug_links table — a
        snapshot is identified by being referenced from bug_reports, not by
        being currently linked.
        """
        if not session_uuid:
            return False
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT 1 FROM bug_reports WHERE snapshot_session_uuid = ? LIMIT 1",
                (session_uuid,),
            )
            return cursor.fetchone() is not None
        finally:
            if not self._persistent_conn:
                conn.close()

    def reset_stats_report_data(self, session_uuid: str) -> dict:
        """Debug reset: wipe ALL stats_report_* rows for a session.
        
        Marks any running runs as failed first (so the worker subprocess
        will exit cleanly on its next progress write), then deletes:
        - stats_report_results (all category/subcategory rows)
        - stats_report_stale_scopes (cached stale-detector output)
        - character_state_snapshot_cache (prev-snapshot for diff)
        - stats_report_runs (run metadata, including the running one)
        
        The session row itself and all character data are untouched.
        
        Returns counts dict for logging.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Mark any running runs as failed first. This is mostly a courtesy
        # — we're about to delete all run rows anyway — but if the worker
        # subprocess is still alive it'll see status=failed on its next
        # progress write and exit. Defends against the worker re-creating
        # rows we just deleted, since stats_report_results has no FK to
        # the run.
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE session_uuid = ? AND status = 'running'
        """, (now, session_uuid))
        running_killed = cursor.rowcount
        
        counts = self._reset_stats_report_data_with_cursor(cursor, session_uuid)
        counts['running_runs_killed'] = running_killed
        
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    # Categories that own per-scope rows in the three category-scoped
    # stats_report tables. Used to validate a per-category reset request.
    STATS_REPORT_CATEGORIES = ('xp', 'new_items', 'chests', 'chests_recipes', 'coins')

    def reset_stats_report_category(self, session_uuid: str, category: str) -> dict:
        """Reset the saved goals-report data for a SINGLE category.

        Unlike reset_stats_report_data (which wipes every stats_report_*
        table for the session), this deletes only the rows belonging to
        one category from the three category-scoped tables:
        - stats_report_results        (the stored per-scope result rows)
        - stats_report_gearsets       (the stored gearsets for those rows)
        - stats_report_stale_scopes   (cached stale-detector output)

        It deliberately does NOT touch:
        - character_state_snapshot_cache: a session-level single blob the
          stale-detector diffs against for EVERY category. Wiping it would
          make all other categories look newly-changed on the next run.
        - stats_report_runs: a run spans multiple categories, so deleting
          run rows would disrupt unrelated categories from the same run.

        After this, the category has no stored results, so re-running just
        that category recomputes it fresh while every other category's
        cached results stay intact.

        Use case: one category's stored server result is stale/blank (the
        server cache diverged from a correct local recompute) and the user
        wants to clear ONLY that category without paying the cost of a full
        Emergency reset across everything.

        Returns a counts dict (rows deleted per table) for logging.
        Raises ValueError for an unknown category.
        """
        if category not in self.STATS_REPORT_CATEGORIES:
            raise ValueError(f'unknown stats_report category: {category!r}')
        conn = self._get_connection()
        cursor = conn.cursor()
        counts = {}
        for tbl in (
            'stats_report_results',
            'stats_report_gearsets',
            'stats_report_stale_scopes',
        ):
            cursor.execute(
                f"DELETE FROM {tbl} WHERE session_uuid = ? AND category = ?",
                (session_uuid, category),
            )
            counts[tbl] = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    def get_degenerate_result_scopes(self, session_uuid: str):
        """Return the set of (category, source_name) scopes whose stored
        goals-report result has a degenerate metric (metric_value <= 0).

        A stored metric of 0 (or negative) is never a valid optimization
        outcome for any goals-report category: you can't farm a chest in
        0 steps, an XP activity can't yield 0 XP/step, etc. Such a row is
        a stuck artifact from a past transient compute failure. Because
        detect_stale_scopes only flags scopes when the CHARACTER changed,
        these rows are otherwise never recomputed and get served forever
        (the only prior escape was a manual reset).

        The worker's stale-only filter unions these scopes into its
        recompute set so a normal run self-heals them. Matching is on the
        coarse (category, source_name) pair rather than the full
        (category, subcategory, source, location, service) key so a small
        drift in the worker's location/service key derivation can't cause
        the heal to silently miss (recomputing a couple extra rows for the
        same source is harmless; serving a wrong 0 forever is not).

        Returns a set of (category, source_name) tuples.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT category, source_name FROM stats_report_results "
            "WHERE session_uuid = ? AND metric_value <= 0",
            (session_uuid,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return {(r[0], r[1]) for r in rows}

    def get_degenerate_result_scope_details(self, session_uuid: str):
        """Full scope dicts for stored goals-report results whose metric is
        degenerate (metric_value <= 0).

        Like get_degenerate_result_scopes, but returns the full
        (category, subcategory, source_name, location, service) for each
        stuck 0-row so the stale-check endpoint can badge the exact WTO chip
        and list the source under "newly unlocked" in the popover. These rows
        are also unioned into the worker's recompute set, so flagging them
        stale tells the user a normal re-run will heal them.

        Returns a list of dicts.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT category, subcategory, source_name, location, service "
            "FROM stats_report_results "
            "WHERE session_uuid = ? AND metric_value <= 0",
            (session_uuid,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'category': r[0],
                'subcategory': r[1],
                'source_name': r[2],
                'location': r[3],
                'service': r[4],
            }
            for r in rows
        ]

    def copy_stats_report_data(self, src_uuid: str, dst_uuid: str) -> dict:
        """Copy goals-report (stats_report_*) state from src to dst session.

        Used by snapshot + bug-report creation so the captured session
        reproduces the goals report exactly (results, stale-badge state, and
        the prev-snapshot used for stale diffing). Copies the session-keyed
        tables only:
          - stats_report_results            (the per-scope result rows)
          - stats_report_stale_scopes       (the (!) stale-badge state)
          - character_state_snapshot_cache  (prev snapshot for stale diffing)
          - stats_report_runs               (run metadata -- REQUIRED: the
            /api/stats-report/status endpoint reads the latest run row to
            decide whether to render the copied results. Without it the
            endpoint returns status=None and the frontend never renders the
            results we copied, so the goals report is blank on the snapshot.
            See bug report 162b543e.)
          - stats_report_gearsets           (the optimized gearset per scope --
            REQUIRED: the goals report loads gear rows via
            get_stats_report_results_latest_per_scope(session_uuid), so without
            them the chests/xp/coins rows show no gearset on the snapshot even
            though the run + result rows were copied. See bug report 162b543e.)

        stats_report_runs and stats_report_gearsets both carry a GLOBAL id PK,
        so they get dedicated copies below (NOT the generic loop -- INSERT OR
        REPLACE on the same id would clobber the SOURCE session's own rows).
        gearsets are copied with a regenerated id and their run_id remapped
        onto the freshly-generated run ids.

        Generic per-table copy: reads the live column list and rewrites
        session_uuid to dst, so it stays correct as schemas evolve.
        Returns rows-copied-per-table for logging.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        counts = {}
        run_id_map = {}  # old run id -> new run id, for gearset run_id remap
        for tbl in (
            'stats_report_results',
            'stats_report_stale_scopes',
            'character_state_snapshot_cache',
        ):
            try:
                cols = [r[1] for r in cursor.execute(f"PRAGMA table_info({tbl})").fetchall()]
                if not cols or 'session_uuid' not in cols:
                    continue
                # SELECT each column by name, except session_uuid which becomes
                # the dst literal (parameterized).
                select_terms = ", ".join("?" if c == 'session_uuid' else c for c in cols)
                cursor.execute(
                    f"INSERT OR REPLACE INTO {tbl} ({', '.join(cols)}) "
                    f"SELECT {select_terms} FROM {tbl} WHERE session_uuid = ?",
                    (dst_uuid, src_uuid),
                )
                counts[tbl] = cursor.rowcount
            except Exception as e:
                counts[tbl] = f'error: {e}'
        # stats_report_runs needs a DEDICATED copy: `id` is a GLOBAL primary
        # key, so the generic loop above (which preserves id verbatim) would
        # hit a UNIQUE collision. Regenerate id per row and rewrite
        # session_uuid -> dst. Required so /api/stats-report/status reports the
        # run as complete and the frontend renders the copied results rows.
        try:
            import uuid as _uuid
            run_cols = [r[1] for r in cursor.execute(
                "PRAGMA table_info(stats_report_runs)").fetchall()]
            if run_cols and 'session_uuid' in run_cols and 'id' in run_cols:
                placeholders = ", ".join("?" for _ in run_cols)
                src_rows = cursor.execute(
                    f"SELECT {', '.join(run_cols)} FROM stats_report_runs "
                    f"WHERE session_uuid = ?",
                    (src_uuid,),
                ).fetchall()
                id_idx = run_cols.index('id')
                n = 0
                for row in src_rows:
                    new_id = str(_uuid.uuid4())
                    run_id_map[row[id_idx]] = new_id
                    vals = [
                        new_id if c == 'id'
                        else (dst_uuid if c == 'session_uuid' else v)
                        for c, v in zip(run_cols, row)
                    ]
                    cursor.execute(
                        f"INSERT OR REPLACE INTO stats_report_runs "
                        f"({', '.join(run_cols)}) VALUES ({placeholders})",
                        vals,
                    )
                    n += 1
                counts['stats_report_runs'] = n
        except Exception as e:
            counts['stats_report_runs'] = f'error: {e}'

        # stats_report_gearsets ALSO carries a global id PK (plus a run_id FK).
        # The goals report loads gear rows for a session via
        # get_stats_report_results_latest_per_scope(session_uuid), so a snapshot
        # with no gearsets shows empty gear rows for chests/xp/coins even after
        # the run + result rows were copied (bug report 162b543e). Regenerate id
        # (a verbatim copy would clobber the source row via INSERT OR REPLACE),
        # rewrite session_uuid, and remap run_id onto the new run ids above.
        try:
            import uuid as _uuid
            gs_cols = [r[1] for r in cursor.execute(
                "PRAGMA table_info(stats_report_gearsets)").fetchall()]
            if gs_cols and 'session_uuid' in gs_cols and 'id' in gs_cols:
                placeholders = ", ".join("?" for _ in gs_cols)
                src_rows = cursor.execute(
                    f"SELECT {', '.join(gs_cols)} FROM stats_report_gearsets "
                    f"WHERE session_uuid = ?",
                    (src_uuid,),
                ).fetchall()
                n = 0
                for row in src_rows:
                    rowd = dict(zip(gs_cols, row))
                    vals = []
                    for c in gs_cols:
                        if c == 'id':
                            vals.append(str(_uuid.uuid4()))
                        elif c == 'session_uuid':
                            vals.append(dst_uuid)
                        elif c == 'run_id':
                            vals.append(run_id_map.get(rowd['run_id'], rowd['run_id']))
                        else:
                            vals.append(rowd[c])
                    cursor.execute(
                        f"INSERT OR REPLACE INTO stats_report_gearsets "
                        f"({', '.join(gs_cols)}) VALUES ({placeholders})",
                        vals,
                    )
                    n += 1
                counts['stats_report_gearsets'] = n
        except Exception as e:
            counts['stats_report_gearsets'] = f'error: {e}'
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return counts

    def cleanup_reviewed_bug_report_sessions(self) -> int:
        """Delete snapshot sessions for all reviewed bug reports.
        
        Returns:
            Number of snapshot sessions deleted
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Get all snapshot session UUIDs from reviewed bug reports
        cursor.execute("""
            SELECT snapshot_session_uuid FROM bug_reports WHERE reviewed = 1
        """)
        rows = cursor.fetchall()
        
        if not self._persistent_conn:
            conn.close()
        
        deleted_count = 0
        for row in rows:
            if self.delete_session(row[0]):
                deleted_count += 1
        
        return deleted_count

    # ========================================================================
    # API ACCESS AUDIT METHODS
    # ========================================================================

    def log_api_access(self, session_uuid: str, endpoint: str, method: str,
                       user_agent: Optional[str] = None, ip_address: Optional[str] = None,
                       response_time_ms: Optional[float] = None, status_code: Optional[int] = None):
        """Log an API access event.

        Args:
            session_uuid: Session UUID making the request
            endpoint: API endpoint accessed (e.g., '/api/catalog', '/api/session')
            method: HTTP method (GET, POST, PUT, DELETE)
            user_agent: User agent string (optional)
            ip_address: IP address (optional)
            response_time_ms: Response time in milliseconds (optional)
            status_code: HTTP status code (optional)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO api_access_audit (session_uuid, endpoint, method, user_agent, ip_address, timestamp, response_time_ms, status_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_uuid, endpoint, method, user_agent, ip_address, _utc_now(), response_time_ms, status_code))

        conn.commit()

        if not self._persistent_conn:
            conn.close()

    def get_api_access_stats(self, days: int = 7) -> Dict[str, Any]:
        """Get API access statistics for the last N days.
        
        Args:
            days: Number of days to look back (default: 7)
            
        Returns:
            Dictionary with statistics:
            - total_requests: Total number of requests
            - unique_sessions: Number of unique sessions
            - requests_by_endpoint: Dict of endpoint -> count
            - requests_by_day: Dict of date -> count
            - top_sessions: List of (session_uuid, count) tuples
        """
        from datetime import timedelta
        
        conn = self._get_connection()
        cursor = conn.cursor()
        
        # Calculate cutoff date using timedelta
        cutoff = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff = cutoff - timedelta(days=days)
        cutoff_str = cutoff.isoformat()
        
        # Total requests
        cursor.execute("""
            SELECT COUNT(*) FROM api_access_audit
            WHERE timestamp >= ?
        """, (cutoff_str,))
        total_requests = cursor.fetchone()[0]
        
        # Unique sessions
        cursor.execute("""
            SELECT COUNT(DISTINCT session_uuid) FROM api_access_audit
            WHERE timestamp >= ?
        """, (cutoff_str,))
        unique_sessions = cursor.fetchone()[0]
        
        # Requests by endpoint
        cursor.execute("""
            SELECT endpoint, COUNT(*) as count
            FROM api_access_audit
            WHERE timestamp >= ?
            GROUP BY endpoint
            ORDER BY count DESC
        """, (cutoff_str,))
        requests_by_endpoint = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Requests by day
        cursor.execute("""
            SELECT DATE(timestamp) as day, COUNT(*) as count
            FROM api_access_audit
            WHERE timestamp >= ?
            GROUP BY day
            ORDER BY day DESC
        """, (cutoff_str,))
        requests_by_day = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Top sessions
        cursor.execute("""
            SELECT session_uuid, COUNT(*) as count
            FROM api_access_audit
            WHERE timestamp >= ?
            GROUP BY session_uuid
            ORDER BY count DESC
            LIMIT 10
        """, (cutoff_str,))
        top_sessions = [(row[0], row[1]) for row in cursor.fetchall()]
        
        if not self._persistent_conn:
            conn.close()
        
        return {
            'total_requests': total_requests,
            'unique_sessions': unique_sessions,
            'requests_by_endpoint': requests_by_endpoint,
            'requests_by_day': requests_by_day,
            'top_sessions': top_sessions
        }

    def get_session_api_access(self, session_uuid: str, limit: int = 100) -> list:
        """Get API access history for a specific session.
        
        Args:
            session_uuid: Session UUID to query
            limit: Maximum number of records to return (default: 100)
            
        Returns:
            List of access log dictionaries
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, session_uuid, endpoint, method, timestamp, user_agent, ip_address
            FROM api_access_audit
            WHERE session_uuid = ?
            ORDER BY timestamp DESC
            LIMIT ?
        """, (session_uuid, limit))
        
        rows = cursor.fetchall()
        
        if not self._persistent_conn:
            conn.close()
        
        logs = []
        for row in rows:
            logs.append({
                'id': row[0],
                'session_uuid': row[1],
                'endpoint': row[2],
                'method': row[3],
                'timestamp': row[4],
                'user_agent': row[5],
                'ip_address': row[6]
            })
        
        return logs
    def list_characters(self, search: str = None, limit: int = 20, offset: int = 0) -> tuple:
        """List sessions with character names and UUIDs.

        Args:
            search: Optional character name search term (LIKE %search%)
            limit: Max results per page
            offset: Pagination offset

        Returns:
            Tuple of (list of dicts with uuid/name/last_updated, total_count)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Build query — filter to sessions that have a character_config with a name
        base_where = "WHERE character_config IS NOT NULL AND json_extract(character_config, '$.name') IS NOT NULL"
        params = []

        if search:
            base_where += " AND (json_extract(character_config, '$.name') LIKE ? OR uuid LIKE ?)"
            params.append(f'%{search}%')
            params.append(f'%{search}%')

        # Get total count
        cursor.execute(f"SELECT COUNT(*) FROM sessions {base_where}", params)
        total = cursor.fetchone()[0]

        # Get page of results
        cursor.execute(f"""
            SELECT uuid, character_config, last_updated
            FROM sessions
            {base_where}
            ORDER BY last_updated DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset])

        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        results = []
        for row in rows:
            try:
                config = json.loads(row[1]) if row[1] else {}
            except (json.JSONDecodeError, TypeError):
                config = {}

            # Calculate character level from steps
            steps = config.get('steps', 0)
            char_level = self._character_level_from_steps(steps)

            # Get skill levels (convert XP to levels)
            skills_xp = config.get('skills', {})
            skill_levels = {}
            for skill_name, xp in skills_xp.items():
                skill_levels[skill_name] = self._xp_to_level(xp)

            results.append({
                'uuid': row[0],
                'name': config.get('name', 'Unknown'),
                'steps': steps,
                'last_updated': row[2],
                'character_level': char_level,
                'skill_levels': skill_levels,
                'reputation': config.get('reputation', {}),
                'achievement_points': config.get('achievement_points', 0),
                'coins': config.get('coins', 0),
            })

        return results, total

    def get_session_statistics(self) -> Dict[str, Any]:
        """Get aggregate session statistics in a single call.

        Returns:
            Dict with:
                total_sessions: int
                sessions_with_characters: int
                total_gear_sets: int
                total_bug_reports: int
                unreviewed_bug_reports: int
                active_24h: int
                active_7d: int
                top_5_recent: list of {uuid, name, steps, last_updated}
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Total sessions
        cursor.execute("SELECT COUNT(*) FROM sessions")
        total_sessions = cursor.fetchone()[0]

        # Sessions with characters (non-null character_config with a name)
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE character_config IS NOT NULL
              AND json_extract(character_config, '$.name') IS NOT NULL
        """)
        sessions_with_characters = cursor.fetchone()[0]

        # Total gear sets
        cursor.execute("SELECT COUNT(*) FROM gear_sets")
        total_gear_sets = cursor.fetchone()[0]

        # Total bug reports
        cursor.execute("SELECT COUNT(*) FROM bug_reports")
        total_bug_reports = cursor.fetchone()[0]

        # Unreviewed bug reports
        cursor.execute("SELECT COUNT(*) FROM bug_reports WHERE reviewed = 0")
        unreviewed_bug_reports = cursor.fetchone()[0]

        # Sessions active in last 24 hours
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE last_updated >= datetime('now', '-1 day')
        """)
        active_24h = cursor.fetchone()[0]

        # Sessions active in last 7 days
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE last_updated >= datetime('now', '-7 days')
        """)
        active_7d = cursor.fetchone()[0]

        # Top 5 most recently active sessions with character names
        cursor.execute("""
            SELECT uuid, character_config, last_updated
            FROM sessions
            ORDER BY last_updated DESC
            LIMIT 5
        """)
        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        top_5_recent = []
        for row in rows:
            try:
                config = json.loads(row[1]) if row[1] else {}
            except (json.JSONDecodeError, TypeError):
                config = {}

            top_5_recent.append({
                'uuid': row[0],
                'name': config.get('name', None),
                'steps': config.get('steps', 0),
                'last_updated': row[2],
            })

        return {
            'total_sessions': total_sessions,
            'sessions_with_characters': sessions_with_characters,
            'total_gear_sets': total_gear_sets,
            'total_bug_reports': total_bug_reports,
            'unreviewed_bug_reports': unreviewed_bug_reports,
            'active_24h': active_24h,
            'active_7d': active_7d,
            'top_5_recent': top_5_recent,
        }

    def get_active_sessions(self, hours: int = 24, limit: int = 10, offset: int = 0) -> tuple:
        """Get sessions active within the given time window.

        Args:
            hours: Number of hours to look back
            limit: Max results per page
            offset: Pagination offset

        Returns:
            Tuple of (list of {uuid, name, steps, last_updated}, total_count)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        time_filter = f"-{hours} hours"

        # Get total count of active sessions
        cursor.execute("""
            SELECT COUNT(*) FROM sessions
            WHERE last_updated >= datetime('now', ?)
        """, (time_filter,))
        total = cursor.fetchone()[0]

        # Get page of results
        cursor.execute("""
            SELECT uuid, character_config, last_updated
            FROM sessions
            WHERE last_updated >= datetime('now', ?)
            ORDER BY last_updated DESC
            LIMIT ? OFFSET ?
        """, (time_filter, limit, offset))

        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        results = []
        for row in rows:
            try:
                config = json.loads(row[1]) if row[1] else {}
            except (json.JSONDecodeError, TypeError):
                config = {}

            results.append({
                'uuid': row[0],
                'name': config.get('name', None),
                'steps': config.get('steps', 0),
                'last_updated': row[2],
            })

        return results, total

    # ========================================================================
    # DEBUG SESSION METHODS
    # ========================================================================

    def enable_debug_session(self, session_uuid: str, enabled_by: str) -> bool:
        """Enable debug mode for a session.

        Validates that the session exists before inserting.

        Args:
            session_uuid: UUID of the session to enable debug for
            enabled_by: Discord username who enabled it

        Returns:
            True if debug was enabled, False if session doesn't exist
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Validate session exists
        cursor.execute("SELECT uuid FROM sessions WHERE uuid = ?", (session_uuid,))
        if not cursor.fetchone():
            if not self._persistent_conn:
                conn.close()
            return False

        cursor.execute("""
            INSERT OR REPLACE INTO debug_sessions (session_uuid, enabled_at, enabled_by)
            VALUES (?, CURRENT_TIMESTAMP, ?)
        """, (session_uuid, enabled_by))
        conn.commit()

        if not self._persistent_conn:
            conn.close()
        return True

    def disable_debug_session(self, session_uuid: str) -> bool:
        """Disable debug mode for a session.

        Args:
            session_uuid: UUID of the session to disable debug for

        Returns:
            True if a record was deleted, False if none existed
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "DELETE FROM debug_sessions WHERE session_uuid = ?",
            (session_uuid,)
        )
        deleted = cursor.rowcount > 0
        conn.commit()

        if not self._persistent_conn:
            conn.close()
        return deleted

    def is_debug_enabled(self, session_uuid: str) -> bool:
        """Check if debug mode is enabled for a session.

        Args:
            session_uuid: UUID of the session to check

        Returns:
            True if debug is enabled, False otherwise
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT 1 FROM debug_sessions WHERE session_uuid = ?",
            (session_uuid,)
        )
        result = cursor.fetchone() is not None

        if not self._persistent_conn:
            conn.close()
        return result

    def list_debug_sessions(self) -> list:
        """List all sessions with debug mode enabled.

        Returns:
            List of dicts with session_uuid, enabled_at, enabled_by
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT session_uuid, enabled_at, enabled_by
            FROM debug_sessions
            ORDER BY enabled_at DESC
        """)
        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        return [
            {
                'session_uuid': row[0],
                'enabled_at': row[1],
                'enabled_by': row[2],
            }
            for row in rows
        ]

    # ========================================================================
    # FEATURE FLAG METHODS
    # ========================================================================

    # Sessions that always have travel access (hardcoded for dev/testing)
    _TRAVEL_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have crafting tree access (hardcoded for dev/testing)
    _CRAFTING_TREE_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have generic activity/recipe access
    _GENERIC_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have non-owned alternatives access
    _NON_OWNED_ALTERNATIVES_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have April Fools access (early access / dev)
    _APRIL_FOOLS_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have stats report access (hardcoded for dev/testing)
    _STATS_REPORT_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have holistic LP mode access (hardcoded for dev/testing)
    _CRAFTING_TREE_LP_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have Pin Item access (hardcoded for dev/testing)
    _PIN_ITEM_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions that always have Walkdle (daily puzzle) access (hardcoded for dev/testing)
    _WALKDLE_ALWAYS_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    # Sessions gated for the EXACT XP/step optimizer experiment (goals report)
    _EXACT_XP_OPTIMIZER_ENABLED = {'00000000-0000-0000-0000-000000000000'}

    def enable_feature(self, session_uuid: str, feature: str, enabled_by: str) -> bool:
        """Enable a feature flag for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO feature_flags (session_uuid, feature, enabled_at, enabled_by)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        """, (session_uuid, feature, enabled_by))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def disable_feature(self, session_uuid: str, feature: str) -> bool:
        """Disable a feature flag for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM feature_flags WHERE session_uuid = ? AND feature = ?",
            (session_uuid, feature)
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def has_feature(self, session_uuid: str, feature: str) -> bool:
        """Check if a session has a feature enabled (including hardcoded list)."""
        if feature == 'travel' and session_uuid in self._TRAVEL_ALWAYS_ENABLED:
            return True
        # Crafting tree is in BETA: enabled for ALL sessions (2026-05-15
        # release). The hardcoded _CRAFTING_TREE_ALWAYS_ENABLED set above
        # is kept around for the FAC admin UI but no longer gates access.
        # Users will see a dismissible "BETA" banner inside the tree view
        # explaining that things may change and saved configurations may
        # be deleted before the final release.
        if feature == 'crafting_tree':
            return True
        # Holistic LP mode also enabled for ALL sessions (2026-05-15
        # release). User decision: 'We should show holistic/LP view
        # for everyone.' Means every tree calc runs the LP solver so
        # totals reflect optimal byproduct sharing. Frontend shows
        # per-node Holistic Solver Insight strips by default.
        if feature == 'crafting_tree_lp':
            return True
        # Generic is enabled for ALL sessions (no longer feature-gated)
        if feature == 'generic':
            return True
        # 2026-06-17: Goals report (stats_report) + Local Optimization released
        # to ALL sessions (FAC removed). Mirrors the crafting_tree BETA pattern
        # above. The hardcoded _STATS_REPORT_ALWAYS_ENABLED set below is kept for
        # the FAC admin UI but no longer gates access.
        if feature == 'stats_report':
            return True
        if feature == 'local_optimization':
            return True
        if feature == 'non_owned_alternatives' and session_uuid in self._NON_OWNED_ALTERNATIVES_ENABLED:
            return True
        if feature == 'april_fools' and session_uuid in self._APRIL_FOOLS_ALWAYS_ENABLED:
            return True
        if feature == 'stats_report' and session_uuid in self._STATS_REPORT_ALWAYS_ENABLED:
            return True
        if feature == 'crafting_tree_lp' and session_uuid in self._CRAFTING_TREE_LP_ALWAYS_ENABLED:
            return True
        if feature == 'pin_item' and session_uuid in self._PIN_ITEM_ALWAYS_ENABLED:
            return True
        if feature == 'walkdle' and session_uuid in self._WALKDLE_ALWAYS_ENABLED:
            return True
        if feature == 'exact_xp_optimizer' and session_uuid in self._EXACT_XP_OPTIMIZER_ENABLED:
            return True
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM feature_flags WHERE session_uuid = ? AND feature = ?",
            (session_uuid, feature)
        )
        result = cursor.fetchone() is not None
        if not self._persistent_conn:
            conn.close()
        return result

    def has_april_fools(self, session_uuid: str) -> bool:
        """Check if April Fools UI should be shown for this session.

        The feature flag stays true all of April (so checkboxes remain visible).
        The actual enabled state is controlled by the user's toggle preferences.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        year = now.year
        window_start = datetime(year, 3, 31, 10, 0, 0, tzinfo=timezone.utc)
        window_end   = datetime(year, 4, 30, 23, 59, 59, tzinfo=timezone.utc)
        in_window = window_start <= now < window_end
        hardcoded = session_uuid in self._APRIL_FOOLS_ALWAYS_ENABLED
        return in_window or hardcoded
        return result

    def list_feature_sessions(self, feature: str) -> list:
        """List all sessions with a specific feature enabled."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT session_uuid, enabled_at, enabled_by
            FROM feature_flags WHERE feature = ?
            ORDER BY enabled_at DESC
        """, (feature,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [
            {'session_uuid': r[0], 'enabled_at': r[1], 'enabled_by': r[2]}
            for r in rows
        ]
        # Include hardcoded sessions
        hardcoded_map = {
            'travel': self._TRAVEL_ALWAYS_ENABLED,
            'crafting_tree': self._CRAFTING_TREE_ALWAYS_ENABLED,
            'generic': self._GENERIC_ALWAYS_ENABLED,
            'non_owned_alternatives': self._NON_OWNED_ALTERNATIVES_ENABLED,
            'april_fools': self._APRIL_FOOLS_ALWAYS_ENABLED,
            'stats_report': self._STATS_REPORT_ALWAYS_ENABLED,
            'crafting_tree_lp': self._CRAFTING_TREE_LP_ALWAYS_ENABLED,
            'pin_item': self._PIN_ITEM_ALWAYS_ENABLED,
            'walkdle': self._WALKDLE_ALWAYS_ENABLED,
        }
        hardcoded_uuids = hardcoded_map.get(feature, set())
        for hc_uuid in hardcoded_uuids:
            if not any(r['session_uuid'] == hc_uuid for r in results):
                results.insert(0, {
                    'session_uuid': hc_uuid,
                    'enabled_at': 'always',
                    'enabled_by': 'hardcoded',
                })
        return results

    # ========================================================================
    # WALKDLE (DAILY PUZZLE) METHODS
    # ========================================================================

    def get_walkdle_attempt(self, session_uuid: str, puzzle_date: str, mode: str) -> Optional[dict]:
        """Return the saved attempt state dict for a (session, date, mode), or None."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT state_json, created_at, updated_at FROM daily_puzzle_attempts
               WHERE session_uuid = ? AND puzzle_date = ? AND mode = ?""",
            (session_uuid, puzzle_date, mode),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        try:
            state = json.loads(row[0]) if row[0] else {}
        except (ValueError, TypeError):
            state = {}
        return {'state': state, 'created_at': row[1], 'updated_at': row[2]}

    def upsert_walkdle_attempt(self, session_uuid: str, puzzle_date: str, mode: str, state: dict) -> bool:
        """Insert or update the saved attempt state for a (session, date, mode)."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO daily_puzzle_attempts (session_uuid, puzzle_date, mode, state_json, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(session_uuid, puzzle_date, mode)
               DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP""",
            (session_uuid, puzzle_date, mode, json.dumps(state)),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def sync_walkdle_first_seen(self, item_ids, launch_date: str, today: str) -> dict:
        """Record first-seen dates for walkdle items; return the full {id: date} map.

        On first population (empty table) ALL given ids are backfilled to
        `launch_date` (they all existed at launch). Afterwards, any id not
        already recorded is inserted with `today`. Existing rows are never
        changed, so an item's first_seen is permanent once set.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT item_id, first_seen FROM walkdle_item_first_seen")
        existing = {row[0]: row[1] for row in cursor.fetchall()}
        backfill = not existing
        rows_to_add = []
        for iid in item_ids:
            if iid in existing:
                continue
            rows_to_add.append((iid, launch_date if backfill else today))
        if rows_to_add:
            cursor.executemany(
                "INSERT OR IGNORE INTO walkdle_item_first_seen (item_id, first_seen) VALUES (?, ?)",
                rows_to_add,
            )
            conn.commit()
        result = dict(existing)
        for iid, d in rows_to_add:
            result.setdefault(iid, d)
        if not self._persistent_conn:
            conn.close()
        return result

    def list_walkdle_attempts(self, session_uuid: str, mode: str) -> list:
        """List all saved attempts for a session+mode (for the calendar)."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT puzzle_date, state_json FROM daily_puzzle_attempts
               WHERE session_uuid = ? AND mode = ?
               ORDER BY puzzle_date""",
            (session_uuid, mode),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        out = []
        for r in rows:
            try:
                state = json.loads(r[1]) if r[1] else {}
            except (ValueError, TypeError):
                state = {}
            out.append({'puzzle_date': r[0], 'state': state})
        return out

    def walkdle_day_stats(self, puzzle_date: str, mode: str) -> dict:
        """Aggregate the guess-count distribution for a (puzzle_date, mode).

        Returns {total, solved, failed, histogram} across every session that
        finished (solved or failed) that puzzle, plus a per-difficulty breakdown
        for hard / normal / easy (each a SUBSET of the totals). Difficulty is
        resolved per attempt:
          - easy   : advanced filters were used (easy_mode is not False, which
                     also captures pre-feature attempts with no easy_mode key)
          - normal : not easy AND the Show-stats assist was used (stats_used)
          - hard   : neither assist (easy_mode explicitly False, no stats_used)
        `histogram` maps a solve guess-count to how many players solved in
        exactly that many; histogram_{hard,normal,easy} are the same per tier.
        """
        import json

        def _resolve_mode(st):
            if st.get('easy_mode') is not False:  # True or missing -> easy
                return 'easy'
            if st.get('stats_used'):
                return 'normal'
            return 'hard'

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT state_json FROM daily_puzzle_attempts WHERE puzzle_date = ? AND mode = ?",
            (puzzle_date, mode),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        solved = 0
        failed = 0
        histogram = {}
        per = {m: {'solved': 0, 'failed': 0, 'histogram': {}} for m in ('hard', 'normal', 'easy')}
        for (sj,) in rows:
            try:
                st = json.loads(sj) if sj else {}
            except (ValueError, TypeError):
                st = {}
            m = _resolve_mode(st)
            if st.get('solved'):
                solved += 1
                n = len(st.get('guesses') or [])
                histogram[n] = histogram.get(n, 0) + 1
                per[m]['solved'] += 1
                per[m]['histogram'][n] = per[m]['histogram'].get(n, 0) + 1
            elif st.get('failed'):
                failed += 1
                per[m]['failed'] += 1
        out = {'total': solved + failed, 'solved': solved, 'failed': failed, 'histogram': histogram}
        for m in ('hard', 'normal', 'easy'):
            out[f'solved_{m}'] = per[m]['solved']
            out[f'failed_{m}'] = per[m]['failed']
            out[f'total_{m}'] = per[m]['solved'] + per[m]['failed']
            out[f'histogram_{m}'] = per[m]['histogram']
        return out

    # ========================================================================
    # STATS REPORT METHODS
    # ========================================================================

    @staticmethod
    def _row_to_dict(cursor, row):
        """Convert a sqlite3 row to a dict using cursor.description for column names."""
        if row is None:
            return None
        return {cursor.description[i][0]: row[i] for i in range(len(row))}

    def get_stats_report_run(self, run_id: str) -> dict:
        """Get a single stats report run by ID."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stats_report_runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        d = self._row_to_dict(cursor, row)
        d['categories'] = json.loads(d['categories'])
        d['skills'] = json.loads(d['skills'])
        return d

    def get_latest_stats_report_run(self, session_uuid: str) -> dict:
        """Get the most recent stats report run for a session."""
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM stats_report_runs
            WHERE session_uuid = ?
            ORDER BY started_at DESC
            LIMIT 1
        """, (session_uuid,))
        row = cursor.fetchone()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        d = {desc[i][0]: row[i] for i in range(len(row))}
        d['categories'] = json.loads(d['categories'])
        d['skills'] = json.loads(d['skills'])
        return d

    def get_stats_report_results_v2(self, session_uuid: str) -> dict:
        """Read stats_report_results (new schema) grouped by category and subcategory."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT category, subcategory, source_name, location, service,
                   rank, metric_value, metric_name, export_string,
                   optimization_version, extras_json, computed_at
            FROM stats_report_results
            WHERE session_uuid = ?
            ORDER BY category, subcategory, metric_value DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        out = {}
        for row in rows:
            (cat, sub, src, loc, svc, rank, mv, mn, exp, ver, extras, computed) = row
            cat_dict = out.setdefault(cat, {})
            sub_list = cat_dict.setdefault(sub, [])
            extras_obj = None
            if extras:
                try:
                    import json
                    extras_obj = json.loads(extras)
                except Exception:
                    pass
            sub_list.append({
                'source_name': src,
                'location': loc,
                'service': svc,
                'rank': rank,
                'metric_value': mv,
                'metric_name': mn,
                'export_string': exp,
                'optimization_version': ver,
                'extras': extras_obj,
                'computed_at': computed,
            })
        return out

    def get_stats_report_results(self, run_id: str) -> dict:
        """Get all results for a run, grouped by category and sorted by metric_value.
        
        For 'xp' and 'coins' categories, sorts descending (higher is better).
        For 'new_items' and 'chests' categories, sorts ascending (lower is better).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM stats_report_gearsets
            WHERE run_id = ?
            ORDER BY category, metric_value
        """, (run_id,))
        rows = cursor.fetchall()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        
        results = {}
        for row in rows:
            d = {desc[i][0]: row[i] for i in range(len(row))}
            cat = d['category']
            if cat not in results:
                results[cat] = []
            results[cat].append(d)
        
        # Sort each category correctly: descending for xp/coins, ascending for new_items/chests
        for cat, items in results.items():
            reverse = cat in ('xp', 'coins')
            results[cat] = sorted(
                [r for r in items if r['metric_value'] is not None],
                key=lambda r: r['metric_value'],
                reverse=reverse
            )
        
        return results

    def get_stats_report_results_latest_per_scope(self, session_uuid: str) -> dict:
        """Get the latest gearset result PER SCOPE across ALL of a session's runs,
        grouped + sorted like get_stats_report_results.

        Why: each run gets a fresh run_id and job rows use random ids, so a
        stale_only re-run only writes rows for the stale/newly-unlocked
        scopes. Reading WHERE run_id = latest then drops every unchanged
        scope, blanking the report. Reading by SESSION and keeping the
        newest row per scope makes the report ADDITIVE — a re-run updates
        the changed scopes in place and leaves the rest intact.

        Scope key = (category, activity_name, skill_name, chest_name) — the
        same tuple that uniquely identifies a job/row (xp uses skill_name,
        chests use chest_name, new_items carries the kind in skill_name).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        # ASC so later (newer) rows overwrite earlier ones in the dedupe map.
        cursor.execute("""
            SELECT * FROM stats_report_gearsets
            WHERE session_uuid = ?
            ORDER BY created_at ASC
        """, (session_uuid,))
        rows = cursor.fetchall()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()

        by_scope = {}
        for row in rows:
            d = {desc[i][0]: row[i] for i in range(len(row))}
            key = (d.get('category'), d.get('activity_name'),
                   d.get('skill_name'), d.get('chest_name'))
            by_scope[key] = d  # newest wins (ASC order)

        results = {}
        for d in by_scope.values():
            results.setdefault(d['category'], []).append(d)

        for cat, items in results.items():
            reverse = cat in ('xp', 'coins')
            results[cat] = sorted(
                [r for r in items if r['metric_value'] is not None],
                key=lambda r: r['metric_value'],
                reverse=reverse
            )
        return results

    def get_stats_report_gearset(self, result_id: str) -> dict:
        """Get a single stats report gearset result by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM stats_report_gearsets WHERE id = ?", (result_id,))
        row = cursor.fetchone()
        desc = cursor.description
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {desc[i][0]: row[i] for i in range(len(row))}

    def create_stats_report_gearset(self, result_id: str, run_id: str, session_uuid: str,
                                     category: str, activity_name: str, skill_name: str,
                                     chest_name: str, metric_value: float, metric_name: str,
                                     gearset_export: str, job_status: str = 'complete',
                                     error_message: str = None,
                                     metrics_json=None) -> bool:
        """Create a stats report gearset result row.

        ``metrics_json`` is an optional dict (or pre-serialized JSON string)
        with the optimizer's metric breakdown — used by the frontend for
        steps-to-next-level calc and the Secondary XP popover. Older rows
        written before the metrics_json column existed will have NULL here
        and the frontend gracefully degrades.
        """
        import json as _json
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        if metrics_json is not None and not isinstance(metrics_json, str):
            try:
                metrics_json = _json.dumps(metrics_json)
            except Exception:
                metrics_json = None
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO stats_report_gearsets
                (id, run_id, session_uuid, category, activity_name, skill_name, chest_name,
                 metric_value, metric_name, gearset_export, job_status, error_message,
                 metrics_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (result_id, run_id, session_uuid, category, activity_name, skill_name, chest_name,
              metric_value, metric_name, gearset_export, job_status, error_message,
              metrics_json, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def create_stats_report_result(
        self,
        session_uuid: str,
        category: str,
        subcategory: str,
        source_name: str,
        location: str,
        service: str,
        rank: int,
        metric_value: float,
        metric_name: str,
        export_string: str,
        dominance_bitmap: bytes,
        metric_inputs_hash: str,
        optimization_version: int,
        extras_json: str = None,
    ) -> bool:
        """Insert-or-replace a stats_report_results row.

        extras_json is optional auxiliary data per row. Initial use:
        chip-row data for new_items rows (T17). Rows that don't need extras
        leave it NULL.
        """
        import time
        now = int(time.time())
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO stats_report_results
                (session_uuid, category, subcategory, source_name, location, service,
                 rank, metric_value, metric_name, export_string,
                 dominance_bitmap, metric_inputs_hash, optimization_version, extras_json, computed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_uuid, category, subcategory, source_name, location, service,
              rank, metric_value, metric_name, export_string,
              dominance_bitmap, metric_inputs_hash, optimization_version, extras_json, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def prune_orphaned_new_items_results(self, session_uuid: str,
                                         valid_scopes, kinds) -> int:
        """Delete stale new_items result rows whose (source_name, subcategory)
        scope is no longer produced by build_new_items_jobs.

        The new_items report is stored additively (INSERT OR REPLACE per
        scope) and read additively (latest-per-scope), with no run scoping.
        So once an activity stops yielding an unowned drop of a given kind
        (e.g. the user hatches/obtains the pet, so its egg is now owned),
        the previously-written row is never overwritten *and never deleted*
        — it lingers forever (bug 01797bdb: a Tiger egg row from a stale run
        kept showing even though the user owns the tiger pet). This reconciles
        the stored rows against the freshly-built valid scope set.

        Args:
            session_uuid: the live session whose rows to reconcile.
            valid_scopes: iterable of (source_name, subcategory) tuples that
                build_new_items_jobs produced this run (the authoritative set
                of currently-valid new_items scopes, BEFORE stale filtering).
            kinds: the subcategories (kinds) actually built this run. Pruning
                is restricted to these so a kind-filtered run (e.g. gear-only)
                never deletes valid rows of kinds it didn't recompute.

        Returns the number of rows deleted.

        Reconciles BOTH backing tables:
          * stats_report_results  — read by get_stats_report_results_v2 and
            the stale-detection layer.
          * stats_report_gearsets — read by get_stats_report_results_latest_
            per_scope, which is what /api/stats-report/results (the goals
            report display) actually returns. Local (Pyodide) optimization
            writes its fast rows here via /api/stats-report/local-scope, so a
            gearset-only orphan (bug 6c68245b: "Sticky finger shorts" gear row
            lingering after the user obtained the item) is invisible to a
            results-only prune. Both tables key new_items scopes on
            (activity/source name, kind) so the same valid set applies.
        """
        kinds = {(k or '').lower() for k in (kinds or []) if k}
        if not kinds:
            return 0
        valid = {((s or ''), (k or '').lower()) for (s, k) in (valid_scopes or set())}
        conn = self._get_connection()
        cursor = conn.cursor()
        placeholders = ','.join('?' for _ in kinds)
        sorted_kinds = sorted(kinds)
        deleted = 0

        # stats_report_results: scope = (source_name, subcategory)
        cursor.execute(
            "SELECT rowid, source_name, subcategory FROM stats_report_results "
            "WHERE session_uuid = ? AND category = 'new_items' "
            "AND lower(subcategory) IN (" + placeholders + ")",
            (session_uuid, *sorted_kinds),
        )
        results_orphans = [
            rowid for (rowid, src, sub) in cursor.fetchall()
            if ((src or ''), (sub or '').lower()) not in valid
        ]
        if results_orphans:
            cursor.executemany(
                "DELETE FROM stats_report_results WHERE rowid = ?",
                [(rid,) for rid in results_orphans],
            )
            deleted += len(results_orphans)

        # stats_report_gearsets: scope = (activity_name, skill_name=kind)
        cursor.execute(
            "SELECT rowid, activity_name, skill_name FROM stats_report_gearsets "
            "WHERE session_uuid = ? AND category = 'new_items' "
            "AND lower(skill_name) IN (" + placeholders + ")",
            (session_uuid, *sorted_kinds),
        )
        gearset_orphans = [
            rowid for (rowid, act, kind) in cursor.fetchall()
            if ((act or ''), (kind or '').lower()) not in valid
        ]
        if gearset_orphans:
            cursor.executemany(
                "DELETE FROM stats_report_gearsets WHERE rowid = ?",
                [(rid,) for rid in gearset_orphans],
            )
            deleted += len(gearset_orphans)

        if deleted:
            conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def create_stats_report_run(self, session_uuid: str, run_id: str, categories: list,
                                 skills: list, total_jobs: int, notify_on_complete: bool) -> bool:
        """Create a new stats report run record."""
        import json
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO stats_report_runs
                (id, session_uuid, categories, skills, total_jobs, completed_jobs, failed_jobs,
                 status, notify_on_complete, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, 0, 0, 'running', ?, ?, ?)
        """, (run_id, session_uuid, json.dumps(categories), json.dumps(skills),
              total_jobs, 1 if notify_on_complete else 0, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def mark_running_runs_interrupted(self) -> int:
        """Flip ALL `running` stats-report runs on this DB to `interrupted`.

        Used by the @app.on_event("shutdown") graceful-shutdown hook.
        Mirrors what the user-initiated /api/stats-report/cancel does
        for one session, but ranges over every active run because we're
        about to take the entire container down.

        The 'interrupted' status (vs 'failed') tells the orphan-resume
        sweeper on the NEXT container start "this run was cleanly
        suspended by a deploy, not abandoned by the user — please
        resume it". get_orphan_runs already includes 'interrupted' in
        its WHERE clause, so the resume path picks them up automatically
        without further changes.

        Combined with _kill_all_stats_report_workers in app.py and a
        bumped docker compose stop_grace_period, this gives an in-flight
        worker time to finish its current job and write a result row
        before the container is SIGKILL'd. The new container then
        resumes from where the old one left off via stale-detection.

        Returns:
            int — number of run rows flipped.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'interrupted',
                last_progress_at = ?
            WHERE status = 'running'
        """, (now,))
        rows = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return rows

    def cancel_stats_report_run(self, session_uuid: str) -> dict:
        """Mark the session's currently-running stats-report run as failed.

        Used by /api/stats-report/cancel — non-destructive cancellation
        that preserves all stats_report_results / stale-scope / snapshot
        data (unlike reset_stats_report_data which wipes everything).

        The status flip lets a still-alive worker subprocess notice on
        its next progress write that the run is no longer 'running' and
        self-terminate via os._exit(0) (see worker.execute_job's
        get_stats_report_run check). Combined with
        _kill_stats_report_worker_for_session sending SIGTERM up front,
        this guarantees the worker stops within ~1 job (~20s) even if
        SIGTERM is missed.

        Returns:
            {'cancelled_run_id': <uuid or None>, 'rows_updated': int}
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM stats_report_runs "
            "WHERE session_uuid = ? AND status = 'running' "
            "ORDER BY started_at DESC LIMIT 1",
            (session_uuid,),
        )
        row = cursor.fetchone()
        cancelled_run_id = row[0] if row else None
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE session_uuid = ? AND status = 'running'
        """, (now, session_uuid))
        rows_updated = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {
            'cancelled_run_id': cancelled_run_id,
            'rows_updated': rows_updated,
        }

    def update_stats_report_progress(self, run_id: str, success: bool) -> bool:
        """Atomically increment completed_jobs or failed_jobs for a run.
        
        Also writes last_progress_at (added 2026-05-22 for auto-resume) so
        the orphan-sweeper can tell "abandoned hours ago" from "container
        just restarted". The timestamp is best-effort — if the schema
        is older and lacks the column, the UPDATE silently no-ops on
        that field.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        if success:
            cursor.execute("""
                UPDATE stats_report_runs
                SET completed_jobs = completed_jobs + 1,
                    last_progress_at = ?
                WHERE id = ?
            """, (now, run_id))
        else:
            cursor.execute("""
                UPDATE stats_report_runs
                SET failed_jobs = failed_jobs + 1,
                    last_progress_at = ?
                WHERE id = ?
            """, (now, run_id))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def get_orphan_runs(self, max_age_hours: int = 24, max_resume_count: int = 3) -> list:
        """Return runs that should be respawned at app startup.
        
        An "orphan" is a stats_report_runs row whose worker subprocess was
        killed (by container restart, OOM, etc.) leaving the row stuck at
        status='running' or status='interrupted'.
        
        Filters:
        - status IN ('running', 'interrupted')
        - started_at within last max_age_hours (skip ancient stale rows —
          user has moved on)
        - resume_count < max_resume_count (skip runaway respawn loops)
        - last_progress_at within last max_age_hours OR NULL (NULL means
          worker died before writing any progress, still resumable)
        
        See ui/app.py::_resume_orphan_runs for the caller.
        """
        import json
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
        conn = self._get_connection()
        # _get_connection() doesn't set row_factory, so cursor.fetchall()
        # returns plain tuples by default. The dict(r) below requires Row
        # objects (which support keys()). Set the factory locally so we
        # don't change behavior for other callers of _get_connection.
        prev_row_factory = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, session_uuid, categories, skills, total_jobs,
                       completed_jobs, failed_jobs, status, notify_on_complete,
                       started_at, resume_count, last_progress_at
                FROM stats_report_runs
                WHERE status IN ('running', 'interrupted')
                  AND started_at >= ?
                  AND COALESCE(resume_count, 0) < ?
                  AND (last_progress_at IS NULL OR last_progress_at >= ?)
                ORDER BY started_at ASC
            """, (cutoff, max_resume_count, cutoff))
            rows = cursor.fetchall()
        finally:
            conn.row_factory = prev_row_factory
        if not self._persistent_conn:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d['categories'] = json.loads(d['categories']) if d.get('categories') else []
            except Exception:
                d['categories'] = []
            try:
                d['skills'] = json.loads(d['skills']) if d.get('skills') else []
            except Exception:
                d['skills'] = []
            out.append(d)
        return out

    def increment_resume_count(self, run_id: str) -> int:
        """Increment resume_count for a run. Returns the new value.
        
        Called by the orphan-sweeper before respawning a worker so the
        next iteration can detect runaway respawn loops (e.g., worker
        crashes on the same job every time → after N attempts, give up
        and mark failed).
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET resume_count = COALESCE(resume_count, 0) + 1
            WHERE id = ?
        """, (run_id,))
        cursor.execute("SELECT resume_count FROM stats_report_runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        # row is a plain tuple — _get_connection() doesn't set row_factory
        # to sqlite3.Row, so use index access. row[0] is resume_count.
        new_count = row[0] if row else 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return new_count

    def mark_run_interrupted(self, run_id: str) -> bool:
        """Flip a run to status='interrupted' (clean shutdown sentinel).
        
        Called by the worker's SIGTERM handler so the new container's
        startup sweep knows we exited cleanly (not crashed). Either way
        the run gets resumed — this is purely diagnostic.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'interrupted', last_progress_at = ?
            WHERE id = ? AND status = 'running'
        """, (now, run_id))
        ok = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return ok

    def fail_resume_exhausted_runs(self, max_resume_count: int = 3) -> int:
        """Mark runs that hit the resume-count cap as permanently failed.
        
        Called once at app startup AFTER respawning healthy orphans, to
        clean up rows that have been resumed too many times (likely a
        worker crashing on the same job). Returns count of rows flipped.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE status IN ('running', 'interrupted')
              AND COALESCE(resume_count, 0) >= ?
        """, (now, max_resume_count))
        n = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def fail_abandoned_runs(self, max_age_hours: int = 24) -> int:
        """Mark runs older than max_age_hours as failed (user moved on).
        
        Called at app startup to clean up rows that won't be resumed
        because they're too old. Without this they'd stay at status=
        'running' forever and continue blocking new runs via the
        existing_run check in /api/stats-report/run.
        """
        from datetime import datetime, timezone, timedelta
        now_dt = datetime.now(timezone.utc)
        cutoff = (now_dt - timedelta(hours=max_age_hours)).isoformat()
        now = now_dt.isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'failed', completed_at = ?
            WHERE status IN ('running', 'interrupted')
              AND started_at < ?
        """, (now, cutoff))
        n = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return n

    def complete_stats_report_run(self, run_id: str, inventory_fingerprint: str = None) -> bool:
        """Mark a run as complete with timestamp.

        inventory_fingerprint param is retained for backward compat with
        existing callers but is now a no-op since the column was dropped
        in 20260522_120001 (replaced by per-row dominance_bitmap +
        metric_inputs_hash on stats_report_results).
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        # 2026-07-11 (bug 30add94e): reconcile total_jobs up to completed_jobs.
        # A local (Pyodide) run's server-side stale PRECOUNT can undercount how
        # many scopes the browser actually runs (the browser's resume-skip
        # identity doesn't always match the server stale set), so completed_jobs
        # can overshoot total_jobs (observed 9 completed vs 5 total). That
        # corrupt count pins the progress bar into its "completed >= total"
        # ("Finishing…") branch, shows a nonsense "9/5" run summary, and — via
        # the /local-scope self-finalize firing at completed>=total — flips the
        # run to complete BEFORE the browser posts its last scopes, so the
        # client renders a PARTIAL report. Clamping total up to completed at
        # every finalize keeps the record coherent (you can never complete more
        # jobs than exist). MAX() only ever raises total, never lowers it, so
        # server runs (completed == total) and correct local runs are unchanged.
        cursor.execute("""
            UPDATE stats_report_runs
            SET status = 'complete', completed_at = ?,
                total_jobs = MAX(total_jobs, completed_jobs)
            WHERE id = ?
        """, (now, run_id))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def compute_inventory_fingerprint(self, session_uuid: str) -> str:
        """Compute a SHA-256 fingerprint of the session's current item ownership state.
        
        The fingerprint is a hash of sorted (item_id, has, hide, quality) tuples,
        derived from character_config.items (has/quality) and ui_config.items (hide).
        Returns a hex digest string.
        """
        import hashlib
        import json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT character_config, ui_config FROM sessions WHERE uuid = ?",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row or not row[0]:
            return hashlib.sha256(b'').hexdigest()
        
        try:
            char_config = json.loads(row[0]) if row[0] else {}
            ui_config = json.loads(row[1]) if row[1] else {}
        except (json.JSONDecodeError, TypeError):
            return hashlib.sha256(b'').hexdigest()
        
        char_items = char_config.get('items', {}) if isinstance(char_config, dict) else {}
        ui_items = ui_config.get('items', {}) if isinstance(ui_config, dict) else {}
        
        # Collect all item IDs from both configs
        all_item_ids = set(char_items.keys()) | set(ui_items.keys())
        
        canonical = sorted(
            (
                item_id,
                bool(char_items.get(item_id, {}).get('has', False) if isinstance(char_items.get(item_id), dict) else False),
                bool(ui_items.get(item_id, {}).get('hide', False) if isinstance(ui_items.get(item_id), dict) else False),
                str(char_items.get(item_id, {}).get('quality', '') if isinstance(char_items.get(item_id), dict) else '')
            )
            for item_id in all_item_ids
        )
        payload = json.dumps(canonical, separators=(',', ':'))
        return hashlib.sha256(payload.encode()).hexdigest()

    def mark_stats_report_runs_stale(self, session_uuid: str) -> int:
        """Mark all completed stats report runs as stale if inventory has changed.
        
        Computes the current inventory fingerprint and compares against stored fingerprints.
        Sets is_stale=1 on any run where the fingerprint differs.
        Returns the number of runs marked stale.
        """
        new_fingerprint = self.compute_inventory_fingerprint(session_uuid)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE stats_report_runs
            SET is_stale = 1
            WHERE session_uuid = ?
              AND status = 'complete'
              AND inventory_fingerprint IS NOT NULL
              AND inventory_fingerprint != ?
        """, (session_uuid, new_fingerprint))
        count = cursor.rowcount
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return count

    def merge_stats_report_jobs(self, run_id: str, new_jobs: list) -> int:
        """Add new pending jobs to an existing run and increment total_jobs.
        
        new_jobs is a list of dicts with keys:
            id, category, activity_name, skill_name, chest_name, session_uuid
        
        If a (skill_name, category) or (activity_name, category) pair already exists
        in the run with status='complete', it is overwritten and refreshed_at is set.
        
        Returns the number of new job rows inserted.
        """
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        conn = self._get_connection()
        cursor = conn.cursor()
        
        inserted = 0
        for job in new_jobs:
            # Check if a result already exists for this (category, skill_name/activity_name)
            existing_id = None
            if job.get('skill_name'):
                cursor.execute("""
                    SELECT id FROM stats_report_gearsets
                    WHERE run_id = ? AND category = ? AND skill_name = ?
                """, (run_id, job['category'], job['skill_name']))
            elif job.get('activity_name'):
                cursor.execute("""
                    SELECT id FROM stats_report_gearsets
                    WHERE run_id = ? AND category = ? AND activity_name = ?
                """, (run_id, job['category'], job['activity_name']))
            else:
                cursor.execute("""
                    SELECT id FROM stats_report_gearsets
                    WHERE run_id = ? AND category = ? AND chest_name = ?
                """, (run_id, job['category'], job.get('chest_name')))
            
            row = cursor.fetchone()
            if row:
                # Overwrite existing result — reset to pending and set refreshed_at
                cursor.execute("""
                    UPDATE stats_report_gearsets
                    SET job_status = 'pending', metric_value = NULL, metric_name = NULL,
                        gearset_export = NULL, error_message = NULL, refreshed_at = ?
                    WHERE id = ?
                """, (now, row[0]))
            else:
                # Insert new pending row
                cursor.execute("""
                    INSERT INTO stats_report_gearsets
                        (id, run_id, session_uuid, category, activity_name, skill_name,
                         chest_name, job_status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """, (job['id'], run_id, job['session_uuid'], job['category'],
                      job.get('activity_name'), job.get('skill_name'),
                      job.get('chest_name'), now))
                inserted += 1
        
        # Increment total_jobs by the number of new (non-overwrite) jobs
        if inserted > 0:
            cursor.execute("""
                UPDATE stats_report_runs
                SET total_jobs = total_jobs + ?, status = 'running'
                WHERE id = ?
            """, (inserted, run_id))
        elif new_jobs:
            # All were overwrites — still set status back to running
            cursor.execute("""
                UPDATE stats_report_runs SET status = 'running' WHERE id = ?
            """, (run_id,))
        
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return inserted

    # ========================================================================
    # TARGETED BROADCAST METHODS
    # ========================================================================

    def create_targeted_broadcast(self, message: str, session_uuids: list, created_by: str,
                                   send_push: bool = False, push_title: str = None, push_message: str = None) -> Dict[str, Any]:
        """Create a targeted broadcast visible only to specific sessions.

        Args:
            message: Broadcast message text
            session_uuids: List of session UUIDs that can see this broadcast
            created_by: Discord username who created it
            send_push: Whether to send a push notification for this broadcast
            push_title: Optional push notification title (defaults to "Walkscape Optimizer")
            push_message: Optional push notification body (short blurb)

        Returns:
            Dict with broadcast data
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()

        broadcast_id = str(uuid.uuid4())
        uuids_json = _json.dumps(session_uuids)
        cursor.execute("""
            INSERT INTO targeted_broadcasts (id, message, session_uuids, created_at, created_by, active, send_push, push_title, push_message)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
        """, (broadcast_id, message, uuids_json, created_by, 1 if send_push else 0, push_title, push_message))
        conn.commit()

        cursor.execute(
            "SELECT id, message, session_uuids, created_at, created_by, active, send_push, push_title, push_message FROM targeted_broadcasts WHERE id = ?",
            (broadcast_id,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': row[0],
            'message': row[1],
            'session_uuids': _json.loads(row[2]),
            'created_at': row[3],
            'created_by': row[4],
            'active': bool(row[5]),
            'send_push': bool(row[6]),
            'push_title': row[7],
            'push_message': row[8],
        }

    def get_targeted_broadcasts_for_session(self, session_uuid: str) -> list:
        """Get all active targeted broadcasts that include this session UUID.

        Args:
            session_uuid: The session to check

        Returns:
            List of broadcast dicts
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, session_uuids, created_at, created_by
            FROM targeted_broadcasts
            WHERE active = 1
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        results = []
        for row in rows:
            uuids = _json.loads(row[2])
            if session_uuid in uuids:
                results.append({
                    'id': row[0],
                    'message': row[1],
                    'session_uuids': uuids,
                    'created_at': row[3],
                    'created_by': row[4],
                })
        return results

    def clear_targeted_broadcast(self, broadcast_id: str) -> bool:
        """Deactivate a targeted broadcast by ID.

        Returns:
            True if a record was updated, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE targeted_broadcasts SET active = 0 WHERE id = ? AND active = 1",
            (broadcast_id,)
        )
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def add_uuids_to_targeted_broadcast(self, broadcast_id: str, new_uuids: list) -> Optional[Dict[str, Any]]:
        """Add session UUIDs to an existing active targeted broadcast.

        Returns:
            Updated broadcast dict, or None if not found
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, message, session_uuids FROM targeted_broadcasts WHERE id = ? AND active = 1",
            (broadcast_id,)
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return None

        existing = _json.loads(row[2])
        merged = list(dict.fromkeys(existing + new_uuids))
        cursor.execute(
            "UPDATE targeted_broadcasts SET session_uuids = ? WHERE id = ?",
            (_json.dumps(merged), broadcast_id)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {'id': row[0], 'message': row[1], 'session_uuids': merged}

    def list_targeted_broadcasts(self, active_only: bool = True) -> list:
        """List targeted broadcasts.

        Args:
            active_only: If True, only return active broadcasts

        Returns:
            List of broadcast dicts
        """
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()

        if active_only:
            cursor.execute("""
                SELECT id, message, session_uuids, created_at, created_by, active
                FROM targeted_broadcasts WHERE active = 1
                ORDER BY created_at DESC
            """)
        else:
            cursor.execute("""
                SELECT id, message, session_uuids, created_at, created_by, active
                FROM targeted_broadcasts
                ORDER BY created_at DESC LIMIT 20
            """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        return [
            {
                'id': r[0],
                'message': r[1],
                'session_uuids': _json.loads(r[2]),
                'created_at': r[3],
                'created_by': r[4],
                'active': bool(r[5]),
            }
            for r in rows
        ]

    # ========================================================================
    # SESSION GROUP METHODS
    # ========================================================================

    def create_group(self, name: str, created_by: str) -> Dict[str, Any]:
        """Create a new empty session group."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO session_groups (name, session_uuids, created_at, created_by)
            VALUES (?, '[]', CURRENT_TIMESTAMP, ?)
        """, (name.upper(), created_by))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {'name': name.upper(), 'session_uuids': [], 'created_by': created_by}

    def add_to_group(self, name: str, session_uuids: list) -> bool:
        """Add session UUIDs to a group. Creates group if it doesn't exist."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        name = name.upper()

        cursor.execute("SELECT session_uuids FROM session_groups WHERE name = ?", (name,))
        row = cursor.fetchone()
        if row:
            existing = _json.loads(row[0])
        else:
            existing = []
            cursor.execute("""
                INSERT INTO session_groups (name, session_uuids, created_at, created_by)
                VALUES (?, '[]', CURRENT_TIMESTAMP, 'auto')
            """, (name,))

        # Merge without duplicates
        merged = list(dict.fromkeys(existing + session_uuids))
        cursor.execute(
            "UPDATE session_groups SET session_uuids = ? WHERE name = ?",
            (_json.dumps(merged), name)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def remove_from_group(self, name: str, session_uuids: list) -> bool:
        """Remove session UUIDs from a group."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        name = name.upper()

        cursor.execute("SELECT session_uuids FROM session_groups WHERE name = ?", (name,))
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False

        existing = _json.loads(row[0])
        remove_set = set(session_uuids)
        updated = [u for u in existing if u not in remove_set]
        cursor.execute(
            "UPDATE session_groups SET session_uuids = ? WHERE name = ?",
            (_json.dumps(updated), name)
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    def get_group(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a session group by name."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT name, session_uuids, created_at, created_by FROM session_groups WHERE name = ?",
            (name.upper(),)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {
            'name': row[0],
            'session_uuids': _json.loads(row[1]),
            'created_at': row[2],
            'created_by': row[3],
        }

    def list_groups(self) -> list:
        """List all session groups."""
        import json as _json
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name, session_uuids, created_at, created_by FROM session_groups ORDER BY name")
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'name': r[0],
                'session_uuids': _json.loads(r[1]),
                'created_at': r[2],
                'created_by': r[3],
            }
            for r in rows
        ]

    def delete_group(self, name: str) -> bool:
        """Delete a session group."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM session_groups WHERE name = ?", (name.upper(),))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def get_group_members_with_names(self, name: str) -> list:
        """Get group members with their character names."""
        import json as _json
        group = self.get_group(name)
        if not group:
            return []

        conn = self._get_connection()
        cursor = conn.cursor()
        results = []
        for uuid in group['session_uuids']:
            cursor.execute("SELECT character_config FROM sessions WHERE uuid = ?", (uuid,))
            row = cursor.fetchone()
            char_name = 'Unknown'
            if row and row[0]:
                try:
                    config = json.loads(row[0])
                    char_name = config.get('name', 'Unknown')
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append({'uuid': uuid, 'name': char_name})

        if not self._persistent_conn:
            conn.close()
        return results

    # ========================================================================
    # BROADCAST METHODS
    # ========================================================================

    def create_broadcast(self, message: str, created_by: str, valid_from: str = None, valid_until: str = None,
                         send_push: bool = False, push_title: str = None, push_message: str = None) -> Dict[str, Any]:
        """Create a new broadcast, deactivating any existing active broadcast.

        Args:
            message: Broadcast message text
            created_by: Discord username who created it
            valid_from: Optional ISO UTC timestamp — broadcast hidden before this time
            valid_until: Optional ISO UTC timestamp — broadcast hidden after this time
            send_push: Whether to send a push notification for this broadcast
            push_title: Optional push notification title (defaults to "Walkscape Optimizer")
            push_message: Optional push notification body (short blurb)

        Returns:
            Dict with broadcast id, message, created_at, created_by, active, valid_from, valid_until, send_push, push_title, push_message
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Deactivate existing active broadcasts
        cursor.execute("UPDATE broadcasts SET active = 0 WHERE active = 1")

        broadcast_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO broadcasts (id, message, created_at, created_by, active, valid_from, valid_until, send_push, push_title, push_message)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?, ?, ?)
        """, (broadcast_id, message, created_by, valid_from, valid_until, 1 if send_push else 0, push_title, push_message))
        conn.commit()

        cursor.execute(
            "SELECT id, message, created_at, created_by, active, valid_from, valid_until, send_push, push_title, push_message FROM broadcasts WHERE id = ?",
            (broadcast_id,)
        )
        row = cursor.fetchone()

        if not self._persistent_conn:
            conn.close()

        return {
            'id': row[0],
            'message': row[1],
            'created_at': row[2],
            'created_by': row[3],
            'active': bool(row[4]),
            'valid_from': row[5],
            'valid_until': row[6],
            'send_push': bool(row[7]),
            'push_title': row[8],
            'push_message': row[9],
        }

    def clear_broadcast(self) -> bool:
        """Deactivate all active broadcasts.

        Returns:
            True if any broadcast was deactivated, False if none were active
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("UPDATE broadcasts SET active = 0 WHERE active = 1")
        changed = cursor.rowcount > 0
        conn.commit()

        if not self._persistent_conn:
            conn.close()
        return changed

    def get_active_broadcast(self) -> Optional[Dict[str, Any]]:
        """Get the currently active broadcast, respecting valid_from/valid_until schedule.

        Returns:
            Dict with broadcast data or None if no active/scheduled broadcast
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, created_at, created_by, active, valid_from, valid_until
            FROM broadcasts
            WHERE active = 1
              AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
              AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP)
            ORDER BY created_at DESC
            LIMIT 1
        """)
        row = cursor.fetchone()

        if not self._persistent_conn:
            conn.close()

        if not row:
            return None

        return {
            'id': row[0],
            'message': row[1],
            'created_at': row[2],
            'created_by': row[3],
            'active': bool(row[4]),
            'valid_from': row[5],
            'valid_until': row[6],
        }

    def dismiss_broadcast(self, broadcast_id: str, session_uuid: str) -> bool:
        """Record a broadcast dismissal for a session.

        Handles duplicate dismissals gracefully (idempotent).

        Args:
            broadcast_id: ID of the broadcast being dismissed
            session_uuid: UUID of the session dismissing it

        Returns:
            True on success (including duplicate dismissal)
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("""
                INSERT INTO broadcast_dismissals (broadcast_id, session_uuid, dismissed_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (broadcast_id, session_uuid))
            conn.commit()
        except sqlite3.IntegrityError:
            # Duplicate dismissal — that's fine, idempotent
            pass

        if not self._persistent_conn:
            conn.close()
        return True

    def get_broadcast_dismissal_count(self, broadcast_id: str) -> int:
        """Get the number of sessions that have dismissed a broadcast.

        Args:
            broadcast_id: ID of the broadcast

        Returns:
            Count of dismissals
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT COUNT(*) FROM broadcast_dismissals WHERE broadcast_id = ?",
            (broadcast_id,)
        )
        count = cursor.fetchone()[0]

        if not self._persistent_conn:
            conn.close()
        return count

    def list_broadcasts(self, limit: int = 50) -> list:
        """List all broadcasts ordered by creation date descending.

        Args:
            limit: Max number of broadcasts to return

        Returns:
            List of dicts with id, message, created_at, created_by, active, valid_from, valid_until
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, created_at, created_by, active, valid_from, valid_until
            FROM broadcasts
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()

        if not self._persistent_conn:
            conn.close()

        return [
            {
                'id': row[0],
                'message': row[1],
                'created_at': row[2],
                'created_by': row[3],
                'active': bool(row[4]),
                'valid_from': row[5],
                'valid_until': row[6],
            }
            for row in rows
        ]

    # ========================================================================
    # SESSION SNAPSHOT METHODS
    # ========================================================================

    def create_snapshot(self, original_uuid: str, description: str = None,
                        created_by: str = 'admin') -> Optional[Dict[str, Any]]:
        """Create a snapshot of a session (copies character_config, ui_config, gear_sets, feature_flags).

        Args:
            original_uuid: UUID of the session to snapshot
            description: Optional description
            created_by: Who created the snapshot

        Returns:
            Dict with snapshot info, or None if original session not found
        """
        session = self.get_session(original_uuid)
        if not session:
            return None

        # Create snapshot session with new UUID
        snapshot_uuid = str(uuid.uuid4())
        self.create_session(snapshot_uuid)

        # Copy character_config and ui_config
        if session.get('character_config'):
            self.update_character_config(snapshot_uuid, session['character_config'])
        if session.get('ui_config'):
            self.update_ui_config(snapshot_uuid, session['ui_config'])

        # Copy owned items + inventory value to the snapshot. Without this the
        # snapshot session has an empty inventory, so "Export Config" run on a
        # snapshot exports no owned items, and the goals-report / crafting
        # optimizer produces no results when a reviewer runs it. get_session
        # returns all_items_raw as the RAW json string (or None);
        # update_all_items_raw re-serialises a dict, so parse it back first.
        raw_items = session.get('all_items_raw')
        if raw_items:
            try:
                items_dict = json.loads(raw_items) if isinstance(raw_items, str) else raw_items
                self.update_all_items_raw(snapshot_uuid, items_dict)
            except Exception:
                pass
        inv_value = session.get('inventory_value')
        if inv_value is not None:
            try:
                self.update_inventory_value(snapshot_uuid, inv_value)
            except Exception:
                pass

        # Copy gear sets
        gear_sets = self.get_gear_sets(original_uuid)
        for gs in gear_sets:
            self.create_gear_set(
                session_uuid=snapshot_uuid,
                name=gs['name'],
                slots_json=gs['slots_json'],
                is_optimized=gs.get('is_optimized', False),
                export_string=gs.get('export_string'),
            )

        # Copy feature flags
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT feature, enabled_by FROM feature_flags WHERE session_uuid = ?",
            (original_uuid,)
        )
        for row in cursor.fetchall():
            self.enable_feature(snapshot_uuid, row[0], f"snapshot-of-{row[1]}")

        # Copy the goals-report (stats_report_*) state so the snapshot
        # reproduces the report exactly (results + stale badges + prev snapshot).
        try:
            self.copy_stats_report_data(original_uuid, snapshot_uuid)
        except Exception as _e:
            pass

        # Record the snapshot
        snapshot_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO session_snapshots (id, original_session_uuid, snapshot_session_uuid,
                                           description, created_at, created_by)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        """, (snapshot_id, original_uuid, snapshot_uuid, description, created_by))
        conn.commit()

        if not self._persistent_conn:
            conn.close()

        return {
            'id': snapshot_id,
            'original_session_uuid': original_uuid,
            'snapshot_session_uuid': snapshot_uuid,
            'description': description,
            'created_by': created_by,
        }

    def list_snapshots(self, original_uuid: str = None) -> list:
        """List session snapshots, optionally filtered by original session.

        Args:
            original_uuid: If provided, only snapshots of this session

        Returns:
            List of snapshot dicts
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        if original_uuid:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid,
                       description, created_at, created_by
                FROM session_snapshots
                WHERE original_session_uuid = ?
                ORDER BY created_at DESC
            """, (original_uuid,))
        else:
            cursor.execute("""
                SELECT id, original_session_uuid, snapshot_session_uuid,
                       description, created_at, created_by
                FROM session_snapshots
                ORDER BY created_at DESC
            """)

        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        return [
            {
                'id': r[0],
                'original_session_uuid': r[1],
                'snapshot_session_uuid': r[2],
                'description': r[3],
                'created_at': r[4],
                'created_by': r[5],
            }
            for r in rows
        ]

    def delete_snapshot(self, snapshot_id: str) -> bool:
        """Delete a snapshot and its associated session data.

        Args:
            snapshot_id: Snapshot record ID

        Returns:
            True if deleted
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT snapshot_session_uuid FROM session_snapshots WHERE id = ?",
            (snapshot_id,)
        )
        row = cursor.fetchone()
        if not row:
            if not self._persistent_conn:
                conn.close()
            return False

        snapshot_uuid = row[0]

        # Delete the snapshot record
        cursor.execute("DELETE FROM session_snapshots WHERE id = ?", (snapshot_id,))
        conn.commit()

        if not self._persistent_conn:
            conn.close()

        # Delete the snapshot session and all its data
        self.delete_session(snapshot_uuid)
        return True



    # ========================================================================
    # GENERIC DEFINITIONS (Activities, Recipes, Services)
    # ========================================================================

    # --- Generic Activities ---

    def save_generic_activity(self, session_uuid: str, name: str, skill: str,
                              location: str, base_steps: int, base_xp: float,
                              max_efficiency: float, required_level: int = 1,
                              is_public: bool = True, source: str = None,
                              icon: str = '⚡', contributed_by: str = None,
                              requirements_json: str = '{}',
                              icon_color: str = None,
                              secondary_xp_json: str = '{}') -> dict:
        """Save a new generic activity definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_activities
                (id, session_uuid, name, skill, location, base_steps, base_xp,
                 max_efficiency, required_level, is_public, source, icon, contributed_by,
                 requirements_json, icon_color, secondary_xp_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, skill, location, base_steps, base_xp,
              max_efficiency, required_level, 1 if is_public else 0, source, icon,
              contributed_by, requirements_json, icon_color, secondary_xp_json, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'skill': skill, 'location': location, 'base_steps': base_steps,
            'base_xp': base_xp, 'max_efficiency': max_efficiency,
            'required_level': required_level, 'is_public': is_public,
            'source': source, 'icon': icon, 'icon_color': icon_color,
            'contributed_by': contributed_by,
            'requirements_json': requirements_json,
            'secondary_xp_json': secondary_xp_json,
            'created_at': now, 'updated_at': now
        }

    def get_generic_activities_by_session(self, session_uuid: str) -> list:
        """Get all generic activities for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, base_steps, base_xp,
                   max_efficiency, required_level, is_public, source, created_at, updated_at,
                   icon, contributed_by, requirements_json, icon_color, secondary_xp_json
            FROM generic_activities WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_activity(r) for r in rows]

    def get_public_generic_activities(self) -> list:
        """Get all public generic activities (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, base_steps, base_xp,
                   max_efficiency, required_level, is_public, source, created_at, updated_at,
                   icon, contributed_by, requirements_json, icon_color, secondary_xp_json
            FROM generic_activities WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_activity(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_activity(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic activity.

        Accepts keyword args for any updatable column (name, skill, location,
        base_steps, base_xp, max_efficiency, required_level, is_public, source).

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'skill', 'location', 'base_steps', 'base_xp',
                    'max_efficiency', 'required_level', 'is_public', 'source', 'icon',
                    'contributed_by', 'requirements_json', 'icon_color', 'secondary_xp_json'}
        return self._update_generic('generic_activities', session_uuid, def_id, allowed, kwargs)

    def delete_generic_activity(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic activity. Returns True if deleted."""
        return self._delete_generic('generic_activities', session_uuid, def_id)

    # --- Generic Recipes ---

    def save_generic_recipe(self, session_uuid: str, name: str, skill: str,
                            base_steps: int, base_xp: float, max_efficiency: float,
                            required_level: int = 1, service_id: str = None,
                            is_public: bool = True, source: str = None,
                            icon: str = '⚡', contributed_by: str = None,
                            is_quality_item: bool = False,
                            requirements_json: str = '{}',
                            icon_color: str = None) -> dict:
        """Save a new generic recipe definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_recipes
                (id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                 required_level, service_id, is_public, source, icon, contributed_by,
                 is_quality_item, requirements_json, icon_color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, skill, base_steps, base_xp,
              max_efficiency, required_level, service_id,
              1 if is_public else 0, source, icon, contributed_by,
              1 if is_quality_item else 0, requirements_json, icon_color, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'skill': skill, 'base_steps': base_steps, 'base_xp': base_xp,
            'max_efficiency': max_efficiency, 'required_level': required_level,
            'service_id': service_id, 'is_public': is_public,
            'source': source, 'icon': icon, 'icon_color': icon_color,
            'contributed_by': contributed_by,
            'created_at': now, 'updated_at': now
        }

    def get_generic_recipes_by_session(self, session_uuid: str) -> list:
        """Get all generic recipes for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                   required_level, service_id, is_public, source, created_at, updated_at,
                   icon, contributed_by, is_quality_item, requirements_json, icon_color
            FROM generic_recipes WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_recipe(r) for r in rows]

    def get_public_generic_recipes(self) -> list:
        """Get all public generic recipes (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                   required_level, service_id, is_public, source, created_at, updated_at,
                   icon, contributed_by, is_quality_item, requirements_json, icon_color
            FROM generic_recipes WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_recipe(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_recipe(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic recipe.

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'skill', 'base_steps', 'base_xp', 'max_efficiency',
                    'required_level', 'service_id', 'is_public', 'source', 'contributed_by',
                    'is_quality_item', 'requirements_json', 'icon_color'}
        return self._update_generic('generic_recipes', session_uuid, def_id, allowed, kwargs)

    def delete_generic_recipe(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic recipe. Returns True if deleted."""
        return self._delete_generic('generic_recipes', session_uuid, def_id)

    # --- Generic Services ---

    def save_generic_service(self, session_uuid: str, name: str, skill: str,
                             location: str, stats_json: str = '{}',
                             is_public: bool = True, source: str = None,
                             icon: str = '⚡', contributed_by: str = None,
                             tier: str = 'basic', icon_color: str = None) -> dict:
        """Save a new generic service definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_services
                (id, session_uuid, name, skill, location, stats_json,
                 is_public, source, icon, contributed_by, tier, icon_color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, skill, location, stats_json,
              1 if is_public else 0, source, icon, contributed_by, tier, icon_color, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'skill': skill, 'location': location, 'tier': tier,
            'stats': json.loads(stats_json) if isinstance(stats_json, str) else stats_json,
            'is_public': is_public, 'source': source, 'icon': icon,
            'icon_color': icon_color, 'contributed_by': contributed_by,
            'created_at': now, 'updated_at': now
        }

    def get_generic_services_by_session(self, session_uuid: str) -> list:
        """Get all generic services for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, stats_json,
                   is_public, source, created_at, updated_at, icon, contributed_by, tier, icon_color
            FROM generic_services WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_service(r) for r in rows]

    def get_public_generic_services(self) -> list:
        """Get all public generic services (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, skill, location, stats_json,
                   is_public, source, created_at, updated_at, icon, contributed_by, tier, icon_color
            FROM generic_services WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_service(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_service(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic service.

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'skill', 'location', 'stats_json', 'is_public', 'source',
                    'contributed_by', 'icon', 'tier', 'icon_color'}
        return self._update_generic('generic_services', session_uuid, def_id, allowed, kwargs)

    def delete_generic_service(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic service. Returns True if deleted."""
        return self._delete_generic('generic_services', session_uuid, def_id)

    # --- Generic Items ---

    def save_generic_item(self, session_uuid: str, name: str, icon: str = '⚡',
                          icon_color: str = None, slot: str = None,
                          keywords: str = '[]', stats_json: str = '{}',
                          quality_stats_json: str = None, rarity: str = 'common',
                          is_crafted: bool = False, is_public: bool = True,
                          source: str = None, contributed_by: str = None,
                          export_item_name: str = None,
                          duration: int = 1000,
                          value: int = 0,
                          quality_values_json: str = None,
                          gated_stats_json: str = '{}',
                          icon_path: str = None,
                          gear_set_export: str = None,
                          data_status: str = None) -> dict:
        """Save a new generic item definition."""
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        new_id = str(uuid.uuid4())

        cursor.execute("""
            INSERT INTO generic_items
                (id, session_uuid, name, icon, icon_color, slot, keywords,
                 stats_json, quality_stats_json, rarity, is_crafted, is_public,
                 source, contributed_by, export_item_name, duration,
                 value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_id, session_uuid, name, icon, icon_color, slot, keywords,
              stats_json, quality_stats_json, rarity, 1 if is_crafted else 0,
              1 if is_public else 0, source, contributed_by, export_item_name,
              duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

        return {
            'id': new_id, 'session_uuid': session_uuid, 'name': name,
            'icon': icon, 'icon_color': icon_color, 'slot': slot,
            'keywords': json.loads(keywords) if isinstance(keywords, str) else keywords,
            'stats': json.loads(stats_json) if isinstance(stats_json, str) else stats_json,
            'quality_stats': json.loads(quality_stats_json) if isinstance(quality_stats_json, str) and quality_stats_json else quality_stats_json,
            'rarity': rarity, 'is_crafted': bool(is_crafted),
            'is_public': is_public, 'source': source,
            'contributed_by': contributed_by,
            'export_item_name': export_item_name,
            'gear_set_export': gear_set_export,
            'data_status': data_status,
            'duration': duration,
            'value': value,
            'quality_values': json.loads(quality_values_json) if isinstance(quality_values_json, str) and quality_values_json else quality_values_json,
            'gated_stats': json.loads(gated_stats_json) if isinstance(gated_stats_json, str) and gated_stats_json else {},
            'icon_path': icon_path,
            'created_at': now, 'updated_at': now
        }

    def get_generic_items_by_session(self, session_uuid: str) -> list:
        """Get all generic items for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                   stats_json, quality_stats_json, rarity, is_crafted, is_public,
                   source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
            FROM generic_items WHERE session_uuid = ?
            ORDER BY updated_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [self._row_to_generic_item(r) for r in rows]

    def get_generic_item_by_id(self, item_id: str) -> Optional[dict]:
        """Get a single generic item by its ID (any session)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                   stats_json, quality_stats_json, rarity, is_crafted, is_public,
                   source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
            FROM generic_items WHERE id = ?
        """, (item_id,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return self._row_to_generic_item(row) if row else None

    def get_public_generic_items(self) -> list:
        """Get all public generic items (community list, no session_uuid exposed)."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                   stats_json, quality_stats_json, rarity, is_crafted, is_public,
                   source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
            FROM generic_items WHERE is_public = 1
            ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        results = [self._row_to_generic_item(r) for r in rows]
        for r in results:
            r.pop('session_uuid', None)
        return results

    def update_generic_item(self, session_uuid: str, def_id: str, **kwargs) -> bool:
        """Update fields on an existing generic item.

        Returns:
            True if a row was updated.
        """
        allowed = {'name', 'icon', 'icon_color', 'slot', 'keywords', 'stats_json',
                    'quality_stats_json', 'rarity', 'is_crafted', 'is_public', 'source',
                    'contributed_by', 'export_item_name', 'gear_set_export', 'data_status', 'duration',
                    'value', 'quality_values_json', 'gated_stats_json', 'icon_path'}
        return self._update_generic('generic_items', session_uuid, def_id, allowed, kwargs)

    def delete_generic_item(self, session_uuid: str, def_id: str) -> bool:
        """Delete a generic item. Returns True if deleted."""
        return self._delete_generic('generic_items', session_uuid, def_id)

    # --- Sharing toggle (works for all types) ---

    def toggle_generic_sharing(self, session_uuid: str, def_type: str,
                               def_id: str, is_public: bool) -> bool:
        """Toggle the is_public flag on a generic definition.

        Args:
            session_uuid: Owner session
            def_type: 'activity', 'recipe', or 'service'
            def_id: Definition UUID
            is_public: New sharing state

        Returns:
            True if updated.
        """
        table_map = {
            'activity': 'generic_activities',
            'recipe': 'generic_recipes',
            'service': 'generic_services',
            'item': 'generic_items',
        }
        table = table_map.get(def_type)
        if not table:
            return False

        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute(f"""
            UPDATE {table} SET is_public = ?, updated_at = ?
            WHERE id = ? AND session_uuid = ?
        """, (1 if is_public else 0, now, def_id, session_uuid))
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    # --- Get single generic definition by id ---

    def get_generic_definition(self, def_type: str, def_id: str) -> Optional[dict]:
        """Get a single generic definition by type and id.

        Args:
            def_type: 'activity', 'recipe', 'service', or 'item'
            def_id: Definition UUID

        Returns:
            Definition dict or None if not found.
        """
        table_map = {
            'activity': 'generic_activities',
            'recipe': 'generic_recipes',
            'service': 'generic_services',
            'item': 'generic_items',
        }
        table = table_map.get(def_type)
        if not table:
            return None

        conn = self._get_connection()
        cursor = conn.cursor()

        if def_type == 'activity':
            cursor.execute("""
                SELECT id, session_uuid, name, skill, location, base_steps, base_xp,
                       max_efficiency, required_level, is_public, source, created_at, updated_at,
                       icon, contributed_by, requirements_json, icon_color, secondary_xp_json
                FROM generic_activities WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_activity(row) if row else None

        elif def_type == 'recipe':
            cursor.execute("""
                SELECT id, session_uuid, name, skill, base_steps, base_xp, max_efficiency,
                       required_level, service_id, is_public, source, created_at, updated_at,
                       icon, contributed_by, is_quality_item, requirements_json, icon_color
                FROM generic_recipes WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_recipe(row) if row else None

        elif def_type == 'item':
            cursor.execute("""
                SELECT id, session_uuid, name, icon, icon_color, slot, keywords,
                       stats_json, quality_stats_json, rarity, is_crafted, is_public,
                       source, contributed_by, created_at, updated_at, export_item_name, duration, value, quality_values_json, gated_stats_json, icon_path, gear_set_export, data_status
                FROM generic_items WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_item(row) if row else None

        else:  # service
            cursor.execute("""
                SELECT id, session_uuid, name, skill, location, stats_json,
                       is_public, source, created_at, updated_at, icon, contributed_by, tier
                FROM generic_services WHERE id = ?
            """, (def_id,))
            row = cursor.fetchone()
            if not self._persistent_conn:
                conn.close()
            return self._row_to_generic_service(row) if row else None

    # --- Private helpers for generic definitions ---

    def _row_to_generic_activity(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'skill': row[3], 'location': row[4], 'base_steps': row[5],
            'base_xp': row[6], 'max_efficiency': row[7],
            'required_level': row[8], 'is_public': bool(row[9]),
            'source': row[10], 'created_at': row[11], 'updated_at': row[12]
        }
        if len(row) > 13:
            d['icon'] = row[13] or '⚡'
        else:
            d['icon'] = '⚡'
        if len(row) > 14:
            d['contributed_by'] = row[14]
        else:
            d['contributed_by'] = None
        if len(row) > 15:
            d['requirements_json'] = row[15] or '{}'
        else:
            d['requirements_json'] = '{}'
        if len(row) > 16:
            d['icon_color'] = row[16]
        else:
            d['icon_color'] = None
        if len(row) > 17:
            d['secondary_xp_json'] = row[17] or '{}'
        else:
            d['secondary_xp_json'] = '{}'
        return d

    def _row_to_generic_recipe(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'skill': row[3], 'base_steps': row[4], 'base_xp': row[5],
            'max_efficiency': row[6], 'required_level': row[7],
            'service_id': row[8], 'is_public': bool(row[9]),
            'source': row[10], 'created_at': row[11], 'updated_at': row[12]
        }
        if len(row) > 13:
            d['icon'] = row[13] or '⚡'
        else:
            d['icon'] = '⚡'
        if len(row) > 14:
            d['contributed_by'] = row[14]
        else:
            d['contributed_by'] = None
        if len(row) > 15:
            d['is_quality_item'] = bool(row[15])
        else:
            d['is_quality_item'] = False
        if len(row) > 16:
            d['requirements_json'] = row[16] or '{}'
        else:
            d['requirements_json'] = '{}'
        if len(row) > 17:
            d['icon_color'] = row[17]
        else:
            d['icon_color'] = None
        return d

    def _row_to_generic_service(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'skill': row[3], 'location': row[4],
            'stats': json.loads(row[5]) if row[5] else {},
            'is_public': bool(row[6]), 'source': row[7],
            'created_at': row[8], 'updated_at': row[9]
        }
        if len(row) > 10:
            d['icon'] = row[10] or '⚡'
        else:
            d['icon'] = '⚡'
        if len(row) > 11:
            d['contributed_by'] = row[11]
        else:
            d['contributed_by'] = None
        if len(row) > 12:
            d['tier'] = row[12] or 'basic'
        else:
            d['tier'] = 'basic'
        if len(row) > 13:
            d['icon_color'] = row[13]
        else:
            d['icon_color'] = None
        return d

    def _row_to_generic_item(self, row) -> dict:
        d = {
            'id': row[0], 'session_uuid': row[1], 'name': row[2],
            'icon': row[3] or '⚡', 'icon_color': row[4],
            'slot': row[5],
            'keywords': json.loads(row[6]) if row[6] else [],
            'stats': json.loads(row[7]) if row[7] else {},
            'quality_stats': json.loads(row[8]) if row[8] else None,
            'rarity': row[9], 'is_crafted': bool(row[10]),
            'is_public': bool(row[11]), 'source': row[12],
            'contributed_by': row[13],
            'created_at': row[14], 'updated_at': row[15]
        }
        if len(row) > 16:
            d['export_item_name'] = row[16]
        else:
            d['export_item_name'] = None
        if len(row) > 17:
            d['duration'] = row[17] or 1000
        else:
            d['duration'] = 1000
        if len(row) > 18:
            d['value'] = row[18] or 0
        else:
            d['value'] = 0
        if len(row) > 19:
            d['quality_values'] = json.loads(row[19]) if row[19] else None
        else:
            d['quality_values'] = None
        if len(row) > 20:
            d['gated_stats'] = json.loads(row[20]) if row[20] else {}
        else:
            d['gated_stats'] = {}
        if len(row) > 21:
            d['icon_path'] = row[21]
        else:
            d['icon_path'] = None
        if len(row) > 22:
            d['gear_set_export'] = row[22]
        else:
            d['gear_set_export'] = None
        if len(row) > 23:
            d['data_status'] = row[23]
        else:
            d['data_status'] = None
        return d

    # --- Generic Keywords ---

    def get_all_custom_keywords(self) -> list:
        """Get all custom keywords (user-created, not from wiki). Case-insensitive dedup."""
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            # Deduplicate by LOWER(name), keeping the most recently created entry
            cursor.execute("""
                SELECT id, name, banned, icon, contributed_by, source, created_at, icon_color
                FROM generic_keywords
                WHERE id IN (
                    SELECT id FROM generic_keywords g1
                    WHERE created_at = (
                        SELECT MAX(created_at) FROM generic_keywords g2
                        WHERE LOWER(g2.name) = LOWER(g1.name)
                    )
                    GROUP BY LOWER(name)
                )
                ORDER BY name COLLATE NOCASE
            """)
            rows = cursor.fetchall()
        except Exception:
            rows = []
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'name': r[1], 'banned': bool(r[2]), 'icon': r[3] or '🏷️',
                 'contributed_by': r[4], 'source': r[5], 'created_at': r[6],
                 'icon_color': r[7] if len(r) > 7 else None} for r in rows]

    def save_custom_keyword(self, name: str, icon: str = '🏷️', banned: bool = True,
                            contributed_by: str = None, icon_color: str = None) -> dict:
        """Save a new custom keyword. Case-insensitive dedup. Returns the saved keyword dict."""
        import uuid as _uuid
        new_id = str(_uuid.uuid4())
        now = _utc_now()
        conn = self._get_connection()
        cursor = conn.cursor()
        # Check for case-insensitive duplicate
        cursor.execute("SELECT id, name, icon, icon_color FROM generic_keywords WHERE LOWER(name) = LOWER(?)", (name,))
        existing = cursor.fetchone()
        if existing:
            # Update icon/color if changed
            cursor.execute("UPDATE generic_keywords SET icon = ?, icon_color = ?, updated_at = ? WHERE id = ?",
                           (icon, icon_color, now, existing[0]))
            conn.commit()
            if not self._persistent_conn:
                conn.close()
            return {'id': existing[0], 'name': existing[1], 'banned': banned, 'icon': icon,
                    'icon_color': icon_color, 'contributed_by': contributed_by, 'created_at': now}
        cursor.execute("""
            INSERT INTO generic_keywords (id, name, banned, icon, icon_color, contributed_by, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
        """, (new_id, name, 1 if banned else 0, icon, icon_color, contributed_by, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return {'id': new_id, 'name': name, 'banned': banned, 'icon': icon,
                'icon_color': icon_color, 'contributed_by': contributed_by, 'created_at': now}

    def delete_custom_keyword(self, keyword_id: str) -> bool:
        """Delete a custom keyword by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM generic_keywords WHERE id = ? AND source IS NULL", (keyword_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def _update_generic(self, table: str, session_uuid: str, def_id: str,
                        allowed: set, kwargs: dict) -> bool:
        """Generic update helper for generic definition tables."""
        fields = {k: v for k, v in kwargs.items() if k in allowed}
        if not fields:
            return False

        # Convert is_public bool to int for SQLite
        if 'is_public' in fields:
            fields['is_public'] = 1 if fields['is_public'] else 0
        if 'is_crafted' in fields:
            fields['is_crafted'] = 1 if fields['is_crafted'] else 0

        fields['updated_at'] = _utc_now()

        # JSON-serialize any list/dict values for SQLite storage
        import json as _json
        for k, v in fields.items():
            if isinstance(v, (list, dict)):
                fields[k] = _json.dumps(v)

        set_clause = ', '.join(f'{k} = ?' for k in fields)
        values = list(fields.values()) + [def_id, session_uuid]

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            UPDATE {table} SET {set_clause} WHERE id = ? AND session_uuid = ?
        """, values)
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def _delete_generic(self, table: str, session_uuid: str, def_id: str) -> bool:
        """Generic delete helper for generic definition tables."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            DELETE FROM {table} WHERE id = ? AND session_uuid = ?
        """, (def_id, session_uuid))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # PUSH SUBSCRIPTION CRUD METHODS
    # ========================================================================

    def upsert_push_subscription(self, session_uuid: str, endpoint: str, p256dh: str, auth: str) -> None:
        """Insert or replace a push subscription keyed by endpoint.

        Args:
            session_uuid: Session UUID that owns this subscription
            endpoint: Push endpoint URL (unique key)
            p256dh: P-256 Diffie-Hellman public key
            auth: Authentication secret
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            INSERT INTO push_subscriptions (session_uuid, endpoint, p256dh_key, auth_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                session_uuid = excluded.session_uuid,
                p256dh_key = excluded.p256dh_key,
                auth_key = excluded.auth_key,
                updated_at = excluded.updated_at
        """, (session_uuid, endpoint, p256dh, auth, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def delete_push_subscription(self, endpoint: str) -> bool:
        """Remove a push subscription by endpoint URL.

        Args:
            endpoint: Push endpoint URL to remove

        Returns:
            True if a row was deleted, False if not found
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
        deleted = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def get_push_subscriptions_for_session(self, session_uuid: str) -> list:
        """Get all push subscriptions for a session.

        Args:
            session_uuid: Session UUID

        Returns:
            List of dicts with endpoint, p256dh_key, auth_key, created_at, updated_at
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT session_uuid, endpoint, p256dh_key, auth_key, created_at, updated_at
            FROM push_subscriptions
            WHERE session_uuid = ?
            ORDER BY created_at DESC
        """, (session_uuid,))
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'session_uuid': r[0],
                'endpoint': r[1],
                'p256dh': r[2],
                'auth': r[3],
                'created_at': r[4],
                'updated_at': r[5],
            }
            for r in rows
        ]

    def get_all_push_subscriptions_for_global(self, pref_key: str) -> list:
        """Get all push subscriptions where notification_preferences has pref_key=1.

        Used for global broadcast sends.

        Args:
            pref_key: Column name in notification_preferences (e.g. 'global_announcements')

        Returns:
            List of dicts with session_uuid, endpoint, p256dh, auth
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        # Only allow known column names to prevent SQL injection
        allowed_keys = {'global_announcements', 'targeted_announcements'}
        if pref_key not in allowed_keys:
            if not self._persistent_conn:
                conn.close()
            return []
        cursor.execute(f"""
            SELECT ps.session_uuid, ps.endpoint, ps.p256dh_key, ps.auth_key
            FROM push_subscriptions ps
            INNER JOIN notification_preferences np ON ps.session_uuid = np.session_uuid
            WHERE np.{pref_key} = 1
        """)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'session_uuid': r[0],
                'endpoint': r[1],
                'p256dh': r[2],
                'auth': r[3],
            }
            for r in rows
        ]

    def get_push_subscriptions_for_sessions(self, session_uuids: list, pref_key: str) -> list:
        """Get push subscriptions for specific sessions where pref_key=1.

        Used for targeted broadcast sends.

        Args:
            session_uuids: List of session UUIDs to target
            pref_key: Column name in notification_preferences

        Returns:
            List of dicts with session_uuid, endpoint, p256dh, auth
        """
        if not session_uuids:
            return []
        conn = self._get_connection()
        cursor = conn.cursor()
        # Only allow known column names to prevent SQL injection
        allowed_keys = {'global_announcements', 'targeted_announcements'}
        if pref_key not in allowed_keys:
            if not self._persistent_conn:
                conn.close()
            return []
        placeholders = ','.join('?' * len(session_uuids))
        cursor.execute(f"""
            SELECT ps.session_uuid, ps.endpoint, ps.p256dh_key, ps.auth_key
            FROM push_subscriptions ps
            INNER JOIN notification_preferences np ON ps.session_uuid = np.session_uuid
            WHERE ps.session_uuid IN ({placeholders})
              AND np.{pref_key} = 1
        """, session_uuids)
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [
            {
                'session_uuid': r[0],
                'endpoint': r[1],
                'p256dh': r[2],
                'auth': r[3],
            }
            for r in rows
        ]

    # ========================================================================
    # NOTIFICATION PREFERENCES CRUD METHODS
    # ========================================================================

    def upsert_notification_preferences(self, session_uuid: str, global_announcements: bool, targeted_announcements: bool) -> None:
        """Insert or update notification preferences for a session.

        Args:
            session_uuid: Session UUID
            global_announcements: Whether to receive global broadcast push notifications
            targeted_announcements: Whether to receive targeted push notifications
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            INSERT INTO notification_preferences (session_uuid, global_announcements, targeted_announcements, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_uuid) DO UPDATE SET
                global_announcements = excluded.global_announcements,
                targeted_announcements = excluded.targeted_announcements,
                updated_at = excluded.updated_at
        """, (session_uuid, 1 if global_announcements else 0, 1 if targeted_announcements else 0, now, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_notification_preferences(self, session_uuid: str) -> dict:
        """Get notification preferences for a session.

        Args:
            session_uuid: Session UUID

        Returns:
            Dict with 'global_announcements' and 'targeted_announcements' booleans.
            Defaults to False for both if no preferences are stored.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT global_announcements, targeted_announcements
            FROM notification_preferences
            WHERE session_uuid = ?
        """, (session_uuid,))
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if row is None:
            return {'global_announcements': False, 'targeted_announcements': False}
        return {
            'global_announcements': bool(row[0]),
            'targeted_announcements': bool(row[1]),
        }

    # ========================================================================
    # PUSH NOTIFICATION EVENTS CRUD METHODS
    # ========================================================================

    def record_push_event(self, broadcast_id: Optional[str], targeted_broadcast_id: Optional[str],
                          session_uuid: str, endpoint: str, event_type: str,
                          status_code: Optional[int] = None) -> None:
        """Record a push notification delivery/analytics event.

        Computes SHA-256 of the endpoint URL for privacy-preserving analytics.

        Args:
            broadcast_id: Global broadcast ID (or None)
            targeted_broadcast_id: Targeted broadcast ID (or None)
            session_uuid: Session UUID
            endpoint: Push endpoint URL (hashed before storage)
            event_type: One of 'delivered', 'failed', 'clicked', 'dismissed'
            status_code: HTTP status code from push service (optional)
        """
        import hashlib
        endpoint_hash = hashlib.sha256(endpoint.encode('utf-8')).hexdigest()
        conn = self._get_connection()
        cursor = conn.cursor()
        now = _utc_now()
        cursor.execute("""
            INSERT INTO push_notification_events
                (broadcast_id, targeted_broadcast_id, session_uuid, endpoint_hash, event_type, status_code, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (broadcast_id, targeted_broadcast_id, session_uuid, endpoint_hash, event_type, status_code, now))
        conn.commit()
        if not self._persistent_conn:
            conn.close()

    def get_push_analytics(self, broadcast_id: Optional[str] = None, targeted_broadcast_id: Optional[str] = None) -> dict:
        """Get push notification analytics for a broadcast.

        Args:
            broadcast_id: Global broadcast ID to filter by (or None)
            targeted_broadcast_id: Targeted broadcast ID to filter by (or None)

        Returns:
            Dict with delivered, failed, clicked, dismissed counts and click_through_rate
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        if broadcast_id is not None:
            cursor.execute("""
                SELECT event_type, COUNT(*) as cnt
                FROM push_notification_events
                WHERE broadcast_id = ?
                GROUP BY event_type
            """, (broadcast_id,))
        elif targeted_broadcast_id is not None:
            cursor.execute("""
                SELECT event_type, COUNT(*) as cnt
                FROM push_notification_events
                WHERE targeted_broadcast_id = ?
                GROUP BY event_type
            """, (targeted_broadcast_id,))
        else:
            cursor.execute("""
                SELECT event_type, COUNT(*) as cnt
                FROM push_notification_events
                GROUP BY event_type
            """)

        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()

        counts = {'delivered': 0, 'failed': 0, 'clicked': 0, 'dismissed': 0}
        for event_type, cnt in rows:
            if event_type in counts:
                counts[event_type] = cnt

        delivered = counts['delivered']
        clicked = counts['clicked']
        ctr = round(clicked / delivered * 100, 1) if delivered > 0 else 0.0

        return {
            'delivered': delivered,
            'failed': counts['failed'],
            'clicked': clicked,
            'dismissed': counts['dismissed'],
            'click_through_rate': ctr,
        }

    # ========================================================================
    # NOTEPAD (FAC-gated multi-note rich-text notes)
    # ========================================================================

    @staticmethod
    def _derive_note_title(content_json: str) -> str:
        """Title = first non-empty line of plain text, else 'Untitled'.

        content_json is a Quill Delta ({"ops":[...]}). Reconstruct plain text by
        concatenating string inserts (embeds -> a single space placeholder), then
        return the first line whose stripped text is non-empty, capped 120 chars.
        """
        import json as _json
        try:
            delta = _json.loads(content_json) if content_json else {}
            ops = delta.get('ops', []) if isinstance(delta, dict) else []
        except (ValueError, TypeError):
            ops = []
        parts = []
        for op in ops:
            ins = op.get('insert') if isinstance(op, dict) else None
            if isinstance(ins, str):
                parts.append(ins)
            elif ins is not None:
                parts.append(' ')  # embed (entity link / image) placeholder
        text = ''.join(parts)
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped:
                return stripped[:120]
        return 'Untitled'

    def count_notes(self, session_uuid: str) -> int:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM notes WHERE session_uuid = ?", (session_uuid,))
        n = cursor.fetchone()[0]
        if not self._persistent_conn:
            conn.close()
        return int(n)

    def list_notes(self, session_uuid: str) -> list:
        """List notes for a session, most-recently-updated first."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, title, updated_at FROM notes WHERE session_uuid = ? "
            "ORDER BY updated_at DESC, id",
            (session_uuid,),
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'title': r[1], 'updated_at': r[2]} for r in rows]

    def get_note(self, session_uuid: str, note_id: str) -> Optional[dict]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, title, content_json, created_at, updated_at FROM notes "
            "WHERE id = ? AND session_uuid = ?",
            (note_id, session_uuid),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {'id': row[0], 'title': row[1], 'content_json': row[2],
                'created_at': row[3], 'updated_at': row[4]}

    def create_note(self, session_uuid: str, content_json: Optional[str] = None) -> str:
        import uuid as _uuid
        note_id = str(_uuid.uuid4())
        if not content_json:
            content_json = '{"ops":[{"insert":"\\n"}]}'
        title = self._derive_note_title(content_json)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO notes (id, session_uuid, title, content_json) VALUES (?, ?, ?, ?)",
            (note_id, session_uuid, title, content_json),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return note_id

    def update_note(self, session_uuid: str, note_id: str, content_json: str) -> bool:
        """Update a note's content; re-derive title; bump updated_at."""
        title = self._derive_note_title(content_json)
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE notes SET content_json = ?, title = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND session_uuid = ?",
            (content_json, title, note_id, session_uuid),
        )
        updated = cursor.rowcount > 0
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return updated

    def delete_note(self, session_uuid: str, note_id: str) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM notes WHERE id = ? AND session_uuid = ?",
            (note_id, session_uuid),
        )
        deleted = cursor.rowcount > 0
        cursor.execute(
            "UPDATE notepad_state SET selected_note_id = NULL, updated_at = CURRENT_TIMESTAMP "
            "WHERE session_uuid = ? AND selected_note_id = ?",
            (session_uuid, note_id),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return deleted

    def get_selected_note(self, session_uuid: str) -> Optional[str]:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT selected_note_id FROM notepad_state WHERE session_uuid = ?",
            (session_uuid,),
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row[0] if row and row[0] else None

    def set_selected_note(self, session_uuid: str, note_id: Optional[str]) -> bool:
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO notepad_state (session_uuid, selected_note_id, updated_at) "
            "VALUES (?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(session_uuid) DO UPDATE SET "
            "selected_note_id = excluded.selected_note_id, updated_at = CURRENT_TIMESTAMP",
            (session_uuid, note_id),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return True

    # ========================================================================
    # SAVED CRAFTING TREES
    # ========================================================================

    def save_crafting_tree(self, session_uuid: str, name: str, target_item_id: str, tree_data: dict) -> str:
        """Save a crafting tree preset."""
        import uuid as _uuid
        tree_id = str(_uuid.uuid4())
        conn = self._get_connection()
        conn.execute(
            "INSERT INTO saved_crafting_trees (id, session_uuid, name, target_item_id, tree_data) VALUES (?, ?, ?, ?, ?)",
            (tree_id, session_uuid, name, target_item_id, json.dumps(tree_data))
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
        return tree_id

    def list_crafting_trees(self, session_uuid: str) -> list:
        """List all saved crafting trees for a session."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, target_item_id, created_at FROM saved_crafting_trees WHERE session_uuid = ? ORDER BY created_at DESC",
            (session_uuid,)
        )
        rows = cursor.fetchall()
        if not self._persistent_conn:
            conn.close()
        return [{'id': r[0], 'name': r[1], 'target_item_id': r[2], 'created_at': r[3]} for r in rows]

    def load_crafting_tree(self, tree_id: str, session_uuid: str) -> Optional[dict]:
        """Load a saved crafting tree by ID."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, target_item_id, tree_data FROM saved_crafting_trees WHERE id = ? AND session_uuid = ?",
            (tree_id, session_uuid)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        if not row:
            return None
        return {'id': row[0], 'name': row[1], 'target_item_id': row[2], 'tree_data': json.loads(row[3])}

    def delete_crafting_tree(self, tree_id: str, session_uuid: str) -> bool:
        """Delete a saved crafting tree."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM saved_crafting_trees WHERE id = ? AND session_uuid = ?", (tree_id, session_uuid))
        conn.commit()
        deleted = cursor.rowcount > 0
        if not self._persistent_conn:
            conn.close()
        return deleted

    # ========================================================================
    # OPTIMIZATION SETTINGS MIGRATION LOG
    # ========================================================================

    def has_optimization_settings_migration(self, session_uuid: str) -> bool:
        """Return True if this session has already been logged as migrated.

        Used to avoid repeated logging when the same session saves settings
        multiple times after the initial migration.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM optimization_settings_migration_log WHERE session_uuid = ? LIMIT 1",
            (session_uuid,)
        )
        row = cursor.fetchone()
        if not self._persistent_conn:
            conn.close()
        return row is not None

    def log_optimization_settings_migration(
        self,
        session_uuid: str,
        action: str,
        before: list,
        after: list,
    ) -> None:
        """Record that a session's activity sorting was migrated/removed.

        Args:
            session_uuid: Session identifier.
            action: 'removed', 'migrated', or 'custom' — see migration SQL.
            before: Sorting list before migration (list of [key, weight, target]).
            after: Sorting list after migration (same shape).

        Uses INSERT OR IGNORE keyed on session_uuid so the first migration
        event wins; subsequent saves for the same session are no-ops.
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR IGNORE INTO optimization_settings_migration_log
                (session_uuid, action, before_json, after_json)
            VALUES (?, ?, ?, ?)
            """,
            (session_uuid, action, json.dumps(before), json.dumps(after)),
        )
        conn.commit()
        if not self._persistent_conn:
            conn.close()
