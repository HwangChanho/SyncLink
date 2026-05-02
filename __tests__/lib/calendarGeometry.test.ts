/**
 * __tests__/lib/calendarGeometry.test.ts
 *
 * Unit tests for src/lib/calendarGeometry.ts (TASK-009 Day 2).
 *
 * Coverage:
 *  1. computeRescheduleDelta — week viewMode (dx/dy → dayDelta/minuteDelta)
 *  2. computeRescheduleDelta — day viewMode (dayDelta always 0)
 *  3. computeRescheduleDelta — month viewMode (same as week for dx)
 *  4. snap boundary: 30-min granularity (edge cases around snap threshold)
 *  5. applyDelta — duration preserved, correct shift
 *  6. minuteOfDayToOffset / offsetToSnappedMinuteOfDay round-trip
 *
 * @task TASK-009 Day 2
 */

import {
  computeRescheduleDelta,
  applyDelta,
  minuteOfDayToOffset,
  offsetToSnappedMinuteOfDay,
  DEFAULT_SNAP_MINUTES,
  DEFAULT_PX_PER_MINUTE,
} from '@/lib/calendarGeometry';

// ─── computeRescheduleDelta ───────────────────────────────────────────────────

describe('computeRescheduleDelta', () => {
  // Column width used in all week-view tests: 60 px per column.
  const COLUMN_WIDTH = 60;

  // ── WeekView (default viewMode) ──────────────────────────────────────────

  describe('viewMode: week (default)', () => {
    it('no movement → dayDelta=0, minuteDelta=0', () => {
      const { dayDelta, minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 0,
        columnWidth: COLUMN_WIDTH,
      });
      expect(dayDelta).toBe(0);
      expect(minuteDelta).toBe(0);
    });

    it('dx = 1 column → dayDelta = 1', () => {
      const { dayDelta } = computeRescheduleDelta({
        dx: COLUMN_WIDTH,
        dy: 0,
        columnWidth: COLUMN_WIDTH,
      });
      expect(dayDelta).toBe(1);
    });

    it('dx = -2 columns → dayDelta = -2 (move back 2 days)', () => {
      const { dayDelta } = computeRescheduleDelta({
        dx: -COLUMN_WIDTH * 2,
        dy: 0,
        columnWidth: COLUMN_WIDTH,
      });
      expect(dayDelta).toBe(-2);
    });

    it('dy = 30 px → minuteDelta = 30 (snap=30, 1 px/min)', () => {
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 30,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(30);
    });

    it('dy = -60 px → minuteDelta = -60 (move event 1h earlier)', () => {
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: -60,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(-60);
    });

    it('dy = 45 px → snaps to 45 (3 × 15-min boundary)', () => {
      // Build-53 — DEFAULT_SNAP_MINUTES is now 15. 45 / 15 = 3 → 3 * 15 = 45
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 45,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(45);
    });

    it('dy = 14 px → snaps to 15 (rounds up to nearest 15-min boundary)', () => {
      // 14 / 15 = 0.933 → Math.round = 1 → 1 * 15 = 15
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 14,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(15);
    });

    it('custom snapMinutes=15: dy=14 → minuteDelta=15', () => {
      // 14 / 15 = 0.933 → Math.round = 1 → 15
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 14,
        columnWidth: COLUMN_WIDTH,
        snapMinutes: 15,
      });
      expect(minuteDelta).toBe(15);
    });

    it('combined dx+dy: dx=1col, dy=30px → dayDelta=1, minuteDelta=30', () => {
      const { dayDelta, minuteDelta } = computeRescheduleDelta({
        dx: COLUMN_WIDTH,
        dy: 30,
        columnWidth: COLUMN_WIDTH,
      });
      expect(dayDelta).toBe(1);
      expect(minuteDelta).toBe(30);
    });
  });

  // ── DayView ──────────────────────────────────────────────────────────────

  describe('viewMode: day', () => {
    it('dayDelta always 0 in day viewMode regardless of dx', () => {
      const { dayDelta } = computeRescheduleDelta({
        dx: 300,
        dy: 0,
        columnWidth: COLUMN_WIDTH,
        viewMode: 'day',
      });
      expect(dayDelta).toBe(0);
    });

    it('minute snapping still works in day viewMode', () => {
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 90,
        columnWidth: COLUMN_WIDTH,
        viewMode: 'day',
      });
      // 90 / 30 = 3 → 3 * 30 = 90
      expect(minuteDelta).toBe(90);
    });
  });

  // ── MonthView ─────────────────────────────────────────────────────────────

  describe('viewMode: month', () => {
    it('horizontal drag produces dayDelta (same as week)', () => {
      const { dayDelta } = computeRescheduleDelta({
        dx: COLUMN_WIDTH * 3,
        dy: 0,
        columnWidth: COLUMN_WIDTH,
        viewMode: 'month',
      });
      expect(dayDelta).toBe(3);
    });
  });

  // ── columnWidth = 0 edge case (DayView fallback) ─────────────────────────

  describe('edge case: columnWidth = 0', () => {
    it('columnWidth=0 → dayDelta=0 to avoid division-by-zero', () => {
      const { dayDelta } = computeRescheduleDelta({
        dx: 100,
        dy: 0,
        columnWidth: 0,
        viewMode: 'week',
      });
      // Guard in computeRescheduleDelta: columnWidth > 0 check
      expect(dayDelta).toBe(0);
    });

    it('negative columnWidth defensively yields dayDelta=0', () => {
      // The columnWidth > 0 guard also catches a corrupted layout where the
      // measurement returned a negative number. Without this we'd be dividing
      // by a negative and producing nonsense day deltas.
      const { dayDelta } = computeRescheduleDelta({
        dx: 100,
        dy: 0,
        columnWidth: -50,
        viewMode: 'week',
      });
      expect(dayDelta).toBe(0);
    });
  });

  // ── Snap boundary at exactly half a snap step ────────────────────────────

  describe('exact snap boundaries', () => {
    it('dy = 15 lands exactly on the 15-min snap boundary', () => {
      // Build-53 — default snap is now 15. 15/15 = 1 → 1 * 15 = 15.
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 15,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(15);
    });

    it('dy = -15 with default 15-min snap rounds to -15 (one slot back)', () => {
      // -15 / 15 = -1 exactly → no half-rounding edge case.
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: -15,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBeCloseTo(-15);
    });
  });
});

// ─── applyDelta: cross-midnight from minuteDelta alone ───────────────────────

describe('applyDelta — cross-midnight via minuteDelta', () => {
  it('23:30→00:30 next day via minuteDelta=+60 only', () => {
    const startAt = new Date(2026, 0, 12, 23, 30, 0, 0); // Mon Jan 12 23:30
    const endAt   = new Date(2026, 0, 13,  0, 30, 0, 0); // Tue Jan 13 00:30
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 0, 60);
    // Should land at 00:30 Jan 13 → 01:30 Jan 13
    expect(newStartAt.getDate()).toBe(13);
    expect(newStartAt.getHours()).toBe(0);
    expect(newStartAt.getMinutes()).toBe(30);
    expect(newEndAt.getDate()).toBe(13);
    expect(newEndAt.getHours()).toBe(1);
    expect(newEndAt.getMinutes()).toBe(30);
  });

  it('00:30→23:30 previous day via minuteDelta=-60', () => {
    const startAt = new Date(2026, 0, 13,  0, 30, 0, 0); // Tue Jan 13 00:30
    const endAt   = new Date(2026, 0, 13,  1, 30, 0, 0); // Tue Jan 13 01:30
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 0, -60);
    expect(newStartAt.getDate()).toBe(12);
    expect(newStartAt.getHours()).toBe(23);
    expect(newStartAt.getMinutes()).toBe(30);
    expect(newEndAt.getDate()).toBe(13);
    expect(newEndAt.getHours()).toBe(0);
    expect(newEndAt.getMinutes()).toBe(30);
  });
});

// ─── applyDelta ───────────────────────────────────────────────────────────────

describe('applyDelta', () => {
  /** Base event: Mon Jan 12 2026, 09:00–10:00 local */
  const startAt = new Date(2026, 0, 12, 9, 0, 0, 0);
  const endAt   = new Date(2026, 0, 12, 10, 0, 0, 0);
  const DURATION_MS = endAt.getTime() - startAt.getTime(); // 3_600_000 ms = 1h

  it('no shift → returns copies equal to originals', () => {
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 0, 0);
    expect(newStartAt.getTime()).toBe(startAt.getTime());
    expect(newEndAt.getTime()).toBe(endAt.getTime());
  });

  it('does not mutate the input Date objects', () => {
    const s = new Date(startAt);
    const e = new Date(endAt);
    applyDelta(s, e, 1, 30);
    // Originals should be unchanged
    expect(s.getTime()).toBe(startAt.getTime());
    expect(e.getTime()).toBe(endAt.getTime());
  });

  it('duration preserved after shift (endAt - startAt = 1h)', () => {
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 2, 30);
    expect(newEndAt.getTime() - newStartAt.getTime()).toBe(DURATION_MS);
  });

  it('dayDelta=1, minuteDelta=0 → shifts start+end by exactly 1 day', () => {
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 1, 0);
    expect(newStartAt.getDate()).toBe(13); // Jan 13
    expect(newEndAt.getDate()).toBe(13);
    expect(newStartAt.getHours()).toBe(9);
    expect(newEndAt.getHours()).toBe(10);
  });

  it('dayDelta=0, minuteDelta=30 → start 09:30, end 10:30', () => {
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 0, 30);
    expect(newStartAt.getHours()).toBe(9);
    expect(newStartAt.getMinutes()).toBe(30);
    expect(newEndAt.getHours()).toBe(10);
    expect(newEndAt.getMinutes()).toBe(30);
  });

  it('negative minuteDelta: minuteDelta=-30 → start 08:30, end 09:30', () => {
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 0, -30);
    expect(newStartAt.getHours()).toBe(8);
    expect(newStartAt.getMinutes()).toBe(30);
    expect(newEndAt.getHours()).toBe(9);
    expect(newEndAt.getMinutes()).toBe(30);
  });

  it('cross-midnight shift: dayDelta=1, minuteDelta=-60 → Jan 13 08:00–09:00', () => {
    const { newStartAt, newEndAt } = applyDelta(startAt, endAt, 1, -60);
    expect(newStartAt.getDate()).toBe(13);
    expect(newStartAt.getHours()).toBe(8);
    expect(newEndAt.getDate()).toBe(13);
    expect(newEndAt.getHours()).toBe(9);
  });
});

// ─── minuteOfDayToOffset / offsetToSnappedMinuteOfDay ────────────────────────

describe('minuteOfDayToOffset', () => {
  it('midnight (0 min) → offset 0', () => {
    expect(minuteOfDayToOffset(0)).toBe(0);
  });

  it('9 AM (540 min) → offset 540 (default 1 px/min)', () => {
    expect(minuteOfDayToOffset(9 * 60)).toBe(540);
  });

  it('custom pxPerMinute=2: 60 min → 120 px', () => {
    expect(minuteOfDayToOffset(60, 2)).toBe(120);
  });
});

describe('offsetToSnappedMinuteOfDay', () => {
  it('0 px → 0 min', () => {
    expect(offsetToSnappedMinuteOfDay(0)).toBe(0);
  });

  it('540 px → 540 min (09:00, default 1 px/min, snap 30)', () => {
    expect(offsetToSnappedMinuteOfDay(540)).toBe(540);
  });

  it('545 px → snaps to 540 (closer to 540 than 570)', () => {
    // 545 / 30 = 18.167 → round = 18 → 18 * 30 = 540
    expect(offsetToSnappedMinuteOfDay(545)).toBe(540);
  });

  it('555 px → snaps to 555 (already on a 15-min boundary)', () => {
    // Build-53 — default snap is 15. 555 / 15 = 37 → 37 * 15 = 555.
    expect(offsetToSnappedMinuteOfDay(555)).toBe(555);
  });

  it('clamps to maxMinutes (1425 for snap=15): very large offset stays in range', () => {
    // 9999 px (far beyond 24h) → max valid minute = 1440 - 15 = 1425 (23:45).
    expect(offsetToSnappedMinuteOfDay(9999)).toBe(1425);
  });

  it('negative offset → clamps to 0', () => {
    expect(offsetToSnappedMinuteOfDay(-50)).toBe(0);
  });

  it('round-trip: minuteOfDayToOffset → offsetToSnappedMinuteOfDay = original', () => {
    const original = 9 * 60; // 540 (already on snap boundary)
    const offset = minuteOfDayToOffset(original, DEFAULT_PX_PER_MINUTE);
    const recovered = offsetToSnappedMinuteOfDay(
      offset,
      DEFAULT_PX_PER_MINUTE,
      DEFAULT_SNAP_MINUTES,
    );
    expect(recovered).toBe(original);
  });
});
