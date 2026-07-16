-- Add is_quality_item flag to generic recipes
-- When true, the recipe produces a quality item (Normal/Good/Great/Excellent/Perfect/Eternal)
-- and the crafting odds table should be shown
ALTER TABLE generic_recipes ADD COLUMN is_quality_item INTEGER NOT NULL DEFAULT 0;
