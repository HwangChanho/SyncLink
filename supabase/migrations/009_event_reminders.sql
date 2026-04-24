-- Migration 009: event_reminders table
-- Adds per-user, per-event reminder rows so each event can have
-- multiple reminders at different offsets.
-- Replaces the single hard-coded 30-min reminder that was
-- fire-and-forgotten from eventService.ts (TASK-1304).

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE public.event_reminders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  -- How many minutes before the event start to fire the notification.
  -- Common presets: 5, 10, 30, 60, 1440 (1 day). Custom values allowed.
  minutes_before INT         NOT NULL DEFAULT 30,
  -- Expo Notifications identifier returned by scheduleNotificationAsync.
  -- Stored so we can cancel the notification when the reminder is removed
  -- or the event is updated/deleted.
  notif_id       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Security ─────────────────────────────────────────────────────────────────

ALTER TABLE public.event_reminders ENABLE ROW LEVEL SECURITY;

-- Users can only see, insert, update and delete their own reminders.
CREATE POLICY "event_reminders_own"
  ON public.event_reminders
  FOR ALL
  USING (auth.uid() = user_id);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Speeds up the JOIN from events → reminders when loading a single event.
CREATE INDEX idx_event_reminders_event  ON public.event_reminders(event_id);
-- Speeds up querying all reminders for a given user.
CREATE INDEX idx_event_reminders_user   ON public.event_reminders(user_id);
