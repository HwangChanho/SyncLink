/**
 * relativeDate — helpers for "relative-date events" (v1.3).
 *
 * A relative-date event is created from a base date (e.g. an issue date or an
 * order date) plus an N-day offset; its target date is stored as the event's
 * `start_at`. The D-day value (how many calendar days from *today* until the
 * target) is NOT stored — it changes every day — so it is computed lazily
 * here, mirroring the Anniversary `daysFromToday` pattern.
 *
 * All math is done in the device's local timezone, consistent with the rest of
 * the app (no external date library; native Date only).
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Strip the time-of-day → local midnight, so differences are calendar days. */
function atLocalMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Add `days` calendar days to `base`, returning a new local-midnight Date.
 * Used to compute a relative event's target date from (baseDate + offsetDays).
 */
export function addDays(base: Date, days: number): Date {
  const x = atLocalMidnight(base);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Calendar-day difference from today to `target` (local time).
 *   - target today      →  0
 *   - target tomorrow   →  1   (shown as "D-1")
 *   - target yesterday  → -1   (shown as "D+1")
 *
 * @param now - injectable "today" for testing; defaults to the current time.
 */
export function dDayFromToday(target: Date, now: Date = new Date()): number {
  const a = atLocalMidnight(now).getTime();
  const b = atLocalMidnight(target).getTime();
  return Math.round((b - a) / ONE_DAY_MS);
}

/**
 * Format a D-day number as a badge token:
 *   0 → "D-DAY", 3 → "D-3", -2 → "D+2".
 * The token is language-neutral (widely recognised in KR); surrounding labels
 * (e.g. the offset label like "도착예상") come from i18n / user input.
 */
export function formatDDay(dday: number): string {
  if (dday === 0) return 'D-DAY';
  if (dday > 0) return `D-${dday}`;
  return `D+${Math.abs(dday)}`;
}

/** Convenience: compute and format the D-day badge for a target date. */
export function dDayBadge(target: Date, now: Date = new Date()): string {
  return formatDDay(dDayFromToday(target, now));
}
