-- Seed comparison_view feature flag for the two initial sessions
INSERT OR IGNORE INTO feature_flags (session_uuid, feature, enabled_by, enabled_at)
VALUES
    ('00000000-0000-0000-0000-000000000000', 'comparison_view', 'hardcoded', datetime('now')),
    ('d9226c9c-05ff-414d-81ee-b87c14fa844c', 'comparison_view', 'hardcoded', datetime('now'));
