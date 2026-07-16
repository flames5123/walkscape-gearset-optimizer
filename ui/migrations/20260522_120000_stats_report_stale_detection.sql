-- Stats Report Stale Detection — schema migration
--
-- Adds 8 new tables supporting the stats report stale-detection feature.
-- See .kiro/specs/stats-report-stale-detection/{requirements,design,tasks}.md
--
-- Note: this codebase does NOT set PRAGMA foreign_keys = ON, so FK
-- constraints below are decorative (not enforced). Cleanup of per-session
-- rows on session delete is handled explicitly by ui/database.py:delete_session
-- (extended by the companion Python migration to include the new tables).

-- ── Table 1: master index (append-only) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS item_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_name TEXT NOT NULL,
    quality TEXT NOT NULL,
    added_in_migration TEXT NOT NULL,
    UNIQUE (import_name, quality)
);

CREATE INDEX IF NOT EXISTS idx_item_ids_lookup
    ON item_ids (import_name, quality);


-- ── Table 2: precomputed static dominators ──────────────────────────────────

CREATE TABLE IF NOT EXISTS item_static_dominators (
    item_id INTEGER NOT NULL,
    skill TEXT NOT NULL,
    location TEXT NOT NULL,
    quality_mode TEXT NOT NULL,            -- 'activity' | 'recipe_quality' | 'recipe_non_quality'
    dominators_bitmap BLOB NOT NULL,
    last_computed_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, skill, location, quality_mode),
    FOREIGN KEY (item_id) REFERENCES item_ids(id)
);

CREATE INDEX IF NOT EXISTS idx_dominators_scope
    ON item_static_dominators (skill, location, quality_mode);


-- ── Table 3: items requiring runtime evaluation ─────────────────────────────

CREATE TABLE IF NOT EXISTS items_requiring_runtime_eval (
    item_id INTEGER PRIMARY KEY,
    reason TEXT NOT NULL,                  -- 'custom_stat' | 'ap_dependent' | future kinds
    FOREIGN KEY (item_id) REFERENCES item_ids(id)
);


-- ── Table 4: per-(activity, location) applicability ─────────────────────────

CREATE TABLE IF NOT EXISTS item_applicability_lookup (
    activity_name TEXT NOT NULL,
    location TEXT NOT NULL,
    applicable_item_bitmap BLOB NOT NULL,
    last_computed_at INTEGER NOT NULL,
    PRIMARY KEY (activity_name, location)
);


-- ── Table 5: per-(recipe, location, service) applicability ──────────────────

CREATE TABLE IF NOT EXISTS recipe_applicability_lookup (
    recipe_name TEXT NOT NULL,
    location TEXT NOT NULL,
    service TEXT NOT NULL,                 -- 'NONE' for no-service recipes
    applicable_item_bitmap BLOB NOT NULL,
    last_computed_at INTEGER NOT NULL,
    PRIMARY KEY (recipe_name, location, service)
);


-- ── Table 6: per-user incremental results ───────────────────────────────────
-- Replaces the legacy stats_report_runs.results_json blob (R16: unreleased,
-- so destructive reshape is OK). The companion Python migration drops the
-- legacy column.

CREATE TABLE IF NOT EXISTS stats_report_results (
    session_uuid TEXT NOT NULL,
    category TEXT NOT NULL,                -- 'xp' | 'coins' | 'chests' | 'chests_recipes' | 'new_items'
    subcategory TEXT NOT NULL,             -- skill | chest_name | item_kind
    source_name TEXT NOT NULL,             -- activity_name OR recipe_name (kind implied by category)
    location TEXT NOT NULL,
    service TEXT NOT NULL,                 -- 'NONE' for activities or no-service recipes
    rank INTEGER NOT NULL,
    metric_value REAL NOT NULL,
    metric_name TEXT NOT NULL,
    export_string TEXT NOT NULL,
    dominance_bitmap BLOB NOT NULL,
    metric_inputs_hash TEXT NOT NULL,      -- SHA256 hex truncated to 16 chars
    optimization_version INTEGER NOT NULL, -- value of OPTIMIZATION_VERSIONS[category] at write time
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (session_uuid, category, subcategory, source_name, location, service),
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_stats_report_results_session
    ON stats_report_results (session_uuid);

CREATE INDEX IF NOT EXISTS idx_stats_report_results_lookup
    ON stats_report_results (session_uuid, category, subcategory);


-- ── Table 7: stale scope cache (populated by detect_stale_scopes) ───────────

CREATE TABLE IF NOT EXISTS stats_report_stale_scopes (
    session_uuid TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    source_name TEXT NOT NULL,
    location TEXT NOT NULL,
    service TEXT NOT NULL,
    reason TEXT NOT NULL,                  -- 'item_change' | 'input_change' | 'version_bump' | 'newly_unlocked'
    added_item_ids BLOB,                   -- bitmap of newly-applicable item ids (NULL for non-item-change)
    removed_item_ids BLOB,                 -- bitmap of no-longer-applicable item ids (NULL for non-item-change)
    detected_at INTEGER NOT NULL,
    PRIMARY KEY (session_uuid, category, subcategory, source_name, location, service),
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_stats_report_stale_scopes_session
    ON stats_report_stale_scopes (session_uuid);


-- ── Table 8: character state snapshot cache ─────────────────────────────────
-- Stores the last-seen CharacterStateSnapshot per session so
-- detect_stale_scopes can diff prev vs curr.

CREATE TABLE IF NOT EXISTS character_state_snapshot_cache (
    session_uuid TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);
