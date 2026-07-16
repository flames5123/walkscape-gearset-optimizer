-- Stats Report Auto-Resume — schema migration
--
-- Adds resume_count + last_progress_at columns to stats_report_runs to
-- support server-side auto-resume of orphaned runs (worker subprocesses
-- killed by container restart / deploy).
--
-- Design:
--   resume_count    — count of how many times a run has been respawned
--                     after container restart. Capped at 3 to prevent
--                     runaway respawn loops if a worker keeps crashing
--                     on the same job. Beyond 3, the run is marked
--                     permanently failed.
--   last_progress_at — ISO timestamp updated by the worker after every
--                     progress increment. Used to detect "abandoned"
--                     runs (no movement for hours = user gave up, don't
--                     resume) vs "fresh" runs (just deployed mid-flight,
--                     do resume).
--
-- See .kiro/specs/stats-report-stale-detection/ + the auto-resume CR.

ALTER TABLE stats_report_runs ADD COLUMN resume_count INTEGER DEFAULT 0;
ALTER TABLE stats_report_runs ADD COLUMN last_progress_at TEXT;

-- Index for the orphan-sweep query at app startup. The query filters
-- on status + last_progress_at + resume_count + age, so a partial index
-- on the running/interrupted statuses keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_stats_report_runs_orphan_sweep
    ON stats_report_runs (status, started_at)
    WHERE status IN ('running', 'interrupted');
