-- Restore stats_report_gearsets table that was dropped by 20260522_120001.
-- The legacy table is still used by 6+ endpoints in app.py and the existing
-- frontend code path. Dual-write strategy: worker writes to BOTH the legacy
-- table (for existing code) AND the new stats_report_results table (for
-- stale-detection). A future cleanup migration removes the legacy table
-- after all callers are migrated.
--
-- This migration is idempotent — IF NOT EXISTS guards make re-running safe.

CREATE TABLE IF NOT EXISTS stats_report_gearsets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    session_uuid TEXT NOT NULL,
    category TEXT NOT NULL,
    activity_name TEXT,
    skill_name TEXT,
    chest_name TEXT,
    metric_value REAL,
    metric_name TEXT,
    gearset_export TEXT,
    job_status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL,
    refreshed_at TEXT,
    metrics_json TEXT,
    FOREIGN KEY (run_id) REFERENCES stats_report_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_stats_report_gearsets_run
    ON stats_report_gearsets(run_id, category, metric_value);

CREATE INDEX IF NOT EXISTS idx_stats_report_gearsets_session
    ON stats_report_gearsets(session_uuid, created_at DESC);
