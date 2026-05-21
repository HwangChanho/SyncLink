/**
 * externalCalendarService — Sprint 1 외부 캘린더 sync (Google).
 *
 * Edge Function 두 개를 클라이언트에서 호출:
 *  - google-calendar-connect : serverAuthCode → refresh_token 저장.
 *  - sync-google-calendar    : 일정 import (manual).
 *
 * GoogleSignin 은 authService 에서 이미 configure 됨 (basic scopes). 본 서비스는
 * 캘린더 scope 를 additional 로 요청해 serverAuthCode 만 받음 (별도 signIn
 * 세션 — 본 로그인 흐름과 분리).
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from '@/lib/supabase';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  Constants.expoConfig?.extra?.supabaseUrl ??
  '';

async function getUserJwt(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('로그인이 필요합니다.');
  return data.session.access_token;
}

async function callEdge<T>(
  path: 'google-calendar-connect' | 'sync-google-calendar',
  body: Record<string, unknown>,
): Promise<T> {
  const jwt = await getUserJwt();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof json.detail === 'string' ? json.detail : '';
    const errKey = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    throw new Error(`${errKey}${detail ? ` — ${detail}` : ''}`);
  }
  return json as T;
}

// ─── public API ──────────────────────────────────────────────────────────

export interface GoogleConnectionStatus {
  connected:        boolean;
  email:            string | null;
  connected_at:     string | null;
  last_sync_at:     string | null;
  last_sync_error:  string | null;
}

/**
 * 본인의 Google Calendar 연결 상태 조회 (RPC). token 자체는 안 옴, 메타만.
 */
export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const { data, error } = await supabase
    .rpc('get_google_connection_status')
    .single<GoogleConnectionStatus>();
  if (error) throw error;
  return data ?? { connected: false, email: null, connected_at: null, last_sync_at: null, last_sync_error: null };
}

/**
 * GoogleSignin 으로 calendar.readonly scope 동의 + serverAuthCode 획득 후
 * Edge Function 으로 refresh_token 교환·저장.
 *
 * Web 은 supabase OAuth redirect 흐름이 필요해 Sprint 1 에서 미지원
 * (네이티브 only).
 */
export async function connectGoogleCalendar(): Promise<{ email: string | null }> {
  if (Platform.OS === 'web') {
    throw new Error('웹은 다음 단계에서 지원됩니다. 모바일에서 연결해 주세요.');
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // 기존 세션 sign-out 후 forceCodeForRefreshToken 로 새 serverAuthCode 요청.
  // (한 번 동의한 사용자는 refresh_token 미발급. prompt=consent 효과.)
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }

  // configure 재호출 — 캘린더 scope 추가 + forceCodeForRefreshToken.
  GoogleSignin.configure({
    webClientId:               process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId:               process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    scopes:                    ['email', 'profile', 'openid', CALENDAR_SCOPE],
    offlineAccess:             true,
    forceCodeForRefreshToken:  true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await GoogleSignin.signIn();
  // v13+: { type, data: { serverAuthCode } } / 이전: { serverAuthCode }
  const serverAuthCode =
    result?.data?.serverAuthCode ??
    result?.serverAuthCode ??
    null;
  if (!serverAuthCode) {
    throw new Error('Google 인증에서 serverAuthCode 를 받지 못했어요. 다시 시도해 주세요.');
  }

  const response = await callEdge<{ connected: boolean; email: string | null }>(
    'google-calendar-connect',
    { action: 'connect', serverAuthCode },
  );
  return { email: response.email };
}

/**
 * 연결 해제 — Google revoke + DB row 삭제. Calendar 일정은 별도 정책 (이후
 * "유지/삭제 선택" UI 추가 — Sprint 1 은 단순히 token 만 끊고 events 유지).
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  await callEdge('google-calendar-connect', { action: 'disconnect' });
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }
}

/**
 * 수동 sync — 사용자가 "지금 동기화" 눌렀을 때.
 */
export interface ManualSyncResult {
  ok:        boolean;
  imported:  number;
  updated:   number;
  deleted:   number;
  error?:    string;
}

export async function syncGoogleCalendarNow(): Promise<ManualSyncResult> {
  return callEdge<ManualSyncResult>('sync-google-calendar', { mode: 'manual' });
}
