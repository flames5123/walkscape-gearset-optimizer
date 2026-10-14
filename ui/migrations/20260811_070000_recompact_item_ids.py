"""Re-run of the item_ids high-id compaction (2026-08-11, jwbail [fix:stale-detection]).

WHY A SECOND ONE
----------------
`20260804_010000_compact_item_ids.py` was supposed to compact item_ids on the
live DB, but it never took effect: `apply_migrations.py` used to abort the ENTIRE
pending batch (rollback + raise) on the first migration error, and the bare
`ALTER TABLE bug_reports ADD COLUMN server_logs` migration (20260306_100000)
raises "duplicate column name" on any DB where that column already exists — so
every migration sorted after it, including the 20260804 compaction, silently
never ran. New patch items therefore kept landing at the burned high-water mark
(id 6261+) instead of right after the real rows (~1605).

The companion change hardens `apply_migrations.py` (continue-on-error + treat
duplicate-column as a benign recorded no-op), so the original 20260804 migration
will now finally run too. This migration is a belt-and-suspenders re-run with a
new (never-recorded) filename so the fix lands even if the 20260804 record state
is ambiguous on a given DB. It is fully idempotent: if item_ids is already dense
(no id > N), it is a no-op.

WHAT IT DOES (surgical, id-value-preserving where possible)
-----------------------------------------------------------
N = row count. Any id > N (the burned stragglers, e.g. the 6261+ block) is moved
down into the free low slots (the 1..N ids not currently occupied). Ids already
in 1..N are left untouched. `sqlite_sequence` is reset to N so future
diff-then-insert appends resume densely at N+1. The derived precompute tables
and the precompute completion stamp are cleared so the startup `precompute_all`
rebuilds dominators/applicability/runtime_eval at the compact ids.

BLAST RADIUS (intentional, pre-approved)
----------------------------------------
Per-user `stats_report_results.dominance_bitmap` blobs are diffed against a
freshly-computed bitmap (bit position == id value). Moving a straggler id
desyncs any stored blob that referenced it, flipping that scope stale once — but
only for users who own one of the moved (new) items, which would go stale from
the new item anyway. Ids 1..N are never moved, so all other stored bits stay
aligned. We scan + log the count but do not block.

Self-contained (pure sqlite3 + stdlib) — migrations are loaded by file path.
"""


def _table_exists(cursor, name: str) -> bool:
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
    )
    return cursor.fetchone() is not None


def _get_bit(blob, idx: int) -> bool:
    if blob is None:
        return False
    byte_idx = idx // 8
    if byte_idx >= len(blob):
        return False
    return bool(blob[byte_idx] & (1 << (idx % 8)))


def _count_blobs_referencing(cursor, table: str, columns, positions) -> int:
    """Count rows in `table` whose any of `columns` (BLOB) has a set bit at any
    position in `positions`. Returns 0 if the table/columns are absent."""
    if not positions or not _table_exists(cursor, table):
        return 0
    cursor.execute(f"PRAGMA table_info({table})")
    present = {row[1] for row in cursor.fetchall()}
    cols = [c for c in columns if c in present]
    if not cols:
        return 0
    cursor.execute(f"SELECT {', '.join(cols)} FROM {table}")
    hits = 0
    pos_list = list(positions)
    for row in cursor.fetchall():
        for blob in row:
            if blob is None:
                continue
            if any(_get_bit(blob, p) for p in pos_list):
                hits += 1
                break
    return hits


def run(conn):
    """Apply migration. Called by ui/apply_migrations.py."""
    cursor = conn.cursor()

    if not _table_exists(cursor, "item_ids"):
        print("    item_ids table absent — skip re-compaction")
        return

    cursor.execute("SELECT id FROM item_ids ORDER BY id")
    ids = [row[0] for row in cursor.fetchall()]
    n = len(ids)
    if n == 0:
        print("    item_ids empty — skip re-compaction")
        return

    existing = set(ids)
    stragglers = sorted(i for i in ids if i > n)      # burned out-of-range ids
    if not stragglers:
        print(f"    item_ids already dense (N={n}, MAX={max(ids)}) — skip re-compaction")
        return

    free_slots = sorted(i for i in range(1, n + 1) if i not in existing)
    if len(free_slots) != len(stragglers):
        print(
            f"    ⚠️  re-compaction abort: {len(stragglers)} stragglers but "
            f"{len(free_slots)} free slots (expected equal) — leaving ids as-is"
        )
        return

    affected_results = _count_blobs_referencing(
        cursor, "stats_report_results", ["dominance_bitmap"], stragglers
    )
    affected_stale = _count_blobs_referencing(
        cursor, "stats_report_stale_scopes",
        ["added_item_ids", "removed_item_ids"], stragglers,
    )
    print(
        f"    re-compaction: N={n}, MAX(id)={max(ids)}, moving {len(stragglers)} "
        f"straggler id(s) into free low slots"
    )
    print(
        f"    safety scan: {affected_results} stats_report_results row(s) and "
        f"{affected_stale} stale-scope row(s) reference a moved id "
        f"(these scopes will re-flag stale once — expected)"
    )

    # Targets (free_slots, all <= n and unoccupied) are disjoint from stragglers
    # (all > n), so no PK collision at any step.
    for old_id, new_id in zip(stragglers, free_slots):
        cursor.execute("UPDATE item_ids SET id = ? WHERE id = ?", (new_id, old_id))

    # Reset the AUTOINCREMENT high-water mark so future appends resume at n+1.
    if _table_exists(cursor, "sqlite_sequence"):
        cursor.execute(
            "UPDATE sqlite_sequence SET seq = ? WHERE name = 'item_ids'", (n,)
        )
        if cursor.rowcount == 0:
            cursor.execute(
                "INSERT INTO sqlite_sequence (name, seq) VALUES ('item_ids', ?)", (n,)
            )

    # Clear derived precompute tables (they still reference OLD ids until the
    # startup precompute_all rebuild regenerates them at the compact ids).
    for tbl in (
        "item_static_dominators",
        "item_applicability_lookup",
        "recipe_applicability_lookup",
        "items_requiring_runtime_eval",
    ):
        if _table_exists(cursor, tbl):
            cursor.execute(f"DELETE FROM {tbl}")

    # Clear the precompute completion stamp so precompute_is_stale is guaranteed
    # True on this startup, forcing the full rebuild at the new ids.
    if _table_exists(cursor, "stats_report_precompute_meta"):
        cursor.execute("DELETE FROM stats_report_precompute_meta")

    conn.commit()

    cursor.execute("SELECT MAX(id) FROM item_ids")
    new_max = cursor.fetchone()[0]
    print(
        f"    ✓ re-compacted item_ids: {n} rows, MAX(id) now {new_max} "
        f"(dense 1..{n}); sqlite_sequence reset; derived tables cleared for rebuild"
    )
