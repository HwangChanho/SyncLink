/**
 * adminService — 관리자 대시보드 전용 (별도 인증).
 *
 * supabase auth 와 완전 분리. admin_credentials 테이블의 username/password
 * 로 검증. 매 RPC 호출에 자격 증명 전달.
 *
 * 저장: AsyncStorage (web 에서는 localStorage 로 polyfill 됨).
 */
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'admin-credentials';

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface AdminStats {
  days: number;
  since: string;
  today: {
    calls: number;
    users: number;
    in_tok: number;
    out_tok: number;
    usd: number;
  };
  users: {
    total_users: number;
    active_users: number;
  };
  by_function: Array<{
    function_name: string;
    calls: number;
    users: number;
    in_tok: number;
    out_tok: number;
    usd: number;
  }>;
  by_day: Array<{
    day: string;
    calls: number;
    users: number;
    out_tok: number;
    usd: number;
  }>;
  by_day_function: Array<{
    function_name: string;
    day: string;
    calls: number;
  }>;
}

/** 저장된 admin 자격 증명 읽기. null = 미저장. */
export async function getSavedCredentials(): Promise<AdminCredentials | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.username === 'string' && typeof parsed?.password === 'string') {
      return parsed as AdminCredentials;
    }
    return null;
  } catch {
    return null;
  }
}

/** username/password 저장 (로그인 성공 직후). */
export async function saveCredentials(creds: AdminCredentials): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

/** 저장 삭제 (로그아웃). */
export async function clearCredentials(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * username/password 검증. RPC `admin_verify` 호출.
 * @returns true = 일치, false = 불일치
 */
export async function adminLogin(username: string, password: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('admin_verify', {
    p_username: username,
    p_password: password,
  });
  if (error) throw error;
  return Boolean(data);
}

/**
 * 통계 조회. RPC `admin_get_stats` 호출 — username/password 가 함께 전송됨.
 */
export async function getAdminStats(
  creds: AdminCredentials,
  days = 7,
): Promise<AdminStats> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('admin_get_stats', {
    p_username: creds.username,
    p_password: creds.password,
    days,
  });
  if (error) throw error;
  if (!data) throw new Error('관리자 통계가 비어있어요.');
  return data as AdminStats;
}
