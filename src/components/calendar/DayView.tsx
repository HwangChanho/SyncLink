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
 */

import { useRef } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EventSummary } from '@/types';
import { EventBlock } from './EventBlock';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Pixel height per hour in the time grid. */
const HOUR_HEIGHT = 60;
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
  todos?: Array<{ id: string; title: string; color: string }>;
}

/**
 * Single-day time-grid showing all events for one day.
 * Scrolls vertically to cover the full 24 hours.
 */
export function DayView({
  selectedDate: _selectedDate,
  events,
  onEventPress,
  todos,
}: DayViewProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const scrollRef = useRef<ScrollView>(null);
  const layouts = computeLayout(events);

  // Scroll to 8 AM on mount
  const handleLayout = () => {
    scrollRef.current?.scrollTo({ y: HOUR_HEIGHT * 7, animated: false });
  };

  // All-day events (endAt === startAt or allDay flag)
  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = layouts.filter((l) => !l.event.allDay);

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
                  {evt.title}
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

          {/* Event area */}
          <View style={styles.eventsArea}>
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

            {/* Timed event blocks */}
            {timedEvents.map((lay) => (
              <EventBlock
                key={lay.event.id}
                event={lay.event}
                topOffset={lay.topOffset}
                height={lay.height}
                widthFraction={lay.widthFraction}
                leftFraction={lay.leftFraction}
                onPress={onEventPress}
              />
            ))}
          </View>
        </View>

        {/* Empty state for days with no events */}
        {events.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('event.today_list_title')} {t('common.none')}</Text>
          </View>
        )}
      </ScrollView>
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
  eventsArea: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingHorizontal: spacing[1],
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
  });
}
