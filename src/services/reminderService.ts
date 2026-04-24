/**
 * Reminder service — manages per-event, per-user reminder rows.
 *
 * Each event can have multiple reminders at different time offsets
 * (e.g., 10 min before AND 1 hour before).  This service is the sole
 * layer allowed to touch the `event_reminders` table and schedule /
 * cancel local notifications.
 *
 * Architecture note: components never call Supabase or
 * expo-notifications directly — they always go through this service.
 *
 * DB table: `event_reminders` (migration 009_event_reminders.sql)
 */

import { supabase } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import {
  scheduleEventReminder,
  cancelNotification,
} from '@/services/notificationService';
import type { TFunction } from 'i18next';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Allowed preset values (in minutes before event start).
 *   5   → 5 minutes before
 *   10  → 10 minutes before
 *   30  → 30 minutes before
 *   60  → 1 hour before
 *   1440 → 1 day before
 */
export type ReminderPreset = 5 | 10 | 30 | 60 | 1440;

/** Ordered list of available preset values shown in the picker UI. */
export const REMINDER_PRESETS: ReminderPreset[] = [5, 10, 30, 60, 1440];

/**
 * A single reminder row returned from Supabase.
 * Mirrors the `event_reminders` table shape.
 */
export interface EventReminder {
  /** UUID primary key. */
  id: string;
  /** Foreign key → events.id */
  eventId: string;
  /** Foreign key → users.id */
  userId: string;
  /** Minutes before event start at which the notification fires. */
  minutesBefore: number;
  /** Expo Notifications identifier — null until the notification is scheduled. */
  notifId: string | null;
  /** Row creation timestamp. */
  createdAt: Date;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Shape of a raw row coming back from Supabase (snake_case). */
interface ReminderRow {
  id: string;
  event_id: string;
  user_id: string;
  minutes_before: number;
  notif_id: string | null;
  created_at: string;
}

/**
 * Convert a Supabase `event_reminders` row to the internal `EventReminder` shape.
 *
 * @param row - Raw database row
 * @returns Camel-cased EventReminder
 */
function toReminder(row: ReminderRow): EventReminder {
  return {
    id:            row.id,
    eventId:       row.event_id,
    userId:        row.user_id,
    minutesBefore: row.minutes_before,
    notifId:       row.notif_id,
    createdAt:     new Date(row.created_at),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return a human-readable label for a reminder offset.
 *
 * Converts a raw minute count to a localized string such as:
 *   "5분 전", "1시간 전", "1일 전"
 *
 * Uses react-i18next translation keys from the `reminder` namespace.
 * Keys expected in locales: `reminder.minutes_before`, `reminder.hours_before`,
 * `reminder.days_before` — all accept a `count` interpolation variable.
 *
 * @param minutes - Offset in minutes (must be > 0)
 * @param t       - react-i18next translation function
 * @returns Localized label string
 */
export function presetLabel(minutes: number, t: TFunction): string {
  if (minutes < 60) {
    return t('reminder.minutes_before', { count: minutes });
  }
  if (minutes < 1440) {
    return t('reminder.hours_before', { count: minutes / 60 });
  }
  return t('reminder.days_before', { count: minutes / 1440 });
}

/**
 * Fetch all reminders for a given event (for the current user).
 *
 * Called when the edit screen loads to pre-populate the ReminderPicker.
 *
 * @param eventId - UUID of the event
 * @returns Array of EventReminder objects (may be empty)
 * @throws Error if the Supabase query fails
 */
export async function getReminders(eventId: string): Promise<EventReminder[]> {
  const { data, error } = await (supabase as any)
    .from('event_reminders')
    .select('*')
    .eq('event_id', eventId)
    .order('minutes_before', { ascending: true });

  if (error) throw error;
  return ((data as ReminderRow[]) ?? []).map(toReminder);
}

/**
 * Add a single reminder for an event and schedule the local notification.
 *
 * Flow:
 *  1. Verify the user is logged in.
 *  2. INSERT a row into `event_reminders`.
 *  3. If `eventStartAt` is provided and the trigger time is in the future,
 *     schedule a local notification and store the notification ID back in
 *     the DB row.
 *
 * @param eventId       - UUID of the target event
 * @param minutesBefore - How many minutes before event start to notify
 * @param eventTitle    - Event title (used as the notification title)
 * @param eventStartAt  - Event start time (used to compute trigger time)
 * @returns The newly created EventReminder
 * @throws Error if not authenticated or insert fails
 */
export async function addReminder(
  eventId: string,
  minutesBefore: number,
  eventTitle: string,
  eventStartAt: Date,
): Promise<EventReminder> {
  // Ensure the user is logged in
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('로그인이 필요합니다.');

  // Insert the reminder row (notif_id will be updated after scheduling)
  const { data: inserted, error: insertError } = await (supabase as any)
    .from('event_reminders')
    .insert({
      event_id:       eventId,
      user_id:        user.id,
      minutes_before: minutesBefore,
    })
    .select()
    .single() as { data: ReminderRow | null; error: Error | null };

  if (insertError || !inserted) {
    throw insertError ?? new Error('리마인더 추가에 실패했습니다.');
  }

  // Schedule local notification if the trigger time is still in the future
  const triggerAt = new Date(eventStartAt.getTime() - minutesBefore * 60 * 1000);
  if (triggerAt > new Date()) {
    try {
      const notifId = await scheduleEventReminder(
        eventId,
        eventTitle,
        presetLabelRaw(minutesBefore),
        triggerAt,
      );

      // Persist the notification ID so we can cancel it later
      await (supabase as any)
        .from('event_reminders')
        .update({ notif_id: notifId })
        .eq('id', inserted.id);

      inserted.notif_id = notifId;
    } catch {
      // Non-fatal: DB row exists; notification scheduling may fail on web / simulator
    }
  }

  return toReminder(inserted);
}

/**
 * Remove a single reminder and cancel its scheduled notification.
 *
 * @param reminderId - UUID of the `event_reminders` row to delete
 * @param notifId    - Expo notification ID to cancel (may be null)
 * @throws Error if the delete fails
 */
export async function removeReminder(
  reminderId: string,
  notifId: string | null,
): Promise<void> {
  // Cancel the scheduled notification first (best-effort)
  if (notifId) {
    try {
      await cancelNotification(notifId);
    } catch {
      // Non-fatal — the notification may have already fired or been dismissed
    }
  }

  const { error } = await (supabase as any)
    .from('event_reminders')
    .delete()
    .eq('id', reminderId);

  if (error) throw error;
}

/**
 * Replace all reminders for an event with a new set of minute offsets.
 *
 * Atomic replacement strategy:
 *  1. Cancel and delete ALL existing reminders for the event.
 *  2. Insert new rows for each minute value in `minutesList`.
 *
 * Suitable for the edit screen where the user may reorder, add, or
 * remove reminders and then saves the whole event in one go.
 *
 * @param eventId      - UUID of the target event
 * @param minutesList  - New list of minute offsets (may be empty to clear all)
 * @param eventTitle   - Event title (for notification body)
 * @param eventStartAt - Event start time (for computing trigger times)
 * @returns Array of newly created EventReminder objects
 * @throws Error if the user is not authenticated or any DB call fails
 */
export async function updateReminders(
  eventId: string,
  minutesList: number[],
  eventTitle: string,
  eventStartAt: Date,
): Promise<EventReminder[]> {
  try {
    // Step 1: fetch and cancel existing reminders
    const existing = await getReminders(eventId);

    // Cancel all scheduled notifications concurrently (best-effort)
    await Promise.all(
      existing
        .filter((r) => r.notifId !== null)
        .map((r) => cancelNotification(r.notifId!).catch(() => {})),
    );

    // Delete all existing rows for this event
    const { error: deleteError } = await (supabase as any)
      .from('event_reminders')
      .delete()
      .eq('event_id', eventId);

    if (deleteError) throw deleteError;

    // Step 2: insert new reminders (deduplicating minute values)
    const uniqueMinutes = [...new Set(minutesList)];
    const results = await Promise.all(
      uniqueMinutes.map((minutes) =>
        addReminder(eventId, minutes, eventTitle, eventStartAt),
      ),
    );

    return results;
  } catch (err) {
    // 리마인더 업데이트 실패 — DELETE 단계/INSERT 단계/권한 어느 쪽인지 details로 확인
    await logError({
      context: 'reminder.update',
      error:   err,
      details: {
        eventId,
        minutesCount: minutesList.length,
      },
    });
    throw err;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a plain-text reminder body string without i18n (used inside
 * addReminder which runs outside a React component context).
 *
 * @param minutes - Offset in minutes
 * @returns English fallback label, e.g. "5 min before", "1 hr before"
 */
function presetLabelRaw(minutes: number): string {
  if (minutes < 60) return `${minutes}분 전 알림`;
  if (minutes < 1440) return `${minutes / 60}시간 전 알림`;
  return `${minutes / 1440}일 전 알림`;
}
