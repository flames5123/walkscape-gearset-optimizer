-- Add optimization_presets table for saving named optimization configurations
CREATE TABLE IF NOT EXISTS optimization_presets (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    preset_type TEXT NOT NULL,  -- 'activity' or 'recipe'
    sorting_json TEXT NOT NULL, -- JSON array of [metric_key, weight] tuples
    include_consumables INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid),
    UNIQUE(session_uuid, name, preset_type)
);

CREATE INDEX IF NOT EXISTS idx_presets_session_type ON optimization_presets(session_uuid, preset_type);
