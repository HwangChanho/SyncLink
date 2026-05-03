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
  ActionSheetIOS, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { CalendarHeader, type ViewMode } from '@/components/calendar/CalendarHeader';
import { YearMonthPicker } from '@/components/calendar/YearMonthPicker';
import { MonthView } from '@/components/calendar/MonthView';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import { useEventStore } from '@/stores/eventStore';
import { subscribeToSharedEvents } from '@/services/eventRealtimeService';
import { useTodoStore } from '@/stores/todoStore';
import type { MonthViewItem } from '@/components/calendar/MonthView';
import type { EventSummary, Category, SpaceSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { getCategories } from '@/services/categoryService';
// PRD 4.2 Tier 2 — Free time finder UI integration.
import { useTranslation } from 'react-i18next';
import { findFreeSlots } from '@/services/freeTimeService';
import { getMySpaces } from '@/services/spaceService';
import type { FreeSlot } from '@/types/freeTime';

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
  // PRD 4.2 Tier 2 — i18n for free-time UI strings.
  const { t } = useTranslation();
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

  // ── Free time finder (PRD 4.2 Tier 2) ─────────────────────────────────────
  // State is declared first so the effects below can reference it without
  // hitting the temporal dead zone.
  /**
   * Whether the "Show free time" overlay is enabled. When true we fetch
   * common-free slots for the selected space(s) and the current view's
   * date range, then pass them to WeekView/DayView for shaded rendering.
   * Default OFF — opt-in feature.
   */
  const [freeTimeOn, setFreeTimeOn] = useState(false);
  /** Cached list of spaces the current user belongs to. */
  const [mySpaces, setMySpaces] = useState<SpaceSummary[]>([]);
  /**
   * IDs of spaces selected for the intersection. Default = all spaces
   * (the most common "find time when everyone I share with is free"
   * intent). Empty set means none selected → no slots fetched.
   */
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<Set<string>>(new Set());
  /** Free-time slots returned by the service for the current range. */
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  /** Modal visibility for the Space chip-selector. */
  const [spacePickerVisible, setSpacePickerVisible] = useState(false);
  /**
   * Loaded flag — used to distinguish "no slots yet because we haven't
   * fetched" from "fetched and got zero". Drives the empty-state hint.
   */
  const [freeSlotsLoaded, setFreeSlotsLoaded] = useState(false);

  /**
   * Load the user's spaces once on mount so the chip selector and the
   * free-time fetcher both have the list. Failures are non-fatal (the UI
   * just stays in the "no space" empty state).
   */
  useEffect(() => {
    let cancelled = false;
    getMySpaces().then((spaces) => {
      if (cancelled) return;
      setMySpaces(spaces);
      // Default-select every space the first time we load — otherwise
      // the toggle wouldn't show anything because selectedSpaceIds is
      // empty.
      setSelectedSpaceIds((prev) => prev.size === 0
        ? new Set(spaces.map((s) => s.id))
        : prev);
    }).catch(() => {/* non-fatal */});
    return () => { cancelled = true; };
  }, []);

  /**
   * Fetch free-time slots whenever the toggle is on AND the visible
   * range or selected spaces change. We run the finder per space and
   * concatenate — multiple-space deduplication is a Tier 3 concern.
   *
   * When the toggle flips off we clear the loaded flag; the views ignore
   * the cached slots because we pass `undefined` to them.
   */
  useEffect(() => {
    if (!freeTimeOn) {
      setFreeSlotsLoaded(false);
      return;
    }
    if (selectedSpaceIds.size === 0) {
      setFreeSlots([]);
      setFreeSlotsLoaded(true);
      return;
    }
    let cancelled = false;
    const range = getViewRange(selectedDate, viewMode);
    const ids = Array.from(selectedSpaceIds);
    Promise.all(ids.map((spaceId) =>
      findFreeSlots(spaceId, range, { minSlotMinutes: 30 }).catch(() => [] as FreeSlot[]),
    ))
      .then((perSpace) => {
        if (cancelled) return;
        setFreeSlots(perSpace.flat());
        setFreeSlotsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFreeSlots([]);
        setFreeSlotsLoaded(true);
      });
    return () => { cancelled = true; };
  }, [freeTimeOn, selectedSpaceIds, selectedDate, viewMode]);

  /**
   * Toggle the free-time overlay. Side effects (fetching) are handled by
   * the effect above so this stays a pure UI toggle.
   */
  const toggleFreeTime = useCallback(() => {
    setFreeTimeOn((prev) => !prev);
  }, []);

  /**
   * Build-50 follow-up — overflow menu (⋯) for the calendar header.
   * Consolidates the three previous toolbar icons (filter / free-time /
   * density) into a single ActionSheet so the period title can sit
   * uncluttered in the screen centre. Density only appears in month
   * view because compact/detailed only applies there.
   *
   * iOS uses ActionSheetIOS (native sheet); Android falls back to
   * Alert.alert with buttons because we don't want to add a bottom-sheet
   * dependency for v1.0. The Android sheet looks slightly different but
   * the action set is identical.
   */
  const openCalendarOverflowMenu = useCallback(() => {
    const items: { label: string; onPress: () => void }[] = [
      {
        label: dimmedCats.size > 0 ? '카테고리 필터 (활성)' : '카테고리 필터',
        onPress: () => setCatFilterVisible(true),
      },
      {
        label: freeTimeOn ? '빈 시간 끄기' : '빈 시간 켜기',
        onPress: toggleFreeTime,
      },
    ];
    if (viewMode === 'month') {
      items.push({
        label: monthDensity === 'detailed' ? '간략 보기 (점)' : '상세 보기 (제목)',
        onPress: () => setMonthDensity((d) => (d === 'detailed' ? 'compact' : 'detailed')),
      });
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...items.map((i) => i.label), '취소'],
          cancelButtonIndex: items.length,
        },
        (idx) => {
          if (idx >= 0 && idx < items.length) items[idx]!.onPress();
        },
      );
    } else {
      Alert.alert('더보기', undefined, [
        ...items.map((i) => ({ text: i.label, onPress: i.onPress })),
        { text: '취소', style: 'cancel' as const },
      ]);
    }
  }, [dimmedCats, freeTimeOn, viewMode, monthDensity, toggleFreeTime]);

  /**
   * Add or remove a space from the chip selector. The free-time fetcher
   * effect re-runs automatically once selectedSpaceIds changes.
   */
  const toggleSpaceSelection = useCallback((spaceId: string) => {
    setSelectedSpaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  }, []);

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

  // Drag-to-reschedule lives entirely inside WeekView/DayView via
  // useOptimisticReschedule (RNGH path). The calendar screen no longer
  // needs to wire its own handler — keeps this file focused on swipe
  // navigation + view-mode/state.

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

  /**
   * Long-pressing a date in MonthView jumps straight to event/create
   * with that date pre-filled (startAt = date 09:00, endAt = date 10:00).
   * Faster than: tap date → enter day view → press + button → fill form.
   */
  const handleDateLongPress = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    router.push(`/event/create?date=${y}-${m}-${d}`);
  }, [router]);

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

  /**
   * E1 fix — Re-fetch the current view range when the calendar screen regains
   * focus (e.g. returning from event/create via router.back()).
   *
   * Without this, `selectedDate` and `viewMode` don't change on back-navigation
   * so the useEffect above never re-fires — the newly created event is in the
   * store via optimistic `upsertEvent` but if the user clears or re-navigates
   * the range is stale. This ensures a server-side re-fetch on every focus so
   * the store and the rendered grid are always in sync.
   *
   * `useFocusEffect` is a no-op on web (Expo Router passes through) so the
   * web path relies on the store-level optimistic upsert in create.tsx.
   */
  useFocusEffect(
    useCallback(() => {
      const range = getViewRange(selectedDate, viewMode);
      void fetchEvents(range);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, viewMode]),
  );

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

  // Build-49 — drag-mode lock. WeekView/DayView call back into us when
  // their drag-to-reschedule enters/leaves edit mode; we keep the value
  // in a ref so the outer swipe PanResponder (created once via useRef)
  // can read the latest state without recreating the responder.
  const isDraggingRef = useRef(false);
  const handleChildDragModeChange = useCallback((dragging: boolean) => {
    isDraggingRef.current = dragging;
  }, []);

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
      // Only claim the gesture if it's predominantly horizontal AND fast enough.
      // The velocity check (vx > 0.3) distinguishes a quick swipe-to-navigate
      // from a slow post-long-press drag (RNGH drag-to-reschedule starts from
      // rest, vx ≈ 0). Without this check the PanResponder intercepts RNGH
      // drags and the event snaps back instead of moving.
      onMoveShouldSetPanResponder: (_, gs) =>
        // Hard gate: while a child is dragging an event chip, never claim
        // the gesture for week-navigation. Belt-and-suspenders with the
        // child PanResponder's onPanResponderTerminationRequest=false.
        !isDraggingRef.current &&
        Math.abs(gs.dx) > Math.abs(gs.dy) * SWIPE_RATIO &&
        Math.abs(gs.dx) > 10 &&
        Math.abs(gs.vx) > 0.3,

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
          Build-50 follow-up — single overflow menu (⋯) replaces the
          three separate left-toolbar buttons. ActionSheet on iOS lists
          filter / free-time / density options; the icon shows a small
          accent dot when any toggle is currently active so the user can
          see "something is on" at a glance without opening the sheet.
        */}
        <CalendarHeader
          viewMode={viewMode}
          currentDate={selectedDate}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onYearMonthPress={handleYearMonthPress}
          onViewModeChange={setViewMode}
          rightToolbar={(
            <TouchableOpacity
              style={styles.toolbarBtn}
              onPress={openCalendarOverflowMenu}
              accessibilityLabel="더보기"
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.textSecondary}
              />
              {(dimmedCats.size > 0 || freeTimeOn) && (
                <View style={[styles.catFilterBadge, { backgroundColor: colors.primary }]} />
              )}
            </TouchableOpacity>
          )}
          onSearchPress={() => router.push('/search')}
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
              onDragModeChange={handleChildDragModeChange}
              density={monthDensity}
              onDateSelect={handleDateSelect}
              onDateLongPress={handleDateLongPress}
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
              todosByDate={todosByDate}
              onDragModeChange={handleChildDragModeChange}
              {...(freeTimeOn ? { freeSlots } : {})}
            />
          )}

          {viewMode === 'day' && (
            <DayView
              selectedDate={selectedDate}
              events={todayEvents}
              onEventPress={handleEventPress}
              todos={todayTodos}
              onDragModeChange={handleChildDragModeChange}
              {...(freeTimeOn ? { freeSlots } : {})}
            />
          )}

          {/*
            PRD 4.2 Tier 2 — contextual hint shown only when the toggle
            is on. Helps the user understand why nothing changed if the
            view/space combination yields no slots. Rendered as a small
            banner above the body so it doesn't shift the calendar grid.
          */}
          {freeTimeOn && (
            <View pointerEvents="none" style={styles.freeTimeHint} testID="free-time-hint">
              <Text style={styles.freeTimeHintText}>
                {viewMode === 'month'
                  ? t('calendar.free_time_month_hint')
                  : mySpaces.length === 0
                    ? t('calendar.free_time_no_space')
                    : freeSlotsLoaded && freeSlots.length === 0
                      ? t('calendar.free_time_empty')
                      : ''}
              </Text>
            </View>
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
          testID="calendar-fab-create"
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

        {/*
          PRD 4.2 Tier 2 — Space chip selector. Long-press on the
          free-time button opens this so users can narrow the
          intersection to a subset of their spaces. Empty state guides
          users to create / join a space first.
        */}
        <Modal
          visible={spacePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setSpacePickerVisible(false)}
        >
          <Pressable
            style={styles.catModalBackdrop}
            onPress={() => setSpacePickerVisible(false)}
          >
            <Pressable
              style={styles.catModalSheet}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.catModalTitle}>{t('calendar.free_time_select')}</Text>
              {mySpaces.length === 0 ? (
                <Text style={styles.catModalHint}>
                  {t('calendar.free_time_no_space')}
                </Text>
              ) : (
                mySpaces.map((sp) => {
                  const active = selectedSpaceIds.has(sp.id);
                  return (
                    <TouchableOpacity
                      key={sp.id}
                      style={styles.catModalRow}
                      onPress={() => toggleSpaceSelection(sp.id)}
                      activeOpacity={0.7}
                      testID={`free-time-space-${sp.id}`}
                    >
                      <View style={[styles.catModalDot, { backgroundColor: colors.primary }]} />
                      <Text
                        style={[styles.catModalName, !active && { opacity: 0.45 }]}
                        numberOfLines={1}
                      >
                        {sp.name}
                      </Text>
                      <Ionicons
                        name={active ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={active ? colors.primary : colors.border}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
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
    // Build-50 — single style for all left-toolbar overlay-toggle buttons
    // (filter / free-time / density). Now flex children inside
    // CalendarHeader's leftToolbar slot, so no more absolute positioning.
    toolbarBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    catFilterBadge: {
      // Build-54 — 8px dot was too easy to miss; LEAD report flagged users
      // not noticing a category filter was active. 11px + white ring lifts
      // it off the icon background without crowding the toolbar.
      position: 'absolute',
      top: 2,
      right: 2,
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    // Build-50 — densityBtn / freeTimeBtn replaced by shared toolbarBtn
    // above. All three overlay-toggle buttons are now flex siblings
    // inside CalendarHeader's leftToolbar slot.
    /**
     * PRD 4.2 Tier 2 — small banner above the calendar body shown only
     * while the toggle is on. Renders contextual hints
     * (no-space / month-only / empty-result).
     */
    freeTimeHint: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      zIndex: 4,
      alignItems: 'center',
    },
    freeTimeHintText: {
      fontSize: 12,
      color: colors.textSecondary,
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
