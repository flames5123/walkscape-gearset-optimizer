CREATE TABLE IF NOT EXISTS push_notification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id TEXT,
    targeted_broadcast_id TEXT,
    session_uuid TEXT NOT NULL,
    endpoint_hash TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status_code INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_events_broadcast ON push_notification_events(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_push_events_targeted ON push_notification_events(targeted_broadcast_id);
