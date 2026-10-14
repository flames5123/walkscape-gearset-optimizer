-- Register the `fastest_craft_goals` feature flag for per-session gating.
--
-- The feature_flags table uses per-session enrollment (presence of a row
-- means the feature is enabled for that session). There is no
-- "enabled_globally" concept in our schema, so this migration is primarily
-- a registration marker: admins use the FAC panel to opt specific sessions
-- in. The owner's UUID is also hardcoded in database.py
-- (_FASTEST_CRAFT_GOALS_ALWAYS_ENABLED) for dev/testing access. No rows are
-- inserted globally — enablement happens via the admin UI or the hardcoded
-- list.
--
-- Feature: the "Fastest Craft" optimized-goals-report category. See
-- .kiro/specs/fastest-craft/ (requirements R1).
--
-- This migration is idempotent: it records itself in schema_migrations but
-- makes no schema changes.

-- No-op SELECT keeps this file valid SQL without altering any data.
SELECT 1 WHERE 1 = 0;
