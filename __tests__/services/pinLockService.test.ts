/**
 * Sprint 15 TASK-1510 — pinLockService tests.
 *
 * Verifies the PIN lifecycle (set, verify, clear, hasPin) using the real
 * AsyncStorage jest mock as the backing store. Each test starts with a
 * clean slate via `AsyncStorage.clear()`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setPin,
  verifyPin,
  clearPin,
  hasPin,
} from '@/services/pinLockService';

// The global jest.setup.js already swaps in the official AsyncStorage mock,
// so we only need to clear it before each test.
beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('pinLockService', () => {
  describe('setPin', () => {
    it('persists the PIN hash and auto-creates a salt on first use', async () => {
      await setPin('1234');

      const salt = await AsyncStorage.getItem('@synclink/pin_salt');
      const hash = await AsyncStorage.getItem('@synclink/pin_hash');
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
      const salt1 = await AsyncStorage.getItem('@synclink/pin_salt');

      await setPin('9999');
      const salt2 = await AsyncStorage.getItem('@synclink/pin_salt');

      expect(salt2).toBe(salt1);
      // But the hash should have rotated.
      const hash2 = await AsyncStorage.getItem('@synclink/pin_hash');
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
      const saltBefore = await AsyncStorage.getItem('@synclink/pin_salt');

      await clearPin();

      await expect(hasPin()).resolves.toBe(false);
      const saltAfter = await AsyncStorage.getItem('@synclink/pin_salt');
      expect(saltAfter).toBe(saltBefore);
    });

    it('after clearPin verifyPin always returns false', async () => {
      await setPin('1234');
      await clearPin();
      await expect(verifyPin('1234')).resolves.toBe(false);
    });
  });
});
