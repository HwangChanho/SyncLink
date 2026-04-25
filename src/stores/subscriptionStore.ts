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

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for persisting subscription state. */
const SUBSCRIPTION_STORAGE_KEY = 'synclink:subscription';

/** Free plan: max AI fallback calls per day. */
export const FREE_AI_DAILY_LIMIT = 5;

/** Free plan: max weekly review generations per month. */
export const FREE_WEEKLY_REVIEW_MONTHLY_LIMIT = 1;

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
 * Push the latest plan value into users.subscription_plan so server-side
 * gating (translate-event Edge Function, future moderation tools) sees
 * the same source of truth as the client. Best-effort — never throws.
 */
async function mirrorPlanToServer(plan: SubscriptionPlan): Promise<void> {
  try {
    // Late require avoids a circular import between subscriptionStore and
    // anything that pulls in supabase (which itself can pull this file).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await (supabase.from('users') as any)
      .update({ subscription_plan: plan })
      .eq('id', user.id);
  } catch {
    // Network or auth not ready — local state is still correct.
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  plan: 'free',
  aiUsageToday: 0,
  lastResetDate: todayString(),
  weeklyReviewUsedThisMonth: 0,
  lastReviewResetMonth: currentMonthString(),
  adCredits: 0,

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
    // Mirror the client-side plan into the users table so server-side
    // gating (e.g. translate-event Edge Function checks
    // users.subscription_plan === 'pro') works without an extra round
    // trip. Fire-and-forget — the local state is already updated.
    void mirrorPlanToServer(plan);
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
  },
}));
