/**
 * adService — rewarded ad integration tests.
 *
 * Because the real `react-native-google-mobile-ads` module is native-only we
 * rely on Jest's default "missing module" behavior: the SDK's require() call
 * throws, and adService degrades to no-op helpers. These tests verify that
 * degradation so we never accidentally crash a platform without ads.
 *
 * Sprint 14 TASK-1402
 */

import { canShowAds, createRewardedAd, initAdMob } from '@/services/adService';

describe('adService — graceful fallback when SDK unavailable', () => {
  it('canShowAds returns false without throwing', () => {
    expect(canShowAds()).toBe(false);
  });

  it('initAdMob resolves without error', async () => {
    await expect(initAdMob()).resolves.toBeUndefined();
  });

  it('createRewardedAd returns null', () => {
    expect(createRewardedAd()).toBeNull();
  });
});
