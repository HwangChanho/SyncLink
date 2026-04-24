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
import type { Session } from '@supabase/supabase-js';
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

  // Ensure Google Play Services are available (Android only; no-op on iOS)
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let idToken: string | null = null;

  try {
    const userInfo = await GoogleSignin.signIn();

    // v13+ returns { type: 'success'|'cancelled', data: { idToken } }
    // Older versions return { idToken } directly — handle both shapes
    idToken = (userInfo as any)?.idToken
      ?? (userInfo as any)?.data?.idToken
      ?? null;

    if (!idToken) {
      // Type indicates cancellation in v13+
      const type = (userInfo as any)?.type;
      if (type === 'cancelled' || type === 'noSavedCredentialFound') {
        throw new Error('cancelled');
      }
      throw new Error('Google ID 토큰을 받지 못했습니다. 다시 시도해 주세요.');
    }
  } catch (err: unknown) {
    // Map Google-specific error codes to friendly messages
    if (isStatusCodeError(err, statusCodes.SIGN_IN_CANCELLED)) {
      throw new Error('cancelled');
    }
    if (isStatusCodeError(err, statusCodes.IN_PROGRESS)) {
      throw new Error('Google 로그인이 이미 진행 중입니다.');
    }
    if (isStatusCodeError(err, statusCodes.PLAY_SERVICES_NOT_AVAILABLE)) {
      throw new Error('Google Play 서비스를 사용할 수 없습니다. 기기를 확인해 주세요.');
    }
    // Developer-facing: DEVELOPER_ERROR usually means bundle ID mismatch in Google Cloud Console
    // Fix: ensure iOS OAuth client is registered with bundle ID io.synclink.app
    if (isStatusCodeError(err, 10 /* DEVELOPER_ERROR */)) {
      throw new Error('Google 로그인 설정 오류입니다. (DEVELOPER_ERROR: 번들 ID 불일치 — Google Cloud Console에서 io.synclink.app으로 iOS 클라이언트를 재생성하세요)');
    }
    throw err;
  }

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
  // ── 1. Resolve the REST API key and redirect URI ────────────────────────
  const kakaoRestApiKey = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY;
  if (!kakaoRestApiKey) {
    throw new Error(
      'Kakao 로그인 설정이 누락되었습니다. (EXPO_PUBLIC_KAKAO_REST_API_KEY 미설정)',
    );
  }

  // Kakao requires HTTPS redirect_uri and does NOT accept custom schemes.
  // Architecture: our Edge Function IS the redirect target. It processes the
  // code server-side and then bounces the user-agent back to the app via an
  // HTML redirect to this appReturn URL.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase 설정이 누락되었습니다.');
  }
  const origin = (globalThis as typeof globalThis & { location?: { origin?: string } })
    .location?.origin;
  const appReturn = Platform.OS === 'web' && origin
    ? `${origin}/auth/callback`
    : Linking.createURL('/auth/callback');
  // Edge Function URL (registered in Kakao Developer Console as a Redirect URI)
  const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/kakao-auth`;

  // ── 2. Build the Kakao authorize URL ────────────────────────────────────
  // redirect_uri = our Edge Function (HTTPS, Kakao-compatible)
  // state = app-return URL so the Edge Function can bounce back to us
  const authUrl =
    'https://kauth.kakao.com/oauth/authorize' +
    `?client_id=${encodeURIComponent(kakaoRestApiKey)}` +
    `&redirect_uri=${encodeURIComponent(edgeFunctionUrl)}` +
    `&state=${encodeURIComponent(appReturn)}` +
    '&response_type=code';

  // ── 3. Open Kakao consent UI and watch for the app-return redirect ──────
  // After Kakao redirects to our Edge Function, the function processes the
  // code and redirects (via HTML) to `appReturn?email=...&password=...`.
  // WebBrowser catches that URL (matches its watch pattern) and closes.
  const result = await WebBrowser.openAuthSessionAsync(authUrl, appReturn, {
    showInRecents: false,
  });

  if (result.type !== 'success') {
    throw new Error('cancelled');
  }

  // ── 4. Extract email/password from the final redirect URL ───────────────
  // result.url looks like: synclink://auth/callback?email=...&password=...
  // (or on web: https://app.example.com/auth/callback?email=...&password=...)
  const errParam = extractQueryParam(result.url, 'error');
  if (errParam) {
    const err = new Error(`Kakao 로그인 오류: ${decodeURIComponent(errParam)}`);
    // Edge Function이 HTML redirect로 돌려보낸 에러 문자열을 기록
    await logError({ context: 'auth.kakao.edge-error', error: err, details: { errParam } });
    throw err;
  }
  const email = extractQueryParam(result.url, 'email');
  const password = extractQueryParam(result.url, 'password');
  if (!email || !password) {
    const err = new Error('Kakao 로그인 응답이 올바르지 않습니다.');
    // 이메일/비밀번호 중 하나가 없는 비정상 응답 (password 값은 민감하므로 기록하지 않음)
    await logError({
      context: 'auth.kakao.malformed-response',
      error:   err,
      details: { hasEmail: !!email, hasPassword: !!password },
    });
    throw err;
  }

  // ── 6. Exchange the derived credentials for a real Supabase session ─────
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
  updates: Partial<Pick<UserRow, 'nickname' | 'avatar_url' | 'notification_settings'>>,
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
export async function uploadAvatar(localUri: string): Promise<string> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('로그인이 필요합니다.');

  // Fetch the file as a blob — works for both file:// (iOS) and content:// (Android) URIs
  const response = await fetch(localUri);
  const blob = await response.blob();

  // Derive extension from MIME type (e.g. 'image/jpeg' → 'jpeg')
  const mimeType = blob.type || 'image/jpeg';
  const fileExt = mimeType.split('/')[1] ?? 'jpg';

  // Store at {userId}/avatar.{ext} — overwrite on re-upload
  const filePath = `${user.id}/avatar.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, blob, {
      contentType: mimeType,
      upsert: true, // overwrite existing file
    });

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
  const { data: userRow, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', session.user.id)
    .single();

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
