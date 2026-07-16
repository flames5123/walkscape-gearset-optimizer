-- Add gated_stats_json column to generic_items for conditional stats
-- Supports AP-gated stats (like Omni-Tool) and set-piece-gated stats (like Adventuring tools)
-- Format: {"ap": {threshold: {skill: {location: {stat: value}}}}, "set_pieces": {keyword: {count: {skill: {location: {stat: value}}}}}}
ALTER TABLE generic_items ADD COLUMN gated_stats_json TEXT DEFAULT '{}';
