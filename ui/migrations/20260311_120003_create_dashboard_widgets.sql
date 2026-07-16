-- Create dashboard_widgets table for persisting custom dashboard layout
CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    widget_id TEXT NOT NULL UNIQUE,
    widget_type TEXT NOT NULL,
    title TEXT NOT NULL,
    data_source TEXT NOT NULL,
    config_json TEXT,
    col INTEGER NOT NULL DEFAULT 0,
    row INTEGER NOT NULL DEFAULT 0,
    col_span INTEGER NOT NULL DEFAULT 1,
    row_span INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
