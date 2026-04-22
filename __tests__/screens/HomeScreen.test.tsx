/**
 * __tests__/screens/HomeScreen.test.tsx
 *
 * TASK-412: Home 화면 통합 테스트
 *
 * 전략:
 *  - useEventStore, useTodoStore, useAuthStore를 전체 mock
 *    → 컴포넌트의 네트워크 의존성 차단
 *  - eventRealtimeService를 mock → SpaceActivityFeed의 realtime 구독 차단
 *  - react-native-safe-area-context mock (sprint0.navigation.test.tsx 패턴)
 *  - 각 섹션(TodayEventList, TodayTodoList, SpaceActivityFeed)의
 *    렌더링 여부를 섹션 헤더 텍스트로 검증
 *
 * 커버리지:
 *  - 마운트 시 fetchEvents + fetchTodos 호출 (오늘 날짜 범위)
 *  - TodayEventList 렌더링 — "📅 오늘 일정" 헤더 표시
 *  - TodayTodoList 렌더링 — "✅ 오늘 할일" 헤더 표시
 *  - 오늘 일정 없음 상태 — "오늘 일정이 없습니다"
 *  - 오늘 할일 없음 상태 — "오늘 마감 할일이 없습니다"
 *  - 오늘 일정 있음 상태 — 이벤트 제목 렌더링
 *  - 오늘 할일 있음 상태 — 할일 제목 렌더링
 *  - eventStore / todoStore mock 처리
 *
 * @task TASK-412
 */

// ─── Mock 선언 (jest.mock은 hoisted되므로 import 전에 위치) ──────────────────

jest.mock('@/stores/eventStore', () => ({
  useEventStore: jest.fn(),
}));

jest.mock('@/stores/todoStore', () => ({
  useTodoStore: jest.fn(),
}));

jest.mock('@/stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/stores/spaceStore', () => ({
  useSpaceStore: jest.fn(),
}));

// SpaceActivityFeed의 realtime 구독 차단
jest.mock('@/services/eventRealtimeService', () => ({
  subscribeToSharedEvents: jest.fn(() => jest.fn()), // cleanup 함수 반환
}));

// NLInputBar의 AI 서비스 의존성 차단
jest.mock('@/services/aiService', () => ({
  parseNaturalLanguage: jest.fn(),
  hasRemainingDailyLimit: jest.fn().mockResolvedValue(true),
}));

// Sprint 9 컴포넌트 mock — HomeScreen 테스트 범위 밖, 자체 의존성(네이티브 API, 스토어)을 차단
jest.mock('@/components/home/WeatherWidget',     () => ({ WeatherWidget:     () => null }));
jest.mock('@/components/home/WeeklyReviewCard',  () => ({ WeeklyReviewCard:  () => null }));
jest.mock('@/components/home/DateSuggestionCard',() => ({ DateSuggestionCard:() => null }));

// SafeAreaView mock
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  return {
    SafeAreaView: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    SafeAreaProvider: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render } from '@testing-library/react-native';
import { useEventStore } from '@/stores/eventStore';
import { useTodoStore } from '@/stores/todoStore';
import { useAuthStore } from '@/stores/authStore';
import HomeScreen from '@/app/(tabs)/index';
import type { Todo, EventSummary } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const TODAY_KEY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** 오늘 정오 시각 */
function todayNoon(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

/** 오늘 일정 픽스처 */
const mockEvent: EventSummary = {
  id:          'event-1',
  title:       '팀 미팅',
  startAt:     todayNoon(),
  endAt:       new Date(todayNoon().getTime() + 3600_000),
  allDay:      false,
  color:       '#4A90E2',
  isOwn:       true,
  isShared:    false,
};

/** 오늘 할일 픽스처 */
const mockTodo: Todo = {
  id:          'todo-1',
  userId:      'user-123',
  spaceId:     null,
  title:       '오늘 할일 항목',
  content:     null,
  contentType: 'todo',
  dueDate:     todayNoon(),
  priority:    'medium',
  isCompleted: false,
  completedAt: null,
  categoryId:  null,
  sortOrder:   0,
  eventId:     null,
  createdAt:   new Date(),
  updatedAt:   new Date(),
};

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * useEventStore mock 설정.
 * selector 패턴과 direct call 패턴 모두 지원.
 */
function mockEventStore(overrides: {
  fetchEvents?: jest.Mock;
  isFetching?: boolean;
  eventsByDate?: Record<string, EventSummary[]>;
}) {
  const state = {
    fetchEvents:  jest.fn(),
    isFetching:   false,
    eventsByDate: {},
    ...overrides,
  };

  (useEventStore as jest.Mock).mockImplementation(
    (selector?: (s: typeof state) => unknown) => selector ? selector(state) : state
  );
}

/**
 * useTodoStore mock 설정.
 * destructuring 패턴 지원.
 */
function mockTodoStore(overrides: {
  fetchTodos?: jest.Mock;
  isLoading?: boolean;
  todos?: Todo[];
}) {
  (useTodoStore as jest.Mock).mockReturnValue({
    todos:       [],
    notes:       [],
    filter:      { contentType: 'todo' as const },
    fetchTodos:  jest.fn(),
    toggleTodo:  jest.fn(),
    isLoading:   false,
    error:       null,
    addTodo:     jest.fn(),
    removeTodo:  jest.fn(),
    setFilter:   jest.fn(),
    clearError:  jest.fn(),
    fetchNotes:  jest.fn(),
    addNote:     jest.fn(),
    editTodo:    jest.fn(),
    editNote:    jest.fn(),
    removeNote:  jest.fn(),
    ...overrides,
  });
}

/**
 * useAuthStore mock 설정.
 * selector 패턴 지원.
 */
function mockAuthStore(user: { nickname?: string } | null = null) {
  const state = { user, isLoading: false };
  (useAuthStore as jest.Mock).mockImplementation(
    (selector?: (s: typeof state) => unknown) => selector ? selector(state) : state
  );
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본 상태 설정: 인증 유저, 빈 데이터
    mockEventStore({});
    mockTodoStore({});
    mockAuthStore({ nickname: '테스트 사용자' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 기본 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('기본 렌더링', () => {
    it('크래시 없이 렌더링', () => {
      render(<HomeScreen />);
      expect(true).toBeTruthy();
    });

    it('오늘 일정 섹션 헤더 표시', () => {
      const { getByText } = render(<HomeScreen />);
      // i18n 적용 후: 이모지 제거, t('event.today_list_title') = '오늘 일정'
      expect(getByText('오늘 일정')).toBeTruthy();
    });

    it('오늘 할일 섹션 헤더 표시', () => {
      const { getByText } = render(<HomeScreen />);
      // i18n 적용 후: 이모지 제거, t('todo.today_list_title') = '오늘 할일'
      expect(getByText('오늘 할일')).toBeTruthy();
    });

    it('닉네임이 있으면 인사말에 닉네임 표시', () => {
      mockAuthStore({ nickname: '홍길동' });
      const { getByText } = render(<HomeScreen />);
      expect(getByText('홍길동')).toBeTruthy();
    });

    it('닉네임이 없으면 기본값 표시', () => {
      mockAuthStore(null);
      const { getByText } = render(<HomeScreen />);
      // i18n 적용 후: t('common.user') = '사용자'
      expect(getByText('사용자')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 빈 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('빈 상태', () => {
    it('오늘 일정 없음 → 빈 상태 표시', () => {
      mockEventStore({ eventsByDate: {} });
      const { getByText } = render(<HomeScreen />);
      // i18n 적용 후: t('event.today_list_title') + ' ' + t('common.none') = '오늘 일정 없음'
      expect(getByText('오늘 일정 없음')).toBeTruthy();
    });

    it('오늘 할일 없음 → 빈 상태 표시', () => {
      mockTodoStore({ todos: [] });
      const { getByText } = render(<HomeScreen />);
      // i18n 적용 후: t('todo.today_list_title') + ' ' + t('common.none') = '오늘 할일 없음'
      expect(getByText('오늘 할일 없음')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 데이터 있는 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('데이터 있는 상태', () => {
    it('오늘 일정 있음 → 이벤트 제목 렌더링', () => {
      mockEventStore({
        eventsByDate: { [TODAY_KEY]: [mockEvent] },
      });

      const { getByText } = render(<HomeScreen />);
      expect(getByText('팀 미팅')).toBeTruthy();
    });

    it('오늘 할일 있음 → 할일 제목 렌더링', () => {
      mockTodoStore({ todos: [mockTodo] });

      const { getByText } = render(<HomeScreen />);
      expect(getByText('오늘 할일 항목')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 마운트 시 데이터 로딩
  // ══════════════════════════════════════════════════════════════════════════

  describe('마운트 시 데이터 로딩', () => {
    it('마운트 시 fetchEvents 호출 (오늘 날짜 범위)', () => {
      const mockFetch = jest.fn();
      mockEventStore({ fetchEvents: mockFetch });

      render(<HomeScreen />);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          start: expect.any(Date),
          end:   expect.any(Date),
        })
      );
    });

    it('마운트 시 fetchTodos 호출 (contentType=todo, 오늘 날짜 범위)', () => {
      const mockFetch = jest.fn();
      mockTodoStore({ fetchTodos: mockFetch });

      render(<HomeScreen />);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'todo',
          dueAfter:    expect.any(Date),
          dueBefore:   expect.any(Date),
        })
      );
    });

    it('fetchEvents에 전달되는 start는 오늘 자정, end는 오늘 23:59', () => {
      const mockFetch = jest.fn();
      mockEventStore({ fetchEvents: mockFetch });

      render(<HomeScreen />);

      const [[range]] = mockFetch.mock.calls;
      // start는 오늘 00:00:00
      expect(range.start.getHours()).toBe(0);
      expect(range.start.getMinutes()).toBe(0);
      // end는 오늘 23:59:59
      expect(range.end.getHours()).toBe(23);
      expect(range.end.getMinutes()).toBe(59);
    });
  });
});
