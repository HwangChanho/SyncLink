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
import { supabase } from '@/lib/supabase';
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
    throw err;
  }

  // Exchange Google ID token for Supabase session
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) throw error;
  if (!data.session) throw new Error('세션을 생성하지 못했습니다.');

  return buildSignInResult(data.session);
}

/**
 * Sign in with Kakao OAuth.
 *
 * Flow:
 *  1. supabase.auth.signInWithOAuth({ provider: 'kakao', skipBrowserRedirect: true })
 *     → returns the Kakao authorization URL
 *  2. WebBrowser.openAuthSessionAsync(url, redirectTo)
 *     → opens in-app browser, waits for redirect to synclink://auth/callback
 *  3. supabase.auth.exchangeCodeForSession(redirectUrl)
 *     → completes PKCE code exchange, establishes session
 *
 * Deep link scheme: synclink:// (configured in app.json)
 * Redirect URI must be registered in Kakao developer console.
 *
 * @throws Error with message 'cancelled' if user closes the browser
 */
export async function signInWithKakao(): Promise<SignInResult> {
  // The redirect URL must match what's registered in Kakao developer console
  // and in Supabase Dashboard > Authentication > Providers > Kakao
  // In production: 'synclink://auth/callback'
  // In Expo Go dev: Linking.createURL() returns exp:// which won't match — use a dev build
  // On web, use the browser's origin for the redirect URL;
  // on native, use the deep link scheme registered in app.json
  const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin;
  const redirectTo = Platform.OS === 'web' && origin
    ? `${origin}/auth/callback`
    : Linking.createURL('/auth/callback');

  // Get the Kakao authorization URL from Supabase (skipBrowserRedirect = we open it manually)
  const { data: oauthData, error: oauthError } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (oauthError) throw oauthError;
  if (!oauthData.url) throw new Error('OAuth URL을 받지 못했습니다.');

  // Open Kakao login page in an in-app browser
  // Waits until the browser redirects to our redirectTo URL and captures it
  const result = await WebBrowser.openAuthSessionAsync(oauthData.url, redirectTo, {
    showInRecents: false,
  });

  if (result.type !== 'success') {
    // User closed the browser (type === 'cancel' or 'dismiss')
    throw new Error('cancelled');
  }

  // Exchange the PKCE authorization code in the redirect URL for a session
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(result.url);
  if (exchangeError) throw exchangeError;

  // Retrieve the established session
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error('세션을 가져오지 못했습니다.');

  return buildSignInResult(sessionData.session);
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

  if (error) throw error;
  if (!data.session) throw new Error('세션을 생성하지 못했습니다.');

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

  if (uploadError) throw uploadError;

  // Get the public URL (bucket must be public in Supabase Storage settings)
  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  return publicUrl;
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
    // error.message may contain a server-side message; fall back to generic Korean message
    throw new Error(error.message ?? '계정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }

  // Clear local session after successful server-side deletion
  // Ignore sign-out errors — the auth.users row is already gone
  try {
    await supabase.auth.signOut();
  } catch {
    // Silent — server-side deletion already succeeded
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
