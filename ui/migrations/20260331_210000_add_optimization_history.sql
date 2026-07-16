-- Track completed optimization runs for performance monitoring
CREATE TABLE IF NOT EXISTS optimization_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_uuid TEXT NOT NULL,
    opt_type TEXT,
    opt_id TEXT,
    duration_ms INTEGER,
    exit_code INTEGER,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_opt_history_session ON optimization_history(session_uuid);
CREATE INDEX IF NOT EXISTS idx_opt_history_completed ON optimization_history(completed_at);
