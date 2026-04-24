/**
 * CategoryPickerSheet — open/close and list rendering smoke tests.
 * Sprint 14 TASK-1413
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CategoryPickerSheet } from '@/components/planner/CategoryPickerSheet';

jest.mock('@/services/categoryService', () => ({
  getCategories: jest.fn(async () => [
    { id: 'c-1', userId: null, name: '업무', color: '#3B82F6', icon: null, createdAt: new Date() },
    { id: 'c-2', userId: null, name: '개인', color: '#EF4444', icon: null, createdAt: new Date() },
  ]),
  createCategory: jest.fn(),
}));

describe('CategoryPickerSheet', () => {
  it('renders nothing when hidden', () => {
    const { queryByText } = render(
      <CategoryPickerSheet
        visible={false}
        selectedId={null}
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );
    expect(queryByText(/카테고리 변경|Change category|更换分类|カテゴリを変更/)).toBeNull();
  });

  it('renders categories and propagates selection', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();

    const { findByText } = render(
      <CategoryPickerSheet
        visible
        selectedId={null}
        onClose={onClose}
        onSelect={onSelect}
      />,
    );

    // The async fetch populates the list — wait for one of the items.
    const row = await findByText('업무');
    fireEvent.press(row);

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('c-1');
      expect(onClose).toHaveBeenCalled();
    });
  });
});
