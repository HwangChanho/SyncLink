/**
 * useColors — 현재 테마의 색상 토큰을 반환하는 훅.
 *
 * v1 (TASK-502): light/dark 정적 팔레트만 반환
 * v2 (TASK-5xx): accentHue + isDark 기반 동적 팔레트 반환 (buildPalette)
 *
 * 동작 원리:
 *  1. appearanceStore 에서 resolvedScheme(light/dark) 와 accentHue(0-360) 구독
 *  2. buildPalette(accentHue, isDark) 로 ColorTokens 생성
 *  3. accentHue = ACCENT_PRESETS.default(258, violet) 일 때 기존 팔레트와 시각적으로 동일
 *
 * 사용법:
 *  ```tsx
 *  const colors = useColors();
 *  <View style={{ backgroundColor: colors.background }} />
 *  ```
 *
 * Migration:
 *  기존 `import { light as colors } from '@/constants/colors'` 사용처는
 *  `useColors()` 로 교체하면 동적 테마 지원이 자동으로 활성화된다.
 *
 * TASK-502 (Sprint 5) → TASK-520 (Sprint 5 전체 테마 확장)
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppearanceStore } from '@/stores/appearanceStore';
import { buildPalette, type ThemePalette } from '@/lib/themePalette';

/**
 * Color token set type.
 * ThemePalette 와 동일한 구조. 기존 컴포넌트의 `colors.background` 등
 * 접근 패턴이 그대로 동작한다.
 *
 * 순환 참조 방지를 위해 ReturnType<typeof buildPalette> 대신
 * ThemePalette 직접 참조.
 */
export type ColorTokens = ThemePalette;

/**
 * 현재 테마(라이트/다크) + accent hue 에 따른 전체 색상 토큰을 반환한다.
 *
 * - resolvedScheme 또는 accentHue 가 변경될 때 자동으로 리렌더된다.
 * - 두 값을 동시에 구독하여 불필요한 리렌더를 최소화한다.
 *
 * @returns ColorTokens — 컴포넌트에서 바로 사용 가능한 색상 토큰 객체
 */
export function useColors(): ColorTokens {
  // useShallow: 객체 selector가 매 렌더마다 새 참조를 반환해도
  // 내부 값이 같으면 리렌더 skip → 무한 재렌더 방지.
  const { resolvedScheme, accentHue } = useAppearanceStore(
    useShallow((state) => ({ resolvedScheme: state.resolvedScheme, accentHue: state.accentHue })),
  );

  const isDark = resolvedScheme === 'dark';

  // useMemo: 동일 입력(accentHue, isDark)에서 같은 객체 참조 반환 →
  // 하위 컴포넌트의 불필요한 리렌더 방지 (memo / React.PureComponent 최적화 지원).
  return useMemo(() => buildPalette(accentHue, isDark), [accentHue, isDark]);
}
