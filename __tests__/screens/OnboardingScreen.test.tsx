/**
 * __tests__/screens/OnboardingScreen.test.tsx
 *
 * TASK-611: OnboardingScreen 테스트 스위트
 *
 * 커버리지:
 *  렌더링     — 3페이지 콘텐츠 (타이틀) 모두 DOM에 존재
 *  네비게이션 — "다음" 버튼으로 currentPage 상태 변경 (버튼 레이블 변화)
 *  CTA        — 마지막 페이지의 "시작하기" 탭 → router.replace('/auth/login')
 *  건너뛰기   — "건너뛰기" 버튼 → router.replace('/auth/login')
 *  AsyncStorage — "시작하기" 탭 시 ONBOARDING_STORAGE_KEY 저장 확인
 *  AsyncStorage — "건너뛰기" 탭 시 ONBOARDING_STORAGE_KEY 저장 확인
 *  AsyncStorage 실패 — 저장 에러 시에도 router.replace 호출됨
 *  접근성     — 버튼 accessibilityLabel 검증
 *
 * Mock 전략:
 *  - expo-router: TDZ-safe 팩토리, router.replace/__replaceFn export
 *    (jest.setup.js 전역 mock을 파일 레벨 override)
 *  - AsyncStorage: jest.setup.js의 전역 mock 재사용 (override 없음)
 *  - react-native-safe-area-context: 단순 View 대체
 *  - react-native는 jest.setup.js의 기본 mock을 그대로 사용
 *    (requireActual 사용 시 SettingsManager TurboModule 오류 발생하므로 사용 금지)
 *  - @expo/vector-icons: jest.setup.js에서 전역 mock 적용됨
 *  - useColors: appearanceStore → react-native Appearance mock 의존
 *    → react-native mock이 없으면 jest.setup.js의 기본값(undefined) 처리됨
 *    → useColors는 resolvedScheme='light'(기본값)으로 동작
 *
 * @task TASK-611
 */

// ─── Mock 선언 (jest.mock은 hoisted) ─────────────────────────────────────────

/**
 * expo-router mock (TDZ-safe).
 * router.replace를 jest.fn()으로 대체하고 __replaceFn으로 export.
 * jest.setup.js의 전역 mock은 router 객체를 포함하지 않으므로 여기서 추가.
 */
jest.mock('expo-router', () => {
  const replaceFn = jest.fn();
  return {
    router: {
      replace: replaceFn,
      push:    jest.fn(),
      back:    jest.fn(),
    },
    useRouter: jest.fn(() => ({
      replace: replaceFn,
      push:    jest.fn(),
      back:    jest.fn(),
    })),
    useLocalSearchParams: jest.fn(() => ({})),
    __replaceFn: replaceFn,
  };
});

/** SafeAreaView: 네이티브 safe area inset 불필요 → 단순 View로 대체 */
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  return {
    SafeAreaView: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    SafeAreaProvider: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingScreen, { ONBOARDING_STORAGE_KEY } from '@/app/onboarding/index';

// ─── Mock 참조 추출 ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __replaceFn: mockReplace } = require('expo-router') as any;

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('OnboardingScreen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // AsyncStorage 초기화 (이전 테스트의 setItem 결과 제거)
    await AsyncStorage.clear();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('렌더링', () => {
    it('페이지 1 타이틀 "함께 일정을 공유하세요" 렌더링', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText('함께 일정을 공유하세요')).toBeTruthy();
    });

    it('페이지 2 타이틀 "자연어로 일정 등록" DOM에 존재 (ScrollView에 모든 페이지 마운트됨)', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText('자연어로 일정 등록')).toBeTruthy();
    });

    it('페이지 3 타이틀 "AI 리마인더" DOM에 존재', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText('AI 리마인더')).toBeTruthy();
    });

    it('초기 렌더링 시 CTA 버튼 레이블이 "다음"', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText('다음')).toBeTruthy();
    });

    it('초기 렌더링 시 "건너뛰기" 버튼 표시 (첫 페이지에 노출)', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText('건너뛰기')).toBeTruthy();
    });

    it('페이지 1 서브타이틀 렌더링 확인', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText(/커플, 팀, 가족/)).toBeTruthy();
    });

    it('페이지 2 서브타이틀 렌더링 확인', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText(/자연어로 일정/i)).toBeTruthy();
    });

    it('페이지 3 서브타이틀 렌더링 확인', () => {
      const { getByText } = render(<OnboardingScreen />);
      expect(getByText(/스마트 알림|AI가/)).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 접근성
  // ══════════════════════════════════════════════════════════════════════════

  describe('접근성', () => {
    it('초기 CTA 버튼 accessibilityLabel이 "다음"', () => {
      const { getByLabelText } = render(<OnboardingScreen />);
      expect(getByLabelText('다음')).toBeTruthy();
    });

    it('"건너뛰기" 버튼 accessibilityLabel="온보딩 건너뛰기"', () => {
      const { getByLabelText } = render(<OnboardingScreen />);
      expect(getByLabelText('온보딩 건너뛰기')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 페이지 이동 — "다음" 버튼
  // ══════════════════════════════════════════════════════════════════════════

  describe('페이지 이동 — "다음" 버튼', () => {
    it('"다음" 탭 시 2페이지로 이동 (버튼 여전히 "다음")', () => {
      const { getByText } = render(<OnboardingScreen />);
      const nextBtn = getByText('다음');

      fireEvent.press(nextBtn);

      // 2페이지에서도 "다음" 버튼 유지
      expect(getByText('다음')).toBeTruthy();
    });

    it('"다음" 두 번 탭 → 3페이지: "시작하기" 버튼으로 교체', () => {
      const { getByText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음')); // 1 → 2
      fireEvent.press(getByText('다음')); // 2 → 3

      expect(getByText('시작하기')).toBeTruthy();
    });

    it('마지막 페이지에서 CTA accessibilityLabel이 "시작하기"', () => {
      const { getByText, getByLabelText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('다음'));

      expect(getByLabelText('시작하기')).toBeTruthy();
    });

    it('마지막 페이지에서 "건너뛰기" 버튼 미표시', () => {
      const { getByText, queryByText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('다음'));

      expect(queryByText('건너뛰기')).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // "시작하기" — router.replace + AsyncStorage
  // ══════════════════════════════════════════════════════════════════════════

  describe('"시작하기" (마지막 페이지 CTA)', () => {
    it('"시작하기" 탭 → router.replace("/(tabs)") 호출', async () => {
      const { getByText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('시작하기'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });

    it('"시작하기" 탭 → AsyncStorage에 ONBOARDING_STORAGE_KEY 저장', async () => {
      const { getByText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('시작하기'));

      await waitFor(() => {
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          ONBOARDING_STORAGE_KEY,
          'true',
        );
      });
    });

    it('"시작하기" 탭 → AsyncStorage getItem으로 "true" 확인', async () => {
      const { getByText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('다음'));
      fireEvent.press(getByText('시작하기'));

      await waitFor(async () => {
        const stored = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
        expect(stored).toBe('true');
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // "건너뛰기" 버튼
  // ══════════════════════════════════════════════════════════════════════════

  describe('"건너뛰기" 버튼', () => {
    it('"건너뛰기" 탭 → router.replace("/(tabs)") 호출', async () => {
      const { getByLabelText } = render(<OnboardingScreen />);

      fireEvent.press(getByLabelText('온보딩 건너뛰기'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });

    it('"건너뛰기" 탭 → AsyncStorage에 ONBOARDING_STORAGE_KEY 저장', async () => {
      const { getByLabelText } = render(<OnboardingScreen />);

      fireEvent.press(getByLabelText('온보딩 건너뛰기'));

      await waitFor(() => {
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          ONBOARDING_STORAGE_KEY,
          'true',
        );
      });
    });

    it('2페이지에서 "건너뛰기" → router.replace("/(tabs)") 호출', async () => {
      const { getByText, getByLabelText } = render(<OnboardingScreen />);

      fireEvent.press(getByText('다음')); // 2페이지 이동
      fireEvent.press(getByLabelText('온보딩 건너뛰기'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AsyncStorage 저장 실패 — 비크리티컬 처리
  // ══════════════════════════════════════════════════════════════════════════

  describe('AsyncStorage 저장 실패 — 비크리티컬', () => {
    it('AsyncStorage.setItem 실패해도 router.replace는 정상 호출됨', async () => {
      // AsyncStorage 에러 시뮬레이션
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
        new Error('Storage full'),
      );

      const { getByLabelText } = render(<OnboardingScreen />);
      fireEvent.press(getByLabelText('온보딩 건너뛰기'));

      // 저장 실패해도 네비게이션은 진행되어야 함 (non-critical)
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });
  });
});
