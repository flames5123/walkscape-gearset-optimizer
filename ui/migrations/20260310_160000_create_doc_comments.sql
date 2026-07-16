-- Create doc_comments table for inline document review comments
CREATE TABLE IF NOT EXISTS doc_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    selected_text TEXT NOT NULL,
    comment TEXT NOT NULL,
    line_num INTEGER,
    section TEXT,
    full_line TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_comments_doc ON doc_comments(doc_id);
