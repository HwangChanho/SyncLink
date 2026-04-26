/**
 * Sprint 15 TASK-1510 — pinLockService tests.
 *
 * Verifies the PIN lifecycle (set, verify, clear, hasPin).
 * Uses the in-memory expo-secure-store mock from jest.setup.js.
 */

import * as SecureStore from 'expo-secure-store';
import {
  setPin,
  verifyPin,
  clearPin,
  hasPin,
} from '@/services/pinLockService';

// jest.setup.js provides the in-memory SecureStore mock with _store exposed.
// Clear it before each test so each test starts with a blank slate.
beforeEach(() => {
  (SecureStore as unknown as { _store: Map<string, string> })._store.clear();
});

describe('pinLockService', () => {
  describe('setPin', () => {
    it('persists the PIN hash and auto-creates a salt on first use', async () => {
      await setPin('1234');

      const store = (SecureStore as unknown as { _store: Map<string, string> })._store;
      const salt = store.get('@synclink/pin_salt');
      const hash = store.get('@synclink/pin_hash');
      expect(salt).toMatch(/^[0-9a-f]+$/);
      expect(hash).toMatch(/^[0-9a-f]+$/);
      // The hash must not equal the PIN — we are storing a digest.
      expect(hash).not.toBe('1234');
    });

    it('rejects non-4-digit input', async () => {
      await expect(setPin('12'  )).rejects.toThrow();
      await expect(setPin('abcd')).rejects.toThrow();
      await expect(setPin('1234a')).rejects.toThrow();
    });

    it('reuses an existing salt when rotating the PIN', async () => {
      await setPin('1234');
      const store = (SecureStore as unknown as { _store: Map<string, string> })._store;
      const salt1 = store.get('@synclink/pin_salt');

      await setPin('9999');
      const salt2 = store.get('@synclink/pin_salt');

      expect(salt2).toBe(salt1);
      // But the hash should have rotated.
      const hash2 = store.get('@synclink/pin_hash');
      expect(hash2).toBeDefined();
    });
  });

  describe('verifyPin', () => {
    it('returns true for the matching PIN', async () => {
      await setPin('1234');
      await expect(verifyPin('1234')).resolves.toBe(true);
    });

    it('returns false for a non-matching PIN', async () => {
      await setPin('1234');
      await expect(verifyPin('0000')).resolves.toBe(false);
    });

    it('returns false when no PIN has been set', async () => {
      await expect(verifyPin('1234')).resolves.toBe(false);
    });

    it('returns false for malformed input', async () => {
      await setPin('1234');
      await expect(verifyPin('12')  ).resolves.toBe(false);
      await expect(verifyPin('abcd')).resolves.toBe(false);
    });
  });

  describe('clearPin / hasPin', () => {
    it('hasPin reports whether a PIN is stored', async () => {
      await expect(hasPin()).resolves.toBe(false);
      await setPin('1234');
      await expect(hasPin()).resolves.toBe(true);
    });

    it('clearPin removes the hash but keeps the salt for consistency', async () => {
      await setPin('1234');
      const store = (SecureStore as unknown as { _store: Map<string, string> })._store;
      const saltBefore = store.get('@synclink/pin_salt');

      await clearPin();

      await expect(hasPin()).resolves.toBe(false);
      const saltAfter = store.get('@synclink/pin_salt');
      expect(saltAfter).toBe(saltBefore);
    });

    it('after clearPin verifyPin always returns false', async () => {
      await setPin('1234');
      await clearPin();
      await expect(verifyPin('1234')).resolves.toBe(false);
    });
  });
});
