-- Create pinned_saves table for saving named pin layouts.
-- Mirrors the structure of optimization_presets (see 20260224_120000_add_optimization_presets.sql).
CREATE TABLE IF NOT EXISTS pinned_saves (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    pin_paths_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
    UNIQUE(session_uuid, name)
);

CREATE INDEX IF NOT EXISTS idx_pinned_saves_session ON pinned_saves(session_uuid);
