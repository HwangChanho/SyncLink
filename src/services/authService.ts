/**
 * Authentication service — adapter over Supabase Auth.
 *
 * All auth operations flow through here. Components never call Supabase directly.
 * If the backend changes (e.g. Firebase Auth), only this file needs to change.
 *
 * Supported providers (in login order per PRD):
 *  1. Google  — @react-native-google-signin/google-signin → Supabase signInWithIdToken
 *  2. Kakao   — Supabase OAuth redirect → expo-web-browser → PKCE code exchange
 *  3. Apple   — expo-apple-authentication → Supabase signInWithIdToken (iOS only)
 *
 * Environment variables required (see docs/escalations/[WAITING]ESCALATION-002.md):
 *  - EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
 *  - EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
 */

import { Platform } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import type { UserRow } from '@/types';

// ─── Notification preferences types ──────────────────────────────────────────

/**
 * User-facing notification toggles stored in users.notification_preferences.
 * Separate from NotificationSettings (which controls server-side delivery).
 * Added in migration 006_notification_prefs.sql (TASK-501).
 */
export interface NotificationPreferences {
  /** Receive reminders before own events start. */
  event_reminder:  boolean;
  /** Receive push when a Space member adds/modifies an event. */
  space_activity:  boolean;
  /** Receive push when an event is shared to one of your Spaces. */
  event_share:     boolean;
}

/** Default preferences applied when no saved value exists. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  event_reminder: true,
  space_activity: true,
  event_share:    true,
};

// ─── Session types ────────────────────────────────────────────────────────────

/** Currently authenticated user session. */
export interface AuthSession {
  userId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Result of a sign-in operation. */
export interface SignInResult {
  session: AuthSession;
  user: UserRow;
  /** True on the very first sign-in (triggers onboarding flow). */
  isNewUser: boolean;
}

// ─── Google Sign In setup ─────────────────────────────────────────────────────

/**
 * GoogleSignin.configure() must be called once before any Google auth operations.
 * Called at module load so it's ready before the login screen renders.
 * Keys come from .env — see ESCALATION-002 for acquisition instructions.
 *
 * Wrapped in Platform.OS !== 'web' because:
 *  - @react-native-google-signin/google-signin has no web support
 *  - Calling configure() in a browser context would crash
 *  - Web sign-in uses supabase.auth.signInWithOAuth instead (see signInWithGoogle)
 *
 * See: docs/escalations/NOTIFY-TASK204-WEB-IMPORT.md
 */
if (Platform.OS !== 'web') {
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    // offlineAccess: true allows getting a serverAuthCode if needed later
    offlineAccess: true,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sign in with Google.
 *
 * Flow:
 *  1. GoogleSignin.signIn() — shows native Google account picker
 *  2. Extract ID token from result
 *  3. supabase.auth.signInWithIdToken({ provider: 'google', token })
 *  4. Fetch UserRow from public.users (created by handle_new_user trigger)
 *
 * @throws Error with message 'cancelled' if user dismisses the picker
 * @throws Error with code statusCodes.PLAY_SERVICES_NOT_AVAILABLE on Android
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  // Web: use Supabase OAuth redirect instead of native Google SDK
  if (Platform.OS === 'web') {
    const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin ?? '';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) throw error;
    // Redirect happens — this point is not reached
    return {} as SignInResult;
  }

  // Native: 클라이언트 무관한 Google ID 토큰을 획득한 뒤 전역 세션으로 교환.
  // (acquireGoogleIdToken 은 통합 로그인의 B 계정 로그인에서도 재사용된다.)
  const idToken = await acquireGoogleIdToken();

  // Exchange Google ID token for Supabase session
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    // Google ID token → Supabase 세션 교환 실패. 사용자/토큰 정보는 민감해서 제외
    await logError({ context: 'auth.google.exchange', error });
    throw error;
  }
  if (!data.session) {
    const err = new Error('세션을 생성하지 못했습니다.');
    await logError({ context: 'auth.google.no-session', error: err });
    throw err;
  }

  return buildSignInResult(data.session);
}

/**
 * Sign in with Kakao — custom OAuth via our own Edge Function.
 *
 * Why bypass Supabase's built-in Kakao provider?
 *  Supabase's Kakao integration requires a Client Secret, but our Kakao app
 *  is configured with "Client Secret: Disabled" (the simpler and more common
 *  setup). Every login attempt through Supabase fails with `invalid_client`.
 *  So we handle the whole OAuth dance ourselves and only use Supabase to mint
 *  the final session.
 *
 * Flow:
 *  1. Build the Kakao authorize URL directly (client_id = REST API key).
 *  2. WebBrowser.openAuthSessionAsync(authUrl, redirectUri)
 *     → opens Kakao login, waits for redirect back with ?code=...
 *  3. Extract the `code` param from the redirect URL.
 *  4. POST { code, redirect_uri } to our `kakao-auth` Edge Function.
 *     → Function exchanges the code, upserts a Supabase auth user,
 *       returns `{ email, password }`.
 *  5. supabase.auth.signInWithPassword({ email, password }) to create a session.
 *  6. buildSignInResult → { session, user, isNewUser }.
 *
 * Environment variables:
 *  - EXPO_PUBLIC_KAKAO_REST_API_KEY — REST API key from Kakao Developer Console
 *  - EXPO_PUBLIC_SUPABASE_URL       — base URL for invoking the Edge Function
 *
 * Redirect URIs that must be registered in the Kakao Developer Console:
 *  - synclink://auth/callback                     (native iOS/Android app)
 *  - http://localhost:8081/auth/callback          (web dev)
 *  - https://<prod-domain>/auth/callback          (web prod)
 *
 * @throws Error with message 'cancelled' if user closes the browser.
 * @throws Error with descriptive message on any Edge Function / token failure.
 */
export async function signInWithKakao(): Promise<SignInResult> {
  // On web we use a full-page navigation (window.location.assign) instead of
  // WebBrowser.openAuthSessionAsync — popup-based OAuth from Kakao breaks under
  // cross-origin/popup-blocker rules in Safari and Chrome strict mode, and the
  // session would be lost when the popup closes. The /auth/callback route then
  // finalises the sign-in by reading the email/password params Edge delivered.
  if (Platform.OS === 'web') {
    const origin = (globalThis as typeof globalThis & { location?: { origin?: string } })
      .location?.origin;
    const appReturn = origin ? `${origin}/auth/callback` : Linking.createURL('/auth/callback');
    const win = (globalThis as typeof globalThis & { location?: { assign: (u: string) => void } });
    win.location?.assign(buildKakaoAuthUrl(appReturn));
    // The page is leaving — nothing else to do here.
    return {} as SignInResult;
  }

  // Native: 클라이언트 무관한 Kakao 자격(email/password)을 획득해 전역 세션을 생성.
  // (acquireKakaoCredentials 은 통합 로그인의 B 계정 로그인에서도 재사용된다.)
  const { email, password } = await acquireKakaoCredentials();

  // ── Exchange the derived credentials for a real Supabase session ────────
  // The password is never stored anywhere on the client — signInWithPassword
  // hands us session tokens that replace it.
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // signInWithPassword 실패 → Edge Function이 생성한 유저와 derive된 패스워드 불일치 등
    await logError({ context: 'auth.kakao.signin-password', error });
    throw error;
  }
  if (!data.session) {
    const err = new Error('세션을 생성하지 못했습니다.');
    await logError({ context: 'auth.kakao.no-session', error: err });
    throw err;
  }

  return buildSignInResult(data.session);
}

/**
 * Extract a query-string parameter value from a URL-like string.
 *
 * Works for both web URLs (`https://...?code=...`) and custom-scheme deep
 * links (`synclink://auth/callback?code=...`). Using the native `URL`
 * constructor would fail on some React Native hosts for non-standard
 * schemes, so we do a lightweight manual parse.
 *
 * @param url   - The full redirect URL returned by WebBrowser
 * @param key   - Query-string key to look up
 * @returns The raw (URL-decoded) value, or null if not present.
 */
function extractQueryParam(url: string, key: string): string | null {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return null;
  // Drop anything after a `#` fragment — we only care about the query string.
  const hashIdx = url.indexOf('#', qIdx);
  const query = url.slice(qIdx + 1, hashIdx === -1 ? undefined : hashIdx);
  const params = new URLSearchParams(query);
  return params.get(key);
}

/**
 * Sign in with Apple Sign In.
 * iOS only — not available on Android (expo-apple-authentication throws on Android).
 *
 * Flow:
 *  1. AppleAuthentication.signInAsync() — shows native Apple ID sheet
 *  2. Extract identity token from credential
 *  3. supabase.auth.signInWithIdToken({ provider: 'apple', token })
 *
 * Note: Apple only provides email/name on the FIRST sign-in.
 * Subsequent sign-ins only provide the user sub (stable identifier).
 *
 * @throws Error with message 'cancelled' if user dismisses the sheet (ERR_REQUEST_CANCELED)
 */
export async function signInWithApple(): Promise<SignInResult> {
  // Web: use Supabase OAuth redirect instead of native Apple Authentication
  if (Platform.OS === 'web') {
    const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin ?? '';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) throw error;
    // Redirect happens — this point is not reached
    return {} as SignInResult;
  }

  // v1.2.9 — Android: expo-apple-authentication 미지원. Supabase OAuth +
  // expo-web-browser 의 openAuthSessionAsync 로 in-app browser 흐름.
  // (iOS 와 흐름 다름 — iOS 는 native sheet, Android 는 web redirect.)
  if (Platform.OS === 'android') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WebBrowser = require('expo-web-browser');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Linking = require('expo-linking');
    const redirectTo = Linking.createURL('/auth/callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Apple OAuth URL 생성 실패');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      throw new Error('cancelled');
    }
    // callback URL 의 fragment 에서 token 추출 후 Supabase session 복원.
    const fragment = result.url.split('#')[1] ?? '';
    const params = new URLSearchParams(fragment);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) {
      throw new Error('Apple OAuth 토큰을 받지 못했습니다.');
    }
    const { data: sessData, error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
    if (sessErr) throw sessErr;
    if (!sessData.session) throw new Error('세션 생성 실패');
    return buildSignInResult(sessData.session);
  }

  // iOS native: 클라이언트 무관한 Apple identity 토큰을 획득해 전역 세션을 생성.
  // (acquireAppleIdentityToken 은 통합 로그인의 B 계정 로그인에서도 재사용된다.)
  const identityToken = await acquireAppleIdentityToken();

  // Exchange Apple identity token for Supabase session
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });

  if (error) {
    await logError({ context: 'auth.apple.exchange', error });
    throw error;
  }
  if (!data.session) {
    const err = new Error('세션을 생성하지 못했습니다.');
    await logError({ context: 'auth.apple.no-session', error: err });
    throw err;
  }

  return buildSignInResult(data.session);
}

/**
 * Link an additional OAuth identity (Google/Kakao/Apple) to the current user.
 *
 * ADR-010 / ISSUE-014: Multi-provider account linking.
 * The current user must be signed in. After successful link, signing in with
 * the linked provider in the future will resolve to the same Supabase user
 * (no duplicate account).
 *
 * Throws on:
 *  - No active session (call signIn* first)
 *  - Provider already linked to another user (Supabase rejects)
 *  - User cancels OAuth flow
 *
 * @param provider 'google' | 'kakao' | 'apple'
 */
export async function linkProvider(provider: 'google' | 'kakao' | 'apple'): Promise<void> {
  const session = await getSession();
  if (!session) {
    throw new Error('linkProvider: 먼저 로그인해야 합니다');
  }

  // Web: linkIdentity 가 직접 full-page redirect 하므로 호출만 하면 된다.
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.linkIdentity({ provider: provider as 'google' | 'apple' | 'kakao' });
    if (error) throw error;
    return;
  }

  // Native(RN): linkIdentity 는 OAuth URL 만 돌려주고 브라우저를 자동으로 열지
  // 않는다(window 없음). 일반 OAuth 로그인과 동일하게 skipBrowserRedirect 로 URL 을
  // 받아 WebBrowser 로 직접 열고, 돌아온 콜백의 PKCE code 를 exchangeCodeForSession
  // 으로 교환해 연동을 완료한다. (이전엔 linkIdentity 만 호출 → RN 에서 아무 일도
  // 일어나지 않아 "통합 로그인 안 됨" — 2026-06-05 수정.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Linking = require('expo-linking');
  const redirectTo = Linking.createURL('/auth/callback');
  const { data, error } = await supabase.auth.linkIdentity({
    provider: provider as 'google' | 'apple' | 'kakao',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('연동 OAuth URL 을 생성하지 못했습니다.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, { showInRecents: false });
  if (result.type !== 'success' || !result.url) {
    throw new Error('cancelled');
  }
  const errParam = extractQueryParam(result.url, 'error_description') ?? extractQueryParam(result.url, 'error');
  if (errParam) throw new Error(`연동 오류: ${decodeURIComponent(errParam)}`);
  const code = extractQueryParam(result.url, 'code');
  if (!code) throw new Error('연동 코드를 받지 못했습니다.');
  const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exErr) throw exErr;
}

/**
 * List the OAuth identities currently linked to the user (for the My-tab UI).
 * Returns provider keys like ['google', 'kakao'].
 */
export async function getLinkedProviders(): Promise<string[]> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return (data?.identities ?? []).map((i) => i.provider);
}

/**
 * 계정 통합 후보 (Phase B / ADR-010).
 *
 * 현재 로그인 사용자와 "동일 이메일"을 가진 다른 계정. 서버 RPC
 * `get_account_merge_candidates` 가 호출자 본인 이메일 기준으로만 탐지하므로
 * 타인 계정 노출 위험이 없다 (마이그레이션 055).
 *
 * - plan='pro' 인 후보가 있으면 그 계정을 primary 로 추천 (구독 보존).
 * - 이메일이 없는 계정(카카오 등)은 후보가 비어 있을 수 있음.
 */
export interface MergeCandidate {
  user_id: string;
  email: string;
  nickname: string;
  plan: 'free' | 'pro';
  created_at: string;
}

export async function getAccountMergeCandidates(): Promise<MergeCandidate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_account_merge_candidates');
  if (error) throw error;
  return (data ?? []) as MergeCandidate[];
}

/** 병합 시 겹치는 일정 처리 정책. */
export type MergeConflictPolicy = 'keep_both' | 'dedupe';

export interface MergeConflictPreview {
  /** 겹치는(start_at+title 동일) 일정 수. */
  conflicts: number;
  /** secondary 전체 일정 수. */
  secondary_total: number;
}

export interface MergeResult {
  success: boolean;
  moved_events?: number;
  /** dedupe 정책에서 삭제된 secondary 일정 수. */
  deduped?: number;
  /** 양쪽 모두 Pro 였음 — 이중 결제 가능성 경고. */
  both_pro?: boolean;
}

/**
 * 병합 전 겹치는 일정 미리보기 (Phase C+). 사용자에게 충돌 처리를 묻기 위함.
 * 서버 RPC `get_merge_conflicts` 가 본인+동일이메일만 허용.
 */
export async function getMergeConflicts(
  primary: string,
  secondary: string,
): Promise<MergeConflictPreview> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_merge_conflicts', {
    p_primary: primary,
    p_secondary: secondary,
  });
  if (error) throw error;
  return (data ?? { conflicts: 0, secondary_total: 0 }) as MergeConflictPreview;
}

/**
 * 두 계정을 병합 (Phase C). secondary 의 데이터를 primary 로 이전 후 secondary 삭제.
 *
 * primary 는 **Pro 계정 또는 유지할 계정**이어야 한다 (서버가 Pro 유실을 거부).
 * Edge Function `account-merge-execute` 가 RPC + auth.users 삭제를 처리.
 *
 * @param primary  유지될 계정 UUID (Pro 우선)
 * @param secondary 흡수되어 삭제될 계정 UUID
 * @param conflictPolicy 겹치는 일정 처리 ('keep_both' 둘 다 | 'dedupe' 중복 제거). 기본 keep_both.
 */
export async function mergeAccount(
  primary: string,
  secondary: string,
  conflictPolicy: MergeConflictPolicy = 'keep_both',
): Promise<MergeResult> {
  const { data, error } = await supabase.functions.invoke('account-merge-execute', {
    body: { primary, secondary, conflictPolicy },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error ?? '계정 병합에 실패했습니다.');
  return data as MergeResult;
}

// ─── 통합 로그인 (재로그인 기반 단일계정 병합) ────────────────────────────────
//
// 사용자가 A 로그인 상태에서 [통합 로그인]으로 다른 내 계정 B 에 재로그인하면,
// B 의 토큰을 확보해 서버(account-merge-bytoken)에 A·B 두 토큰을 넘긴다. 서버가
// 두 토큰을 각각 검증(본인 2계정)한 뒤 단일 계정으로 병합한다.
//
// 핵심: B 로그인은 전역 supabase 세션을 건드리면 안 된다(A 세션 유지). 그래서
// persistSession:false 인 ephemeral 클라이언트로 B 를 로그인해 토큰만 추출한다.
// native 토큰 획득부(Google/Apple/Kakao)는 평소 로그인과 동일 헬퍼를 재사용한다.

/** 통합 로그인에서 지원하는 B 계정 로그인 방식. */
export type MergeLoginMethod = 'google' | 'apple' | 'kakao' | 'email';

/** B 로그인 결과 — 전역 세션을 바꾸지 않고 토큰만 보관. */
export interface SecondarySession {
  userId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
}

/** 통합 미리보기 결과(dryRun). 확인 모달에 표시할 건수/메타. */
export interface MergePreviewResult {
  success: true;
  dryRun: true;
  /** 유지될 계정(Pro 우선). */
  primary: string;
  /** 흡수되어 삭제될 계정. */
  secondary: string;
  /** primary 가 현재 세션(A)인지 — false 면 통합 후 B 세션으로 전환 필요. */
  primaryIsCurrent: boolean;
  /** 겹치는(같은 start_at+title) 일정 수. */
  conflicts: number;
  secondary_events: number;
  secondary_todos: number;
  secondary_cats: number;
  primary_email: string;
  secondary_email: string;
  primary_plan: string;
  secondary_plan: string;
}

/** 통합 실행 결과. */
export interface MergeExecuteResult {
  success: true;
  primary: string;
  secondary: string;
  primaryIsCurrent: boolean;
  moved_events?: number;
  moved_idents?: number;
  deduped?: number;
  /** 양쪽 모두 Pro 였음 — 중복 구독 경고. */
  both_pro?: boolean;
}

/**
 * 전역 supabase 와 분리된 ephemeral(휘발성) 클라이언트.
 *
 * persistSession:false → AsyncStorage 의 A 세션을 절대 덮어쓰지 않는다.
 * autoRefreshToken:false → 단발성 사용이라 백그라운드 갱신 타이머가 필요 없다.
 */
function createEphemeralClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * B 계정에 로그인해 토큰만 확보한다 (전역 A 세션 무손상).
 *
 * @param method 'google' | 'apple' | 'kakao' | 'email'
 * @param creds  email 방식일 때 { email, password }
 * @throws Error('cancelled') 사용자가 로그인 취소
 */
export async function loginSecondaryAccount(
  method: MergeLoginMethod,
  creds?: { email: string; password: string },
): Promise<SecondarySession> {
  if (Platform.OS === 'web') {
    throw new Error('통합 로그인은 앱에서만 지원됩니다.');
  }
  const ephemeral = createEphemeralClient();
  let session: Session | null = null;

  switch (method) {
    case 'google': {
      // forceAccountChooser=true → 캐시된 A 구글 계정을 비워 B 선택을 강제.
      const idToken = await acquireGoogleIdToken(true);
      const { data, error } = await ephemeral.auth.signInWithIdToken({ provider: 'google', token: idToken });
      if (error) throw error;
      session = data.session;
      break;
    }
    case 'apple': {
      if (Platform.OS !== 'ios') throw new Error('Apple 통합 로그인은 iOS에서만 지원됩니다.');
      const token = await acquireAppleIdentityToken();
      const { data, error } = await ephemeral.auth.signInWithIdToken({ provider: 'apple', token });
      if (error) throw error;
      session = data.session;
      break;
    }
    case 'kakao': {
      const { email, password } = await acquireKakaoCredentials();
      const { data, error } = await ephemeral.auth.signInWithPassword({ email, password });
      if (error) throw error;
      session = data.session;
      break;
    }
    case 'email': {
      if (!creds?.email || !creds.password) throw new Error('이메일과 비밀번호를 입력해주세요.');
      const { data, error } = await ephemeral.auth.signInWithPassword({
        email: creds.email.trim(),
        password: creds.password,
      });
      if (error) throw error;
      session = data.session;
      break;
    }
  }

  if (!session) throw new Error('통합할 계정 로그인에 실패했습니다.');
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
}

/**
 * account-merge-bytoken Edge 호출 공통부.
 * 현재 세션(A) 토큰 + B 토큰을 전달. 비-2xx 응답이면 서버의 JSON 에러 메시지를
 * 최대한 추출해 사용자에게 보여준다(supabase-js 는 기본적으로 generic 메시지만 줌).
 */
async function invokeMergeByToken(
  body: { bToken: string; dryRun?: boolean; policy?: MergeConflictPolicy },
): Promise<Record<string, unknown>> {
  const session = await getSession();
  if (!session) throw new Error('현재 로그인이 필요합니다. 다시 로그인해주세요.');

  // ⚠️ refreshSession() 을 호출하지 않는다 — refresh 가 실패하면 supabase-js 가 현재
  //    세션을 sign-out 시켜 사용자가 통째로 로그아웃됐다(Kakao 통합 중 토큰 회전으로
  //    refresh 실패 → "로그아웃 + 통합 실패", 2026-06-06 실측). aToken 이 만료된 경우엔
  //    Edge 가 "현재 계정 인증이 만료" 로 응답(로그아웃 아님)하는 편이 훨씬 안전하다.
  const { data, error } = await supabase.functions.invoke('account-merge-bytoken', {
    body: { aToken: session.accessToken, ...body },
  });

  if (error) {
    // FunctionsHttpError 는 원본 Response 를 .context 로 노출 → 서버 JSON 메시지 추출.
    let serverMsg: string | undefined;
    let sameAccount = false;
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === 'function') {
      try {
        const parsed = (await (ctx as Response).json()) as { error?: string; sameAccount?: boolean };
        serverMsg = parsed?.error;
        sameAccount = parsed?.sameAccount === true;
      } catch {
        /* 본문이 JSON 이 아님 — generic 메시지로 폴백 */
      }
    }
    const e = new Error(serverMsg ?? error.message ?? '통합에 실패했습니다.') as Error & { sameAccount?: boolean };
    if (sameAccount) e.sameAccount = true;
    throw e;
  }
  if (!data?.success) throw new Error(data?.error ?? '통합에 실패했습니다.');
  return data as Record<string, unknown>;
}

/**
 * 통합 미리보기 (dryRun). B 계정 데이터 건수 + 겹침 수 + primary 결정 결과를 반환.
 * 실제 변경은 일어나지 않는다.
 */
export async function previewMergeByToken(bAccessToken: string): Promise<MergePreviewResult> {
  return (await invokeMergeByToken({ bToken: bAccessToken, dryRun: true })) as unknown as MergePreviewResult;
}

/**
 * 통합 실행. secondary 데이터+identity 를 primary 로 이전하고 secondary 를 삭제한다.
 * @param policy 겹치는 일정 처리 ('keep_both' 둘 다 | 'dedupe' 중복 제거).
 */
export async function executeMergeByToken(
  bAccessToken: string,
  policy: MergeConflictPolicy = 'keep_both',
): Promise<MergeExecuteResult> {
  return (await invokeMergeByToken({ bToken: bAccessToken, dryRun: false, policy })) as unknown as MergeExecuteResult;
}

/**
 * 전역 세션을 주어진 토큰으로 교체한다. 통합 후 primary 가 B(현재 세션 아님)일 때,
 * A 가 삭제되었으므로 primary(B) 세션으로 전환하는 데 사용한다.
 */
export async function setActiveSession(accessToken: string, refreshToken: string): Promise<void> {
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) throw error;
}

// ─── Native token acquisition (평소 로그인 + 통합 로그인 공용) ─────────────────

/**
 * Google native ID 토큰 획득 (어떤 Supabase 클라이언트와도 무관).
 * @param forceAccountChooser true 면 캐시된 계정을 비워 계정 선택 화면을 강제(B 로그인용).
 */
async function acquireGoogleIdToken(forceAccountChooser = false): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Google 네이티브 로그인은 앱에서만 지원됩니다.');
  }
  // Ensure Google Play Services are available (Android only; no-op on iOS)
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // 통합 로그인(B): A 의 캐시 계정을 비워 다른 계정을 선택하도록 한다.
  if (forceAccountChooser) {
    try { await GoogleSignin.signOut(); } catch { /* 로그인된 적 없으면 무시 */ }
  }

  let idToken: string | null = null;
  try {
    const userInfo = await GoogleSignin.signIn();
    // v13+ returns { type, data: { idToken } }; older returns { idToken } — handle both.
    idToken = (userInfo as any)?.idToken
      ?? (userInfo as any)?.data?.idToken
      ?? null;
    if (!idToken) {
      const type = (userInfo as any)?.type;
      if (type === 'cancelled' || type === 'noSavedCredentialFound') {
        throw new Error('cancelled');
      }
      throw new Error('Google ID 토큰을 받지 못했습니다. 다시 시도해 주세요.');
    }
  } catch (err: unknown) {
    if (isStatusCodeError(err, statusCodes.SIGN_IN_CANCELLED)) {
      throw new Error('cancelled');
    }
    if (isStatusCodeError(err, statusCodes.IN_PROGRESS)) {
      throw new Error('Google 로그인이 이미 진행 중입니다.');
    }
    if (isStatusCodeError(err, statusCodes.PLAY_SERVICES_NOT_AVAILABLE)) {
      // iOS 빌드 string scan 회피 위해 외부 스토어명 제외 (Apple Guideline 2.3.10).
      throw new Error('Google 로그인 서비스를 사용할 수 없습니다. 기기 설정을 확인해 주세요.');
    }
    if (isStatusCodeError(err, 10 /* DEVELOPER_ERROR */)) {
      throw new Error('Google 로그인 설정 오류입니다. (DEVELOPER_ERROR: 번들 ID 불일치 — Google Cloud Console에서 io.synclink.app으로 iOS 클라이언트를 재생성하세요)');
    }
    throw err;
  }
  return idToken;
}

/** Apple identity 토큰 획득 (iOS native). */
async function acquireAppleIdentityToken(): Promise<string> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  const { identityToken } = credential;
  if (!identityToken) {
    throw new Error('Apple ID 토큰을 받지 못했습니다. 다시 시도해 주세요.');
  }
  return identityToken;
}

/**
 * Kakao authorize URL 빌드. redirect_uri = 우리 Edge(kakao-auth), state = appReturn.
 */
function buildKakaoAuthUrl(appReturn: string): string {
  const kakaoRestApiKey = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY;
  if (!kakaoRestApiKey) {
    throw new Error('Kakao 로그인 설정이 누락되었습니다. (EXPO_PUBLIC_KAKAO_REST_API_KEY 미설정)');
  }
  if (!SUPABASE_URL) {
    throw new Error('Supabase 설정이 누락되었습니다.');
  }
  // Kakao requires HTTPS redirect_uri (no custom schemes). Our Edge is the
  // redirect target; it processes the code then HTML-redirects back to appReturn.
  const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/kakao-auth`;
  return (
    'https://kauth.kakao.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(kakaoRestApiKey)}` +
    `&redirect_uri=${encodeURIComponent(edgeFunctionUrl)}` +
    `&state=${encodeURIComponent(appReturn)}` +
    '&response_type=code'
  );
}

/**
 * Kakao 네이티브 자격(email/password) 획득. WebBrowser 로 Kakao 동의 → Edge 가
 * appReturn?email=..&password=.. 로 되돌려보낸 값을 추출 (클라이언트 무관).
 */
async function acquireKakaoCredentials(): Promise<{ email: string; password: string }> {
  const appReturn = Linking.createURL('/auth/callback');
  const authUrl = buildKakaoAuthUrl(appReturn);

  const result = await WebBrowser.openAuthSessionAsync(authUrl, appReturn, { showInRecents: false });
  if (result.type !== 'success') {
    throw new Error('cancelled');
  }
  const errParam = extractQueryParam(result.url, 'error');
  if (errParam) {
    const err = new Error(`Kakao 로그인 오류: ${decodeURIComponent(errParam)}`);
    await logError({ context: 'auth.kakao.edge-error', error: err, details: { errParam } });
    throw err;
  }
  const email = extractQueryParam(result.url, 'email');
  const password = extractQueryParam(result.url, 'password');
  if (!email || !password) {
    const err = new Error('Kakao 로그인 응답이 올바르지 않습니다.');
    await logError({
      context: 'auth.kakao.malformed-response',
      error:   err,
      details: { hasEmail: !!email, hasPassword: !!password },
    });
    throw err;
  }
  return { email, password };
}

/**
 * Unlink a previously linked OAuth identity. Cannot unlink the last identity
 * (Supabase enforces — would orphan the account).
 */
export async function unlinkProvider(provider: 'google' | 'kakao' | 'apple'): Promise<void> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  const target = data?.identities?.find((i) => i.provider === provider);
  if (!target) throw new Error(`unlinkProvider: ${provider} 가 연결되지 않았습니다`);
  const { error: unlinkError } = await supabase.auth.unlinkIdentity(target);
  if (unlinkError) throw unlinkError;
}

/**
 * Sign out the current user.
 * Clears both the Google cached credential and the Supabase session.
 */
export async function signOut(): Promise<void> {
  // Clear Google cached credential (prevents auto-reselect next time)
  try {
    await GoogleSignin.signOut();
  } catch {
    // GoogleSignin may fail if never signed in with Google — safe to ignore
  }

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Get the current active session, if any.
 * Returns null if the user is not logged in or the session has expired.
 */
export async function getSession(): Promise<AuthSession | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) return null;
  return toAuthSession(session);
}

/**
 * Force-refresh the access token using the stored refresh token.
 * The Supabase client handles auto-refresh; call this for manual refresh.
 */
export async function refreshSession(): Promise<AuthSession> {
  const { data: { session }, error } = await supabase.auth.refreshSession();
  if (error) throw error;
  if (!session) throw new Error('세션 갱신에 실패했습니다. 다시 로그인해 주세요.');
  return toAuthSession(session);
}

/**
 * Subscribe to auth state changes (login / logout / token refresh events).
 * Fires immediately with the current session state on subscription.
 *
 * @param callback - Called with the new session (null = signed out)
 * @returns Unsubscribe function — call on component unmount
 */
export function onAuthStateChange(
  callback: (session: AuthSession | null) => void,
): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session ? toAuthSession(session) : null);
  });

  // Return the unsubscribe function for cleanup
  return () => subscription.unsubscribe();
}

/**
 * Fetch the full UserRow for a given user ID from public.users.
 * Used after onAuthStateChange fires to hydrate the auth store.
 *
 * @returns UserRow or null if not found (shouldn't happen with handle_new_user trigger)
 */
export async function getUserProfile(userId: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Update the authenticated user's public profile fields.
 *
 * @param updates - Partial update: nickname, avatar_url, and/or notification_settings
 * @returns Updated UserRow
 */
export async function updateProfile(
  updates: Partial<Pick<UserRow, 'nickname' | 'avatar_url' | 'notification_settings' | 'country_code'>>,
): Promise<UserRow> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('로그인이 필요합니다.');

  // Supabase Database generic requires a Relationships field in each table definition.
  // Omitting it causes the Update type to resolve as never. Safe to cast here.
  const { data, error } = await (supabase.from('users') as any)
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (error || !data) throw error ?? new Error('프로필 업데이트에 실패했습니다.');
  return data;
}

/**
 * Upload a new avatar image to Supabase Storage and update the user profile.
 *
 * Flow:
 *  1. Fetch the local image as a blob via the file URI
 *  2. Upload to the 'avatars' bucket at path {userId}/avatar.{ext}
 *     (upsert=true overwrites existing avatar)
 *  3. Return the public URL for the uploaded file
 *
 * The caller is responsible for calling updateProfile({ avatar_url }) after this.
 *
 * Prerequisites: 'avatars' bucket must exist in Supabase Storage with public read access.
 *
 * @param localUri - expo-image-picker result URI (file:// or content:// scheme)
 * @returns Public URL of the uploaded avatar
 * @throws Error if not authenticated or upload fails
 */
/**
 * Read a local image URI into a binary payload Supabase Storage will
 * accept on every platform.
 *
 * - Native (iOS/Android): expo-file-system reads as base64, then we
 *   convert to a Uint8Array. Avoids the empty-blob bug RN's `fetch` has
 *   against `file://` URIs.
 * - Web: file:// access is denied, but the picker returns an http(s) or
 *   blob: URI which `fetch` handles correctly. Returns the Blob directly.
 */
export async function readImageBinary(
  localUri: string,
  /**
   * Optional base64 string already decoded by the caller (e.g.
   * `ImagePicker.launchImageLibraryAsync({ base64: true })`). When
   * present we bypass expo-file-system entirely — that path returns an
   * empty string for some iOS photo asset URIs (ph://) which silently
   * uploaded 0-byte files. See DEBUG_2026-04-26_avatar-upload.md.
   */
  preDecodedBase64?: string | null,
): Promise<{
  uri: string; ext: string; mimeType: string; body: Uint8Array | Blob;
}> {
  const lastDot = localUri.lastIndexOf('.');
  const rawExt  = lastDot > -1 ? localUri.slice(lastDot + 1).toLowerCase() : '';
  const ext     = rawExt.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'jpg';
  const mimeType = ext === 'png'  ? 'image/png'
                  : ext === 'gif' ? 'image/gif'
                  : ext === 'webp' ? 'image/webp'
                  : 'image/jpeg';

  // Caller-supplied base64 is the most reliable path on native — short
  // circuit before we touch the file system.
  if (preDecodedBase64 && preDecodedBase64.length > 0) {
    return { uri: localUri, ext, mimeType, body: base64ToUint8Array(preDecodedBase64) };
  }

  if (Platform.OS === 'web') {
    const res  = await fetch(localUri);
    const blob = await res.blob();
    return { uri: localUri, ext, mimeType, body: blob };
  }

  // Native fallback — only reached when the caller doesn't supply
  // base64 (e.g. uploadSpaceCover from EditSpaceModal which still uses
  // file:// URIs). Known to produce empty strings for ph:// — callers
  // hitting that case should switch to base64-true ImagePicker too.
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const body = base64ToUint8Array(base64);
  return { uri: localUri, ext, mimeType, body };
}

/** Decode a base64 string to bytes without depending on `atob` polyfills. */
function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  let len = base64.length;
  while (len > 0 && base64.charCodeAt(len - 1) === 61) len--;
  const byteLen = (len * 3) >> 2;
  const out = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = lookup[base64.charCodeAt(i)]     ?? 0;
    const c1 = lookup[base64.charCodeAt(i + 1)] ?? 0;
    const c2 = lookup[base64.charCodeAt(i + 2)] ?? 0;
    const c3 = lookup[base64.charCodeAt(i + 3)] ?? 0;
    if (p < byteLen) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < byteLen) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < byteLen) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

export async function uploadAvatar(
  localUri: string,
  /**
   * Pre-decoded base64 from `ImagePicker.launchImageLibraryAsync({ base64: true })`.
   * Strongly preferred — bypasses iOS photo-asset URI quirks that cause
   * silent 0-byte uploads (DEBUG_2026-04-26_avatar-upload.md).
   */
  base64?: string | null,
): Promise<string> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('로그인이 필요합니다.');

  // Read the picked file as a binary ArrayBuffer.
  const { uri, ext, mimeType, body } = await readImageBinary(localUri, base64);
  // Diagnostic: confirm we actually read bytes (RN's empty-blob bug
  // would silently send 0). Surfaces in Metro/browser console.
  const bodySize = body instanceof Uint8Array ? body.byteLength : (body as Blob).size;
  // eslint-disable-next-line no-console
  console.info('[uploadAvatar] read', { uri, ext, mimeType, bytes: bodySize });
  if (bodySize === 0) {
    throw new Error('이미지 파일을 읽지 못했습니다 (0 bytes). 다시 시도해 주세요.');
  }

  const filePath = `${user.id}/avatar.${ext}`;

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, body, {
      contentType: mimeType,
      upsert: true,
    });
  // eslint-disable-next-line no-console
  console.info('[uploadAvatar] storage result', { path: filePath, ok: !uploadError, error: uploadError?.message, data: uploadData });

  if (uploadError) {
    // Translate common Supabase Storage errors into Korean user-facing messages
    // so the UI shows a readable reason instead of an SDK string.
    // Bucket-not-found is the most common failure mode when the 'avatars' bucket
    // has not yet been created in the Supabase dashboard.
    const raw = uploadError.message ?? '';
    if (/bucket.*not.*found/i.test(raw) || /resource.*not.*found/i.test(raw)) {
      throw new Error(
        '프로필 사진 저장소(avatars 버킷)가 설정되지 않았습니다. 관리자에게 문의해 주세요.',
      );
    }
    if (/permission/i.test(raw) || /unauthorized/i.test(raw) || /row.?level.?security/i.test(raw)) {
      throw new Error('프로필 사진 업로드 권한이 없습니다. 다시 로그인해 주세요.');
    }
    // Fall through: preserve original error for engineers while giving
    // the user a generic message.
    throw new Error(`프로필 사진 업로드에 실패했습니다: ${raw}`);
  }

  // Get the public URL (bucket must be public in Supabase Storage settings).
  // Append a cache-buster so React Native's Image component refetches on
  // every upload — Supabase reuses the same path per user, so the URL is
  // otherwise byte-identical across uploads and RN's image cache would
  // keep showing the old picture.
  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  return `${publicUrl}?t=${Date.now()}`;
}

/**
 * Update the user's per-type notification preferences.
 * Stored in users.notification_preferences JSONB column (migration 006).
 *
 * @param prefs - Partial notification preferences to update (merged with existing)
 * @returns Updated UserRow
 */
export async function updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>,
): Promise<UserRow> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('로그인이 필요합니다.');

  // Merge with existing preferences before saving (partial update)
  const { data: existing } = await (supabase.from('users') as any)
    .select('notification_preferences')
    .eq('id', user.id)
    .single();

  const merged: NotificationPreferences = {
    ...(DEFAULT_NOTIFICATION_PREFERENCES),
    ...(existing?.notification_preferences ?? {}),
    ...prefs,
  };

  const { data, error } = await (supabase.from('users') as any)
    .update({ notification_preferences: merged })
    .eq('id', user.id)
    .select()
    .single();

  if (error || !data) throw error ?? new Error('알림 설정 저장에 실패했습니다.');
  return data;
}

/**
 * Permanently delete the authenticated user's account.
 *
 * Flow:
 *  1. Get the current session to extract the access token
 *  2. Call the `delete-account` Edge Function with the Bearer token
 *     — the function uses the service role key to call auth.admin.deleteUser()
 *  3. Sign out locally to clear cached credentials
 *
 * The Edge Function handles ON DELETE CASCADE for all dependent rows.
 * The client anon key cannot call auth.admin.deleteUser() directly.
 *
 * @throws Error if not authenticated or if the Edge Function returns an error
 */
export async function deleteAccount(): Promise<void> {
  // Retrieve the active session — needed to pass the access token to the Edge Function
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    // 세션 누락 — 만료 또는 네트워크 이슈. 서버 쪽에서도 같은 컨텍스트로 추적 가능
    await logError({
      context: 'auth.delete-account.no-session',
      error:   sessionError ?? new Error('no session'),
    });
    throw new Error('로그인이 필요합니다.');
  }

  // Invoke the delete-account Edge Function with the user's Bearer token.
  // The function validates the JWT and then uses the service role key to
  // call auth.admin.deleteUser() on the verified user ID.
  const { error } = await supabase.functions.invoke('delete-account', {
    headers: {
      // Pass the session token so the Edge Function can verify the caller's identity
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    // Edge Function 호출 실패 — 서버 쪽에서도 별도로 로깅되지만 클라이언트 관점 메타데이터 (네트워크 등)도 남김
    await logError({
      context: 'auth.delete-account.invoke',
      error,
      userId:  session.user.id,
    });
    // error.message may contain a server-side message; fall back to generic Korean message
    throw new Error(error.message ?? '계정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }

  // Clear local session after successful server-side deletion.
  // We downgrade the previous "silent catch" to a console.warn so Metro still
  // records sign-out errors (e.g. network offline after delete) for triage.
  try {
    await supabase.auth.signOut();
  } catch (signOutErr) {
    console.warn('[authService.deleteAccount] signOut failed (non-fatal):', signOutErr);
  }
}

/**
 * Sign in with email and password (development only).
 * Uses Supabase email/password auth — account must be pre-created in the dashboard.
 * Only call this from __DEV__ code paths; never ship in production.
 *
 * @param email    - Test account email
 * @param password - Test account password
 */
export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error('세션을 생성하지 못했습니다.');
  return buildSignInResult(data.session);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Converts a Supabase Session object to our internal AuthSession shape.
 */
function toAuthSession(session: Session): AuthSession {
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: new Date((session.expires_at ?? 0) * 1000),
  };
}

/**
 * Builds a full SignInResult from an active Supabase session.
 * Fetches the user's public profile row and detects first-time sign-in.
 *
 * @param session - Active Supabase session (returned after signInWithIdToken or code exchange)
 */
async function buildSignInResult(session: Session): Promise<SignInResult> {
  const authSession = toAuthSession(session);

  // The handle_new_user trigger creates a public.users row automatically.
  // This fetch should always succeed; error here indicates a migration issue.
  // Cast through `unknown` because the generated Database types omit a
  // Relationships entry for `users`, which makes the row resolve as `never`.
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', session.user.id)
    .single();
  const userRow = data as unknown as UserRow | null;

  if (error || !userRow) {
    throw new Error('사용자 프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }

  // Treat a user as "new" when their nickname hasn't been set yet.
  // The handle_new_user trigger defaults nickname to the email username part
  // (split_part(email, '@', 1)), so we detect that state here and route them
  // to the nickname onboarding screen instead of straight to tabs.
  const emailUsername = (session.user.email ?? '').split('@')[0];
  const isNewUser = !userRow.nickname || userRow.nickname === emailUsername;

  return {
    session: authSession,
    user: userRow,
    isNewUser,
  };
}

/**
 * Type guard: checks if an error has a Google Sign In status code.
 */
function isStatusCodeError(err: unknown, code: string | number): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === code
  );
}
