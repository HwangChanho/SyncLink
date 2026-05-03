/**
 * WeekView — 7-day time-grid calendar view.
 *
 * Layout (vertical scroll):
 *  ┌────────────────────────────────────────┐
 *  │ [Day headers: Sun Mon Tue ... Sat]     │
 *  ├────────────────────────────────────────┤
 *  │ [All-day strip: chip chip chip...]     │  ← shown when allDay events exist
 *  ├──────┬─────────────────────────────────┤
 *  │ 00   │  Day columns (7 columns)        │
 *  │ 01   │  EventBlocks positioned by time │
 *  │ ...  │                                 │
 *  │ 23   │                                 │
 *  └──────┴─────────────────────────────────┘
 *
 * Overlap handling: events that overlap in time are rendered side-by-side
 * using a greedy column-assignment algorithm.
 *
 * All-day events: rendered as full-width chip rows in the all-day strip above
 * the time grid, so they never occlude timed events.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
  Alert,
} from 'react-native';
// Phase 5 — pure React Native ScrollView. The drag system below uses
// PanResponder hit-testing to claim touches that land on event chips and
// yields all other touches to ScrollView so vertical scroll just works.
import { ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { EventSummary } from '@/types';
import type { FreeSlot } from '@/types/freeTime';
import { EventBlock } from './EventBlock';
import { UndoToast, useUndoToast } from './UndoToast';
import { useOptimisticReschedule } from './useOptimisticReschedule';
import { DragGhost } from './DragGhost';
import { useGridDragHandler, type DragLayoutRect } from './useGridDragHandler';
import { deleteEvent } from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';
import { applyDelta } from '@/lib/calendarGeometry';
import { useColors } from '@/hooks/useColors';
import { useTranslatedTitles } from '@/hooks/useTranslatedTitles';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { computeEventLayout } from '@/lib/calendarLayout';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Pixel height per hour in the time grid. */
const HOUR_HEIGHT = 60;
/** Total pixel height of the 24-hour grid. */
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;
/** Width of the hour-label column on the left. */
const TIME_COL_WIDTH = 44;
/** Height of each all-day event chip row in the strip. */
const ALL_DAY_CHIP_HEIGHT = 20;
/** Vertical padding inside the all-day strip. */
const ALL_DAY_STRIP_V_PAD = 4;

// ─── Types ─────────────────────────────────────────────────────────────────

interface WeekViewProps {
  /**
   * Any date within the target week. The view always shows Sun–Sat of
   * the week that contains this date.
   */
  selectedDate: Date;
  /**
   * All fetched events indexed by ISO date key (YYYY-MM-DD).
   * Pass eventStore.eventsByDate.
   */
  eventsByDate: Record<string, EventSummary[]>;
  /** Called when the user taps an event block. */
  onEventPress: (event: EventSummary) => void;
  /** Called when the user taps a day header to drill into DayView. */
  onDateSelect: (date: Date) => void;
  /**
   * Optional planner todos bucketed by ISO date key. Rendered as small
   * outlined chips in the all-day strip so a user glancing at a week
   * sees both events and due tasks on the same timeline.
   */
  todosByDate?: Record<string, { id: string; title: string; color: string }[]>;
  /**
   * PRD 4.2 Tier 2 — optional free-time slots to overlay on the time grid.
   * Each slot is rendered as a translucent shaded band positioned by start
   * and end clock times, clamped per day column. When undefined or empty,
   * no overlay is drawn (toggle is off).
   */
  freeSlots?: FreeSlot[];

  /**
   * PRD 4.2 Tier 3 — callback fired when the user taps a free-time overlay band.
   * The parent screen uses this to open FreeTimeRecommendSheet with the tapped slot.
   *
   * @param slot - The FreeSlot the user tapped on
   */
  onFreeSlotPress?: (slot: FreeSlot) => void;

  /**
   * Called whenever drag-to-reschedule enters or leaves "edit mode"
   * (i.e. dragState transitions). The parent (calendar.tsx) gates its
   * outer left/right swipe-to-navigate PanResponder on this so the two
   * gestures can't fight while a card is being moved.
   */
  onDragModeChange?: (isDragging: boolean) => void;

  /**
   * Build-55 — empty-slot quick create. Fires on a short tap on an empty
   * area of the time grid. Receives the touched date + start hour/minute
   * (snapped to `snapMinutes`). Parent typically routes this to
   * `/event/create?date=YYYY-MM-DD&startHour=H&startMinute=M`.
   *
   * Skipped when the user is scrolling (the gesture hook yields control
   * to the underlying ScrollView before the tap callback fires).
   */
  onEmptySlotPress?: (date: Date, hour: number, minute: number) => void;
}

// ─── Date utilities ────────────────────────────────────────────────────────

/** Returns the ISO date key (YYYY-MM-DD) for a Date. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True if two dates share the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Returns the 7 dates (Sun–Sat) for the week containing `date`.
 * Week starts on Sunday (index 0).
 */
function getWeekDays(date: Date): Date[] {
  const dow = date.getDay(); // 0 = Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(date);
    d.setDate(date.getDate() - dow + i);
    // Reset time component to midnight to avoid DST edge cases
    d.setHours(0, 0, 0, 0);
    return d;
  });
}

// Overlap layout helper lives in `@/lib/calendarLayout` — shared with DayView.
const computeLayout = (events: EventSummary[]) =>
  computeEventLayout(events, HOUR_HEIGHT);

// ─── Hour labels ───────────────────────────────────────────────────────────

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * 7-day time-grid view showing events as positioned blocks.
 * Scrolls vertically; day headers stay fixed at the top.
 */
export function WeekView({
  selectedDate,
  eventsByDate,
  onEventPress,
  onDateSelect,
  todosByDate,
  freeSlots,
  onFreeSlotPress,
  onDragModeChange,
  onEmptySlotPress,
}: WeekViewProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const removeEvent = useEventStore((s) => s.removeEvent);

  const weekDays = getWeekDays(selectedDate);
  const today = new Date();
  const scrollRef = useRef<ScrollView>(null);
  // Measured width of the 7-day grid (total), used to compute a single
  // column width passed to EventBlock for drag-to-reschedule snapping.
  const [gridWidth, setGridWidth] = useState(0);
  const columnWidth = gridWidth > 0 ? gridWidth / 7 : 0;

  // Build-47 — ref to the eventsArea View so we can measure its on-screen
  // page position. The drag hook subtracts this from pageX/pageY at touch
  // time to get hit-test coords in the same space as `dragLayouts`. We
  // re-measure on layout AND on every scroll because eventsArea sits
  // inside a ScrollView, so its pageY shifts as the user scrolls.
  const eventsAreaRef = useRef<View>(null);
  const pageOffsetRef = useRef({ x: 0, y: 0 });
  const measureEventsArea = useCallback(() => {
    eventsAreaRef.current?.measureInWindow((x, y) => {
      pageOffsetRef.current = { x, y };
    });
  }, []);
  // Defer one frame after mount so the layout commit has settled before
  // measureInWindow runs. Prevents pageOffsetRef from staying at {0,0}
  // long enough for the first user touch to false-positive against the
  // raw page coords (Build-47 regression).
  useEffect(() => {
    const id = requestAnimationFrame(() => measureEventsArea());
    return () => cancelAnimationFrame(id);
  }, [measureEventsArea]);

  /**
   * Phase 5 — drag-to-reschedule UI state.
   *
   * `useGridDragHandler` (PanResponder at the day-columns container) drives
   * the drag flow without any external gesture library. It exposes the live
   * dragState we use both to dim the original chip and to render a
   * <DragGhost> that follows the finger.
   *
   * Drop handling stays in `useOptimisticReschedule` (conflict gate +
   * optimistic store upsert + undo toast) — only the input is reshaped via
   * an `applyDelta` wrapper so the existing hook keeps working unchanged.
   */
  const { toast: undoToast, showUndo } = useUndoToast();
  const handleRescheduleDrop = useOptimisticReschedule({ onMoved: showUndo });

  const handleGridDrop = useCallback(
    (event: EventSummary, dayDelta: number, minuteDelta: number) => {
      const { newStartAt, newEndAt } = applyDelta(
        event.startAt, event.endAt, dayDelta, minuteDelta,
      );
      handleRescheduleDrop({
        event, dayDelta, minuteDelta, newStartAt, newEndAt,
      });
    },
    [handleRescheduleDrop],
  );

  /**
   * Pre-computed pixel rectangles for every visible event. The drag hook
   * hit-tests touchStart against these in O(n) where n is "events on screen
   * this week" (typically a few dozen). Recomputed only when the visible
   * data changes — kept memoised to avoid re-creating the PanResponder.
   */
  const dragLayouts = useMemo<DragLayoutRect[]>(() => {
    if (columnWidth <= 0) return [];
    const out: DragLayoutRect[] = [];
    weekDays.forEach((day, idx) => {
      const k = toDateKey(day);
      const timed = (eventsByDate[k] ?? []).filter((e) => !e.allDay);
      computeLayout(timed).forEach((lay) => {
        out.push({
          event:    lay.event,
          dayIndex: idx,
          left:     idx * columnWidth + lay.leftFraction * columnWidth,
          top:      lay.topOffset,
          width:    lay.widthFraction * columnWidth,
          height:   lay.height,
        });
      });
    });
    return out;
  }, [weekDays, eventsByDate, columnWidth]);

  // Empty-area tap → resolve the touched (day, hour, minute) and forward
  // to the parent. Snap to the same step the drag-drop uses (15 min
  // default) so the create-screen pre-fill matches what the user sees in
  // the grid.
  const handleEmptyTap = useCallback((localX: number, localY: number) => {
    if (!onEmptySlotPress) return;
    if (columnWidth <= 0) return;
    const dayIndex = Math.max(0, Math.min(6, Math.floor(localX / columnWidth)));
    const day = weekDays[dayIndex];
    if (!day) return;
    const totalMinutes = (localY / HOUR_HEIGHT) * 60;
    const snapped = Math.max(0, Math.min(24 * 60 - 15,
      Math.round(totalMinutes / 15) * 15));
    onEmptySlotPress(day, Math.floor(snapped / 60), snapped % 60);
  }, [columnWidth, weekDays, onEmptySlotPress]);

  // Build-57 — drag 중 위쪽으로 끌어 올리면 삭제. 임계값은 trash 버튼
  // 영역에 맞춰 -28 (eventsArea 바로 위 약 28px) 으로 둠.
  const handleDragDelete = useCallback((event: EventSummary) => {
    Alert.alert(
      t('event.delete'),
      t('event.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            removeEvent(event.id);
            try {
              await deleteEvent(event.id);
            } catch (err) {
              Alert.alert(
                t('common.error'),
                err instanceof Error ? err.message : t('common.delete_failed'),
              );
            }
          },
        },
      ],
    );
  }, [removeEvent, t]);

  const { panHandlers: gridPanHandlers, dragState, candidateEvent } =
    useGridDragHandler({
      layouts:    dragLayouts,
      columnWidth,
      viewMode:   'week',
      onDropped:  handleGridDrop,
      onTap:      onEventPress,
      onDelete:   handleDragDelete,
      deleteZoneThreshold: -28,
      ...(onEmptySlotPress ? { onEmptyTap: handleEmptyTap } : {}),
      pageOffsetRef,
    });

  // Notify the parent screen when drag mode toggles so it can gate its
  // outer left/right swipe-to-navigate gesture.
  useEffect(() => {
    onDragModeChange?.(dragState !== null);
  }, [dragState, onDragModeChange]);

  // Scroll to 8 AM on mount so mornings are visible by default
  const handleLayout = () => {
    scrollRef.current?.scrollTo({ y: HOUR_HEIGHT * 7, animated: false });
  };

  /**
   * Drag-on-day-headers gesture (TASK-1901).
   * The user lays a finger on any day-of-week header and drags left or
   * right to scrub through days without lifting. We map cumulative dx
   * into integer day deltas (one day per ~32 px of horizontal movement)
   * and call onDateSelect with the new date.
   *
   * The PanResponder only takes over when the gesture is clearly a
   * horizontal drag (>5 px and predominantly horizontal); short taps
   * still bubble down to the TouchableOpacity onPress so single-tap
   * navigation keeps working.
   */
  const headerDragRef = useRef<{ baseDate: Date | null; lastDelta: number }>({
    baseDate: null,
    lastDelta: 0,
  });
  const headerPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 5 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderGrant: () => {
        headerDragRef.current = { baseDate: selectedDate, lastDelta: 0 };
      },
      onPanResponderMove: (_, gs) => {
        const base = headerDragRef.current.baseDate;
        if (!base) return;
        // Scrub speed: one day per 32 px of finger travel.
        const delta = Math.round(-gs.dx / 32);
        if (delta === headerDragRef.current.lastDelta) return;
        headerDragRef.current.lastDelta = delta;
        const next = new Date(base);
        next.setDate(next.getDate() + delta);
        onDateSelect(next);
      },
      onPanResponderRelease: () => {
        headerDragRef.current = { baseDate: null, lastDelta: 0 };
      },
      onPanResponderTerminate: () => {
        headerDragRef.current = { baseDate: null, lastDelta: 0 };
      },
    }),
  ).current;

  // Sprint 19 TASK-1907 — collect every event ID visible across the 7-day
  // grid so a single cache-only SELECT yields translations for the whole
  // view (Pro users on a non-default locale).
  const visibleEventIds = useMemo(() => {
    const ids: string[] = [];
    for (const day of weekDays) {
      const k = toDateKey(day);
      const list = eventsByDate[k];
      if (!list) continue;
      for (const e of list) ids.push(e.id);
    }
    return ids;
  }, [weekDays, eventsByDate]);
  const translatedTitles = useTranslatedTitles(visibleEventIds);

  /**
   * PRD 4.2 Tier 2 — split provided freeSlots per visible day column.
   * Each slot is clamped to the day's [00:00, 24:00) window and converted
   * into pixel offset+height pairs the overlay layer renders. A slot that
   * straddles midnight produces two entries (one per day). Memoised so the
   * overlay only recomputes when the slots or the visible week change.
   *
   * PRD 4.2 Tier 3 (Day 4): originalSlot 필드 추가.
   * onFreeSlotPress 콜백에 원본 FreeSlot을 전달하기 위해 각 bucket에 저장.
   */
  const freeSlotsByDayKey = useMemo(() => {
    const map: Record<string, { topOffset: number; height: number; originalSlot: FreeSlot }[]> = {};
    if (!freeSlots || freeSlots.length === 0) return map;

    for (const day of weekDays) {
      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEndMs = dayStart.getTime() + 24 * 60 * 60_000;
      const buckets: { topOffset: number; height: number; originalSlot: FreeSlot }[] = [];

      for (const slot of freeSlots) {
        const startMs = Math.max(slot.start.getTime(), dayStart.getTime());
        const endMs   = Math.min(slot.end.getTime(),   dayEndMs);
        if (endMs <= startMs) continue;
        // Convert to hour-of-day relative to the day's midnight
        const topHours    = (startMs - dayStart.getTime()) / 3_600_000;
        const heightHours = (endMs   - startMs)            / 3_600_000;
        if (heightHours <= 0) continue;
        buckets.push({
          topOffset:    topHours    * HOUR_HEIGHT,
          height:       heightHours * HOUR_HEIGHT,
          originalSlot: slot,  // Tier 3: 탭 시 onFreeSlotPress에 전달
        });
      }
      if (buckets.length > 0) map[toDateKey(day)] = buckets;
    }
    return map;
  }, [freeSlots, weekDays]);

  // Determine if any day this week has all-day events OR planner todos
  // (the strip now hosts both so the user sees every day-scoped item in
  // one place).
  const hasAllDayEvents = weekDays.some((day) => {
    const key = toDateKey(day);
    const hasEvt = (eventsByDate[key] ?? []).some((e) => e.allDay);
    const hasTodo = (todosByDate?.[key]?.length ?? 0) > 0;
    return hasEvt || hasTodo;
  });

  return (
    <View style={styles.container}>
      {/* ─── Day header row (fixed; pannable for drag-to-scrub) ─── */}
      <View style={styles.dayHeaderRow} {...headerPan.panHandlers}>
        {/* Spacer aligning with the time label column */}
        <View style={{ width: TIME_COL_WIDTH }} />
        {weekDays.map((day, idx) => {
          const isToday = isSameDay(day, today);
          const isSelected = isSameDay(day, selectedDate);
          return (
            <TouchableOpacity
              key={toDateKey(day)}
              style={styles.dayHeaderCell}
              onPress={() => onDateSelect(day)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dowLabel, isToday && styles.activeDowLabel]}>
                {DOW_LABELS[idx]}
              </Text>
              <View style={[
                styles.dayNumberWrap,
                isToday && styles.todayCircle,
                isSelected && !isToday && styles.selectedCircle,
              ]}>
                <Text style={[
                  styles.dayNumber,
                  isToday && styles.todayNumber,
                  isSelected && !isToday && styles.selectedNumber,
                ]}>
                  {day.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ─── All-day strip (fixed, shown only when all-day events exist) ─── */}
      {hasAllDayEvents && (
        <View style={styles.allDayStrip}>
          {/* Spacer aligning with the time label column */}
          <View style={{ width: TIME_COL_WIDTH }} />
          {weekDays.map((day) => {
            const dateKey = toDateKey(day);
            const allDayEvts = (eventsByDate[dateKey] ?? []).filter((e) => e.allDay);
            const dayTodos = todosByDate?.[dateKey] ?? [];
            return (
              <View key={dateKey} style={styles.allDayCol}>
                {allDayEvts.map((evt) => (
                  <TouchableOpacity
                    key={evt.id}
                    onPress={() => onEventPress(evt)}
                    activeOpacity={0.8}
                    style={[styles.allDayChip, { backgroundColor: evt.color ?? colors.primary }]}
                  >
                    <Text style={styles.allDayChipText} numberOfLines={1}>
                      {translatedTitles.get(evt.id) ?? evt.title}
                    </Text>
                  </TouchableOpacity>
                ))}
                {dayTodos.map((td) => (
                  <View
                    key={td.id}
                    style={[
                      styles.allDayChip,
                      {
                        backgroundColor: td.color + '22',
                        borderLeftWidth: 3,
                        borderLeftColor: td.color,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.allDayChipText, { color: td.color }]}
                      numberOfLines={1}
                    >
                      ✓ {td.title}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}

      {/* ─── Scrollable time grid ─── */}
      <ScrollView
        ref={scrollRef}
        onLayout={handleLayout}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
        onScroll={measureEventsArea}
        scrollEventThrottle={16}
        // Build-51 — freeze the 24-hour grid scroll while a drag is in
        // flight so the user's vertical finger movement only repositions
        // the dragged ghost. Otherwise iOS's native UIScrollView would
        // continue tracking and the grid would scroll out from under the
        // chip even though our PanResponder owns the touch (LEAD report
        // "여전히 주에서 일정옮길때 위아래 움직여").
        scrollEnabled={dragState === null}
      >
        <View style={[styles.gridRow, { height: TOTAL_HEIGHT }]}>
          {/* Hour label column */}
          <View style={[styles.timeCol, { height: TOTAL_HEIGHT }]}>
            {HOURS.map((h) => (
              <View key={h} style={[styles.hourLabelWrap, { top: h * HOUR_HEIGHT - 8 }]}>
                <Text style={styles.hourLabel}>
                  {h === 0 ? '' : `${h}:00`}
                </Text>
              </View>
            ))}
          </View>

          {/*
            Event grid area — onLayout measures one-day column width.
            {...gridPanHandlers} attaches the root PanResponder. Touches
            on event chips are claimed for drag; everything else falls
            through to the parent ScrollView (vertical scroll keeps
            working without a single line of orchestration glue).
          */}
          <View
            ref={eventsAreaRef}
            style={styles.eventsArea}
            onLayout={(e) => {
              setGridWidth(e.nativeEvent.layout.width);
              measureEventsArea();
            }}
            {...gridPanHandlers}
          >
            {/* Hour separator lines */}
            {HOURS.map((h) => (
              <View
                key={h}
                style={[
                  styles.hourLine,
                  { top: h * HOUR_HEIGHT },
                  h % 6 === 0 && styles.majorHourLine,
                ]}
              />
            ))}

            {/* Vertical column separators */}
            {weekDays.map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.colSeparator,
                  { left: `${((idx + 1) / 7) * 100}%` },
                ]}
              />
            ))}

            {/* Events for each day column — allDay events go to the strip above */}
            {weekDays.map((day, idx) => {
              const dateKey = toDateKey(day);
              const dayEvents = eventsByDate[dateKey] ?? [];
              // Exclude allDay events; those are rendered in the all-day strip
              const timedEvents = dayEvents.filter((e) => !e.allDay);
              const layouts = computeLayout(timedEvents);

              const slotsForDay = freeSlotsByDayKey[dateKey] ?? [];

              return (
                <View
                  key={dateKey}
                  style={[
                    styles.dayCol,
                    {
                      left: `${(idx / 7) * 100}%`,
                      width: `${100 / 7}%`,
                      height: TOTAL_HEIGHT,
                    },
                  ]}
                >
                  {/*
                    PRD 4.2 Tier 2 — free-time overlay: rendered before
                    EventBlocks so events sit on top. testID lets the QA
                    smoke test assert visibility per day.

                    PRD 4.2 Tier 3 (Day 4): onFreeSlotPress가 제공될 때
                    TouchableOpacity로 감싸서 탭 이벤트 전달.
                    onFreeSlotPress 없으면 기존 pointerEvents="none" 유지.
                  */}
                  {slotsForDay.map((s, i) =>
                    onFreeSlotPress ? (
                      <TouchableOpacity
                        key={`free-${i}`}
                        activeOpacity={0.7}
                        onPress={() => onFreeSlotPress(s.originalSlot)}
                        testID={`week-free-slot-${dateKey}`}
                        accessibilityRole="button"
                        style={[
                          styles.freeSlotOverlay,
                          { top: s.topOffset, height: s.height },
                        ]}
                      />
                    ) : (
                      <View
                        key={`free-${i}`}
                        pointerEvents="none"
                        testID={`week-free-slot-${dateKey}`}
                        style={[
                          styles.freeSlotOverlay,
                          { top: s.topOffset, height: s.height },
                        ]}
                      />
                    ),
                  )}

                  {layouts.map((lay) => {
                    const tt = translatedTitles.get(lay.event.id);
                    // Dim the original chip while it's the active drag
                    // source — visual cue that the floating ghost is the
                    // "live" copy.
                    const isDragSource =
                      dragState !== null && dragState.event.id === lay.event.id;
                    // Long-press in progress (touched but timer not yet
                    // fired). Renders a ring so the user gets immediate
                    // feedback the touch was received — also serves as
                    // diagnostics if drag misbehaves.
                    const isCandidate =
                      candidateEvent !== null && candidateEvent.id === lay.event.id;
                    return (
                      <View
                        key={lay.event.id}
                        style={[
                          isDragSource && styles.draggingSource,
                          isCandidate && styles.candidateChip,
                        ]}
                      >
                        <EventBlock
                          event={lay.event}
                          topOffset={lay.topOffset}
                          height={lay.height}
                          widthFraction={lay.widthFraction}
                          leftFraction={lay.leftFraction}
                          onPress={onEventPress}
                          {...(tt ? { translatedTitle: tt } : {})}
                        />
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {/*
              Floating ghost — rendered inside the same eventsArea coordinate
              system that the drag hook uses for hit-testing, so its (left,
              top) match the finger position 1:1.
            */}
            {dragState && <DragGhost drag={dragState} />}
          </View>
        </View>
      </ScrollView>

      {/*
        TASK-009 Day 4 — Undo toast overlay.
        Rendered when a drag-to-reschedule was just completed and the user
        hasn't yet tapped "되돌리기" or waited 5 seconds.
        Positioned at the bottom of the calendar view; does not intercept
        touches on the calendar grid (only the toast itself is touchable).
      */}
      {undoToast && <UndoToast toast={undoToast} />}
      {/*
        Edit-mode dim — light wash painted over the whole grid while a
        drag is in flight. pointerEvents='none' so the active drag's
        touch events still reach the granted PanResponder unchanged;
        new taps on FAB/NL bar etc. are suppressed automatically by RN
        responder semantics (the responder is already taken).
      */}
      {dragState && (
        <View pointerEvents="none" style={styles.editModeDim} />
      )}

      {/*
        Build-57 — drag 중에만 화면 상단에 trash 영역 노출. 사용자가
        chip 을 위로 끌어 이 영역 위에서 손을 떼면 useGridDragHandler
        의 onDelete 가 호출 (deleteZoneThreshold=-28 이므로 eventsArea
        위로 28px 위 = 이 trash 영역). pointerEvents='none' — 이미
        진행 중인 PanResponder 가 모든 touch 를 소유.
      */}
      {dragState && (
        <View pointerEvents="none" style={styles.deleteZone}>
          <Ionicons name="trash" size={20} color={colors.error} />
          <Text style={styles.deleteZoneText}>{t('event.drop_to_delete')}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DAY_HEADER_HEIGHT = 56;
const DATE_CIRCLE = 28;

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    height: DAY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dowLabel: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
  },
  activeDowLabel: {
    color: colors.primary,
  },
  dayNumberWrap: {
    width: DATE_CIRCLE,
    height: DATE_CIRCLE,
    borderRadius: DATE_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: {
    backgroundColor: colors.primary,
  },
  selectedCircle: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  dayNumber: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  todayNumber: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  selectedNumber: {
    color: colors.primary,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  gridRow: {
    flexDirection: 'row',
  },
  timeCol: {
    width: TIME_COL_WIDTH,
    position: 'relative',
  },
  hourLabelWrap: {
    position: 'absolute',
    right: spacing[2],
    width: TIME_COL_WIDTH - spacing[2],
    alignItems: 'flex-end',
  },
  hourLabel: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  eventsArea: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  majorHourLine: {
    backgroundColor: colors.borderStrong,
  },
  colSeparator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dayCol: {
    position: 'absolute',
    top: 0,
    paddingHorizontal: 1,
    borderRadius: radius.sm,
  },

  // ── All-day strip ──────────────────────────────────────────────────────────

  /** Horizontal row between day headers and the time grid. */
  allDayStrip: {
    flexDirection: 'row',
    paddingVertical: ALL_DAY_STRIP_V_PAD,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  /** Per-day column inside the strip; flex: 1 so all 7 columns share equal width. */
  allDayCol: {
    flex: 1,
    gap: 2,
    paddingHorizontal: 1,
  },
  /** Full-width colored chip representing one all-day event. */
  allDayChip: {
    height: ALL_DAY_CHIP_HEIGHT,
    borderRadius: radius.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing[1],
  },
  /**
   * Text inside the all-day chip sits on a colored (event.color) background.
   * textInverse (white in light, gray-900 in dark) ensures contrast against
   * any saturated event color in both themes.
   */
  allDayChipText: {
    ...textStyles.caption,
    color: colors.textInverse,
    fontWeight: '600',
  },
  /**
   * PRD 4.2 Tier 2 — translucent shaded band marking a common free
   * window. Uses theme primary at low alpha so it is visible in both
   * light and dark mode without clashing with any event color. Sits
   * underneath events because it is rendered first in the day column.
   */
  freeSlotOverlay: {
    position: 'absolute',
    left: 1,
    right: 1,
    backgroundColor: colors.primary + '22',
    borderLeftWidth: 2,
    borderLeftColor: colors.primary + '88',
    borderRadius: radius.sm,
  },

  /**
   * TASK-009 Day 2 — drop-target snap highlight.
   * Shown in the hovered day column at the snapped time slot while the user
   * is dragging an event (GH feature flag active only).
   * Uses a more saturated primary accent than the free-time overlay so the
   * user can clearly distinguish "where I'm about to drop" from existing
   * free-time bands.
   */
  dropTargetHighlight: {
    position: 'absolute',
    left: 2,
    right: 2,
    backgroundColor: colors.primary + '44',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  // Phase 5 — original chip is dimmed while the floating ghost follows
  // the finger. The drag hook owns the source-of-truth coords, so the
  // resting chip just needs a visual cue.
  draggingSource: {
    opacity: 0.35,
  },
  // Long-press in progress (before the 500 ms threshold). A bright ring
  // gives the user immediate feedback that the chip was touched, and
  // also serves as a diagnostic — if no ring appears when a chip is
  // pressed, the gesture handler isn't receiving the touch.
  candidateChip: {
    shadowColor:    colors.primary,
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.9,
    shadowRadius:   8,
    elevation:      8,
    transform:      [{ scale: 1.02 }],
  },
  // Edit-mode visual cue — subtle dim wash so the user feels they're in
  // a "moving" state without obscuring the calendar grid underneath.
  editModeDim: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.10)',
  },
  // Build-57 → Build-61 — drag 중 trash drop zone.
  // LEAD 보고: "주에서 일정 이동할 때 위에 일정 막대가 길게 뜬다" — 이전엔
  // dayHeader 바로 아래에 가로 full-width 빨간 dashed 막대라 사용자에게
  // 새 일정 chip 처럼 보였다. 작은 둥근 chip 으로 축소 + 화면 상단 가운데
  // 고정 + 색도 연하게.
  deleteZone: {
    position: 'absolute',
    top: 6,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.error + '18',
    borderWidth: 1,
    borderColor: colors.error + '55',
    borderRadius: 999,
  },
  deleteZoneText: {
    ...textStyles.labelSm,
    color: colors.error,
    fontWeight: '600',
  },
  });
}
