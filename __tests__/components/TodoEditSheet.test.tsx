/**
 * TodoEditSheet — open/close and save-path smoke tests.
 * Sprint 14 TASK-1412
 */

import { fireEvent, render } from '@testing-library/react-native';
import { TodoEditSheet } from '@/components/planner/TodoEditSheet';
import type { Todo } from '@/types';

// Ensure category service isn't hit (it's called only by the nested picker
// when opened). Stub to be safe.
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
    // Header label is only visible when the modal is visible.
    expect(queryByText(/편집|Edit/)).toBeNull();
  });

  it('invokes onSave with the edited title', async () => {
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

    const saveBtn = getByText(/^(저장|Save|保存|儲存)$/);
    fireEvent.press(saveBtn);

    // Flush the async save handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ title: 'Buy oat milk' }),
    );
  });
});
