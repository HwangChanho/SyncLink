/**
 * useRewardedAd — React hook for showing AdMob rewarded ads.
 *
 * Provides:
 *  - `isAvailable`: whether ads can be shown on this platform at all
 *  - `isLoaded`:    whether an ad is currently preloaded and ready
 *  - `show()`:      displays the ad; resolves to true iff the user earned
 *                   the reward (i.e. watched long enough)
 *
 * Usage:
 * ```ts
 * const { isAvailable, isLoaded, show } = useRewardedAd();
 * const handleWatchAd = async () => {
 *   const earned = await show();
 *   if (earned) await refreshCredits();
 * };
 * ```
 *
 * Sprint 14 TASK-1402
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canShowAds,
  createRewardedAd,
  initAdMob,
  type RewardedAdHandle,
} from '@/services/adService';

export interface UseRewardedAdResult {
  /** Whether this device/platform can show AdMob ads. */
  isAvailable: boolean;
  /** Whether an ad is currently preloaded and immediately showable. */
  isLoaded: boolean;
  /**
   * Show the ad. Resolves to `true` when the user qualified for the reward.
   * Triggers an automatic reload of the next ad on completion.
   */
  show: () => Promise<boolean>;
}

/**
 * React hook wrapping the AdMob rewarded-ad lifecycle. Safe to call on every
 * platform — degrades to a no-op with `isAvailable=false` where ads are not
 * supported (web, Android without a configured key, etc.).
 *
 * @param userId - Current user's UUID. Forwarded to AdMob SSV so the
 *   `reward-credit` Edge Function can credit the right account. Pass `null`
 *   while the auth store is still hydrating; the hook will recreate the
 *   underlying ad instance once the id arrives.
 */
export function useRewardedAd(userId: string | null): UseRewardedAdResult {
  const handleRef = useRef<RewardedAdHandle | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean>(() => canShowAds());

  // Setup on mount (and when userId changes), teardown on unmount.
  // We re-check availability defensively because React may render the
  // component before native modules are linked.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await initAdMob();
      if (cancelled) return;

      const handle = createRewardedAd(userId ?? undefined);
      handleRef.current = handle;
      setIsAvailable(handle !== null);
      if (handle) {
        handle.load();
        // Poll the loaded flag until the ad is ready. The SDK doesn't give us
        // a React-friendly observable so we tick until loaded or unmount.
        const interval = setInterval(() => {
          if (cancelled) return;
          if (handle.isLoaded()) {
            setIsLoaded(true);
            clearInterval(interval);
          }
        }, 250);
        return () => clearInterval(interval);
      }
      return undefined;
    })();

    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [userId]);

  const show = useCallback(async (): Promise<boolean> => {
    const handle = handleRef.current;
    if (!handle) return false;
    setIsLoaded(false);
    const { earned } = await handle.show();
    // Build-75 LEAD: 첫 광고 시청 후 다음 광고가 load 되기 전엔 isLoaded
    // false 라 버튼이 비활성. 단발 setTimeout 대신 polling 으로 다음 ad
    // 가 ready 될 때까지 (또는 5초 timeout) tick.
    const startedAt = Date.now();
    const pollId = setInterval(() => {
      const h = handleRef.current;
      if (!h || h.isLoaded() || Date.now() - startedAt > 5000) {
        setIsLoaded(h?.isLoaded() ?? false);
        clearInterval(pollId);
      }
    }, 250);
    return earned;
  }, []);

  return { isAvailable, isLoaded, show };
}
