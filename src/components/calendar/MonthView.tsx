/**
 * MonthView — monthly calendar grid.
 *
 * Layout:
 *  - Day-of-week header row: 일 월 화 수 목 금 토
 *  - Up to 6 weeks × 7 columns of day cells
 *
 * Each day cell shows:
 *  - Date number (greyed out for prev/next month)
 *  - Up to MAX_DOTS colored event dots
 *  - "+N" overflow label when events exceed MAX_DOTS
 *
 * Color rules:
 *  - Today: primary background circle
 *  - Selected date: secondary ring highlight
 *  - Previous / next month days: tertiary text color
 *  - Sundays: rose accent text
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, Alert, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { useTranslatedTitles } from '@/hooks/useTranslatedTitles';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { contrastingTextColor } from '@/lib/colorContrast';
import { useAuthStore } from '@/stores/authStore';
import { getHolidaysByDate, type CountryCode } from '@/services/holidayService';
import {
  useMonthDragHandler,
  type MonthCellLayout,
  type MonthEventLayout,
} from './useMonthDragHandler';
import { useOptimisticReschedule } from './useOptimisticReschedule';
import { UndoToast, useUndoToast } from './UndoToast';
import { applyDelta } from '@/lib/calendarGeometry';
import { deleteEvent } from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';

/** Maximum bars to show per day cell before collapsing to "+N".
 *  v1.2.6 — 하이브리드 룰 (옵션 C): 1~5 그대로 표시 (행 동적 확장),
 *  6+ 이면 5번째까지 표시 + "+N" 라벨. 일상의 4~5 케이스에서 day view
 *  진입 없이 모두 보이게 + 극단(7+) 에서도 grid 깨지지 않음. */
const MAX_BARS = 5;

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Shape used inside MonthView for per-day items. */
export interface MonthViewItem {
  id: string;
  title: string;
  color: string;
  /** 'todo' draws a hollow/striped bar so it reads as different from events. */
  kind: 'event' | 'todo';
}

interface MonthViewProps {
  /**
   * The month to display. Only year + month components are used;
   * day component is ignored for the grid layout.
   */
  currentMonth: Date;
  /** The currently selected date (highlighted with a ring). */
  selectedDate: Date;
  /**
   * All fetched events indexed by ISO date key (YYYY-MM-DD).
   * Pass eventStore.eventsByDate.
   */
  eventsByDate: Record<string, EventSummary[]>;
  /**
   * Optional planner items (todos with dueDate) grouped by ISO date key.
   * Rendered with a striped bar so they read as different from events.
   */
  todosByDate?: Record<string, MonthViewItem[]>;
  /**
   * Build-91 — Space 단위 기념일 (anniversary). 항상 노출 (LEAD 결정).
   * 이미 dateKey 별로 매핑된 상태로 들어옴 (anniversaryStore.occurrencesByDate).
   * MonthViewItem 으로 변환 후 events/todos 와 같은 strip 에 렌더.
   */
  anniversariesByDate?: Record<string, { id: string; title: string }[]>;
  /**
   * Density of the bottom strip per cell.
   *   'detailed' → Apple-Calendar-style coloured bars with title text
   *   'compact'  → small colour dots only (simplified overview)
   */
  density?: 'detailed' | 'compact';
  /**
   * Called when the user taps a day cell that has at least one event or
   * todo. Parent typically updates `selectedDate` (no view-mode change —
   * LEAD 2026-05-03: "월에서 일자 눌렀을 때 일로 넘어가지 않게").
   */
  onDateSelect: (date: Date) => void;
  /**
   * Build-56 — fired when the user taps a day cell that has NO events or
   * todos. Parent routes this to /event/create with the date pre-filled.
   * Provides the "click empty cell → new event" shortcut without forcing
   * the user to long-press first.
   */
  onEmptyDatePress?: (date: Date) => void;
  /**
   * Optional: called when the user long-presses an empty area of a day cell.
   * Parent can open a quick-create sheet pre-filled with that date.
   * (Build-56 부터는 빈 셀 짧은 탭이 같은 동작을 해서 long-press 의존도는
   *  낮아짐 — onEmptyDatePress 가 우선이고 long-press 는 fallback.)
   */
  onDateLongPress?: (date: Date) => void;
  /**
   * Mirrors WeekView/DayView — fires when drag-to-reschedule enters or
   * leaves edit mode so calendar.tsx can suspend its outer left/right
   * swipe-to-navigate gesture.
   */
  onDragModeChange?: (isDragging: boolean) => void;

  /**
   * Build-64 — targeting (move) 모드 진입/이탈 시 부모에 알림. 부모는
   * 그 사이 FAB 를 trash 아이콘으로 변경 + 클릭 시 삭제.
   */
  onTargetingChange?: (event: EventSummary | null) => void;
  /**
   * Build-64 — MonthView 가 자체 삭제 함수를 부모에 publish. 부모의
   * FAB 가 호출. 컴포넌트 unmount 시 부모가 ref 정리.
   */
  registerDeleteHandler?: (fn: (() => void) | null) => void;

  /**
   * Build-78 LEAD: short press 시 일정 detail/edit 진입.
   *  - 셀 안 일정 1개: 그 일정 직접
   *  - 셀 안 일정 2개+: 선택 picker → 사용자가 고른 일정 detail/edit
   *  - 칩 직접 탭: 그 칩의 일정 detail/edit
   * 부모 (calendar.tsx) 가 router.push(`/event/${id}`) 처리.
   */
  onEventPress?: (event: EventSummary) => void;
}

// ─── Date utilities ────────────────────────────────────────────────────────────

/** Returns the ISO date key string (YYYY-MM-DD) for a given Date object. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True if two Date objects refer to the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Builds the flat array of Date objects for the month grid.
 * Always starts on a Sunday and ends on a Saturday.
 * Contains between 28 and 42 cells.
 */
function buildMonthCells(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const firstDOW = firstDay.getDay(); // 0 = Sunday

  const cells: Date[] = [];

  // Pad with days from the previous month to reach the first Sunday
  for (let i = firstDOW; i > 0; i--) {
    cells.push(new Date(year, month, 1 - i));
  }

  // All days in the current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }

  // Pad with days from the next month to complete the final row
  const remainder = cells.length % 7;
  if (remainder !== 0) {
    const fill = 7 - remainder;
    for (let i = 1; i <= fill; i++) {
      cells.push(new Date(year, month + 1, i));
    }
  }

  return cells;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Monthly calendar grid with event dot indicators.
 * Tap any day cell to trigger onDateSelect.
 */
export function MonthView({
  currentMonth,
  selectedDate,
  eventsByDate,
  todosByDate,
  anniversariesByDate,
  density = 'detailed',
  onDateSelect,
  onEmptyDatePress,
  onDateLongPress,
  onEventPress,
  onTargetingChange,
  registerDeleteHandler,
  onDragModeChange,
}: MonthViewProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const styles = makeStyles(colors);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // useMemo caches the calendar grid — only recomputed when the month changes (TASK-701)
  const weeks: Date[][] = useMemo(() => {
    const cells = buildMonthCells(year, month);
    const result: Date[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      result.push(cells.slice(i, i + 7));
    }
    return result;
  }, [year, month]);

  const today = new Date();

  // v1.2.0 — 사용자 country 기반 공휴일. authStore.user.country_code 변경 시
  // 자동 재계산. 빈 dict 면 표시 없음.
  const country = (useAuthStore((s) => s.user?.country_code) ?? 'KR') as CountryCode;
  const holidaysByDate = useMemo(() => getHolidaysByDate(country), [country]);

  // Sprint 19 TASK-1907 — translated titles for events visible in this
  // month (Pro + non-default locale only). Cache-only: we never invoke the
  // Edge Function for list views. Collect IDs across the visible grid so a
  // single SELECT fans out to all month cells.
  const visibleEventIds = useMemo(() => {
    const ids: string[] = [];
    for (const week of weeks) {
      for (const d of week) {
        const k = toDateKey(d);
        const list = eventsByDate[k];
        if (!list) continue;
        for (const e of list) ids.push(e.id);
      }
    }
    return ids;
  }, [weeks, eventsByDate]);
  const translatedTitles = useTranslatedTitles(visibleEventIds);

  // ── Drag-to-reschedule (Build-51, month variant) ────────────────────────
  // Layout strategy: we measure the page position of the weeks-grid View
  // once on layout (and on width change) and compute every cell + chip
  // rect analytically from that — no per-chip onLayout overhead. Cell
  // width derives from the measured grid width / 7; cell height is the
  // CELL_HEIGHT constant defined below.

  const gridRef = useRef<View>(null);
  const pageOffsetRef = useRef({ x: 0, y: 0 });
  const [gridWidth, setGridWidth] = useState(0);
  const measureGrid = useCallback(() => {
    gridRef.current?.measureInWindow((x, y) => {
      pageOffsetRef.current = { x, y };
    });
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() => measureGrid());
    return () => cancelAnimationFrame(id);
  }, [measureGrid]);

  const cellWidth = gridWidth > 0 ? gridWidth / 7 : 0;

  const cellLayouts = useMemo<MonthCellLayout[]>(() => {
    if (cellWidth <= 0) return [];
    const out: MonthCellLayout[] = [];
    weeks.forEach((week, weekIdx) => {
      week.forEach((d, dayIdx) => {
        out.push({
          date: d,
          dateKey: toDateKey(d),
          left:   dayIdx  * cellWidth,
          top:    weekIdx * CELL_HEIGHT,
          width:  cellWidth,
          height: CELL_HEIGHT,
        });
      });
    });
    return out;
  }, [weeks, cellWidth]);

  // v1.1.3 — Multi-day 연속 bar 지원.
  //
  // 주(week) 단위로 같은 event.id 가 연속한 날짜에 등장하면 하나의 span bar
  // 로 묶어 가로로 길게 그린다. 카카오/네이버 캘린더 스타일.
  //
  // 알고리즘:
  //  1. 각 주마다 event.id 별 첫·마지막 등장 dayIdx 추출 (startCol/endCol).
  //  2. 다일 우선 정렬 (span 큰 것 먼저), 같은 span 이면 startCol 오름차순.
  //  3. row packing — 각 row 의 마지막 endCol 을 기억해, 새 그룹의 startCol
  //     이 그것보다 크면 같은 row 재사용. 충돌 시 다음 row.
  //  4. MAX_BARS 초과 row 는 visible 에서 제외 (overflow +N 라벨로 별도 표시).
  //
  // dateKey 는 첫 등장 날짜 — useMonthDragHandler 가 이 key 로 cell 매핑.
  // v1.1.4 — 동적 row height. 일정 적은 주는 작게, 많은 주는 max 까지.
  // weekChipCounts 와 cumulativeWeekTop 을 같이 산출해 layout.top 을
  // 정확한 grid-local y 로 채움 (drag hitTest 호환).
  const { eventLayouts, weekHeights, overflowLabels } = useMemo<{
    eventLayouts: MonthEventLayout[];
    weekHeights: number[];
    overflowLabels: Array<{
      dateKey: string;
      count: number;
      left: number;
      top: number;
      width: number;
    }>;
  }>(() => {
    // 1) 각 주의 packed chip 정보 먼저 산출 (top 은 아직 미정).
    type PackedChip = {
      event: EventSummary;
      dateKey: string;
      left: number;
      chipIdx: number;
      width: number;
    };
    const perWeekChips: PackedChip[][] = weeks.map(() => []);
    const chipCounts: number[] = weeks.map(() => 0);
    // v1.2.6 — 셀별 overflow 누적. chipIdx >= MAX_BARS 인 event 가 차지한
    // 모든 날짜 키에 +1. event layer 의 "+N" 라벨 source. (weekIdx/dayIdx
    // 도 같이 보관해 cum 계산 후 절대 위치 산출.)
    const perDayHiddenRaw: Record<string, { count: number; weekIdx: number; dayIdx: number }> = {};

    if (cellWidth > 0 && density === 'detailed') {
      weeks.forEach((week, weekIdx) => {
        const groups = new Map<string, { startCol: number; endCol: number; event: EventSummary }>();
        const order: string[] = [];
        week.forEach((d, dayIdx) => {
          const key = toDateKey(d);
          (eventsByDate[key] ?? []).forEach((e) => {
            const exist = groups.get(e.id);
            if (!exist) {
              groups.set(e.id, { startCol: dayIdx, endCol: dayIdx, event: e });
              order.push(e.id);
            } else if (dayIdx > exist.endCol) {
              exist.endCol = dayIdx;
            }
          });
        });
        const sorted = [...order].sort((a, b) => {
          const A = groups.get(a)!;
          const B = groups.get(b)!;
          const spanA = A.endCol - A.startCol;
          const spanB = B.endCol - B.startCol;
          if (spanA !== spanB) return spanB - spanA;
          return A.startCol - B.startCol;
        });
        const rowEndCols: number[] = [];
        sorted.forEach((eventId) => {
          const spec = groups.get(eventId)!;
          let chipIdx = rowEndCols.findIndex((endCol) => spec.startCol > endCol);
          if (chipIdx === -1) {
            chipIdx = rowEndCols.length;
            rowEndCols.push(-1);
          }
          rowEndCols[chipIdx] = spec.endCol;
          // v1.2.6 — chipIdx 0~3 (= 4개) 까지만 chip 으로 그리고, 4 부터는
          // hidden 처리. 마지막 row (chipIdx=4) 는 +N 라벨 자리. chip 이
          // 그려지지 않으니 +N 라벨에 underlying chip 색 안 비침.
          if (chipIdx >= MAX_BARS - 1) {
            for (let col = spec.startCol; col <= spec.endCol; col++) {
              const k = toDateKey(week[col]!);
              const existing = perDayHiddenRaw[k];
              if (existing) {
                existing.count += 1;
              } else {
                perDayHiddenRaw[k] = { count: 1, weekIdx, dayIdx: col };
              }
            }
            return;
          }
          perWeekChips[weekIdx]!.push({
            event: spec.event,
            dateKey: toDateKey(week[spec.startCol]!),
            left:    spec.startCol * cellWidth + 2,
            chipIdx,
            width:   (spec.endCol - spec.startCol + 1) * cellWidth - 4,
          });
        });
        chipCounts[weekIdx] = Math.min(rowEndCols.length, MAX_BARS);
      });
    }

    // 2) 주별 height: 기본 + chip 행 수 * CHIP_ROW.
    const heights = chipCounts.map((c) => WEEK_MIN_HEIGHT + c * CHIP_ROW);

    // 3) 누적 top — week 의 grid-local 시작 y.
    const cum: number[] = [0];
    for (let i = 0; i < heights.length; i++) cum.push((cum[i] ?? 0) + (heights[i] ?? 0));

    // 4) chip 의 실제 top = 누적 + CHIP_TOP + chipIdx * CHIP_ROW.
    const out: MonthEventLayout[] = [];
    perWeekChips.forEach((chips, weekIdx) => {
      chips.forEach((c) => {
        out.push({
          event:   c.event,
          dateKey: c.dateKey,
          left:    c.left,
          top:     (cum[weekIdx] ?? 0) + CHIP_TOP + c.chipIdx * CHIP_ROW,
          width:   c.width,
          height:  CHIP_HEIGHT,
        });
      });
    });

    // 5) overflow 라벨의 절대 위치 산출. event chip 의 MAX_BARS 째 슬롯
    //    자리에 정렬해 같은 row 의 마지막 chip 을 +N 으로 가린다.
    const overflowOut = Object.entries(perDayHiddenRaw).map(([dateKey, info]) => ({
      dateKey,
      count: info.count,
      left:  info.dayIdx * cellWidth + 2,
      top:   (cum[info.weekIdx] ?? 0) + CHIP_TOP + (MAX_BARS - 1) * CHIP_ROW,
      width: cellWidth - 4,
    }));

    return { eventLayouts: out, weekHeights: heights, overflowLabels: overflowOut };
  }, [weeks, eventsByDate, cellWidth, density]);

  // ── Targeting (drop-target) state — Build-54 redesign ───────────────────
  // After a long-press selects an event (single-event cell directly, or
  // multi-event cell via the picker Modal), we enter "targeting" mode:
  // every cell shows a dashed purple guide-line and the next cell tap
  // commits the move. This replaces the fragile finger-drag flow.
  const [targetEvent, setTargetEvent] = useState<EventSummary | null>(null);
  const [pickerEvents, setPickerEvents] = useState<EventSummary[] | null>(null);
  // Build-78 — short press 다중 일정 view picker (move 용 pickerEvents 와 별개).
  const [viewPickerEvents, setViewPickerEvents] = useState<EventSummary[] | null>(null);

  const { t } = useTranslation();
  const { toast: undoToast, showUndo } = useUndoToast();
  const handleRescheduleDrop = useOptimisticReschedule({ onMoved: showUndo });
  const removeEvent = useEventStore((s) => s.removeEvent);

  /**
   * Delete the picked event from the targeting toolbar. Shows the same
   * confirm Alert the event-detail screen uses so users can't lose data
   * by mis-tapping. On confirm we optimistically remove from the store
   * (calendar redraws immediately) and call the API; the caller's Alert
   * surfaces any failure.
   */
  const handleDeletePickedEvent = useCallback(() => {
    const evt = targetEvent;
    if (!evt) return;
    Alert.alert(
      t('event.delete'),
      t('event.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            // Exit targeting mode FIRST so the toolbar disappears even if the
            // network call slow-resolves — the user wanted to delete, not stay
            // in move mode.
            setTargetEvent(null);
            removeEvent(evt.id);
            try {
              await deleteEvent(evt.id);
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
  }, [targetEvent, removeEvent, t]);

  const commitMove = useCallback(
    (event: EventSummary, targetDate: Date) => {
      const sourceDay = new Date(event.startAt);
      sourceDay.setHours(0, 0, 0, 0);
      const target0 = new Date(targetDate);
      target0.setHours(0, 0, 0, 0);
      const dayDelta = Math.round(
        (target0.getTime() - sourceDay.getTime()) / 86_400_000,
      );
      if (dayDelta === 0) return;
      const { newStartAt, newEndAt } = applyDelta(
        event.startAt, event.endAt, dayDelta, /* minuteDelta */ 0,
      );
      handleRescheduleDrop({
        event,
        dayDelta,
        minuteDelta: 0,
        newStartAt,
        newEndAt,
      });
    },
    [handleRescheduleDrop],
  );

  const handleLongPressCell = useCallback(
    (cellEvents: EventSummary[]) => {
      if (cellEvents.length === 0) return;
      if (cellEvents.length === 1) {
        // Single event → enter targeting directly (skip popup noise).
        setTargetEvent(cellEvents[0] ?? null);
        return;
      }
      // Multi-event → show picker so the user can choose which one.
      setPickerEvents(cellEvents);
    },
    [],
  );

  const handleChipTap = useCallback(
    (event: EventSummary) => {
      // Build-79 LEAD: "월 뷰 칸에 여러 개 있으면 다른건 수정이 안되잖아.
      // 샐랙 화면이 먼저 나와야". chip 직접 탭이라도 셀에 events 가
      // 2+ 면 picker 먼저 노출 → 사용자가 어느 일정 편집할지 선택.
      const dateKey = toDateKey(event.startAt);
      const dayEvents = eventsByDate[dateKey] ?? [];
      if (dayEvents.length >= 2 && onEventPress) {
        setViewPickerEvents(dayEvents);
        return;
      }
      // 셀에 1개 일정만 있을 때는 직접 detail/edit 진입.
      if (onEventPress) onEventPress(event);
      else onDateSelect(event.startAt);
    },
    [onEventPress, onDateSelect, eventsByDate],
  );

  const { panHandlers, candidateEvent } = useMonthDragHandler({
    eventLayouts,
    cellLayouts,
    eventsByDate,
    pageOffsetRef,
    onLongPressCell: handleLongPressCell,
    onChipTap: handleChipTap,
    // While we're waiting for a drop cell, yield ALL touches to the cell
    // grid so the user can land on cells that already contain events.
    disabled: targetEvent !== null,
  });

  // Notify parent when targeting starts/stops so the outer swipe
  // gesture can suspend (otherwise a sloppy finger could swipe months
  // while picking a target cell).
  useEffect(() => {
    onDragModeChange?.(targetEvent !== null);
    onTargetingChange?.(targetEvent);
  }, [targetEvent, onDragModeChange, onTargetingChange]);

  // Build-64 — publish/clear delete handler ref so the parent FAB can
  // call it (FAB acts as both create + month delete).
  useEffect(() => {
    registerDeleteHandler?.(handleDeletePickedEvent);
    return () => { registerDeleteHandler?.(null); };
  }, [registerDeleteHandler, handleDeletePickedEvent]);

  // Cell-tap dispatcher — used by every TouchableOpacity in the grid.
  // Build-78 LEAD: short press 분기.
  //   1. Targeting mode → commit the picked event to this cell.
  //   2. Empty cell → onEmptyDatePress → /event/create?date=...
  //   3. Cell with 1 event → onEventPress(event) (직접 detail/edit).
  //   4. Cell with 2+ events → viewPickerEvents (선택 picker).
  //   - todos 만 있고 events 0 인 경우: onDateSelect (드릴 X, 기존 동작).
  const handleCellPress = useCallback(
    (date: Date, dayEvents: EventSummary[]) => {
      if (targetEvent) {
        commitMove(targetEvent, date);
        setTargetEvent(null);
        return;
      }
      if (dayEvents.length === 0 && onEmptyDatePress) {
        onEmptyDatePress(date);
        return;
      }
      if (dayEvents.length === 1 && onEventPress) {
        const evt = dayEvents[0];
        if (evt) {
          onEventPress(evt);
          return;
        }
      }
      if (dayEvents.length >= 2 && onEventPress) {
        setViewPickerEvents(dayEvents);
        return;
      }
      onDateSelect(date);
    },
    [targetEvent, commitMove, onDateSelect, onEmptyDatePress, onEventPress],
  );

  return (
    <View style={styles.container}>
      {/* Day-of-week header. v1.1.5 — 일요일 빨강 / 토요일 파랑. */}
      <View style={styles.dowRow}>
        {DOW_LABELS.map((label, idx) => (
          <View key={label} style={styles.dowCell}>
            <Text style={[
              styles.dowLabel,
              idx === 0 && styles.sundayText,
              idx === 6 && styles.saturdayText,
            ]}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {/* v1.1.4 — 6주 grid 합계가 화면을 넘으면 세로 scroll. cell 크게 키워도
          잘림 없음. drag-to-reschedule pan 은 그대로 동작. */}
      <ScrollView
        style={styles.gridScroll}
        contentContainerStyle={styles.gridScrollContent}
        showsVerticalScrollIndicator={false}
      >
      <View
        ref={gridRef}
        style={styles.gridRoot}
        onLayout={(e) => {
          setGridWidth(e.nativeEvent.layout.width);
          measureGrid();
        }}
        {...panHandlers}
      >
      {weeks.map((week, weekIdx) => (
        <View
          key={weekIdx}
          style={[styles.weekRow, { height: weekHeights[weekIdx] ?? WEEK_MIN_HEIGHT }]}
        >
          {week.map((date, dayIdx) => {
            const isCurrentMonth = date.getMonth() === month;
            const isToday = isSameDay(date, today);
            const isSelected = isSameDay(date, selectedDate);
            const isSunday   = dayIdx === 0;
            const isSaturday = dayIdx === 6;
            const dateKey = toDateKey(date);
            const dayEvents = eventsByDate[dateKey] ?? [];
            // v1.2.1 — dayTodos 를 dayItems 에 합치지 않으므로 추출 제거.
            // 부모는 여전히 todosByDate 를 prop 으로 전달할 수 있지만 무시함.
            // (todosByDate prop 자체는 backward-compat 으로 유지.)
            // const dayTodos = todosByDate?.[dateKey] ?? [];
            const dayAnniversaries = anniversariesByDate?.[dateKey] ?? [];
            // v1.2.0 — 사용자 국가 공휴일·기념일. read-only.
            // v1.1.4 fix: events 가 외부 absolute layer (eventLayouts) 로 옮겨가
            // 면서 holiday 가 어디에도 안 그려지던 회귀. 이제는 dayItems 와
            // 분리해 cell 안 날짜 숫자 바로 밑에 작은 텍스트로 렌더.
            // 휴일 (off !== false) → 날짜 숫자 빨강 / 비휴일 기념일 → 그대로.
            // 텍스트는 항상 검정.
            const dayHolidays = holidaysByDate[dateKey] ?? [];
            const isHoliday   = dayHolidays.length > 0;
            const isOffDay    = dayHolidays.some((h) => h.off !== false);
            // v1.2.1 — 할일(todo)은 캘린더에 노출하지 않음 (LEAD 결정).
            // dayTodos 는 더 이상 dayItems 에 합쳐지지 않음. 플래너 탭 전용.
            // Merge events + anniversaries 한 strip. (holidays 는 별도)
            const dayItems: MonthViewItem[] = [
              ...dayEvents.map((e): MonthViewItem => ({
                id: e.id,
                title: translatedTitles.get(e.id) ?? e.title,
                color: e.color,
                kind: 'event',
              })),
              ...dayAnniversaries.map((a): MonthViewItem => ({
                id:    `anniv-${a.id}`,
                title: `🎉 ${a.title}`,
                color: '#EC4899',
                kind:  'event',
              })),
            ];

            return (
              <TouchableOpacity
                key={dateKey}
                style={[
                  styles.dayCell,
                  // Build-54 — targeting guide. Every cell shows a dashed
                  // purple border while the user is choosing where to drop
                  // the selected event. The source cell (where the picked
                  // event currently lives) gets a solid border instead so
                  // the user can see "this is the event I'm moving".
                  targetEvent && styles.targetCell,
                  targetEvent && targetEvent.startAt &&
                    toDateKey(targetEvent.startAt) === dateKey &&
                    styles.targetSourceCell,
                ]}
                onPress={() => handleCellPress(date, dayEvents)}
                onLongPress={onDateLongPress ? () => onDateLongPress(date) : undefined}
                delayLongPress={400}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`}
              >
                {/* Date number with today/selected highlights */}
                <View
                  style={[
                    styles.dateCircle,
                    isToday && styles.todayCircle,
                    isSelected && !isToday && styles.selectedCircle,
                  ]}
                >
                  <Text
                    style={[
                      styles.dateText,
                      !isCurrentMonth && styles.dimText,
                      // v1.1.4 — 휴일 (off !== false) 만 빨간날.
                      // 비휴일 기념일은 날짜 색 그대로, 텍스트만 밑에.
                      // Weekend tints go first and the holiday tint last: RN style arrays let
                      // later entries win, so a public holiday stays red even when it falls on
                      // a Saturday (2026: 현충일 6/6, 광복절 8/15, 개천절 10/3 are all Saturdays,
                      // and used to render in the blue Saturday colour).
                      isSunday   && !isToday && !isSelected && styles.sundayText,
                      isSaturday && !isToday && !isSelected && styles.saturdayText,
                      isOffDay   && !isToday && !isSelected && styles.holidayDateText,
                      isToday && styles.todayText,
                      isSelected && !isToday && styles.selectedText,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </View>

                {/* v1.1.4 — 공휴일 이름 (날짜 숫자 바로 밑, 일반 일정보다 작게).
                    여러 공휴일이 같은 날 겹치는 경우는 줄바꿈으로 표시. */}
                {isHoliday && (
                  <View style={styles.holidayLabelWrap} pointerEvents="none">
                    {dayHolidays.map((h) => (
                      <Text
                        key={`hol-${h.name}`}
                        style={[
                          styles.holidayLabel,
                          !isCurrentMonth && styles.dimText,
                        ]}
                        numberOfLines={2}
                      >
                        {h.name}
                      </Text>
                    ))}
                  </View>
                )}

                {/*
                  Two densities:
                   - detailed: Apple-Calendar-style coloured bars with title
                   - compact:  small colour dots only (overview / mobile)
                */}
                {/* v1.2.6 — overflow "+N" 라벨은 event chip layer (grid level)
                    에서 그림. 같은 sibling 안 같은 부모 + 나중 렌더 → chip 위로
                    올라옴. 셀 안에 두면 layer 가 위로 가려 보이지 않음. */}

                {dayItems.length > 0 && density === 'compact' && (
                  <View style={styles.dotRow}>
                    {dayItems.slice(0, 5).map((it) => (
                      <View
                        key={it.id}
                        style={[
                          styles.compactDot,
                          { backgroundColor: it.color },
                          it.kind === 'todo' && styles.compactDotOutline,
                        ]}
                      />
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {/* v1.1.3 — Multi-day event 절대 위치 layer.
          eventLayouts 는 주별 span 으로 묶인 layout 이라 한 다일 event 가
          한 bar 로 보임. pointerEvents="box-none" → cell tap 은 통과시키고
          chip 자체만 tap. */}
      {density === 'detailed' && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {eventLayouts.map((layout) => {
            const it = layout.event;
            const isSpan = layout.width > cellWidth - 4 + 1; // 다일 여부 ( +1 epsilon)
            const title = translatedTitles.get(it.id) ?? it.title;
            return (
              <View
                key={`${layout.dateKey}-${it.id}`}
                pointerEvents="none"
                style={[
                  styles.itemBar,
                  {
                    position: 'absolute',
                    left:   layout.left,
                    top:    layout.top,
                    width:  layout.width,
                    height: layout.height,
                    backgroundColor: it.color,
                  },
                  isSpan && styles.spanBar,
                ]}
                testID="event-bar"
              >
                <Text
                  style={[styles.itemBarText, { color: contrastingTextColor(it.color) }]}
                  numberOfLines={2}
                >
                  {title}
                </Text>
              </View>
            );
          })}

          {/* v1.2.6 — overflow "+N" 라벨. 같은 absoluteFill 부모 안에서
              eventLayouts 다음에 렌더되어 chipIdx=4 자리의 마지막 chip 위로
              올라와 가린다. opaque background 로 underlying chip 완전 차단. */}
          {overflowLabels.map((ov) => (
            <View
              key={`overflow-${ov.dateKey}`}
              pointerEvents="none"
              style={[
                styles.overflowSlot,
                {
                  left:   ov.left,
                  top:    ov.top,
                  width:  ov.width,
                },
              ]}
            >
              <Text style={styles.overflowLabel}>+{ov.count}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Long-press in progress — bright ring around the candidate chip
          so the user gets immediate feedback before the long-press fires. */}
      {candidateEvent && !targetEvent && (() => {
        const chip = eventLayouts.find((c) => c.event.id === candidateEvent.id);
        if (!chip) return null;
        return (
          <View
            pointerEvents="none"
            style={[
              styles.candidateRing,
              {
                left:   chip.left,
                top:    chip.top,
                width:  chip.width,
                height: chip.height,
              },
            ]}
          />
        );
      })()}
      </View>
      </ScrollView>

      {/* Build-54 — targeting toolbar. Shown while the user is choosing
          a destination cell. Title surfaces the picked event; the cancel
          button bails out of the move without changes. */}
      {targetEvent && (
        <View style={styles.targetToolbar}>
          <View style={[styles.targetToolbarDot, { backgroundColor: targetEvent.color }]} />
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text style={styles.targetToolbarTitle} numberOfLines={1}>
              {translatedTitles.get(targetEvent.id) ?? targetEvent.title}
            </Text>
            <Text style={styles.targetToolbarHint}>{t('calendar.targeting_hint')}</Text>
          </View>
          {/* Build-64 — toolbar 의 inline 삭제 버튼 제거. 부모 FAB 가
              targetEvent !== null 일 때 trash 아이콘 + 클릭 시 삭제. */}
          <Pressable
            onPress={() => setTargetEvent(null)}
            hitSlop={8}
            style={styles.targetToolbarCancel}
          >
            <Text style={styles.targetToolbarCancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      )}

      {/* Build-54 — multi-event picker Modal. Long-pressing a cell with
          2+ events opens this list; tapping an item enters targeting
          mode with that event picked. Backdrop tap cancels. */}
      <Modal
        visible={pickerEvents !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerEvents(null)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerEvents(null)}>
          <Pressable style={styles.pickerCard} onPress={() => undefined}>
            <Text style={styles.pickerHeaderText}>이동할 일정 선택</Text>
            <Text style={styles.pickerHeaderHint}>탭하면 옮길 위치를 고를 수 있어요</Text>
            {pickerEvents?.map((evt) => {
              const startH = String(evt.startAt.getHours()).padStart(2, '0');
              const startM = String(evt.startAt.getMinutes()).padStart(2, '0');
              return (
                <Pressable
                  key={evt.id}
                  style={({ pressed }) => [
                    styles.pickerItem,
                    pressed && styles.pickerItemHi,
                  ]}
                  onPress={() => {
                    setTargetEvent(evt);
                    setPickerEvents(null);
                  }}
                >
                  <View style={[styles.pickerColorBar, { backgroundColor: evt.color }]} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.pickerItemTitle} numberOfLines={1}>
                      {translatedTitles.get(evt.id) ?? evt.title}
                    </Text>
                    <Text style={styles.pickerItemTime}>
                      {evt.allDay ? '하루 종일' : `${startH}:${startM}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Build-78 — short press 다중 일정 view picker. 일정 1개 셀은 직접
          onEventPress, 2+ 셀은 이 modal 노출 → 사용자가 고른 일정의
          detail/edit 화면으로 이동. */}
      <Modal
        visible={viewPickerEvents !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewPickerEvents(null)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setViewPickerEvents(null)}>
          <Pressable style={styles.pickerCard} onPress={() => undefined}>
            <Text style={styles.pickerHeaderText}>{t('common.preview', '일정 보기')}</Text>
            <Text style={styles.pickerHeaderHint}>
              {viewPickerEvents?.length ?? 0}개 일정 · 탭하면 상세 / 편집 화면으로 이동해요
            </Text>
            {/* v1.2.6 — picker 안 ScrollView 로 N개 다 노출 보장. 5+ event
                셀(+N 표시) 클릭 시 화면 밖으로 잘리던 회귀 fix. */}
            <ScrollView
              style={styles.pickerScroll}
              contentContainerStyle={{ paddingBottom: 4 }}
              showsVerticalScrollIndicator
            >
              {viewPickerEvents?.map((evt, idx) => {
                const startH = String(evt.startAt.getHours()).padStart(2, '0');
                const startM = String(evt.startAt.getMinutes()).padStart(2, '0');
                return (
                  <Pressable
                    key={`${evt.id}-${idx}`}
                    style={({ pressed }) => [
                      styles.pickerItem,
                      pressed && styles.pickerItemHi,
                    ]}
                    onPress={() => {
                      const picked = evt;
                      setViewPickerEvents(null);
                      // ⚠️ RN Modal 두 개를 같은 틱에 transition 하면(피커 dismiss +
                      // onEventPress 가 여는 모달 = 게스트 LoginPromptSheet 또는 이벤트
                      // 상세) iOS 가 터치 deadlock 에 빠져 앱이 멈춘다(2026-06-05 게스트
                      // 실측). 피커가 닫힌 뒤로 onEventPress 를 미뤄 모달 충돌을 피한다.
                      setTimeout(() => onEventPress?.(picked), 350);
                    }}
                  >
                    <View style={[styles.pickerColorBar, { backgroundColor: evt.color }]} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.pickerItemTitle} numberOfLines={1}>
                        {translatedTitles.get(evt.id) ?? evt.title}
                      </Text>
                      <Text style={styles.pickerItemTime}>
                        {evt.allDay ? '하루 종일' : `${startH}:${startM}`}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {undoToast && <UndoToast toast={undoToast} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Cell height: expanded vs the previous 60px default so the Apple-Calendar-
// style colour bars (title + up to 3 of them) have room without crowding
// the day number. Comes out to roughly 6 × 82 = 492 px of grid body.
// v1.1.4 — 동적 row height. 일정 0개인 주 = WEEK_MIN_HEIGHT,
// 일정 많은 주 = WEEK_MIN_HEIGHT + MAX_BARS * CHIP_ROW (최대).
// 화면 fit 안 되면 외부 ScrollView 에서 세로 스크롤.
const WEEK_MIN_HEIGHT = 72;     // dateCircle(30) + holidayLabel 2줄 자리(28) + 여유(14)
const DATE_CIRCLE     = 30;
const CHIP_HEIGHT     = 26;     // event chip 1줄 height (2줄 줄바꿈 대응)
const CHIP_SPACING    = 2;
const CHIP_TOP        = 60;     // dateCircle 끝 + holidayLabel 2줄 끝 + margin
const CHIP_ROW        = CHIP_HEIGHT + CHIP_SPACING; // 28
// fixed fallback (cell 안 todo/anniversary barStack 위치 등 일부 곳 유지).
const CELL_HEIGHT     = WEEK_MIN_HEIGHT + 3 * CHIP_ROW; // 156

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
  dowRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing[2],
  },
  dowCell: {
    flex: 1,
    alignItems: 'center',
  },
  dowLabel: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
  },
  // v1.1.4 — height 는 inline 으로 weekHeights[weekIdx] 주입 (dynamic).
  weekRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing[1],
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    // Build-77 LEAD: cell 안 일정 bar 가 늘어나도 다음 cell 침범 X.
    overflow: 'hidden',
  },
  dateCircle: {
    width: DATE_CIRCLE,
    height: DATE_CIRCLE,
    borderRadius: DATE_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Build-60 → Build-61 — colors.primary 가 hsl() 함수 형식이라 8-자리
  // hex alpha 'B0' / '8C' 를 그냥 붙이면 RN 이 "Invalid style property of
  // borderColor" 콘솔 에러 (Web QA 발견). hsla() 로 대체.
  todayCircle: {
    backgroundColor: colors.primary.startsWith('hsl(')
      ? colors.primary.replace('hsl(', 'hsla(').replace(')', ', 0.7)')
      : colors.primary + 'B0',
  },
  selectedCircle: {
    borderWidth: 1,
    borderColor: colors.primary.startsWith('hsl(')
      ? colors.primary.replace('hsl(', 'hsla(').replace(')', ', 0.55)')
      : colors.primary + '8C',
  },
  dateText: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  dimText: {
    // Previous month / next month days. textTertiary was so close to
    // the background in light mode that the digits looked invisible
    // (LEAD report: "월 뷰에서 일자가 안 떠"). Use textSecondary which
    // still reads as "secondary context" but stays clearly legible.
    color: colors.textSecondary,
    opacity: 0.55,
  },
  // LEAD 2026-04-28: 다른 월(leading/trailing) 일자에 표시되는 일정/할일
  // chip들도 함께 dim 처리. 0.4 opacity로 본 월과 시각 구분.
  dimItems: {
    opacity: 0.4,
  },
  // v1.1.5 — 일요일 빨강, 토요일 파랑. 한국 캘린더 표준 컬러 규칙.
  sundayText: {
    color: '#DC2626',
  },
  saturdayText: {
    color: '#2563EB',
  },
  // v1.1.4 — 공휴일 빨간날. 일요일과 톤 일치.
  holidayDateText: {
    color: '#DC2626',
  },
  // v1.1.4 — 공휴일·기념일 이름 표시 (날짜 숫자 바로 밑).
  // 일반 일정 itemBarText 보다 한 단계 작은 size + 줄간격 빠듯하게.
  // 사용자 명세 — 텍스트는 검정 (빨강 X). 날짜 숫자만 휴일이면 빨강.
  holidayLabelWrap: {
    marginTop: 1,
    paddingHorizontal: 2,
  },
  holidayLabel: {
    fontSize: 9,
    lineHeight: 11,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  todayText: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  selectedText: {
    color: colors.primary,
    fontWeight: '600',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[0.5],
    height: 8,
  },
  // v1.2.6 — overflow "+N" 슬롯. chipIdx=4 자리는 packing 단계에서 chip
  // 자체를 안 그리므로 underlying 색 없음 → 박스/외곽선 없이 텍스트만.
  // 셀 폭의 가운데 정렬, 박스 크기는 자식(텍스트)에 맞춤.
  overflowSlot: {
    position: 'absolute',
    height: CHIP_HEIGHT,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // v1.2.6 — 텍스트만. 박스/배경 없이 셀에 자연스럽게 묻히게.
  overflowLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  // Apple-Calendar-style colour bars stacked top→bottom below the day number.
  // Build-77 — gap 1→2 visual breathing.
  barStack: {
    marginTop: 2,
    width: '100%',
    paddingHorizontal: 2,
    gap: 2,
  },
  // v1.1.4 — height 13 → 26 (2줄 줄바꿈). minHeight 로 1줄일 땐 줄어듦.
  itemBar: {
    minHeight: 13,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // v1.1.3 — multi-day span bar (가로로 긴 형태). 단일일과 시각 구분 위해
  // 모서리 라운드 조금 더 + (필요 시) 추후 시작/종료/중간 셀별 분기 가능.
  spanBar: {
    borderRadius: 4,
  },
  itemBarText: {
    fontSize: 10,
    lineHeight: 12,
  },
  compactDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 1,
  },
  compactDotOutline: {
    borderWidth: 1.5,
    borderColor: '#FFFFFF00',
    opacity: 0.6,
  },
  // Build-51 — gridRoot is the measured wrapper around the weeks block.
  // position:'relative' implied but stated so absolute children resolve
  // against this container.
  gridRoot: {
    position: 'relative',
  },
  // v1.1.4 — 외부 세로 ScrollView. 6주 * cellHeight 가 화면 넘을 때 스크롤.
  gridScroll: {
    flex: 1,
  },
  gridScrollContent: {
    flexGrow: 1,
  },
  candidateRing: {
    position: 'absolute',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 6,
  },
  // Build-56 → Build-60 — color-only targeting guide.
  // 셀 box 크기 변화 0 (border 사용 안 함). 배경색만으로 표시.
  // LEAD 2026-05-03 — "더 연한 반투명 하늘색". rgba light blue
  // (#60A5FA, Tailwind blue-400) 기반. alpha 0.35 (더 연하게 재조정).
  targetCell: {
    backgroundColor: 'rgba(96, 165, 250, 0.35)',
  },
  // source 셀 — 옮기는 원본임을 살짝 더 강조하되 여전히 연하게.
  targetSourceCell: {
    backgroundColor: 'rgba(59, 130, 246, 0.5)',
  },
  // Targeting toolbar pinned at the bottom of the calendar grid; surfaces
  // which event is being moved + a cancel button.
  // LEAD 2026-05-03 — primary tinted background + 진한 border 로 "이동
  // 모드" 라는 게 한눈에 보이도록 강조. 이전엔 surface 배경이라 화면
  // 전반과 섞여 모드 진입을 놓치는 사용자 보고가 있었음.
  targetToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '14',
    borderTopWidth: 2,
    borderTopColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  targetToolbarDot: {
    width: 6,
    height: 32,
    borderRadius: 3,
  },
  targetToolbarTitle: {
    ...textStyles.labelSm,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  targetToolbarHint: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  targetToolbarCancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Build-63 — solid red FAB 스타일로 강화. trash 아이콘 + "삭제" 텍스트.
  // drag chip 과 동일 디자인 언어 → 사용자가 어디서든 "빨간 = 삭제" 인지.
  targetToolbarDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: colors.error,
    marginRight: 6,
  },
  targetToolbarDeleteText: {
    ...textStyles.labelSm,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  targetToolbarCancelText: {
    ...textStyles.labelSm,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  // Build-54 — multi-event picker Modal. Backdrop dim + centred card.
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  pickerCard: {
    width: '100%',
    maxWidth: 320,
    // v1.2.6 — 화면 70% cap. picker 가 화면 밖 안 나가게.
    maxHeight: '70%',
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 12,
  },
  // v1.2.6 — picker 내 ScrollView. 헤더 2줄 + bottom padding 제외 잔여.
  pickerScroll: {
    flexGrow: 0,
  },
  pickerHeaderText: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
  pickerHeaderHint: {
    ...textStyles.caption,
    color: colors.textSecondary,
    paddingHorizontal: 8,
    marginTop: 2,
    marginBottom: 6,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pickerItemHi: {
    backgroundColor: colors.primary + '18',
  },
  pickerColorBar: {
    width: 4,
    height: 32,
    borderRadius: 2,
  },
  pickerItemTitle: {
    ...textStyles.labelSm,
    color: colors.textPrimary,
  },
  pickerItemTime: {
    ...textStyles.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  });
}
