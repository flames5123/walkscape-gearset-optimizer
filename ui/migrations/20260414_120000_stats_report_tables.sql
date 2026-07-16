-- Create stats_report_runs table for tracking bulk optimization report runs
CREATE TABLE IF NOT EXISTS stats_report_runs (
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
    created_at TEXT NOT NULL,
    inventory_fingerprint TEXT,
    is_stale INTEGER NOT NULL DEFAULT 0
);

-- Create stats_report_gearsets table for storing per-job optimization results
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
    FOREIGN KEY (run_id) REFERENCES stats_report_runs(id)
);

-- Index for looking up runs by session, ordered by most recent first
CREATE INDEX IF NOT EXISTS idx_stats_report_runs_session ON stats_report_runs(session_uuid, started_at DESC);

-- Index for looking up gearset results by run, category, and metric value
CREATE INDEX IF NOT EXISTS idx_stats_report_gearsets_run ON stats_report_gearsets(run_id, category, metric_value);

-- Index for looking up gearset results by session, ordered by most recent first
CREATE INDEX IF NOT EXISTS idx_stats_report_gearsets_session ON stats_report_gearsets(session_uuid, created_at DESC);
