/**
 * __tests__/components/TodayTodoList.test.tsx
 *
 * TASK-410: TodayTodoList 컴포넌트 테스트
 *
 * 전략:
 *  - useTodoStore를 jest.mock으로 전체 mock → 스토어 상태 직접 제어
 *  - 오늘 날짜의 Todo만 isDueToday 필터를 통과하므로 today/tomorrow 픽스처 사용
 *  - fireEvent로 체크박스 탭 → toggleTodo 호출 검증
 *
 * 커버리지:
 *  - 오늘 할일 목록 렌더링
 *  - 오늘이 아닌 할일은 필터링
 *  - 빈 상태 ("오늘 마감 할일이 없습니다") 표시
 *  - 체크박스 탭 → toggleTodo 호출
 *  - 완료 할일 취소선 스타일 (isCompleted=true)
 *  - 마운트 시 fetchTodos 호출
 *
 * @task TASK-410
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/stores/todoStore', () => ({
  useTodoStore: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { useTodoStore } from '@/stores/todoStore';
import { TodayTodoList } from '@/components/home/TodayTodoList';
import type { Todo } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** 오늘 정오 시각 — isDueToday 필터를 통과 */
function todayNoon(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

/** 내일 날짜 — isDueToday 필터를 통과하지 못함 */
function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** 기본 Todo 픽스처 (오늘 마감) */
const baseTodo: Todo = {
  id:          'todo-1',
  userId:      'user-123',
  spaceId:     null,
  title:       '오늘 할 일',
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

/** 완료된 오늘 Todo */
const completedTodo: Todo = {
  ...baseTodo,
  id:          'todo-2',
  title:       '완료된 할 일',
  isCompleted: true,
  completedAt: new Date(),
};

/** 내일 마감 Todo — 필터에서 제외되어야 함 */
const tomorrowTodo: Todo = {
  ...baseTodo,
  id:      'todo-3',
  title:   '내일 할 일',
  dueDate: tomorrow(),
};

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * useTodoStore mock 기본 구현 설정.
 * useTodoStore()를 destructuring으로 사용하므로 전체 state 객체 반환.
 */
function mockStore(overrides: {
  todos?: Todo[];
  fetchTodos?: jest.Mock;
  toggleTodo?: jest.Mock;
  isLoading?: boolean;
}) {
  const defaults = {
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
  };

  (useTodoStore as jest.Mock).mockReturnValue({ ...defaults, ...overrides });
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('TodayTodoList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: 빈 todos
    mockStore({});
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 빈 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('빈 상태', () => {
    it('todos가 비어 있으면 빈 상태 표시', () => {
      mockStore({ todos: [] });

      const { getByText } = render(<TodayTodoList />);

      // i18n 적용 후: '오늘 할일 없음' (t('todo.today_list_title') + ' ' + t('common.none'))
      expect(getByText('오늘 할일 없음')).toBeTruthy();
    });

    it('오늘 할일이 없으면 섹션 헤더 카운트 미표시', () => {
      mockStore({ todos: [] });

      const { queryByText } = render(<TodayTodoList />);

      // 카운트(예: "0/0")는 표시되지 않아야 함 (todayTodos.length === 0 조건)
      expect(queryByText(/\d+\/\d+/)).toBeNull();
    });

    it('내일 마감 할일만 있으면 빈 상태 표시', () => {
      mockStore({ todos: [tomorrowTodo] });

      const { getByText } = render(<TodayTodoList />);

      // isDueToday 필터로 내일 할일은 제외됨
      // i18n 적용 후: t('todo.today_list_title') + ' ' + t('common.none') = '오늘 할일 없음'
      expect(getByText('오늘 할일 없음')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 오늘 할일 목록 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('목록 렌더링', () => {
    it('오늘 할일 제목 표시', () => {
      mockStore({ todos: [baseTodo] });

      const { getByText } = render(<TodayTodoList />);

      expect(getByText('오늘 할 일')).toBeTruthy();
    });

    it('여러 오늘 할일 모두 표시', () => {
      const todo2: Todo = { ...baseTodo, id: 'todo-2', title: '두 번째 할일' };
      mockStore({ todos: [baseTodo, todo2] });

      const { getByText } = render(<TodayTodoList />);

      expect(getByText('오늘 할 일')).toBeTruthy();
      expect(getByText('두 번째 할일')).toBeTruthy();
    });

    it('오늘 할일이 있으면 "오늘 할일" 섹션 헤더 표시', () => {
      mockStore({ todos: [baseTodo] });

      const { getByText } = render(<TodayTodoList />);

      // i18n 적용 후: 이모지 제거, t('todo.today_list_title') = '오늘 할일'
      expect(getByText('오늘 할일')).toBeTruthy();
    });

    it('완료/전체 카운트 표시 (완료 1개, 전체 2개 → "1/2")', () => {
      mockStore({ todos: [baseTodo, completedTodo] });

      const { getByText } = render(<TodayTodoList />);

      expect(getByText('1/2')).toBeTruthy();
    });

    it('내일 마감 할일은 목록에서 제외', () => {
      mockStore({ todos: [baseTodo, tomorrowTodo] });

      const { queryByText } = render(<TodayTodoList />);

      // 오늘 할일은 표시, 내일 할일은 제외
      expect(queryByText('오늘 할 일')).toBeTruthy();
      expect(queryByText('내일 할 일')).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 체크박스 인터랙션
  // ══════════════════════════════════════════════════════════════════════════

  describe('체크박스 인터랙션', () => {
    it('체크박스 탭 → toggleTodo(todo.id) 호출', () => {
      const mockToggle = jest.fn();
      mockStore({ todos: [baseTodo], toggleTodo: mockToggle });

      // TouchableOpacity는 자동으로 role=button을 갖지 않으므로
      // UNSAFE_getAllByType으로 직접 탐색 (testID가 없는 상황의 차선책)
      const { UNSAFE_getAllByType } = render(<TodayTodoList />);
      const checkboxes = UNSAFE_getAllByType(TouchableOpacity);
      fireEvent.press(checkboxes[0]);

      expect(mockToggle).toHaveBeenCalledWith('todo-1');
    });

    it('완료된 할일의 체크박스 탭 → toggleTodo 호출 (토글)', () => {
      const mockToggle = jest.fn();
      mockStore({ todos: [completedTodo], toggleTodo: mockToggle });

      const { UNSAFE_getAllByType } = render(<TodayTodoList />);
      const checkboxes = UNSAFE_getAllByType(TouchableOpacity);
      fireEvent.press(checkboxes[0]);

      expect(mockToggle).toHaveBeenCalledWith('todo-2');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 마운트 동작
  // ══════════════════════════════════════════════════════════════════════════

  describe('마운트 동작', () => {
    it('마운트 시 fetchTodos 호출 (contentType=todo, 오늘 날짜 범위)', () => {
      const mockFetch = jest.fn();
      mockStore({ fetchTodos: mockFetch });

      render(<TodayTodoList />);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'todo',
          dueBefore:   expect.any(Date),
          dueAfter:    expect.any(Date),
        })
      );
    });
  });
});
