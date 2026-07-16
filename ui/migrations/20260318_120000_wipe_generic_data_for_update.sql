-- ============================================================================
-- WIPE: Clear all generic data for game update (2026-03-18)
-- ============================================================================
-- Deletes ALL generic activities, recipes, services, items, and keywords
-- EXCEPT the keyword "arrow" which is preserved.
--
-- Google Sheets data must be cleared manually — this migration only affects
-- the local SQLite database. The next sheet sync will re-populate from
-- whatever remains in the sheet.
--
-- To clear the Google Sheets:
--   1. Open the sheet
--   2. Delete all data rows (keep headers) in: Activities, Recipes, Services,
--      Gear, Consumables, Collectibles, Pets, Inputs tabs
--   3. In the Keywords tab, delete all rows EXCEPT "arrow"
--   4. Run a sync to confirm everything is clean
-- ============================================================================

-- Delete all generic activities
DELETE FROM generic_activities;

-- Delete all generic recipes
DELETE FROM generic_recipes;

-- Delete all generic services
DELETE FROM generic_services;

-- Delete all generic items
DELETE FROM generic_items;

-- Delete all keywords EXCEPT "arrow" (case-insensitive)
DELETE FROM generic_keywords WHERE LOWER(name) != 'arrow';
