/**
 * App Lock store — manages biometric lock state.
 *
 * Persists `isEnabled` to AsyncStorage so the setting survives app restarts.
 * `isLocked` is ephemeral (session-only): the app starts locked whenever
 * `isEnabled` is true, and unlocks after a successful biometric authentication.
 *
 * TASK-900 (Sprint 9)
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key for the app-lock enabled flag. */
const APP_LOCK_STORAGE_KEY = 'synclink:app_lock_enabled';

interface AppLockState {
  /** True while the lock screen overlay should be shown. */
  isLocked: boolean;
  /**
   * True when the user has enabled app lock in Settings.
   * Persisted to AsyncStorage.
   */
  isEnabled: boolean;
  /** True during initial AsyncStorage hydration. */
  isHydrated: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Show the lock screen overlay.
   * Called when the app returns from background.
   */
  lock: () => void;

  /**
   * Dismiss the lock screen overlay after successful biometric auth.
   */
  unlock: () => void;

  /**
   * Enable or disable app lock.
   * Persists the new value to AsyncStorage.
   *
   * @param enabled - true to enable, false to disable
   */
  setEnabled: (enabled: boolean) => Promise<void>;

  /**
   * Read the persisted `isEnabled` flag from AsyncStorage.
   * Called once on app startup (in _layout.tsx).
   */
  hydrate: () => Promise<void>;
}

export const useAppLockStore = create<AppLockState>((set) => ({
  isLocked: false,
  isEnabled: false,
  isHydrated: false,

  lock: () => set({ isLocked: true }),

  unlock: () => set({ isLocked: false }),

  setEnabled: async (enabled: boolean) => {
    set({ isEnabled: enabled });
    try {
      await AsyncStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Non-fatal: setting will revert on next launch
    }
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(APP_LOCK_STORAGE_KEY);
      const enabled = raw !== null ? (JSON.parse(raw) as boolean) : false;
      // If app lock is enabled, start the session in the locked state
      set({ isEnabled: enabled, isLocked: enabled, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },
}));
