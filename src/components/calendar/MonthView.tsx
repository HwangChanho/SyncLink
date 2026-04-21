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
import { EventDot } from './EventDot';
import { useColors } from '@/hooks/useColors';
import { spacing, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Maximum colored dots to show per day cell before showing "+N". */
const MAX_DOTS = 3;

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

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

                {/* Event dot strip */}
                {dayEvents.length > 0 && (
                  <View style={styles.dotRow}>
                    {dayEvents.slice(0, MAX_DOTS).map((evt) => (
                      <EventDot key={evt.id} color={evt.color} />
                    ))}
                    {dayEvents.length > MAX_DOTS && (
                      <Text style={styles.overflowLabel}>
                        +{dayEvents.length - MAX_DOTS}
                      </Text>
                    )}
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

const CELL_HEIGHT = componentHeight.calendarCell; // 60px
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
    color: colors.textTertiary,
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
    marginLeft: 1,
    lineHeight: 8,
  },
  });
}
