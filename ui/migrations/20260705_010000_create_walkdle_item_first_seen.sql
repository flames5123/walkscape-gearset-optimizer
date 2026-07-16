-- Walkdle stable per-day schedule: record the UTC date each guessable item was
-- first seen so the browser engine (pickDailyTargetStable / _buildStableSchedule
-- in walkdle-engine.js) can pin every day's target. Pinning means past days
-- never shift when the catalog grows: launch-cohort items are keyed to the
-- original walkdle-shuffle-v1 permutation, and items first observed later are
-- release-gated (they can only surface on/after their first_seen date).
--
-- Matches the CREATE in database.py::_init_db_with_conn. This migration makes
-- the table an explicit deploy artifact (applied by apply_migrations.py before
-- app start) instead of relying solely on the base-schema init, per the
-- database-migrations steering rule.
--
-- Schema-only: the launch-cohort backfill (all current pool ids -> launch date;
-- later ids -> their first-seen date) is data and lives in
-- WalkscapeDB.sync_walkdle_first_seen, invoked by the /api/walkdle/catalog
-- endpoint. It is intentionally NOT seeded here.
CREATE TABLE IF NOT EXISTS walkdle_item_first_seen (
    item_id    TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL   -- UTC YYYY-MM-DD
);
