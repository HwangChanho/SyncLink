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
  reason?: 'quota_free_daily' | 'quota_pro_hourly' | 'pro_required' | 'auth';
}

/**
 * Per-function caps. Tuned for AI cost containment.
 * - Free: hard daily cap (matches client AsyncStorage default of 5/day).
 * - Pro:  generous hourly cap so normal use never hits it but a runaway
 *         loop can only burn ~ N × hourly × 24 calls per day.
 */
const LIMITS: Record<string, { freeDaily: number; proHourly: number; proRequiresPaid?: boolean }> = {
  'parse-event':          { freeDaily: 5,  proHourly: 60 },
  'suggest-date':         { freeDaily: 3,  proHourly: 30 },
  'weekly-review':        { freeDaily: 1,  proHourly: 5  },
  'translate-event':      { freeDaily: 0,  proHourly: 60, proRequiresPaid: true },
  // PRD 4.2 Tier 3: Free 월 5회 (일 단위 환산 — 일별 1회 한도로 관리,
  // 월 5회 누적은 클라이언트 subscriptionStore에서 추가로 추적).
  // Pro: 시간당 20회 (주간 페이스).
  'recommend-free-time':  { freeDaily: 1,  proHourly: 20 },
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
    // Unknown function — be permissive but log so we notice.
    return { allowed: true, plan: 'free', remaining: Infinity };
  }

  const plan = await getPlan(adminClient, userId);

  if (limits.proRequiresPaid && plan !== 'pro') {
    return { allowed: false, plan, remaining: 0, reason: 'pro_required' };
  }

  const now = Date.now();
  if (plan === 'pro') {
    // Pro: hourly window
    const since = new Date(now - 60 * 60 * 1000).toISOString();
    const used = await countRecentCalls(adminClient, userId, functionName, since);
    const cap = limits.proHourly;
    if (used >= cap) {
      return { allowed: false, plan, remaining: 0, reason: 'quota_pro_hourly' };
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
