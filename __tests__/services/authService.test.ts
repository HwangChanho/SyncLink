/**
 * __tests__/services/authService.test.ts
 *
 * TASK-110: Auth Test Suite — authService.ts 유닛 테스트
 *
 * 전략:
 *  - @/lib/supabase를 jest.mock으로 완전 대체 → 실제 Supabase 네트워크 호출 차단
 *  - GoogleSignin, AppleAuthentication, WebBrowser, Linking 모두 mock
 *  - jest.setup.js의 @supabase/supabase-js mock은 @/lib/supabase mock과 별개로 동작
 *
 * 커버리지:
 *  signInWithGoogle  — 정상 흐름 (v12 / v13 API), 취소, 에러
 *  signInWithKakao   — 네이티브 SDK 흐름: 정상, 사용자 취소, Edge 에러/응답불량, 세션 실패
 *  signInWithApple   — 정상 흐름, 취소, identityToken 없음
 *  signOut           — 정상, GoogleSignin 실패 무시, Supabase 에러
 *  getSession        — 세션 있음 / 없음 / Supabase 에러
 *  refreshSession    — 정상, 세션 없음, 에러
 *  onAuthStateChange — 등록 확인, unsubscribe, 콜백 세션 유무
 *  getUserProfile    — 조회 성공, 사용자 없음, DB 에러
 *  updateProfile     — 정상, 미인증, getUser 에러
 *  deleteAccount     — 미구현 throw 확인
 *
 * @task TASK-110
 */

// ─── Mock 선언 (jest.mock은 파일 최상단으로 호이스팅됨) ───────────────────────

// GoogleSignin.configure()가 모듈 로드 시 호출되므로 반드시 mock 필요
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: {
    FULL_NAME: 'fullName',
    EMAIL: 'email',
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn().mockReturnValue('synclink://auth/callback'),
}));

// @/lib/supabase 전체를 대체 — 실제 createClient 호출 차단
jest.mock('@/lib/supabase', () => ({
  // authService.signInWithKakao reads these constants to build the
  // kakao-auth Edge Function URL. Provide deterministic test values here
  // so the tests don't depend on babel's inline-env-vars behavior.
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  supabase: {
    auth: {
      signInWithIdToken: jest.fn(),
      signInWithOAuth: jest.fn(),
      signInWithPassword: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      getSession: jest.fn(),
      refreshSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(),
      // TASK-002 / ADR-010: multi-provider linkIdentity
      linkIdentity: jest.fn(),
      unlinkIdentity: jest.fn(),
      getUserIdentities: jest.fn(),
    },
    from: jest.fn(),
    // Edge Functions client — used by deleteAccount
    functions: {
      invoke: jest.fn(),
    },
  },
}));

// fetch — kakao-auth Edge Function 호출을 가로채기 위해 jest.fn()으로 덮어씀.
// 각 테스트에서 필요에 따라 mockResolvedValueOnce로 응답을 지정한다.
const fetchMock = jest.fn();
(globalThis as Record<string, unknown>).fetch = fetchMock;

// KAKAO REST API 키는 babel.config.js에서 transform 시점에 이미 인라인된다.
// SUPABASE_URL / SUPABASE_ANON_KEY는 위 jest.mock('@/lib/supabase')에서 제공.

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
// 2026-08-15~ Kakao 는 네이티브 SDK 로 로그인한다(카카오톡 앱으로 전환).
// 실제 mock 은 jest.setup.js 에 있고, 여기서는 반환값만 테스트별로 덮어쓴다.
import { login as kakaoNativeLogin } from '@react-native-kakao/user';
import { supabase } from '@/lib/supabase';
import {
  signInWithGoogle,
  signInWithKakao,
  signInWithApple,
  signOut,
  getSession,
  refreshSession,
  onAuthStateChange,
  getUserProfile,
  updateProfile,
  deleteAccount,
  linkProvider,
  unlinkProvider,
  getLinkedProviders,
} from '@/services/authService';
import type { UserRow } from '@/types';

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

/**
 * 기존 유저 세션 픽스처 (created_at이 60초 전 → isNewUser = false).
 */
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  },
  access_token: 'access-token-abc',
  refresh_token: 'refresh-token-xyz',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

/**
 * 신규 유저 세션 픽스처 (created_at이 5초 전 → isNewUser = true).
 */
const mockNewUserSession = {
  ...mockSession,
  user: {
    ...mockSession.user,
    created_at: new Date(Date.now() - 5_000).toISOString(),
  },
};

/** public.users 테이블 row 픽스처 */
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

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * supabase.from() 체이닝 mock을 설정하는 헬퍼.
 *
 * select / eq / update 등 모든 체이닝 메서드가 `mockReturnThis()`를 반환하므로,
 * 체인 순서에 무관하게 마지막 `.single()` 반환값만 제어하면 됩니다.
 *
 * @param resolvedValue - single()이 resolve할 { data, error } 값
 * @returns single mock 함수 (추가 assertion에 사용 가능)
 */
function setupFromMock(resolvedValue: { data: unknown; error: unknown }) {
  const singleMock = jest.fn().mockResolvedValue(resolvedValue);
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    single: singleMock,
  });
  return singleMock;
}

/**
 * signInWithGoogle / signInWithKakao / signInWithApple 정상 경로에서
 * buildSignInResult가 공통으로 사용하는 Supabase mock을 설정합니다.
 *
 * - supabase.from('users').select('*').eq('id', ...).single() → mockUserRow
 */
function setupBuildSignInResultMock() {
  setupFromMock({ data: mockUserRow, error: null });
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('authService', () => {
  beforeEach(() => {
    // 각 테스트 전 모든 mock 상태 초기화
    jest.clearAllMocks();
    // buildSignInResult에서 사용하는 from mock 기본값 설정
    setupBuildSignInResultMock();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signInWithGoogle
  // ══════════════════════════════════════════════════════════════════════════

  describe('signInWithGoogle', () => {
    it('정상 흐름 (v12 API): idToken 직접 반환 시 Supabase 세션 생성', async () => {
      // GoogleSignin v12 — { idToken: '...' } 직접 반환
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'google-id-token' });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await signInWithGoogle();

      // Play Services 확인 호출 검증
      expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
        showPlayServicesUpdateDialog: true,
      });
      // Supabase에 Google 토큰 전달 검증
      expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: 'google',
        token: 'google-id-token',
      });
      // 반환값 검증
      expect(result.session.userId).toBe('user-123');
      expect(result.session.email).toBe('test@example.com');
      expect(result.session.accessToken).toBe('access-token-abc');
      expect(result.session.refreshToken).toBe('refresh-token-xyz');
      expect(result.session.expiresAt).toBeInstanceOf(Date);
      expect(result.user).toEqual(mockUserRow);
      // 60초 전 가입 = 기존 유저
      expect(result.isNewUser).toBe(false);
    });

    it('정상 흐름 (v13 API): data.idToken 중첩 구조에서 idToken 추출', async () => {
      // GoogleSignin v13 — { type: 'success', data: { idToken: '...' } }
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
        type: 'success',
        data: { idToken: 'google-id-token-v13' },
      });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await signInWithGoogle();

      expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: 'google',
        token: 'google-id-token-v13',
      });
      expect(result.session.userId).toBe('user-123');
    });

    it('신규 유저: nickname 미설정(null) → isNewUser = true', async () => {
      // authService now determines isNewUser by nickname absence, not created_at.
      // Provide a userRow without a nickname to trigger the new-user path.
      setupFromMock({ data: { ...mockUserRow, nickname: null }, error: null });
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'google-id-token' });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await signInWithGoogle();

      expect(result.isNewUser).toBe(true);
    });

    it('취소: statusCodes.SIGN_IN_CANCELLED → "cancelled" 에러 throw', async () => {
      // Google statusCode 에러 객체
      const cancelError = Object.assign(new Error('Sign in cancelled'), {
        code: statusCodes.SIGN_IN_CANCELLED,
      });
      (GoogleSignin.signIn as jest.Mock).mockRejectedValue(cancelError);

      await expect(signInWithGoogle()).rejects.toThrow('cancelled');
    });

    it('취소: v13 type=cancelled 반환 → "cancelled" 에러 throw', async () => {
      // v13에서 취소 시 { type: 'cancelled', data: {} } 반환
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'cancelled', data: {} });

      await expect(signInWithGoogle()).rejects.toThrow('cancelled');
    });

    it('취소: v13 type=noSavedCredentialFound 반환 → "cancelled" 에러 throw', async () => {
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
        type: 'noSavedCredentialFound',
        data: {},
      });

      await expect(signInWithGoogle()).rejects.toThrow('cancelled');
    });

    it('이미 진행 중: statusCodes.IN_PROGRESS → 적절한 에러 메시지 throw', async () => {
      const inProgressError = Object.assign(new Error('In progress'), {
        code: statusCodes.IN_PROGRESS,
      });
      (GoogleSignin.signIn as jest.Mock).mockRejectedValue(inProgressError);

      await expect(signInWithGoogle()).rejects.toThrow(
        'Google 로그인이 이미 진행 중입니다.',
      );
    });

    it('Play Services 없음: statusCodes.PLAY_SERVICES_NOT_AVAILABLE → 에러 throw', async () => {
      const playServicesError = Object.assign(new Error('Play services unavailable'), {
        code: statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
      });
      (GoogleSignin.signIn as jest.Mock).mockRejectedValue(playServicesError);

      await expect(signInWithGoogle()).rejects.toThrow(
        'Google 로그인 서비스를 사용할 수 없습니다.',
      );
    });

    it('Supabase 에러: signInWithIdToken 실패 시 에러 throw', async () => {
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'google-id-token' });
      const supabaseError = new Error('Supabase auth error');
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: {},
        error: supabaseError,
      });

      await expect(signInWithGoogle()).rejects.toThrow('Supabase auth error');
    });

    it('세션 없음: signInWithIdToken이 session=null 반환 → 에러 throw', async () => {
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'google-id-token' });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(signInWithGoogle()).rejects.toThrow('세션을 생성하지 못했습니다.');
    });

    it('idToken 없음 + 알 수 없는 type: "Google ID 토큰을 받지 못했습니다." 에러 throw', async () => {
      // v13 API에서 idToken이 없고 type이 cancelled/noSavedCredentialFound도 아닌 경우
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({
        type: 'unknownError',
        data: {},
      });

      await expect(signInWithGoogle()).rejects.toThrow(
        'Google ID 토큰을 받지 못했습니다. 다시 시도해 주세요.',
      );
    });

    it('buildSignInResult: userRow fetch 실패 → "사용자 프로필을 불러오지 못했습니다." 에러 throw', async () => {
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'google-id-token' });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      // handle_new_user 트리거 미실행 등으로 userRow가 없는 경우
      setupFromMock({ data: null, error: new Error('row not found') });

      await expect(signInWithGoogle()).rejects.toThrow(
        '사용자 프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signInWithKakao
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * signInWithKakao — 네이티브 SDK 흐름 (2026-08-15~)
   *
   * 종전에는 kauth.kakao.com 을 WebBrowser 로 열어 code 를 받았는데 성공률이
   * 0% 였다 — 웹뷰가 카카오 "계정" 비밀번호를 요구해서, 카카오톡만 쓰는
   * 사용자가 통과하지 못했다. 지금은 네이티브 SDK 가 카카오톡 앱에 넘긴다:
   *
   *   kakaoNativeLogin() -> accessToken
   *     -> POST kakao-auth Edge Function (서버가 카카오에 토큰을 검증)
   *     -> { email, password } -> supabase.auth.signInWithPassword
   *
   * 웹 플랫폼만 옛 리다이렉트 경로를 유지한다(authService.web.test.ts 참조).
   *
   * 커버리지: 정상 흐름 / 사용자 취소 / Edge 에러 / Edge 응답 불완전 /
   *          JSON 파싱 실패 / signInWithPassword 실패 / session=null
   */
  describe('signInWithKakao', () => {
    /** Edge Function 이 돌려주는 정상 자격 픽스처 */
    const OK_BODY = { email: 'kakao_123@kakao.synclink.app', password: 'derived-password' };

    beforeEach(() => {
      fetchMock.mockReset();
      // 네이티브 로그인 기본값 = 성공. 실패 케이스는 각 테스트에서 덮어쓴다.
      (kakaoNativeLogin as jest.Mock).mockResolvedValue({ accessToken: 'kakao-access-token' });
    });

    /**
     * kakao-auth Edge Function 응답을 mock 한다.
     *
     * @param body   - 응답 JSON 본문
     * @param ok     - res.ok (기본 true)
     * @param status - HTTP 상태 코드 (기본 200)
     */
    function mockEdgeResponse(body: unknown, ok = true, status = 200) {
      fetchMock.mockResolvedValue({ ok, status, json: jest.fn().mockResolvedValue(body) });
    }

    it('정상 흐름: 네이티브 로그인 → accessToken 을 Edge 에 전달 → signInWithPassword', async () => {
      mockEdgeResponse(OK_BODY);
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await signInWithKakao();

      // 카카오톡 앱으로 넘기는 네이티브 로그인을 쓴다 — 웹뷰를 열지 않는다.
      expect(kakaoNativeLogin).toHaveBeenCalledTimes(1);
      expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();

      // 🔴 accessToken 만 서버로 보낸다. 클라이언트가 email 을 만들어 보내면
      //    남의 계정을 가져갈 수 있으므로 검증은 반드시 서버가 한다.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://test.supabase.co/functions/v1/kakao-auth');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ accessToken: 'kakao-access-token' });
      expect(init.headers.apikey).toBe('test-anon-key');

      // Edge 가 돌려준 자격으로만 세션을 만든다.
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith(OK_BODY);
      expect(result.session.userId).toBe('user-123');
      expect(result.user).toEqual(mockUserRow);
    });

    it('사용자가 카카오 화면에서 취소: "cancelled" throw, 서버 호출 없음', async () => {
      (kakaoNativeLogin as jest.Mock).mockRejectedValue(new Error('user cancelled'));

      await expect(signInWithKakao()).rejects.toThrow('cancelled');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('Edge Function 이 에러 반환: 그 메시지를 throw', async () => {
      mockEdgeResponse({ error: 'kakao token invalid' }, false, 401);

      await expect(signInWithKakao()).rejects.toThrow('kakao token invalid');
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('Edge 응답에 password 누락: 에러 throw', async () => {
      mockEdgeResponse({ email: 'only@email.com' });

      await expect(signInWithKakao()).rejects.toThrow('Kakao 로그인 응답이 올바르지 않습니다.');
      expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('Edge 응답이 JSON 이 아님: 에러 throw', async () => {
      // json() 이 throw 하면 코드가 null 로 흡수한다 → 같은 "응답 불량" 경로를 탄다.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });

      await expect(signInWithKakao()).rejects.toThrow('Kakao 로그인 응답이 올바르지 않습니다.');
    });

    it('signInWithPassword 실패: 에러 그대로 throw', async () => {
      mockEdgeResponse(OK_BODY);
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: new Error('Invalid login credentials'),
      });

      await expect(signInWithKakao()).rejects.toThrow('Invalid login credentials');
    });

    it('signInWithPassword session=null: "세션을 생성하지 못했습니다." throw', async () => {
      mockEdgeResponse(OK_BODY);
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(signInWithKakao()).rejects.toThrow('세션을 생성하지 못했습니다.');
    });

    /**
     * 🔴 앱 크래시 방어 (Sentry SYNKLINK-19, Android 1.4.2/vc22)
     *
     * 초기화되지 않은 카카오 SDK 에 login 을 걸면 네이티브 메인스레드 Handler 안에서
     * UninitializedPropertyAccessException 이 터진다. 그건 Android 의
     * UncaughtExceptionHandler 로 올라가 **앱을 강제종료**시키며, JS try/catch 로는
     * 절대 잡을 수 없다. 따라서 유일한 방어는 "호출을 아예 하지 않는 것"이고,
     * 이 테스트는 그 규약이 지켜지는지를 본다.
     *
     * 모듈 스코프에서 초기화하므로, 초기화 실패 상황을 만들려면 모듈을 다시 로드해야 한다.
     */
    it('SDK 초기화 실패 시: 네이티브 로그인을 호출조차 하지 않는다 (앱 크래시 방어)', async () => {
      jest.resetModules();
      /* eslint-disable @typescript-eslint/no-require-imports */
      const core = require('@react-native-kakao/core');
      const user = require('@react-native-kakao/user');
      // 네이티브 모듈이 없는 상황을 재현 — 초기화가 실패한다.
      core.initializeKakaoSDK.mockRejectedValue(new Error('native module unavailable'));
      const freshAuthService = require('@/services/authService');
      /* eslint-enable @typescript-eslint/no-require-imports */

      // 모듈 로드 시 걸어 둔 .catch 가 실행되도록 마이크로태스크 큐를 비운다.
      await Promise.resolve();
      await Promise.resolve();

      await expect(freshAuthService.signInWithKakao()).rejects.toThrow(
        '카카오 로그인을 사용할 수 없습니다',
      );
      // 핵심: 크래시를 유발하는 네이티브 호출이 일어나지 않아야 한다.
      expect(user.login).not.toHaveBeenCalled();

      // 뒤 테스트가 원래 모듈 레지스트리를 쓰도록 되돌린다.
      jest.resetModules();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signInWithApple
  // ══════════════════════════════════════════════════════════════════════════

  describe('signInWithApple', () => {
    it('정상 흐름: Apple identity token으로 Supabase 세션 생성', async () => {
      (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
        identityToken: 'apple-identity-token',
        user: 'apple-user-sub-001',
        email: 'test@privaterelay.appleid.com',
        fullName: { givenName: 'Test', familyName: 'User' },
      });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await signInWithApple();

      // scope 요청 검증
      expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      // Supabase에 Apple 토큰 전달 검증
      expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
        provider: 'apple',
        token: 'apple-identity-token',
      });
      expect(result.session.userId).toBe('user-123');
      expect(result.user).toEqual(mockUserRow);
    });

    it('취소: ERR_REQUEST_CANCELED 에러 → 에러 전파', async () => {
      // Apple Sign In에서 사용자가 취소하면 ERR_REQUEST_CANCELED 코드의 에러를 throw
      const cancelError = Object.assign(new Error('User cancelled the Sign in with Apple flow'), {
        code: 'ERR_REQUEST_CANCELED',
      });
      (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue(cancelError);

      // authService는 Apple 취소 에러를 그대로 전파함 (별도 래핑 없음)
      await expect(signInWithApple()).rejects.toThrow(
        'User cancelled the Sign in with Apple flow',
      );
    });

    it('identityToken 없음: "Apple ID 토큰을 받지 못했습니다." 에러 throw', async () => {
      (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
        identityToken: null,
        user: 'apple-user-sub-001',
      });

      await expect(signInWithApple()).rejects.toThrow(
        'Apple ID 토큰을 받지 못했습니다. 다시 시도해 주세요.',
      );
    });

    it('Supabase 에러: signInWithIdToken 실패 시 에러 throw', async () => {
      (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
        identityToken: 'apple-identity-token',
      });
      const supabaseError = new Error('Apple token validation failed');
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: {},
        error: supabaseError,
      });

      await expect(signInWithApple()).rejects.toThrow('Apple token validation failed');
    });

    it('세션 없음: signInWithIdToken이 session=null 반환 → 에러 throw', async () => {
      (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
        identityToken: 'apple-identity-token',
      });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(signInWithApple()).rejects.toThrow('세션을 생성하지 못했습니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signOut
  // ══════════════════════════════════════════════════════════════════════════

  describe('signOut', () => {
    it('정상 흐름: GoogleSignin.signOut + supabase.auth.signOut 모두 호출', async () => {
      (GoogleSignin.signOut as jest.Mock).mockResolvedValue(undefined);
      (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });

      await signOut();

      expect(GoogleSignin.signOut).toHaveBeenCalledTimes(1);
      expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('GoogleSignin.signOut 실패해도 supabase.auth.signOut 호출됨 (에러 무시)', async () => {
      // Google으로 로그인하지 않은 상태에서 signOut 호출 시 실패할 수 있음
      (GoogleSignin.signOut as jest.Mock).mockRejectedValue(
        new Error('Not signed in with Google'),
      );
      (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });

      // 에러 없이 완료되어야 함
      await expect(signOut()).resolves.toBeUndefined();
      expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('supabase.auth.signOut 에러 시 에러 throw', async () => {
      (GoogleSignin.signOut as jest.Mock).mockResolvedValue(undefined);
      const signOutError = new Error('Supabase sign out failed');
      (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: signOutError });

      await expect(signOut()).rejects.toThrow('Supabase sign out failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getSession
  // ══════════════════════════════════════════════════════════════════════════

  describe('getSession', () => {
    it('세션 있음: AuthSession 형태로 반환', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await getSession();

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-123');
      expect(result!.email).toBe('test@example.com');
      expect(result!.accessToken).toBe('access-token-abc');
      expect(result!.refreshToken).toBe('refresh-token-xyz');
      expect(result!.expiresAt).toBeInstanceOf(Date);
    });

    it('세션 없음: null 반환 (로그아웃 상태)', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await getSession();

      expect(result).toBeNull();
    });

    it('Supabase 에러 시 에러 throw', async () => {
      const sessionError = new Error('Failed to fetch session');
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: sessionError,
      });

      await expect(getSession()).rejects.toThrow('Failed to fetch session');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // refreshSession
  // ══════════════════════════════════════════════════════════════════════════

  describe('refreshSession', () => {
    it('정상 흐름: 갱신된 AuthSession 반환', async () => {
      const refreshedSession = {
        ...mockSession,
        access_token: 'new-access-token-refreshed',
        expires_at: Math.floor(Date.now() / 1000) + 7200,
      };
      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: refreshedSession },
        error: null,
      });

      const result = await refreshSession();

      expect(result.accessToken).toBe('new-access-token-refreshed');
    });

    it('세션 없음: "세션 갱신에 실패했습니다." 에러 throw', async () => {
      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(refreshSession()).rejects.toThrow('세션 갱신에 실패했습니다. 다시 로그인해 주세요.');
    });

    it('Supabase 에러 시 에러 throw', async () => {
      const refreshError = new Error('Refresh token expired');
      (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: refreshError,
      });

      await expect(refreshSession()).rejects.toThrow('Refresh token expired');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // onAuthStateChange
  // ══════════════════════════════════════════════════════════════════════════

  describe('onAuthStateChange', () => {
    it('supabase.auth.onAuthStateChange에 콜백 등록 확인', () => {
      (supabase.auth.onAuthStateChange as jest.Mock).mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      });

      const callback = jest.fn();
      onAuthStateChange(callback);

      expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
      // 내부 래퍼 함수가 등록되어야 함
      expect(supabase.auth.onAuthStateChange).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it('반환값이 unsubscribe 함수인지 확인', () => {
      (supabase.auth.onAuthStateChange as jest.Mock).mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      });

      const unsubscribe = onAuthStateChange(jest.fn());

      expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe 호출 시 subscription.unsubscribe() 실행', () => {
      const mockUnsubscribe = jest.fn();
      (supabase.auth.onAuthStateChange as jest.Mock).mockReturnValue({
        data: { subscription: { unsubscribe: mockUnsubscribe } },
      });

      const unsubscribe = onAuthStateChange(jest.fn());
      unsubscribe();

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('세션 있는 이벤트 → 콜백에 AuthSession 전달', () => {
      // onAuthStateChange가 즉시 SIGNED_IN 이벤트를 발생시키는 케이스
      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation(
        (cb: (event: string, session: typeof mockSession | null) => void) => {
          cb('SIGNED_IN', mockSession);
          return { data: { subscription: { unsubscribe: jest.fn() } } };
        },
      );

      const callback = jest.fn();
      onAuthStateChange(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          email: 'test@example.com',
          accessToken: 'access-token-abc',
        }),
      );
    });

    it('세션 null 이벤트 (SIGNED_OUT) → 콜백에 null 전달', () => {
      (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation(
        (cb: (event: string, session: null) => void) => {
          cb('SIGNED_OUT', null);
          return { data: { subscription: { unsubscribe: jest.fn() } } };
        },
      );

      const callback = jest.fn();
      onAuthStateChange(callback);

      expect(callback).toHaveBeenCalledWith(null);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getUserProfile
  // ══════════════════════════════════════════════════════════════════════════

  describe('getUserProfile', () => {
    it('정상 흐름: userId로 UserRow 반환', async () => {
      setupFromMock({ data: mockUserRow, error: null });

      const result = await getUserProfile('user-123');

      // from('users')에 올바른 테이블명 전달 검증
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(result).toEqual(mockUserRow);
    });

    it('사용자 없음: data=null → null 반환 (에러 throw 없음)', async () => {
      setupFromMock({ data: null, error: null });

      const result = await getUserProfile('nonexistent-user-id');

      expect(result).toBeNull();
    });

    it('DB 에러: null 반환 (에러를 throw하지 않음)', async () => {
      setupFromMock({ data: null, error: new Error('DB connection error') });

      const result = await getUserProfile('user-123');

      // getUserProfile은 에러를 throw하지 않고 null을 반환
      expect(result).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateProfile
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateProfile', () => {
    it('정상 흐름: 닉네임 업데이트 후 업데이트된 UserRow 반환', async () => {
      // 인증된 사용자 반환
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      const updatedRow = { ...mockUserRow, nickname: 'NewNickname' };
      // update 체인 mock: from().update().eq().select().single()
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: updatedRow, error: null }),
      });

      const result = await updateProfile({ nickname: 'NewNickname' });

      expect(supabase.auth.getUser).toHaveBeenCalled();
      expect(result.nickname).toBe('NewNickname');
    });

    it('아바타 URL 업데이트: avatar_url 포함 반환', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      const updatedRow = { ...mockUserRow, avatar_url: 'https://storage.example.com/avatar.jpg' };
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: updatedRow, error: null }),
      });

      const result = await updateProfile({
        avatar_url: 'https://storage.example.com/avatar.jpg',
      });

      expect(result.avatar_url).toBe('https://storage.example.com/avatar.jpg');
    });

    it('미인증: getUser가 user=null 반환 → "로그인이 필요합니다." 에러 throw', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(updateProfile({ nickname: 'Test' })).rejects.toThrow(
        '로그인이 필요합니다.',
      );
    });

    it('getUser 에러 → "로그인이 필요합니다." 에러 throw', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: new Error('Auth session not found'),
      });

      await expect(updateProfile({ nickname: 'Test' })).rejects.toThrow(
        '로그인이 필요합니다.',
      );
    });

    it('DB update 에러: 에러 throw', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      const updateError = new Error('Update constraint violation');
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: updateError }),
      });

      await expect(updateProfile({ nickname: 'Bad' })).rejects.toThrow(
        'Update constraint violation',
      );
    });

    it('DB update error=null이지만 data=null: "프로필 업데이트에 실패했습니다." 에러 throw', async () => {
      // 에러는 없지만 data가 null인 경우 (예: RLS로 인해 행이 반환되지 않음)
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(updateProfile({ nickname: 'Ghost' })).rejects.toThrow(
        '프로필 업데이트에 실패했습니다.',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // toAuthSession (nullish 브랜치 커버리지)
  // ══════════════════════════════════════════════════════════════════════════

  describe('toAuthSession 내부 nullish 변환', () => {
    it('email이 undefined인 세션: AuthSession.email = null', async () => {
      // email 없는 세션 (Apple 재로그인 시 email 미제공)
      const noEmailSession = {
        ...mockSession,
        user: { ...mockSession.user, email: undefined },
      };
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: noEmailSession },
        error: null,
      });

      const result = await getSession();

      expect(result!.email).toBeNull();
    });

    it('expires_at이 undefined인 세션: expiresAt = Unix epoch (0ms)', async () => {
      // Supabase 세션에서 expires_at 누락 케이스
      const noExpiresSession = { ...mockSession, expires_at: undefined };
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: noExpiresSession },
        error: null,
      });

      const result = await getSession();

      // expires_at ?? 0 → new Date(0 * 1000) = Unix epoch
      expect(result!.expiresAt.getTime()).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteAccount
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteAccount', () => {
    const mockSession = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      user: { id: 'user-123', email: 'test@test.com', created_at: new Date().toISOString() },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    beforeEach(() => {
      // Reset mocks before each test
      (supabase.auth.getSession as jest.Mock).mockReset();
      (supabase.functions.invoke as jest.Mock).mockReset();
      (supabase.auth.signOut as jest.Mock).mockReset();
    });

    it('세션 없음: "로그인이 필요합니다." 에러 throw', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(deleteAccount()).rejects.toThrow('로그인이 필요합니다.');
    });

    it('세션 에러: "로그인이 필요합니다." 에러 throw', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: new Error('session error'),
      });

      await expect(deleteAccount()).rejects.toThrow('로그인이 필요합니다.');
    });

    it('Edge Function 성공: delete-account 호출 후 signOut', async () => {
      // Arrange
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({ error: null });
      (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });

      // Act
      await deleteAccount();

      // Assert: Edge Function called with correct auth header
      expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-account', {
        headers: { Authorization: `Bearer ${mockSession.access_token}` },
      });
      // Assert: local sign-out performed after successful deletion
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });

    it('Edge Function 에러: "계정 삭제에 실패했습니다." 에러 throw', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        error: new Error('Function returned error'),
      });

      await expect(deleteAccount()).rejects.toThrow();
      // signOut should NOT be called when deletion fails
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TASK-002 / ADR-010: linkProvider / unlinkProvider / getLinkedProviders
  // ════════════════════════════════════════════════════════════════════════════

  describe('linkProvider (ISSUE-014 / ADR-010)', () => {
    it('세션 없을 때 throw', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });
      await expect(linkProvider('google')).rejects.toThrow('먼저 로그인');
    });

    /**
     * 네이티브(RN)에서는 linkIdentity 가 브라우저를 자동으로 열지 못한다(window 없음).
     * skipBrowserRedirect 로 OAuth URL 만 받아 WebBrowser 로 직접 열고, 돌아온 콜백의
     * PKCE code 를 exchangeCodeForSession 으로 교환해야 연동이 완료된다(2026-06-05 수정).
     * 이 테스트는 그 3단계가 실제로 이어지는지를 본다 — 예전에는 linkIdentity 호출만
     * 확인해서, RN 에서 아무 일도 일어나지 않던 시절의 코드도 통과했다.
     */
    it('세션 있고 linkIdentity 성공: OAuth URL 을 브라우저로 열고 code 를 교환한다', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 't', refresh_token: 'r', expires_at: 0, user: { id: 'u' } } },
        error: null,
      });
      (supabase.auth.linkIdentity as jest.Mock).mockResolvedValue({
        data: { url: 'https://test.supabase.co/auth/v1/authorize?provider=kakao' },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'success',
        url: 'synclink://auth/callback?code=link-code-123',
      });
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({ error: null });

      await expect(linkProvider('kakao')).resolves.toBeUndefined();

      // URL 만 받아오도록 요청해야 한다(자동 리다이렉트 금지).
      expect(supabase.auth.linkIdentity).toHaveBeenCalledWith({
        provider: 'kakao',
        options: { redirectTo: 'synclink://auth/callback', skipBrowserRedirect: true },
      });
      // 받은 URL 을 실제로 열고, 콜백의 code 를 세션으로 교환한다.
      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
        'https://test.supabase.co/auth/v1/authorize?provider=kakao',
        'synclink://auth/callback',
        { showInRecents: false },
      );
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('link-code-123');
    });

    it('linkIdentity 에러 throw', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { access_token: 't', refresh_token: 'r', expires_at: 0, user: { id: 'u' } } },
        error: null,
      });
      (supabase.auth.linkIdentity as jest.Mock).mockResolvedValue({
        error: new Error('Identity already linked'),
      });
      await expect(linkProvider('apple')).rejects.toThrow('Identity already linked');
    });
  });

  describe('getLinkedProviders', () => {
    it('연결된 provider 배열 반환', async () => {
      (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValue({
        data: { identities: [{ provider: 'google' }, { provider: 'kakao' }] },
        error: null,
      });
      await expect(getLinkedProviders()).resolves.toEqual(['google', 'kakao']);
    });

    it('identities 없으면 빈 배열', async () => {
      (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValue({
        data: { identities: [] },
        error: null,
      });
      await expect(getLinkedProviders()).resolves.toEqual([]);
    });
  });

  describe('unlinkProvider', () => {
    it('해당 provider identity 찾아 unlink', async () => {
      const target = { provider: 'kakao', id: 'iden-123' };
      (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValue({
        data: { identities: [{ provider: 'google', id: 'g' }, target] },
        error: null,
      });
      (supabase.auth.unlinkIdentity as jest.Mock).mockResolvedValue({ error: null });
      await expect(unlinkProvider('kakao')).resolves.toBeUndefined();
      expect(supabase.auth.unlinkIdentity).toHaveBeenCalledWith(target);
    });

    it('연결 안 된 provider 해제 시 throw', async () => {
      (supabase.auth.getUserIdentities as jest.Mock).mockResolvedValue({
        data: { identities: [{ provider: 'google', id: 'g' }] },
        error: null,
      });
      await expect(unlinkProvider('apple')).rejects.toThrow('연결되지 않았습니다');
    });
  });
});
