/**
 * guestDemoData — illustrative example events shown to a browsing guest
 * (no account) so the Home and Calendar tabs look alive instead of empty,
 * nudging sign-up. Part A of the 2026-06-04 guest-entry plan.
 *
 * Consumed by eventStore.fetchEvents, which short-circuits to this data when
 * the user is unauthenticated (the server would return [] under RLS anyway).
 * Titles are localized via the i18next singleton (no React context here);
 * times are relative to "today" so the demo always lands on the current week.
 */

import type { EventSummary } from '@/types';
import type { Todo } from '@/types/todo';
import { toDateKey } from '@/lib/calendarRange';
import i18n from '@/lib/i18n';

/**
 * Build a Date at `dayOffset` days from today, at the given local h:m.
 * @param dayOffset  0 = today, 1 = tomorrow, …
 * @param hour       local hour (0–23)
 * @param minute     local minute (default 0)
 */
function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Returns a fresh demo event set grouped by local YYYY-MM-DD key, matching
 * the shape eventStore.eventsByDate expects. Rebuilt on each call so the
 * events stay anchored to the current day (cheap; a handful of objects).
 */
export function buildGuestDemoEventsByDate(): Record<string, EventSummary[]> {
  // Short helper to pull a localized demo string.
  const tr = (key: string): string => i18n.t(`auth.guest.${key}`);

  // 데모 일정 색.
  //
  // 🔑 **앱을 처음 연 사람이 가장 먼저 보는 색**이라 첫인상을 여기서 거의 다 결정한다.
  // 2026-09-20 톤 개편: Tailwind 500 계열 원색(#6366F1·#EC4899·#10B981·#8B5CF6·#F59E0B)
  // 을 카테고리와 같은 채도 대역으로 낮췄다. 색상(hue)은 그대로라 여전히 서로
  // 구분되지만, 다섯 개가 한 화면에 떠도 서로 싸우지 않는다.
  // 하드코딩 hex 를 쓰는 건 여기선 괜찮다 — 예시 데이터이지 테마를 타는 UI 가 아니다.
  const events: EventSummary[] = [
    {
      id: 'guest-demo-meeting',
      title: tr('demo_meeting'),
      startAt: at(0, 9, 0),
      endAt: at(0, 10, 0),
      allDay: false,
      color: '#6366C9', // 인디고
      isOwn: true,
      eventKind: 'general',
    },
    {
      id: 'guest-demo-dinner',
      title: tr('demo_dinner'),
      startAt: at(0, 19, 30),
      endAt: at(0, 21, 0),
      allDay: false,
      color: '#C9708A', // 로즈
      isOwn: true,
      eventKind: 'general',
    },
    {
      id: 'guest-demo-workout',
      title: tr('demo_workout'),
      startAt: at(1, 7, 0),
      endAt: at(1, 8, 0),
      allDay: false,
      color: '#5B9670', // 세이지
      isOwn: true,
      eventKind: 'workout',
    },
    {
      id: 'guest-demo-birthday',
      title: tr('demo_birthday'),
      startAt: at(2, 0, 0),
      endAt: at(2, 23, 59),
      allDay: true,
      color: '#94679F', // 퍼플
      isOwn: true,
      eventKind: 'general',
    },
    {
      id: 'guest-demo-movie',
      title: tr('demo_movie'),
      startAt: at(3, 14, 0),
      endAt: at(3, 15, 30),
      allDay: false,
      color: '#C98A52', // 앰버
      isOwn: true,
      eventKind: 'general',
    },
  ];

  const byDate: Record<string, EventSummary[]> = {};
  for (const e of events) {
    (byDate[toDateKey(e.startAt)] ??= []).push(e);
  }
  return byDate;
}

/**
 * Demo todos for a browsing guest, mirroring buildGuestDemoEventsByDate.
 *
 * Why todos need demo data too: Home renders an "오늘 할일" section, and a guest
 * with events but no todos sees it empty. That reads as a missing feature rather
 * than an empty state — and it undercuts the product's todo half, which is now
 * the lead in the brand name.
 *
 * Dates are relative to today so the list never goes stale:
 *   - two due today (one of them the one an overdue-free list needs)
 *   - one overdue by a day, so the overdue styling is visible
 *
 * Nothing here is written to the server; the store swaps this in when the user
 * is unauthenticated, exactly as eventStore does.
 */
export function buildGuestDemoTodos(): Todo[] {
  const tr = (key: string): string => i18n.t(`auth.guest.${key}`);

  /** Midnight-anchored date `dayOffset` days from today. */
  const day = (dayOffset: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const base = {
    userId:      '',
    spaceId:     null,
    content:     null,
    contentType: 'todo' as const,
    dueAt:       null,
    isCompleted: false,
    completedAt: null,
    categoryId:  null,
    eventId:     null,
    createdAt:   new Date(),
    updatedAt:   new Date(),
  };

  return [
    {
      ...base,
      id: 'guest-demo-todo-report',
      title: tr('demo_todo_report'),
      dueDate: day(-1),          // overdue — shows the red/overdue treatment
      priority: 'high' as const,
      sortOrder: 0,
    },
    {
      ...base,
      id: 'guest-demo-todo-groceries',
      title: tr('demo_todo_groceries'),
      dueDate: day(0),
      priority: 'medium' as const,
      sortOrder: 1,
    },
    {
      ...base,
      id: 'guest-demo-todo-call',
      title: tr('demo_todo_call'),
      dueDate: day(0),
      priority: 'low' as const,
      sortOrder: 2,
    },
  ];
}
