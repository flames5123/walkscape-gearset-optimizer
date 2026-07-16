"""runner — precompute orchestrators.

Two entry points:

  precompute_all(db)
    Full rebuild. Use at migration time and for one-off recovery.
    Idempotent — re-running with the same catalog is a no-op (or at worst,
    rewrites identical bitmaps).

  precompute_changed(db, changed_slugs)
    Incremental refresh. Only rebuilds rows affected by the given slugs:
      1. item_ids: append any new (slug, quality) pairs
      2. items_requiring_runtime_eval: re-scan changed slugs
      3. item_static_dominators: rebuild scopes touched by changed items
      4. item_applicability_lookup: rebuild rows for activities whose primary
         skill matches a scope touched by changed items
      5. recipe_applicability_lookup: same for recipes

    Pass an empty set if nothing changed (no-op).

Each scraper that emits items / activities / recipes calls
`precompute_changed(db, set_of_changed_slugs)` at the end of its run.
`scrape_all.py` calls `precompute_all(db)` instead so full-rebuild starts
clean.
"""

import time
from typing import Optional, Set


# 2026-06-16 (jwbail): bump when the dominance / effective-stats LOGIC changes
# (not just the catalog). precompute_is_stale compares this against the value
# stamped in stats_report_precompute_meta and forces a full rebuild on mismatch,
# so deployed DBs (testing + prod) self-heal on the next startup. v2: category-
# scoped stats (artisan/gathering/utility) are now included per-skill.
PRECOMPUTE_LOGIC_VERSION = 2


def _read_precompute_logic_version(db) -> int:
    try:
        db.execute(
            "CREATE TABLE IF NOT EXISTS stats_report_precompute_meta "
            "(key TEXT PRIMARY KEY, value TEXT)"
        )
        row = db.execute(
            "SELECT value FROM stats_report_precompute_meta WHERE key='logic_version'"
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    except Exception:
        return 0


def _write_precompute_logic_version(db) -> None:
    try:
        db.execute(
            "CREATE TABLE IF NOT EXISTS stats_report_precompute_meta "
            "(key TEXT PRIMARY KEY, value TEXT)"
        )
        db.execute(
            "INSERT OR REPLACE INTO stats_report_precompute_meta (key, value) "
            "VALUES ('logic_version', ?)",
            (str(PRECOMPUTE_LOGIC_VERSION),),
        )
        db.commit()
    except Exception:
        pass


def precompute_is_stale(db) -> bool:
    """Return True when the precompute needs a (re)build.

    Catalog-growth detection: compares the set of (slug, quality) pairs the
    catalog currently defines (build_item_ids._enumerate_catalog_items) against
    the pairs already indexed in item_ids. Stale iff the catalog has ANY pair
    not yet in item_ids — i.e. the catalog grew (or an item changed quality
    tiers / was renamed). This also covers the empty-DB case (every catalog
    pair is missing).

    Uses a subset check (catalog - stored), NOT exact equality, on purpose:
    item_ids is append-only (ids are never renumbered/deleted), so a REMOVED
    catalog item lingers harmlessly in item_ids. Equality would then flag stale
    on every startup forever (precompute_all never deletes the orphan row);
    the subset check ignores lingering removals and only triggers on growth.

    Note: this does NOT detect pure stat changes on an existing (slug, quality)
    — those don't alter the item_ids membership, only the dominators. Stat
    changes ship via a re-scrape (refresh_after_scrape -> precompute_all) or an
    OPTIMIZATION_VERSIONS bump (version_bump stale reason), which remain the
    source of truth for stat-level freshness.

    Never raises — returns True (rebuild) on any error so we fail safe.
    """
    # Logic-version mismatch forces a rebuild even when the catalog is
    # unchanged (e.g. _effective_stats_in_scope started including category-
    # scoped stats — the stored dominators are now wrong until rebuilt).
    if _read_precompute_logic_version(db) != PRECOMPUTE_LOGIC_VERSION:
        return True
    try:
        from .build_item_ids import _enumerate_catalog_items
        catalog = set(_enumerate_catalog_items())
    except Exception:
        return True
    if not catalog:
        return False  # nothing to index (defensive; shouldn't happen)
    try:
        cur = db.cursor()
        cur.execute("SELECT import_name, quality FROM item_ids")
        stored = {(r[0], r[1]) for r in cur.fetchall()}
    except Exception:
        return True
    return bool(catalog - stored)


def precompute_all(db, migration_id: Optional[str] = None) -> dict:
    """Full rebuild of every precomputed table.

    Args:
        db: sqlite3 connection
        migration_id: stamped into item_ids.added_in_migration. Defaults to
                      a YYYYMMDD_HHMMSS string.

    Returns:
        dict with counts per phase.
    """
    if migration_id is None:
        migration_id = time.strftime("%Y%m%d_%H%M%S")

    from .build_item_ids import build_item_ids
    from .scan_runtime_eval import scan_runtime_eval
    from .build_dominators import build_static_dominators
    from .build_applicability import build_applicability

    print("[stats_report precompute] Full rebuild starting")
    t0 = time.time()

    n_ids = build_item_ids(db, migration_id, changed_slugs=None)
    t1 = time.time()
    print(f"  build_item_ids: {n_ids} new rows ({t1 - t0:.2f}s)")

    n_eval = scan_runtime_eval(db, changed_slugs=None)
    t2 = time.time()
    print(f"  scan_runtime_eval: {n_eval} rows ({t2 - t1:.2f}s)")

    n_dom = build_static_dominators(db, changed_slugs=None, full_rebuild=True)
    t3 = time.time()
    print(f"  build_static_dominators: {n_dom} rows ({t3 - t2:.2f}s)")

    n_act, n_rec = build_applicability(db, changed_slugs=None, full_rebuild=True)
    t4 = time.time()
    print(f"  build_applicability: {n_act} activity rows, {n_rec} recipe rows ({t4 - t3:.2f}s)")

    print(f"[stats_report precompute] Full rebuild done ({t4 - t0:.2f}s total)")
    _write_precompute_logic_version(db)
    return {
        "item_ids_inserted": n_ids,
        "runtime_eval_rows": n_eval,
        "dominators_rows": n_dom,
        "applicability_activity_rows": n_act,
        "applicability_recipe_rows": n_rec,
    }


def precompute_changed(
    db, changed_slugs: Set[str], migration_id: Optional[str] = None
) -> dict:
    """Incremental refresh restricted to scopes touched by changed_slugs.

    Args:
        db: sqlite3 connection
        changed_slugs: set of item slugs (lowercase) that changed in the
                       most recent scraper run. Pass empty set for a no-op.
        migration_id: stamped into item_ids.added_in_migration for any newly
                      inserted rows. Defaults to current time.

    Returns:
        dict with counts per phase.
    """
    if not changed_slugs:
        return {
            "item_ids_inserted": 0,
            "runtime_eval_rows": 0,
            "dominators_rows": 0,
            "applicability_activity_rows": 0,
            "applicability_recipe_rows": 0,
        }

    if migration_id is None:
        migration_id = time.strftime("%Y%m%d_%H%M%S")

    from .build_item_ids import build_item_ids
    from .scan_runtime_eval import scan_runtime_eval
    from .build_dominators import build_static_dominators
    from .build_applicability import build_applicability

    t0 = time.time()
    print(f"[stats_report precompute] Incremental refresh ({len(changed_slugs)} slugs)")

    n_ids = build_item_ids(db, migration_id, changed_slugs=changed_slugs)
    n_eval = scan_runtime_eval(db, changed_slugs=changed_slugs)
    n_dom = build_static_dominators(db, changed_slugs=changed_slugs, full_rebuild=False)
    n_act, n_rec = build_applicability(db, changed_slugs=changed_slugs, full_rebuild=False)

    t1 = time.time()
    print(
        f"[stats_report precompute] Incremental done ({t1 - t0:.2f}s): "
        f"+{n_ids} ids, {n_eval} eval, {n_dom} dom, {n_act}+{n_rec} app"
    )
    return {
        "item_ids_inserted": n_ids,
        "runtime_eval_rows": n_eval,
        "dominators_rows": n_dom,
        "applicability_activity_rows": n_act,
        "applicability_recipe_rows": n_rec,
    }
