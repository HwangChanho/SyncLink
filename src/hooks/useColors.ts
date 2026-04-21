/**
 * useColors — returns the current theme's color tokens.
 *
 * Reads the resolved color scheme from appearanceStore and returns
 * the corresponding set of semantic color tokens (light or dark).
 *
 * Usage:
 *  ```tsx
 *  const colors = useColors();
 *  <View style={{ backgroundColor: colors.background }} />
 *  ```
 *
 * Migration guide for existing components:
 *  Replace:  `import { light as colors } from '@/constants/colors';`
 *  With:     `import { useColors } from '@/hooks/useColors';`
 *            `const colors = useColors();`
 *
 * TASK-502 (Sprint 5)
 */

import { useAppearanceStore } from '@/stores/appearanceStore';
import { light, dark } from '@/constants/colors';

/**
 * Color token set type: union of light and dark theme shapes.
 * Both themes have identical keys; the value types are `string` at runtime.
 * We use this type alias so components can accept either theme.
 */
export type ColorTokens = { [K in keyof typeof light]: string };

/**
 * Returns the active color token set based on the user's appearance preference.
 * Re-renders automatically when the theme changes.
 *
 * @returns Semantic color tokens for the resolved theme ('light' or 'dark')
 */
export function useColors(): ColorTokens {
  // Subscribe to resolvedScheme only — avoids re-renders on preference changes
  // that don't affect the resolved output (e.g., setting 'system' when OS is 'light').
  const resolvedScheme = useAppearanceStore(state => state.resolvedScheme);
  return resolvedScheme === 'dark' ? dark : light;
}
