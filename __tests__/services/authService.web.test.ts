/**
 * __tests__/services/authService.web.test.ts
 *
 * TASK-212: Web Compatibility Test — authService.ts 웹 플랫폼 분기 테스트
 *
 * 전략:
 *  - jest.mock('react-native') 호이스팅으로 Platform.OS='web' 설정
 *    → authService 모듈 로드 시 if(Platform.OS !== 'web') 블록 스킵
 *    → GoogleSignin.configure() 미호출 확인 가능
 *  - @/lib/supabase mock으로 실제 Supabase 호출 차단
 *  - globalThis.location.origin으로 웹 redirectTo URL 주입
 *  - afterEach에서 globalThis.location 정리
 *
 * 커버리지:
 *  signInWithGoogle (web)  — signInWithOAuth(google) 호출, GoogleSignin.signIn 미호출
 *  signInWithGoogle (web)  — OAuthError → throw
 *  signInWithApple (web)   — signInWithOAuth(apple) 호출, AppleAuthentication.signInAsync 미호출
 *  signInWithApple (web)   — OAuthError → throw
 *  signInWithKakao (web)   — redirectTo = window.location.origin + '/auth/callback'
 *  signInWithKakao (web)   — origin 미설정 시 Linking.createURL 폴백 사용
 *  모듈 초기화              — Platform.OS='web'이면 GoogleSignin.configure 미호출
 *
 * @task TASK-212
 */

// ─── Mock 선언 (jest.mock은 파일 최상단으로 호이스팅됨) ───────────────────────

/**
 * Platform.OS = 'web' 설정.
 * authService.ts의 모듈 레벨 if(Platform.OS !== 'web') 블록이
 * 이 파일에서 로드될 때 스킵되도록 보장.
 *
 * jest-expo preset 의 react-native module 을 통째로 교체하면 다른 internal
 * (StyleSheet 등) 이 사라져서 같이 import 되는 supabase 클라이언트가 깨진다.
 * 따라서 require() 해서 Platform.OS 만 직접 덮어쓴다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _rn = require('react-native');
if (!_rn.Platform || typeof _rn.Platform !== 'object') {
  _rn.Platform = {};
}
_rn.Platform.OS = 'web';

// GoogleSignin: 웹에서 호출 여부를 검증하기 위해 spy 가능하게 mock
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

// AppleAuthentication: 웹에서 호출 여부를 검증하기 위해 spy 가능하게 mock
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: {
    FULL_NAME: 'fullName',
    EMAIL: 'email',
  },
}));

// expo-web-browser: signInWithKakao 내부에서 사용
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  dismissBrowser: jest.fn(),
}));

// expo-linking: origin 없을 때 signInWithKakao의 폴백 경로 검증
jest.mock('expo-linking', () => ({
  createURL: jest.fn().mockReturnValue('synclink://auth/callback'),
}));

// expo-constants: errorLogger가 app_version을 읽기 위해 import함
// 웹 테스트 환경에선 NativeUnimoduleProxy가 없어서 실제 모듈 로드 시 실패 → mock으로 대체
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

// @/lib/supabase 전체 대체 — 실제 Supabase 호출 차단
jest.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(),
      signInWithIdToken: jest.fn(),
      signInWithPassword: jest.fn(),
      // 2026-10-13 (보안 3-B5): 웹 카카오 콜백이 1회용 토큰으로 세션을 만들 때 쓴다
      verifyOtp: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      getSession: jest.fn(),
      refreshSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

// errorLogger — 카카오 확인값 불일치를 기록하는지가 검증 대상이라 mock 한다(실제 기록 호출도 막는다).
jest.mock('@/lib/errorLogger', () => ({
  logError:         jest.fn().mockResolvedValue(undefined),
  serializePgError: jest.fn((e: unknown) => ({ message: String(e) })),
}));

// fetch mock — kakao-auth Edge Function 호출용
const fetchMock = jest.fn();
(globalThis as Record<string, unknown>).fetch = fetchMock;

// ─── Imports ──────────────────────────────────────────────────────────────────

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import {
  signInWithGoogle,
  signInWithApple,
  signInWithKakao,
  completeKakaoWebSignIn,
} from '@/services/authService';

// ─── 타입 헬퍼 ────────────────────────────────────────────────────────────────

const TEST_ORIGIN = 'https://app.syncday.com';

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('authService (Platform.OS = "web")', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 웹 환경의 window.location 시뮬레이션 (assign 포함)
    (globalThis as Record<string, unknown>).location = {
      origin: TEST_ORIGIN,
      assign: jest.fn(),
    };
  });

  afterEach(() => {
    // globalThis.location은 jest 환경 오염 방지를 위해 각 테스트 후 제거
    delete (globalThis as Record<string, unknown>).location;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 모듈 초기화
  // ══════════════════════════════════════════════════════════════════════════

  describe('모듈 초기화', () => {
    it('Platform.OS=web → GoogleSignin.configure() 미호출', () => {
      // authService.ts 로드 시 if(Platform.OS !== 'web') 블록이 스킵됨
      expect(GoogleSignin.configure).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signInWithGoogle (web)
  // ══════════════════════════════════════════════════════════════════════════

  describe('signInWithGoogle (web)', () => {
    it('supabase.auth.signInWithOAuth를 google provider로 호출', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: `${TEST_ORIGIN}/auth/callback` },
        error: null,
      });

      await signInWithGoogle();

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: `${TEST_ORIGIN}/auth/callback` },
      });
    });

    it('GoogleSignin.signIn()을 절대 호출하지 않음 (네이티브 SDK 미사용)', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: '' },
        error: null,
      });

      await signInWithGoogle();

      expect(GoogleSignin.signIn).not.toHaveBeenCalled();
    });

    it('signInWithOAuth 오류 → 에러 throw', async () => {
      const mockError = { message: 'OAuth provider error', status: 500 };
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: null,
        error: mockError,
      });

      await expect(signInWithGoogle()).rejects.toEqual(mockError);
    });

    it('redirectTo에 origin/auth/callback 포함', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: '' },
        error: null,
      });

      await signInWithGoogle();

      const callArgs = (supabase.auth.signInWithOAuth as jest.Mock).mock.calls[0][0];
      expect(callArgs.options.redirectTo).toBe(`${TEST_ORIGIN}/auth/callback`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signInWithApple (web)
  // ══════════════════════════════════════════════════════════════════════════

  describe('signInWithApple (web)', () => {
    it('supabase.auth.signInWithOAuth를 apple provider로 호출', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: `${TEST_ORIGIN}/auth/callback` },
        error: null,
      });

      await signInWithApple();

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'apple',
        options: { redirectTo: `${TEST_ORIGIN}/auth/callback` },
      });
    });

    it('AppleAuthentication.signInAsync()를 절대 호출하지 않음 (iOS 전용 SDK 미사용)', async () => {
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: { url: '' },
        error: null,
      });

      await signInWithApple();

      expect(AppleAuthentication.signInAsync).not.toHaveBeenCalled();
    });

    it('signInWithOAuth 오류 → 에러 throw', async () => {
      const mockError = { message: 'Apple OAuth error', status: 500 };
      (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
        data: null,
        error: mockError,
      });

      await expect(signInWithApple()).rejects.toEqual(mockError);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // signInWithKakao (web)
  // ══════════════════════════════════════════════════════════════════════════

  describe('signInWithKakao (web)', () => {
    /** 이 탭의 sessionStorage 대역 — 로그인 시작 때 확인값을 두고 콜백에서 대조한다. */
    let store: Map<string, string>;

    beforeEach(() => {
      fetchMock.mockReset();
      store = new Map();
      (globalThis as Record<string, unknown>).sessionStorage = {
        getItem:    (k: string) => store.get(k) ?? null,
        setItem:    (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      };
    });

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).sessionStorage;
    });

    /**
     * 새 아키텍처: redirect_uri는 Edge Function(HTTPS), state는 웹 app 복귀 URL.
     * WebBrowser는 app 복귀 URL을 watch 한다.
     */
    it('redirect_uri = Edge Function URL, state = web app 복귀 URL', async () => {
      // web 흐름: location.assign(authUrl)으로 페이지 이동 후 {} 반환
      const loc = (globalThis as Record<string, unknown>).location as { assign: jest.Mock };

      await signInWithKakao();

      expect(loc.assign).toHaveBeenCalledTimes(1);
      const assignedUrl: string = loc.assign.mock.calls[0][0];

      expect(assignedUrl).toContain('https://kauth.kakao.com/oauth/authorize');
      // redirect_uri = Edge Function URL (HTTPS)
      expect(assignedUrl).toContain(
        `redirect_uri=${encodeURIComponent('https://test.supabase.co/functions/v1/kakao-auth')}`,
      );
      // state = web 복귀 URL + v=2(1회용 토큰으로 달라) + n(이 탭의 확인값, 16바이트 16진수)
      const state = new URL(assignedUrl).searchParams.get('state') ?? '';
      const match = state.match(/^(.+)\?v=2&n=([0-9a-f]{32})$/);
      expect(match?.[1]).toBe(`${TEST_ORIGIN}/auth/callback`);
      // 같은 확인값이 이 탭의 sessionStorage 에 있어야 콜백에서 대조할 수 있다
      expect([...store.values()]).toEqual([match?.[2]]);

      // Supabase 내장 Kakao 프로바이더는 더 이상 사용하지 않는다
      expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
    });

    it('로그인할 때마다 확인값이 새로 만들어진다', async () => {
      const loc = (globalThis as Record<string, unknown>).location as { assign: jest.Mock };

      await signInWithKakao();
      await signInWithKakao();

      const nonces = loc.assign.mock.calls.map(
        ([u]: [string]) => new URL(new URL(u).searchParams.get('state') ?? '').searchParams.get('n'),
      );
      expect(nonces[0]).not.toBe(nonces[1]);
    });

    it('origin 미설정 시 Linking.createURL 폴백 사용', async () => {
      // origin 없이 assign 함수만 있는 상태
      (globalThis as Record<string, unknown>).location = { assign: jest.fn() };
      const loc = (globalThis as Record<string, unknown>).location as { assign: jest.Mock };

      await signInWithKakao();

      expect(Linking.createURL).toHaveBeenCalledWith('/auth/callback');
      expect(loc.assign).toHaveBeenCalled();
    });

    /**
     * completeKakaoWebSignIn — /auth/callback 이 부르는 마무리 단계.
     * 🔴 이 탭이 시작한 로그인(저장된 확인값 = 복귀 주소의 n)일 때만 토큰을 쓴다.
     *    다른 곳에서 만들어진 복귀 주소로는 로그인되지 않아야 한다.
     */
    describe('completeKakaoWebSignIn', () => {
      const KEY = 'synclink.kakaoWebNonce';

      it('확인값 일치 → verifyOtp 로 세션 생성, 확인값은 지운다', async () => {
        store.set(KEY, 'abc123');
        (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({ data: {}, error: null });

        await completeKakaoWebSignIn('hash-1', 'abc123');

        expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash-1', type: 'email' });
        expect(store.has(KEY)).toBe(false);
      });

      it.each([
        ['확인값 불일치', 'abc123', 'other'],
        ['이 탭에 시작 기록 없음', null, 'abc123'],
        ['복귀 주소에 n 없음', 'abc123', null],
      ])('%s → 거절, verifyOtp 미호출, 확인값 지움, 기록 남김', async (_label, saved, given) => {
        if (saved) store.set(KEY, saved);

        await expect(completeKakaoWebSignIn('hash-1', given)).rejects.toThrow('카카오 로그인을 다시 시작해 주세요.');

        expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
        expect(store.has(KEY)).toBe(false);
        expect(logError).toHaveBeenCalledWith(
          expect.objectContaining({ context: 'auth.kakao.web-nonce-mismatch' }),
        );
      });

      it('토큰 만료·재사용 → verifyOtp 오류 그대로 throw', async () => {
        store.set(KEY, 'abc123');
        (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({
          data: {}, error: new Error('Token has expired or is invalid'),
        });

        await expect(completeKakaoWebSignIn('hash-1', 'abc123')).rejects.toThrow('Token has expired or is invalid');
      });
    });
  });
});
