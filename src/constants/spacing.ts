/**
 * SyncLink design system — spacing tokens.
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

/**
 * 모서리 둥글기.
 *
 * 2026-09-20 톤 개편: 카드·시트에 쓰는 lg·xl 을 한 단계씩 키웠다
 * (lg 12→16, xl 16→20). 작은 곡률은 각져 보여 요즘 앱과 인상 차이가 크다.
 * sm·md 는 배지·칩처럼 작은 요소용이라 그대로 둔다 — 작은 요소에 큰 곡률을
 * 주면 알약처럼 뭉개진다.
 *
 * 1.5.0 「우리하루」 귀엽게 개편: 전 단계를 한 칸씩 더 둥글게
 * (sm 4→6 · md 8→12 · lg 16→20 · xl 20→24 · 2xl 24→28).
 * sm·md 도 올렸지만 **작은 요소가 알약처럼 뭉개지지 않는 선**(높이의 1/3 이하)에서 멈췄다 —
 * sm 을 쓰는 가장 작은 요소는 주/일 보기의 일정 블록(최소 높이 약 20px)이다.
 * 🔴 캘린더 날짜 셀은 칸이 좁아 여기 값을 따르지 않고 하드코딩을 유지한다.
 */
export const radius = {
  none: 0,
  sm:   6,
  md:   12,
  lg:   20,
  xl:   24,
  '2xl': 28,
  full: 9999,
} as const;

/**
 * 깊이(그림자) 토큰 — 2026-09-20 신설.
 *
 * 왜 만들었나: 그동안 토큰이 없어 **18개 파일이 저마다 그림자를 하드코딩**했다.
 * 값이 제각각이라 같은 층위의 카드끼리도 다르게 떠 보였다.
 *
 * 쓰는 법 — 역할에 따라 층을 고른다(전부에 같은 값을 바르면 위계가 사라진다):
 *   0  바닥에 붙어 있는 것 (목록 행, 구분선으로 나뉜 영역)
 *   1  배경에서 살짝 뜬 것 (카드, 입력 필드)
 *   2  떠 있는 것 (FAB, 팝오버, 강조 카드)
 *   3  화면을 덮는 것 (바텀시트, 모달, 드래그 중인 요소)
 *
 * 🔴 다크 모드에서는 그림자가 거의 보이지 않는다. 다크에서 경계가 필요하면
 *    그림자를 키우지 말고 `colors.border` 로 테두리를 줄 것.
 *
 * 플랫폼 차이: shadow* 는 iOS·웹(RN Web 이 boxShadow 로 변환), elevation 은
 * Android 가 읽는다. 한 객체에 같이 두어 호출부가 신경 쓰지 않게 했다.
 */
export const elevation = {
  0: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius:  0,
    elevation:     0,
  },
  1: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius:  3,
    elevation:     1,
  },
  2: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius:  12,
    elevation:     4,
  },
  3: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius:  28,
    elevation:     12,
  },
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
