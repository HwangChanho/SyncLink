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
import { getEventsInRange } from '@/services/eventService';

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
        const dateKey = event.startAt.toISOString().split('T')[0] ?? '';
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
      // Get the ISO date key for this event's start date
      const dateKey = event.startAt.toISOString().split('T')[0] ?? '';
      const existing = state.eventsByDate[dateKey] ?? [];
      const index = existing.findIndex((e) => e.id === event.id);

      const updated =
        index >= 0
          ? [...existing.slice(0, index), event, ...existing.slice(index + 1)]
          : [...existing, event];

      return {
        eventsByDate: { ...state.eventsByDate, [dateKey]: updated },
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

  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setFetching: (isFetching) => set({ isFetching }),
  setError: (error) => set({ error }),
}));
