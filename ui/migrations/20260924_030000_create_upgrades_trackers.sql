-- Item Upgrades Tracker (FAC-gated: upgrades_tracker). Spec: .kiro/specs/item-upgrades-tracker/
--
-- A tracker is an ordered list of "entries" (each an added source: a goals-report
-- Fastest-new-item target, a crafting tree, or a gear set), stored as JSON.
--
-- OQ-7 (RESOLVED, option a): the per-session WORKING draft is a reserved row in this
-- SAME table (is_working=1), keyed by session via a partial unique index — one working
-- row per session. Named/saved trackers are is_working=0.
CREATE TABLE IF NOT EXISTS upgrades_trackers (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT,                              -- NULL/empty for the working draft
    entries_json TEXT NOT NULL DEFAULT '[]',
    is_working INTEGER NOT NULL DEFAULT 0,  -- 1 = the session's working draft row
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_upgrades_trackers_session ON upgrades_trackers(session_uuid);

-- Exactly one working row per session (the "reserved row keyed by session").
CREATE UNIQUE INDEX IF NOT EXISTS idx_upgrades_trackers_working
    ON upgrades_trackers(session_uuid) WHERE is_working = 1;
