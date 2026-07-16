-- Add value and quality_values_json to generic_items
-- value: coin value for non-crafted items (integer)
-- quality_values_json: per-quality values for crafted items, e.g. {"Normal":100,"Good":150,...}
ALTER TABLE generic_items ADD COLUMN value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generic_items ADD COLUMN quality_values_json TEXT DEFAULT NULL;
