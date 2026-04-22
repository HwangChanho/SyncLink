/**
 * SyncLink design system — color tokens.
 *
 * Structure:
 *  - palette:   raw hex values (never use directly in components)
 *  - semantic:  purpose-driven aliases (use these in components)
 *  - calendar:  event color assignments for space members
 *  - category:  default colors for built-in event categories
 */

// ─── Palette ──────────────────────────────────────────────────────────────────

export const palette = {
  // Primary — violet
  violet50:  '#F5F3FF',
  violet100: '#EDE9FE',
  violet200: '#DDD6FE',
  violet400: '#A78BFA',
  violet500: '#8B5CF6',
  violet600: '#7C3AED',
  violet700: '#6D28D9',

  // Accent — rose (couple / date events)
  rose400: '#FB7185',
  rose500: '#F43F5E',
  rose600: '#E11D48',

  // Neutral
  gray50:  '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',

  // Status
  green400: '#4ADE80',
  green500: '#22C55E',
  yellow400: '#FACC15',
  yellow500: '#EAB308',
  red400:   '#F87171',
  red500:   '#EF4444',

  // Whites
  white:       '#FFFFFF',
  offWhite:    '#FAFAFA',
  transparent: 'transparent',
} as const;

// ─── Semantic colors (light mode) ─────────────────────────────────────────────

export const light = {
  // Brand
  primary:         palette.violet600,
  primaryLight:    palette.violet100,
  primaryDark:     palette.violet700,
  accent:          palette.rose500,

  // Background
  background:      palette.white,
  backgroundAlt:   palette.gray50,
  surface:         palette.white,
  surfaceAlt:      palette.gray100,

  // Text
  textPrimary:     palette.gray900,
  textSecondary:   palette.gray600,
  textTertiary:    palette.gray400,
  textInverse:     palette.white,
  textPlaceholder: palette.gray300,

  // Border
  border:          palette.gray200,
  borderStrong:    palette.gray300,

  // Status
  success:  palette.green500,
  warning:  palette.yellow500,
  error:    palette.red500,

  // Tab bar
  tabActive:   palette.violet600,
  tabInactive: palette.gray400,

  // Input
  inputBackground: palette.gray50,
  inputBorder:     palette.gray200,
  inputFocus:      palette.violet600,
} as const;

export const dark: { [K in keyof typeof light]: string } = {
  // Brand
  primary:         palette.violet400,
  primaryLight:    palette.violet700,
  primaryDark:     palette.violet500,
  accent:          palette.rose400,

  // Background
  background:      palette.gray900,
  backgroundAlt:   palette.gray800,
  surface:         palette.gray800,
  surfaceAlt:      palette.gray700,

  // Text
  textPrimary:     palette.white,
  textSecondary:   palette.gray300,
  textTertiary:    palette.gray500,
  textInverse:     palette.gray900,
  textPlaceholder: palette.gray600,

  // Border
  border:          palette.gray700,
  borderStrong:    palette.gray600,

  // Status
  success:  palette.green400,
  warning:  palette.yellow400,
  error:    palette.red400,

  // Tab bar
  tabActive:   palette.violet400,
  tabInactive: palette.gray500,

  // Input
  inputBackground: palette.gray800,
  inputBorder:     palette.gray700,
  inputFocus:      palette.violet400,
} as const;

// ─── Calendar — member event colors ──────────────────────────────────────────

/**
 * Pre-defined color options for space members' events.
 * Index 0 = owner's default color, subsequent = members.
 * DEV: when creating a space member, assign colors[memberIndex % colors.length]
 */
export const memberEventColors = [
  '#6C63FF', // violet  (owner)
  '#FF6584', // rose    (second member)
  '#43BFBB', // teal
  '#FFAA44', // amber
  '#66BB6A', // green
  '#AB47BC', // purple
  '#EF5350', // red
  '#26C6DA', // cyan
] as const;

// ─── Category colors ──────────────────────────────────────────────────────────

/** Default colors for built-in event categories. */
export const categoryColors = {
  personal: '#6C63FF',
  work:     '#2196F3',
  date:     '#FF6584',
  family:   '#FF9800',
  health:   '#4CAF50',
  social:   '#9C27B0',
  travel:   '#00BCD4',
  holiday:  '#F44336',
  other:    '#9E9E9E',
} as const;
