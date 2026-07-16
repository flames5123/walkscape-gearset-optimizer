-- Add gear_set_export column to generic_items for gearset export UUID
ALTER TABLE generic_items ADD COLUMN gear_set_export TEXT DEFAULT NULL;
