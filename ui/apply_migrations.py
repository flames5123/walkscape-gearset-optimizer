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

def get_pending_migrations(applied, migrations_dir):
    """Get list of migrations that haven't been applied yet."""
    migrations_path = Path(migrations_dir)
    if not migrations_path.exists():
        return []
    
    all_migrations = sorted([
        f.name for f in migrations_path.glob('*')
        if f.suffix in ('.sql', '.py') and not f.name.startswith('_') and f.name != 'README.md'
    ])
    
    return [m for m in all_migrations if m not in applied]

def apply_migration(conn, filename, migrations_dir):
    """Apply a single migration file (.sql or .py)."""
    filepath = Path(migrations_dir) / filename
    
    print(f"  Applying {filename}...")
    
    if filename.endswith('.py'):
        # Python migration: import and call run(conn)
        import importlib.util
        spec = importlib.util.spec_from_file_location(filename[:-3], filepath)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if hasattr(mod, 'run'):
            mod.run(conn)
        else:
            print(f"  ⚠️  {filename} has no run(conn) function, skipping execution")
    else:
        with open(filepath, 'r') as f:
            sql = f.read()
        conn.executescript(sql)
    
    # Record that it was applied
    conn.execute(
        'INSERT INTO schema_migrations (filename) VALUES (?)',
        (filename,)
    )
    conn.commit()
    
    print(f"  ✓ Applied {filename}")

def run_migrations(db_path=None, migrations_dir=None):
    """Apply all pending migrations.
    
    Args:
        db_path: Path to SQLite database (defaults to 'sessions.db')
        migrations_dir: Path to migrations folder (defaults to 'migrations/')
        
    Returns:
        Number of migrations applied
    """
    db_path = db_path or DB_PATH
    migrations_dir = migrations_dir or MIGRATIONS_DIR
    
    if not os.path.exists(db_path):
        print(f"⚠️  Database not found at {db_path}")
        print("   Creating new database...")
    
    conn = sqlite3.connect(db_path)
    
    try:
        init_migrations_table(conn)
        
        applied = get_applied_migrations(conn)
        pending = get_pending_migrations(applied, migrations_dir)
        
        if not pending:
            print("✓ No pending migrations")
            return 0
        
        print(f"Found {len(pending)} pending migration(s):")
        for migration in pending:
            apply_migration(conn, migration, migrations_dir)
        
        print(f"\n✓ Successfully applied {len(pending)} migration(s)")
        return len(pending)
        
    except Exception as e:
        print(f"\n✗ Migration failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    # When run standalone, ensure base tables exist first (DatabaseManager creates them)
    from ui.database import DatabaseManager
    import os
    db_path = os.environ.get('DATABASE_PATH', DB_PATH)
    DatabaseManager(db_path)  # Creates base tables if they don't exist
    run_migrations(db_path=db_path)
