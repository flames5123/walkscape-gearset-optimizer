-- Active Debug Links: lets the admin link a bug-report snapshot session to
-- their main session so the main site nav shows a "swap session" caterpillar
-- button. Single active link per main session — POST replaces any existing
-- row for the same main_session_uuid (handled in the API layer).
--
-- When the bug-report is reviewed, mark_report_reviewed() calls
-- delete_session(snapshot_session_uuid). database.delete_session() also
-- DELETEs from this table by snapshot_session_uuid so the link auto-clears
-- and the nav button disappears on next reload.
CREATE TABLE IF NOT EXISTS active_debug_links (
    main_session_uuid TEXT PRIMARY KEY,
    snapshot_session_uuid TEXT NOT NULL,
    bug_report_id TEXT,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_active_debug_links_snapshot
    ON active_debug_links(snapshot_session_uuid);
