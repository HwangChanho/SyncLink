/**
 * Unit tests for lib/relativeDate (v1.3 — relative-date events).
 *
 * Covers the pure date math used by the relative-date scheduling feature:
 * adding a day offset, computing the calendar-day D-day from "today", and
 * formatting the D-day badge token. All math is local-time / calendar-day
 * based, so a fixed `now` is injected to keep results deterministic.
 */
import { addDays, dDayFromToday, formatDDay, dDayBadge } from '@/lib/relativeDate';

describe('relativeDate', () => {
  describe('addDays', () => {
    it('adds N calendar days at local midnight', () => {
      const base = new Date(2026, 5, 13, 14, 30); // 2026-06-13 14:30 local
      const out = addDays(base, 7);
      expect(out.getFullYear()).toBe(2026);
      expect(out.getMonth()).toBe(5); // June
      expect(out.getDate()).toBe(20);
      // time-of-day stripped to midnight
      expect(out.getHours()).toBe(0);
      expect(out.getMinutes()).toBe(0);
    });

    it('rolls over month boundaries', () => {
      const base = new Date(2026, 5, 28); // 2026-06-28
      const out = addDays(base, 5);
      expect(out.getMonth()).toBe(6); // July
      expect(out.getDate()).toBe(3);
    });

    it('offset 0 returns the same calendar day', () => {
      const base = new Date(2026, 5, 13, 9, 0);
      expect(addDays(base, 0).getDate()).toBe(13);
    });
  });

  describe('dDayFromToday', () => {
    const now = new Date(2026, 5, 13, 8, 0); // 2026-06-13 08:00 local

    it('returns 0 for today (ignoring time-of-day)', () => {
      expect(dDayFromToday(new Date(2026, 5, 13, 23, 59), now)).toBe(0);
    });

    it('returns positive days for a future target', () => {
      expect(dDayFromToday(new Date(2026, 5, 20), now)).toBe(7);
    });

    it('returns negative days for a past target', () => {
      expect(dDayFromToday(new Date(2026, 5, 11), now)).toBe(-2);
    });
  });

  describe('formatDDay', () => {
    it('formats today as D-DAY', () => {
      expect(formatDDay(0)).toBe('D-DAY');
    });
    it('formats future as D-N', () => {
      expect(formatDDay(3)).toBe('D-3');
    });
    it('formats past as D+N', () => {
      expect(formatDDay(-2)).toBe('D+2');
    });
  });

  describe('dDayBadge', () => {
    it('composes dDayFromToday + formatDDay', () => {
      const now = new Date(2026, 5, 13);
      expect(dDayBadge(new Date(2026, 5, 16), now)).toBe('D-3');
    });
  });
});
