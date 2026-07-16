-- Add contributed_by column to generic definition tables
-- Stores the character name or tool name that created the definition
-- Used when publishing to Google Sheets, not displayed in our UI

ALTER TABLE generic_activities ADD COLUMN contributed_by TEXT DEFAULT NULL;
ALTER TABLE generic_recipes ADD COLUMN contributed_by TEXT DEFAULT NULL;
ALTER TABLE generic_services ADD COLUMN contributed_by TEXT DEFAULT NULL;
