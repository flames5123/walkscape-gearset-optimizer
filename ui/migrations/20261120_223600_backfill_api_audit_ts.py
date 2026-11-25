#!/usr/bin/env python3
"""Backfill api_access_audit.ts from the legacy text `timestamp` column.

Step 2 of the timestamptz convert. Batched by primary-key id so a multi-GB
prod table is never locked or bloated by one huge UPDATE. Idempotent: only
rows with ts IS NULL are touched, so a re-run resumes where it stopped. The
index (idx_api_access_ts) was created empty in step 1, so it just maintains
incrementally here.
"""

BATCH = 50000


def _is_postgres():
    try:
        from db_backend import is_postgres
    except ImportError:
        from ui.db_backend import is_postgres
    return is_postgres()


def run(conn):
    """Called by apply_migrations.py with an open DB connection."""
    # On Postgres the text column must be cast; on SQLite ts holds ISO text.
    cast = "timestamp::timestamptz" if _is_postgres() else "timestamp"

    cur = conn.cursor()
    total = 0
    while True:
        cur.execute(
            f"""
            UPDATE api_access_audit
               SET ts = {cast}
             WHERE id IN (
                   SELECT id FROM api_access_audit
                    WHERE ts IS NULL AND timestamp IS NOT NULL
                    LIMIT ?
             )
            """,
            (BATCH,),
        )
        n = cur.rowcount or 0
        conn.commit()
        total += n
        print(f"    backfilled {total} rows (last batch {n})")
        if n < BATCH:
            break

    print(f"    done: {total} rows backfilled into api_access_audit.ts")
