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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { EventSummary } from '@/types';
import type { FreeSlot } from '@/types/freeTime';
import { EventBlock } from './EventBlock';
import { UndoToast, useUndoToast } from './UndoToast';
import { useOptimisticReschedule } from './useOptimisticReschedule';
import { DragGhost } from './DragGhost';
import { useGridDragHandler, type DragLayoutRect } from './useGridDragHandler';
import { applyDelta } from '@/lib/calendarGeometry';
import { deleteEvent } from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';
import { useColors } from '@/hooks/useColors';
import { useTranslatedTitles } from '@/hooks/useTranslatedTitles';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { computeEventLayout } from '@/lib/calendarLayout';

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

// Overlap layout helper lives in `@/lib/calendarLayout` — shared with WeekView.
const computeLayout = (events: EventSummary[]) =>
  computeEventLayout(events, HOUR_HEIGHT);

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

  /**
   * PRD 4.2 Tier 3 — callback fired when the user taps a free-time overlay band.
   * The parent screen uses this to open FreeTimeRecommendSheet with the tapped slot.
   *
   * @param slot - The FreeSlot the user tapped on
   */
  onFreeSlotPress?: (slot: FreeSlot) => void;

  /**
   * Mirrors WeekView.onDragModeChange — fires whenever drag-to-reschedule
   * enters or leaves edit mode so calendar.tsx can suspend its outer
   * left/right swipe-to-navigate gesture.
   */
  onDragModeChange?: (isDragging: boolean) => void;

  /**
   * Build-55 — empty-slot quick create. Mirrors WeekView prop. Receives
   * the displayed day + tapped hour/minute (snapped to 15 min). Skipped
   * during scrolls (gesture hook yields control to ScrollView first).
   */
  onEmptySlotPress?: (date: Date, hour: number, minute: number) => void;
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
  onFreeSlotPress,
  onDragModeChange,
  onEmptySlotPress,
}: DayViewProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const removeEvent = useEventStore((s) => s.removeEvent);
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
   *
   * PRD 4.2 Tier 3 (Day 4): originalSlot 필드 추가.
   * onFreeSlotPress 콜백에 원본 FreeSlot을 전달하기 위해 각 band에 저장.
   */
  const freeSlotBands = useMemo(() => {
    if (!freeSlots || freeSlots.length === 0) return [];
    const dayStart = new Date(selectedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs   = dayStartMs + 24 * 60 * 60_000;

    const out: { topOffset: number; height: number; originalSlot: FreeSlot }[] = [];
    for (const slot of freeSlots) {
      const startMs = Math.max(slot.start.getTime(), dayStartMs);
      const endMs   = Math.min(slot.end.getTime(),   dayEndMs);
      if (endMs <= startMs) continue;
      const topHours    = (startMs - dayStartMs) / 3_600_000;
      const heightHours = (endMs   - startMs)    / 3_600_000;
      if (heightHours <= 0) continue;
      out.push({
        topOffset:    topHours    * HOUR_HEIGHT,
        height:       heightHours * HOUR_HEIGHT,
        originalSlot: slot,  // Tier 3: 탭 시 onFreeSlotPress에 전달
      });
    }
    return out;
  }, [freeSlots, selectedDate]);

  // Sprint 19 TASK-1907 — cache-only translated titles for the day's events.
  const visibleEventIds = useMemo(() => events.map((e) => e.id), [events]);
  const translatedTitles = useTranslatedTitles(visibleEventIds);

  // ── TASK-009 Day 5: GH PoC drag support ─────────────────────────────────

  /**
  /**
   * Phase 5 — drag-to-reschedule via PanResponder hit-testing. DayView is
   * a single column so dayDelta is always 0; we still pass everything
   * through `useGridDragHandler` for API parity with WeekView.
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
   * Pre-computed pixel rectangles for hit-testing. The container width is
   * tracked via onLayout so the rects can be measured in real px instead
   * of percentages. dayIndex is always 0 in single-day view.
   */
  const [containerWidth, setContainerWidth] = useState(0);
  const dragLayouts = useMemo<DragLayoutRect[]>(() => {
    if (containerWidth <= 0) return [];
    return timedEvents.map((lay) => ({
      event:    lay.event,
      dayIndex: 0,
      left:     lay.leftFraction * containerWidth,
      top:      lay.topOffset,
      width:    lay.widthFraction * containerWidth,
      height:   lay.height,
    }));
  }, [timedEvents, containerWidth]);

  // Build-47 — eventsArea page-position ref so the drag hook can convert
  // pageX/pageY to eventsArea-local coords (locationX/Y is unreliable; see
  // useGridDragHandler.ts for the full rationale).
  const eventsAreaRef = useRef<View>(null);
  const pageOffsetRef = useRef({ x: 0, y: 0 });
  const measureEventsArea = useCallback(() => {
    eventsAreaRef.current?.measureInWindow((x, y) => {
      pageOffsetRef.current = { x, y };
    });
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() => measureEventsArea());
    return () => cancelAnimationFrame(id);
  }, [measureEventsArea]);

  // Empty-area tap → resolve hour/minute from y-coord (no day shift in
  // single-day view) and forward to parent.
  const handleEmptyTap = useCallback((_localX: number, localY: number) => {
    if (!onEmptySlotPress) return;
    const totalMinutes = (localY / HOUR_HEIGHT) * 60;
    const snapped = Math.max(0, Math.min(24 * 60 - 15,
      Math.round(totalMinutes / 15) * 15));
    onEmptySlotPress(selectedDate, Math.floor(snapped / 60), snapped % 60);
  }, [selectedDate, onEmptySlotPress]);

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
      columnWidth: 0,           // single column — no horizontal day shift
      viewMode:   'day',
      onDropped:  handleGridDrop,
      onTap:      onEventPress,
      onDelete:   handleDragDelete,
      deleteZoneThreshold: -28,
      ...(onEmptySlotPress ? { onEmptyTap: handleEmptyTap } : {}),
      pageOffsetRef,
    });

  useEffect(() => {
    onDragModeChange?.(dragState !== null);
  }, [dragState, onDragModeChange]);

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
        onScroll={measureEventsArea}
        scrollEventThrottle={16}
        // Build-51 — freeze the grid scroll while drag is active. See
        // matching comment in WeekView.tsx for full rationale.
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
            scrollEnabled={maxOverlapColumns >= 4 && dragState === null}
            showsHorizontalScrollIndicator={timedEvents.length > 0 && maxOverlapColumns >= 4}
            style={styles.eventsAreaScroll}
            contentContainerStyle={{ minWidth: '100%' }}
          >
            <View
              ref={eventsAreaRef}
              style={[
                styles.eventsArea,
                { minWidth: Math.max(1, maxOverlapColumns) * MIN_COLUMN_WIDTH },
              ]}
              onLayout={(e) => {
                setContainerWidth(e.nativeEvent.layout.width);
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

              {/*
                PRD 4.2 Tier 2 — free-time overlay bands. Rendered
                before EventBlocks so events stack on top.

                PRD 4.2 Tier 3 (Day 4): onFreeSlotPress가 제공될 때
                TouchableOpacity로 감싸서 탭 이벤트 전달.
                onFreeSlotPress 없으면 기존 pointerEvents="none" 유지.
              */}
              {freeSlotBands.map((s, i) =>
                onFreeSlotPress ? (
                  <TouchableOpacity
                    key={`free-${i}`}
                    activeOpacity={0.7}
                    onPress={() => onFreeSlotPress(s.originalSlot)}
                    testID="day-free-slot"
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
                    testID="day-free-slot"
                    style={[
                      styles.freeSlotOverlay,
                      { top: s.topOffset, height: s.height },
                    ]}
                  />
                ),
              )}

              {/* Timed event blocks. The drag handler claims touches that
                  land on these chips; everything else falls through to
                  the parent ScrollView. */}
              {timedEvents.map((lay) => {
                const tt = translatedTitles.get(lay.event.id);
                const isDragSource =
                  dragState !== null && dragState.event.id === lay.event.id;
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

              {/* Floating ghost — same coordinate system as hit-test. */}
              {dragState && <DragGhost drag={dragState} />}
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
        Undo toast overlay — rendered after a successful drag-to-reschedule
        while the 5-second window is open.
      */}
      {undoToast && <UndoToast toast={undoToast} />}
      {dragState && (
        <View pointerEvents="none" style={styles.editModeDim} />
      )}
      {/* Build-57 — drag 중 화면 상단 trash drop zone */}
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
    // Build-54 — drop the inset so chips sit flush against the
    // time-column divider (LEAD report: "왼쪽 라인보다 살짝 떨어져있어
    // 불편하니 딱 붙여줘"). Right side is naturally bounded by the
    // screen edge so symmetric 0 padding still reads OK.
    paddingHorizontal: 0,
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
  // Phase 5 — original chip dimmed while the floating ghost follows the
  // finger. Keeps the slot visible (so the drop position is obvious) but
  // makes it clear which chip is "in flight".
  draggingSource: {
    opacity: 0.35,
  },
  // Long-press in progress (touched but not yet entered drag mode). The
  // glow doubles as a diagnostic — its absence means the touch never
  // reached the gesture handler.
  candidateChip: {
    shadowColor:    colors.primary,
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.9,
    shadowRadius:   8,
    elevation:      8,
    transform:      [{ scale: 1.02 }],
  },
  editModeDim: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.10)',
  },
  // Build-57 → Build-61 — drag 중 trash drop zone (작은 둥근 chip 형태).
  // LEAD 보고로 "긴 막대" 가 시각 노이즈라 작게 변경.
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
