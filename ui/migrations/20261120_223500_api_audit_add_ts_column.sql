-- api_access_audit.timestamp is stored as TEXT (ISO strings), so every
-- dashboard query casts it per row, defeats the index, and times out (524).
-- Two-step convert, step 1: add a real timestamptz column and index it now,
-- while it is still all-NULL (instant build, brief lock). New rows are
-- dual-written by database.py; existing rows are backfilled in step 2
-- (20261120_223600_backfill_api_audit_ts.py).
ALTER TABLE api_access_audit ADD COLUMN ts TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_access_ts ON api_access_audit(ts);
