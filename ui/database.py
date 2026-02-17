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
