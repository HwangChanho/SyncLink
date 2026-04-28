/**
 * __tests__/components/ColorPicker.test.tsx
 *
 * ColorPicker 컴포넌트 단위 테스트.
 *
 * 커버리지:
 *  - 팔레트 스와치 렌더링 확인 (testID 기반)
 *  - 스와치 탭 → onChange 호출
 *  - "기본 색상" 스와치 탭 → onChange(null) 호출
 *  - 이미 선택된 스와치 재탭 → onChange(null) 호출 (deselect)
 */

// ─── Mock ─────────────────────────────────────────────────────────────────────

jest.mock('@/hooks/useColors', () => ({
  useColors: jest.fn(() => ({
    surface:       '#FFFFFF',
    surfaceAlt:    '#F3F4F6',
    border:        '#E5E7EB',
    textPrimary:   '#111827',
    textSecondary: '#6B7280',
    textTertiary:  '#9CA3AF',
    primary:       '#7C3AED',
    primaryLight:  '#EDE9FE',
  })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ColorPicker, EVENT_COLOR_PALETTE } from '@/components/event/ColorPicker';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ColorPicker', () => {
  /**
   * Sanity check: the container and the "default" swatch are always rendered.
   */
  it('renders the picker container and default swatch', () => {
    const { getByTestId } = render(
      <ColorPicker value={null} onChange={jest.fn()} />,
    );

    expect(getByTestId('event-color-picker')).toBeTruthy();
    expect(getByTestId('event-color-default')).toBeTruthy();
  });

  /**
   * Tapping a color swatch should call onChange with that hex string.
   */
  it('calls onChange with the selected color hex when a swatch is tapped', () => {
    const onChange = jest.fn();
    const firstColor = EVENT_COLOR_PALETTE[0]; // first palette color

    const { getByTestId } = render(
      <ColorPicker value={null} onChange={onChange} />,
    );

    // Each swatch uses testID `event-color-{hex}`
    fireEvent.press(getByTestId(`event-color-${firstColor}`));
    expect(onChange).toHaveBeenCalledWith(firstColor);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /**
   * Tapping the "default" swatch must always emit null — even when a color is
   * currently selected.
   */
  it('calls onChange(null) when the default swatch is tapped', () => {
    const onChange = jest.fn();
    const selectedColor = EVENT_COLOR_PALETTE[1];

    const { getByTestId } = render(
      <ColorPicker value={selectedColor} onChange={onChange} />,
    );

    fireEvent.press(getByTestId('event-color-default'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  /**
   * Tapping the currently active swatch again should deselect it (null).
   * This allows the user to revert to the auto-color without tapping "default".
   */
  it('deselects (emits null) when the active swatch is tapped again', () => {
    const onChange = jest.fn();
    const selectedColor = EVENT_COLOR_PALETTE[2];

    const { getByTestId } = render(
      <ColorPicker value={selectedColor} onChange={onChange} />,
    );

    // Tapping the already-selected swatch should clear the selection
    fireEvent.press(getByTestId(`event-color-${selectedColor}`));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
