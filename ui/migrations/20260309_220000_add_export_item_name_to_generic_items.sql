-- Add export_item_name to generic_items
-- Allows overriding the auto-derived export name (used for matching wiki item exports)
-- If NULL, the name is auto-derived from the item name (lowercase, underscores)
ALTER TABLE generic_items ADD COLUMN export_item_name TEXT DEFAULT NULL;
