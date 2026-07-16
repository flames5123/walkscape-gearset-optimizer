-- Saved crafting tree presets
CREATE TABLE IF NOT EXISTS saved_crafting_trees (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    target_item_id TEXT NOT NULL,
    tree_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_saved_crafting_trees_session ON saved_crafting_trees(session_uuid);
