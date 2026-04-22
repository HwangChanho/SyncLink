/**
 * @task TASK-900 (Sprint 9) — App Lock Service tests
 *
 * Tests for appLockService — wraps expo-local-authentication.
 * All native biometric APIs are mocked.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { isBiometricAvailable, authenticate } from '@/services/appLockService';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync:   jest.fn(),
  isEnrolledAsync:    jest.fn(),
  authenticateAsync:  jest.fn(),
}));

describe('appLockService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── isBiometricAvailable ───────────────────────────────────────────────────

  describe('isBiometricAvailable', () => {
    it('returns true when hardware is present and biometrics enrolled', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync  as jest.Mock).mockResolvedValue(true);

      expect(await isBiometricAvailable()).toBe(true);
    });

    it('returns false when hardware is absent', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
      (LocalAuthentication.isEnrolledAsync  as jest.Mock).mockResolvedValue(true);

      expect(await isBiometricAvailable()).toBe(false);
    });

    it('returns false when biometrics are not enrolled', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync  as jest.Mock).mockResolvedValue(false);

      expect(await isBiometricAvailable()).toBe(false);
    });

    it('returns false when both hardware absent and biometrics not enrolled', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
      (LocalAuthentication.isEnrolledAsync  as jest.Mock).mockResolvedValue(false);

      expect(await isBiometricAvailable()).toBe(false);
    });
  });

  // ── authenticate ───────────────────────────────────────────────────────────

  describe('authenticate', () => {
    it('returns success:true and calls authenticateAsync with correct options', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });

      const result = await authenticate('Unlock SyncDay');

      expect(result).toEqual({ success: true });
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
        promptMessage:         'Unlock SyncDay',
        disableDeviceFallback: false,
        cancelLabel:           'Cancel',
      });
    });

    it('maps UserCancel error code to human-readable message', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: false,
        error:   'UserCancel',
      });

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication was cancelled.');
    });

    it('maps BiometryLockout error code', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: false,
        error:   'BiometryLockout',
      });

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Too many failed attempts. Use your passcode.');
    });

    it('maps PasscodeNotSet error code', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: false,
        error:   'PasscodeNotSet',
      });

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No passcode is set on this device.');
    });

    it('uses fallback message for unknown error codes', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: false,
        error:   'UnknownCode',
      });

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed: UnknownCode');
    });

    it('returns generic failure when no error field is present', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: false });

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed.');
    });

    it('catches thrown Error and returns its message', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValue(
        new Error('Native module crashed'),
      );

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Native module crashed');
    });

    it('catches non-Error thrown values and returns generic message', async () => {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValue('string error');

      const result = await authenticate('Unlock SyncDay');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed.');
    });
  });
});
