CREATE TABLE IF NOT EXISTS notification_preferences (
    session_uuid TEXT PRIMARY KEY,
    global_announcements INTEGER NOT NULL DEFAULT 0,
    targeted_announcements INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
