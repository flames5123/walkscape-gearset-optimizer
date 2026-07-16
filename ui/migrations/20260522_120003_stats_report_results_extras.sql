-- Add extras_json column to stats_report_results for auxiliary per-row data.
-- Initial use: chip rows under new_items activities — stores the JSON list
-- of unowned drops grouped by kind (gear/tools/eggs/collectibles) per the
-- T17 spec. Optional column; rows written before this migration have NULL.

ALTER TABLE stats_report_results ADD COLUMN extras_json TEXT;
