/**
 * useResponsive — 웹 반응형 레이아웃 분기 훅.
 *
 * 일반 사용자 웹앱(synclink.pages.dev)을 데스크탑/태블릿에서 화면 폭에 맞춰
 * 재배치하기 위한 공통 기준점. `useWindowDimensions` 기반이라 창 리사이즈에
 * 실시간 반응한다.
 *
 * ⚠️ 네이티브 앱(iOS/Android)은 항상 phone 취급한다. 데스크탑 레이아웃은
 *    웹에서만 의미가 있고, 네이티브는 기존 모바일 UX 를 그대로 유지해 회귀를
 *    원천 차단하기 위함이다(폭이 큰 태블릿 기기여도 모바일 레이아웃).
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

  // 네이티브는 폭과 무관하게 phone — 데스크탑 분기에 절대 들어가지 않게 한다.
  const isDesktop = isWeb && width >= 1024;
  const isTablet = isWeb && width >= 768 && width < 1024;
  const isPhone = !isDesktop && !isTablet;

  return { width, isPhone, isTablet, isDesktop, isWeb };
}
