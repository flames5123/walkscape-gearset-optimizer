-- Add travel-related columns to gear_sets table
ALTER TABLE gear_sets ADD COLUMN is_travel INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gear_sets ADD COLUMN travel_route_ids TEXT;  -- JSON array of route IDs
ALTER TABLE gear_sets ADD COLUMN travel_region TEXT;     -- e.g. 'jarvonia'
