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

import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { useTranslatedTitles } from '@/hooks/useTranslatedTitles';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

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
  /** Called when the user taps a day cell. */
  onDateSelect: (date: Date) => void;
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

      {/* Date rows */}
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
                style={styles.dayCell}
                onPress={() => onDateSelect(date)}
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
                {dayItems.length > 0 && density === 'detailed' && (
                  // LEAD 2026-04-28: 다른 월(leading/trailing) 일정은 연하게.
                  <View style={[styles.barStack, !isCurrentMonth && styles.dimItems]}>
                    {dayItems.slice(0, MAX_BARS).map((it) => (
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
                    {dayItems.length > MAX_BARS && (
                      <Text style={styles.overflowLabel}>
                        +{dayItems.length - MAX_BARS}
                      </Text>
                    )}
                  </View>
                )}

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
  },
  dateCircle: {
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
  overflowLabel: {
    ...textStyles.caption,
    color: colors.textTertiary,
    lineHeight: 12,
  },
  // Apple-Calendar-style colour bars stacked below the day number.
  barStack: {
    marginTop: 2,
    width: '100%',
    paddingHorizontal: 2,
    gap: 1,
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
  });
}
