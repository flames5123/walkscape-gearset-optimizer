"""Stats Report Stale Detection - companion Python migration.

Reshapes legacy stats_report_gearsets table per R16 (unreleased feature, free
to modify). The new stats_report_results table created by the SQL migration
replaces stats_report_gearsets entirely.

Idempotent: checks if stats_report_gearsets exists before dropping.

Note: extends ui/database.py:delete_session is NOT done here — that's a code
change in database.py applied directly in the same CR. This migration only
reshapes the schema.
"""


def run(conn):
    """Apply migration. Called by ui/apply_migrations.py."""
    cursor = conn.cursor()

    # ── Drop the legacy stats_report_gearsets table ────────────────────────
    # The new stats_report_results table (created by the SQL migration) is
    # the per-row results store. The legacy table held one row per
    # (run_id, category, activity) — same shape but keyed by transient
    # run_id instead of stable (session, category, subcategory, source, ...).
    cursor.execute("""
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'stats_report_gearsets'
    """)
    if cursor.fetchone():
        cursor.execute("DROP TABLE stats_report_gearsets")
        print("    Dropped legacy stats_report_gearsets table")
    else:
        print("    stats_report_gearsets already absent — skip")

    # ── Drop is_stale column from stats_report_runs ────────────────────────
    # Replaced by per-row stats_report_results.dominance_bitmap +
    # metric_inputs_hash + optimization_version. The is_stale column was a
    # crude run-level flag; per-row staleness is now the model.
    cursor.execute("PRAGMA table_info(stats_report_runs)")
    columns = {row[1] for row in cursor.fetchall()}
    if 'is_stale' in columns or 'inventory_fingerprint' in columns:
        # SQLite ALTER TABLE DROP COLUMN requires 3.35+. Use recreate-and-copy.
        cursor.execute("""
            CREATE TABLE stats_report_runs_new (
                id TEXT PRIMARY KEY,
                session_uuid TEXT NOT NULL,
                categories TEXT NOT NULL,
                skills TEXT NOT NULL,
                total_jobs INTEGER NOT NULL DEFAULT 0,
                completed_jobs INTEGER NOT NULL DEFAULT 0,
                failed_jobs INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'running',
                notify_on_complete INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                created_at TEXT NOT NULL
            )
        """)
        cursor.execute("""
            INSERT INTO stats_report_runs_new
                (id, session_uuid, categories, skills, total_jobs, completed_jobs,
                 failed_jobs, status, notify_on_complete, started_at, completed_at, created_at)
            SELECT id, session_uuid, categories, skills, total_jobs, completed_jobs,
                   failed_jobs, status, notify_on_complete, started_at, completed_at, created_at
            FROM stats_report_runs
        """)
        cursor.execute("DROP TABLE stats_report_runs")
        cursor.execute("ALTER TABLE stats_report_runs_new RENAME TO stats_report_runs")

        # Restore the index
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_stats_report_runs_session
                ON stats_report_runs(session_uuid, started_at DESC)
        """)
        print("    Reshaped stats_report_runs (dropped is_stale + inventory_fingerprint)")
    else:
        print("    stats_report_runs already reshaped — skip")

    conn.commit()
