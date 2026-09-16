/**
 * useResponsive — 웹 반응형 레이아웃 분기 훅.
 *
 * 일반 사용자 웹앱(synclink.pages.dev)을 데스크탑/태블릿에서 화면 폭에 맞춰
 * 재배치하기 위한 공통 기준점. `useWindowDimensions` 기반이라 창 리사이즈에
 * 실시간 반응한다.
 *
 * 폭 기준으로 웹·네이티브 모두에 적용한다. 네이티브 태블릿/대형화면(iPad,
 * Android 태블릿·폴더블)도 반응형 레이아웃을 쓴다. 폰은 세로 고정
 * (app.json orientation: portrait)이라 폭이 항상 768 미만 → isPhone 유지,
 * 즉 기존 폰 UX 는 그대로다(회귀 없음).
 *
 * Breakpoint:
 *   - phone   : < 768            (현행 모바일 레이아웃)
 *   - tablet  : 768 ~ 1023       (2열 그리드 등)
 *   - desktop : >= 1024          (사이드 네비 + 화면별 와이드 레이아웃)
 */

import { Platform, useWindowDimensions } from 'react-native';

export interface Responsive {
  /** 현재 창 너비(px). */
  width: number;
  /** < 768 또는 네이티브 앱 — 현행 모바일 레이아웃. */
  isPhone: boolean;
  /** 768 ~ 1023 (웹 전용). */
  isTablet: boolean;
  /** >= 1024 (웹 전용) — 데스크탑 사이드 네비 + 와이드. */
  isDesktop: boolean;
  /** 웹 플랫폼 여부. */
  isWeb: boolean;
}

export function useResponsive(): Responsive {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';

  // 폭 기준(웹·네이티브 공통). 폰은 세로 고정이라 항상 <768 → isPhone 유지.
  const isDesktop = width >= 1024;
  const isTablet = width >= 768 && width < 1024;
  const isPhone = !isDesktop && !isTablet;

  return { width, isPhone, isTablet, isDesktop, isWeb };
}

/* ───────────────────────────────────────────────────────────────────────────
 * 폴더블(iPhone Duo)·Split View 대응 (2026-09-16)
 *
 * 🔴 여기 있는 훅들이 막으려는 것은 **모듈 최상단에서 폭을 재는 코드**다:
 *
 *     const chartWidth = Dimensions.get('window').width - 64;   // ← 모듈 스코프
 *
 *   이 값은 **모듈이 로드되는 순간 굳어** 다시는 바뀌지 않는다. 폰에서는 폭이 변할 일이
 *   없어 여태 문제가 없었지만, 화면이 실행 중에 바뀌는 기기에서는 전부 어긋난다:
 *     - iPhone Duo 를 접은 채 켜고 펼치면 → 넓은 화면에 좁은 차트가 그대로 남는다
 *     - 펼친 채 켜고 접으면      → 차트가 화면 밖으로 넘친다
 *     - iPad Split View·Stage Manager·웹 창 리사이즈도 같다
 *
 *   `useWindowDimensions` 는 폭이 바뀔 때마다 리렌더를 일으키므로, **렌더 중에 훅으로**
 *   읽어야 한다. `Dimensions.get` 은 그 시점의 스냅샷일 뿐이다.
 * ─────────────────────────────────────────────────────────────────────────── */

/** 접힌 폴더블·최소 Split View 에서도 콘텐츠가 사라지지 않게 두는 하한(px). */
const MIN_CONTENT_WIDTH = 240;

/**
 * 화면 폭에서 좌우 여백을 뺀 **콘텐츠 폭**을 구한다.
 *
 * 폭을 숫자 prop 으로 받는 뷰(react-native-chart-kit 의 `width` 등)에 쓴다.
 * 스타일로 `width: '100%'` 를 줄 수 있는 곳이라면 이 훅이 필요 없다.
 *
 * @param options.maxWidth          상한(px). 데스크탑 웹에서 차트가 끝없이 늘어나는 걸 막는다. 기본 무제한.
 * @param options.horizontalPadding 좌우 여백 합(px). 기본 64.
 * @returns 콘텐츠 폭(px). 아무리 좁아도 {@link MIN_CONTENT_WIDTH} 아래로는 내려가지 않는다
 *          (폭이 0·음수가 되면 차트 라이브러리가 NaN 을 그린다).
 */
export function useContentWidth(options?: {
  maxWidth?: number;
  horizontalPadding?: number;
}): number {
  const { width } = useWindowDimensions();
  const { maxWidth = Number.POSITIVE_INFINITY, horizontalPadding = 64 } = options ?? {};

  return Math.max(MIN_CONTENT_WIDTH, Math.min(width, maxWidth) - horizontalPadding);
}

/**
 * 폭에 맞는 **그리드 열 수**와 **그 열 수에 묶인 key** 를 함께 돌려준다.
 *
 * 🔴 왜 둘을 한 객체로 묶었나 — `numColumns` 가 실행 중에 바뀌면 RN 이 앱을 죽인다
 *    (`Changing numColumns on the fly is not supported`). 피하려면 목록을 `key` 로
 *    **재마운트**시켜야 하는데, 열 수만 받아 가고 key 를 잊으면 그 크래시를 그대로 맞는다.
 *    그래서 **하나만 쓰는 게 불가능하도록** 묶었다(형제 프로젝트가 실제로 겪은 사고).
 *    ⚠️ `key="note-grid"` 같은 **고정 문자열은 두 목록을 구분할 뿐, 같은 목록의 열 변화는 못 막는다.**
 *
 * ⚠️ `cols` 를 **일부러 소문자**로 뒀다. 검사 스크립트가 대문자 이름을 «상수»로 보고 지나쳐서,
 *    대문자로 두면 이 값이 런타임에 변한다는 사실이 검사에서 가려진다.
 *
 * ⚠️ 열이 1 이 되면 `columnWrapperStyle` 을 넘기지 말 것(RN 이 경고를 낸다).
 *    `columnWrapperStyle={cols > 1 ? styles.row : undefined}` 형태로 쓴다.
 *
 * @param options.minColumnWidth    한 칸의 최소 폭(px). 이 값으로 열 수가 정해진다. 기본 160.
 * @param options.maxColumns        상한 열 수. 넓은 화면에서 칸이 잘게 쪼개지는 걸 막는다. 기본 4.
 * @param options.horizontalPadding 목록 좌우 여백 합(px). 기본 0.
 * @returns `{ cols, gridKey }` — 둘 다 써야 한다. `key={gridKey} numColumns={cols}`
 *
 * @example
 * const { cols, gridKey } = useGridColumns({ minColumnWidth: 140, maxColumns: 3 });
 * <FlatList key={gridKey} numColumns={cols} ... />
 */
export function useGridColumns(options?: {
  minColumnWidth?: number;
  maxColumns?: number;
  horizontalPadding?: number;
}): { cols: number; gridKey: string } {
  const { width } = useWindowDimensions();
  const { minColumnWidth = 160, maxColumns = 4, horizontalPadding = 0 } = options ?? {};

  // 여백을 뺀 실제 배치 가능 폭. 한 칸도 못 넣을 만큼 좁아도 최소 1열은 나오게 바닥을 받친다.
  const usable = Math.max(width - horizontalPadding, minColumnWidth);
  const cols = Math.min(maxColumns, Math.max(1, Math.floor(usable / minColumnWidth)));

  return { cols, gridKey: `grid-${cols}` };
}
