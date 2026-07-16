-- Add travel_config table for persisting Travel_Config_Store per session
CREATE TABLE IF NOT EXISTS travel_config (
    session_uuid TEXT PRIMARY KEY,
    config_json  TEXT NOT NULL DEFAULT '{}',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);
