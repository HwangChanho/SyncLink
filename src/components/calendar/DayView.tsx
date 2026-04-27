/**
 * DayView — single-day time-grid calendar view.
 *
 * Layout (vertical scroll):
 *  ┌──────┬─────────────────────────────────┐
 *  │ 00   │  EventBlocks positioned by time  │
 *  │ 01   │                                  │
 *  │ ...  │                                  │
 *  │ 23   │                                  │
 *  └──────┴─────────────────────────────────┘
 *
 * Overlap handling mirrors WeekView — greedy column-assignment so
 * simultaneous events appear side by side within the single column.
 *
 * TASK-009 Day 5: EventBlockGestureHandler (GH PoC) applied behind the
 * same DRAG_MODE_GH feature flag as WeekView. In DayView there is no
 * horizontal column movement, so columnWidth=0 and viewMode='day'.
 * UndoToast is rendered as an absolute overlay at the bottom of the view.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
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
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Feature flag (mirrors WeekView) ──────────────────────────────────────────

/**
 * TASK-009 Day 5 feature flag for DayView.
 * Mirrors WeekView's DRAG_MODE_GH — both views use the same devConfig toggle.
 * When true, EventBlockGestureHandler replaces EventBlock in the time grid.
 */
const DRAG_MODE_GH = __DEV__ && (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('@/constants/devConfig') as { dragMode?: string };
    return cfg.dragMode === 'gh';
  } catch {
    return false;
  }
})();

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Pixel height per hour in the time grid. */
const HOUR_HEIGHT = 60;
/** Minimum width per overlap column. Anything narrower clips titles. */
const MIN_COLUMN_WIDTH = 220;
/** Total pixel height of the 24-hour grid. */
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;
/** Width of the hour-label column on the left. */
const TIME_COL_WIDTH = 44;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ─── Overlap layout ────────────────────────────────────────────────────────

interface LayoutEvent {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction: number;
  leftFraction: number;
}

/**
 * Greedy column-assignment for overlapping events.
 * Identical to WeekView's computeLayout — events within the same
 * time window are distributed into side-by-side sub-columns.
 */
function computeLayout(events: EventSummary[]): LayoutEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => {
    const diff = a.startAt.getTime() - b.startAt.getTime();
    return diff !== 0 ? diff : b.endAt.getTime() - a.endAt.getTime();
  });

  const assignments: { event: EventSummary; colIndex: number }[] = [];
  const colEndTimes: number[] = [];

  for (const evt of sorted) {
    const startMs = evt.startAt.getTime();
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
    const startHour = event.startAt.getHours() + event.startAt.getMinutes() / 60;
    const endHour = event.endAt.getHours() + event.endAt.getMinutes() / 60;
    const durationHours = Math.max(endHour - startHour, 0.25);

    return {
      event,
      topOffset: startHour * HOUR_HEIGHT,
      height: durationHours * HOUR_HEIGHT,
      widthFraction: 1 / totalCols,
      leftFraction: colIndex / totalCols,
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DayViewProps {
  /** The date to display events for. */
  selectedDate: Date;
  /**
   * Events for this specific day.
   * Caller should filter from eventStore.eventsByDate[dateKey].
   */
  events: EventSummary[];
  /** Called when the user taps an event block. */
  onEventPress: (event: EventSummary) => void;
  /**
   * Planner todos whose dueDate falls on the displayed day. Rendered as
   * outlined chips in the all-day banner so the user sees day-scoped
   * items alongside all-day events.
   */
  todos?: { id: string; title: string; color: string }[];
  /**
   * PRD 4.2 Tier 2 — optional free-time slots to overlay on the time
   * grid. Slots outside the displayed day are clipped automatically.
   */
  freeSlots?: FreeSlot[];
}

/**
 * Single-day time-grid showing all events for one day.
 * Scrolls vertically to cover the full 24 hours.
 */
export function DayView({
  selectedDate,
  events,
  onEventPress,
  todos,
  freeSlots,
}: DayViewProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const scrollRef = useRef<ScrollView>(null);
  const layouts = computeLayout(events);
  // Each layout's widthFraction is 1/N where N is the size of the
  // overlap-column group it belongs to. Rounding the reciprocal gives us
  // the maximum number of columns we need to make room for so the
  // horizontal scroll container can size itself.
  const maxOverlapColumns = layouts.reduce<number>(
    (max, l) => Math.max(max, Math.round(1 / l.widthFraction)),
    1,
  );

  // Scroll to 8 AM on mount
  const handleLayout = () => {
    scrollRef.current?.scrollTo({ y: HOUR_HEIGHT * 7, animated: false });
  };

  // All-day events (endAt === startAt or allDay flag)
  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = layouts.filter((l) => !l.event.allDay);

  /**
   * PRD 4.2 Tier 2 — clip provided freeSlots to the visible day's
   * [00:00, 24:00) window and convert to pixel offset+height pairs.
   * Memoised so the overlay only recomputes when slots or selectedDate
   * change.
   */
  const freeSlotBands = useMemo(() => {
    if (!freeSlots || freeSlots.length === 0) return [];
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs   = dayStartMs + 24 * 60 * 60_000;

    const out: { topOffset: number; height: number }[] = [];
    for (const slot of freeSlots) {
      const startMs = Math.max(slot.start.getTime(), dayStartMs);
      const endMs   = Math.min(slot.end.getTime(),   dayEndMs);
      if (endMs <= startMs) continue;
      const topHours    = (startMs - dayStartMs) / 3_600_000;
      const heightHours = (endMs   - startMs)    / 3_600_000;
      if (heightHours <= 0) continue;
      out.push({
        topOffset: topHours    * HOUR_HEIGHT,
        height:    heightHours * HOUR_HEIGHT,
      });
    }
    return out;
  }, [freeSlots, selectedDate]);

  // Sprint 19 TASK-1907 — cache-only translated titles for the day's events.
  const visibleEventIds = useMemo(() => events.map((e) => e.id), [events]);
  const translatedTitles = useTranslatedTitles(visibleEventIds);

  // ── TASK-009 Day 5: GH PoC drag support ─────────────────────────────────

  /**
   * Drop-target hover slot state for DayView.
   * In DayView there is only one column (no horizontal movement),
   * so dayIndex is always ignored. We track minuteOfDay for the vertical
   * hover highlight band.
   */
  const [hoverSlot, setHoverSlot] = useState<{ minuteOfDay: number } | null>(null);

  /**
   * Stable onHoverSlot callback for EventBlockGestureHandler.
   * DayView ignores dayIndex — it's always a single-column view.
   */
  const handleHoverSlot = useCallback(
    (minuteOfDay: number | null, _dayIndex: number | null) => {
      if (minuteOfDay === null) {
        setHoverSlot(null);
      } else {
        setHoverSlot({ minuteOfDay });
      }
    },
    [],
  );

  /**
   * TASK-009 Day 4+5: Undo toast hook and stable drop handler.
   * showUndo is passed so a 5-second "되돌리기" toast appears after each
   * successful drag move.
   */
  const { toast: undoToast, showUndo } = useUndoToast();
  const handleDropped = useOptimisticReschedule({ onMoved: showUndo });

  /** Height of the drop-target hover highlight band (30-min slot at 1px/min). */
  const HOVER_SLOT_HEIGHT = HOUR_HEIGHT / 2;

  return (
    <View style={styles.container}>
      {/* All-day events banner (shown when there are all-day events or
          planner todos due today). */}
      {(allDayEvents.length > 0 || (todos && todos.length > 0)) && (
        <View style={styles.allDayBanner}>
          <Text style={styles.allDayLabel}>{t('time.all_day')}</Text>
          <View style={styles.allDayEvents}>
            {allDayEvents.map((evt) => (
              <View
                key={evt.id}
                style={[styles.allDayChip, { backgroundColor: `${evt.color}33` }]}
              >
                <View style={[styles.allDayDot, { backgroundColor: evt.color }]} />
                <Text
                  style={[styles.allDayTitle, { color: evt.color }]}
                  numberOfLines={1}
                >
                  {translatedTitles.get(evt.id) ?? evt.title}
                </Text>
              </View>
            ))}
            {todos?.map((td) => (
              <View
                key={td.id}
                style={[
                  styles.allDayChip,
                  {
                    backgroundColor: td.color + '1A',
                    borderLeftWidth: 3,
                    borderLeftColor: td.color,
                  },
                ]}
              >
                <Text
                  style={[styles.allDayTitle, { color: td.color }]}
                  numberOfLines={1}
                >
                  ✓ {td.title}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Scrollable 24-hour grid */}
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

          {/*
            Event area — horizontally scrollable so heavily booked days
            (many overlapping events) keep each column wide enough to
            read.  computeLayout assigns widthFraction = 1/cols, so the
            number of overlap columns is the reciprocal of the smallest
            fraction.  Below 4 columns we fit on screen; from 4+ we let
            the user pan horizontally.
          */}
          <ScrollView
            horizontal
            // TASK-003 fix: 4 컬럼 이하일 때는 horizontal scroll 비활성 — 그래야
            // ScrollView가 inner EventBlock의 onPress를 swipe 제스처로 오인식
            // 하지 않음. 일정 적을 땐 단일 화면에 모두 fit하므로 스크롤 불필요.
            scrollEnabled={maxOverlapColumns >= 4}
            showsHorizontalScrollIndicator={timedEvents.length > 0 && maxOverlapColumns >= 4}
            style={styles.eventsAreaScroll}
            contentContainerStyle={{ minWidth: '100%' }}
          >
            <View
              style={[
                styles.eventsArea,
                { minWidth: Math.max(1, maxOverlapColumns) * MIN_COLUMN_WIDTH },
              ]}
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

              {/*
                PRD 4.2 Tier 2 — free-time overlay bands. Rendered
                before EventBlocks so events stack on top.
              */}
              {freeSlotBands.map((s, i) => (
                <View
                  key={`free-${i}`}
                  pointerEvents="none"
                  testID="day-free-slot"
                  style={[
                    styles.freeSlotOverlay,
                    { top: s.topOffset, height: s.height },
                  ]}
                />
              ))}

              {/*
                TASK-009 Day 5 — drop-target hover highlight for DayView.
                Shown when the GH feature flag is active and the user is
                dragging an event vertically (DayView has no column axis).
              */}
              {DRAG_MODE_GH && hoverSlot !== null && (
                <View
                  pointerEvents="none"
                  testID="day-drop-target"
                  style={[
                    styles.dropTargetHighlight,
                    {
                      top:    hoverSlot.minuteOfDay * 1, // 1 px/min
                      height: HOVER_SLOT_HEIGHT,
                    },
                  ]}
                />
              )}

              {/* Timed event blocks — A/B: GH PoC vs production EventBlock */}
              {timedEvents.map((lay) => {
                const tt = translatedTitles.get(lay.event.id);

                // TASK-009 Day 5 — feature flag: render GH handler in dev mode
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
                      columnWidth={0}
                      viewMode="day"
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
                    {...(tt ? { translatedTitle: tt } : {})}
                  />
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Empty state for days with no events */}
        {events.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('event.today_list_title')} {t('common.none')}</Text>
          </View>
        )}
      </ScrollView>

      {/*
        TASK-009 Day 5 — Undo toast overlay for DayView.
        Positioned at the bottom of the view; only rendered after a
        successful drag-to-reschedule while the 5-second window is open.
      */}
      {DRAG_MODE_GH && undoToast && <UndoToast toast={undoToast} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  allDayBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.backgroundAlt,
  },
  allDayLabel: {
    ...textStyles.caption,
    color: colors.textTertiary,
    width: TIME_COL_WIDTH,
    paddingTop: 2,
  },
  allDayEvents: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  allDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 4,
    gap: spacing[1],
  },
  allDayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  allDayTitle: {
    ...textStyles.labelSm,
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
  eventsAreaScroll: {
    flex: 1,
  },
  eventsArea: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingHorizontal: spacing[1],
    height: TOTAL_HEIGHT,
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
  emptyState: {
    position: 'absolute',
    top: HOUR_HEIGHT * 10,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  emptyText: {
    ...textStyles.bodySm,
    color: colors.textTertiary,
  },
  /**
   * PRD 4.2 Tier 2 — translucent shaded band marking a common free
   * window in the day grid. Same visual language as WeekView for
   * consistency.
   */
  freeSlotOverlay: {
    position: 'absolute',
    left: spacing[1],
    right: spacing[1],
    backgroundColor: colors.primary + '22',
    borderLeftWidth: 2,
    borderLeftColor: colors.primary + '88',
    borderRadius: 4,
  },
  /**
   * TASK-009 Day 5 — drop-target snap highlight for DayView.
   * Shown at the snapped hover slot while the user is dragging an event.
   * Uses a more saturated primary accent than the free-time overlay so the
   * user clearly sees "where I'm about to drop" vs. existing free-time bands.
   * Mirrors WeekView's dropTargetHighlight styling.
   */
  dropTargetHighlight: {
    position: 'absolute',
    left: 2,
    right: 2,
    backgroundColor: colors.primary + '44',
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 4,
  },
  });
}
