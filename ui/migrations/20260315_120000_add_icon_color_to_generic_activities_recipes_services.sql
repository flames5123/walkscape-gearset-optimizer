-- Add icon_color column to generic_activities, generic_recipes, and generic_services
ALTER TABLE generic_activities ADD COLUMN icon_color TEXT DEFAULT NULL;
ALTER TABLE generic_recipes ADD COLUMN icon_color TEXT DEFAULT NULL;
ALTER TABLE generic_services ADD COLUMN icon_color TEXT DEFAULT NULL;
