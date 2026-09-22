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

// ─── 대비 보정 ─────────────────────────────────────────────────────────────────

/**
 * HSL → sRGB(0~1) 변환. 대비 계산 전용이라 문자열이 아니라 숫자 배열을 돌려준다.
 * @param h - hue 0-360
 * @param s - saturation 0-100
 * @param l - lightness 0-100
 * @returns [r, g, b] 각 0~1
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/**
 * WCAG 2.x 상대 휘도.
 * @param rgb - sRGB 0~1
 * @returns 0(검정) ~ 1(흰색)
 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 흰색(#FFF)과의 대비비.
 * @returns 1 ~ 21
 */
export function contrastWithWhite(h: number, s: number, l: number): number {
  return 1.05 / (relativeLuminance(hslToRgb(h, s, l)) + 0.05);
}

/**
 * 흰색과 minRatio 이상 대비가 나올 때까지 명도를 내린 값을 돌려준다.
 *
 * 🔴 왜 필요한가: 예전엔 모든 hue 에 같은 명도(L=48)를 썼다. 그런데 사람 눈에는
 *   초록·노랑이 파랑·보라보다 훨씬 밝게 보여서(휘도 가중치 G 0.72 vs B 0.07),
 *   같은 L48 이어도 **민트·emerald 는 흰 글자 대비 2.44:1, amber 는 3.06:1** 로
 *   WCAG AA(4.5:1)에 못 미쳤다. indigo(8.17)·violet(7.03)·rose(5.41)만 통과했다.
 *   hue 마다 명도를 따로 정하는 대신 **계산으로 맞춘다** — 새 프리셋을 넣어도 안전하다.
 *
 * @param h         - hue
 * @param s         - saturation
 * @param preferred - 원래 쓰고 싶은 명도(이미 기준을 넘으면 그대로 돌려준다)
 * @param minRatio  - 필요한 최소 대비(글자 4.5, 아이콘·테두리 같은 UI 3)
 * @returns 기준을 만족하는 가장 밝은 정수 명도(preferred 이하)
 */
export function fitLightnessForWhite(
  h: number,
  s: number,
  preferred: number,
  minRatio: number,
): number {
  let l = preferred;
  // 1씩 내려가며 찾는다. 최악(노랑)이라도 30회 안쪽이라 비용은 무시할 만하다
  while (l > 0 && contrastWithWhite(h, s, l) < minRatio) l -= 1;
  return l;
}

// ─── Named accent presets ─────────────────────────────────────────────────────

/**
 * 기존 HeaderTitleColor 6개 키를 hue 값으로 매핑.
 * default(=violet)를 포함한 7개. 새로운 accentHue 시스템과 역호환성 유지.
 */
export const ACCENT_PRESETS = {
  // 1.5.0 — 「우리하루」 리브랜딩으로 기본 액센트를 indigo(244) → **민트(160)** 로 변경.
  // 아이콘 달력 띠(#6CCFAE)와 같은 hue 다. 인디고를 쓰던 사람은 'indigo' 를 고르면 된다.
  // (v1.4.12 에는 violet 258 → indigo 244 로 바꿨었다)
  default:  160, // mint (기본)
  /**
   * @deprecated 1.4.12~1.4.x 의 기본(indigo)과 같은 값. 설정 목록에서는 뺐지만
   * **키는 지우지 말 것** — 예전에 이 값을 고른 사용자의 저장값이 남아 있다.
   */
  primary:  244, // indigo
  /** 1.5.0 신설 — 기본이 민트가 되면서 인디고를 계속 쓰고 싶은 사람용. */
  indigo:   244,
  rose:     342, // rose
  /**
   * @deprecated 1.5.0 부터 default(민트)와 같은 hue 라 설정 목록에서 뺐다.
   * 키는 저장값 호환 때문에 남긴다.
   */
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
      // 2026-09-20 톤 개편: 채도 70 → 52. 명도는 64 → 66 으로 아주 조금만
      // 올렸다 — 채도를 내리면 같은 L 이어도 탁해 보이기 때문이다.
      primary:      hsl(h, 52, 66),
      primaryLight: hsl(h, 32, 34),
      primaryDark:  hsl(h, 54, 54),
      accent:       hsl(h, 56, 70),

      // ── Background ────────────────────────────────────────────────────────
      // 배경 채도도 같이 낮춘다(18 → 14). 배경이 accent 색으로 물들면
      // 그 위의 색이 전부 같은 쪽으로 끌려가 화면이 한 덩어리로 보인다.
      // 🔑 background L 14 → 13, surface L 19 → 20 으로 **명도 차를 5 → 7 로**
      //    벌렸다. 카드가 배경에 묻히던 문제가 여기서 온다.
      background:    hsl(h, 14, 13),
      backgroundAlt: hsl(h, 14, 16),
      surface:       hsl(h, 13, 20),
      surfaceAlt:    hsl(h, 13, 26),

      // ── Text ──────────────────────────────────────────────────────────────
      textPrimary:     hsl(h, 10, 96),
      textSecondary:   hsl(h, 12, 75),
      textTertiary:    hsl(h, 8, 58),
      textInverse:     hsl(h, 14, 12),
      textPlaceholder: hsl(h, 6, 42),

      // ── Border ────────────────────────────────────────────────────────────
      border:       hsl(h, 14, 29),
      borderStrong: hsl(h, 15, 36),

      // ── Status (hue-independent — 의미색은 고정) ──────────────────────
      // 색상(hue)은 그대로. 채도만 브랜드와 같은 폭으로 낮춘다 —
      // 의미색만 쨍하게 남으면 경고가 실제 심각도보다 크게 읽힌다.
      success: 'hsl(142, 48%, 58%)',
      warning: 'hsl(38, 68%, 58%)',
      error:   'hsl(0, 58%, 62%)',

      // ── Tab bar ───────────────────────────────────────────────────────────
      tabActive:   hsl(h, 52, 66),
      tabInactive: hsl(h, 10, 50),

      // ── Input ─────────────────────────────────────────────────────────────
      inputBackground: hsl(h, 13, 20),
      inputBorder:     hsl(h, 14, 29),
      inputFocus:      hsl(h, 52, 66),
    };
  }

  // ── Light mode ──────────────────────────────────────────────────────────────
  // primary 는 버튼 배경이고 그 위에 흰 글자가 올라간다 → 흰색 대비 4.5:1 보장.
  // indigo·violet·rose 는 L48 그대로, 민트는 L34, amber 는 L38 로 내려간다.
  const primaryL = fitLightnessForWhite(h, 52, 48, 4.5);
  // accent 는 흰 배경 위 아이콘·강조선용 → UI 요소 기준 3:1
  const accentL = fitLightnessForWhite(h, 54, 54, 3);
  return {
    // ── Brand ────────────────────────────────────────────────────────────────
    // 2026-09-20 톤 개편: 채도 65 → 52.
    // 🔴 명도는 고정값이 아니라 위 primaryL(대비 보정) — 직접 숫자를 넣지 말 것.
    primary:      hsl(h, 52, primaryL),
    // 1.5.0 「귀엽게」: 칩·배지 배경을 조금 더 말랑한 파스텔로(S38 L94 → S48 L93).
    // 글자는 이 위에 primary 로 올라가는데 primary 가 이미 흰색 대비 4.5 라 여유가 있다.
    primaryLight: hsl(h, 48, 93),
    primaryDark:  hsl(h, 54, primaryL - 8),
    accent:       hsl(h, 54, accentL),

    // ── Background ───────────────────────────────────────────────────────────
    // 메인 배경: S를 낮춰서 "살짝 tinted 흰색".
    // v1.2.8 — LEAD 피드백 "라이트 너무 밝다, 살짝만 어둡게".
    //   background  L 99 → 97 (눈부심 ↓)
    //   backgroundAlt L 96 → 94
    //   surface     L 100 → 99 (카드는 background 보다 조금 밝아야 떠 보임)
    //   surfaceAlt  L 96 → 93
    // 2026-09-20: 배경 채도 30 → 20. 30% 는 흰 배경이 눈에 띄게 보랏빛으로
    // 물드는 수준이라, 그 위에 놓인 색이 전부 같은 쪽으로 끌려갔다.
    background:    hsl(h, 20, 97),
    backgroundAlt: hsl(h, 16, 94),
    surface:       hsl(h, 14, 99),
    surfaceAlt:    hsl(h, 14, 93),

    // ── Text ─────────────────────────────────────────────────────────────────
    // 거의 검은색 + 살짝 hue tint
    textPrimary:     hsl(h, 10, 10),
    textSecondary:   hsl(h, 8, 35),
    textTertiary:    hsl(h, 5, 58),
    textInverse:     hsl(h, 5, 98),
    textPlaceholder: hsl(h, 5, 75),

    // ── Border ───────────────────────────────────────────────────────────────
    border:       hsl(h, 13, 88),
    borderStrong: hsl(h, 13, 78),

    // ── Status (hue-independent) ─────────────────────────────────────────────
    // 라이트도 같은 이유로 채도만 낮춘다. 명도는 유지 — 흰 배경 위 대비를 지킨다.
    success: 'hsl(142, 45%, 38%)',
    warning: 'hsl(38, 64%, 42%)',
    error:   'hsl(0, 55%, 48%)',

    // ── Tab bar ───────────────────────────────────────────────────────────────
    tabActive:   hsl(h, 52, primaryL),
    tabInactive: hsl(h, 5, 62),

    // ── Input ─────────────────────────────────────────────────────────────────
    inputBackground: hsl(h, 16, 97),
    inputBorder:     hsl(h, 13, 88),
    inputFocus:      hsl(h, 52, primaryL),
  };
}
