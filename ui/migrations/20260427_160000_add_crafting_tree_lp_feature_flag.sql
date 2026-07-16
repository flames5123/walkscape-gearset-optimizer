-- Register the `crafting_tree_lp` feature flag for per-session gating.
--
-- The feature_flags table uses per-session enrollment (presence of a row
-- means the feature is enabled for that session). There is no
-- "enabled_globally" concept in our schema, so this migration is primarily
-- a registration marker: admins use the FAC panel to opt specific sessions
-- in. No rows are inserted globally — enablement happens via the admin UI.
--
-- This migration is idempotent: it records itself in schema_migrations but
-- makes no schema changes.

-- No-op SELECT keeps this file valid SQL without altering any data.
SELECT 1 WHERE 1 = 0;
