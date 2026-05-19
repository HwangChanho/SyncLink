/**
 * cardDismissal unit tests — v1.2 Phase 3.
 */

import { isDismissed, dismiss, clearDismiss } from '@/lib/cardDismissal';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('cardDismissal', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('처음엔 dismissed 가 아니다', async () => {
    expect(await isDismissed('test-card')).toBe(false);
  });

  it('dismiss 후엔 dismissed true', async () => {
    await dismiss('test-card');
    expect(await isDismissed('test-card')).toBe(true);
  });

  it('clearDismiss 후엔 다시 false', async () => {
    await dismiss('test-card');
    await clearDismiss('test-card');
    expect(await isDismissed('test-card')).toBe(false);
  });

  it('24h 지난 dismiss 는 만료', async () => {
    const oldTs = Date.now() - 25 * 60 * 60 * 1000;
    await AsyncStorage.setItem('cardDismiss:expired-card', String(oldTs));
    expect(await isDismissed('expired-card')).toBe(false);
  });

  it('다른 카테고리는 독립적', async () => {
    await dismiss('home-free-time');
    expect(await isDismissed('home-free-time')).toBe(true);
    expect(await isDismissed('planner-priority')).toBe(false);
  });
});
