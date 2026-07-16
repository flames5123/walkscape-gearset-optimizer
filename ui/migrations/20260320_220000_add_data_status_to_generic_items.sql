-- Add data_status column to generic_items for tracking data accuracy
-- Values: '✓' (verified from screenshot), 'copied from X' (estimated), or empty (unknown/legacy)
ALTER TABLE generic_items ADD COLUMN data_status TEXT DEFAULT NULL;
