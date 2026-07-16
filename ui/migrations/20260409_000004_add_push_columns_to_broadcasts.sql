ALTER TABLE broadcasts ADD COLUMN send_push INTEGER NOT NULL DEFAULT 0;
ALTER TABLE broadcasts ADD COLUMN push_title TEXT;
ALTER TABLE broadcasts ADD COLUMN push_message TEXT;
ALTER TABLE targeted_broadcasts ADD COLUMN send_push INTEGER NOT NULL DEFAULT 0;
ALTER TABLE targeted_broadcasts ADD COLUMN push_title TEXT;
ALTER TABLE targeted_broadcasts ADD COLUMN push_message TEXT;
