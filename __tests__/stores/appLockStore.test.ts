/**
 * @task TASK-900 (Sprint 9) — App Lock Store tests
 *
 * Tests for appLockStore — Zustand store that persists biometric lock state.
 * AsyncStorage is already mocked in jest.setup.js (async-storage-mock).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppLockStore } from '@/stores/appLockStore';

/** AsyncStorage key used by appLockStore (must match implementation). */
const APP_LOCK_KEY = 'synclink:app_lock_enabled';

describe('appLockStore', () => {
  beforeEach(() => {
    // Reset Zustand store to initial state (singleton survives across tests)
    useAppLockStore.setState({ isLocked: false, isEnabled: false, isHydrated: false });
    jest.clearAllMocks();
  });

  // ── initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with isLocked=false, isEnabled=false, isHydrated=false', () => {
      const { isLocked, isEnabled, isHydrated } = useAppLockStore.getState();
      expect(isLocked).toBe(false);
      expect(isEnabled).toBe(false);
      expect(isHydrated).toBe(false);
    });
  });

  // ── lock ───────────────────────────────────────────────────────────────────

  describe('lock', () => {
    it('sets isLocked to true', () => {
      useAppLockStore.getState().lock();
      expect(useAppLockStore.getState().isLocked).toBe(true);
    });

    it('does not change isEnabled or isHydrated', () => {
      useAppLockStore.setState({ isEnabled: false, isHydrated: true });
      useAppLockStore.getState().lock();

      const { isEnabled, isHydrated } = useAppLockStore.getState();
      expect(isEnabled).toBe(false);
      expect(isHydrated).toBe(true);
    });
  });

  // ── unlock ─────────────────────────────────────────────────────────────────

  describe('unlock', () => {
    it('sets isLocked to false', () => {
      useAppLockStore.setState({ isLocked: true });
      useAppLockStore.getState().unlock();
      expect(useAppLockStore.getState().isLocked).toBe(false);
    });
  });

  // ── setEnabled ─────────────────────────────────────────────────────────────

  describe('setEnabled', () => {
    it('sets isEnabled to true and persists to AsyncStorage', async () => {
      await useAppLockStore.getState().setEnabled(true);

      expect(useAppLockStore.getState().isEnabled).toBe(true);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(APP_LOCK_KEY, 'true');
    });

    it('sets isEnabled to false and persists to AsyncStorage', async () => {
      useAppLockStore.setState({ isEnabled: true });

      await useAppLockStore.getState().setEnabled(false);

      expect(useAppLockStore.getState().isEnabled).toBe(false);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(APP_LOCK_KEY, 'false');
    });

    it('does not throw when AsyncStorage.setItem fails (non-fatal)', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage full'));

      await expect(useAppLockStore.getState().setEnabled(true)).resolves.toBeUndefined();
    });
  });

  // ── hydrate ────────────────────────────────────────────────────────────────

  describe('hydrate', () => {
    it('reads from the correct AsyncStorage key', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

      await useAppLockStore.getState().hydrate();

      expect(AsyncStorage.getItem).toHaveBeenCalledWith(APP_LOCK_KEY);
    });

    it('sets isEnabled=true and isLocked=true when stored value is true', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('true');

      await useAppLockStore.getState().hydrate();

      const { isEnabled, isLocked, isHydrated } = useAppLockStore.getState();
      expect(isEnabled).toBe(true);
      expect(isLocked).toBe(true);
      expect(isHydrated).toBe(true);
    });

    it('sets isEnabled=false and isLocked=false when stored value is false', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('false');

      await useAppLockStore.getState().hydrate();

      const { isEnabled, isLocked, isHydrated } = useAppLockStore.getState();
      expect(isEnabled).toBe(false);
      expect(isLocked).toBe(false);
      expect(isHydrated).toBe(true);
    });

    it('defaults to isEnabled=false when AsyncStorage has no stored value', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

      await useAppLockStore.getState().hydrate();

      expect(useAppLockStore.getState().isEnabled).toBe(false);
      expect(useAppLockStore.getState().isHydrated).toBe(true);
    });

    it('sets isHydrated=true even when AsyncStorage.getItem throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Read error'));

      await useAppLockStore.getState().hydrate();

      expect(useAppLockStore.getState().isHydrated).toBe(true);
    });
  });
});
