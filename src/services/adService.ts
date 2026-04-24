/**
 * adService — AdMob rewarded-ad integration wrapper.
 *
 * This module isolates all direct interaction with
 * `react-native-google-mobile-ads`. Components / hooks should consume the
 * exported helpers (and the `useRewardedAd` hook) rather than importing the
 * SDK directly — that way the rest of the app remains testable with Jest's
 * default JSDOM environment where native modules are stubbed.
 *
 * Behavior summary:
 *  - Web and platforms without a configured AdMob App ID are no-ops. The
 *    helpers return safe defaults so callers don't have to guard every call.
 *  - In DEV builds (__DEV__ === true) the SDK's built-in `TestIds` constants
 *    are used so we never accidentally accrue real impressions while working
 *    locally.
 *  - Initialization is idempotent; subsequent calls resolve immediately.
 *
 * Sprint 14 TASK-1402
 */

import { Platform } from 'react-native';

// ─── Environment ─────────────────────────────────────────────────────────────

/**
 * Resolve the AdMob App ID for the current platform.
 * Returns undefined when no ID is configured (e.g. Android during the iOS
 * soft-launch) so we can cleanly skip SDK initialization.
 */
function resolveAppId(): string | undefined {
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_ADMOB_APP_ID_IOS;
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_ADMOB_APP_ID_ANDROID;
  return undefined;
}

/**
 * Resolve the rewarded-ad unit ID for the current platform.
 * In DEV builds we always return the SDK's TestIds constant to avoid
 * accidentally billing against our real ad unit.
 */
function resolveRewardedUnitId(testIds?: { REWARDED?: string }): string | undefined {
  if (__DEV__ && testIds?.REWARDED) return testIds.REWARDED;
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID_IOS;
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID_ANDROID;
  return undefined;
}

// ─── SDK loader ──────────────────────────────────────────────────────────────

/**
 * Dynamically import the native SDK. We use require() (not import) so Jest
 * can moduleNameMapper-stub this file out without breaking bundler tree-shake
 * expectations. Returns null on web/other platforms where the SDK is absent.
 */
type MobileAdsSdk = {
  default: () => { initialize(): Promise<unknown> };
  TestIds: { REWARDED: string };
  RewardedAd: {
    createForAdRequest(unitId: string, options?: unknown): RewardedAdInstance;
  };
  RewardedAdEventType: Record<string, string>;
  AdEventType: Record<string, string>;
};

type RewardedAdInstance = {
  load(): void;
  show(): Promise<void>;
  addAdEventListener(type: string, listener: (reward?: unknown) => void): () => void;
  /**
   * Attach AdMob server-side verification (SSV) parameters. The `userId` is
   * echoed back to our `reward-credit` Edge Function so the reward can be
   * attributed to the right account — without it the SSV endpoint returns
   * 400 and the user never gets credited.
   */
  setServerSideVerificationOptions?(options: { userId?: string; customData?: string }): void;
};

let cachedSdk: MobileAdsSdk | null | undefined = undefined;

function loadSdk(): MobileAdsSdk | null {
  if (cachedSdk !== undefined) return cachedSdk;
  if (Platform.OS === 'web') {
    cachedSdk = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('react-native-google-mobile-ads') as MobileAdsSdk;
    cachedSdk = mod;
    return mod;
  } catch {
    // Module not linked (unit tests, Expo Go) — degrade to no-op.
    cachedSdk = null;
    return null;
  }
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when the AdMob SDK can be used on this device. Components
 * should call this before showing an "광고 보기" CTA so we hide it cleanly
 * when the SDK is missing (e.g. Android before the key is issued, web, or
 * a bare simulator without Play Services).
 */
export function canShowAds(): boolean {
  if (resolveAppId() === undefined || resolveAppId() === '') return false;
  return loadSdk() !== null;
}

let initPromise: Promise<void> | null = null;

/**
 * Initialize the AdMob SDK. Idempotent — subsequent calls share the same
 * promise. Returns immediately on platforms without a configured app id.
 */
export async function initAdMob(): Promise<void> {
  if (!canShowAds()) return;
  if (initPromise) return initPromise;

  const sdk = loadSdk();
  if (!sdk) return;

  initPromise = sdk.default().initialize().then(() => undefined).catch((err: unknown) => {
    // Reset so callers can retry later; log for triage.
    initPromise = null;
    // eslint-disable-next-line no-console
    console.warn('[adService] initAdMob failed:', err);
  });

  return initPromise;
}

export interface RewardedAdHandle {
  /** Load the ad. Safe to call again after completion to preload the next one. */
  load: () => void;
  /**
   * Show the loaded ad. Resolves to `{ earned: true }` when the user
   * watched it through to the reward callback, otherwise `{ earned: false }`
   * (e.g. user closed early or ad failed).
   */
  show: () => Promise<{ earned: boolean }>;
  /** Detach all listeners — call from an effect cleanup. */
  dispose: () => void;
  /** Whether the ad is currently loaded and ready to show. */
  isLoaded: () => boolean;
}

/**
 * Build a RewardedAdHandle for the current platform. Returns `null` when
 * ads are disabled so callers can conditionally render the ad CTA.
 *
 * The returned handle must be `dispose()`-d when no longer needed — this is
 * typically done inside a React effect's cleanup.
 *
 * @param userId - Current authenticated user's UUID. AdMob SSV will echo this
 *   back as `custom_data` so the `reward-credit` Edge Function can credit the
 *   correct account. Omit only when ads must render without crediting.
 */
export function createRewardedAd(userId?: string): RewardedAdHandle | null {
  const sdk = loadSdk();
  if (!sdk || !canShowAds()) return null;

  const unitId = resolveRewardedUnitId({ REWARDED: sdk.TestIds.REWARDED });
  if (!unitId) return null;

  const rewarded = sdk.RewardedAd.createForAdRequest(unitId, {
    requestNonPersonalizedAdsOnly: false,
  });

  // Attach SSV options so AdMob's callback to `reward-credit` includes the
  // user UUID. Not all SDK versions expose this setter; guard defensively.
  if (userId && typeof rewarded.setServerSideVerificationOptions === 'function') {
    try {
      rewarded.setServerSideVerificationOptions({ userId, customData: userId });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[adService] setServerSideVerificationOptions failed:', err);
    }
  }

  const listeners: Array<() => void> = [];
  let loaded = false;

  // Internal state for the current show() call. Replaced on each show().
  let pendingResolve: ((value: { earned: boolean }) => void) | null = null;

  const wireBaseListeners = () => {
    const loadedEvent = sdk.RewardedAdEventType.LOADED ?? 'loaded';
    const earnedEvent = sdk.RewardedAdEventType.EARNED_REWARD ?? 'earned_reward';
    const closedEvent = sdk.AdEventType.CLOSED ?? 'closed';
    const errorEvent = sdk.AdEventType.ERROR ?? 'error';

    listeners.push(
      rewarded.addAdEventListener(loadedEvent, () => {
        loaded = true;
      }),
    );
    let earnedThisSession = false;
    listeners.push(
      rewarded.addAdEventListener(earnedEvent, () => {
        earnedThisSession = true;
      }),
    );
    listeners.push(
      rewarded.addAdEventListener(closedEvent, () => {
        loaded = false;
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve?.({ earned: earnedThisSession });
        earnedThisSession = false;
        // Auto-reload so the next CTA is snappy.
        try {
          rewarded.load();
        } catch {
          // ignore
        }
      }),
    );
    listeners.push(
      rewarded.addAdEventListener(errorEvent, (err) => {
        loaded = false;
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve?.({ earned: false });
        // eslint-disable-next-line no-console
        console.warn('[adService] rewarded ad error:', err);
      }),
    );
  };

  wireBaseListeners();

  return {
    load: () => {
      if (loaded) return;
      try {
        rewarded.load();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[adService] load failed:', err);
      }
    },
    show: async () => {
      if (!loaded) {
        return { earned: false };
      }
      return new Promise<{ earned: boolean }>((resolve) => {
        pendingResolve = resolve;
        rewarded.show().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[adService] show failed:', err);
          pendingResolve = null;
          resolve({ earned: false });
        });
      });
    },
    dispose: () => {
      listeners.forEach((off) => {
        try {
          off();
        } catch {
          // ignore
        }
      });
      listeners.length = 0;
    },
    isLoaded: () => loaded,
  };
}
