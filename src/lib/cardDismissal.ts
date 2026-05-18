/**
 * cardDismissal — Context 카드 24h 일시 숨김 유틸 (v1.2 Phase 3).
 *
 * 같은 카드를 자주 보면 사용자 피로 → 사용자가 X 를 누르면 카테고리당
 * 24h dismiss. AsyncStorage 로 영구화.
 *
 * 키 네임스페이스: `cardDismiss:<categoryKey>` — 카테고리 예: `home-free-time`,
 * `calendar-conflict`, `planner-priority`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'cardDismiss:';
const DISMISS_MS = 24 * 60 * 60 * 1000;

export async function isDismissed(categoryKey: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + categoryKey);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_MS;
  } catch {
    return false;
  }
}

export async function dismiss(categoryKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + categoryKey, String(Date.now()));
  } catch {
    // best-effort
  }
}

export async function clearDismiss(categoryKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + categoryKey);
  } catch {
    // best-effort
  }
}
