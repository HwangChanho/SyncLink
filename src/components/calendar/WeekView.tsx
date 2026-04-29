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

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
} from 'react-native';
import { ScrollView } from 'react-native';
import type { EventSummary } from '@/types';
import type { FreeSlot } from '@/types/freeTime';
import { EventBlock } from './EventBlock';
import {
  EventBlockGestureHandler,
  UndoToast,
  useOptimisticReschedule,
  useUndoToast,
} from './EventBlockGestureHandler';
import { useColors } from '@/hooks/useColors';
import { useTranslatedTitles } from '@/hooks/useTranslatedTitles';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Feature flag ─────────────────────────────────────────────────────────────

/**
 * Drag-to-reschedule is enabled in all builds (dev + production).
 * TASK-009 Days 1-5 complete — Gesture Handler v2 + Reanimated 3,
 * long-press 500ms activation, 15-min snapping, conflict detection,
 * optimistic update + undo toast.
 */
// Read dragMode from devConfig when available; default to 'gh' (drag enabled in production).
// Tests can override via jest.mock('@/constants/devConfig', () => ({ dragMode: 'panresponder' }))
// to exercise the PanResponder path without the Gesture Handler overhead.
const DRAG_MODE_GH = (() => {
  try {
    const cfg = require('@/constants/devConfig') as { dragMode?: string };
    return cfg.dragMode !== 'panresponder';
  } catch {
    return true;
  }
})();

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
   * Called after a long-press + drag rearranges an event. The parent is
   * responsible for calling updateEvent() and refreshing the calendar.
   *   dayDelta    = whole columns moved (negative = earlier in week)
   *   minuteDelta = 15-minute snapped vertical movement
   */
  onReschedule?: (
    event: EventSummary,
    dayDelta: number,
    minuteDelta: number,
  ) => void;
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

// ─── Overlap layout ────────────────────────────────────────────────────────

interface LayoutEvent {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction: number;
  leftFraction: number;
}

/**
 * Computes positions for a list of events within a single day column.
 * Overlapping events are split into side-by-side sub-columns.
 *
 * Algorithm (greedy):
 *  1. Sort by start time.
 *  2. Maintain a list of "active columns" tracking the latest end time.
 *  3. Assign each event to the first column whose latest end ≤ event start.
 *  4. After all events are assigned, normalize widths based on max column count.
 */
function computeLayout(events: EventSummary[]): LayoutEvent[] {
  if (events.length === 0) return [];

  // Sort by start time; on tie, longer events first
  const sorted = [...events].sort((a, b) => {
    const diff = a.startAt.getTime() - b.startAt.getTime();
    return diff !== 0 ? diff : b.endAt.getTime() - a.endAt.getTime();
  });

  // Each entry: { event, colIndex, colCount placeholder }
  const assignments: { event: EventSummary; colIndex: number }[] = [];
  // Track the end time of the last event assigned to each sub-column
  const colEndTimes: number[] = [];

  for (const evt of sorted) {
    const startMs = evt.startAt.getTime();
    // Find the first available sub-column
    let assigned = false;
    for (let c = 0; c < colEndTimes.length; c++) {
      if ((colEndTimes[c] ?? 0) <= startMs) {
        assignments.push({ event: evt, colIndex: c });
        colEndTimes[c] = evt.endAt.getTime();
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      assignments.push({ event: evt, colIndex: colEndTimes.length });
      colEndTimes.push(evt.endAt.getTime());
    }
  }

  const totalCols = colEndTimes.length;

  return assignments.map(({ event, colIndex }) => {
    // Convert startAt time-of-day to pixel offset
    const startHour = event.startAt.getHours() + event.startAt.getMinutes() / 60;
    const endHour = event.endAt.getHours() + event.endAt.getMinutes() / 60;
    const durationHours = Math.max(endHour - startHour, 0.25); // min 15 min

    return {
      event,
      topOffset: startHour * HOUR_HEIGHT,
      height: durationHours * HOUR_HEIGHT,
      widthFraction: 1 / totalCols,
      leftFraction: colIndex / totalCols,
    };
  });
}

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
  onReschedule,
  todosByDate,
  freeSlots,
  onFreeSlotPress,
}: WeekViewProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const styles = makeStyles(colors);

  const weekDays = getWeekDays(selectedDate);
  const today = new Date();
  const scrollRef = useRef<ScrollView>(null);
  // Measured width of the 7-day grid (total), used to compute a single
  // column width passed to EventBlock for drag-to-reschedule snapping.
  const [gridWidth, setGridWidth] = useState(0);
  const columnWidth = gridWidth > 0 ? gridWidth / 7 : 0;

  // ── TASK-009 Day 2: drop-target hover state ───────────────────────────────
  // When the GH PoC component is active and the user is dragging, we receive
  // the snapped hover slot via onHoverSlot. Render a highlight band in that
  // day column at the hover time to give a visual "snap target" affordance.

  /**
   * Hover slot state updated by EventBlockGestureHandler via onHoverSlot.
   * `null` when no drag is in progress.
   */
  const [hoverSlot, setHoverSlot] = useState<{
    minuteOfDay: number;
    dayIndex: number;
  } | null>(null);

  /**
   * Stable callback for onHoverSlot prop — avoids recreating EventBlockGH
   * on every render (gesture object rebuild is expensive).
   */
  const handleHoverSlot = useCallback(
    (minuteOfDay: number | null, dayIndex: number | null) => {
      if (minuteOfDay === null || dayIndex === null) {
        setHoverSlot(null);
      } else {
        setHoverSlot({ minuteOfDay, dayIndex });
      }
    },
    [],
  );

  /**
   * TASK-009 Day 4: Undo toast hook — shows a 5-second banner after a
   * successful drag-to-reschedule so the user can revert immediately.
   */
  const { toast: undoToast, showUndo } = useUndoToast();

  /**
   * TASK-009 Day 3+4: stable drop handler via useOptimisticReschedule.
   * Day 4 addition: passes showUndo so a toast appears after each move.
   */
  const handleDropped = useOptimisticReschedule({ onMoved: showUndo });

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

          {/* Event grid area — measured so drag-to-reschedule knows column width */}
          <View
            style={styles.eventsArea}
            onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
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

              // TASK-009 Day 2: check if this column has an active hover slot
              const isHoverColumn =
                DRAG_MODE_GH &&
                hoverSlot !== null &&
                hoverSlot.dayIndex === idx;
              // Snap highlight height = 30-min slot in pixels (HOUR_HEIGHT / 2)
              const HOVER_SLOT_HEIGHT = HOUR_HEIGHT / 2;

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

                  {/*
                    TASK-009 Day 2 — drop-target highlight.
                    Rendered when the GH feature flag is active and the user
                    is hovering over this column. Sits between free-time
                    overlays and EventBlocks in z-order.
                  */}
                  {isHoverColumn && hoverSlot !== null && (
                    <View
                      pointerEvents="none"
                      testID={`week-drop-target-${dateKey}`}
                      style={[
                        styles.dropTargetHighlight,
                        {
                          top:    hoverSlot.minuteOfDay * 1, // 1 px/min
                          height: HOVER_SLOT_HEIGHT,
                        },
                      ]}
                    />
                  )}

                  {layouts.map((lay) => {
                    const tt = translatedTitles.get(lay.event.id);

                    // TASK-009 Day 2 — feature flag A/B: GH PoC vs EventBlock
                    if (DRAG_MODE_GH) {
                      return (
                        <EventBlockGestureHandler
                          key={lay.event.id}
                          event={lay.event}
                          topOffset={lay.topOffset}
                          height={lay.height}
                          widthFraction={lay.widthFraction}
                          leftFraction={lay.leftFraction}
                          onPress={onEventPress}
                          columnWidth={columnWidth}
                          viewMode="week"
                          onHoverSlot={handleHoverSlot}
                          onDropped={handleDropped}
                        />
                      );
                    }

                    return (
                      <EventBlock
                        key={lay.event.id}
                        event={lay.event}
                        topOffset={lay.topOffset}
                        height={lay.height}
                        widthFraction={lay.widthFraction}
                        leftFraction={lay.leftFraction}
                        onPress={onEventPress}
                        columnWidth={columnWidth}
                        {...(tt ? { translatedTitle: tt } : {})}
                        {...(onReschedule ? { onReschedule } : {})}
                      />
                    );
                  })}
                </View>
              );
            })}
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
      {DRAG_MODE_GH && undoToast && <UndoToast toast={undoToast} />}
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
  });
}
