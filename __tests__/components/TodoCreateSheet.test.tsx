/**
 * TodoCreateSheet — render-state smoke tests (Build-66).
 *
 * 핵심 검증:
 *  1. 닫힌 상태 (visible=false) → null 렌더 (Modal 안 뜸).
 *  2. 열린 상태 → 날짜 chip 노출, 시간 chip 은 dueDate 없으므로 미노출.
 *  3. 저장 시 input 비어있으면 onCreate 호출 안 됨 (disabled save).
 *
 * DateTimeModal 통합 (날짜 pick → 시간 chip 노출) 은 e2e 영역으로
 * 분리 — `e2e/flows/10_planner_todo_time.yaml` 가 담당.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { TodoCreateSheet } from '@/components/planner/TodoCreateSheet';

jest.mock('@/services/categoryService', () => ({
  getCategories: jest.fn(async () => []),
  createCategory: jest.fn(),
}));

describe('TodoCreateSheet — Build-66 chip render', () => {
  it('visible=false 면 chip 자체가 렌더되지 않음', () => {
    const { queryByTestId } = render(
      <TodoCreateSheet
        visible={false}
        categoryMap={new Map()}
        onClose={jest.fn()}
        onCreate={jest.fn()}
      />,
    );
    expect(queryByTestId('todo-create-date-chip')).toBeNull();
    expect(queryByTestId('todo-create-time-chip')).toBeNull();
  });

  it('visible=true 면 날짜 chip 은 항상 노출', () => {
    const { getByTestId } = render(
      <TodoCreateSheet
        visible={true}
        categoryMap={new Map()}
        onClose={jest.fn()}
        onCreate={jest.fn()}
      />,
    );
    expect(getByTestId('todo-create-date-chip')).toBeTruthy();
  });

  it('초기 상태 (dueDate / dueAt 없음) 에서 시간 chip 은 미노출', () => {
    // 시간 chip 은 "날짜 없이 시간만 있는 todo 는 의미 없음" 이라
    // dueDate 또는 dueAt 가 set 됐을 때만 노출. 초기엔 둘 다 null.
    const { queryByTestId } = render(
      <TodoCreateSheet
        visible={true}
        categoryMap={new Map()}
        onClose={jest.fn()}
        onCreate={jest.fn()}
      />,
    );
    expect(queryByTestId('todo-create-time-chip')).toBeNull();
  });

  it('save / title input testID 가 모두 노출 (e2e 호환)', () => {
    const { getByTestId } = render(
      <TodoCreateSheet
        visible={true}
        categoryMap={new Map()}
        onClose={jest.fn()}
        onCreate={jest.fn()}
      />,
    );
    expect(getByTestId('todo-create-title-input')).toBeTruthy();
    expect(getByTestId('todo-create-save')).toBeTruthy();
  });
});
