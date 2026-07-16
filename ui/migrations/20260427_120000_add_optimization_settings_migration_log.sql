-- Track deprecated activity metric migrations/removals per session.
-- Populated by the sorting normalization path in app.py when a session's
-- saved activity sorting contains legacy keys (steps_for_chest,
-- steps_for_fine_material, steps_for_collectible) or their already-migrated
-- cat-targeted equivalents (cat:chests, cat:fine, cat:collectibles).
--
-- Action values:
--   'removed'  — the 3 entries were pristine (weight 100, no target, in
--                default relative order) and not in the top 5 positions,
--                so they were stripped from the saved list.
--   'migrated' — pristine entries in the top 5 were migrated to the new
--                cat-targeted steps_per_reward_roll format.
--   'custom'   — entries were non-pristine (customized weights, targets,
--                or order) and migrated with their customizations preserved.

CREATE TABLE IF NOT EXISTS optimization_settings_migration_log (
    session_uuid TEXT PRIMARY KEY,
    migrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    action TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_opt_migration_action
    ON optimization_settings_migration_log(action);

CREATE INDEX IF NOT EXISTS idx_opt_migration_at
    ON optimization_settings_migration_log(migrated_at);
