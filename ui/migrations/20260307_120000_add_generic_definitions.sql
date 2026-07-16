-- Migration: Add generic definitions tables for user-defined activities, recipes, and services
-- Supports save/load/share of custom definitions when wiki data isn't available

CREATE TABLE IF NOT EXISTS generic_activities (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    skill TEXT NOT NULL,
    location TEXT NOT NULL,
    base_steps INTEGER NOT NULL,
    base_xp REAL NOT NULL DEFAULT 0,
    max_efficiency REAL NOT NULL,
    required_level INTEGER NOT NULL DEFAULT 1,
    is_public INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generic_activities_session ON generic_activities(session_uuid);
CREATE INDEX IF NOT EXISTS idx_generic_activities_public ON generic_activities(is_public);

CREATE TABLE IF NOT EXISTS generic_recipes (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    skill TEXT NOT NULL,
    base_steps INTEGER NOT NULL,
    base_xp REAL NOT NULL DEFAULT 0,
    max_efficiency REAL NOT NULL,
    required_level INTEGER NOT NULL DEFAULT 1,
    service_id TEXT DEFAULT NULL,
    is_public INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generic_recipes_session ON generic_recipes(session_uuid);
CREATE INDEX IF NOT EXISTS idx_generic_recipes_public ON generic_recipes(is_public);

CREATE TABLE IF NOT EXISTS generic_services (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    skill TEXT NOT NULL,
    location TEXT NOT NULL,
    stats_json TEXT NOT NULL DEFAULT '{}',
    is_public INTEGER NOT NULL DEFAULT 1,
    source TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generic_services_session ON generic_services(session_uuid);
CREATE INDEX IF NOT EXISTS idx_generic_services_public ON generic_services(is_public);
