#!/usr/bin/env python3
"""
SQLite database manager for session persistence.

Manages user sessions with separate character_config and ui_config storage.
Each session is identified by a UUID and stores:
- character_config: Imported game export data (skills, items, reputation)
- ui_config: User preferences (hidden items, quality selections, custom stats)
"""

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Any


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
        conn = sqlite3.connect(self.db_path)
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
                FOREIGN KEY (original_session_uuid) REFERENCES sessions(uuid),
                FOREIGN KEY (snapshot_session_uuid) REFERENCES sessions(uuid)
            )
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
        
        conn.commit()
    
    def _get_connection(self):
        """Get database connection (reuse for in-memory, create new for file-based)."""
        if self._persistent_conn:
            return self._persistent_conn
        return sqlite3.connect(self.db_path)
    
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
            SELECT uuid, character_config, ui_config, last_updated
            FROM sessions
            WHERE uuid = ?
        """, (session_uuid,))
        
        row = cursor.fetchone()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        if not row:
            return None
        
        return {
            'uuid': row[0],
            'character_config': json.loads(row[1]) if row[1] else None,
            'ui_config': json.loads(row[2]) if row[2] else {},
            'last_updated': row[3]
        }
    
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
        """, (session_uuid, json.dumps(ui_config), datetime.now().isoformat()))
        
        conn.commit()
        
        # Only close if not persistent connection
        if not self._persistent_conn:
            conn.close()
        
        return {
            'uuid': session_uuid,
            'character_config': None,
            'ui_config': ui_config,
            'last_updated': datetime.now().isoformat()
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
        """, (json.dumps(config), datetime.now().isoformat(), session_uuid))
        
        conn.commit()
        
        # Only close if not persistent connection
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
        """, (json.dumps(config), datetime.now().isoformat(), session_uuid))
        
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

    def get_gear_sets(self, session_uuid: str) -> list:
        """Get all gear sets for a session.
        
        Args:
            session_uuid: Session UUID to get gear sets for
            
        Returns:
            List of gear set dictionaries with id, name, slots_json, is_optimized, timestamps
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
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
            gear_sets.append({
                'id': row[0],
                'session_uuid': row[1],
                'name': row[2],
                'slots_json': json.loads(row[3]) if row[3] else {},
                'export_string': row[4],
                'is_optimized': bool(row[5]),
                'created_at': row[6],
                'updated_at': row[7]
            })
        
        return gear_sets

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
            'slots_json': json.loads(row[3]) if row[3] else {},
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
            'slots_json': json.loads(row[3]) if row[3] else {},
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
        now = datetime.now().isoformat()
        
        cursor.execute("""
            INSERT INTO gear_sets (id, session_uuid, name, slots_json, export_string, is_optimized, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (gear_set_id, session_uuid, name, json.dumps(slots_json), export_string, 1 if is_optimized else 0, now, now))
        
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
                        slots_json: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """Update an existing gear set.
        
        Args:
            session_uuid: Session UUID (for validation)
            gear_set_id: Gear set ID to update
            name: New name (optional)
            slots_json: New slot configuration (optional)
            
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
            params.append(json.dumps(slots_json))
        
        updates.append("updated_at = ?")
        now = datetime.now().isoformat()
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
            return self.update_gear_set(session_uuid, existing_by_name['id'], slots_json=slots_json)
        
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
        now = datetime.now().isoformat()
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
    # BUG REPORT CRUD METHODS
    # ========================================================================

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
        now = datetime.now().isoformat()
        
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
                   reviewed, reviewed_at, reviewed_by, notes
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
            'notes': row[11]
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
            SET reviewed = 1, reviewed_at = ?, reviewed_by = ?, notes = ?
            WHERE id = ?
        """, (datetime.now().isoformat(), reviewed_by, notes, report_id))
        
        updated = cursor.rowcount > 0
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return updated

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
        
        # Delete the session itself
        cursor.execute("DELETE FROM sessions WHERE uuid = ?", (session_uuid,))
        deleted = cursor.rowcount > 0
        
        conn.commit()
        
        if not self._persistent_conn:
            conn.close()
        
        return deleted

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
                       user_agent: Optional[str] = None, ip_address: Optional[str] = None):
        """Log an API access event.
        
        Args:
            session_uuid: Session UUID making the request
            endpoint: API endpoint accessed (e.g., '/api/catalog', '/api/session')
            method: HTTP method (GET, POST, PUT, DELETE)
            user_agent: User agent string (optional)
            ip_address: IP address (optional)
        """
        conn = self._get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO api_access_audit (session_uuid, endpoint, method, user_agent, ip_address, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (session_uuid, endpoint, method, user_agent, ip_address, datetime.now().isoformat()))
        
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
            base_where += " AND json_extract(character_config, '$.name') LIKE ?"
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

            results.append({
                'uuid': row[0],
                'name': config.get('name', 'Unknown'),
                'steps': config.get('steps', 0),
                'last_updated': row[2],
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
    # BROADCAST METHODS
    # ========================================================================

    def create_broadcast(self, message: str, created_by: str) -> Dict[str, Any]:
        """Create a new broadcast, deactivating any existing active broadcast.

        Args:
            message: Broadcast message text
            created_by: Discord username who created it

        Returns:
            Dict with broadcast id, message, created_at, created_by, active
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        # Deactivate existing active broadcasts
        cursor.execute("UPDATE broadcasts SET active = 0 WHERE active = 1")

        broadcast_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO broadcasts (id, message, created_at, created_by, active)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, 1)
        """, (broadcast_id, message, created_by))
        conn.commit()

        # Fetch the created record to get the timestamp
        cursor.execute(
            "SELECT id, message, created_at, created_by, active FROM broadcasts WHERE id = ?",
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
        """Get the currently active broadcast.

        Returns:
            Dict with broadcast data or None if no active broadcast
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, created_at, created_by, active
            FROM broadcasts
            WHERE active = 1
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
            List of dicts with id, message, created_at, created_by, active
        """
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, message, created_at, created_by, active
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
            }
            for row in rows
        ]


