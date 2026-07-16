-- Add icon_path column to generic_items for optional SVG/PNG icon override
ALTER TABLE generic_items ADD COLUMN icon_path TEXT;

-- Add icon_path to generic_activities
ALTER TABLE generic_activities ADD COLUMN icon_path TEXT;

-- Add icon_path to generic_recipes
ALTER TABLE generic_recipes ADD COLUMN icon_path TEXT;

-- Add icon_path to generic_services
ALTER TABLE generic_services ADD COLUMN icon_path TEXT;
