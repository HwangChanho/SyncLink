/**
 * useWidgetSync — keep the home-screen widget snapshot in lockstep with
 * the in-app event / todo stores.
 *
 * Strategy:
 *   1. Subscribe to eventStore and todoStore via Zustand's stable subscribe API.
 *   2. Whenever either bucket changes, schedule a debounced refresh
 *      (250 ms) so a burst of upserts during a sync only triggers one
 *      widget write.
 *   3. Also refresh on midnight rollover and on initial mount so the
 *      widget hydrates as soon as the user opens the app for the first
 *      time after install.
 *
 * No-op on web — the widget services bail out internally on Platform.web,
 * but skipping the subscription entirely saves a few cycles per render.
 *
 * Sprint 19 TASK-1900.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useEventStore } from '@/stores/eventStore';
import { useTodoStore } from '@/stores/todoStore';
import { refreshWidgetData } from '@/services/widgetDataService';

/** Debounce window — short enough to feel instant, long enough to coalesce sync bursts. */
const DEBOUNCE_MS = 250;

export function useWidgetSync(): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    /**
     * Pull the latest events + todos from both stores and write the snapshot.
     * Reads via getState() so we don't subscribe to deep state shape — we
     * just want a fresh view at the moment the debounce fires.
     */
    const flush = () => {
      const events = Object.values(useEventStore.getState().eventsByDate).flat();
      const todos  = useTodoStore.getState().todos ?? [];
      void refreshWidgetData(events, todos);
    };

    /** Schedule (or reschedule) a flush — coalesces neighbouring updates. */
    const scheduleFlush = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, DEBOUNCE_MS);
    };

    // Initial render: hydrate the widget with whatever we have right now.
    scheduleFlush();

    const unsubEvents = useEventStore.subscribe(scheduleFlush);
    const unsubTodos  = useTodoStore.subscribe(scheduleFlush);

    // Midnight rollover — "today" semantics changed, so the widget must
    // recompute even if no event/todo data moved. We tick every minute and
    // detect a date change via the day-of-month delta.
    let lastDay = new Date().getDate();
    const midnightTimer = setInterval(() => {
      const now = new Date();
      if (now.getDate() !== lastDay) {
        lastDay = now.getDate();
        flush();
      }
    }, 60_000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearInterval(midnightTimer);
      unsubEvents();
      unsubTodos();
    };
  }, []);
}
