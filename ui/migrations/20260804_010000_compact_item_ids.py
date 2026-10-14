"""Surgical high-id compaction for item_ids (2026-08-04, jwbail [fix:stale-detection]).

WHY
---
`item_ids` had accumulated large id gaps: 1605 real rows but MAX(id) in the
~6000s. Cause: build_item_ids used `INSERT OR IGNORE` over the whole catalog on
every rebuild, and with `id INTEGER PRIMARY KEY AUTOINCREMENT` + a
`UNIQUE(import_name, quality)` constraint, each ignored duplicate still BURNS an
AUTOINCREMENT value. After ~4 rebuilds the counter had raced ~4x ahead, so the
~70 newest items landed at ids in the 6000s while the original ~1535 stayed at
1..1535. The bitmap encoding is gap-tolerant (bit position == id VALUE, blobs
sized to MAX(id)), so this was correctness-safe but ~3.7x wasteful in every
stored bitmap blob (stats_report_results, item_static_dominators, applicability).

The companion code change (build_item_ids diff-then-insert) stops the burn going
forward. This one-time migration reclaims the existing waste by SURGICALLY
compacting: it moves ONLY the out-of-range stragglers (id > N, where N = row
count) down into the free low slots, and leaves every id in 1..N untouched.

BLAST RADIUS (intentional, pre-approved)
----------------------------------------
Per-user `stats_report_results.dominance_bitmap` blobs are NOT rebuilt by the
precompute; they are diffed against a freshly-computed bitmap by the stale
detector. Moving a straggler id desyncs any stored blob that referenced it,
flipping that scope stale once. Because only the NEW items live in the 6000s
range, the only affected users are those who already own a new item — exactly
the scopes that would go stale from the new item anyway. Original ids 1..N are
never moved, so every other stored bit stays aligned. We scan and log the exact
count for the record but do not block (one targeted stale fire is acceptable).

ORDER OF OPERATIONS ON STARTUP
------------------------------
apply_migrations runs BEFORE the startup precompute block. This migration
renumbers item_ids, clears the derived precompute tables, and clears the
precompute meta stamp so `precompute_is_stale` is guaranteed True. The
subsequent startup precompute_all then regenerates dominators / applicability /
runtime_eval at the NEW compact ids and writes the completion stamp.

Idempotent: after a successful run there are no ids > N, so a re-run is a no-op.
Self-contained (pure sqlite3 + stdlib) — migrations are loaded by file path, not
as package modules.
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
    """Count rows in `table` whose any of `columns` (BLOB) has a set bit at
    any position in `positions`. Returns 0 if the table/columns are absent."""
    if not positions or not _table_exists(cursor, table):
        return 0
    # Only select columns that actually exist.
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
        print("    item_ids table absent — skip compaction")
        return

    cursor.execute("SELECT id FROM item_ids ORDER BY id")
    ids = [row[0] for row in cursor.fetchall()]
    n = len(ids)
    if n == 0:
        print("    item_ids empty — skip compaction")
        return

    existing = set(ids)
    stragglers = sorted(i for i in ids if i > n)      # out-of-range (the 6000s)
    if not stragglers:
        print(f"    item_ids already dense (N={n}, MAX={max(ids)}) — skip compaction")
        return

    free_slots = sorted(i for i in range(1, n + 1) if i not in existing)
    # Invariant: exactly one free low slot per straggler.
    if len(free_slots) != len(stragglers):
        print(
            f"    ⚠️  compaction abort: {len(stragglers)} stragglers but "
            f"{len(free_slots)} free slots (expected equal) — leaving ids as-is"
        )
        return

    # Safety scan (informational): how many stored, NON-rebuilt bitmap blobs
    # reference an id we're about to move? Those scopes go stale once.
    affected_results = _count_blobs_referencing(
        cursor, "stats_report_results", ["dominance_bitmap"], stragglers
    )
    affected_stale = _count_blobs_referencing(
        cursor, "stats_report_stale_scopes",
        ["added_item_ids", "removed_item_ids"], stragglers,
    )
    print(
        f"    compaction: N={n}, MAX(id)={max(ids)}, moving {len(stragglers)} "
        f"straggler id(s) into free low slots"
    )
    print(
        f"    safety scan: {affected_results} stats_report_results row(s) and "
        f"{affected_stale} stale-scope row(s) reference a moved id "
        f"(these scopes will re-flag stale once — expected)"
    )

    # Renumber. Targets (free_slots, all <= n and unoccupied) are disjoint from
    # stragglers (all > n), so no PK collision at any step.
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

    # Clear derived precompute tables — they still reference the OLD ids until
    # the startup precompute_all rebuild regenerates them at the compact ids.
    # (scan_runtime_eval's full path does not delete stale rows, so we must.)
    for tbl in (
        "item_static_dominators",
        "item_applicability_lookup",
        "recipe_applicability_lookup",
        "items_requiring_runtime_eval",
    ):
        if _table_exists(cursor, tbl):
            cursor.execute(f"DELETE FROM {tbl}")

    # Clear the precompute completion stamp so precompute_is_stale is guaranteed
    # True on this startup regardless of the stored logic_version, forcing the
    # full rebuild that repopulates the derived tables at the new ids.
    if _table_exists(cursor, "stats_report_precompute_meta"):
        cursor.execute("DELETE FROM stats_report_precompute_meta")

    conn.commit()

    cursor.execute("SELECT MAX(id) FROM item_ids")
    new_max = cursor.fetchone()[0]
    print(
        f"    ✓ compacted item_ids: {n} rows, MAX(id) now {new_max} "
        f"(dense 1..{n}); derived tables cleared for rebuild"
    )
