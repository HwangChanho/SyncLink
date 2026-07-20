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
