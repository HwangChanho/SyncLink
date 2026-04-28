/**
 * Event store — cached event state for calendar rendering.
 *
 * Wraps eventService.ts. Provides:
 *  - Events keyed by date (YYYY-MM-DD) for efficient calendar grid rendering
 *  - Selected date tracking for day-view drill-down
 *  - Realtime update merging (TASK-202)
 *  - Optimistic updates for event creation/deletion
 *
 * Design note: `eventsByDate` (Record keyed by date string) is preferred over
 * a flat `events: Event[]` array because calendar grids look up by date on
 * every render — O(1) vs O(n) filter per day.
 *
 * This is a STUB. Implementation: TASK-200 (views) + TASK-201 (CRUD).
 */

import { create } from 'zustand';
import type { EventSummary, DateRange } from '@/types';
import { getEventsInRange, getEventById } from '@/services/eventService';
import { subscribeToEvents as realtimeSubscribeToEvents } from '@/services/eventRealtimeService';

/**
 * Local-timezone YYYY-MM-DD key.
 *
 * Fixes TASK-005 (Critical): `Date.toISOString()` returns UTC, so a KST
 * 28일 00:30 event (UTC 27일 15:30) was bucketed under "2026-04-27" and
 * displayed on the wrong day. Use the device-local Y/M/D instead so the
 * calendar grouping matches what the user typed in.
 */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface EventState {
  /**
   * Events indexed by ISO date string (YYYY-MM-DD).
   * Multiple events per day are stored as an array.
   */
  eventsByDate: Record<string, EventSummary[]>;
  /**
   * Currently selected date (for DayView drill-down and event creation defaults).
   * Defaults to today on store creation.
   */
  selectedDate: Date;
  /** True while fetching events from the server. */
  isFetching: boolean;
  /** Last fetch error, if any. */
  error: string | null;

  // ── Data actions ─────────────────────────────────────────────────────────
  /**
   * Fetch events for a date range from the server and populate eventsByDate.
   * Implementation (TASK-201): calls eventService.getEventsInRange and
   * buckets results by startAt date.
   *
   * @param range - Inclusive start/end date range
   */
  fetchEvents: (range: DateRange) => Promise<void>;
  setEventsForDate: (date: string, events: EventSummary[]) => void;
  upsertEvent: (event: EventSummary) => void;
  removeEvent: (eventId: string) => void;

  // ── Realtime subscription (TASK-902) ─────────────────────────────────────────
  /**
   * Subscribe to Supabase Realtime changes for events in a specific space.
   * Automatically upserts or removes events from the store as changes arrive.
   *
   * Returns an unsubscribe function — the caller (e.g. CalendarScreen) must
   * call it on unmount to prevent memory leaks.
   *
   * @param spaceId - UUID of the space to watch
   * @returns Unsubscribe function
   */
  subscribeToEvents: (spaceId: string) => () => void;

  // ── UI actions ────────────────────────────────────────────────────────────
  setSelectedDate: (date: Date) => void;
  setFetching: (fetching: boolean) => void;
  setError: (error: string | null) => void;
}

export const useEventStore = create<EventState>((set, _get) => ({
  eventsByDate: {},
  selectedDate: new Date(),
  isFetching: false,
  error: null,

  fetchEvents: async (range: DateRange) => {
    set({ isFetching: true, error: null });
    try {
      const events = await getEventsInRange(range);

      // Bucket events by startAt date key (YYYY-MM-DD)
      // Events spanning multiple days are recorded only on their start date
      // for simplicity; multi-day events can be expanded in a future sprint.
      const byDate: Record<string, EventSummary[]> = {};
      for (const event of events) {
        const dateKey = localDateKey(event.startAt);
        const existing = byDate[dateKey];
        if (existing === undefined) {
          byDate[dateKey] = [event];
        } else {
          existing.push(event);
        }
      }

      // Merge into existing eventsByDate — keeps events outside this range intact
      set((state) => ({
        eventsByDate: { ...state.eventsByDate, ...byDate },
        isFetching: false,
      }));
    } catch (err) {
      set({
        isFetching: false,
        error: err instanceof Error ? err.message : '일정을 불러오지 못했습니다.',
      });
    }
  },

  setEventsForDate: (date, events) =>
    set((state) => ({
      eventsByDate: { ...state.eventsByDate, [date]: events },
    })),

  upsertEvent: (event) =>
    set((state) => {
      // Get the local date key for this event's new start date (TASK-005)
      const newDateKey = localDateKey(event.startAt);

      // Build a fresh eventsByDate map:
      //  1. Remove the event from ANY existing bucket (handles the case where
      //     the event has been moved to a different day — we must evict it from
      //     its original date bucket, not just add it to the new one).
      //  2. Insert/replace in the new date bucket.
      //
      // Without step 1, dragging an event from Jan 12 → Jan 13 would leave a
      // stale ghost copy on Jan 12 while the new copy appears on Jan 13, making
      // the UI appear as if the event never moved. (Bug: drag visual works but
      // reschedule looks ineffective because old slot is still occupied.)
      const withoutEvent = Object.fromEntries(
        Object.entries(state.eventsByDate).map(([date, events]) => [
          date,
          events.filter((e) => e.id !== event.id),
        ]),
      );

      const existing = withoutEvent[newDateKey] ?? [];
      const updated = [...existing, event];

      return {
        eventsByDate: { ...withoutEvent, [newDateKey]: updated },
      };
    }),

  removeEvent: (eventId) =>
    set((state) => {
      const updated = Object.fromEntries(
        Object.entries(state.eventsByDate).map(([date, events]) => [
          date,
          events.filter((e) => e.id !== eventId),
        ]),
      );
      return { eventsByDate: updated };
    }),

  subscribeToEvents: (spaceId: string) => {
    /**
     * When an event is upserted via Realtime, we only receive the event ID.
     * Fetch the full event detail and merge it into the store.
     */
    const handleUpsert = async (eventId: string) => {
      try {
        const event = await getEventById(eventId);
        // Convert full Event to EventSummary for the store
        set((state) => {
          const dateKey = localDateKey(event.startAt);
          const existing = state.eventsByDate[dateKey] ?? [];
          const index = existing.findIndex((e) => e.id === event.id);
          const summary: EventSummary = {
            id:      event.id,
            title:   event.title,
            startAt: event.startAt,
            endAt:   event.endAt,
            allDay:  event.allDay,
            color:   event.color ?? '#6C63FF',
            isOwn:   event.isOwn,
          };
          const updated =
            index >= 0
              ? [...existing.slice(0, index), summary, ...existing.slice(index + 1)]
              : [...existing, summary];
          return { eventsByDate: { ...state.eventsByDate, [dateKey]: updated } };
        });
      } catch {
        // Ignore — event may not be accessible or was already removed
      }
    };

    const handleDelete = (eventId: string) => {
      set((state) => ({
        eventsByDate: Object.fromEntries(
          Object.entries(state.eventsByDate).map(([date, events]) => [
            date,
            events.filter((e) => e.id !== eventId),
          ]),
        ),
      }));
    };

    // Wire up the service-level subscription and return its cleanup
    return realtimeSubscribeToEvents(spaceId, (id) => { void handleUpsert(id); }, handleDelete);
  },

  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setFetching: (isFetching) => set({ isFetching }),
  setError: (error) => set({ error }),
}));
