/**
 * guestDemoData — illustrative example events shown to a browsing guest
 * (no account) so the Home and Calendar tabs look alive instead of empty,
 * nudging sign-up. Part A of the 2026-06-04 guest-entry plan.
 *
 * Consumed by eventStore.fetchEvents, which short-circuits to this data when
 * the user is unauthenticated (the server would return [] under RLS anyway).
 * Titles are localized via the i18next singleton (no React context here);
 * times are relative to "today" so the demo always lands on the current week.
 */

import type { EventSummary } from '@/types';
import { toDateKey } from '@/lib/calendarRange';
import i18n from '@/lib/i18n';

/**
 * Build a Date at `dayOffset` days from today, at the given local h:m.
 * @param dayOffset  0 = today, 1 = tomorrow, …
 * @param hour       local hour (0–23)
 * @param minute     local minute (default 0)
 */
function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Returns a fresh demo event set grouped by local YYYY-MM-DD key, matching
 * the shape eventStore.eventsByDate expects. Rebuilt on each call so the
 * events stay anchored to the current day (cheap; a handful of objects).
 */
export function buildGuestDemoEventsByDate(): Record<string, EventSummary[]> {
  // Short helper to pull a localized demo string.
  const tr = (key: string): string => i18n.t(`auth.guest.${key}`);

  // Distinct seed colors so the demo calendar reads as colorful/realistic.
  // Hardcoded hex is acceptable here — this is illustrative seed data, not
  // themed UI chrome.
  const events: EventSummary[] = [
    {
      id: 'guest-demo-meeting',
      title: tr('demo_meeting'),
      startAt: at(0, 9, 0),
      endAt: at(0, 10, 0),
      allDay: false,
      color: '#6366F1', // indigo
      isOwn: true,
      eventKind: 'general',
    },
    {
      id: 'guest-demo-dinner',
      title: tr('demo_dinner'),
      startAt: at(0, 19, 30),
      endAt: at(0, 21, 0),
      allDay: false,
      color: '#EC4899', // pink
      isOwn: true,
      eventKind: 'general',
    },
    {
      id: 'guest-demo-workout',
      title: tr('demo_workout'),
      startAt: at(1, 7, 0),
      endAt: at(1, 8, 0),
      allDay: false,
      color: '#10B981', // green
      isOwn: true,
      eventKind: 'workout',
    },
    {
      id: 'guest-demo-birthday',
      title: tr('demo_birthday'),
      startAt: at(2, 0, 0),
      endAt: at(2, 23, 59),
      allDay: true,
      color: '#8B5CF6', // violet
      isOwn: true,
      eventKind: 'general',
    },
    {
      id: 'guest-demo-movie',
      title: tr('demo_movie'),
      startAt: at(3, 14, 0),
      endAt: at(3, 15, 30),
      allDay: false,
      color: '#F59E0B', // amber
      isOwn: true,
      eventKind: 'general',
    },
  ];

  const byDate: Record<string, EventSummary[]> = {};
  for (const e of events) {
    (byDate[toDateKey(e.startAt)] ??= []).push(e);
  }
  return byDate;
}
