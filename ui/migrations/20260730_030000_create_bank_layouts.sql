-- Bank Layout Simulator (behind bank_layouts FAC). Spec: .kiro/BANK_LAYOUT_SPEC.md

-- Saved bank layouts (unlimited per session). Community sharing via is_shared/share_id.
CREATE TABLE IF NOT EXISTS bank_layouts (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'community' | 'default'
    schema_version INTEGER NOT NULL DEFAULT 1,
    settings_json TEXT NOT NULL DEFAULT '{}',
    layout_json TEXT NOT NULL DEFAULT '{}', -- { tabs: [...] }
    is_shared INTEGER NOT NULL DEFAULT 0,
    share_id TEXT,                          -- set when published to community
    search_text TEXT NOT NULL DEFAULT '',   -- name + tab/category names + filters (for search)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_bank_layouts_session ON bank_layouts(session_uuid);
CREATE INDEX IF NOT EXISTS idx_bank_layouts_shared ON bank_layouts(is_shared);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_layouts_share_id ON bank_layouts(share_id);

-- Self-tracking placeholder-history store (spec §11): remembers where an item last
-- lived per session, so we can re-place it when it returns even if the game export
-- does not carry historical placeholders. One row per (session, item).
CREATE TABLE IF NOT EXISTS bank_item_history (
    session_uuid TEXT NOT NULL,
    item_id TEXT NOT NULL,
    tab_id TEXT,
    cat_id TEXT,
    order_index INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_uuid, item_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_item_history_session ON bank_item_history(session_uuid);

-- Global key/value config for the bank feature (e.g. the community-share-search
-- kill switch). Durable across redeploys.
CREATE TABLE IF NOT EXISTS bank_config (
    key TEXT PRIMARY KEY,
    value TEXT
);
