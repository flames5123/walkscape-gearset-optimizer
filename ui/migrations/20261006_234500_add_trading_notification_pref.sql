-- Per-user "trading notifications" preference. NULL = unset, which the app
-- treats as "follow Personal notifications (targeted_announcements)". A value
-- of 0/1 is an explicit user choice. Gates trading push (_push_to_session).
ALTER TABLE notification_preferences ADD COLUMN trading INTEGER;
