-- Achievement Tracker: per-session progress (manual check-offs + reward reveals).
-- One row per session; `data` holds a JSON blob, e.g.:
--   { "checked":  { "<achId>": true | { "<reqIndex>": true, "shop:<shopId>": true } },
--     "revealed": { "<achId>": true } }
-- Stores MANUAL state only. Auto-detected completion (skills/wealth/level/steps/
-- item-has), the custom-stat mirror, and parent->child auto-check are computed on
-- the client (which owns the custom-stats store the optimizer reads).
CREATE TABLE IF NOT EXISTS achievement_progress (
    session_uuid TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
