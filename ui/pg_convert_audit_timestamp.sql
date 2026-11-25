-- ============================================================================
-- Convert api_access_audit.timestamp  (ISO text)  ->  timestamptz
-- ============================================================================
--
-- WHY: the column stored ISO text, so date math and the btree range index never
-- worked on Postgres (every predicate cast per row). This converts it to a real
-- timestamptz so DATE()/EXTRACT()/range filters are native and index-eligible.
-- The matching app code change (backend-aware emit coercion + ts_* SQL fragment
-- helpers in db_backend.py, and pg_schema.sql -> timestamptz for fresh DBs) ships
-- with this; deploy that code first/together so the app reads the new type
-- correctly.
--
-- HOW TO RUN (against prod ONLY when ready):
--   docker exec -i walkscape-pg-prod psql -U postgres -d walkscape \
--       -v ON_ERROR_STOP=1 -f /path/to/pg_convert_audit_timestamp.sql
--   (or pipe this file in on stdin the same way.)
--
-- SAFETY:
--   * Idempotent: if the column is already timestamptz it prints a notice and
--     makes no changes. Safe to re-run.
--   * Atomic: the whole thing runs in ONE transaction (the DO block). Any error
--     -- an un-parseable row, an incomplete backfill, anything -- rolls the
--     entire conversion back. The original text column is never left dropped on
--     a failure.
--   * Guarded drop: the old text column is dropped ONLY after a hard check that
--     every non-NULL source value backfilled into a non-NULL timestamptz. A
--     backfill miss raises and aborts.
--
-- LOCKING / TIMING (operational note):
--   This takes an ACCESS EXCLUSIVE lock on api_access_audit for the duration
--   (ADD COLUMN + full-table UPDATE backfill + index build). On ~1.1M rows this
--   was ~4-5 min on testing; prod may be longer. api_access_audit INSERTs (the
--   request-audit middleware) BLOCK during the conversion. Run it in a low-
--   traffic window. statement_timeout is lifted locally for this session so the
--   long backfill is not killed by the pool's 30s self-heal timeout.
-- ============================================================================

\set ON_ERROR_STOP on

-- Lift the pool's statement timeout for THIS session only (the long backfill
-- would otherwise trip the 30s self-heal statement_timeout). Session-scoped;
-- does not change the pool default.
SET statement_timeout = 0;

BEGIN;

DO $$
DECLARE
    v_type   text;
    v_total  bigint;
    v_missed bigint;
BEGIN
    -- Current type of the column.
    SELECT data_type INTO v_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'api_access_audit'
      AND column_name  = 'timestamp';

    IF v_type IS NULL THEN
        RAISE EXCEPTION 'api_access_audit.timestamp column not found -- aborting';
    END IF;

    IF v_type = 'timestamp with time zone' THEN
        RAISE NOTICE 'api_access_audit.timestamp is already timestamptz -- nothing to do (idempotent no-op).';
        RETURN;
    END IF;

    RAISE NOTICE 'Converting api_access_audit.timestamp from % to timestamptz...', v_type;

    -- 1. transient real-timestamp column
    ALTER TABLE api_access_audit ADD COLUMN ts timestamptz;

    -- 2. backfill. If ANY row is un-parseable, this statement raises and the
    --    whole transaction rolls back (old column untouched).
    UPDATE api_access_audit SET ts = timestamp::timestamptz;

    -- 3. GUARD: refuse to proceed unless every non-NULL source value produced a
    --    non-NULL ts. (Rows whose source timestamp was NULL legitimately have a
    --    NULL ts and are allowed.) A genuine backfill miss aborts the txn.
    SELECT count(*), count(*) FILTER (WHERE timestamp IS NOT NULL AND ts IS NULL)
      INTO v_total, v_missed
      FROM api_access_audit;

    IF v_missed > 0 THEN
        RAISE EXCEPTION
          'backfill incomplete: % of % rows have a non-NULL timestamp but NULL ts -- aborting, old column NOT dropped',
          v_missed, v_total;
    END IF;

    RAISE NOTICE 'Backfill verified: % rows, 0 misses. Dropping old text column and renaming.', v_total;

    -- 4. drop old text column (its text index idx_api_access_timestamp drops with it)
    ALTER TABLE api_access_audit DROP COLUMN timestamp;

    -- 5. rename ts -> timestamp so all existing code keeps working (now timestamptz)
    ALTER TABLE api_access_audit RENAME COLUMN ts TO timestamp;

    -- 6. recreate the index on the new timestamptz column
    CREATE INDEX idx_api_access_timestamp ON api_access_audit(timestamp);

    RAISE NOTICE 'Conversion complete.';
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-conversion verification (read-only; prints to the psql session).
-- ---------------------------------------------------------------------------
\echo '=== verification: column type + counts ==='
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'api_access_audit' AND column_name = 'timestamp';

SELECT count(*) AS total_rows, count(timestamp) AS non_null_ts FROM api_access_audit;
SELECT min(timestamp) AS min_ts, max(timestamp) AS max_ts FROM api_access_audit;

\echo '=== verification: index present on the new timestamptz column ==='
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'api_access_audit' AND indexname = 'idx_api_access_timestamp';
