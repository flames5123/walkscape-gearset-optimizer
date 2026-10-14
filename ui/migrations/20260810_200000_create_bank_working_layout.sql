-- Per-session in-progress (unsaved) bank layout. Lets the SAME session reload the
-- layout it was last editing on any device (mobile/desktop), instead of the
-- previous browser-only localStorage. One row per session. Spec: .kiro/BANK_LAYOUT_SPEC.md
CREATE TABLE IF NOT EXISTS bank_working_layout (
    session_uuid TEXT PRIMARY KEY,
    layout_json TEXT NOT NULL DEFAULT '{}',   -- full working layout { name, tabs, settings, pins, ... }
    current_id TEXT,                          -- linked saved-preset id, or NULL when unsaved
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);
