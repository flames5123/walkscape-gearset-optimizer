-- Named session groups for targeted announcements and feature flags
CREATE TABLE IF NOT EXISTS session_groups (
    name TEXT PRIMARY KEY,
    session_uuids TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL
);
