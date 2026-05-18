/**
 * ColorPicker — event color selection palette component.
 *
 * Displays a row of 14 preset color swatches. The user can:
 *   - Tap any swatch to select that color (stored as hex string).
 *   - Tap the active swatch again to clear the override (reverts to category/
 *     member-color fallback — represented by `null`).
 *   - The first "slot" is always the "default / auto" swatch (gray circle with
 *     a dash) that explicitly sets color to null.
 *
 * Design constraints:
 *   - 14 swatches fit a single horizontal row on 375px-wide screens.
 *   - Colors are designed to be AA-contrast-friendly on both light and dark
 *     backgrounds (L≈45–55 in HSL).
 *   - testID conventions: `event-color-picker` (container), `event-color-{hex}`
 *     (individual swatch), `event-color-default` (null swatch).
 *
 * @param value    - Currently selected hex color string, or null for "auto/default".
 * @param onChange - Called with the new hex string when a swatch is tapped,
 *                   or null when the default swatch is tapped.
 */

import React, { useCallback } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';

// ─── Preset palette ───────────────────────────────────────────────────────────

/**
 * 14 hand-picked colors covering the full hue wheel at consistent saturation
 * (≈70 %) and lightness (≈45 %) so they render legibly on white calendar cells.
 *
 * Derived from the HSL golden-angle sequence with manual tweaks for harmony.
 */
/**
 * Workout 일정 전용 예약 색상 (v1.1.1).
 *
 * - 사용자가 일반 카테고리/이벤트 색상으로 선택 불가 (이 색만 보면 운동 일정 시그널)
 * - `event_kind === 'workout'` 인 이벤트의 color는 이 값으로 강제 적용
 * - EVENT_COLOR_PALETTE 에서도 제외해 picker 충돌 방지
 *
 * 색상 선정: Material Red 600 (#E53935) — 다른 팔레트 색과 채도/명도 명확 구분.
 */
export const WORKOUT_RESERVED_COLOR = '#E53935';

export const EVENT_COLOR_PALETTE: string[] = [
  '#7C3AED', // violet      — aligns with app primary
  '#DB2777', // pink
  '#E11D48', // rose-red
  '#EA580C', // orange
  '#D97706', // amber
  '#65A30D', // lime-green
  '#16A34A', // green
  '#0D9488', // teal
  '#0284C7', // sky-blue
  '#2563EB', // blue
  '#9333EA', // purple
  '#C2410C', // burnt-orange
  '#0F766E', // deep-teal
];

// Remove accidental duplicates while preserving order, and ensure the workout
// reserved color never leaks into the user-selectable palette.
const PALETTE = [...new Set(EVENT_COLOR_PALETTE)].filter(
  (hex) => hex.toUpperCase() !== WORKOUT_RESERVED_COLOR.toUpperCase(),
);

// ─── Component ────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  /** Currently selected hex string, or null for "auto (default)" color. */
  value: string | null;
  /**
   * Called when the user picks a swatch.
   *
   * @param color - Hex string of the selected color, or null if the user
   *                chose the "auto" (default) swatch.
   */
  onChange: (color: string | null) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps): React.ReactElement {
  const colors = useColors();
  const { t } = useTranslation();

  /**
   * Handle a swatch tap:
   *   - Tapping the "auto" swatch → always clear to null.
   *   - Tapping an already-selected swatch → deselect (clear to null).
   *   - Tapping a new swatch → select that color.
   */
  const handlePress = useCallback(
    (hex: string | null) => {
      if (hex === null || hex === value) {
        onChange(null);
      } else {
        onChange(hex);
      }
    },
    [value, onChange],
  );

  return (
    <View
      testID="event-color-picker"
      style={styles.container}
      accessibilityRole="radiogroup"
    >
      {/* "Auto / default" swatch — explicitly sets color to null */}
      <Pressable
        testID="event-color-default"
        style={[
          styles.swatch,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          value === null && { borderColor: colors.primary, borderWidth: 2.5 },
        ]}
        onPress={() => handlePress(null)}
        accessibilityRole="radio"
        accessibilityLabel={t('common.a11y_default_color')}
        accessibilityState={{ checked: value === null }}
      >
        {/* Dash icon signals "inherit from category / member" */}
        <Ionicons
          name="remove"
          size={14}
          color={value === null ? colors.primary : colors.textTertiary}
        />
      </Pressable>

      {/* Color swatches */}
      {PALETTE.map((hex) => {
        const isSelected = value === hex;
        return (
          <Pressable
            key={hex}
            testID={`event-color-${hex}`}
            style={[
              styles.swatch,
              { backgroundColor: hex },
              isSelected && styles.swatchSelected,
            ]}
            onPress={() => handlePress(hex)}
            accessibilityRole="radio"
            accessibilityLabel={hex}
            accessibilityState={{ checked: isSelected }}
          >
            {/* Show a checkmark on the active swatch */}
            {isSelected && (
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Static styles — no theme dependency needed; swatch colors are fully
 * determined by the palette hex values and are not theme-sensitive.
 */
const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Active state: white ring inset effect via thicker border. */
  swatchSelected: {
    borderColor: '#FFFFFF',
    borderWidth: 2,
  },
});
