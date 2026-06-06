/**
 * onboardingStore — single source of truth for the "onboarding completed" flag.
 *
 * Why a store instead of _layout useState + AsyncStorage re-reads:
 * The onboarding screen lives in a different component tree than the auth
 * guard (_layout). When onboarding finished, it wrote AsyncStorage and
 * navigated, but the guard's in-memory flag was still stale (false), so the
 * guard bounced the user *back* to /onboarding before an async re-read landed
 * — onboarding appeared twice + a login-screen flash (2026-06-06 실측 버그).
 *
 * With a shared store, `complete()` updates `done` **synchronously** before the
 * navigation, so by the next render the guard already sees done=true and routes
 * straight to /(tabs) with no bounce.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key — persisted across launches. */
export const ONBOARDING_STORAGE_KEY = '@synclink/onboarding_done';

interface OnboardingState {
  /** true = completed, false = not yet, null = not hydrated from storage yet. */
  done: boolean | null;
  /** Read the persisted flag into memory (call once at app launch). */
  hydrate: () => Promise<void>;
  /** Mark onboarding complete: sets `done` synchronously, then persists. */
  complete: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  done: null,
  hydrate: async () => {
    try {
      const value = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
      set({ done: value !== null });
    } catch {
      // Storage read failure — assume done so we don't trap the user in onboarding.
      set({ done: true });
    }
  },
  complete: async () => {
    // Synchronous in-memory update FIRST so the auth guard sees it before the
    // post-onboarding navigation runs (prevents the stale-flag bounce).
    set({ done: true });
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    } catch {
      // Persisting failed — non-critical; the in-memory flag still unblocks routing.
    }
  },
}));
