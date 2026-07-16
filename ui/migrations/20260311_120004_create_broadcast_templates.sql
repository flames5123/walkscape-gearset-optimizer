-- Create broadcast_templates table for reusable broadcast messages
CREATE TABLE IF NOT EXISTS broadcast_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
