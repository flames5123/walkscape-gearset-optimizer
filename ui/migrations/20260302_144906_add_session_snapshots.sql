-- Session snapshots table for admin-created snapshots
CREATE TABLE IF NOT EXISTS session_snapshots (
    id TEXT PRIMARY KEY,
    original_session_uuid TEXT NOT NULL,
    snapshot_session_uuid TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL DEFAULT 'admin',
    FOREIGN KEY (original_session_uuid) REFERENCES sessions(uuid),
    FOREIGN KEY (snapshot_session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_original ON session_snapshots(original_session_uuid);
