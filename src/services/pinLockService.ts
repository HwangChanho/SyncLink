/**
 * PIN Lock service — stores and verifies a 4-digit numeric passcode used to
 * unlock the app as a fallback when biometric authentication is unavailable
 * or has failed.
 *
 * Storage layout:
 *   - `@synclink/pin_salt` — 32-byte hex salt kept in `expo-secure-store`
 *     (iOS Keychain / Android Keystore). Survives app reinstall on iOS.
 *   - `@synclink/pin_hash` — SHA-256 hex digest of (pin || salt), stored in
 *     `expo-secure-store` alongside the salt. Both values are required to
 *     verify; missing either means no PIN has been set yet.
 *
 * Hash: SHA-256 via `expo-crypto`. 4-digit PIN space is only 10 000 values
 * so any hash is brute-forceable if the digest leaks, but pairing it with
 * a hardware-backed salt makes the common case (stolen phone) much harder.
 *
 * All public APIs are async.
 *
 * Sprint 15 TASK-1510.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const PIN_SALT_KEY = 'synclink_pin_salt';
const PIN_HASH_KEY = 'synclink_pin_hash';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a 32-byte hex salt backed by a CSPRNG. */
async function generateSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 hex digest of (pin || salt). */
async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${pin}${salt}`,
  );
}

/** Read the stored salt, creating and persisting a new one on first use. */
async function readOrInitSalt(): Promise<string> {
  const existing = await SecureStore.getItemAsync(PIN_SALT_KEY);
  if (existing) return existing;
  const fresh = await generateSalt();
  await SecureStore.setItemAsync(PIN_SALT_KEY, fresh);
  return fresh;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a new 4-digit PIN. Any existing PIN is overwritten.
 * @throws if pin is not a 4-digit string of 0-9
 */
export async function setPin(pin: string): Promise<void> {
  if (!/^[0-9]{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  const salt = await readOrInitSalt();
  const hash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
}

/**
 * Verify that the given 4-digit input matches the stored PIN.
 * Returns false when no PIN has been set.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  if (!/^[0-9]{4}$/.test(pin)) return false;
  const [salt, stored] = await Promise.all([
    SecureStore.getItemAsync(PIN_SALT_KEY),
    SecureStore.getItemAsync(PIN_HASH_KEY),
  ]);
  if (!salt || !stored) return false;
  const candidate = await hashPin(pin, salt);
  return candidate === stored;
}

/** Remove the stored PIN hash. Salt is retained. */
export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_HASH_KEY);
}

/** Quick check for whether the user has set up a PIN. */
export async function hasPin(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
  return stored !== null;
}
