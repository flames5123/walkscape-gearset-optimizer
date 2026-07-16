-- Add icon (emoji) column to generic definition tables
ALTER TABLE generic_activities ADD COLUMN icon TEXT DEFAULT '⚡';
ALTER TABLE generic_recipes ADD COLUMN icon TEXT DEFAULT '⚡';
ALTER TABLE generic_services ADD COLUMN icon TEXT DEFAULT '⚡';
