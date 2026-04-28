/**
 * __tests__/hooks/useColors.test.ts
 *
 * TASK-611: useColors 훅 테스트 스위트
 *
 * 커버리지:
 *  resolvedScheme='light' → light 토큰 반환
 *  resolvedScheme='dark'  → dark 토큰 반환
 *  appearanceStore 구독: resolvedScheme 변경 시 자동 갱신
 *  반환 타입: light / dark 모든 key가 string 타입
 *  OS 변경(system 모드): _syncSystemScheme 호출 시 useColors 결과 갱신
 *
 * Mock 전략:
 *  - react-native를 TDZ-safe 팩토리로 mock
 *    (Appearance.getColorScheme, Appearance.addChangeListener)
 *  - AsyncStorage: 공식 jest mock 사용
 *  - useColors는 Zustand 훅을 내부적으로 사용하므로,
 *    @testing-library/react-hooks의 renderHook으로 컴포넌트 컨텍스트를 제공
 *  - useAppearanceStore.setState()로 스토어 상태를 강제 변경하여 동작 검증
 *
 * 선택 이유:
 *  renderHook을 사용한 이유: useColors 내부의 Zustand useCallback(useStore)이
 *  React 훅 규칙을 따르므로 반드시 컴포넌트/훅 컨텍스트 내에서 호출해야 합니다.
 *  renderHook은 내부적으로 테스트 컴포넌트를 생성하여 이 제약을 충족시킵니다.
 *
 * @task TASK-611
 */

// This test verifies real useColors — override the global mock in jest.setup.js.
jest.unmock('@/hooks/useColors');

// Mock OS scheme control (used by system-mode tests).
const mockOsScheme = { value: 'light' as 'light' | 'dark' };

// Mock appearanceStore: full Zustand store without triggering Appearance.getColorScheme()
// during initialization (react-native native mock ordering issue in Jest).
jest.mock('@/stores/appearanceStore', () => {
  const { create } = require('zustand');
  const { ACCENT_PRESETS } = require('@/lib/themePalette');

  // useAppearanceStore must be declared before the actions reference it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useAppearanceStore: any = create(() => ({
    colorScheme:      'system',
    resolvedScheme:   'light',
    accentHue:        ACCENT_PRESETS.default,
    accentPreset:     'default',
    headerTitleColor: 'default',
  }));

  // Actions that mutate store state (mirrors real implementation)
  useAppearanceStore.getState().setColorScheme = (scheme: string) => {
    const resolved = scheme === 'system' ? mockOsScheme.value : scheme;
    useAppearanceStore.setState({ colorScheme: scheme, resolvedScheme: resolved });
  };
  useAppearanceStore.getState()._syncSystemScheme = (os: string) => {
    if (useAppearanceStore.getState().colorScheme === 'system') {
      useAppearanceStore.setState({ resolvedScheme: os });
    }
  };
  useAppearanceStore.getState().setAccentPreset = (preset: string) => {
    useAppearanceStore.setState({ accentPreset: preset, accentHue: ACCENT_PRESETS[preset] });
  };
  useAppearanceStore.getState().setAccentHue = (hue: number) => {
    useAppearanceStore.setState({ accentHue: hue, accentPreset: null });
  };
  useAppearanceStore.getState().setHeaderTitleColor = jest.fn();

  return { useAppearanceStore, ACCENT_PRESETS };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ─── Imports ──────────────────────────────────────────────────────────────────

import { renderHook, act } from '@testing-library/react-native';
import { useColors } from '@/hooks/useColors';
import { useAppearanceStore } from '@/stores/appearanceStore';
import { buildPalette, ACCENT_PRESETS } from '@/lib/themePalette';

// Expected values based on buildPalette (v2 theme system)
const DEFAULT_HUE = ACCENT_PRESETS.default; // 258 (violet)
const light = buildPalette(DEFAULT_HUE, false);
const dark  = buildPalette(DEFAULT_HUE, true);

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('useColors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOsScheme.value = 'light';
    // Reset store to default state (system + light)
    useAppearanceStore.setState({
      colorScheme:    'system',
      resolvedScheme: 'light',
      accentHue:      DEFAULT_HUE,
      accentPreset:   'default',
    });
    // Re-attach action functions (clearAllMocks may reset jest.fn() implementations)
    useAppearanceStore.getState().setColorScheme = (scheme: string) => {
      const resolved = scheme === 'system' ? mockOsScheme.value : scheme;
      useAppearanceStore.setState({ colorScheme: scheme, resolvedScheme: resolved });
    };
    useAppearanceStore.getState()._syncSystemScheme = (os: string) => {
      if (useAppearanceStore.getState().colorScheme === 'system') {
        useAppearanceStore.setState({ resolvedScheme: os });
      }
    };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 기본 동작: resolvedScheme에 따른 토큰 반환
  // ══════════════════════════════════════════════════════════════════════════

  describe('resolvedScheme에 따른 색상 토큰 반환', () => {
    it("resolvedScheme='light' → light 토큰 반환", () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());

      expect(result.current).toEqual(light);
    });

    it("resolvedScheme='dark' → dark 토큰 반환", () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      const { result } = renderHook(() => useColors());

      expect(result.current).toEqual(dark);
    });

    it("resolvedScheme='light' 시 dark 토큰과 다름", () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());

      expect(result.current).not.toEqual(dark);
    });

    it("resolvedScheme='dark' 시 light 토큰과 다름", () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      const { result } = renderHook(() => useColors());

      expect(result.current).not.toEqual(light);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 핵심 색상 토큰 검증
  // ══════════════════════════════════════════════════════════════════════════

  describe('반환 토큰 구조 검증', () => {
    it('light 토큰의 모든 값이 string 타입', () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());

      Object.values(result.current).forEach(value => {
        expect(typeof value).toBe('string');
      });
    });

    it('dark 토큰의 모든 값이 string 타입', () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      const { result } = renderHook(() => useColors());

      Object.values(result.current).forEach(value => {
        expect(typeof value).toBe('string');
      });
    });

    it('light / dark 토큰의 key 집합이 동일함', () => {
      const lightKeys = Object.keys(light).sort();
      const darkKeys  = Object.keys(dark).sort();

      expect(lightKeys).toEqual(darkKeys);
    });

    it("light 토큰에 'primary' 키 존재", () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());

      expect(result.current).toHaveProperty('primary');
    });

    it("dark 토큰에 'background' 키 존재", () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      const { result } = renderHook(() => useColors());

      expect(result.current).toHaveProperty('background');
    });

    it('light.background 와 dark.background 는 다른 값', () => {
      expect(light.background).not.toBe(dark.background);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // appearanceStore 구독 동작
  // ══════════════════════════════════════════════════════════════════════════

  describe('appearanceStore 구독 (resolvedScheme 변경 감지)', () => {
    it('setColorScheme("dark") 호출 후 useColors() → dark 토큰으로 갱신', () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());
      // 초기: light 토큰
      expect(result.current).toEqual(light);

      // 스토어 상태 변경 → 훅이 rerender되어 새 값 반영
      act(() => {
        useAppearanceStore.getState().setColorScheme('dark');
      });

      expect(result.current).toEqual(dark);
    });

    it('setColorScheme("light") 호출 후 useColors() → light 토큰으로 갱신', () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      const { result } = renderHook(() => useColors());
      expect(result.current).toEqual(dark);

      act(() => {
        useAppearanceStore.getState().setColorScheme('light');
      });

      expect(result.current).toEqual(light);
    });

    it('system 모드에서 OS가 dark → dark 토큰 반환', () => {
      mockOsScheme.value = 'dark';

      const { result } = renderHook(() => useColors());

      act(() => {
        useAppearanceStore.getState().setColorScheme('system');
      });

      expect(useAppearanceStore.getState().resolvedScheme).toBe('dark');
      expect(result.current).toEqual(dark);
    });

    it('system 모드에서 OS가 light → light 토큰 반환', () => {
      mockOsScheme.value = 'light';

      const { result } = renderHook(() => useColors());

      act(() => {
        useAppearanceStore.getState().setColorScheme('system');
      });

      expect(useAppearanceStore.getState().resolvedScheme).toBe('light');
      expect(result.current).toEqual(light);
    });

    it('_syncSystemScheme("dark") 호출 시 system 모드에서 dark 토큰으로 전환', () => {
      useAppearanceStore.setState({ colorScheme: 'system', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());
      expect(result.current).toEqual(light);

      act(() => {
        useAppearanceStore.getState()._syncSystemScheme('dark');
      });

      expect(result.current).toEqual(dark);
    });

    it('_syncSystemScheme("light") 호출 시 system 모드에서 light 토큰으로 전환', () => {
      useAppearanceStore.setState({ colorScheme: 'system', resolvedScheme: 'dark' });

      const { result } = renderHook(() => useColors());
      expect(result.current).toEqual(dark);

      act(() => {
        useAppearanceStore.getState()._syncSystemScheme('light');
      });

      expect(result.current).toEqual(light);
    });

    it('system 모드가 아닐 때 _syncSystemScheme → 토큰 변경 없음', () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result } = renderHook(() => useColors());
      expect(result.current).toEqual(light);

      act(() => {
        // 수동 light 모드에서 OS 변경 이벤트 발생 → 무시되어야 함
        useAppearanceStore.getState()._syncSystemScheme('dark');
      });

      expect(result.current).toEqual(light);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 연속 호출 일관성
  // ══════════════════════════════════════════════════════════════════════════

  describe('연속 호출 일관성', () => {
    it('같은 스토어 상태에서 rerender 후에도 동일한 참조 반환', () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      const { result, rerender } = renderHook(() => useColors());
      const first = result.current;

      rerender();
      const second = result.current;

      // light 토큰은 항상 같은 light 상수 객체를 가리킴
      expect(first).toBe(second);
    });

    it('dark 모드도 rerender 후 동일 참조 반환', () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      const { result, rerender } = renderHook(() => useColors());
      const first = result.current;

      rerender();

      expect(result.current).toBe(first);
    });
  });
});
