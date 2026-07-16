-- Add server_logs column to bug_reports for storing docker container logs at time of report
ALTER TABLE bug_reports ADD COLUMN server_logs TEXT;
