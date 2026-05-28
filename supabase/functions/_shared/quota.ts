/**
 * Server-side AI quota / rate limit helper for Edge Functions.
 *
 * Why this lives here (Sprint 17 P0 hardening):
 *   - Client tracks daily AI usage in AsyncStorage, but a malicious or
 *     buggy client can lie. Server is the only trustworthy gate.
 *   - Without per-user limits a Pro account could automate the call and
 *     burn $X of Claude API budget per hour. We cap both Free and Pro
 *     to safe ceilings so the budget can't run away from a single user.
 *
 * Implementation:
 *   - We re-use the existing `usage_metrics` table (one row per AI call)
 *     and count rows in a sliding window per user × function. No new
 *     storage needed.
 *   - The default limits per function are tuned to (a) satisfy normal
 *     interactive use (Pro should never feel limited) and (b) guarantee
 *     that even a fully-saturated user can only burn a few dollars/day.
 *
 * Usage in an Edge Function handler:
 *   ```ts
 *   import { enforceQuota } from '../_shared/quota.ts';
 *
 *   const { allowed, plan, remaining, reason } = await enforceQuota({
 *     adminClient, userId, functionName: 'parse-event',
 *   });
 *   if (!allowed) return new Response(JSON.stringify({ error: reason }), { status: 429 });
 *   ```
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export type SubscriptionPlan = 'free' | 'pro';

export interface QuotaResult {
  allowed: boolean;
  plan: SubscriptionPlan;
  /** Remaining calls in the current window (after this would-be call). */
  remaining: number;
  /** When non-null, the i18n-friendly machine reason the call is blocked. */
  reason?: 'quota_free_daily' | 'quota_pro_hourly' | 'quota_pro_daily' | 'pro_required' | 'auth';
}

/**
 * Per-function caps. Tuned for AI cost containment.
 * - Free: hard daily cap (matches client AsyncStorage default of 5/day).
 * - Pro:  generous hourly cap so normal use never hits it but a runaway
 *         loop can only burn ~ N × hourly × 24 calls per day.
 */
const LIMITS: Record<string, { freeDaily: number; proHourly: number; proDaily?: number; proRequiresPaid?: boolean }> = {
  // v1.2.9 — local 정규식 파서 제거 + AI-only 전환. abuser 1명이 봇으로
  // 시간당 60×24h 돌릴 수 없도록 proDaily cap 추가. Free 도 5→10 (정상
  // 사용자 cap 도달 빈발 방지).
  'parse-event':          { freeDaily: 10, proHourly: 30, proDaily: 100 },
  // 사진 첨부 NL — Sonnet vision 사용으로 텍스트 대비 비용 ~10× 높아 free
  // 1일 2회 (LEAD 결정 2026-05-06). Pro 도 hourly 보수적으로.
  'parse-event-vision':   { freeDaily: 2,  proHourly: 20 },
  'suggest-date':         { freeDaily: 3,  proHourly: 30 },
  'weekly-review':        { freeDaily: 1,  proHourly: 5  },
  'translate-event':      { freeDaily: 0,  proHourly: 60, proRequiresPaid: true },
  // PRD 4.2 Tier 3: Free 월 5회 (일 단위 환산 — 일별 1회 한도로 관리,
  // 월 5회 누적은 클라이언트 subscriptionStore에서 추가로 추적).
  // Pro: 시간당 20회 (주간 페이스).
  'recommend-free-time':  { freeDaily: 1,  proHourly: 20 },
  // v1.1 Phase 1 — 음성 인식 결과 후보정. 짧은 disambiguate prompt (≤50
  // tokens) 라 1회당 ¢ 미만이지만 selective 호출되도록 cap 보수적으로.
  'disambiguate-voice':   { freeDaily: 30, proHourly: 60 },
  // v1.2 Phase 2 — AI 비서 Chat (Sonnet 4.6 + tool use). Sonnet 토큰이
  // 비싸 첫 1주 hard cap. ASSISTANT_HARD_CAP 환경변수로 임시 5턴/일 까지
  // 더 좁힐 수 있다 (배포 직후 모니터링용).
  'assistant-chat':       { freeDaily: 10, proHourly: 40 },
  // v1.2 Phase 3 — 캘린더 충돌 시 대안 시간 제안. Haiku, 짧은 응답.
  'suggest-slot':         { freeDaily: 5,  proHourly: 30 },
  // v1.2.7 — 이벤트 이미지 분석 (Haiku Vision). 비용 ~10× 텍스트. cap 보수적.
  'analyze-image':        { freeDaily: 5,  proHourly: 15 },
  // v1.2.7 — AI 분석 대시보드 자연어 인사이트. Haiku, 1회당 ~$0.001.
  // Free 일 1회 (preset 변경 시 trigger 라 cap 보수적), Pro 시간당 10.
  'generate-insights':    { freeDaily: 1,  proHourly: 10 },
};

/**
 * Resolve the caller's subscription_plan from public.users. Returns 'free'
 * when the row is missing — the trigger introduced in migration 016 only
 * lets server roles change the column, so a missing row is the same as
 * "default tier".
 */
async function getPlan(adminClient: SupabaseLike, userId: string): Promise<SubscriptionPlan> {
  const { data } = await adminClient
    .from('users')
    .select('subscription_plan')
    .eq('id', userId)
    .maybeSingle();
  return (data?.subscription_plan === 'pro' ? 'pro' : 'free');
}

/**
 * Count usage_metrics rows for a (user, function) within a sliding window.
 */
async function countRecentCalls(
  adminClient: SupabaseLike,
  userId: string,
  functionName: string,
  sinceIso: string,
): Promise<number> {
  const { count } = await adminClient
    .from('usage_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('function_name', functionName)
    .gte('called_at', sinceIso);
  return count ?? 0;
}

/**
 * Enforce per-user, per-function quota. Caller MUST handle a `false` result
 * as a user-facing error (HTTP 429 / 403 depending on `reason`).
 */
export async function enforceQuota(args: {
  adminClient: SupabaseLike;
  userId: string;
  functionName: keyof typeof LIMITS | string;
}): Promise<QuotaResult> {
  const { adminClient, userId, functionName } = args;
  const limits = LIMITS[functionName];
  if (!limits) {
    // v1.2.7 보안 강화: 미등록 함수는 거절 (allowlist 방식).
    // 이전엔 permissive 였는데 새 함수 LIMITS 등록 누락 시 quota 우회 가능
    // → 비용 폭증 위험. 이제는 명시 등록 안 된 함수 호출 시 즉시 차단.
    console.warn(`[quota] unknown function: ${functionName} — request blocked`);
    return { allowed: false, plan: 'free', remaining: 0, reason: 'quota_free_daily' };
  }

  const plan = await getPlan(adminClient, userId);

  if (limits.proRequiresPaid && plan !== 'pro') {
    return { allowed: false, plan, remaining: 0, reason: 'pro_required' };
  }

  const now = Date.now();
  if (plan === 'pro') {
    // Pro: hourly window + (optional) daily cap.
    // v1.2.9 — proDaily 정의된 함수는 24h cap 도 검사. abuser 보호.
    const since = new Date(now - 60 * 60 * 1000).toISOString();
    const used = await countRecentCalls(adminClient, userId, functionName, since);
    const cap = limits.proHourly;
    if (used >= cap) {
      return { allowed: false, plan, remaining: 0, reason: 'quota_pro_hourly' };
    }
    if (limits.proDaily !== undefined) {
      const todayUTC = new Date(now);
      todayUTC.setUTCHours(0, 0, 0, 0);
      const usedToday = await countRecentCalls(adminClient, userId, functionName, todayUTC.toISOString());
      if (usedToday >= limits.proDaily) {
        return { allowed: false, plan, remaining: 0, reason: 'quota_pro_daily' };
      }
      return { allowed: true, plan, remaining: Math.min(cap - used, limits.proDaily - usedToday) - 1 };
    }
    return { allowed: true, plan, remaining: cap - used - 1 };
  }

  // Free: daily window (UTC midnight rollover keeps it simple cross-tz)
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const used = await countRecentCalls(adminClient, userId, functionName, today.toISOString());
  const cap = limits.freeDaily;
  if (used >= cap) {
    return { allowed: false, plan, remaining: 0, reason: 'quota_free_daily' };
  }
  return { allowed: true, plan, remaining: cap - used - 1 };
}
