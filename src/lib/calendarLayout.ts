/**
 * calendarLayout — shared overlap layout for time-grid event chips.
 *
 * Both WeekView and DayView render events on a vertical time axis where
 * overlapping events get split into side-by-side sub-columns. The greedy
 * algorithm here is the canonical implementation; the views just consume
 * the resulting LayoutEvent[] and place absolutely-positioned chips.
 *
 * Extracted from WeekView/DayView during Phase 1.2 of the v1.0
 * stabilization plan (the two files had byte-for-byte duplicate copies).
 */

import type { EventSummary } from '@/types';

/**
 * One laid-out event. Coordinates are in pixels (top, height) and unit
 * fractions (width, left) relative to the day column.
 */
export interface LayoutEvent {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction: number;
  leftFraction: number;
}

/**
 * Compute positions for events within a single day column.
 *
 * Greedy algorithm:
 *  1. Sort by start time; on tie, longer events first.
 *  2. Maintain a list of "active sub-columns", each tracking its latest
 *     end time. Assign each event to the first column whose latest end
 *     ≤ event start, otherwise open a new column.
 *  3. Width fraction = 1 / totalColumns, left fraction = colIndex / totalColumns.
 *
 * @param events     Events to lay out (typically already filtered to one day).
 * @param hourHeight Pixel height for one hour of the time grid (60 in WeekView/DayView).
 */
export function computeEventLayout(
  events: EventSummary[],
  hourHeight: number,
): LayoutEvent[] {
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
      topOffset: startHour * hourHeight,
      height: durationHours * hourHeight,
      widthFraction: 1 / totalCols,
      leftFraction: colIndex / totalCols,
    };
  });
}
