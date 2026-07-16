-- Notepad feature: server-side multi-note rich-text notes (FAC-gated).
-- One row per note; content_json holds the Quill Delta (entity links live
-- inside as custom embeds). title is derived server-side from the first
-- non-empty line of plain text (else 'Untitled'). See .kiro/NOTEPAD_SPEC.md.
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,                       -- uuid4
    session_uuid TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled',
    content_json TEXT NOT NULL DEFAULT '{}',   -- Quill Delta JSON
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_session_updated
    ON notes(session_uuid, updated_at DESC);

-- Remembers which note a session had selected so reopening returns to it.
CREATE TABLE IF NOT EXISTS notepad_state (
    session_uuid TEXT PRIMARY KEY,
    selected_note_id TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
