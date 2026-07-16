-- Crafting optimization poll: one vote per session UUID, upsert on re-submit.
-- Stores user's answers to the /craftingpoll survey about the new X-per-Y dropdown design.

CREATE TABLE IF NOT EXISTS crafting_poll_votes (
    session_uuid TEXT PRIMARY KEY,
    character_name TEXT,
    -- JSON blob: { q1: ..., q2: ..., q3: ..., q4: ..., q5: ..., q6: ..., q7: ... }
    answers_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crafting_poll_updated ON crafting_poll_votes(updated_at);
