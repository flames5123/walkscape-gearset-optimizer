-- Color theme presets (section line colors for crafting tree)
CREATE TABLE IF NOT EXISTS color_theme_presets (
    id TEXT PRIMARY KEY,
    session_uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    line_colors TEXT NOT NULL,
    custom_colors TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_uuid) REFERENCES sessions(uuid)
);

CREATE INDEX IF NOT EXISTS idx_color_theme_presets_session ON color_theme_presets(session_uuid);
