/**
 * TodoEditSheet — open/close and save-path smoke tests.
 * Sprint 14 TASK-1412
 *
 * Sprint 14 변경: 명시적 Save 버튼 제거, 닫기 버튼 탭 시 자동 저장.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { TodoEditSheet } from '@/components/planner/TodoEditSheet';
import type { Todo } from '@/types';

jest.mock('@/services/categoryService', () => ({
  getCategories: jest.fn(async () => []),
  createCategory: jest.fn(),
}));

const baseTodo: Todo = {
  id: 't-1',
  userId: 'u-1',
  spaceId: null,
  title: 'Buy milk',
  content: null,
  contentType: 'todo',
  dueDate: null,
  priority: 'medium',
  isCompleted: false,
  completedAt: null,
  categoryId: null,
  sortOrder: 0,
  eventId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('TodoEditSheet', () => {
  it('renders nothing when todo is null', () => {
    const { queryByText } = render(
      <TodoEditSheet
        todo={null}
        categoryMap={new Map()}
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(queryByText(/편집|Edit/)).toBeNull();
  });

  it('invokes onSave with the edited title (via close auto-save)', async () => {
    const onSave = jest.fn(async () => undefined);
    const onClose = jest.fn();
    const { getByDisplayValue, getByText } = render(
      <TodoEditSheet
        todo={baseTodo}
        categoryMap={new Map()}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    const input = getByDisplayValue('Buy milk');
    fireEvent.changeText(input, 'Buy oat milk');

    // Sprint 14: explicit Save button removed — closing the sheet triggers auto-save.
    const closeBtn = getByText(/닫기|Close/);
    fireEvent.press(closeBtn);

    // Flush the async save handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ title: 'Buy oat milk' }),
    );
  });
});
