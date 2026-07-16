-- Add admin_notes, created_at, and inventory_value to sessions
ALTER TABLE sessions ADD COLUMN admin_notes TEXT;
ALTER TABLE sessions ADD COLUMN created_at TIMESTAMP;
ALTER TABLE sessions ADD COLUMN inventory_value INTEGER;
