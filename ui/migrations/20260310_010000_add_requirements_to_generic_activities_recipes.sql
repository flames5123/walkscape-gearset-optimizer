-- Add requirements JSON column to generic activities and recipes
-- Stores requirements like keyword_counts, reputation, achievement_points
-- Format: JSON object matching the wiki activity requirements structure
ALTER TABLE generic_activities ADD COLUMN requirements_json TEXT DEFAULT '{}';
ALTER TABLE generic_recipes ADD COLUMN requirements_json TEXT DEFAULT '{}';
