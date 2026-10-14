"""Prune orphan item_ids rows + re-compact (2026-08-11, jwbail [fix:stale-detection]).

WHY
---
`item_ids` is append-only: when the game renames an item, its NEW slug is
appended as a fresh row but its OLD slug lingers forever as a dead duplicate.
So a pure rename (no stat change) shows up as TWO rows — observed live:
    adventurers_guild_buckler  +  adventuring_buckler
    travelers_kit              +  travellers_kit
    camouflage_cape            +  leaf_cape
(1614 rows vs 1611 real catalog pairs = 3 orphans). Removed items linger the
same way. The companion change adds a self-healing orphan prune to
`build_item_ids` for future renames; this one-time migration cleans the rows
already present and re-densifies.

WHAT IT DOES
------------
1. Delete item_ids rows whose (import_name, quality) is no longer in the
   current catalog (`_enumerate_catalog_items`). Fail-safe: if the catalog
   can't be imported, skip the prune (never delete blindly) and just compact.
2. Compact: move any id > N (row count after prune) into the freed low slots,
   leaving 1..N ids untouched; reset sqlite_sequence to N.
3. Clear the derived precompute tables + wipe the completion stamp so the
   startup precompute_all rebuilds dominators/applicability at the compact ids.

Deleting an orphan only removes a DEAD id — live items keep their ids, so every
live item's bit position in stored bitmaps stays aligned. A per-user
dominance_bitmap that referenced a pruned (old-slug) id flips that scope stale
once (the item is now owned under the new slug/id) — the intended, low-blast
signal, same as the earlier compaction.

Idempotent: no orphans AND already dense => no-op.
Self-contained (pure sqlite3 + stdlib) apart from the optional catalog import.
"""


def _table_exists(cursor, name):
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
    )
    return cursor.fetchone() is not None


def _catalog_pairs():
    """Return the set of current (slug, quality) catalog pairs, or None on any
    import failure (caller then skips the prune to avoid blind deletes)."""
    try:
        import sys
        if "/app" not in sys.path:
            sys.path.insert(0, "/app")
        from util.stats_report.precompute.build_item_ids import _enumerate_catalog_items
        return set(_enumerate_catalog_items())
    except Exception as e:
        print(f"    (catalog import failed: {e} — skipping orphan prune)")
        return None


def _prune_orphans(cursor, catalog_pairs):
    """Delete item_ids rows whose (import_name, quality) not in catalog_pairs.
    Returns the number of rows deleted. No-op if catalog_pairs is None."""
    if not catalog_pairs:
        return 0
    rows = cursor.execute("SELECT import_name, quality FROM item_ids").fetchall()
    orphans = [(nm, q) for nm, q in rows if (nm, q) not in catalog_pairs]
    for nm, q in orphans:
        cursor.execute(
            "DELETE FROM item_ids WHERE import_name = ? AND quality = ?", (nm, q)
        )
    if orphans:
        print(f"    pruned {len(orphans)} orphan item_ids row(s): "
              f"{sorted(nm for nm, _ in orphans)}")
    return len(orphans)


def _compact(conn, cursor):
    """Move id > N stragglers into free low slots, reset sqlite_sequence, clear
    derived precompute tables + meta. No-op if already dense. Returns True if it
    changed anything."""
    ids = [r[0] for r in cursor.execute("SELECT id FROM item_ids ORDER BY id")]
    n = len(ids)
    if n == 0:
        return False
    existing = set(ids)
    stragglers = sorted(i for i in ids if i > n)
    if stragglers:
        free_slots = sorted(i for i in range(1, n + 1) if i not in existing)
        if len(free_slots) != len(stragglers):
            print(f"    ⚠️  compact abort: {len(stragglers)} stragglers vs "
                  f"{len(free_slots)} free slots — leaving ids as-is")
            return False
        for old_id, new_id in zip(stragglers, free_slots):
            cursor.execute("UPDATE item_ids SET id = ? WHERE id = ?", (new_id, old_id))
    # Reset AUTOINCREMENT high-water mark so future appends resume at n+1.
    if _table_exists(cursor, "sqlite_sequence"):
        cursor.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = 'item_ids'", (n,))
        if cursor.rowcount == 0:
            cursor.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('item_ids', ?)", (n,))
    # Clear derived precompute tables + completion stamp -> startup rebuild.
    for tbl in ("item_static_dominators", "item_applicability_lookup",
                "recipe_applicability_lookup", "items_requiring_runtime_eval",
                "stats_report_precompute_meta"):
        if _table_exists(cursor, tbl):
            cursor.execute(f"DELETE FROM {tbl}")
    return True


def run(conn):
    cursor = conn.cursor()
    if not _table_exists(cursor, "item_ids"):
        print("    item_ids table absent — skip")
        return

    catalog = _catalog_pairs()
    pruned = _prune_orphans(cursor, catalog)

    ids = [r[0] for r in cursor.execute("SELECT id FROM item_ids ORDER BY id")]
    n = len(ids)
    mx = max(ids) if ids else 0
    if pruned == 0 and n == mx:
        print(f"    item_ids clean + dense (N={n}, MAX={mx}) — no changes")
        conn.commit()
        return

    _compact(conn, cursor)
    conn.commit()

    ids = [r[0] for r in cursor.execute("SELECT id FROM item_ids ORDER BY id")]
    print(f"    ✓ item_ids now {len(ids)} rows, MAX(id)={max(ids) if ids else 0} "
          f"(pruned {pruned}); derived tables cleared for rebuild")
