-- Walkdle "Guess the Item" daily-puzzle attempt persistence.
-- One row per (session_uuid, puzzle_date, mode). state_json holds the
-- guesses-so-far + solved/failed flags + the resolved target item id (pinned
-- on first play so a session's history is stable even if the catalog grows).
CREATE TABLE IF NOT EXISTS daily_puzzle_attempts (
    session_uuid TEXT NOT NULL,
    puzzle_date  TEXT NOT NULL,   -- UTC YYYY-MM-DD (the daily seed key)
    mode         TEXT NOT NULL,   -- game mode id, e.g. 'guess_item'
    state_json   TEXT NOT NULL DEFAULT '{}',
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_uuid, puzzle_date, mode)
);

CREATE INDEX IF NOT EXISTS idx_walkdle_session ON daily_puzzle_attempts(session_uuid);
