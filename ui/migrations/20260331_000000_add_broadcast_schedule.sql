-- Add valid_from and valid_until scheduling columns to broadcasts
ALTER TABLE broadcasts ADD COLUMN valid_from TIMESTAMP NULL;
ALTER TABLE broadcasts ADD COLUMN valid_until TIMESTAMP NULL;
