/**
 * adminService — 관리자 대시보드 (`/admin/dashboard`) 전용.
 *
 * 모든 함수는 SECURITY DEFINER RPC 를 거치며, RPC 안에서 app_admins 화이트
 * 리스트 가드. 비-관리자가 호출하면 permission denied raise → 에러.
 */
import { supabase } from '@/lib/supabase';

/** RPC get_admin_stats 의 응답 shape. */
export interface AdminStats {
  days: number;
  since: string;
  today: {
    calls: number;
    users: number;
    in_tok: number;
    out_tok: number;
    est_usd: number;
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
    avg_ms: number;
    est_usd: number;
  }>;
  by_day: Array<{
    day: string;
    calls: number;
    users: number;
    out_tok: number;
  }>;
  by_day_function: Array<{
    function_name: string;
    day: string;
    calls: number;
  }>;
}

/**
 * 호출자가 admin (app_admins 화이트리스트 매칭) 인지 확인.
 * 화면 진입 가드 UX 용 — 서버 측 진짜 가드는 RPC 안에 있다.
 */
export async function isAdmin(): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('is_admin');
  if (error) return false;
  return Boolean(data);
}

/**
 * 관리자 통계.
 * @param days 집계 기간 (default 7)
 */
export async function getAdminStats(days = 7): Promise<AdminStats> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_admin_stats', { days });
  if (error) throw error;
  if (!data) throw new Error('관리자 통계가 비어있어요.');
  return data as AdminStats;
}
