/**
 * Subscription store — manages the user's plan and AI usage limits.
 *
 * Responsibilities:
 *  - Track the current plan ('free' | 'pro')
 *  - Count daily AI fallback calls (Free: 5 per day)
 *  - Count weekly review uses per month (Free: 1 per month)
 *  - Auto-reset daily counter at midnight (based on lastResetDate)
 *  - Persist state to AsyncStorage so it survives app restarts
 *
 * Usage:
 *  ```tsx
 *  const { canUseAI, consumeAI } = useSubscriptionStore();
 *  if (!canUseAI()) { router.push('/subscription/paywall'); return; }
 *  consumeAI();
 *  ```
 *
 * Note: Actual payment integration (RevenueCat / react-native-purchases)
 * is deferred to v1.1. This sprint implements the UI gating layer only.
 *
 * TASK-505 (Sprint 5)
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  consumeAdCreditRemote,
  fetchAdCreditBalance,
} from '@/services/creditService';
import {
  FREE_REC_MONTHLY_LIMIT,
  PRO_REC_WEEKLY_LIMIT,
  REC_QUOTA_STORAGE_KEY,
} from '@/constants/config';

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for persisting subscription state. */
const SUBSCRIPTION_STORAGE_KEY = 'synclink:subscription';

/** Free plan: max AI fallback calls per day. */
export const FREE_AI_DAILY_LIMIT = 5;

/** Free plan: max weekly review generations per month. */
export const FREE_WEEKLY_REVIEW_MONTHLY_LIMIT = 1;

// Free Time Recommendation 한도 상수를 config에서 재-export (편의)
export { FREE_REC_MONTHLY_LIMIT, PRO_REC_WEEKLY_LIMIT };

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionPlan = 'free' | 'pro';

/**
 * Outcome of a `canUseAI()` check — richer than a boolean so the UI can
 * render different CTAs for each reason.
 *   - 'ok'        : plan allows AI right now (Pro, under quota, or has credits)
 *   - 'quota'     : free daily quota is exhausted but ad credits can fill in
 *   - 'no-credit' : no quota AND no credits → must upgrade or watch an ad
 *
 * Sprint 14 TASK-1403
 */
export interface CanUseAIResult {
  allowed: boolean;
  reason: 'ok' | 'quota' | 'no-credit';
}

interface SubscriptionState {
  /** Current user plan. */
  plan: SubscriptionPlan;

  /**
   * Number of AI fallback calls made today.
   * Resets automatically at midnight via lastResetDate comparison.
   */
  aiUsageToday: number;

  /**
   * Date string (YYYY-MM-DD) of the last reset.
   * Used to detect midnight rollover and reset aiUsageToday.
   */
  lastResetDate: string;

  /**
   * Number of weekly review generations used this calendar month.
   * Resets at the start of each month.
   */
  weeklyReviewUsedThisMonth: number;

  /**
   * Month string (YYYY-MM) when weeklyReviewUsedThisMonth was last reset.
   * Used to detect month rollover.
   */
  lastReviewResetMonth: string;

  /**
   * Ad-earned AI credits. Incremented by the `reward-credit` Edge Function
   * after AdMob SSV verification, decremented locally by `consumeAdCredit()`.
   * Loaded from Supabase via `refreshCredits()` — the store does NOT persist
   * this to AsyncStorage because the source of truth is the server.
   * Sprint 14 TASK-1403.
   */
  adCredits: number;

  // ── Free Time Recommendation 쿼터 (PRD 4.2 Tier 3) ────────────────────────

  /**
   * Free 플랜: 이번 달 AI 추천 사용 횟수.
   * 매월 1일 자동 리셋. Pro 플랜에서는 이 값을 추적하지 않음(무제한).
   */
  recUsedThisMonth: number;

  /**
   * 월 리셋 기준 문자열 (YYYY-MM).
   * recUsedThisMonth 리셋 여부 판단에 사용.
   */
  lastRecResetMonth: string;

  /**
   * Pro 플랜: 이번 주 AI 추천 사용 횟수.
   * 매주 월요일 자동 리셋.
   */
  recUsedThisWeek: number;

  /**
   * 주간 리셋 기준 문자열 (YYYY-Www, ISO 주차).
   * recUsedThisWeek 리셋 여부 판단에 사용.
   */
  lastRecResetWeek: string;

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Check if the user can make an AI fallback call right now.
   *
   * Returns a richer `CanUseAIResult` so the UI can distinguish between:
   *   - 'ok'       : call is allowed (Pro, within quota, or ad credits available)
   *   - 'quota'    : quota exhausted — offer ad CTA (credits can cover)
   *   - 'no-credit': quota exhausted AND no credits — paywall or ad CTA
   *
   * Also triggers a midnight reset if the date has changed since last check.
   * Sprint 14 TASK-1403 — upgraded return type from boolean.
   */
  canUseAI: () => CanUseAIResult;

  /**
   * Record one AI fallback call. Increments aiUsageToday up to the free daily
   * limit; once the quota is exhausted the call consumes one ad credit
   * instead (local optimistic decrement + server update).
   *
   * Safe to call without checking `canUseAI()` first — no-ops if neither
   * quota nor credits are available. Sprint 14 TASK-1403.
   */
  consumeAI: () => Promise<void>;

  /** Refresh `adCredits` from Supabase. Sprint 14 TASK-1403. */
  refreshCredits: () => Promise<void>;

  /**
   * Decrement the ad credit balance by 1 (optimistic local update + server
   * write). Safe to call when the balance is 0 (no-op, no server call).
   * Returns true if a credit was consumed, false otherwise.
   * Sprint 14 TASK-1403.
   */
  consumeAdCredit: () => Promise<boolean>;

  /**
   * Check if the user can generate a weekly review this month.
   * Pro users have unlimited access. Free users: FREE_WEEKLY_REVIEW_MONTHLY_LIMIT/month.
   *
   * @returns true if a weekly review generation is allowed
   */
  canUseWeeklyReview: () => boolean;

  /**
   * Record one weekly review generation for this month.
   */
  consumeWeeklyReview: () => void;

  /**
   * Upgrade or downgrade the subscription plan.
   * In v1.1, this will be called by the RevenueCat webhook listener.
   *
   * @param plan - New plan to apply
   */
  setPlan: (plan: SubscriptionPlan) => void;

  // ── Free Time Recommendation 쿼터 액션 (PRD 4.2 Tier 3) ──────────────────

  /**
   * AI 활동 추천 기능을 현재 사용할 수 있는지 확인.
   *
   * - Free:  이번 달 recUsedThisMonth < FREE_REC_MONTHLY_LIMIT (5회)
   * - Pro:   이번 주 recUsedThisWeek  < PRO_REC_WEEKLY_LIMIT   (50회)
   *
   * 한도 초과 시 false 반환 — UI는 룰 baseline만 표시하거나 업그레이드 CTA.
   * 자동 리셋(월/주) 포함.
   *
   * @returns true if AI recommendation is allowed right now
   */
  canUseFreeTimeRec: () => boolean;

  /**
   * AI 활동 추천 1회 사용 기록.
   * canUseFreeTimeRec() 확인 후 호출 권장.
   * 한도 초과 상태에서 호출해도 무한 증가하지 않음 (no-op).
   */
  consumeFreeTimeRec: () => void;

  /**
   * Load persisted state from AsyncStorage (called once at app startup).
   * Merges saved state with any midnight/month resets needed.
   */
  hydrate: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date as a YYYY-MM-DD string in local time. */
function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns the current month as a YYYY-MM string in local time. */
function currentMonthString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Persists subscription state fields to AsyncStorage (fire-and-forget). */
function persist(state: Partial<SubscriptionState>): void {
  AsyncStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(state)).catch(() => {
    // Storage failure is non-critical — state is still correct in memory
  });
}

/**
 * ISO 주차 문자열 반환 (YYYY-Www).
 * 월요일 기준 주차 계산 (ISO 8601).
 * 매주 월요일에 리셋되는 Pro 추천 쿼터 추적에 사용.
 */
function currentISOWeekString(): string {
  const d    = new Date();
  // ISO 주차: 목요일이 포함된 주를 기준 (ISO 8601)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // 이번 주 목요일로 이동해서 연도 결정
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year     = date.getUTCFullYear();
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  const week      = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * 추천 쿼터를 REC_QUOTA_STORAGE_KEY 에 별도 저장 (fire-and-forget).
 * subscription 상태와 분리 저장하여 다른 필드 hydration에 영향 없음.
 *
 * @param recUsedThisMonth  - Free 플랜 이번 달 사용 횟수
 * @param lastRecResetMonth - 마지막 리셋 월 (YYYY-MM)
 * @param recUsedThisWeek   - Pro 플랜 이번 주 사용 횟수
 * @param lastRecResetWeek  - 마지막 리셋 주차 (YYYY-Www)
 */
function persistRecQuota(
  recUsedThisMonth: number,
  lastRecResetMonth: string,
  recUsedThisWeek: number,
  lastRecResetWeek: string,
): void {
  AsyncStorage.setItem(REC_QUOTA_STORAGE_KEY, JSON.stringify({
    recUsedThisMonth,
    lastRecResetMonth,
    recUsedThisWeek,
    lastRecResetWeek,
  })).catch(() => { /* non-critical */ });
}

// (mirrorPlanToServer removed — server-authoritative plan now comes from
//  the RevenueCat webhook + LEAD admin tooling. Migration 016's trigger
//  rejects client-side writes to subscription_plan / is_admin /
//  ai_ad_credits anyway, so calling it would only generate noise.)

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  plan: 'free',
  aiUsageToday: 0,
  lastResetDate: todayString(),
  weeklyReviewUsedThisMonth: 0,
  lastReviewResetMonth: currentMonthString(),
  adCredits: 0,
  // PRD 4.2 Tier 3 추천 쿼터 초기값
  recUsedThisMonth:  0,
  lastRecResetMonth: currentMonthString(),
  recUsedThisWeek:   0,
  lastRecResetWeek:  currentISOWeekString(),

  canUseAI: (): CanUseAIResult => {
    const state = get();

    // Pro plan: unlimited — no need to track quotas
    if (state.plan === 'pro') return { allowed: true, reason: 'ok' };

    // Auto-reset at midnight: if lastResetDate is not today, reset counter
    const today = todayString();
    if (state.lastResetDate !== today) {
      set({ aiUsageToday: 0, lastResetDate: today });
      persist({ ...get(), aiUsageToday: 0, lastResetDate: today });
      return { allowed: true, reason: 'ok' };
    }

    // Under the free daily quota → allowed directly.
    if (state.aiUsageToday < FREE_AI_DAILY_LIMIT) {
      return { allowed: true, reason: 'ok' };
    }

    // Quota exhausted — can we fall back to ad credits?
    if (state.adCredits > 0) {
      return { allowed: true, reason: 'quota' };
    }

    // No quota and no credits → must upgrade or watch an ad to earn credits.
    return { allowed: false, reason: 'no-credit' };
  },

  consumeAI: async () => {
    const state = get();
    const today = todayString();

    // Also handle midnight rollover here in case canUseAI wasn't called first
    const currentUsage = state.lastResetDate === today ? state.aiUsageToday : 0;

    // Pro or within free quota: bump the daily counter.
    if (state.plan === 'pro' || currentUsage < FREE_AI_DAILY_LIMIT) {
      const next = { aiUsageToday: currentUsage + 1, lastResetDate: today };
      set(next);
      persist({ ...state, ...next });
      return;
    }

    // Free user past quota → attempt to consume an ad credit.
    if (state.adCredits > 0) {
      await get().consumeAdCredit();
    }
    // If neither branch fired, the UI should have already blocked the call
    // via canUseAI() — we silently no-op to avoid corrupting any counters.
  },

  refreshCredits: async () => {
    try {
      const balance = await fetchAdCreditBalance();
      set({ adCredits: balance });
    } catch {
      // Non-fatal — keep existing (possibly stale) balance.
    }
  },

  consumeAdCredit: async () => {
    const state = get();
    if (state.adCredits <= 0) return false;

    // Optimistic local decrement — revert on server failure.
    set({ adCredits: state.adCredits - 1 });
    const newRemote = await consumeAdCreditRemote();
    if (newRemote === null) {
      // Rollback on error so we don't lose a credit.
      set({ adCredits: state.adCredits });
      return false;
    }
    // Keep server value authoritative in case of drift.
    set({ adCredits: newRemote });
    return true;
  },

  canUseWeeklyReview: () => {
    const state = get();

    // Pro plan: unlimited
    if (state.plan === 'pro') return true;

    // Check for month rollover
    const month = currentMonthString();
    if (state.lastReviewResetMonth !== month) {
      set({ weeklyReviewUsedThisMonth: 0, lastReviewResetMonth: month });
      persist({ ...get(), weeklyReviewUsedThisMonth: 0, lastReviewResetMonth: month });
      return true;
    }

    return state.weeklyReviewUsedThisMonth < FREE_WEEKLY_REVIEW_MONTHLY_LIMIT;
  },

  consumeWeeklyReview: () => {
    const state = get();
    const month = currentMonthString();

    const currentUsage = state.lastReviewResetMonth === month
      ? state.weeklyReviewUsedThisMonth
      : 0;
    const next = { weeklyReviewUsedThisMonth: currentUsage + 1, lastReviewResetMonth: month };

    set(next);
    persist({ ...state, ...next });
  },

  setPlan: (plan: SubscriptionPlan) => {
    set({ plan });
    persist({ ...get(), plan });
    // NOTE: we used to mirror this into users.subscription_plan from the
    // client. That path is now blocked by the
    // protect_user_privileged_columns trigger (migration 016) — the
    // server-authoritative source is the RevenueCat → Supabase webhook
    // (Sprint 18) and the LEAD's manual SQL update via Supabase Studio.
    // The local plan flag is still useful for instant UX after a
    // RevenueCat purchase; the next session refresh from the server
    // reconciles authoritative state.
  },

  // ── Free Time Recommendation 쿼터 구현 (PRD 4.2 Tier 3) ─────────────────

  canUseFreeTimeRec: (): boolean => {
    const state = get();

    if (state.plan === 'pro') {
      // Pro 플랜: 주간 한도 확인 + 자동 리셋
      const currentWeek = currentISOWeekString();
      if (state.lastRecResetWeek !== currentWeek) {
        // 주가 바뀌었으면 카운터 리셋
        set({ recUsedThisWeek: 0, lastRecResetWeek: currentWeek });
        persistRecQuota(state.recUsedThisMonth, state.lastRecResetMonth, 0, currentWeek);
        return true;
      }
      return state.recUsedThisWeek < PRO_REC_WEEKLY_LIMIT;
    }

    // Free 플랜: 월간 한도 확인 + 자동 리셋
    const month = currentMonthString();
    if (state.lastRecResetMonth !== month) {
      set({ recUsedThisMonth: 0, lastRecResetMonth: month });
      persistRecQuota(0, month, state.recUsedThisWeek, state.lastRecResetWeek);
      return true;
    }
    return state.recUsedThisMonth < FREE_REC_MONTHLY_LIMIT;
  },

  consumeFreeTimeRec: (): void => {
    const state = get();
    const month = currentMonthString();
    const week  = currentISOWeekString();

    if (state.plan === 'pro') {
      // Pro: 주간 카운터 증가 (한도 초과 시 no-op)
      const currentWeek = state.lastRecResetWeek === week ? state.recUsedThisWeek : 0;
      if (currentWeek >= PRO_REC_WEEKLY_LIMIT) return;
      const next = { recUsedThisWeek: currentWeek + 1, lastRecResetWeek: week };
      set(next);
      persistRecQuota(state.recUsedThisMonth, state.lastRecResetMonth, next.recUsedThisWeek, week);
      return;
    }

    // Free: 월간 카운터 증가 (한도 초과 시 no-op)
    const currentMonth = state.lastRecResetMonth === month ? state.recUsedThisMonth : 0;
    if (currentMonth >= FREE_REC_MONTHLY_LIMIT) return;
    const next = { recUsedThisMonth: currentMonth + 1, lastRecResetMonth: month };
    set(next);
    persistRecQuota(next.recUsedThisMonth, month, state.recUsedThisWeek, state.lastRecResetWeek);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
      if (!raw) return;

      const saved: Partial<SubscriptionState> = JSON.parse(raw);
      const today = todayString();
      const month = currentMonthString();

      // Apply midnight reset if needed
      const aiUsageToday = saved.lastResetDate === today
        ? (saved.aiUsageToday ?? 0)
        : 0;
      const lastResetDate = today;

      // Apply month reset if needed
      const weeklyReviewUsedThisMonth = saved.lastReviewResetMonth === month
        ? (saved.weeklyReviewUsedThisMonth ?? 0)
        : 0;
      const lastReviewResetMonth = month;

      set({
        plan: saved.plan ?? 'free',
        aiUsageToday,
        lastResetDate,
        weeklyReviewUsedThisMonth,
        lastReviewResetMonth,
      });
    } catch {
      // Corrupted storage — use defaults (already set at store creation)
    }

    // 추천 쿼터 별도 복원 (REC_QUOTA_STORAGE_KEY)
    try {
      const recRaw = await AsyncStorage.getItem(REC_QUOTA_STORAGE_KEY);
      if (!recRaw) return;

      const recSaved: {
        recUsedThisMonth:  number;
        lastRecResetMonth: string;
        recUsedThisWeek:   number;
        lastRecResetWeek:  string;
      } = JSON.parse(recRaw);

      const month = currentMonthString();
      const week  = currentISOWeekString();

      // 월 리셋
      const recUsedThisMonth  = recSaved.lastRecResetMonth === month
        ? (recSaved.recUsedThisMonth ?? 0) : 0;
      // 주 리셋
      const recUsedThisWeek   = recSaved.lastRecResetWeek === week
        ? (recSaved.recUsedThisWeek ?? 0) : 0;

      set({
        recUsedThisMonth,
        lastRecResetMonth: month,
        recUsedThisWeek,
        lastRecResetWeek:  week,
      });
    } catch {
      // 쿼터 복원 실패 시 초기값 유지 (0회 = 사용 가능 상태로 시작, 안전 방향)
    }
  },
}));
