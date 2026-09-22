/**
 * 브랜드 글꼴 — 1.5.0 「우리하루」 귀엽게 개편 (2026-09-23 LEAD 선택).
 *
 *   제목 = 주아(Jua) — 통통하고 귀여운 인상. 굵기 1종뿐이라 본문에는 무겁다.
 *   본문 = 나눔스퀘어라운드 R/B/EB — 둥글지만 작은 글씨도 잘 읽힌다.
 *   (둘 다 SIL OFL 1.1 — 고지는 assets/fonts/ 와 설정 > 오픈소스 라이선스)
 *
 * 🔑 적용 방식: 화면들이 RN `Text` 를 직접 쓰던 구조라, 공용 `Text`/`TextInput`
 *   (src/components/common/AppText.tsx)이 스타일의 **크기·굵기를 보고 글꼴을 고른다.**
 *   화면 코드는 fontFamily 를 몰라도 된다. 직접 fontFamily 를 지정한 곳은 그대로 존중한다.
 *
 * 🔴 커스텀 글꼴은 굵기를 파일로 고른다. fontWeight 를 그대로 두면 Android 는 가짜 굵게를
 *   덧씌우거나 시스템 글꼴로 되돌아가고, iOS 는 같은 패밀리에서 굵기를 다시 찾다 실패할 수 있다.
 *   그래서 글꼴을 정하면 fontWeight 는 'normal' 로 되돌린다(resolveBrandFont 참고).
 */
import type { TextStyle } from 'react-native';

/** useFonts 에 등록하는 별칭 이름. 파일명 대신 별칭을 써야 플랫폼마다 이름이 같다. */
export const BRAND_FONT = {
  title:         'UriharuTitle',        // 주아
  body:          'UriharuBody',         // 나눔스퀘어라운드 Regular
  bodyBold:      'UriharuBodyBold',     // 나눔스퀘어라운드 Bold
  bodyExtraBold: 'UriharuBodyExtraBold', // 나눔스퀘어라운드 ExtraBold
} as const;

/** useFonts 에 그대로 넘기는 맵(별칭 → 번들 에셋). */
export const BRAND_FONT_ASSETS = {
  [BRAND_FONT.title]:         require('../../assets/fonts/Jua-Regular.ttf'),
  [BRAND_FONT.body]:          require('../../assets/fonts/NanumSquareRoundR.ttf'),
  [BRAND_FONT.bodyBold]:      require('../../assets/fonts/NanumSquareRoundB.ttf'),
  [BRAND_FONT.bodyExtraBold]: require('../../assets/fonts/NanumSquareRoundEB.ttf'),
};

/** 제목 글꼴(주아)을 쓰는 최소 크기. textStyles.h3(20) 이상이 제목이다. */
const TITLE_MIN_SIZE = 20;
/** 제목 글꼴을 쓰는 최소 굵기. h3 가 semibold(600)라 600 부터. */
const TITLE_MIN_WEIGHT = 600;

/**
 * fontWeight 값을 숫자로 바꾼다('bold' → 700, 'normal'/없음 → 400).
 * @param w - RN fontWeight
 * @returns 100~900
 */
function weightNumber(w: TextStyle['fontWeight']): number {
  if (w === undefined || w === 'normal') return 400;
  if (w === 'bold') return 700;
  const n = typeof w === 'number' ? w : Number(w);
  // 'ultralight' 같은 이름 굵기는 RN 에서 드물다 — 모르면 보통 굵기로 본다
  return Number.isFinite(n) ? n : 400;
}

/**
 * 평탄화된 스타일을 보고 브랜드 글꼴을 고른다.
 *
 * @param style - StyleSheet.flatten 결과(없으면 빈 객체)
 * @returns 덧씌울 스타일. 이미 fontFamily 가 있으면 null(존중 — 아이콘·고정폭 글꼴 등)
 *
 * 규칙:
 *   - 크기 ≥ 20 && 굵기 ≥ 600 → 주아(제목)
 *   - 굵기 ≥ 800 → 나눔R ExtraBold / ≥ 600 → Bold / 그 외 → Regular
 *   - 나눔에는 Medium(500)이 없어 Regular 로 간다(Bold 로 올리면 라벨이 전부 무거워진다)
 */
export function resolveBrandFont(
  style: TextStyle | undefined,
): Pick<TextStyle, 'fontFamily' | 'fontWeight'> | null {
  const s = style ?? {};
  if (s.fontFamily) return null;

  const size = typeof s.fontSize === 'number' ? s.fontSize : 14;
  const weight = weightNumber(s.fontWeight);

  let fontFamily: string;
  if (size >= TITLE_MIN_SIZE && weight >= TITLE_MIN_WEIGHT) fontFamily = BRAND_FONT.title;
  else if (weight >= 800) fontFamily = BRAND_FONT.bodyExtraBold;
  else if (weight >= 600) fontFamily = BRAND_FONT.bodyBold;
  else fontFamily = BRAND_FONT.body;

  return { fontFamily, fontWeight: 'normal' };
}
