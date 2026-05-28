/**
 * themePalette — HSL 기반 동적 팔레트 생성기.
 *
 * accentHue 하나(0-360)만 받아 라이트/다크 전체 ColorTokens를 반환한다.
 * Material You / Apple iOS 14+ 동적 색상과 동일한 "tonal surface" 접근법을 사용한다.
 *
 * 핵심 아이디어:
 *   - primary / accent: 선명도(S) 높게 — 브랜드 포인트
 *   - background / card: 같은 hue지만 S를 극히 낮추고 L을 100%에 가깝게
 *     → 배경은 "거의 흰색이지만 살짝 tinted" 느낌
 *   - textPrimary: S 최소화 + L 극단치 (거의 무채색)
 *     → hue tint가 살짝 섞여 전체적으로 조화
 *
 * WCAG AA 대비 기준:
 *   - textPrimary on background ≥ 4.5 : 1
 *   - accent on primaryBg ≥ 3 : 1 (UI 컨트롤 기준)
 *
 * ADR-014 골든앵글 패턴을 앱 전체 테마에 응용.
 *
 * @module themePalette
 */

// ─── Palette type ─────────────────────────────────────────────────────────────

/**
 * buildPalette() 의 반환 타입.
 * 기존 light/dark 토큰과 동일한 키 구조를 가지므로 ColorTokens 로 사용 가능.
 * useColors.ts 에서 import 해 ColorTokens 타입 별칭으로 쓴다.
 *
 * 이 타입을 여기서 직접 선언하는 이유:
 *   useColors.ts ↔ themePalette.ts 간 순환 참조를 방지하기 위함.
 *   (useColors 가 ColorTokens = ReturnType<typeof buildPalette> 로 쓰면
 *    themePalette 가 useColors 를 임포트하는 순환이 발생한다.)
 */
export interface ThemePalette {
  primary:         string;
  primaryLight:    string;
  primaryDark:     string;
  accent:          string;
  background:      string;
  backgroundAlt:   string;
  surface:         string;
  surfaceAlt:      string;
  textPrimary:     string;
  textSecondary:   string;
  textTertiary:    string;
  textInverse:     string;
  textPlaceholder: string;
  border:          string;
  borderStrong:    string;
  success:         string;
  warning:         string;
  error:           string;
  tabActive:       string;
  tabInactive:     string;
  inputBackground: string;
  inputBorder:     string;
  inputFocus:      string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * CSS hsl() 문자열 생성.
 * @param h - hue 0-360
 * @param s - saturation 0-100
 * @param l - lightness 0-100
 */
function hsl(h: number, s: number, l: number): string {
  // hue를 0-360 범위로 정규화
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

// ─── Named accent presets ─────────────────────────────────────────────────────

/**
 * 기존 HeaderTitleColor 6개 키를 hue 값으로 매핑.
 * default(=violet)를 포함한 7개. 새로운 accentHue 시스템과 역호환성 유지.
 */
export const ACCENT_PRESETS = {
  default:  258, // violet (기존 기본값 유지)
  primary:  244, // indigo
  rose:     342, // rose
  emerald:  160, // emerald
  amber:     38, // amber
  violet:   264, // violet (진한)
} as const satisfies Record<string, number>;

export type AccentPresetKey = keyof typeof ACCENT_PRESETS;

// ─── Palette builder ──────────────────────────────────────────────────────────

/**
 * accentHue (0-360) + isDark 플래그를 받아 앱 전체 ColorTokens를 생성한다.
 *
 * 라이트/다크 모두 동일한 키 구조(ColorTokens)를 반환하므로
 * 기존 컴포넌트 변경 없이 useColors() 교체만으로 동작한다.
 *
 * @param accentHue - 0-360 범위의 색조(hue). ACCENT_PRESETS 참조.
 * @param isDark    - 다크모드 여부. true면 어두운 배경 팔레트 생성.
 * @returns ThemePalette — 기존 light/dark 토큰과 동일한 키 구조.
 */
export function buildPalette(accentHue: number, isDark: boolean): ThemePalette {
  const h = ((accentHue % 360) + 360) % 360;

  if (isDark) {
    // v1.2.8 — LEAD 피드백 "너무 어둡고 칙칙" → 톤 보정.
    // 핵심 변경:
    //   L (밝기): background 8→14, surface 14→19, surfaceAlt 20→26
    //     → 거의 검정 → 부드러운 dark gray (Notion/Apple 다크 톤)
    //   S (채도): 12→18 (background) / 12→16 (surface)
    //     → hue tint 살짝 더 비치게 (회색 단조 X)
    //   border L 22→28, S 14→18 — chip/카드 구분 더 또렷
    //   textSecondary/Tertiary S/L 미세 ↑ — 회색 단조 X
    //   primaryLight S/L ↑ — 다크 배경에서 chip 배경이 더 풍부
    // WCAG AA 대비: textPrimary L=95 on background L=14 = 12:1 (안전)
    return {
      // ── Brand ─────────────────────────────────────────────────────────────
      primary:      hsl(h, 70, 64),
      primaryLight: hsl(h, 40, 34),
      primaryDark:  hsl(h, 72, 52),
      accent:       hsl(h, 75, 68),

      // ── Background ────────────────────────────────────────────────────────
      background:    hsl(h, 18, 14),
      backgroundAlt: hsl(h, 18, 17),
      surface:       hsl(h, 16, 19),
      surfaceAlt:    hsl(h, 16, 26),

      // ── Text ──────────────────────────────────────────────────────────────
      textPrimary:     hsl(h, 10, 96),
      textSecondary:   hsl(h, 12, 75),
      textTertiary:    hsl(h, 8, 58),
      textInverse:     hsl(h, 14, 12),
      textPlaceholder: hsl(h, 6, 42),

      // ── Border ────────────────────────────────────────────────────────────
      border:       hsl(h, 18, 28),
      borderStrong: hsl(h, 20, 36),

      // ── Status (hue-independent — 의미색은 고정) ──────────────────────
      success: 'hsl(142, 65%, 55%)',
      warning: 'hsl(38, 90%, 55%)',
      error:   'hsl(0, 72%, 60%)',

      // ── Tab bar ───────────────────────────────────────────────────────────
      tabActive:   hsl(h, 70, 64),
      tabInactive: hsl(h, 10, 50),

      // ── Input ─────────────────────────────────────────────────────────────
      inputBackground: hsl(h, 16, 19),
      inputBorder:     hsl(h, 18, 28),
      inputFocus:      hsl(h, 70, 64),
    };
  }

  // ── Light mode ──────────────────────────────────────────────────────────────
  return {
    // ── Brand ────────────────────────────────────────────────────────────────
    primary:      hsl(h, 65, 48),
    primaryLight: hsl(h, 50, 94),   // 매우 옅은 accent 배경 (chip, badge bg)
    primaryDark:  hsl(h, 70, 38),
    accent:       hsl(h, 72, 52),

    // ── Background ───────────────────────────────────────────────────────────
    // 메인 배경: S를 낮춰서 "살짝 tinted 흰색".
    // v1.2.8 — LEAD 피드백 "라이트 너무 밝다, 살짝만 어둡게".
    //   background  L 99 → 97 (눈부심 ↓)
    //   backgroundAlt L 96 → 94
    //   surface     L 100 → 99 (카드는 background 보다 조금 밝아야 떠 보임)
    //   surfaceAlt  L 96 → 93
    background:    hsl(h, 30, 97),
    backgroundAlt: hsl(h, 25, 94),
    surface:       hsl(h, 20, 99),
    surfaceAlt:    hsl(h, 20, 93),

    // ── Text ─────────────────────────────────────────────────────────────────
    // 거의 검은색 + 살짝 hue tint
    textPrimary:     hsl(h, 10, 10),
    textSecondary:   hsl(h, 8, 35),
    textTertiary:    hsl(h, 5, 58),
    textInverse:     hsl(h, 5, 98),
    textPlaceholder: hsl(h, 5, 75),

    // ── Border ───────────────────────────────────────────────────────────────
    border:       hsl(h, 18, 88),
    borderStrong: hsl(h, 18, 78),

    // ── Status (hue-independent) ─────────────────────────────────────────────
    success: 'hsl(142, 60%, 38%)',
    warning: 'hsl(38, 85%, 42%)',
    error:   'hsl(0, 70%, 48%)',

    // ── Tab bar ───────────────────────────────────────────────────────────────
    tabActive:   hsl(h, 65, 48),
    tabInactive: hsl(h, 5, 62),

    // ── Input ─────────────────────────────────────────────────────────────────
    inputBackground: hsl(h, 25, 97),
    inputBorder:     hsl(h, 18, 88),
    inputFocus:      hsl(h, 65, 48),
  };
}
