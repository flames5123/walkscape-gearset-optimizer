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
    """Execute a single migration file (.sql or .py).

    Runs the migration body and commits its own work. Does NOT record the
    migration in schema_migrations — the caller (run_migrations) records it
    only after a successful (or benign) apply, so it can implement
    continue-on-error + idempotent-error handling in one place.
    """
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

    conn.commit()

# Error substrings that mean a migration's intent is ALREADY satisfied and it
# should be treated as a benign no-op (recorded so it stops retrying and stops
# blocking later migrations). SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT
# EXISTS`, so an additive column migration re-run against a DB that already has
# the column raises "duplicate column name". Historically this aborted the WHOLE
# pending batch (rollback + raise), silently blocking every later migration —
# which is exactly how the item_ids compaction migration never ran on the live
# DB (2026-08-06). Treat these as applied and move on.
BENIGN_ERROR_MARKERS = ("duplicate column name", "already exists")


def _record_applied(conn, filename):
    conn.execute(
        'INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)',
        (filename,),
    )
    conn.commit()


def run_migrations(db_path=None, migrations_dir=None):
    """Apply all pending migrations.

    Hardened (2026-08-11): a single failing migration no longer aborts the whole
    batch. Each migration is applied independently; on failure we roll back that
    migration's partial work and CONTINUE with the rest. Idempotent-safe errors
    (duplicate column / already exists) are recorded as applied no-ops so they
    stop retrying and stop blocking later migrations. Genuine failures are logged
    loudly and left un-recorded (they retry next startup) but do NOT block the
    migrations that follow them.

    Args:
        db_path: Path to SQLite database (defaults to 'sessions.db')
        migrations_dir: Path to migrations folder (defaults to 'migrations/')

    Returns:
        Number of migrations successfully applied (incl. benign no-ops).
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
        applied_ok = 0
        failed = []

        for migration in pending:
            try:
                apply_migration(conn, migration, migrations_dir)
                _record_applied(conn, migration)
                applied_ok += 1
                print(f"  ✓ Applied {migration}")
            except Exception as e:
                # Discard this migration's partial work; never let it poison the
                # rest of the batch.
                try:
                    conn.rollback()
                except Exception:
                    pass
                msg = str(e).lower()
                if any(marker in msg for marker in BENIGN_ERROR_MARKERS):
                    # Intent already satisfied (e.g. ADD COLUMN of an existing
                    # column). Record so it never blocks/retries again.
                    try:
                        _record_applied(conn, migration)
                        applied_ok += 1
                        print(f"  ~ {migration}: benign no-op ({e}) — marked applied")
                    except Exception as e2:
                        try:
                            conn.rollback()
                        except Exception:
                            pass
                        failed.append((migration, f"benign-record-failed: {e2}"))
                else:
                    failed.append((migration, str(e)))
                    print(f"  ✗ {migration} FAILED (continuing with remaining): {e}")

        if failed:
            print(f"\n⚠️  {len(failed)} migration(s) failed but did NOT block the batch:")
            for fname, err in failed:
                print(f"     - {fname}: {err}")

        print(f"\n✓ Applied {applied_ok} of {len(pending)} pending migration(s)")
        return applied_ok

    finally:
        conn.close()

if __name__ == '__main__':
    # When run standalone, ensure base tables exist first (DatabaseManager creates them)
    from ui.database import DatabaseManager
    import os
    db_path = os.environ.get('DATABASE_PATH', DB_PATH)
    DatabaseManager(db_path)  # Creates base tables if they don't exist
    run_migrations(db_path=db_path)
