-- Clean up snapshot sessions for all reviewed bug reports
-- These sessions were created as frozen snapshots when bug reports were submitted
-- and are no longer needed after the report has been reviewed.

-- Delete gear_sets belonging to snapshot sessions of reviewed bug reports
DELETE FROM gear_sets WHERE session_uuid IN (
    SELECT snapshot_session_uuid FROM bug_reports WHERE reviewed = 1
);

-- Delete debug_sessions entries for snapshot sessions (unlikely but safe)
DELETE FROM debug_sessions WHERE session_uuid IN (
    SELECT snapshot_session_uuid FROM bug_reports WHERE reviewed = 1
);

-- Delete broadcast_dismissals for snapshot sessions
DELETE FROM broadcast_dismissals WHERE session_uuid IN (
    SELECT snapshot_session_uuid FROM bug_reports WHERE reviewed = 1
);

-- Delete the snapshot sessions themselves
DELETE FROM sessions WHERE uuid IN (
    SELECT snapshot_session_uuid FROM bug_reports WHERE reviewed = 1
);
