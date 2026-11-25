-- Weekly job-board scraper storage (ui/job_board_scraper.py).
--
-- job_board_jobs  — one row per job. `id` is the API's stable job id, unique
--   across all weeks, so INSERT OR IGNORE makes the weekly ingest idempotent
--   (re-runs / container resets / blue-green only add jobs not already stored).
-- job_board_ingests — one row per ingest run; powers the admin "Job Board" page
--   (last ingest time + per-run counts + failure logs).
-- job_board_meta — kv for scheduler state (last fully-ingested week index, the
--   running week's ETag for conditional GETs).
--
-- These tables are also created inline in database.py::_init_db_with_conn via
-- the same idempotent DDL (for in-memory / test DBs) and registered in
-- pg_schema.sql for the Postgres backend. This file is the authoritative
-- SQLite registration.

CREATE TABLE IF NOT EXISTS job_board_jobs (
    id INTEGER PRIMARY KEY,              -- stable API job id (unique across weeks)
    week_index INTEGER NOT NULL,
    board_id TEXT NOT NULL,              -- game-data board id
    board_slug TEXT,                     -- resolved tools-API slug (nullable)
    board_name TEXT,                     -- resolved proper name (nullable)
    slot INTEGER,
    difficulty_id TEXT,
    special_id TEXT,                     -- set for hand-made jobs, null for generated
    bonus INTEGER DEFAULT 0,
    required_level INTEGER,
    expires_at TEXT,
    goals_json TEXT,
    rewards_json TEXT,
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_board_jobs_week ON job_board_jobs(week_index);
CREATE INDEX IF NOT EXISTS idx_job_board_jobs_board ON job_board_jobs(board_id);

CREATE TABLE IF NOT EXISTS job_board_ingests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_index INTEGER,
    status TEXT NOT NULL DEFAULT 'running',   -- running | success | failure
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP,
    jobs_seen INTEGER DEFAULT 0,
    jobs_inserted INTEGER DEFAULT 0,
    jobs_skipped INTEGER DEFAULT 0,
    boards_seen INTEGER DEFAULT 0,
    result_status TEXT,                       -- success | already_done | unchanged | failure
    error TEXT,
    traceback TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_board_ingests_started ON job_board_ingests(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_board_ingests_status ON job_board_ingests(status, started_at DESC);

CREATE TABLE IF NOT EXISTS job_board_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
