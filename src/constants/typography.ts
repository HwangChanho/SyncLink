/**
 * SyncDay design system — typography tokens.
 *
 * Scale based on 4px base unit (same as spacing).
 * Font: System default (SF Pro on iOS, Roboto on Android).
 */

export const fontSize = {
  xs:   11,
  sm:   13,
  base: 15,
  md:   16,
  lg:   18,
  xl:   20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
} as const;

export const fontWeight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
} as const;

export const lineHeight = {
  tight:  1.2,
  normal: 1.5,
  loose:  1.8,
} as const;

export const letterSpacing = {
  tight:  -0.5,
  normal: 0,
  wide:   0.5,
} as const;

/** Pre-composed text styles for common use cases. */
export const textStyles = {
  // Headings
  h1: { fontSize: fontSize['3xl'], fontWeight: fontWeight.bold,     lineHeight: fontSize['3xl'] * lineHeight.tight },
  h2: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold,     lineHeight: fontSize['2xl'] * lineHeight.tight },
  h3: { fontSize: fontSize.xl,     fontWeight: fontWeight.semibold, lineHeight: fontSize.xl    * lineHeight.tight },
  h4: { fontSize: fontSize.lg,     fontWeight: fontWeight.semibold, lineHeight: fontSize.lg    * lineHeight.normal },

  // Body
  bodyLg:  { fontSize: fontSize.md,   fontWeight: fontWeight.regular, lineHeight: fontSize.md   * lineHeight.normal },
  body:    { fontSize: fontSize.base, fontWeight: fontWeight.regular, lineHeight: fontSize.base * lineHeight.normal },
  bodySm:  { fontSize: fontSize.sm,   fontWeight: fontWeight.regular, lineHeight: fontSize.sm   * lineHeight.normal },

  // Labels
  labelLg: { fontSize: fontSize.base, fontWeight: fontWeight.medium,   lineHeight: fontSize.base * lineHeight.tight },
  label:   { fontSize: fontSize.sm,   fontWeight: fontWeight.medium,   lineHeight: fontSize.sm   * lineHeight.tight },
  labelSm: { fontSize: fontSize.xs,   fontWeight: fontWeight.medium,   lineHeight: fontSize.xs   * lineHeight.tight },

  // Caption
  caption: { fontSize: fontSize.xs, fontWeight: fontWeight.regular, lineHeight: fontSize.xs * lineHeight.normal },
} as const;
