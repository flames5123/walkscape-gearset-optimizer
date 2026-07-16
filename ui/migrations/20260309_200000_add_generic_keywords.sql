-- Migration: Add generic_keywords table for community keyword definitions
-- Keywords track whether a keyword is "banned" (unique per gearset — only 1 tool allowed)
-- Synced from Google Sheets Keywords tab

CREATE TABLE IF NOT EXISTS generic_keywords (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    banned INTEGER NOT NULL DEFAULT 1,
    icon TEXT DEFAULT NULL,
    contributed_by TEXT DEFAULT NULL,
    source TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generic_keywords_name ON generic_keywords(name);
CREATE INDEX IF NOT EXISTS idx_generic_keywords_source ON generic_keywords(source);
