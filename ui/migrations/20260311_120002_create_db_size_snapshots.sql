-- Create db_size_snapshots table for tracking database file size over time
CREATE TABLE IF NOT EXISTS db_size_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    size_bytes INTEGER NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_db_size_recorded ON db_size_snapshots(recorded_at);
