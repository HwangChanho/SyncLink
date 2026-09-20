/**
 * SyncLink design system — typography tokens.
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

/**
 * 자주 쓰는 텍스트 조합.
 *
 * 2026-09-20 톤 개편: 제목(h1~h3)에 **음수 자간**을 넣었다. 글자가 커질수록
 * 글자 사이가 벌어져 보이는 착시가 있어, 큰 글자는 좁혀야 단단해 보인다.
 * 본문·라벨은 건드리지 않는다 — 작은 글자에 음수 자간을 주면 읽기 어려워진다.
 */
export const textStyles = {
  // Headings
  h1: { fontSize: fontSize['3xl'], fontWeight: fontWeight.bold,     lineHeight: fontSize['3xl'] * lineHeight.tight, letterSpacing: -0.8 },
  h2: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold,     lineHeight: fontSize['2xl'] * lineHeight.tight, letterSpacing: -0.5 },
  h3: { fontSize: fontSize.xl,     fontWeight: fontWeight.semibold, lineHeight: fontSize.xl    * lineHeight.tight, letterSpacing: -0.3 },
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
