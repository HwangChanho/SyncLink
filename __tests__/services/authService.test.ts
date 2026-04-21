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
 *  signInWithKakao   — 정상 흐름, 브라우저 취소, OAuth 에러
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
  createURL: jest.fn().mockReturnValue('syncday://auth/callback'),
}));

// @/lib/supabase 전체를 대체 — 실제 createClient 호출 차단
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: jest.fn(),
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      getSession: jest.fn(),
      refreshSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(),
    },
    from: jest.fn(),
    // Edge Functions client — used by deleteAccount
    functions: {
      invoke: jest.fn(),
    },
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
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

    it('신규 유저: created_at이 30초 이내 → isNewUser = true', async () => {
      (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'google-id-token' });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
        data: { session: mockNewUserSession },
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
        'Google Play 서비스를 사용할 수 없습니다.',
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

  describe('signInWithKakao', () => {
    it('정상 흐름: OAuth URL 열고 code exchange 완료 후 SignInResult 반환', async () => {
      // 1. Supabase가 Kakao OAuth URL 반환
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: 'https://kakao.example.com/oauth/authorize' },
        error: null,
      });
      // 2. 브라우저에서 사용자가 로그인 완료 후 redirect URL 반환
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'success',
        url: 'syncday://auth/callback?code=auth-code-123&state=xyz',
      });
      // 3. PKCE code exchange 성공
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
        error: null,
      });
      // 4. 세션 조회
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await signInWithKakao();

      // OAuth 요청 검증 (skipBrowserRedirect: true 필수)
      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'kakao',
        options: {
          redirectTo: 'syncday://auth/callback',
          skipBrowserRedirect: true,
        },
      });
      // WebBrowser에 OAuth URL과 redirect URL 전달 검증
      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
        'https://kakao.example.com/oauth/authorize',
        'syncday://auth/callback',
        { showInRecents: false },
      );
      // redirect URL로 code exchange 요청 검증
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith(
        'syncday://auth/callback?code=auth-code-123&state=xyz',
      );
      expect(result.session.userId).toBe('user-123');
      expect(result.user).toEqual(mockUserRow);
    });

    it('취소: 브라우저 type=cancel → "cancelled" 에러 throw', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: 'https://kakao.example.com/oauth/authorize' },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'cancel',
      });

      await expect(signInWithKakao()).rejects.toThrow('cancelled');
    });

    it('취소: 브라우저 type=dismiss → "cancelled" 에러 throw', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: 'https://kakao.example.com/oauth/authorize' },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'dismiss',
      });

      await expect(signInWithKakao()).rejects.toThrow('cancelled');
    });

    it('OAuth URL 없음: "OAuth URL을 받지 못했습니다." 에러 throw', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: null },
        error: null,
      });

      await expect(signInWithKakao()).rejects.toThrow('OAuth URL을 받지 못했습니다.');
    });

    it('signInWithOAuth 에러: 에러 그대로 throw', async () => {
      const oauthError = new Error('Kakao OAuth provider error');
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: {},
        error: oauthError,
      });

      await expect(signInWithKakao()).rejects.toThrow('Kakao OAuth provider error');
    });

    it('code exchange 에러: exchangeCodeForSession 실패 시 에러 throw', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: 'https://kakao.example.com/oauth/authorize' },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'success',
        url: 'syncday://auth/callback?code=bad-code',
      });
      const exchangeError = new Error('Invalid PKCE code');
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
        error: exchangeError,
      });

      await expect(signInWithKakao()).rejects.toThrow('Invalid PKCE code');
    });

    it('code exchange 후 getSession 에러: 에러 throw', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: 'https://kakao.example.com/oauth/authorize' },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'success',
        url: 'syncday://auth/callback?code=auth-code-123',
      });
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({ error: null });
      const sessionError = new Error('Session fetch failed after exchange');
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: sessionError,
      });

      await expect(signInWithKakao()).rejects.toThrow('Session fetch failed after exchange');
    });

    it('code exchange 후 session null: "세션을 가져오지 못했습니다." 에러 throw', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: 'https://kakao.example.com/oauth/authorize' },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: 'success',
        url: 'syncday://auth/callback?code=auth-code-123',
      });
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({ error: null });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(signInWithKakao()).rejects.toThrow('세션을 가져오지 못했습니다.');
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
});
