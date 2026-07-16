-- Add scheduling fields to broadcasts
ALTER TABLE broadcasts ADD COLUMN scheduled_at TIMESTAMP;
ALTER TABLE broadcasts ADD COLUMN expires_at TIMESTAMP;
