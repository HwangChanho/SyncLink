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
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { useTranslatedTitles } from '@/hooks/useTranslatedTitles';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
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

/** Maximum bars to show per day cell before collapsing to "+N". */
const MAX_BARS = 3;

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
  density = 'detailed',
  onDateSelect,
  onEmptyDatePress,
  onDateLongPress,
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

  // Chip-level rects: only for detailed-density; compact-density (dots)
  // shows multiple events as a single dot row, so individual hit-test
  // isn't meaningful — drag is disabled in compact mode.
  const eventLayouts = useMemo<MonthEventLayout[]>(() => {
    if (cellWidth <= 0 || density !== 'detailed') return [];
    const out: MonthEventLayout[] = [];
    weeks.forEach((week, weekIdx) => {
      week.forEach((d, dayIdx) => {
        const key = toDateKey(d);
        const dayEvents = (eventsByDate[key] ?? []);
        // Only the first MAX_BARS chips are visible in the cell; the rest
        // collapse into "+N" overflow text and aren't draggable.
        dayEvents.slice(0, MAX_BARS).forEach((e, chipIdx) => {
          // Cell layout offsets: paddingTop(4) + DATE_CIRCLE(30) +
          //   barStack.marginTop(2) = 36 → first chip top
          // Each subsequent chip: itemBar.height(13) + barStack.gap(1) = 14
          out.push({
            event: e,
            dateKey: key,
            left:   dayIdx  * cellWidth + 2,           // barStack horizontal padding
            top:    weekIdx * CELL_HEIGHT + 36 + chipIdx * 14,
            width:  cellWidth - 4,                     // 2px padding each side
            height: 13,
          });
        });
      });
    });
    return out;
  }, [weeks, eventsByDate, cellWidth, density]);

  // ── Targeting (drop-target) state — Build-54 redesign ───────────────────
  // After a long-press selects an event (single-event cell directly, or
  // multi-event cell via the picker Modal), we enter "targeting" mode:
  // every cell shows a dashed purple guide-line and the next cell tap
  // commits the move. This replaces the fragile finger-drag flow.
  const [targetEvent, setTargetEvent] = useState<EventSummary | null>(null);
  const [pickerEvents, setPickerEvents] = useState<EventSummary[] | null>(null);

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
    (event: EventSummary) => onDateSelect(event.startAt),
    [onDateSelect],
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
  // Three modes:
  //   1. Targeting mode → commit the picked event to this cell.
  //   2. Cell with events/todos → onDateSelect (parent updates
  //      selectedDate; LEAD 2026-05-03 wants NO automatic switch to day
  //      view — that turned a one-tap browse into a forced drill-down).
  //   3. Empty cell → onEmptyDatePress → /event/create?date=...
  const handleCellPress = useCallback(
    (date: Date, hasItems: boolean) => {
      if (targetEvent) {
        commitMove(targetEvent, date);
        setTargetEvent(null);
        return;
      }
      if (!hasItems && onEmptyDatePress) {
        onEmptyDatePress(date);
        return;
      }
      onDateSelect(date);
    },
    [targetEvent, commitMove, onDateSelect, onEmptyDatePress],
  );

  return (
    <View style={styles.container}>
      {/* Day-of-week header */}
      <View style={styles.dowRow}>
        {DOW_LABELS.map((label, idx) => (
          <View key={label} style={styles.dowCell}>
            <Text style={[styles.dowLabel, idx === 0 && styles.sundayText]}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {/* Date rows — wrapped in a measured View so the drag hook can
          translate page touches into grid-local coordinates. */}
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
        <View key={weekIdx} style={styles.weekRow}>
          {week.map((date, dayIdx) => {
            const isCurrentMonth = date.getMonth() === month;
            const isToday = isSameDay(date, today);
            const isSelected = isSameDay(date, selectedDate);
            const isSunday = dayIdx === 0;
            const dateKey = toDateKey(date);
            const dayEvents = eventsByDate[dateKey] ?? [];
            const dayTodos = todosByDate?.[dateKey] ?? [];
            // Merge events + todos into a single ordered list so the month
            // cell shows an Apple-Calendar-style colour bar per item.
            // Events come first (chronological priority), then todos.
            const dayItems: MonthViewItem[] = [
              ...dayEvents.map((e): MonthViewItem => ({
                id: e.id,
                // Prefer the cached translation when one is available — falls
                // back to the original title when not Pro / locale matches.
                title: translatedTitles.get(e.id) ?? e.title,
                color: e.color,
                kind: 'event',
              })),
              ...dayTodos,
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
                onPress={() => handleCellPress(date, dayItems.length > 0)}
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
                      isSunday && !isToday && styles.sundayText,
                      isToday && styles.todayText,
                      isSelected && !isToday && styles.selectedText,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </View>

                {/*
                  Two densities:
                   - detailed: Apple-Calendar-style coloured bars with title
                   - compact:  small colour dots only (overview / mobile)
                */}
                {dayItems.length > 0 && density === 'detailed' && (() => {
                  // Build-77 LEAD: dense 한 날 (6+) 은 bar 2개 + "+N" 으로
                  // cell 여백 확보. 일반 (≤5) 은 3 + "+N" 유지.
                  const visibleBars = dayItems.length > 5 ? 2 : MAX_BARS;
                  const hidden = Math.max(0, dayItems.length - visibleBars);
                  return (
                    // LEAD 2026-04-28: 다른 월(leading/trailing) 일정은 연하게.
                    <View style={[styles.barStack, !isCurrentMonth && styles.dimItems]}>
                      {dayItems.slice(0, visibleBars).map((it) => (
                        <View
                          key={it.id}
                          testID="event-bar"
                          style={[
                            styles.itemBar,
                            it.kind === 'event'
                              ? { backgroundColor: it.color }
                              : {
                                  backgroundColor: it.color + '22',
                                  borderLeftWidth: 3,
                                  borderLeftColor: it.color,
                                },
                          ]}
                        >
                          <Text
                            style={[
                              styles.itemBarText,
                              it.kind === 'event'
                                // textPrimary adapts: gray-900 in light, white in dark
                                ? { color: colors.textPrimary }
                                : { color: it.color },
                            ]}
                            numberOfLines={1}
                          >
                            {it.title}
                          </Text>
                        </View>
                      ))}
                      {hidden > 0 && (
                        <Text style={styles.overflowLabel}>+{hidden}</Text>
                      )}
                    </View>
                  );
                })()}

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

      {undoToast && <UndoToast toast={undoToast} />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Cell height: expanded vs the previous 60px default so the Apple-Calendar-
// style colour bars (title + up to 3 of them) have room without crowding
// the day number. Comes out to roughly 6 × 82 = 492 px of grid body.
const CELL_HEIGHT = 82;
const DATE_CIRCLE = 30;

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
  weekRow: {
    flexDirection: 'row',
    height: CELL_HEIGHT,
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
  sundayText: {
    color: colors.accent,
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
  // Build-77 — overflow indicator pill 스타일. 작은 둥근 배경 + bold.
  overflowLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    color: colors.textInverse,
    backgroundColor: colors.textTertiary,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    marginLeft: 2,
    marginTop: 2,
  },
  // Apple-Calendar-style colour bars stacked top→bottom below the day number.
  // Build-77 — gap 1→2 visual breathing.
  barStack: {
    marginTop: 2,
    width: '100%',
    paddingHorizontal: 2,
    gap: 2,
  },
  itemBar: {
    height: 13,
    borderRadius: 2,
    paddingHorizontal: 3,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemBarText: {
    fontSize: 9,
    lineHeight: 11,
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
