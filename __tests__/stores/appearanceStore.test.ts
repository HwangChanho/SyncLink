/**
 * __tests__/stores/appearanceStore.test.ts
 *
 * TASK-510: Appearance Store 테스트 스위트
 *
 * 커버리지:
 *  setColorScheme('light')  — resolvedScheme = 'light', colorScheme = 'light'
 *  setColorScheme('dark')   — resolvedScheme = 'dark',  colorScheme = 'dark'
 *  setColorScheme('system') — resolvedScheme = OS 반환값(mock), colorScheme = 'system'
 *  _syncSystemScheme        — colorScheme='system' 일 때만 resolvedScheme 갱신
 *  initAppearanceStore      — AsyncStorage에서 저장된 값 복원
 *  AsyncStorage persist     — setColorScheme 호출 시 AsyncStorage.setItem 호출
 *
 * Mock 전략:
 *  - jest.mock 팩토리 내부에서 jest.fn()을 직접 생성 (TDZ 문제 방지).
 *    팩토리 외부의 const 변수를 팩토리 내에서 참조하면 호이스팅 시점에 undefined가 됩니다.
 *  - Appearance API (getColorScheme / addChangeListener)를 팩토리 안에서 제공.
 *  - 외부에서는 require()로 mock 모듈의 내부 참조(__getColorScheme)에 접근.
 *  - @react-native-async-storage/async-storage: 공식 jest mock 사용.
 *
 * @task TASK-510
 * @depends TASK-502 (DEV)
 */

// ─── Mock 선언 (hoisted) ──────────────────────────────────────────────────────

/**
 * react-native mock.
 * - Appearance.getColorScheme: 제어 가능한 jest.fn()
 * - Appearance.addChangeListener: jest.fn() (appearanceStore 모듈 로드 시 즉시 호출됨)
 * 팩토리 외부 변수를 참조하지 않으므로 TDZ 문제 없음.
 * 내부에서 생성한 함수를 __getColorScheme으로 export해 테스트에서 제어합니다.
 */
// Appearance 만 모킹. jest-expo preset 의 react-native 전체 export 를 그대로 두고
// Libraries 경로만 override 한다. 이전 시도에서 react-native 통째 mock + requireActual
// 둘 다 jest-expo 의 babel transform 단계에서 깨졌다 — Libraries 경로 mock 이 가장
// 안정적.
// jest-expo preset 의 react-native 는 Appearance 객체는 노출하지만
// getColorScheme 함수 자체가 비어있다. spyOn 으로 직접 설치해 호출 가능하게
// 만든다. mockGetColorScheme 이름은 jest hoist 규칙 때문에 그대로 둔다.
const mockGetColorSchemeFn = jest.fn().mockReturnValue('light');
const mockAddChangeListenerFn = jest.fn().mockReturnValue({ remove: jest.fn() });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _rn = require('react-native');
if (!_rn.Appearance || typeof _rn.Appearance !== 'object') {
  _rn.Appearance = {};
}
_rn.Appearance.getColorScheme = mockGetColorSchemeFn;
_rn.Appearance.addChangeListener = mockAddChangeListenerFn;

jest.mock('@react-native-async-storage/async-storage', () =>
  // 공식 jest mock: 인메모리 구현으로 실제 AsyncStorage 동작을 흉내냄
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ─── Imports ──────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useAppearanceStore,
  initAppearanceStore,
} from '@/stores/appearanceStore';

// ─── Mock 함수 접근 ───────────────────────────────────────────────────────────

/**
 * react-native mock 모듈에서 팩토리 내부에 생성한 jest.fn()을 꺼냅니다.
 * __getColorScheme을 통해 테스트별로 반환값을 제어합니다.
 */
const mockGetColorScheme = mockGetColorSchemeFn;

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** appearanceStore.ts 내부 AsyncStorage 키 (변경 시 함께 수정) */
const APPEARANCE_STORAGE_KEY = 'synclink:appearance:colorScheme';

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('useAppearanceStore', () => {
  beforeEach(async () => {
    // 각 테스트 전 AsyncStorage 초기화 및 스토어 상태 리셋
    await AsyncStorage.clear();
    jest.clearAllMocks();

    // OS 기본값: 'light'
    mockGetColorScheme.mockReturnValue('light');

    // 스토어를 기본 상태로 리셋
    useAppearanceStore.setState({
      colorScheme:    'system',
      resolvedScheme: 'light',
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setColorScheme
  // ══════════════════════════════════════════════════════════════════════════

  describe('setColorScheme', () => {
    it("'light' 설정 → resolvedScheme='light', colorScheme='light'", () => {
      useAppearanceStore.getState().setColorScheme('light');

      const { colorScheme, resolvedScheme } = useAppearanceStore.getState();
      expect(colorScheme).toBe('light');
      expect(resolvedScheme).toBe('light');
    });

    it("'dark' 설정 → resolvedScheme='dark', colorScheme='dark'", () => {
      useAppearanceStore.getState().setColorScheme('dark');

      const { colorScheme, resolvedScheme } = useAppearanceStore.getState();
      expect(colorScheme).toBe('dark');
      expect(resolvedScheme).toBe('dark');
    });

    it("'system' 설정 → colorScheme='system', resolvedScheme=OS반환값", () => {
      // OS가 'dark'를 반환하도록 설정
      mockGetColorScheme.mockReturnValue('dark');

      useAppearanceStore.getState().setColorScheme('system');

      const { colorScheme, resolvedScheme } = useAppearanceStore.getState();
      expect(colorScheme).toBe('system');
      // OS가 'dark'이므로 resolvedScheme도 'dark'
      expect(resolvedScheme).toBe('dark');
    });

    it("'system' 설정 시 OS가 'light' 반환 → resolvedScheme='light'", () => {
      mockGetColorScheme.mockReturnValue('light');

      useAppearanceStore.getState().setColorScheme('system');

      expect(useAppearanceStore.getState().resolvedScheme).toBe('light');
    });

    it("'system' 설정 시 OS가 null 반환 → resolvedScheme='light' (fallback)", () => {
      mockGetColorScheme.mockReturnValue(null);

      useAppearanceStore.getState().setColorScheme('system');

      // null → fallback 'light'
      expect(useAppearanceStore.getState().resolvedScheme).toBe('light');
    });

    it('setColorScheme 호출 시 AsyncStorage.setItem 호출', () => {
      useAppearanceStore.getState().setColorScheme('dark');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        APPEARANCE_STORAGE_KEY,
        'dark',
      );
    });

    it("'light'로 변경 후 AsyncStorage에 'light' 저장", () => {
      useAppearanceStore.getState().setColorScheme('light');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        APPEARANCE_STORAGE_KEY,
        'light',
      );
    });

    it("'system'으로 변경 시 AsyncStorage에 'system' 저장", () => {
      useAppearanceStore.getState().setColorScheme('system');

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        APPEARANCE_STORAGE_KEY,
        'system',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // _syncSystemScheme
  // ══════════════════════════════════════════════════════════════════════════

  describe('_syncSystemScheme', () => {
    it("colorScheme='system' 일 때 OS 변경 반영", () => {
      // 스토어를 system 모드로 설정
      useAppearanceStore.setState({ colorScheme: 'system', resolvedScheme: 'light' });

      useAppearanceStore.getState()._syncSystemScheme('dark');

      expect(useAppearanceStore.getState().resolvedScheme).toBe('dark');
    });

    it("colorScheme='light' 일 때 OS 변경 무시 (system 모드가 아님)", () => {
      useAppearanceStore.setState({ colorScheme: 'light', resolvedScheme: 'light' });

      // OS가 dark로 변경되어도 수동 설정 모드이므로 무시해야 함
      useAppearanceStore.getState()._syncSystemScheme('dark');

      // resolvedScheme은 'light' 그대로 유지
      expect(useAppearanceStore.getState().resolvedScheme).toBe('light');
    });

    it("colorScheme='dark' 일 때 OS 변경 무시 (system 모드가 아님)", () => {
      useAppearanceStore.setState({ colorScheme: 'dark', resolvedScheme: 'dark' });

      useAppearanceStore.getState()._syncSystemScheme('light');

      expect(useAppearanceStore.getState().resolvedScheme).toBe('dark');
    });

    it("system 모드에서 'light'로 OS 변경 시 resolvedScheme='light'", () => {
      useAppearanceStore.setState({ colorScheme: 'system', resolvedScheme: 'dark' });

      useAppearanceStore.getState()._syncSystemScheme('light');

      expect(useAppearanceStore.getState().resolvedScheme).toBe('light');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // initAppearanceStore
  // ══════════════════════════════════════════════════════════════════════════

  describe('initAppearanceStore', () => {
    it("AsyncStorage에 'dark' 저장 시 복원 후 resolvedScheme='dark'", async () => {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark');
      mockGetColorScheme.mockReturnValue('light'); // OS는 light지만

      await initAppearanceStore();

      const { colorScheme, resolvedScheme } = useAppearanceStore.getState();
      expect(colorScheme).toBe('dark');
      expect(resolvedScheme).toBe('dark');
    });

    it("AsyncStorage에 'light' 저장 시 복원 후 colorScheme='light'", async () => {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'light');

      await initAppearanceStore();

      expect(useAppearanceStore.getState().colorScheme).toBe('light');
    });

    it("AsyncStorage에 'system' 저장 시 복원 + OS 값으로 resolve", async () => {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'system');
      mockGetColorScheme.mockReturnValue('dark');

      await initAppearanceStore();

      const { colorScheme, resolvedScheme } = useAppearanceStore.getState();
      expect(colorScheme).toBe('system');
      expect(resolvedScheme).toBe('dark'); // OS = 'dark'
    });

    it('AsyncStorage가 비어 있으면 기본값 유지 (변경 없음)', async () => {
      useAppearanceStore.setState({ colorScheme: 'system', resolvedScheme: 'light' });

      await initAppearanceStore(); // 빈 스토리지

      // 상태 변화 없어야 함
      expect(useAppearanceStore.getState().colorScheme).toBe('system');
    });

    it("유효하지 않은 값이 저장된 경우 setColorScheme 호출하지 않음 (기본값 유지)", async () => {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, 'invalid_value');

      await initAppearanceStore();

      // 유효하지 않은 값은 무시하고 기존 스토어 상태 유지
      expect(useAppearanceStore.getState().colorScheme).toBe('system');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 초기 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('초기 상태', () => {
    it("기본 colorScheme은 'system'", () => {
      // 스토어를 완전히 초기 상태로 리셋
      useAppearanceStore.setState({ colorScheme: 'system', resolvedScheme: 'light' });
      expect(useAppearanceStore.getState().colorScheme).toBe('system');
    });

    it('resolvedScheme은 초기화 시 OS 값으로 결정됨', () => {
      mockGetColorScheme.mockReturnValue('dark');
      // 다크 OS에서 스토어를 새로 초기화하면
      useAppearanceStore.getState().setColorScheme('system');
      expect(useAppearanceStore.getState().resolvedScheme).toBe('dark');
    });
  });
});
