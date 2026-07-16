-- Targeted broadcasts — announcements visible only to specific sessions
CREATE TABLE IF NOT EXISTS targeted_broadcasts (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    session_uuids TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    active BOOLEAN DEFAULT 1
);
