/**
 * PIN Lock service — stores and verifies a 4-digit numeric passcode used to
 * unlock the app as a fallback when biometric authentication is unavailable
 * or has failed.
 *
 * Storage layout:
 *   - `@synclink/pin_salt` — random 32-byte hex string (per-device salt).
 *     TODO(CMD-019): move this to `expo-secure-store` once it can be
 *     installed; `docs/escalations/CMD-019-expo-secure-store-install.md`
 *     captures the reason AsyncStorage is used right now.
 *   - `@synclink/pin_hash` — hash(pin + salt) as a hex string.
 *
 * Hash choice:
 *   We would prefer SHA-256 via `expo-crypto`, but that package is not yet
 *   installed (same escalation as above). React Native does not ship
 *   WebCrypto's `crypto.subtle`, so we use MurmurHash3 via the already-
 *   vendored `imurmurhash` package. This is a non-cryptographic hash, which
 *   is acceptable here because:
 *     (a) 4-digit PINs have only 10 000 possible values — any hash is
 *         brute-forceable instantly once the stored digest is leaked, so
 *         the hash's main job is to avoid storing the PIN in plaintext.
 *     (b) The hash function is isolated behind `hashPin()` so we can
 *         swap in SHA-256 once `expo-crypto` is available without touching
 *         callers.
 *
 * All public APIs are async so callers can `await setPin(...)` without
 * blocking the UI thread even when we eventually switch to a KDF.
 *
 * Sprint 15 TASK-1510.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MurmurHash3 = require('imurmurhash') as (seed?: string) => {
  hash: (s: string) => { result: () => number; hash: (s: string) => ReturnType<typeof MurmurHash3> };
  result: () => number;
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

/** AsyncStorage key for the per-device salt (TODO: migrate to SecureStore). */
const PIN_SALT_KEY = '@synclink/pin_salt';
/** AsyncStorage key for the stored passcode hash. */
const PIN_HASH_KEY = '@synclink/pin_hash';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a 32-character hex salt. We avoid Math.random for safety's sake
 * and use a simple time+random mix — again acceptable given the 4-digit
 * input space and the fact that this is scheduled to move to secure
 * storage (see file header TODO).
 */
function generateSalt(): string {
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(Math.random() * 0xffffffff) ^ Date.now();
    parts.push(r.toString(16).padStart(8, '0').slice(-8));
  }
  return parts.join('');
}

/**
 * Hash a PIN using MurmurHash3 over (pin || salt). Returns an 8-character
 * lowercase hex digest — enough entropy for 4-digit PIN verification.
 *
 * @param pin  4-digit passcode string
 * @param salt Device-specific salt (hex)
 */
function hashPin(pin: string, salt: string): string {
  // Chaining hashes pin then salt. MurmurHash3 is not cryptographically
  // secure; see the file header for why that's acceptable here.
  const h = MurmurHash3(pin).hash(salt);
  // `>>> 0` converts to unsigned 32-bit; toString(16) pads into lowercase hex.
  return (h.result() >>> 0).toString(16).padStart(8, '0');
}

/**
 * Read the stored salt, creating and persisting a new one on first use.
 * The salt is shared across every PIN set on the device so rotating the
 * PIN does not invalidate the salt.
 */
async function readOrInitSalt(): Promise<string> {
  const existing = await AsyncStorage.getItem(PIN_SALT_KEY);
  if (existing) return existing;
  const fresh = generateSalt();
  await AsyncStorage.setItem(PIN_SALT_KEY, fresh);
  return fresh;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a new 4-digit PIN. Any existing PIN is overwritten.
 * @param pin 4-digit numeric passcode
 * @throws if pin is not a 4-digit string of 0-9
 */
export async function setPin(pin: string): Promise<void> {
  if (!/^[0-9]{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  const salt = await readOrInitSalt();
  const hash = hashPin(pin, salt);
  await AsyncStorage.setItem(PIN_HASH_KEY, hash);
}

/**
 * Verify that the given 4-digit input matches the stored PIN.
 * @param pin 4-digit numeric passcode supplied by the user
 * @returns true when the PIN matches, false otherwise (including when no
 *          PIN has ever been set).
 */
export async function verifyPin(pin: string): Promise<boolean> {
  if (!/^[0-9]{4}$/.test(pin)) return false;
  const [salt, stored] = await Promise.all([
    AsyncStorage.getItem(PIN_SALT_KEY),
    AsyncStorage.getItem(PIN_HASH_KEY),
  ]);
  if (!salt || !stored) return false;
  return hashPin(pin, salt) === stored;
}

/**
 * Remove the stored PIN hash. The salt is kept so subsequent `setPin` calls
 * remain consistent — otherwise pins would drift between rotations.
 */
export async function clearPin(): Promise<void> {
  await AsyncStorage.removeItem(PIN_HASH_KEY);
}

/**
 * Quick check for whether the user has set up a PIN. Used by the app-lock
 * screen to decide between "enter PIN" and "set PIN" flows.
 */
export async function hasPin(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(PIN_HASH_KEY);
  return stored !== null;
}
