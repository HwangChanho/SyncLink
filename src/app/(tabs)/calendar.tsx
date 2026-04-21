/**
 * Calendar tab — Month / Week / Day views with swipe navigation.
 *
 * State managed here:
 *  - viewMode: 'month' | 'week' | 'day'
 *  - selectedDate: currently focused date (controls which period is shown)
 *
 * Event data:
 *  - Fetched via eventStore.fetchEvents() on selectedDate / viewMode change
 *  - Realtime updates applied via subscribeToSharedEvents (TASK-202)
 *
 * Navigation:
 *  - CalendarHeader prev/next buttons
 *  - Horizontal swipe gesture (PanResponder)
 *  - Tapping a day cell in MonthView → DayView drill-down
 *  - Tapping a day header in WeekView → DayView drill-down
 *
 * Future:
 *  - TASK-302: NL input bar
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { View, PanResponder, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { CalendarHeader, type ViewMode } from '@/components/calendar/CalendarHeader';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import { useEventStore } from '@/stores/eventStore';
import { subscribeToSharedEvents } from '@/services/eventRealtimeService';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';

// ─── Swipe detection thresholds ───────────────────────────────────────────────

/** Minimum horizontal displacement (px) to trigger period navigation. */
const SWIPE_THRESHOLD = 60;
/**
 * Minimum horizontal-to-vertical ratio for a gesture to be treated as
 * a calendar swipe (avoids hijacking vertical scrolls).
 */
const SWIPE_RATIO = 1.5;

// ─── Date utilities ───────────────────────────────────────────────────────────

/** Returns the ISO date key (YYYY-MM-DD) for a Date. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the inclusive date range that should be fetched for the given
 * selectedDate and view mode:
 *  - month → first day of the month's display grid (up to 6 days before)
 *            to the last day of the grid (up to 6 days after)
 *  - week  → Sunday of the week containing selectedDate
 *            to the following Saturday
 *  - day   → just the selectedDate (start=00:00, end=23:59:59)
 */
function getViewRange(date: Date, mode: ViewMode): { start: Date; end: Date } {
  if (mode === 'month') {
    // First Sunday of the display grid (may be in the previous month)
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - firstOfMonth.getDay()); // back to Sunday
    start.setHours(0, 0, 0, 0);
    // Last Saturday of the display grid
    const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const end = new Date(lastOfMonth);
    end.setDate(end.getDate() + (6 - lastOfMonth.getDay())); // forward to Saturday
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (mode === 'week') {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6); // forward to Saturday
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  // day
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Returns a new Date advanced by the appropriate period for the given view mode.
 * Positive `delta` = forward, negative = backward.
 */
function shiftDate(date: Date, mode: ViewMode, delta: 1 | -1): Date {
  const next = new Date(date);
  if (mode === 'month') {
    next.setMonth(next.getMonth() + delta);
    // Clamp to last day of month if the month has fewer days
    next.setDate(Math.min(date.getDate(), new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  } else if (mode === 'week') {
    next.setDate(next.getDate() + delta * 7);
  } else {
    next.setDate(next.getDate() + delta);
  }
  return next;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();
  const { eventsByDate, fetchEvents, upsertEvent, removeEvent } = useEventStore();

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setSelectedDate((prev) => shiftDate(prev, viewMode, 1));
  }, [viewMode]);

  const goPrev = useCallback(() => {
    setSelectedDate((prev) => shiftDate(prev, viewMode, -1));
  }, [viewMode]);

  const goToday = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSelectedDate(today);
  }, []);

  /** Tapping a date in MonthView switches to DayView for that date. */
  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
    // Only drill into day view when in month mode to avoid unexpected mode changes
    if (viewMode === 'month') {
      setViewMode('day');
    }
  }, [viewMode]);

  /** Tapping an event opens the event detail screen. */
  const handleEventPress = useCallback((event: EventSummary) => {
    router.push(`/event/${event.id}`);
  }, [router]);

  // ─── Event fetching ──────────────────────────────────────────────────────────

  /**
   * Fetch events whenever the visible period changes.
   * `getViewRange` computes the exact date range for the current view mode
   * so we always load exactly what's visible on screen.
   */
  useEffect(() => {
    const range = getViewRange(selectedDate, viewMode);
    void fetchEvents(range);
  }, [selectedDate, viewMode, fetchEvents]);

  // ─── Realtime subscription (TASK-202) ────────────────────────────────────────

  /**
   * Subscribe to shared-event changes for all spaces the user belongs to.
   * `upsertEvent` handles both INSERT and UPDATE payloads.
   * `removeEvent` handles DELETE payloads.
   * The returned cleanup function is called on unmount.
   */
  useEffect(() => {
    const unsubscribe = subscribeToSharedEvents(
      upsertEvent,   // onInsert
      upsertEvent,   // onUpdate (same upsert logic)
      removeEvent,   // onDelete
    );
    return unsubscribe;
  }, [upsertEvent, removeEvent]);

  // ─── Swipe gesture ──────────────────────────────────────────────────────────

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture if it's predominantly horizontal
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * SWIPE_RATIO &&
        Math.abs(gs.dx) > 10,

      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < SWIPE_THRESHOLD) return;
        if (gs.dx < 0) {
          setSelectedDate((prev) => shiftDate(prev, viewMode, 1));
        } else {
          setSelectedDate((prev) => shiftDate(prev, viewMode, -1));
        }
      },
    }),
  ).current;

  // ─── Events for current day (DayView) ────────────────────────────────────

  const todayEvents: EventSummary[] = eventsByDate[toDateKey(selectedDate)] ?? [];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Fixed header: period title + view mode tabs */}
        <CalendarHeader
          viewMode={viewMode}
          currentDate={selectedDate}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onViewModeChange={setViewMode}
        />

        {/* Swipe-enabled content area */}
        <View style={styles.content} {...panResponder.panHandlers}>
          {viewMode === 'month' && (
            <MonthView
              currentMonth={selectedDate}
              selectedDate={selectedDate}
              eventsByDate={eventsByDate}
              onDateSelect={handleDateSelect}
            />
          )}

          {viewMode === 'week' && (
            <WeekView
              selectedDate={selectedDate}
              eventsByDate={eventsByDate}
              onEventPress={handleEventPress}
              onDateSelect={(date) => {
                setSelectedDate(date);
                setViewMode('day');
              }}
            />
          )}

          {viewMode === 'day' && (
            <DayView
              selectedDate={selectedDate}
              events={todayEvents}
              onEventPress={handleEventPress}
            />
          )}
        </View>

        {/* NLInputBar: TASK-302 — natural language event creation */}
        <NLInputBar
          onEventCreated={() => {
            // Re-fetch the current range so the new event appears immediately
            const range = getViewRange(selectedDate, viewMode);
            void fetchEvents(range);
          }}
        />

        {/* FAB: quick create pre-filled with selectedDate (kept alongside NLInputBar) */}
        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          onPress={() => {
            router.push({
              pathname: '/event/create',
              params: { date: toDateKey(selectedDate) },
            });
          }}
          accessibilityLabel="새 일정 만들기"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={28} color="#ffffff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
    },
    /** Floating action button — bottom-right, above tab bar. */
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 24,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Shadow (iOS)
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      // Elevation (Android)
      elevation: 6,
    },
    fabPressed: {
      opacity: 0.85,
    },
  });
}
