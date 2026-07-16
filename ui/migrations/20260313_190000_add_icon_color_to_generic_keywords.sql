-- Add icon_color to generic_keywords for emoji tinting
ALTER TABLE generic_keywords ADD COLUMN icon_color TEXT DEFAULT NULL;
