-- Add secondary_xp_json column to generic_activities
-- Stores secondary skill XP as JSON: {"mining": 50, "agility": 25}
ALTER TABLE generic_activities ADD COLUMN secondary_xp_json TEXT DEFAULT '{}';
