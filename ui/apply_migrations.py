#!/usr/bin/env python3
"""
Apply database migrations from the migrations/ folder.

Migrations are SQL files named with timestamps: YYYYMMDD_HHMMSS_description.sql
They are applied in order and tracked in a migrations table.
"""

import os
import sqlite3
from pathlib import Path
from datetime import datetime

DB_PATH = 'sessions.db'
MIGRATIONS_DIR = 'migrations'

def init_migrations_table(conn):
    """Create migrations tracking table if it doesn't exist."""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()

def get_applied_migrations(conn):
    """Get list of already-applied migrations."""
    cursor = conn.execute('SELECT filename FROM schema_migrations')
    return {row[0] for row in cursor.fetchall()}

def get_pending_migrations(applied):
    """Get list of migrations that haven't been applied yet."""
    migrations_path = Path(MIGRATIONS_DIR)
    if not migrations_path.exists():
        return []
    
    all_migrations = sorted([
        f.name for f in migrations_path.glob('*.sql')
    ])
    
    return [m for m in all_migrations if m not in applied]

def apply_migration(conn, filename):
    """Apply a single migration file."""
    filepath = Path(MIGRATIONS_DIR) / filename
    
    print(f"  Applying {filename}...")
    
    with open(filepath, 'r') as f:
        sql = f.read()
    
    # Execute the migration
    conn.executescript(sql)
    
    # Record that it was applied
    conn.execute(
        'INSERT INTO schema_migrations (filename) VALUES (?)',
        (filename,)
    )
    conn.commit()
    
    print(f"  ✓ Applied {filename}")

def main():
    """Apply all pending migrations."""
    if not os.path.exists(DB_PATH):
        print(f"⚠️  Database not found at {DB_PATH}")
        print("   Creating new database...")
    
    conn = sqlite3.connect(DB_PATH)
    
    try:
        # Initialize migrations tracking
        init_migrations_table(conn)
        
        # Get pending migrations
        applied = get_applied_migrations(conn)
        pending = get_pending_migrations(applied)
        
        if not pending:
            print("✓ No pending migrations")
            return
        
        print(f"Found {len(pending)} pending migration(s):")
        for migration in pending:
            apply_migration(conn, migration)
        
        print(f"\n✓ Successfully applied {len(pending)} migration(s)")
        
    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    main()
