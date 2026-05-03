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
  computeTodoDropTarget,
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
      // Build-61 — DEFAULT_SNAP_MINUTES 15→10 → 45 분 (1px=1min, 45/10=4.5→round 5×10=50)
      expect(minuteDelta).toBe(50);
    });

    it('dy = 14 px → snaps to 10 (DEFAULT_SNAP_MINUTES=10)', () => {
      // Build-61 — 14 / 10 = 1.4 → Math.round = 1 → 1 * 10 = 10
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 14,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(10);
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
    it('dy = 20 lands exactly on the 10-min × 2 snap boundary', () => {
      // Build-61 — DEFAULT_SNAP_MINUTES 15→10. 20/10 = 2 → 2 * 10 = 20.
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: 20,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBe(20);
    });

    it('dy = -10 with default 10-min snap rounds to -10 (one slot back)', () => {
      // Build-61 — -10/10 = -1 exactly.
      const { minuteDelta } = computeRescheduleDelta({
        dx: 0,
        dy: -10,
        columnWidth: COLUMN_WIDTH,
      });
      expect(minuteDelta).toBeCloseTo(-10);
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

  it('545 px → snaps to 550 (Build-61 snap=10: 545/10=54.5→round 55×10)', () => {
    expect(offsetToSnappedMinuteOfDay(545)).toBe(550);
  });

  it('555 px → snaps to 560 (closer to 560 than 550 with snap=10)', () => {
    // Build-61 — DEFAULT_SNAP_MINUTES 15→10. 555/10 = 55.5 → round 56×10 = 560.
    expect(offsetToSnappedMinuteOfDay(555)).toBe(560);
  });

  it('clamps to maxMinutes (1430 for snap=10): very large offset stays in range', () => {
    // Build-61 — max valid minute = 1440 - 10 = 1430 (23:50).
    expect(offsetToSnappedMinuteOfDay(9999)).toBe(1430);
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

// ─── computeTodoDropTarget (Build-66) ─────────────────────────────────────────

describe('computeTodoDropTarget', () => {
  // 7-day week, 컬럼 너비 50px, hourHeight=60 (default 1px/min), snap 30분.
  const baseDay = (idx: number) => {
    // 2026-05-04 (Mon) 시작 + idx 일.
    const d = new Date(2026, 4, 4 + idx);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const weekDays = Array.from({ length: 7 }, (_, i) => baseDay(i));

  const baseArgs = {
    eventsAreaPageX: 100,
    eventsAreaPageY: 200,
    columnWidth: 50,
    weekDays,
    hourHeight: 60,
    // useTodoDragHandler 의 기본값과 동일 — 30분 snap.
    snapMinutes: 30,
  };

  it('grid 영역 밖 (왼쪽) → null', () => {
    expect(computeTodoDropTarget({
      ...baseArgs,
      pageX: 50, pageY: 300,
    })).toBeNull();
  });

  it('grid 영역 밖 (위쪽) → null', () => {
    expect(computeTodoDropTarget({
      ...baseArgs,
      pageX: 150, pageY: 100,
    })).toBeNull();
  });

  it('grid 영역 밖 (오른쪽 — 7컬럼 너머) → null', () => {
    // 7 * 50 = 350 px 너비. localX = 360 → null.
    expect(computeTodoDropTarget({
      ...baseArgs,
      pageX: 100 + 360, pageY: 300,
    })).toBeNull();
  });

  it('첫 컬럼 09:00 정확히 떨어뜨림', () => {
    // localX = 25 (col 0), localY = 540 (9시간 * 60px) → 09:00.
    const result = computeTodoDropTarget({
      ...baseArgs,
      pageX: 100 + 25,
      pageY: 200 + 540,
    });
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    // Day = baseDay(0).
    expect(result!.getDate()).toBe(weekDays[0]!.getDate());
  });

  it('세 번째 컬럼 14:30 정확히 떨어뜨림', () => {
    // localX = 50*2 + 25 = 125 (col 2), localY = 14.5*60 = 870.
    const result = computeTodoDropTarget({
      ...baseArgs,
      pageX: 100 + 125,
      pageY: 200 + 870,
    });
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(14);
    expect(result!.getMinutes()).toBe(30);
    expect(result!.getDate()).toBe(weekDays[2]!.getDate());
  });

  it('30분 snap — 14:14 입력은 14:00 으로 (round)', () => {
    // 14*60 + 14 = 854 → /30 = 28.466 → round 28 → 840 = 14:00.
    const result = computeTodoDropTarget({
      ...baseArgs,
      pageX: 100 + 25,
      pageY: 200 + 854,
    });
    expect(result!.getHours()).toBe(14);
    expect(result!.getMinutes()).toBe(0);
  });

  it('30분 snap — 14:16 입력은 14:30 으로 (round up)', () => {
    // 14*60 + 16 = 856 → /30 = 28.533 → round 29 → 870 = 14:30.
    const result = computeTodoDropTarget({
      ...baseArgs,
      pageX: 100 + 25,
      pageY: 200 + 856,
    });
    expect(result!.getHours()).toBe(14);
    expect(result!.getMinutes()).toBe(30);
  });

  it('자정 직전 clamp — Y 가 매우 크면 23:30 으로', () => {
    const result = computeTodoDropTarget({
      ...baseArgs,
      pageX: 100 + 25,
      pageY: 200 + 99999,
    });
    expect(result!.getHours()).toBe(23);
    expect(result!.getMinutes()).toBe(30);
  });

  it('단일 컬럼 (DayView 시나리오) — 컬럼 인덱스 항상 0', () => {
    const single = [weekDays[3]!];
    const result = computeTodoDropTarget({
      ...baseArgs,
      weekDays: single,
      columnWidth: 350, // 전체 너비 = 한 컬럼.
      pageX: 100 + 200, // 컬럼 안 어디든 OK.
      pageY: 200 + 480, // 8시간.
    });
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(8);
    expect(result!.getDate()).toBe(weekDays[3]!.getDate());
  });

  it('columnWidth=0 (측정 전) → null (무효 drop)', () => {
    expect(computeTodoDropTarget({
      ...baseArgs,
      columnWidth: 0,
      pageX: 150, pageY: 300,
    })).toBeNull();
  });

  it('빈 weekDays → null', () => {
    expect(computeTodoDropTarget({
      ...baseArgs,
      weekDays: [],
      pageX: 150, pageY: 300,
    })).toBeNull();
  });
});
