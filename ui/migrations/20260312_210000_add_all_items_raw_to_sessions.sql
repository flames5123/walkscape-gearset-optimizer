-- Store full inventory with quantities as a separate column (not sent to frontend)
ALTER TABLE sessions ADD COLUMN all_items_raw TEXT;
