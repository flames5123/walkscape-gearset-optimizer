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
#
# 2026-08-04 (jwbail [fix:stale-detection]) v3: forces one clean full rebuild on
# every deployed DB to re-heal applicability that got wedged by the old
# item_ids-membership staleness gate (new items were committed to item_ids
# before build_applicability ran, so precompute_is_stale falsely reported
# "fresh" and applicability was stranded at the pre-new-items count). The
# freshness signal is now a catalog-signature completion stamp written only
# after applicability finishes (see _catalog_signature / precompute_is_stale).
PRECOMPUTE_LOGIC_VERSION = 6
# 2026-08-11 (jwbail [fix:stale-detection]) v4: gated EQUIPMENT (explore_realm /
# item_ownership / total_collectibles) is now included in applicability +
# runtime-eval so stale detection tracks it. Bumped to force one clean rebuild
# so the new applicability bitmaps + items_requiring_runtime_eval regenerate.
# v5: precompute location matching is now REGION-AWARE (mirrors the optimizer's
# stats_mixin._location_matches) — a stat keyed at a region (e.g. 'jarvonia')
# applies to every activity whose location is in that region. Fixes fully-
# region-scoped items like the Quickdraw map showing 0 applicable scopes.
#
# 2026-09-28 (jwbail [fix:termite-effort]) v6: forces one clean full rebuild on
# every deployed DB after the 2026-09-28 game patch (new pets Termite/Sawmantis,
# new eggs, new activities/drop tables/locations). The tools-API rescrape path
# (ingest_all_from_tools_api.py) historically did not call refresh_after_scrape,
# so the deployed item_ids/applicability/dominators tables were stale and the
# goals report's "fastest new items" never surfaced the new eggs. The ingest
# path now refreshes precompute for local dev DBs; this version bump is the
# deployed-DB counterpart — precompute_is_stale flips on the mismatch and the
# startup self-heal rebuilds with the new catalog on the next testing/prod boot.


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


def _catalog_signature() -> str:
    """Stable hash of the full catalog's (slug, quality) membership.

    This is the input to the freshness gate: it changes iff the set of items
    the catalog defines changes (item added, removed, or a quality tier
    added/dropped). It is INDEPENDENT of the persisted item_ids table on
    purpose — the whole point of the 2026-08-04 fix is that the freshness
    signal must NOT be derivable from item_ids alone (which build_item_ids
    mutates as its very first phase, before dominators/applicability exist).
    Never raises — returns "" on any error so the caller fails safe (stale).
    """
    import hashlib
    try:
        from .build_item_ids import _enumerate_catalog_items
        pairs = sorted(f"{s}\x1f{q}" for s, q in _enumerate_catalog_items())
    except Exception:
        return ""
    h = hashlib.sha256("\x1e".join(pairs).encode("utf-8")).hexdigest()
    return h[:32]


def _read_precompute_signature(db) -> Optional[str]:
    try:
        db.execute(
            "CREATE TABLE IF NOT EXISTS stats_report_precompute_meta "
            "(key TEXT PRIMARY KEY, value TEXT)"
        )
        row = db.execute(
            "SELECT value FROM stats_report_precompute_meta WHERE key='catalog_signature'"
        ).fetchone()
        return row[0] if row and row[0] is not None else None
    except Exception:
        return None


def _write_precompute_signature(db, signature: str) -> None:
    """Write the completion stamp. Called ONLY at the successful end of a
    (re)build — after applicability is populated — so an interrupted rebuild
    never marks the catalog fresh."""
    try:
        db.execute(
            "CREATE TABLE IF NOT EXISTS stats_report_precompute_meta "
            "(key TEXT PRIMARY KEY, value TEXT)"
        )
        db.execute(
            "INSERT OR REPLACE INTO stats_report_precompute_meta (key, value) "
            "VALUES ('catalog_signature', ?)",
            (signature,),
        )
        db.commit()
    except Exception:
        pass


def precompute_is_stale(db) -> bool:
    """Return True when the precompute needs a (re)build.

    Freshness is gated on a COMPLETION STAMP, not on item_ids membership. The
    stamp (`catalog_signature` in stats_report_precompute_meta) is written only
    at the successful end of precompute_all / precompute_changed — after
    build_applicability has populated. `precompute_is_stale` returns True iff:

      * the stored logic_version != PRECOMPUTE_LOGIC_VERSION (code logic
        changed — force a rebuild), OR
      * the stored catalog_signature is missing or != the current catalog's
        signature (catalog changed, or no completed build has ever stamped).

    Why this instead of the old `catalog - item_ids` subset check: build_item_ids
    appends new (slug, quality) rows to item_ids as the FIRST phase of a
    rebuild. The old gate read item_ids, so as soon as those rows were committed
    the gate flipped to "fresh" — even if build_dominators / build_applicability
    never ran (crash, container SIGKILL, exception swallowed by the startup
    try/except). That stranded new items in item_ids but out of applicability
    permanently (1605 indexed, 1535 applicable). Keying freshness off a stamp
    written only after applicability completes makes that wedge impossible: a
    partial rebuild leaves the signal "stale" and the next startup retries.

    The signature captures additions AND removals; a removed item flips stale
    once, the completed rebuild restamps for the reduced catalog, and it settles
    (no perpetual stale). Never raises — returns True (rebuild) on any error so
    we fail safe.
    """
    if _read_precompute_logic_version(db) != PRECOMPUTE_LOGIC_VERSION:
        return True
    current = _catalog_signature()
    if not current:
        return True  # couldn't compute catalog — fail safe to rebuild
    stored = _read_precompute_signature(db)
    return stored != current


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
    # Completion stamp LAST — only a fully-built precompute (item_ids +
    # dominators + applicability) marks the catalog fresh. See precompute_is_stale.
    _write_precompute_signature(db, _catalog_signature())
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
    # Restamp on completion: build_applicability rebuilds every applicability
    # row (the incremental flag only gates the empty-row insert, not coverage),
    # so a completed incremental refresh has fully re-indexed the new items.
    _write_precompute_signature(db, _catalog_signature())
    return {
        "item_ids_inserted": n_ids,
        "runtime_eval_rows": n_eval,
        "dominators_rows": n_dom,
        "applicability_activity_rows": n_act,
        "applicability_recipe_rows": n_rec,
    }
