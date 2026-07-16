-- Add tier column to generic_services
-- Values: 'basic' (default) or 'advanced'
ALTER TABLE generic_services ADD COLUMN tier TEXT NOT NULL DEFAULT 'basic';
