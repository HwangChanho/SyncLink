/**
 * Recurrence expansion — events 의 repeat_type / repeat_weekdays 메타데이터를
 * 기반으로 지정된 date range 내의 모든 occurrence 를 생성.
 *
 * 호출 위치: eventStore.fetchEvents (getEventsInRange 직후) — server 가 반환한
 * "원본" row 를 expand 해 캘린더 cell 에 매일 표시.
 *
 * 지원 repeat_type:
 *  - 'none': occurrence 1개 (그대로 반환)
 *  - 'daily': 매일
 *  - 'weekly': 매 7일 (start_at 의 요일에)
 *  - 'custom_weekly': repeat_weekdays 배열 (0=일 ~ 6=토) 의 각 요일
 *  - 'monthly': 매월 같은 일자
 *  - 'yearly': 매년 같은 월/일
 *
 * 안전 한도: 한 event 당 최대 366 occurrence (큰 range 에서 무한 loop 방어).
 */

import type { EventSummary } from '@/types';

interface ExpandableEvent extends EventSummary {
  /** repeat_type 컬럼 (eventService.toEventSummary 가 매핑). */
  repeatType?: string | null;
  /** custom_weekly 일 때 0~6 요일 배열. */
  repeatWeekdays?: number[] | null;
  /** repeat_until — 이 날짜 이후엔 더 이상 occurrence 생성 안 함. */
  repeatUntil?: Date | null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OCCURRENCES = 366;

/**
 * 한 event 를 [rangeStart, rangeEnd] 안의 occurrence array 로 펼친다.
 * 반복 없는 event 는 그대로 1개. range 와 안 겹치면 빈 배열.
 */
export function expandRecurrence(
  event: ExpandableEvent,
  rangeStart: Date,
  rangeEnd: Date,
): EventSummary[] {
  const rt = event.repeatType ?? 'none';
  if (rt === 'none' || !rt) {
    // 원본만 — range 와 안 겹치면 caller 가 거른다.
    return [event];
  }

  const originalStart = new Date(event.startAt);
  const originalEnd = new Date(event.endAt);
  const durationMs = originalEnd.getTime() - originalStart.getTime();
  const until = event.repeatUntil ? new Date(event.repeatUntil) : null;

  const results: EventSummary[] = [];

  // helper: occurrence push (range / until / safety cap 검증)
  const pushOccurrence = (occStart: Date): boolean => {
    if (until && occStart > until) return false;
    if (occStart > rangeEnd) return false;
    const occEnd = new Date(occStart.getTime() + durationMs);
    // range 와 겹치는지 (occurrence 전체가 range.start 이전이면 skip)
    if (occEnd < rangeStart) return true; // 계속 진행
    results.push({
      ...event,
      // 같은 id 를 그대로 두면 캘린더 cell 안에 동일 id 가 여러 번 등장.
      // dedup 시 같은 occurrence 로 합쳐버려서 잘못된 동작 우려가 있어 가짜
      // suffix 부여 — react key / store 의 upsertEvent 와는 별개로 캘린더
      // grid 에서만 노출되는 ephemeral expansion 값이라 안전.
      id: `${event.id}::${occStart.toISOString().slice(0, 10)}`,
      startAt: occStart,
      endAt: occEnd,
    });
    return true;
  };

  if (rt === 'daily') {
    const cursor = new Date(originalStart);
    let i = 0;
    while (i < MAX_OCCURRENCES) {
      if (!pushOccurrence(new Date(cursor))) break;
      cursor.setTime(cursor.getTime() + ONE_DAY_MS);
      i += 1;
    }
    return results;
  }

  if (rt === 'weekly') {
    // 같은 요일에 매 7일
    const cursor = new Date(originalStart);
    let i = 0;
    while (i < MAX_OCCURRENCES) {
      if (!pushOccurrence(new Date(cursor))) break;
      cursor.setTime(cursor.getTime() + 7 * ONE_DAY_MS);
      i += 1;
    }
    return results;
  }

  if (rt === 'custom_weekly') {
    const days = Array.isArray(event.repeatWeekdays) ? event.repeatWeekdays : [];
    if (days.length === 0) {
      // weeklyDays 없으면 weekly 처럼 fallback (DB 회귀 방지).
      return expandRecurrence({ ...event, repeatType: 'weekly' }, rangeStart, rangeEnd);
    }
    // range 의 각 날짜를 순회하며 요일이 days 에 포함되면 occurrence 생성.
    // 단 originalStart 이전 occurrence 는 만들지 않는다 (recurrence 시작 전).
    const dayCursor = new Date(Math.max(originalStart.getTime(), rangeStart.getTime()));
    dayCursor.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
    let i = 0;
    while (i < MAX_OCCURRENCES && dayCursor <= rangeEnd) {
      if (days.includes(dayCursor.getDay())) {
        if (!pushOccurrence(new Date(dayCursor))) break;
      }
      dayCursor.setTime(dayCursor.getTime() + ONE_DAY_MS);
      i += 1;
    }
    return results;
  }

  if (rt === 'monthly') {
    const cursor = new Date(originalStart);
    let i = 0;
    while (i < MAX_OCCURRENCES) {
      if (!pushOccurrence(new Date(cursor))) break;
      cursor.setMonth(cursor.getMonth() + 1);
      i += 1;
    }
    return results;
  }

  if (rt === 'yearly') {
    const cursor = new Date(originalStart);
    let i = 0;
    while (i < MAX_OCCURRENCES) {
      if (!pushOccurrence(new Date(cursor))) break;
      cursor.setFullYear(cursor.getFullYear() + 1);
      i += 1;
    }
    return results;
  }

  // unknown repeat_type — 원본만 반환 (안전 default).
  return [event];
}
