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
import { useTranslation } from 'react-i18next';
import type { EventSummary } from '@/types';
import type { FreeSlot } from '@/types/freeTime';
import { EventBlock } from './EventBlock';
import { UndoToast, useUndoToast } from './UndoToast';
import { useOptimisticReschedule } from './useOptimisticReschedule';
import { DragGhost } from './DragGhost';
import { useGridDragHandler, type DragLayoutRect } from './useGridDragHandler';
import { useTodoDragHandler } from './useTodoDragHandler';
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
/**
 * Build-67 — Plan 옵션 A: 진정한 day-by-day horizontal ScrollView.
 *
 * 7일 (이번 주 일~토) 만 화면에 보이고, 좌우로 ±7일 buffer 를 더 갖는
 * 15-day window 를 horizontal ScrollView 안에 그린다. 사용자가 한 손가락
 * scroll 만큼 자연스럽게 컬럼이 이동, snap 단위는 1day = columnWidth.
 *
 * 가장자리 (visible 첫 컬럼이 idx 0 또는 14 근접) 도달 시 onMomentumScrollEnd
 * 가 selectedDate 를 7일 shift + scrollX 를 7*colW 로 reset → buffer 갱신.
 * 사용자 시각상 jolt 없이 무한 스크롤 효과.
 */
const VISIBLE_DAYS = 7;
const WINDOW_DAYS = 15;
/** Build-67 fix — dayWindow[7] === selectedDate (rolling). visible 첫 컬럼이 idx 7. */
const WINDOW_INITIAL_VISIBLE_IDX = 7;
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
  /**
   * Called when the user taps a day header to drill into DayView.
   * 부모는 setViewMode('day') + setSelectedDate(date) 처리.
   */
  onDateSelect: (date: Date) => void;
  /**
   * Build-68 LEAD bug 분리 — horizontal day-by-day scroll snap (handleHScrollEnd)
   * 또는 day header pan-to-scrub 으로 selectedDate 만 갱신할 때 호출.
   * onDateSelect 와 달리 viewMode 는 그대로 'week' 유지. 미제공 시 fallback
   * = onDateSelect (이전 동작).
   */
  onSelectedDateChange?: (date: Date) => void;
  /**
   * Optional planner todos bucketed by ISO date key. Rendered as small
   * outlined chips in the all-day strip so a user glancing at a week
   * sees both events and due tasks on the same timeline.
   */
  todosByDate?: Record<string, { id: string; title: string; color: string; dueAt?: Date | null }[]>;
  /** Build-66 — timed todo chip 클릭. v1.0 에선 선택사항 (display only 가능). */
  onTodoPress?: (id: string) => void;
  /**
   * Build-66 — drag-to-reschedule for todos. all-day strip 의 todo chip 을
   * 길게 눌러 grid 로 드래그하면 호출. dueAt 을 set 하는 책임은 caller.
   */
  onTodoDrop?: (todoId: string, newDueAt: Date) => void;
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

  /**
   * Build-64 — drop on FAB-area = delete. 부모(calendar.tsx)가 FAB 의
   * page rect 를 측정해 ref 로 전달. drag release 시 hit-test.
   */
  deleteZonePageRectRef?: { current: { left: number; top: number; right: number; bottom: number } | null };

  /**
   * Build-68 LEAD: 영역 분리 — 위 일자 row 좌우 = 현재 day-by-day 스크롤
   * (inner horizontal ScrollView 가 처리), 아래 grid 영역 좌우 swipe =
   * 일(day) view 모드로 전환. capture phase PanResponder 가 fast 횡 swipe
   * 를 가로채 inner ScrollView 가 day-by-day 로 snap 되기 전에 day mode
   * 로 진입하게 한다. 콜백은 부모 (calendar.tsx) 가 setViewMode('day') +
   * setSelectedDate(date) 처리.
   */
  onSwitchToDayView?: (date: Date) => void;
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
 * Build-67 fix — 15-day window centered on selectedDate (rolling).
 *
 * dayWindow[WINDOW_INITIAL_VISIBLE_IDX] === selectedDate. visible 7-day 영역
 * 의 첫 컬럼이 selectedDate 이다. 이렇게 둬야 horizontal scroll 후
 * onDateSelect(dayWindow[visibleStartIdx]) 으로 selectedDate 를 갱신해도
 * useEffect 의 reset (scrollTo idx 7) 이 동일한 visible 영역으로 돌아오므로
 * 사용자 시각상 jolt 가 없다. 또한 헤더 (CalendarHeader) 가 selectedDate ~
 * +6 day range 를 보여주면 보이는 7일 컬럼과 정확히 일치.
 *
 * 이전 (일요일 기준 정렬) 에서는 selectedDate 갱신 후 dayWindow 가
 * Sunday 로 snap 되어 visible 영역이 ±N 일 뒤로 점프하는 문제가 있었음.
 */
function getDayWindow(date: Date): Date[] {
  const base = new Date(date);
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + (i - WINDOW_INITIAL_VISIBLE_IDX));
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
  onSelectedDateChange,
  todosByDate,
  onTodoPress,
  onTodoDrop,
  freeSlots,
  onFreeSlotPress,
  onDragModeChange,
  onEmptySlotPress,
  deleteZonePageRectRef,
  onSwitchToDayView,
}: WeekViewProps) {
  // Build-68 — selectedDate-only 갱신 콜백. 미제공 시 onDateSelect fallback.
  const updateSelectedDate = onSelectedDateChange ?? onDateSelect;
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const removeEvent = useEventStore((s) => s.removeEvent);

  // Build-67 fix — 15-day buffer window centered on selectedDate (rolling).
  // dayWindow[7] === selectedDate. visible 7 컬럼 = selectedDate ~ +6일.
  // horizontal scroll 후 selectedDate 갱신 → dayWindow recompute → visible
  // idx 7 reset 이 jolt 없이 동기화. 헤더도 selectedDate ~ +6일 표시.
  const dayWindow = useMemo(() => getDayWindow(selectedDate), [selectedDate]);
  const today = new Date();
  /** Vertical 24-hour grid scroll. */
  const scrollRef = useRef<ScrollView>(null);
  /** Build-67 — Outer horizontal day-by-day ScrollView. */
  const hScrollRef = useRef<ScrollView>(null);
  /** Build-67 — TimeCol 의 vertical ScrollView. grid 의 vertical scroll 과 sync. */
  const timeColScrollRef = useRef<ScrollView>(null);
  // Measured width of the visible 7-day grid (excluding TIME_COL_WIDTH).
  // columnWidth 은 visible 영역 / VISIBLE_DAYS — dayWindow 가 15일이지만
  // 한 컬럼 너비는 변하지 않음.
  const [gridWidth, setGridWidth] = useState(0);
  const columnWidth = gridWidth > 0 ? gridWidth / VISIBLE_DAYS : 0;
  /** 전체 horizontal content 너비 (15 * colW). */
  const totalContentWidth = columnWidth * WINDOW_DAYS;

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
    dayWindow.forEach((day, idx) => {
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
  }, [dayWindow, eventsByDate, columnWidth]);

  // Empty-area tap → resolve the touched (day, hour, minute) and forward
  // to the parent. Snap to the same step the drag-drop uses (15 min
  // default) so the create-screen pre-fill matches what the user sees in
  // the grid.
  const handleEmptyTap = useCallback((localX: number, localY: number) => {
    if (!onEmptySlotPress) return;
    if (columnWidth <= 0) return;
    // Build-67 — eventsArea 너비 = WINDOW_DAYS * colW 이므로 dayIndex
    // 범위도 0..(WINDOW_DAYS-1).
    const dayIndex = Math.max(0, Math.min(WINDOW_DAYS - 1, Math.floor(localX / columnWidth)));
    const day = dayWindow[dayIndex];
    if (!day) return;
    const totalMinutes = (localY / HOUR_HEIGHT) * 60;
    const snapped = Math.max(0, Math.min(24 * 60 - 15,
      Math.round(totalMinutes / 15) * 15));
    onEmptySlotPress(day, Math.floor(snapped / 60), snapped % 60);
  }, [columnWidth, dayWindow, onEmptySlotPress]);

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
      ...(deleteZonePageRectRef ? { deleteZonePageRectRef } : {}),
      ...(onEmptySlotPress ? { onEmptyTap: handleEmptyTap } : {}),
      pageOffsetRef,
    });

  // Build-66 — todo drag (all-day strip → grid). 별도 PanResponder 가
  // chip 자체에 부착되어 grid 의 useGridDragHandler 와 충돌하지 않음.
  const { todoDragState, getPanHandlers: getTodoPanHandlers } = useTodoDragHandler({
    eventsAreaPageOffsetRef: pageOffsetRef,
    columnWidth,
    weekDays: dayWindow,
    hourHeight: HOUR_HEIGHT,
    onDrop: (todoId, newDueAt) => onTodoDrop?.(todoId, newDueAt),
  });

  // Notify the parent screen when drag mode toggles so it can gate its
  // outer left/right swipe-to-navigate gesture. todo drag 도 동일 처리.
  useEffect(() => {
    onDragModeChange?.(dragState !== null || todoDragState !== null);
  }, [dragState, todoDragState, onDragModeChange]);

  /**
   * Build-68 LEAD bug — 영역 분리 swipe responder (grid 영역 전용).
   *
   * 위 일자 row swipe = inner horizontal ScrollView 가 day-by-day snap
   * (Build-67 동작 유지). 아래 grid 영역에서 fast 횡 swipe = 일(day) view
   * 모드로 전환. capture phase 로 inner ScrollView 가 snap 하기 전에 가로챈다.
   *
   * 임계값 (dx > 25, vx > 0.3) 보다 작은 움직임은 yield → 정상적으로 grid
   * 의 chip drag (longpress) / vertical scroll 작동. chip drag 는 longpress
   * 라 stationary 시작이 필요해 fast swipe 와 양립.
   *
   * dragActiveRef 로 chip drag 진행 중엔 절대 claim 금지.
   */
  const dragActiveRef = useRef(false);
  useEffect(() => {
    dragActiveRef.current = dragState !== null || todoDragState !== null;
  }, [dragState, todoDragState]);
  const switchToDayRef = useRef(onSwitchToDayView);
  useEffect(() => { switchToDayRef.current = onSwitchToDayView; }, [onSwitchToDayView]);
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  // Build-68 — headerPan 의 PanResponder 가 useRef 로 한 번만 생성되므로
  // updateSelectedDate closure 도 mount 시점 값으로 고정. ref 로 관리.
  const updateSelectedDateRef = useRef(updateSelectedDate);
  useEffect(() => { updateSelectedDateRef.current = updateSelectedDate; }, [updateSelectedDate]);

  const gridSwipeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, gs) => {
        if (dragActiveRef.current) return false;
        return (
          Math.abs(gs.dx) > 25 &&
          Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 &&
          Math.abs(gs.vx) > 0.3
        );
      },
      onPanResponderGrant: () => {
        // inner horizontal ScrollView 가 동시에 snap 하지 않도록 비활성화.
        hScrollRef.current?.setNativeProps({ scrollEnabled: false });
      },
      onPanResponderRelease: (_, gs) => {
        // ScrollView 재활성 (drag 진행 중 아닐 때만).
        hScrollRef.current?.setNativeProps({
          scrollEnabled: !dragActiveRef.current,
        });
        if (Math.abs(gs.dx) > 60) {
          switchToDayRef.current?.(selectedDateRef.current);
        }
      },
      onPanResponderTerminate: () => {
        hScrollRef.current?.setNativeProps({
          scrollEnabled: !dragActiveRef.current,
        });
      },
    }),
  ).current;

  /**
   * Build-67 — selectedDate 가 외부 (MonthView drilldown, NL 등) 에서 변경
   * 되거나 colWidth 가 처음 측정될 때 horizontal scroll 위치를
   * WINDOW_INITIAL_VISIBLE_IDX 로 reset. 사용자가 좌우로 직접 scroll 한
   * 경우는 onMomentumScrollEnd 가 이미 처리.
   */
  useEffect(() => {
    if (columnWidth <= 0) return;
    requestAnimationFrame(() => {
      hScrollRef.current?.scrollTo({
        x: WINDOW_INITIAL_VISIBLE_IDX * columnWidth,
        y: 0,
        animated: false,
      });
    });
  }, [selectedDate, columnWidth]);

  /**
   * Build-67 fix — horizontal scroll 종료 시 selectedDate 동기화.
   *
   * dayWindow 가 selectedDate 중심 (rolling) 이므로 visibleStartIdx 가
   * WINDOW_INITIAL_VISIBLE_IDX (=7) 이 아니면 그 idx 에 위치한 일자를 새
   * selectedDate 로 통보. 부모 (calendar.tsx) 가 selectedDate state 갱신
   * → useMemo 가 dayWindow 재계산 → 새 dayWindow[7] = 그 일자 → useEffect
   * 가 scrollTo idx 7 로 reset → visible 영역 동일 위치 유지 (jolt 없음).
   *
   * 헤더 (CalendarHeader) 도 selectedDate 기준이므로 동시에 갱신되어
   * "표시되는 컬럼" 과 "헤더 날짜" 가 항상 일치.
   *
   * 가장자리 (idx 0 또는 14 부근) 도 같은 로직 — 그저 dayWindow 가 ±7일
   * 더 shift 될 뿐. 별도 분기 불필요.
   */
  const handleHScrollEnd = useCallback(
    (e: import('react-native').NativeSyntheticEvent<import('react-native').NativeScrollEvent>) => {
      if (columnWidth <= 0) return;
      const x = e.nativeEvent.contentOffset.x;
      const visibleStartIdx = Math.round(x / columnWidth);
      if (visibleStartIdx === WINDOW_INITIAL_VISIBLE_IDX) return;
      const next = dayWindow[visibleStartIdx];
      if (!next) return;
      // Build-68 — viewMode 유지하며 selectedDate 만 갱신.
      updateSelectedDate(next);
    },
    [columnWidth, dayWindow, updateSelectedDate],
  );

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
        // Build-68 — selectedDateRef 사용 (ref 가 최신값 보장).
        headerDragRef.current = { baseDate: selectedDateRef.current, lastDelta: 0 };
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
        // Build-68 — header pan-to-scrub 도 viewMode 유지. ref 사용.
        updateSelectedDateRef.current(next);
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
    for (const day of dayWindow) {
      const k = toDateKey(day);
      const list = eventsByDate[k];
      if (!list) continue;
      for (const e of list) ids.push(e.id);
    }
    return ids;
  }, [dayWindow, eventsByDate]);
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

    for (const day of dayWindow) {
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
  }, [freeSlots, dayWindow]);

  // Determine if any day this week has all-day events OR planner todos
  // (the strip now hosts both so the user sees every day-scoped item in
  // one place).
  const hasAllDayEvents = dayWindow.some((day) => {
    const key = toDateKey(day);
    const hasEvt = (eventsByDate[key] ?? []).some((e) => e.allDay);
    // 시간 없는 todo (all-day strip 노출) 만 카운트. 시간 있는 건 grid 에 그림.
    const hasTodo = (todosByDate?.[key] ?? []).some((td) => !td.dueAt);
    return hasEvt || hasTodo;
  });

  return (
    <View style={styles.container}>
      {/* Build-67 — outer row: timeCol(left) + horizontal ScrollView(right). */}
      <View style={styles.outerRow}>
        {/* ── timeCol (fixed, horizontal scroll 영향 X) ── */}
        <View style={styles.timeColFixed}>
          {/* dayHeader 와 같은 높이 spacer */}
          <View style={{ height: DAY_HEADER_HEIGHT }} />
          {hasAllDayEvents && <View style={[styles.allDayStripSpacer]} />}
          <ScrollView
            ref={timeColScrollRef}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            <View style={[styles.timeCol, { height: TOTAL_HEIGHT }]}>
              {HOURS.map((h) => (
                <View key={h} style={[styles.hourLabelWrap, { top: h * HOUR_HEIGHT - 8 }]}>
                  <Text style={styles.hourLabel}>
                    {h === 0 ? '' : `${h}:00`}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* ── horizontal day-by-day ScrollView ── */}
        <ScrollView
          ref={hScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          // snapToInterval = colW 로 1day 단위 paging.
          snapToInterval={columnWidth > 0 ? columnWidth : undefined}
          decelerationRate="fast"
          // iOS 만 effective — 방향 잠금. vertical 손가락 움직임 시
          // horizontal scroll 비활성, 반대도 마찬가지.
          directionalLockEnabled
          // chip drag 중일 때는 horizontal scroll 차단 — 회귀 방지.
          scrollEnabled={dragState === null && todoDragState === null}
          // 가운데 정렬: visible 첫 컬럼 = idx WINDOW_INITIAL_VISIBLE_IDX (이번 주 일).
          contentOffset={{
            x: WINDOW_INITIAL_VISIBLE_IDX * (columnWidth || 1),
            y: 0,
          }}
          onMomentumScrollEnd={handleHScrollEnd}
          // grid 너비 측정 — visible 7-day 영역.
          onLayout={(e) => {
            setGridWidth(e.nativeEvent.layout.width);
            measureEventsArea();
          }}
          // horizontal scroll 시 measureInWindow 갱신 — drag hit-test 의
          // pageOffsetRef 도 새로 measure 되어야 정확.
          onScroll={measureEventsArea}
          scrollEventThrottle={16}
          style={styles.hScroll}
        >
          <View style={[styles.hContent, { width: totalContentWidth }]}>
            {/* ─── Day header row (15 cells, absolute width=colW each) ─── */}
            <View
              style={[styles.dayHeaderRow, { width: totalContentWidth }]}
              {...headerPan.panHandlers}
            >
              {dayWindow.map((day) => {
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selectedDate);
                return (
                  <TouchableOpacity
                    key={toDateKey(day)}
                    style={[styles.dayHeaderCell, { width: columnWidth }]}
                    onPress={() => onDateSelect(day)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dowLabel, isToday && styles.activeDowLabel]}>
                      {/* Build-67 — DOW 라벨이 동적: dayWindow 가 일~토 순서가
                          아닐 수 있으니 day.getDay() 로 직접 매핑. */}
                      {DOW_LABELS[day.getDay()]}
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

            {/* ─── All-day strip (15 cells; same width as header) ─── */}
            {hasAllDayEvents && (
              <View style={[styles.allDayStrip, { width: totalContentWidth }]}>
          {dayWindow.map((day) => {
            const dateKey = toDateKey(day);
            const allDayEvts = (eventsByDate[dateKey] ?? []).filter((e) => e.allDay);
            // 시간 없는 todo 만 strip 에. 시간 있는 건 아래 grid 에서 그린다.
            const dayTodos = (todosByDate?.[dateKey] ?? []).filter((td) => !td.dueAt);
            return (
              <View key={dateKey} style={[styles.allDayCol, { width: columnWidth }]}>
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
                {dayTodos.map((td) => {
                  const isDragging =
                    todoDragState !== null && todoDragState.todoId === td.id;
                  const panHandlers = onTodoDrop ? getTodoPanHandlers(td.id) : {};
                  return (
                    <View
                      key={td.id}
                      testID={`todo-allday-chip-${td.id}`}
                      {...panHandlers}
                      style={[
                        styles.allDayChip,
                        {
                          backgroundColor: td.color + '22',
                          borderLeftWidth: 3,
                          borderLeftColor: td.color,
                        },
                        isDragging && { opacity: 0.4 },
                      ]}
                    >
                      <Text
                        style={[styles.allDayChipText, { color: td.color }]}
                        numberOfLines={1}
                      >
                        ✓ {td.title}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}

            {/* Build-68 — grid 영역 swipe 분리 wrapper. capture phase 로
                 fast 횡 swipe 를 가로채 day mode 전환. 일자 row 에서 swipe
                 한 경우는 이 wrapper 밖이라 영향 X — inner horizontal
                 ScrollView 가 day-by-day snap. */}
            <View style={styles.gridSwipeWrap} {...gridSwipeResponder.panHandlers}>
            {/* ─── Vertical scroll grid (timeCol 제외) ─── */}
            <ScrollView
              ref={scrollRef}
              onLayout={handleLayout}
              showsVerticalScrollIndicator={false}
              style={styles.scrollView}
              onScroll={(e) => {
                measureEventsArea();
                // Build-67 — timeCol 의 vertical scroll 을 grid 와 동기.
                const y = e.nativeEvent.contentOffset.y;
                timeColScrollRef.current?.scrollTo({ y, animated: false });
              }}
              scrollEventThrottle={16}
              // Build-51 — freeze the 24-hour grid scroll while a drag is in
              // flight so the user's vertical finger movement only repositions
              // the dragged ghost. Otherwise iOS's native UIScrollView would
              // continue tracking and the grid would scroll out from under the
              // chip even though our PanResponder owns the touch (LEAD report
              // "여전히 주에서 일정옮길때 위아래 움직여").
              scrollEnabled={dragState === null}
            >
              <View
                ref={eventsAreaRef}
                style={[styles.eventsArea, { width: totalContentWidth, height: TOTAL_HEIGHT }]}
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

            {/* Vertical column separators — Build-67: 15일 모두 사이에 line.
                idx 0..(WINDOW_DAYS-1) 매 컬럼 우측 line, left=(idx+1)*colW. */}
            {dayWindow.slice(0, -1).map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.colSeparator,
                  { left: (idx + 1) * columnWidth },
                ]}
              />
            ))}

            {/* Events for each day column — allDay events go to the strip above */}
            {dayWindow.map((day, idx) => {
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
                      // Build-67 — percent → absolute px (15-day window).
                      left: idx * columnWidth,
                      width: columnWidth,
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

                  {/* Build-66 — 시간 있는 todo chip. event 와 grid 좌표
                      공유하지만 자체 drag/edit 는 v1.0 에서 미지원
                      (별도 useTodoDrag 가 step 7 에서 구현 예정). */}
                  {(todosByDate?.[dateKey] ?? [])
                    .filter((td): td is typeof td & { dueAt: Date } => !!td.dueAt)
                    .map((td) => {
                      const minutes = td.dueAt.getHours() * 60 + td.dueAt.getMinutes();
                      const top = (minutes / 60) * HOUR_HEIGHT;
                      // 기본 1시간 chunk — clamp 해서 자정 넘김 방지.
                      const height = Math.min(HOUR_HEIGHT, TOTAL_HEIGHT - top);
                      const ChipWrap = onTodoPress ? TouchableOpacity : View;
                      return (
                        <ChipWrap
                          key={`todo-${td.id}`}
                          testID={`todo-grid-chip-${td.id}`}
                          {...(onTodoPress
                            ? { onPress: () => onTodoPress(td.id), activeOpacity: 0.8 }
                            : {})}
                          style={[
                            styles.timedTodoChip,
                            {
                              top,
                              height,
                              backgroundColor: td.color + '22',
                              borderLeftColor: td.color,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.timedTodoText, { color: td.color }]}
                            numberOfLines={1}
                          >
                            ✓ {td.title}
                          </Text>
                        </ChipWrap>
                      );
                    })}

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
            </ScrollView>
            </View>
          </View>
        </ScrollView>
      </View>

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

      {/* Build-66 — todo drag ghost. page 좌표를 그대로 받아 floating
          chip 으로 finger 추적. dim overlay 와 같이 표시. */}
      {todoDragState && (() => {
        const allTodos = dayWindow.flatMap((d) => todosByDate?.[toDateKey(d)] ?? []);
        const dragged = allTodos.find((td) => td.id === todoDragState.todoId);
        return (
          <>
            <View pointerEvents="none" style={styles.editModeDim} />
            <View
              pointerEvents="none"
              style={[
                styles.todoDragGhost,
                {
                  left: todoDragState.pageX - 60,
                  top: todoDragState.pageY - 14,
                  borderLeftColor: dragged?.color ?? colors.primary,
                  backgroundColor: (dragged?.color ?? colors.primary) + '33',
                },
              ]}
            >
              <Text
                style={[styles.todoDragGhostText, { color: dragged?.color ?? colors.primary }]}
                numberOfLines={1}
              >
                ✓ {dragged?.title ?? ''}
              </Text>
            </View>
          </>
        );
      })()}

      {/*
        Build-57 — drag 중에만 화면 상단에 trash 영역 노출. 사용자가
        chip 을 위로 끌어 이 영역 위에서 손을 떼면 useGridDragHandler
        의 onDelete 가 호출 (deleteZoneThreshold=-28 이므로 eventsArea
        위로 28px 위 = 이 trash 영역). pointerEvents='none' — 이미
        진행 중인 PanResponder 가 모든 touch 를 소유.
      */}
      {/* Build-64 LEAD: "여기에 놓아 삭제 버튼 없애고 + 버튼을 drag 모드에서 쓰레기통으로". calendar.tsx 의 FAB 가 dragState !== null 일 때 trash 아이콘. drop 위치가 FAB rect 안 (page coords) 이면 onDelete 호출. 자식 (WeekView) 은 deleteZone overlay 미렌더 — chip 자체 제거. */}
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
  // Build-67 — outer row: timeCol(left, fixed) + horizontal ScrollView(right).
  outerRow: {
    flex: 1,
    flexDirection: 'row',
  },
  timeColFixed: {
    width: TIME_COL_WIDTH,
    backgroundColor: colors.background,
    // 우측 horizontal ScrollView 와 시각적으로 분리하지 않음 (border 제거).
  },
  hScroll: {
    flex: 1,
  },
  hContent: {
    // width 는 inline (totalContentWidth = WINDOW_DAYS * colW). 측정값
    // 들어올 때까지 0 이지만 inner scroll 동작 영향 없음.
    flexDirection: 'column',
  },
  /** Build-67 — allDayStrip 이 있을 때 timeCol 우측 spacer 높이 동기화. */
  allDayStripSpacer: {
    height: ALL_DAY_CHIP_HEIGHT + ALL_DAY_STRIP_V_PAD * 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    height: DAY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  dayHeaderCell: {
    // Build-67 — width 는 inline 으로 columnWidth (15-day window).
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: DAY_HEADER_HEIGHT,
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
  // Build-68 — grid 영역만 감싸 capture-phase swipe → day mode 전환.
  // flex:1 로 vScroll 자리 차지. 시각적 효과 X.
  gridSwipeWrap: {
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
    // Build-67 — width / height 는 inline (15*colW × 24h). flex 제거.
    position: 'relative',
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
  /** Per-day column inside the strip — Build-67 width 는 inline columnWidth. */
  allDayCol: {
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
  /** Build-66 — grid 안에 노출되는 시간 있는 todo chip. */
  timedTodoChip: {
    position: 'absolute',
    left: 1,
    right: 1,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    paddingHorizontal: spacing[1],
    justifyContent: 'center',
  },
  timedTodoText: {
    ...textStyles.caption,
    fontWeight: '600',
  },
  /** Build-66 — todo drag 중 손가락을 따라가는 floating chip. */
  todoDragGhost: {
    position: 'absolute',
    width: 120,
    height: 28,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    paddingHorizontal: spacing[2],
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  todoDragGhostText: {
    ...textStyles.caption,
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
  // Build-57 → Build-63 — drag 중 trash drop zone.
  // LEAD 재보고: "저게 삭제였냐 알아볼 수도 없다" — 연한 색 + 작은
  // 글씨라 의미 불명. solid red fill + 흰색 trash icon + "여기에 놓아
  // 삭제" 텍스트 흰색 + bold + drop shadow 로 floating action button
  // 느낌. 삭제 = 위험 = 강한 빨강. wrapper 패턴 유지.
  deleteZoneWrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  deleteZone: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.error,
    borderRadius: 999,
    // iOS shadow + Android elevation 으로 떠있는 느낌
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  deleteZoneText: {
    ...textStyles.label,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  });
}
