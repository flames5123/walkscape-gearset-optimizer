-- Bug report notes (ticket-style comment chain).
-- Append-only timeline. Replies allowed (parent_note_id self-FK).
-- Authors are self-reported strings (e.g. 'meshclaw', 'jwbail') with an
-- optional thread_title that lets an agent identify its own thread when
-- replying to itself in a future session.
CREATE TABLE IF NOT EXISTS bug_report_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL,
    parent_note_id INTEGER,
    author TEXT NOT NULL,
    thread_title TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES bug_reports(id),
    FOREIGN KEY (parent_note_id) REFERENCES bug_report_notes(id)
);

CREATE INDEX IF NOT EXISTS idx_bug_report_notes_report ON bug_report_notes(report_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bug_report_notes_parent ON bug_report_notes(parent_note_id);
