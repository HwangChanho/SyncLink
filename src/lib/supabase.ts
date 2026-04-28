/**
 * Supabase client initialization.
 *
 * This is the ONLY place where the Supabase client is created.
 * Services import this instance; components NEVER import it directly.
 *
 * Environment variables:
 *  - EXPO_PUBLIC_SUPABASE_URL: your Supabase project URL
 *  - EXPO_PUBLIC_SUPABASE_ANON_KEY: your public anon key (safe to expose)
 *
 * Note: EXPO_PUBLIC_ prefix makes vars available on the client bundle.
 * The service role key must NEVER appear here — Edge Functions only.
 *
 * ⚠️  BLOCKED: Requires .env to be filled in (see ESCALATION-001).
 */

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { Database } from '@/types';

/**
 * Web-aware storage adapter.
 *
 * LEAD 2026-04-28: 새 창/탭에서도 같은 세션 공유.
 *
 * - React Native (iOS/Android): AsyncStorage (per-app local storage).
 * - Web: window.localStorage 직접 사용.
 *   - 같은 origin 모든 탭/창이 즉시 같은 세션 공유.
 *   - storage event 로 한 탭에서 로그아웃 시 다른 탭도 즉시 갱신.
 *
 * AsyncStorage 의 web 폴리필도 localStorage 를 쓰지만, 명시적 분기로
 * 웹 사용자에게 직관적인 동작을 보장하고 SSR safety 도 강화한다.
 */
const sessionStorage = Platform.OS === 'web' && typeof window !== 'undefined'
  ? {
      getItem: (k: string) => Promise.resolve(window.localStorage.getItem(k)),
      setItem: (k: string, v: string) => {
        window.localStorage.setItem(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        window.localStorage.removeItem(k);
        return Promise.resolve();
      },
    }
  : AsyncStorage;

// Validate required environment variables at startup
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Warn instead of throw — throwing at module level breaks test environments
  // that mock the client. Real connection attempts will still fail gracefully.
  // See: docs/escalations/ESCALATION-001.md for setup instructions.
  console.warn(
    '[SyncLink] Missing Supabase credentials.\n' +
    'Copy .env.example to .env and fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.\n' +
    'See docs/escalations/ESCALATION-001.md for setup instructions.'
  );
}

/**
 * Typed Supabase client.
 *
 * The Database generic provides full type-safety for all table operations:
 *   const { data } = await supabase.from('events').select('*')
 *   // data is EventRow[] | null — fully typed
 */
/**
 * Re-exported Supabase URL / anon key for callers that need to hit Edge
 * Functions with a raw fetch (e.g. unauthenticated calls to `kakao-auth`
 * before a session exists). Reading `process.env.EXPO_PUBLIC_*` directly in
 * other modules is unsafe because babel-preset-expo's inline-env-vars plugin
 * bakes the value in at transform time, which breaks tests that `delete` the
 * env var to exercise the "missing credentials" code path. Reading through
 * these constants keeps the env lookup centralized in this file.
 */
export const SUPABASE_URL = supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = supabaseAnonKey ?? '';

export const supabase = createClient<Database>(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    // Native: AsyncStorage / Web: localStorage (위 sessionStorage 어댑터)
    storage: sessionStorage,
    // Automatically refresh the session token
    autoRefreshToken: true,
    // Persist session across app restarts
    persistSession: true,
    // Web: OAuth redirect 후 자동으로 URL fragment 의 session 토큰 처리
    // (deep link 도 같은 흐름으로 들어와 detectSessionInUrl 가 활성화 필요).
    detectSessionInUrl: Platform.OS === 'web',
    // PKCE: 모바일/웹 모두 권장 (refresh token 보안 강화 + 새 창 호환).
    flowType: 'pkce',
  },
});

/**
 * Web 에서 다른 탭/창의 로그인/로그아웃 즉시 동기화.
 *
 * Supabase 의 onAuthStateChange 는 같은 client 인스턴스 내에서만 동작한다.
 * 다른 탭에서 로그인/로그아웃이 일어나면 localStorage 는 갱신되지만 본 탭의
 * 메모리 상 session 은 변하지 않으므로 storage 이벤트로 강제 동기화한다.
 */
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    // Supabase v2 는 'sb-<project-ref>-auth-token' 키 패턴을 사용한다.
    if (event.key && event.key.startsWith('sb-') && event.key.endsWith('-auth-token')) {
      // _resumeSession 가 storage 에서 최신 토큰을 다시 읽어와 메모리 session 갱신.
      void supabase.auth.getSession().catch(() => undefined);
    }
  });
}

/**
 * Helper to get the currently authenticated user ID.
 * Returns null if not logged in.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}
