-- Migration: Add generic_items table for user-defined custom equipment items
-- Extends the generic definitions system (activities, recipes, services) to support items

CREATE TABLE IF NOT EXISTS generic_items (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '⚡',
    icon_color TEXT DEFAULT NULL,
    slot TEXT NOT NULL,
    keywords TEXT DEFAULT '[]',
    stats_json TEXT NOT NULL DEFAULT '{}',
    quality_stats_json TEXT DEFAULT NULL,
    rarity TEXT DEFAULT 'common',
    is_crafted INTEGER DEFAULT 0,
    is_public INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT NULL,
    contributed_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generic_items_session ON generic_items(session_uuid);
CREATE INDEX IF NOT EXISTS idx_generic_items_public ON generic_items(is_public);
