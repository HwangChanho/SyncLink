/**
 * App Lock service — wraps expo-local-authentication.
 *
 * Provides a single `authenticate()` call that uses Face ID / Touch ID
 * (or device passcode as fallback) to unlock the app.
 *
 * Architecture:
 *  - This service is the ONLY file that imports expo-local-authentication.
 *  - Components and stores use this service; they never import the library directly.
 *
 * TASK-900 (Sprint 9)
 */

import * as LocalAuthentication from 'expo-local-authentication';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Result returned by authenticate(). */
export interface AuthResult {
  /** True if the user authenticated successfully. */
  success: boolean;
  /**
   * Human-readable error message when success === false.
   * Undefined on success.
   */
  error?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the current device supports biometric authentication.
 *
 * @returns true if Face ID, Touch ID, or fingerprint is available and enrolled.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

/**
 * Prompt the user with a biometric authentication dialog.
 *
 * Falls back to device passcode if biometrics fail or the user cancels.
 * The `promptMessage` is shown in the system auth dialog on iOS/Android.
 *
 * @param promptMessage - Localized message shown in the auth dialog
 * @returns AuthResult indicating success or failure with an error reason
 */
export async function authenticate(promptMessage: string): Promise<AuthResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      // Allow device passcode as fallback when biometrics fail
      disableDeviceFallback: false,
      // Cancel button label (iOS only; Android shows a system button)
      cancelLabel: 'Cancel',
    });

    if (result.success) {
      return { success: true };
    }

    // Map LocalAuthentication error codes to human-readable messages
    const errorMap: Record<string, string> = {
      UserCancel:       'Authentication was cancelled.',
      UserFallback:     'Please use your device passcode.',
      SystemCancel:     'Authentication was interrupted by the system.',
      PasscodeNotSet:   'No passcode is set on this device.',
      BiometryNotAvailable: 'Biometric authentication is not available.',
      BiometryNotEnrolled: 'No biometrics are enrolled on this device.',
      BiometryLockout:  'Too many failed attempts. Use your passcode.',
    };

    const message = result.error
      ? (errorMap[result.error] ?? `Authentication failed: ${result.error}`)
      : 'Authentication failed.';

    return { success: false, error: message };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed.';
    return { success: false, error: message };
  }
}
