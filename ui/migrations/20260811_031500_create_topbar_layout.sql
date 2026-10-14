-- Per-session top-bar / side-bar icon customization layout. Keyed by session UUID
-- (NOT browser localStorage) so the same session gets its customized header on any
-- device. One row per session. FAC-gated behind `topbar_customization`.
-- Feature spec: .kiro/specs/topbar-customization/design.md
CREATE TABLE IF NOT EXISTS topbar_layout (
    session_uuid TEXT PRIMARY KEY,
    layout_json TEXT NOT NULL DEFAULT '{}',   -- { topbar:{left:[],right:[]}, hidden:[], drawer:[], title:{enabled,text} }
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);
