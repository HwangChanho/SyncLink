/**
 * calendarRange — 캘린더 화면이 selectedDate + viewMode 로부터 fetch 범위 +
 * 다음/이전 navigation 을 계산하는 순수 유틸.
 *
 * Phase 2.1 분할 (calendar.tsx 1,014줄 → ~400줄): 이전엔 같은 파일 안에
 * 인라인이었지만, 시간 grid 의 표시 범위를 계산하는 일은 화면 컴포넌트의
 * 책임이 아니라 도메인 룰이다. 분리하면 단위 테스트가 쉽고 widget /
 * Edge Function 같은 다른 진입점에서도 재사용 가능.
 */

import type { ViewMode } from '@/components/calendar/CalendarHeader';

/** Returns the ISO date key (YYYY-MM-DD) for a Date. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the inclusive date range that should be fetched for the given
 * selectedDate and view mode:
 *  - month → first day of the month's display grid (up to 6 days before)
 *            to the last day of the grid (up to 6 days after)
 *  - week  → Sunday of the week containing selectedDate
 *            to the following Saturday
 *  - day   → just the selectedDate (start=00:00, end=23:59:59)
 */
export function getViewRange(date: Date, mode: ViewMode): { start: Date; end: Date } {
  if (mode === 'month') {
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - firstOfMonth.getDay());
    start.setHours(0, 0, 0, 0);
    const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const end = new Date(lastOfMonth);
    end.setDate(end.getDate() + (6 - lastOfMonth.getDay()));
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (mode === 'week') {
    // Build-70 LEAD: "미리 2주치정도 양사이드로 로드". 주 모드 fetch 범위
    // 를 ±2주 (5주, 35일) 로 확장. WeekView 의 15일 dayWindow 는 그대로
    // 유지하되, 사용자가 좌우 빠르게 swipe 해 다른 주로 진입할 때 events
    // 가 이미 캐시돼 있어 fetch 지연 + re-render 랙이 사라진다.
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay() - 14); // 일요일 기준 -2주
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 34); // 35일 (5주)
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  // day
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Returns a new Date advanced by the appropriate period for the given view mode.
 * Positive `delta` = forward, negative = backward. Month-end overflow is
 * clamped (Jan 31 + 1m → Feb 28/29, never Mar 3).
 */
export function shiftDate(date: Date, mode: ViewMode, delta: 1 | -1): Date {
  const next = new Date(date);
  if (mode === 'month') {
    next.setMonth(next.getMonth() + delta);
    next.setDate(Math.min(
      date.getDate(),
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
    ));
  } else if (mode === 'week') {
    // Build-63 LEAD: "주에서 좌우 이동할 때 한 주씩 넘어가지 않고 하루씩".
    // 7일 단위 jump → 1일 단위 shift. 일간 grid 가 fade-in/slide-in 으로
    // 보이며 주 타이틀도 7일 누적 시점에 다음 주로 자연 갱신.
    next.setDate(next.getDate() + delta);
  } else {
    next.setDate(next.getDate() + delta);
  }
  return next;
}
