-- Add target_type and target_value to broadcast_templates for saving recipients
ALTER TABLE broadcast_templates ADD COLUMN target_type TEXT DEFAULT 'global';
ALTER TABLE broadcast_templates ADD COLUMN target_value TEXT;
