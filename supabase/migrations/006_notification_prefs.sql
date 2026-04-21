-- Migration 006: notification_preferences column for users table
--
-- Adds a separate JSONB column for granular notification preferences
-- (event_reminder, space_activity, event_share toggles exposed in the
-- Settings > Notifications UI added in TASK-501).
--
-- Note: The existing notification_settings JSONB column tracks server-side
-- push delivery logic (smart_reminders, partner_changes, etc.).
-- notification_preferences is the user-facing toggle layer that maps to
-- the new Settings screen.
--
-- TASK-501 (Sprint 5)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  DEFAULT '{"event_reminder": true, "space_activity": true, "event_share": true}'::jsonb;

COMMENT ON COLUMN users.notification_preferences IS
  'User-facing notification toggles: event_reminder, space_activity, event_share. '
  'Managed via Settings > 알림 설정. Separate from notification_settings (server delivery flags).';
