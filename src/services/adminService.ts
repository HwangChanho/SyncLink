/**
 * adminService — 관리자 대시보드 전용 (별도 인증 + 토큰 세션).
 *
 * supabase auth 와 완전 분리. 흐름:
 *   1. adminLogin(username, password) → 서버에서 token + expires_at 발급
 *   2. AsyncStorage 에 { token, expiresAt } 저장 (password 저장 X)
 *   3. 이후 모든 RPC 호출은 token 만 전송
 *   4. expires_at 경과 또는 'invalid or expired session' 에러 시 자동 logout
 *
 * 보안 (마이그레이션 050):
 *   - 서버 admin_login = rate limit 5회/5분, 토큰 10시간 expire
 *   - admin_verify 는 anon revoke (외부 노출 차단)
 *   - 평문 password 는 로그인 1회 외 전송/저장 X
 */
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = 'admin-session';

export interface AdminSession {
  token: string;
  /** ISO 8601 — 절대 만료 시각 (10시간) */
  expiresAt: string;
  username: string;
}

export interface AdminStats {
  days: number;
  since: string;
  today: { calls: number; users: number; in_tok: number; out_tok: number; usd: number };
  /**
   * 사용자 카운트.
   * - total_users / active_users: 기존 (마이그레이션 048~050)
   * - pro_users / free_users: 마이그레이션 054 신규 — 구버전 서버 응답엔 없을 수 있어 optional.
   */
  users: {
    total_users: number;
    active_users: number;
    pro_users?: number;
    free_users?: number;
  };
  by_function: Array<{
    function_name: string;
    calls: number;
    users: number;
    in_tok: number;
    out_tok: number;
    usd: number;
  }>;
  by_day: Array<{ day: string; calls: number; users: number; out_tok: number; usd: number }>;
  by_day_function: Array<{ function_name: string; day: string; calls: number }>;

  // ─── 마이그레이션 054 신규 (모두 optional — 구버전 서버 안전) ───────────────
  /** 모델(Haiku/Sonnet 등)별 비용 분해. */
  by_model?: Array<{
    model: string;
    calls: number;
    in_tok: number;
    out_tok: number;
    usd: number;
  }>;
  /** 기능영역(feature_area)별 비용. */
  by_feature?: Array<{ feature_area: string; calls: number; usd: number }>;
  /** 일별 신규 가입 수 (기간 내). */
  signups_by_day?: Array<{ day: string; signups: number }>;
  /** last_event_at 기반 리텐션 버킷. */
  retention?: { active_7d: number; active_30d: number; dormant: number };
  /** 국가 분포 top (NULL = '미상'). */
  country_dist?: Array<{ country_code: string; users: number }>;
}

export type UsersSort = 'recent' | 'active' | 'usage';

export interface AdminUserRow {
  id: string;
  nickname: string | null;
  email: string | null;
  subscription_plan: 'free' | 'pro' | null;
  country_code: string | null;
  created_at: string;
  event_count: number;
  ai_calls: number;
  last_event_at: string | null;
  total_cost_usd: number;
}

export interface AdminUsersResult {
  sort: UsersSort;
  limit: number;
  total: number;
  rows: AdminUserRow[];
}

/** 만료 / 잘못된 세션 에러 판단 — 자동 로그아웃 트리거. */
function isSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid or expired session|permission denied|too many attempts/i.test(msg);
}

// ─── 세션 저장 / 복구 ─────────────────────────────────────────────────────

export async function getSavedSession(): Promise<AdminSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (typeof parsed?.token !== 'string' || typeof parsed?.expiresAt !== 'string') {
      return null;
    }
    // 클라이언트 측 1차 만료 확인 (서버도 검증하지만 빠른 UX).
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveSession(s: AdminSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ─── RPC wrapper ─────────────────────────────────────────────────────────

/** user agent 헤더 — 서버 로그에 기록 (감사 추적용). */
function getUserAgent(): string {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return (navigator as { userAgent?: string }).userAgent?.slice(0, 200) ?? 'web';
  }
  return `${Platform.OS}/${Platform.Version}`;
}

/**
 * 관리자 로그인.
 * - 성공: token + expiresAt 저장 + AdminSession 반환
 * - 실패: throw Error (메시지 = i18n 키 비슷한 reason)
 *
 * 서버 응답: { ok: true, token, expires_at, username }
 *           | { ok: false, reason: 'too_many_attempts' | 'invalid_credentials' }
 * raise exception 대신 jsonb 응답 = transaction commit 보존 → attempts 누적.
 */
export async function adminLogin(username: string, password: string): Promise<AdminSession> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('admin_login', {
    p_username:   username,
    p_password:   password,
    p_user_agent: getUserAgent(),
  });
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('서버 응답이 비어있어요.');

  if (data.ok === false) {
    if (data.reason === 'too_many_attempts') {
      throw new Error('too many attempts');
    }
    throw new Error('invalid credentials');
  }

  if (!data.token || !data.expires_at) {
    throw new Error('서버 응답이 비어있어요.');
  }

  const session: AdminSession = {
    token:     data.token,
    expiresAt: data.expires_at,
    username:  data.username,
  };
  await saveSession(session);
  return session;
}

/** 명시 로그아웃 — 서버에서 토큰 폐기 + 클라 저장 삭제. */
export async function adminLogout(token: string | null): Promise<void> {
  if (token) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('admin_logout', { p_token: token });
    } catch {
      // 서버 실패해도 클라는 무조건 logout.
    }
  }
  await clearSession();
}

/** 통계 조회 — token 사용. 세션 무효 시 throw + 호출 측에서 clearSession. */
export async function getAdminStats(token: string, days = 7): Promise<AdminStats> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('admin_get_stats', {
    p_token: token,
    days,
  });
  if (error) {
    if (isSessionError(error)) await clearSession();
    throw error;
  }
  if (!data) throw new Error('관리자 통계가 비어있어요.');
  return data as AdminStats;
}

/** 사용자 목록 조회. */
export async function getAdminUsers(
  token: string,
  sort: UsersSort = 'recent',
  limit = 50,
): Promise<AdminUsersResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('admin_get_users', {
    p_token: token,
    p_limit: limit,
    p_sort:  sort,
  });
  if (error) {
    if (isSessionError(error)) await clearSession();
    throw error;
  }
  if (!data) throw new Error('사용자 목록이 비어있어요.');
  return data as AdminUsersResult;
}

// ─── 호환 — 화면에서 import 하는 이름 그대로 유지 (오래된 import 보호) ──────
// AdminCredentials 는 더 이상 사용 안 함. 단 코드 references 가 남아있으면
// 컴파일 에러 → 다음 cycle 정리.
