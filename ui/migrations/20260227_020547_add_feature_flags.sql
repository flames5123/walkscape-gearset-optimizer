-- Feature flags table for per-session feature access control
CREATE TABLE IF NOT EXISTS feature_flags (
    session_uuid TEXT NOT NULL,
    feature TEXT NOT NULL,
    enabled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled_by TEXT NOT NULL,
    PRIMARY KEY (session_uuid, feature)
);
