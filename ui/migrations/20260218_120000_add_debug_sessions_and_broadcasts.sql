-- Create debug_sessions table for remote debug mode toggling
CREATE TABLE IF NOT EXISTS debug_sessions (
    session_uuid TEXT PRIMARY KEY,
    enabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled_by TEXT NOT NULL
);

-- Create broadcasts table for admin broadcast messages
CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    active BOOLEAN DEFAULT 1
);

-- Create broadcast_dismissals table for per-session dismissal tracking
CREATE TABLE IF NOT EXISTS broadcast_dismissals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id TEXT NOT NULL,
    session_uuid TEXT NOT NULL,
    dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(broadcast_id, session_uuid)
);
