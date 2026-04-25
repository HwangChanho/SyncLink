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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, PanResponder, Pressable, StyleSheet,
  Modal, TouchableOpacity, Text,
  Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { CalendarHeader, type ViewMode } from '@/components/calendar/CalendarHeader';
import { YearMonthPicker } from '@/components/calendar/YearMonthPicker';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import { useEventStore } from '@/stores/eventStore';
import { subscribeToSharedEvents } from '@/services/eventRealtimeService';
import { updateEvent } from '@/services/eventService';
import { useTodoStore } from '@/stores/todoStore';
import type { MonthViewItem } from '@/components/calendar/MonthView';
import type { EventSummary, Category } from '@/types';
import { useColors } from '@/hooks/useColors';
import { getCategories } from '@/services/categoryService';

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
  // Todos with a due date should surface on the calendar alongside events.
  const { todos, fetchTodos } = useTodoStore();
  useEffect(() => { void fetchTodos(); }, [fetchTodos]);

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  /**
   * Controls the visibility of the YearMonthPicker modal.
   * Opened when the user taps the period title in CalendarHeader.
   */
  const [pickerVisible, setPickerVisible] = useState(false);

  // ── Category filter (TASK-1416) ────────────────────────────────────────────
  /** All categories known for the user — used to render the toggle list. */
  const [categories, setCategories] = useState<Category[]>([]);
  /**
   * Categories whose events should be rendered dimmed on the calendar.
   * The sentinel string '__none__' represents events without a category.
   * Default: empty set = everything fully visible.
   */
  const [dimmedCats, setDimmedCats] = useState<Set<string>>(new Set());
  /** Whether the category filter sheet is open. */
  const [catFilterVisible, setCatFilterVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCategories().then((list) => {
      if (!cancelled) setCategories(list);
    }).catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, []);

  /** Density mode: detailed bars with titles, or compact colour dots. */
  const [monthDensity, setMonthDensity] = useState<'detailed' | 'compact'>('detailed');

  /**
   * Group todos by due-date key. Only todos with a due date and not yet
   * completed are surfaced on the calendar — completed items would add
   * noise. The colour is the category colour if we know it, otherwise
   * a neutral grey so the bar is still visible.
   */
  const todosByDate = useMemo(() => {
    const map: Record<string, MonthViewItem[]> = {};
    for (const t of todos) {
      if (!t.dueDate || t.isCompleted) continue;
      const d = t.dueDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const bucket = map[key] ?? (map[key] = []);
      const cat = t.categoryId ? categories.find((c) => c.id === t.categoryId) : null;
      bucket.push({
        id: t.id,
        title: t.title,
        color: cat?.color ?? '#64748B',
        kind: 'todo',
      });
    }
    return map;
  }, [todos, categories]);

  /**
   * Produce a new eventsByDate where events whose category the user has
   * toggled off carry an 8-char hex color with a low alpha suffix. Views
   * render the given `color` verbatim so this is enough to dim them — no
   * view code needs to change. Sentinel '__none__' dims uncategorised.
   */
  const displayEventsByDate = useMemo(() => {
    if (dimmedCats.size === 0) return eventsByDate;
    const out: typeof eventsByDate = {};
    for (const [key, events] of Object.entries(eventsByDate)) {
      out[key] = events.map((e) => {
        const bucket = e.categoryId ?? '__none__';
        if (!dimmedCats.has(bucket)) return e;
        // Append low-alpha (~19%) to the hex so RN renders it faded.
        const c = e.color;
        const dimmed = c.length === 7 ? `${c}30` : c;
        return { ...e, color: dimmed };
      });
    }
    return out;
  }, [eventsByDate, dimmedCats]);

  // Drag-to-reschedule handler: given an event + pixel-derived deltas from
  // the grid, compute the new startAt/endAt and persist via eventService.
  const handleReschedule = useCallback(
    async (evt: EventSummary, dayDelta: number, minuteDelta: number) => {
      if (dayDelta === 0 && minuteDelta === 0) return;
      const newStart = new Date(evt.startAt);
      newStart.setDate(newStart.getDate() + dayDelta);
      newStart.setMinutes(newStart.getMinutes() + minuteDelta);
      const newEnd = new Date(evt.endAt);
      newEnd.setDate(newEnd.getDate() + dayDelta);
      newEnd.setMinutes(newEnd.getMinutes() + minuteDelta);
      try {
        await updateEvent(evt.id, { startAt: newStart, endAt: newEnd });
        const range = getViewRange(selectedDate, viewMode);
        void fetchEvents(range);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[calendar] reschedule failed:', err);
      }
    },
    [selectedDate, viewMode, fetchEvents],
  );

  const toggleCategoryDim = useCallback((bucket: string) => {
    setDimmedCats((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }, []);

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

  /** Opens the YearMonthPicker modal (triggered by tapping the title). */
  const handleYearMonthPress = useCallback(() => {
    setPickerVisible(true);
  }, []);

  /**
   * Receives the date selected in YearMonthPicker and updates the calendar.
   * The picker provides the 1st of the selected month; we normalise to midnight.
   *
   * @param date - 1st day of the selected year/month at 00:00:00
   */
  const handleYearMonthSelect = useCallback((date: Date) => {
    date.setHours(0, 0, 0, 0);
    setSelectedDate(date);
    // Always switch to month view after a year/month jump for context
    setViewMode('month');
    setPickerVisible(false);
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

  /**
   * Keep the current viewMode in a ref so the PanResponder callbacks
   * (created once via useRef) always read the latest value. Without this
   * the closure captured 'month' at first render and swipes kept shifting
   * by month even after the user switched to week/day mode.
   */
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // ─── Swipe transition animation ───────────────────────────────────────────
  // Animated.Value drives a horizontal translate on the calendar body so
  // pan motion is visible in real time, and a quick spring-back snaps the
  // committed period change. Uses native driver — no JS thread overhead.
  const swipeX = useRef(new Animated.Value(0)).current;
  const screenWidth = Dimensions.get('window').width;

  const animateCommit = useCallback((direction: -1 | 1) => {
    Animated.sequence([
      // Fly the current view off the edge in the swipe direction.
      Animated.timing(swipeX, {
        toValue: -direction * screenWidth,
        duration: 160,
        useNativeDriver: true,
      }),
      // Reset instantly to opposite edge, ready for the new period to slide in.
      Animated.timing(swipeX, {
        toValue: direction * screenWidth,
        duration: 0,
        useNativeDriver: true,
      }),
      // Slide the new period in.
      Animated.spring(swipeX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
        speed: 14,
      }),
    ]).start();
  }, [swipeX, screenWidth]);

  const panResponder = useRef(
    PanResponder.create({
      // Only claim the gesture if it's predominantly horizontal
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * SWIPE_RATIO &&
        Math.abs(gs.dx) > 10,

      onPanResponderMove: (_, gs) => {
        // Follow the finger with mild rubber-banding so over-pull feels natural.
        swipeX.setValue(gs.dx * 0.6);
      },

      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < SWIPE_THRESHOLD) {
          // Below threshold — bounce back.
          Animated.spring(swipeX, {
            toValue: 0, useNativeDriver: true, bounciness: 4,
          }).start();
          return;
        }
        const mode = viewModeRef.current;
        const direction: -1 | 1 = gs.dx < 0 ? 1 : -1;
        if (direction === 1) {
          setSelectedDate((prev) => shiftDate(prev, mode, 1));
        } else {
          setSelectedDate((prev) => shiftDate(prev, mode, -1));
        }
        animateCommit(direction);
      },
    }),
  ).current;

  // ─── Events for current day (DayView) ────────────────────────────────────

  const todayEvents: EventSummary[] = displayEventsByDate[toDateKey(selectedDate)] ?? [];
  const todayTodos = todosByDate[toDateKey(selectedDate)] ?? [];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={styles.container}>
        {/*
          Category filter button — top-left affordance that opens a modal
          letting the user dim/undim events by category.  Positioned
          absolutely so the existing CalendarHeader layout stays untouched.
        */}
        <TouchableOpacity
          style={styles.catFilterBtn}
          onPress={() => setCatFilterVisible(true)}
          accessibilityLabel="카테고리 필터"
        >
          <Ionicons
            name="funnel-outline"
            size={18}
            color={dimmedCats.size > 0 ? colors.primary : colors.textSecondary}
          />
          {dimmedCats.size > 0 && (
            <View style={[styles.catFilterBadge, { backgroundColor: colors.primary }]} />
          )}
        </TouchableOpacity>

        {/*
          Month view only: toggle between detailed (title bars) and
          compact (colour dots) density. Right-side companion to the
          category filter button.
        */}
        {viewMode === 'month' && (
          <TouchableOpacity
            style={styles.densityBtn}
            onPress={() =>
              setMonthDensity((d) => (d === 'detailed' ? 'compact' : 'detailed'))
            }
            accessibilityLabel="월 뷰 밀도 전환"
          >
            <Ionicons
              name={monthDensity === 'detailed' ? 'list' : 'apps-outline'}
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {/* Fixed header: period title + view mode tabs */}
        <CalendarHeader
          viewMode={viewMode}
          currentDate={selectedDate}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onYearMonthPress={handleYearMonthPress}
          onViewModeChange={setViewMode}
        />

        {/* Year/month picker modal — opens when the header title is tapped */}
        <YearMonthPicker
          visible={pickerVisible}
          currentDate={selectedDate}
          onSelect={handleYearMonthSelect}
          onClose={() => setPickerVisible(false)}
        />

        {/* Swipe-enabled content area */}
        <Animated.View
          style={[styles.content, { transform: [{ translateX: swipeX }] }]}
          {...panResponder.panHandlers}
        >
          {viewMode === 'month' && (
            <MonthView
              currentMonth={selectedDate}
              selectedDate={selectedDate}
              eventsByDate={displayEventsByDate}
              todosByDate={todosByDate}
              density={monthDensity}
              onDateSelect={handleDateSelect}
            />
          )}

          {viewMode === 'week' && (
            <WeekView
              selectedDate={selectedDate}
              eventsByDate={displayEventsByDate}
              onEventPress={handleEventPress}
              onDateSelect={(date) => {
                setSelectedDate(date);
                setViewMode('day');
              }}
              onReschedule={handleReschedule}
              todosByDate={todosByDate}
            />
          )}

          {viewMode === 'day' && (
            <DayView
              selectedDate={selectedDate}
              events={todayEvents}
              onEventPress={handleEventPress}
              todos={todayTodos}
            />
          )}
        </Animated.View>

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

        {/* Category dim filter modal */}
        <Modal
          visible={catFilterVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCatFilterVisible(false)}
        >
          <Pressable
            style={styles.catModalBackdrop}
            onPress={() => setCatFilterVisible(false)}
          >
            <Pressable
              style={styles.catModalSheet}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.catModalTitle}>카테고리 필터</Text>
              <Text style={styles.catModalHint}>
                체크 해제한 카테고리는 달력에서 연하게 표시됩니다.
              </Text>

              {/* Row: "카테고리 없음" first so uncategorised events can be toggled. */}
              {[{ id: '__none__', name: '카테고리 없음', color: colors.textSecondary } as const,
                ...categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))]
                .map((row) => {
                  const active = !dimmedCats.has(row.id);
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={styles.catModalRow}
                      onPress={() => toggleCategoryDim(row.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.catModalDot, { backgroundColor: row.color }]} />
                      <Text
                        style={[
                          styles.catModalName,
                          !active && { opacity: 0.45 },
                        ]}
                        numberOfLines={1}
                      >
                        {row.name}
                      </Text>
                      <Ionicons
                        name={active ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={active ? colors.primary : colors.border}
                      />
                    </TouchableOpacity>
                  );
                })}
            </Pressable>
          </Pressable>
        </Modal>
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
    // Top-left category filter affordance.
    catFilterBtn: {
      position: 'absolute',
      top: 12,
      left: 12,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 5,
    },
    catFilterBadge: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    densityBtn: {
      position: 'absolute',
      top: 12,
      left: 52,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 5,
    },
    catModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    catModalSheet: {
      width: '85%',
      maxWidth: 340,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 20,
    },
    catModalTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    catModalHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    catModalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
    },
    catModalDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 12,
    },
    catModalName: {
      flex: 1,
      fontSize: 15,
      color: colors.textPrimary,
    },
    /** Floating action button — bottom-right, positioned above NLInputBar to avoid blocking its send button. */
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 96, // NLInputBar 위로 올림 (기존 24 → 96, NL 입력바 높이 + 여백)
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
