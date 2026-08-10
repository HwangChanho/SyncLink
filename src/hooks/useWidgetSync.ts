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
import { refreshWidgetData, drainWidgetPendingToggles } from '@/services/widgetDataService';
import { toggleTodoComplete } from '@/services/todoService';

/** Debounce window — short enough to feel instant, long enough to coalesce sync bursts. */
const DEBOUNCE_MS = 250;

/**
 * Replay checkbox taps the widget could not send itself.
 *
 * iOS always lands here: a WidgetKit App Intent runs in the widget extension
 * with no JS and no Supabase session, so it can only queue. Android normally
 * writes directly from its headless task and only queues when that task has no
 * restored session or the device is offline.
 *
 * Runs before the first snapshot flush so the widget isn't briefly repainted
 * with pre-toggle server state.
 */
async function replayWidgetToggles(): Promise<void> {
  try {
    const applied = await drainWidgetPendingToggles(
      (todoId, done) => toggleTodoComplete(todoId, done).then(() => undefined),
    );
    // Only refetch when something actually changed — the common case is an
    // empty queue, and a needless fetch on every launch is real latency.
    if (applied > 0) await useTodoStore.getState().fetchTodos();
  } catch (err) {
    // Never block widget sync (or app start) on queue replay.
    console.warn('[widget] replay failed:', err);
  }
}

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

    // Drain anything the widget queued while the app was closed, then hydrate.
    // scheduleFlush() is called regardless of replay outcome so a failed replay
    // can't leave the widget showing nothing.
    void replayWidgetToggles().finally(scheduleFlush);

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
