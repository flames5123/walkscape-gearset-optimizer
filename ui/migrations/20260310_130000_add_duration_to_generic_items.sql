-- Add duration column to generic_items for consumables
-- Stores step duration (0=N/A, 500, 1000, 5000, 10000)
-- Only meaningful for slot='consumable', ignored for other slots
ALTER TABLE generic_items ADD COLUMN duration INTEGER NOT NULL DEFAULT 1000;
