-- Track active optimizations so they survive uvicorn reloads
CREATE TABLE IF NOT EXISTS active_optimizations (
    session_uuid TEXT PRIMARY KEY,
    opt_type TEXT NOT NULL,
    opt_id TEXT NOT NULL,
    pid INTEGER,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
