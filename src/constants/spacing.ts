/**
 * SyncDay design system — spacing tokens.
 *
 * 4px base unit grid. All spacing values are multiples of 4.
 *
 * Usage:
 *   import { spacing } from '@/constants/spacing';
 *   style={{ padding: spacing[4] }}  // 16px
 */

export const spacing = {
  0:   0,
  0.5: 2,
  1:   4,
  1.5: 6,
  2:   8,
  2.5: 10,
  3:   12,
  3.5: 14,
  4:   16,
  5:   20,
  6:   24,
  7:   28,
  8:   32,
  9:   36,
  10:  40,
  12:  48,
  14:  56,
  16:  64,
  20:  80,
  24:  96,
} as const;

/** Border radius tokens. */
export const radius = {
  none: 0,
  sm:   4,
  md:   8,
  lg:   12,
  xl:   16,
  '2xl': 24,
  full: 9999,
} as const;

/** Standard component heights. */
export const componentHeight = {
  inputField:    48,
  button:        52,
  buttonSm:      40,
  /** Large CTA button (e.g. Paywall subscribe button). */
  buttonLg:      56,
  tabBar:        64,
  navHeader:     56,
  eventCard:     72,
  calendarCell:  60,
} as const;

/** Screen-level horizontal padding. */
export const screenPadding = {
  horizontal: spacing[4],  // 16px
  vertical:   spacing[6],  // 24px
} as const;
