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
 * Two-pass algorithm:
 *  1. Sort by start time; on tie, longer events first.
 *  2. Group events into "overlap clusters" — each cluster is a maximal
 *     run of events where every event overlaps at least one neighbour
 *     (transitively). A 9–10am triple-booking and a separate 7–8am
 *     single event live in two different clusters.
 *  3. Within each cluster run a greedy column-assignment: each event
 *     takes the first sub-column whose latest end-time is ≤ its start.
 *  4. widthFraction = 1 / clusterCols, leftFraction = colIdx / clusterCols
 *     **per cluster** so a non-overlapping event isn't squeezed by the
 *     wider neighbour cluster (Build-52 LEAD report: dragging a chip
 *     out of a 3-way pile-up should expand it to the full column).
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

  const out: LayoutEvent[] = [];

  // Buffer for the cluster currently being built. clusterEndMs tracks the
  // furthest end-time seen so the "does this next event still overlap?"
  // check can be done with a single comparison.
  let cluster: EventSummary[] = [];
  let clusterEndMs = 0;

  const flushCluster = (): void => {
    if (cluster.length === 0) return;
    // Greedy column packing within the cluster
    const colEndTimes: number[] = [];
    const assignments: { event: EventSummary; colIndex: number }[] = [];
    for (const evt of cluster) {
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
    for (const { event, colIndex } of assignments) {
      const startHour = event.startAt.getHours() + event.startAt.getMinutes() / 60;
      const endHour   = event.endAt.getHours()   + event.endAt.getMinutes()   / 60;
      const durationHours = Math.max(endHour - startHour, 0.25);
      out.push({
        event,
        topOffset:     startHour * hourHeight,
        height:        durationHours * hourHeight,
        widthFraction: 1 / totalCols,
        leftFraction:  colIndex / totalCols,
      });
    }
    cluster = [];
    clusterEndMs = 0;
  };

  for (const evt of sorted) {
    const startMs = evt.startAt.getTime();
    // Half-open overlap test: a new event extends the cluster only when
    // its start is strictly before the cluster's furthest end (touching
    // edges count as "back to back" not overlap).
    if (cluster.length > 0 && startMs < clusterEndMs) {
      cluster.push(evt);
      clusterEndMs = Math.max(clusterEndMs, evt.endAt.getTime());
    } else {
      flushCluster();
      cluster.push(evt);
      clusterEndMs = evt.endAt.getTime();
    }
  }
  flushCluster();

  return out;
}
