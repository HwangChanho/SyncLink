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

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for persisting subscription state. */
const SUBSCRIPTION_STORAGE_KEY = 'synclink:subscription';

/** Free plan: max AI fallback calls per day. */
export const FREE_AI_DAILY_LIMIT = 5;

/** Free plan: max weekly review generations per month. */
export const FREE_WEEKLY_REVIEW_MONTHLY_LIMIT = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionPlan = 'free' | 'pro';

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

  // ── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Check if the user can make an AI fallback call right now.
   * Pro users have unlimited calls. Free users are limited to FREE_AI_DAILY_LIMIT/day.
   * Also triggers midnight reset if the date has changed since last check.
   *
   * @returns true if an AI call is allowed
   */
  canUseAI: () => boolean;

  /**
   * Record one AI fallback call, incrementing aiUsageToday.
   * Should be called immediately before each AI service call.
   * Also persists updated state to AsyncStorage.
   */
  consumeAI: () => void;

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

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  plan: 'free',
  aiUsageToday: 0,
  lastResetDate: todayString(),
  weeklyReviewUsedThisMonth: 0,
  lastReviewResetMonth: currentMonthString(),

  canUseAI: () => {
    const state = get();

    // Pro plan: unlimited
    if (state.plan === 'pro') return true;

    // Auto-reset at midnight: if lastResetDate is not today, reset counter
    const today = todayString();
    if (state.lastResetDate !== today) {
      // Reset the counter for the new day
      set({ aiUsageToday: 0, lastResetDate: today });
      persist({ ...get(), aiUsageToday: 0, lastResetDate: today });
      return true; // freshly reset, so usage is 0 < limit
    }

    return state.aiUsageToday < FREE_AI_DAILY_LIMIT;
  },

  consumeAI: () => {
    const state = get();
    const today = todayString();

    // Also handle midnight rollover here in case canUseAI wasn't called first
    const currentUsage = state.lastResetDate === today ? state.aiUsageToday : 0;
    const next = { aiUsageToday: currentUsage + 1, lastResetDate: today };

    set(next);
    persist({ ...state, ...next });
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
