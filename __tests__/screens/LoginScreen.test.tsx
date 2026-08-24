/**
 * __tests__/screens/LoginScreen.test.tsx
 *
 * TASK-110: Auth Test Suite — LoginScreen (src/app/auth/login.tsx) 유닛 테스트
 *
 * 전략:
 *  - authService 전체를 jest.mock으로 대체 → 실제 네이티브 모듈 호출 차단
 *  - Platform.OS를 defineProperty로 교체 → iOS/Android 분기 검증
 *  - router.replace가 올바른 경로로 호출되는지 확인
 *
 * 커버리지:
 *  렌더링       — Google/Kakao 버튼 항상 노출, Apple 버튼 iOS 전용
 *  로그인 성공  — 기존 유저 → /(tabs), 신규 유저 → /auth/onboarding
 *  취소         — 'cancelled' 에러 → 에러 메시지 미표시
 *  에러         — 에러 메시지 화면에 표시
 *  로딩 상태    — 버튼 비활성화
 *
 * @task TASK-110
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────
// jest.mock은 파일 최상단으로 호이스팅됨. import보다 먼저 선언해야 함.

// SafeAreaView: 네이티브 safe area inset 불필요 → 단순 View로 대체
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

// expo-router: router.replace를 spy 가능하게 mock
// jest.setup.js의 전역 mock을 이 파일에서 override
jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(false),
  },
  useRouter: jest.fn(() => ({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(false),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  useSegments: jest.fn(() => []),
  Link: ({ children }: { children: unknown }) => children,
  Redirect: () => null,
}));

// useColors is globally mocked in jest.setup.js — no override needed here.

// authService: 실제 네이티브 모듈 호출 없이 mock으로 대체
jest.mock('@/services/authService', () => ({
  signInWithGoogle: jest.fn(),
  signInWithKakao: jest.fn(),
  signInWithApple: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import LoginScreen from '@/app/auth/login';
import {
  signInWithGoogle,
  signInWithKakao,
  signInWithApple,
} from '@/services/authService';
import type { UserRow } from '@/types';
import { APP_BRAND } from '@/constants/config';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** 기존 유저 SignInResult 픽스처 */
const mockUserRow: UserRow = {
  id: 'user-123',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar_url: null,
  push_token: null,
  notification_settings: {
    event_reminders: true,
    partner_changes: true,
    space_invites: true,
    smart_reminders: true,
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** 기존 유저 로그인 성공 결과 */
const mockExistingUserResult = {
  session: {
    userId: 'user-123',
    email: 'test@example.com',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: new Date(),
  },
  user: mockUserRow,
  isNewUser: false,
};

/** 신규 유저 로그인 성공 결과 */
const mockNewUserResult = {
  ...mockExistingUserResult,
  isNewUser: true,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본 플랫폼: iOS (Apple 버튼 노출 상태에서 테스트)
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('렌더링', () => {
    // 브랜드명은 APP_BRAND 하나로 관리한다. 여기서 문자열을 다시 하드코딩하면
    // 다음 리브랜딩 때 이 테스트가 또 혼자 남아 깨진다(2026-08-24 실제로 그랬다).
    it('앱 브랜드 로고 텍스트가 렌더링됨', () => {
      const { getByText } = render(<LoginScreen />);
      expect(getByText(APP_BRAND)).toBeTruthy();
    });

    it('Google 로그인 버튼이 렌더링됨', () => {
      const { getByText } = render(<LoginScreen />);
      expect(getByText('Google로 시작하기')).toBeTruthy();
    });

    it('Kakao 로그인 버튼이 렌더링됨', () => {
      const { getByText } = render(<LoginScreen />);
      expect(getByText('카카오로 시작하기')).toBeTruthy();
    });

    it('iOS: Apple 로그인 버튼이 렌더링됨', () => {
      // Platform.OS는 beforeEach에서 'ios'로 설정됨
      const { getByText } = render(<LoginScreen />);
      expect(getByText('Apple로 시작하기')).toBeTruthy();
    });

    // v1.2.9 부터 Apple 로그인은 web/Android 에서도 쓴다(iOS=네이티브,
    // web/Android=Supabase OAuth 리다이렉트. signInWithApple 내부에서 분기).
    // Build-80 의 "iOS 전용" 결정은 그때 뒤집혔다.
    it('Android: Apple 로그인 버튼도 렌더링됨 (v1.2.9~ web/Android 지원)', () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      const { queryByText } = render(<LoginScreen />);
      expect(queryByText('Apple로 시작하기')).toBeTruthy();
    });

    it('초기 상태에서 에러 메시지가 없음', () => {
      const { queryByText } = render(<LoginScreen />);
      // errorBox는 error !== null 일 때만 렌더링
      expect(queryByText(/오류|error|실패/i)).toBeNull();
    });

    it('법적 고지 텍스트가 렌더링됨', () => {
      const { getByText } = render(<LoginScreen />);
      expect(getByText(/이용약관/)).toBeTruthy();
    });

    it('접근성 레이블: Google 버튼에 accessibilityLabel이 있음', () => {
      const { getByLabelText } = render(<LoginScreen />);
      expect(getByLabelText('Google로 로그인')).toBeTruthy();
    });

    it('접근성 레이블: Kakao 버튼에 accessibilityLabel이 있음', () => {
      const { getByLabelText } = render(<LoginScreen />);
      expect(getByLabelText('카카오로 로그인')).toBeTruthy();
    });

    it('접근성 레이블: Apple 버튼에 accessibilityLabel이 있음 (iOS)', () => {
      const { getByLabelText } = render(<LoginScreen />);
      expect(getByLabelText('Apple로 로그인')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Google 로그인
  // ══════════════════════════════════════════════════════════════════════════

  describe('Google 로그인', () => {
    it('기존 유저: signInWithGoogle 호출 — 라우팅은 가드에 위임', async () => {
      (signInWithGoogle as jest.Mock).mockResolvedValue(mockExistingUserResult);

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        expect(signInWithGoogle).toHaveBeenCalledTimes(1);
        // 🔴 화면은 라우팅하지 않는다. useAuthGuard 가 단독으로 신규→온보딩,
        //    기존→(tabs) 를 처리한다. 예전처럼 여기서 replace 하면 가드와 겹쳐
        //    더블 네비게이션이 난다(2026-06-06 수정).
        expect(router.replace).not.toHaveBeenCalled();
      });
    });

    it('신규 유저: 화면은 라우팅하지 않는다(가드가 온보딩으로 보낸다)', async () => {
      (signInWithGoogle as jest.Mock).mockResolvedValue(mockNewUserResult);

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        // 🔴 화면은 라우팅하지 않는다. useAuthGuard 가 단독으로 신규→온보딩,
        //    기존→(tabs) 를 처리한다. 예전처럼 여기서 replace 하면 가드와 겹쳐
        //    더블 네비게이션이 난다(2026-06-06 수정).
        expect(router.replace).not.toHaveBeenCalled();
      });
    });

    it('취소: "cancelled" 에러 → 에러 메시지를 표시하지 않음', async () => {
      (signInWithGoogle as jest.Mock).mockRejectedValue(new Error('cancelled'));

      const { getByText, queryByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        expect(signInWithGoogle).toHaveBeenCalled();
      });

      // isCancelError('cancelled')가 true → setError 호출 안 됨
      expect(queryByText('cancelled')).toBeNull();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('에러 발생: 에러 메시지가 화면에 표시됨', async () => {
      (signInWithGoogle as jest.Mock).mockRejectedValue(new Error('네트워크 연결 오류'));

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        expect(getByText('네트워크 연결 오류')).toBeTruthy();
      });
    });

    it('이미 진행 중: "Google 로그인이 이미 진행 중입니다." 표시', async () => {
      (signInWithGoogle as jest.Mock).mockRejectedValue(
        new Error('Google 로그인이 이미 진행 중입니다.'),
      );

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        expect(getByText('Google 로그인이 이미 진행 중입니다.')).toBeTruthy();
      });
    });

    it('에러 후 재시도: 새 시도 시 이전 에러 메시지가 지워짐', async () => {
      // 첫 번째 시도: 에러
      (signInWithGoogle as jest.Mock).mockRejectedValueOnce(new Error('첫 번째 오류'));

      const { getByText, queryByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        expect(getByText('첫 번째 오류')).toBeTruthy();
      });

      // 두 번째 시도: 성공
      (signInWithGoogle as jest.Mock).mockResolvedValue(mockExistingUserResult);
      fireEvent.press(getByText('Google로 시작하기'));

      // 버튼 누르는 즉시 setError(null) 호출 → 이전 에러 제거
      await waitFor(() => {
        expect(queryByText('첫 번째 오류')).toBeNull();
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Kakao 로그인
  // ══════════════════════════════════════════════════════════════════════════

  describe('Kakao 로그인', () => {
    it('기존 유저: signInWithKakao 호출 — 라우팅은 가드에 위임', async () => {
      (signInWithKakao as jest.Mock).mockResolvedValue(mockExistingUserResult);

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('카카오로 시작하기'));

      await waitFor(() => {
        expect(signInWithKakao).toHaveBeenCalledTimes(1);
        // 🔴 화면은 라우팅하지 않는다. useAuthGuard 가 단독으로 신규→온보딩,
        //    기존→(tabs) 를 처리한다. 예전처럼 여기서 replace 하면 가드와 겹쳐
        //    더블 네비게이션이 난다(2026-06-06 수정).
        expect(router.replace).not.toHaveBeenCalled();
      });
    });

    it('취소: "cancelled" 에러 → 에러 메시지 미표시, 라우팅 없음', async () => {
      (signInWithKakao as jest.Mock).mockRejectedValue(new Error('cancelled'));

      const { getByText, queryByText } = render(<LoginScreen />);
      fireEvent.press(getByText('카카오로 시작하기'));

      await waitFor(() => {
        expect(signInWithKakao).toHaveBeenCalled();
      });

      expect(queryByText('cancelled')).toBeNull();
      expect(router.replace).not.toHaveBeenCalled();
    });

    it('에러: 에러 메시지가 화면에 표시됨', async () => {
      (signInWithKakao as jest.Mock).mockRejectedValue(
        new Error('카카오 로그인에 실패했습니다.'),
      );

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('카카오로 시작하기'));

      await waitFor(() => {
        expect(getByText('카카오 로그인에 실패했습니다.')).toBeTruthy();
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Apple 로그인 (iOS 전용)
  // ══════════════════════════════════════════════════════════════════════════

  describe('Apple 로그인 (iOS 전용)', () => {
    it('iOS: signInWithApple 호출 — 라우팅은 가드에 위임', async () => {
      // beforeEach에서 Platform.OS = 'ios' 설정됨
      (signInWithApple as jest.Mock).mockResolvedValue(mockExistingUserResult);

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Apple로 시작하기'));

      await waitFor(() => {
        expect(signInWithApple).toHaveBeenCalledTimes(1);
        // 🔴 화면은 라우팅하지 않는다. useAuthGuard 가 단독으로 신규→온보딩,
        //    기존→(tabs) 를 처리한다. 예전처럼 여기서 replace 하면 가드와 겹쳐
        //    더블 네비게이션이 난다(2026-06-06 수정).
        expect(router.replace).not.toHaveBeenCalled();
      });
    });

    it('iOS: 신규 유저도 화면은 라우팅하지 않는다', async () => {
      (signInWithApple as jest.Mock).mockResolvedValue(mockNewUserResult);

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Apple로 시작하기'));

      await waitFor(() => {
        // 🔴 화면은 라우팅하지 않는다. useAuthGuard 가 단독으로 신규→온보딩,
        //    기존→(tabs) 를 처리한다. 예전처럼 여기서 replace 하면 가드와 겹쳐
        //    더블 네비게이션이 난다(2026-06-06 수정).
        expect(router.replace).not.toHaveBeenCalled();
      });
    });

    it('Android: Apple 버튼이 있어도 누르기 전엔 호출되지 않는다', () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

      const { queryByText } = render(<LoginScreen />);

      // v1.2.9~ Android 에서도 버튼을 노출한다(위 렌더링 테스트 참고).
      expect(queryByText('Apple로 시작하기')).toBeTruthy();
      expect(signInWithApple).not.toHaveBeenCalled();
    });

    it('ERR_REQUEST_CANCELED: isCancelError가 false → 에러 메시지 표시', async () => {
      // Apple의 ERR_REQUEST_CANCELED는 message가 'cancelled'가 아님
      // isCancelError는 message.toLowerCase() 기준으로 판단
      // 'User cancelled the Sign in with Apple flow'는 'user_cancelled' 포함
      const cancelError = Object.assign(
        new Error('User cancelled the Sign in with Apple flow'),
        { code: 'ERR_REQUEST_CANCELED' },
      );
      (signInWithApple as jest.Mock).mockRejectedValue(cancelError);

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Apple로 시작하기'));

      // 'canceled'를 포함하므로 isCancelError = true → 에러 메시지 없음
      await waitFor(() => {
        expect(signInWithApple).toHaveBeenCalled();
      });
      // 'canceled' 포함 메시지이므로 에러 미표시
      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 로딩 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('로딩 상태', () => {
    it('로그인 시작 시 버튼이 비활성화됨 (disabled=true)', async () => {
      // signInWithGoogle이 resolve되지 않도록 대기 상태 유지
      let resolveSignIn!: (value: unknown) => void;
      (signInWithGoogle as jest.Mock).mockReturnValue(
        new Promise(resolve => { resolveSignIn = resolve; }),
      );

      const { getByLabelText } = render(<LoginScreen />);

      // act으로 press + 상태 업데이트 flush
      await act(async () => {
        fireEvent.press(getByLabelText('Google로 로그인'));
      });

      // loading !== null → isLoading = true → disabled prop = true
      // toBeDisabled()는 disabled prop 및 accessibilityState.disabled 모두 검사
      expect(getByLabelText('Google로 로그인')).toBeDisabled();

      // cleanup: 미해결 Promise 정리
      await act(async () => { resolveSignIn(mockExistingUserResult); });
    });

    it('로그인 진행 중 다른 버튼 눌러도 중복 요청되지 않음', async () => {
      // 첫 번째 요청이 완료되지 않은 상태
      let resolveSignIn!: (value: unknown) => void;
      (signInWithGoogle as jest.Mock).mockReturnValue(
        new Promise(resolve => { resolveSignIn = resolve; }),
      );

      const { getByText } = render(<LoginScreen />);

      // Google 로그인 시작 + 상태 업데이트 flush
      await act(async () => {
        fireEvent.press(getByText('Google로 시작하기'));
      });

      // Kakao 버튼을 눌러도 signInWithKakao가 호출되지 않음
      // (handleSignIn의 `if (isLoading) return` 가드)
      fireEvent.press(getByText('카카오로 시작하기'));
      expect(signInWithKakao).not.toHaveBeenCalled();

      // cleanup
      await act(async () => { resolveSignIn(mockExistingUserResult); });
    });

    it('로그인 완료 후 버튼이 다시 눌린다(로딩 해제)', async () => {
      (signInWithGoogle as jest.Mock).mockResolvedValue(mockExistingUserResult);

      const { getByLabelText } = render(<LoginScreen />);
      fireEvent.press(getByLabelText('Google로 로그인'));
      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));

      // 라우팅은 가드 몫이라 화면은 replace 하지 않는다. 대신 finally 의
      // setLoading(null) 이 실제로 풀렸는지를 확인한다 — handleSignIn 은 첫 줄에서
      // isLoading 이면 곧장 return 하므로, 두 번째 누름이 먹히면 로딩이 풀린 것이다.
      fireEvent.press(getByLabelText('Google로 로그인'));
      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(2));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 에러 처리
  // ══════════════════════════════════════════════════════════════════════════

  describe('에러 처리', () => {
    it('Error 인스턴스 아닌 에러: 기본 메시지 표시', async () => {
      // err instanceof Error가 false인 경우
      (signInWithGoogle as jest.Mock).mockRejectedValue('string error');

      const { getByText } = render(<LoginScreen />);
      fireEvent.press(getByText('Google로 시작하기'));

      await waitFor(() => {
        expect(getByText('로그인 중 오류가 발생했습니다.')).toBeTruthy();
      });
    });
  });
});
