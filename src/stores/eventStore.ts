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
  /**
   * Build-71 perf — server-fetched 된 date key (YYYY-MM-DD) 의 set.
   * fetchEvents 가 다음 호출 시 range 의 모든 date key 가 이 set 안에 있으면
   * Supabase 호출을 skip 한다. WeekView 좌우 swipe 가 빠를 때 "여전히 끊켜"
   * 보고 → 동일 셀 / 동일 주 진입 시 redundant fetch + state 갱신 +
   * useMemo 재계산 + 15-day grid re-render 가 매번 발생하던 것을 끊는다.
   */
  fetchedDateKeys: Set<string>;

  // ── Data actions ─────────────────────────────────────────────────────────
  /**
   * Fetch events for a date range from the server and populate eventsByDate.
   * Implementation (TASK-201): calls eventService.getEventsInRange and
   * buckets results by startAt date.
   *
   * @param range - Inclusive start/end date range
   */
  fetchEvents: (range: DateRange, opts?: { force?: boolean }) => Promise<void>;
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
  fetchedDateKeys: new Set<string>(),

  fetchEvents: async (range: DateRange, opts?: { force?: boolean }) => {
    // Build-71 perf — range 의 모든 date key 가 이미 fetched 라면 skip.
    // Build-94 — 단, opts.force 면 캐시 무시 후 refetch (Realtime 으로 받지
    // 못한 새 share / 다른 device 변경 등 stale 가능성 처리).
    const requiredKeys: string[] = [];
    const cursor = new Date(range.start);
    cursor.setHours(0, 0, 0, 0);
    const endMs = new Date(range.end).setHours(0, 0, 0, 0);
    while (cursor.getTime() <= endMs) {
      requiredKeys.push(localDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!opts?.force) {
      const cached = _get().fetchedDateKeys;
      if (requiredKeys.length > 0 && requiredKeys.every((k) => cached.has(k))) {
        // 모든 일자 이미 fetched → Supabase 호출 / state 갱신 모두 skip.
        return;
      }
    }

    set({ isFetching: true, error: null });
    try {
      const events = await getEventsInRange(range);

      // v1.1.3 — Multi-day expansion. 일정이 여러 날 걸쳐있으면 시작일부터
      // 종료일까지 매일 cell 에 같은 EventSummary 를 등록 → MonthView 가
      // 주(week) 단위로 grouping 해 가로 span bar 로 렌더.
      //
      // 시간 있는 일정도 endAt 이 다음 날 새벽이면 다일로 간주. 자정에서
      // 정확히 끝나면 한 날짜로 한정. allDay 는 endAt 이 23:59:59 이므로
      // 자연스럽게 마지막 일자 포함.
      const byDate: Record<string, EventSummary[]> = {};
      const dayMs = 24 * 60 * 60 * 1000;
      for (const event of events) {
        const startKey = localDateKey(event.startAt);
        const endKey   = localDateKey(event.endAt);
        if (startKey === endKey) {
          (byDate[startKey] ??= []).push(event);
          continue;
        }
        // 다일 — 자정 단위로 cursor 이동. 무한 loop 방어: endAt < startAt
        // 이거나 한 달 넘는 비정상 데이터는 startKey 만 등록 후 skip.
        const cursor = new Date(event.startAt);
        cursor.setHours(0, 0, 0, 0);
        const last = new Date(event.endAt);
        last.setHours(0, 0, 0, 0);
        if (last < cursor) {
          (byDate[startKey] ??= []).push(event);
          continue;
        }
        let iter = 0;
        while (cursor <= last && iter < 366) {
          const k = localDateKey(cursor);
          (byDate[k] ??= []).push(event);
          cursor.setTime(cursor.getTime() + dayMs);
          iter += 1;
        }
      }

      // Build-97 — fetch 결과로 range 안 dateKey 를 완전히 교체. 이전엔
      // spread merge 로 옛 dateKey 의 events 가 살아있어 drag-to-reschedule
      // 후 server 에 fail 하거나 동기화될 때 "옛 위치 + 새 위치" 둘 다
      // 표시되는 복사 현상 발생 (LEAD: "옮겨지고 복사되고 난리"). range
      // 안 dateKey 는 server 응답이 truth 이므로 교체. range 밖 keys 는
      // 그대로 보존.
      set((state) => {
        const newFetched = new Set(state.fetchedDateKeys);
        const merged: typeof state.eventsByDate = { ...state.eventsByDate };
        // range 의 모든 dateKey 를 빈 배열로 초기화 후 server 결과 병합 —
        // server 에 없는 일자는 빈 배열 유지 (이전엔 옛 events 잔존).
        for (const k of requiredKeys) {
          newFetched.add(k);
          merged[k] = byDate[k] ?? [];
        }
        return {
          eventsByDate:    merged,
          fetchedDateKeys: newFetched,
          isFetching:      false,
        };
      });
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
      // v1.2.5 — 다일 expansion 일관성 유지.
      // 다일 일정을 drag 로 이동했을 때 startAt cell 만 갱신하면 length 가
      // 한 날로 줄어든 것처럼 보이는 회귀가 있었음. fetchEvents 의 expansion
      // 알고리즘과 동일하게 startAt..endAt 모든 dateKey 에 같은 EventSummary
      // 를 등록.

      // 1) 기존 dateKey 들에서 이 event 제거.
      const withoutEvent = Object.fromEntries(
        Object.entries(state.eventsByDate).map(([date, events]) => [
          date,
          events.filter((e) => e.id !== event.id),
        ]),
      );

      // 2) startAt..endAt 모든 dateKey 에 다시 추가.
      const startKey = localDateKey(event.startAt);
      const endKey   = localDateKey(event.endAt);
      const merged: typeof state.eventsByDate = { ...withoutEvent };
      if (startKey === endKey) {
        merged[startKey] = [...(merged[startKey] ?? []), event];
      } else {
        const cursor = new Date(event.startAt);
        cursor.setHours(0, 0, 0, 0);
        const last = new Date(event.endAt);
        last.setHours(0, 0, 0, 0);
        let iter = 0;
        while (cursor <= last && iter < 366) {
          const k = localDateKey(cursor);
          merged[k] = [...(merged[k] ?? []), event];
          cursor.setTime(cursor.getTime() + 24 * 60 * 60 * 1000);
          iter += 1;
        }
      }

      return { eventsByDate: merged };
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
