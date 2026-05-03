/**
 * calendarGeometry — screen-space ↔ calendar-time conversion utilities.
 *
 * Extracted from EventBlock.tsx's inline calculation so that both the
 * legacy PanResponder path (EventBlock) and the Gesture Handler PoC
 * (EventBlockGestureHandler) share a single source of truth.
 *
 * Core responsibility:
 *  Given (dx, dy) screen-space deltas from a drag gesture, the parent
 *  grid's column width (px), and the pixel-per-minute ratio, return:
 *    dayDelta    — integer column shift (negative = earlier in the week)
 *    minuteDelta — minute shift, snapped to SNAP_MINUTES granularity
 *
 * Usage:
 *  import { computeRescheduleDelta } from '@/lib/calendarGeometry';
 *  const { dayDelta, minuteDelta } = computeRescheduleDelta({
 *    dx: gestureState.translationX,
 *    dy: gestureState.translationY,
 *    columnWidth,
 *    slotHeight: PX_PER_MINUTE,
 *    snapMinutes: 30,
 *  });
 *
 * Design notes:
 *  - minuteDelta uses half-open rounding: the drop slot is the 30-min
 *    bucket whose start is closest to the finger position.
 *  - dayDelta clamp is intentionally the caller's responsibility because
 *    WeekView, DayView, and MonthView each have different valid column
 *    ranges (0–6, always 0, and 0–6 but day-level).
 *  - All functions are pure — no imports from stores or services.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default pixel-per-minute ratio matching WeekView / DayView's HOUR_HEIGHT=60.
 * 60 px / 60 min = 1 px/min.
 */
export const DEFAULT_PX_PER_MINUTE = 1;

/**
 * Default snap granularity for minuteDelta.
 * Build-53 → Build-61 — 30 → 15 → 10 분. LEAD 보고: "주랑 일에서 이동이
 * 좀 딱딱한 거 같아 분 단위로도 이동이 됐으면, 기본 10분 단위를 최소로".
 * 작은 snap 일수록 drag 가 부드러워 보임 (한 칸 = 60min / (60/10) = 10min).
 * 기존 calendarGeometry test 들이 이 값에 의존하므로 변경 시 같이 갱신.
 */
export const DEFAULT_SNAP_MINUTES = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

/** View mode determines whether horizontal drag produces a dayDelta. */
export type CalendarViewMode = 'week' | 'day' | 'month';

/** Input parameters for computeRescheduleDelta. */
export interface ComputeRescheduleDeltaOptions {
  /**
   * Horizontal finger delta in screen pixels (from gesture translationX).
   * Positive = right (later day), negative = left (earlier day).
   */
  dx: number;
  /**
   * Vertical finger delta in screen pixels (from gesture translationY).
   * Positive = down (later time), negative = up (earlier time).
   */
  dy: number;
  /**
   * Pixel width of a single day column in the parent grid.
   * For DayView (no horizontal columns) pass 0 — dayDelta will be 0.
   */
  columnWidth: number;
  /**
   * Pixels per minute in the vertical time axis.
   * Defaults to DEFAULT_PX_PER_MINUTE (1 px/min = 60 px/hour).
   */
  pxPerMinute?: number;
  /**
   * Snap granularity for minuteDelta. Defaults to DEFAULT_SNAP_MINUTES (30).
   * Pass 15 for quarter-hour precision if needed (future Day 4/5).
   */
  snapMinutes?: number;
  /**
   * View mode affects whether dayDelta is computed.
   *  'week'  — horizontal drag → dayDelta (primary case)
   *  'month' — horizontal drag → dayDelta (day-level columns)
   *  'day'   — always dayDelta = 0 (single column view)
   * Defaults to 'week'.
   */
  viewMode?: CalendarViewMode;
}

/** Output of computeRescheduleDelta. */
export interface RescheduleDelta {
  /**
   * Whole-number of day columns the event should move.
   * Negative = move to an earlier day, positive = later day.
   * Always 0 for DayView (viewMode === 'day').
   */
  dayDelta: number;
  /**
   * Snapped minute shift for the time axis.
   * Multiple of `snapMinutes` (default 30).
   * May be negative (moving event earlier).
   */
  minuteDelta: number;
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Convert screen-space gesture deltas into calendar time deltas.
 *
 * @param options - Drag geometry parameters (see ComputeRescheduleDeltaOptions)
 * @returns { dayDelta, minuteDelta } — caller applies these to the event's
 *          current startAt / endAt to compute the new scheduled time.
 *
 * @example
 * // WeekView — user dragged 2 columns right, 45 px down
 * computeRescheduleDelta({
 *   dx: 2 * 60, dy: 45, columnWidth: 60
 * })
 * // → { dayDelta: 2, minuteDelta: 60 } (45 px → 45 min → snap 30 → 60 min)
 */
export function computeRescheduleDelta(
  options: ComputeRescheduleDeltaOptions,
): RescheduleDelta {
  const {
    dx,
    dy,
    columnWidth,
    pxPerMinute = DEFAULT_PX_PER_MINUTE,
    snapMinutes = DEFAULT_SNAP_MINUTES,
    viewMode    = 'week',
  } = options;

  // ── Horizontal (day) delta ───────────────────────────────────────────────
  // DayView has no columns; month and week both use column snapping.
  const dayDelta =
    viewMode !== 'day' && columnWidth > 0
      ? Math.round(dx / columnWidth)
      : 0;

  // ── Vertical (time) delta ────────────────────────────────────────────────
  // Convert pixels to raw minutes, then snap to nearest `snapMinutes` bucket.
  // Math.round handles both positive (later) and negative (earlier) values
  // symmetrically: 14 min → 0, 15 min → 30, -14 → 0, -16 → -30 (snap=30).
  const rawMinutes = dy / pxPerMinute;
  const minuteDelta = Math.round(rawMinutes / snapMinutes) * snapMinutes;

  return { dayDelta, minuteDelta };
}

// ─── Time application helpers ─────────────────────────────────────────────────

/**
 * Apply (dayDelta, minuteDelta) to an existing event's startAt and endAt.
 *
 * Returns new Date objects — does NOT mutate inputs.
 * The event duration (endAt - startAt) is preserved exactly so drag only
 * reschedules; it does not resize.
 *
 * @param startAt    - Current event start time
 * @param endAt      - Current event end time
 * @param dayDelta   - Number of days to shift (may be 0)
 * @param minuteDelta- Number of minutes to shift (snapped)
 * @returns { newStartAt, newEndAt } — shifted Date objects
 *
 * @example
 * applyDelta(
 *   new Date('2026-01-12T09:00:00'),
 *   new Date('2026-01-12T10:00:00'),
 *   1, 30,
 * )
 * // → { newStartAt: 2026-01-13T09:30:00, newEndAt: 2026-01-13T10:30:00 }
 */
export function applyDelta(
  startAt: Date,
  endAt: Date,
  dayDelta: number,
  minuteDelta: number,
): { newStartAt: Date; newEndAt: Date } {
  // Total shift in milliseconds
  const shiftMs =
    dayDelta * 24 * 60 * 60_000  // days → ms
    + minuteDelta * 60_000;       // minutes → ms

  return {
    newStartAt: new Date(startAt.getTime() + shiftMs),
    newEndAt:   new Date(endAt.getTime()   + shiftMs),
  };
}

// ─── Drop-target hover geometry ───────────────────────────────────────────────

/**
 * Compute the absolute top offset (px) for a given minute-of-day,
 * using the same formula WeekView uses internally.
 *
 * Useful for positioning the "drop target highlight" overlay:
 *  const snappedTop = minuteOfDayToOffset(snappedHour * 60 + snappedMin);
 *
 * @param minuteOfDay - Minutes since midnight (0–1439)
 * @param pxPerMinute - Pixels per minute (default 1)
 * @returns Absolute pixel offset from the top of the time grid
 */
export function minuteOfDayToOffset(
  minuteOfDay: number,
  pxPerMinute: number = DEFAULT_PX_PER_MINUTE,
): number {
  return minuteOfDay * pxPerMinute;
}

/**
 * Inverse of minuteOfDayToOffset — convert a pixel offset back to
 * minute-of-day, snapped to `snapMinutes` granularity.
 *
 * @param offsetPx   - Pixel position from grid top
 * @param pxPerMinute- Pixels per minute (default 1)
 * @param snapMinutes- Snap granularity (default DEFAULT_SNAP_MINUTES)
 * @returns Snapped minute-of-day (0–1410 for 30-min snap)
 */
export function offsetToSnappedMinuteOfDay(
  offsetPx: number,
  pxPerMinute: number = DEFAULT_PX_PER_MINUTE,
  snapMinutes: number = DEFAULT_SNAP_MINUTES,
): number {
  const rawMinutes = offsetPx / pxPerMinute;
  // Clamp to valid day range [0, 1440 - snapMinutes]
  const maxMinutes = 24 * 60 - snapMinutes;
  const clamped = Math.max(0, Math.min(rawMinutes, maxMinutes));
  return Math.round(clamped / snapMinutes) * snapMinutes;
}
