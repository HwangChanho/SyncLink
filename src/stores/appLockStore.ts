/**
 * App Lock store — manages both biometric and 4-digit-PIN lock state.
 *
 * Persists `isEnabled` (biometrics) and `pinEnabled` to AsyncStorage so the
 * settings survive app restarts. `isLocked` is ephemeral (session-only):
 * the app starts locked whenever either lock method is enabled, and
 * unlocks after a successful authentication.
 *
 * The two lock methods are independent flags — a user can enable PIN only,
 * biometrics only, both, or neither. When both are enabled, the lock
 * overlay shows biometrics first and falls back to PIN entry on demand.
 *
 * TASK-900 (Sprint 9), extended by TASK-1510 (Sprint 15) to add PIN.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key for the biometric-lock enabled flag. */
const APP_LOCK_STORAGE_KEY = 'synclink:app_lock_enabled';
/** AsyncStorage key for the PIN-lock enabled flag (TASK-1510). */
const PIN_LOCK_STORAGE_KEY = 'synclink:pin_lock_enabled';

interface AppLockState {
  /** True while the lock screen overlay should be shown. */
  isLocked: boolean;
  /**
   * True when the user has enabled biometric app lock in Settings.
   * Persisted to AsyncStorage.
   */
  isEnabled: boolean;
  /**
   * True when the user has enabled 4-digit PIN lock in Settings.
   * Independent of `isEnabled` — either, both, or neither may be on.
   * Persisted to AsyncStorage. Sprint 15 TASK-1510.
   */
  pinEnabled: boolean;
  /** True during initial AsyncStorage hydration. */
  isHydrated: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Show the lock screen overlay.
   * Called when the app returns from background.
   */
  lock: () => void;

  /**
   * Dismiss the lock screen overlay after successful auth.
   */
  unlock: () => void;

  /**
   * Enable or disable biometric app lock.
   * Persists the new value to AsyncStorage.
   *
   * @param enabled - true to enable, false to disable
   */
  setEnabled: (enabled: boolean) => Promise<void>;

  /**
   * Enable or disable PIN-based app lock.
   * Callers are expected to have already persisted / cleared the PIN hash
   * via `pinLockService` before flipping this flag.
   * Sprint 15 TASK-1510.
   *
   * @param enabled - true to enable, false to disable
   */
  setPinEnabled: (enabled: boolean) => Promise<void>;

  /**
   * Read the persisted flags from AsyncStorage.
   * Called once on app startup (in _layout.tsx).
   */
  hydrate: () => Promise<void>;
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  isLocked:   false,
  isEnabled:  false,
  pinEnabled: false,
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

  setPinEnabled: async (enabled: boolean) => {
    set({ pinEnabled: enabled });
    try {
      await AsyncStorage.setItem(PIN_LOCK_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Non-fatal — the flag reverts on next hydrate()
    }
  },

  hydrate: async () => {
    try {
      const [rawBio, rawPin] = await Promise.all([
        AsyncStorage.getItem(APP_LOCK_STORAGE_KEY),
        AsyncStorage.getItem(PIN_LOCK_STORAGE_KEY),
      ]);
      const isEnabled  = rawBio !== null ? (JSON.parse(rawBio)  as boolean) : false;
      const pinEnabled = rawPin !== null ? (JSON.parse(rawPin) as boolean) : false;
      // The session starts locked if either lock method is enabled so the
      // user can never bypass one by only satisfying the other.
      set({
        isEnabled,
        pinEnabled,
        isLocked:   isEnabled || pinEnabled,
        isHydrated: true,
      });
    } catch {
      set({ isHydrated: true });
    }
    // Keep `get` available for future migrations (noop today).
    void get;
  },
}));
