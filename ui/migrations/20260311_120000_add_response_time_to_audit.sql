-- Add response_time_ms and status_code to api_access_audit
-- for performance monitoring and error rate tracking
ALTER TABLE api_access_audit ADD COLUMN response_time_ms REAL;
ALTER TABLE api_access_audit ADD COLUMN status_code INTEGER;
