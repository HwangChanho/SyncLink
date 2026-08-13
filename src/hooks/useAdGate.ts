/**
 * useAdGate — "이 동작을 하려면 보상형 광고를 봐야 한다"를 한 곳에서 처리한다.
 *
 * 두 가지 게이트 정책을 지원한다:
 *   - `'always'` : 실행할 때마다 광고 (스페이스 생성)
 *   - `'daily'`  : 하루 한 번만 광고, 그날은 이후 무료 (공유 일정 등록)
 *
 * 면제 조건:
 *   - **Pro 구독자** — 광고 없음
 *   - 광고를 띄울 수 없는 환경(웹, 키 미설정 등) — 막으면 기능 자체를 못 쓴다.
 *     `isAvailable=false` 면 그냥 통과시킨다. 광고를 못 보여주는 게 사용자 잘못은 아니다.
 *
 * 🔴 "봤음" 기록은 **로컬(AsyncStorage)** 이다. 재설치하면 초기화된다.
 *    서버에 두면 확실하지만 동작마다 왕복이 생기고, 우회해도 손해가 광고 1회라
 *    그 값을 치를 이유가 없다. AdMob SSV 로 실제 보상을 주는 경로
 *    (`reward-credit`)와는 별개다 — 여기는 순수 게이트다.
 */

import { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { useAuthStore } from '@/stores/authStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

export type AdGateFrequency = 'always' | 'daily';

/** AsyncStorage 키 접두사. 게이트마다 다른 키를 쓰도록 id 를 붙인다. */
const KEY_PREFIX = 'synclink.adGate.';

/** 로컬 날짜 YYYY-MM-DD. UTC 를 쓰면 한국 사용자에게 자정이 오전 9시가 된다. */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface UseAdGateResult {
  /** 광고를 봐야 하는 상태인지(= Pro 아님, 오늘 아직 안 봄, 광고 가능). */
  needsAd: boolean;
  /** 광고 재생 중. 버튼 비활성화/스피너용. */
  watching: boolean;
  /**
   * 게이트를 통과시킨다. 필요하면 광고를 띄우고, 끝나면 기록한다.
   * @returns 통과했으면 true. 사용자가 광고를 중간에 닫았으면 false.
   */
  pass: () => Promise<boolean>;
}

/**
 * @param id         게이트 식별자. `'space_create'` / `'shared_event'` 등.
 * @param frequency  'always' | 'daily'
 */
export function useAdGate(id: string, frequency: AdGateFrequency): UseAdGateResult {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');
  const rewarded = useRewardedAd(userId);

  const [watching, setWatching] = useState(false);
  // daily 게이트에서 "오늘 이미 봤다"를 캐시. 최초값은 모름(null)이라 pass() 에서 읽는다.
  const [seenToday, setSeenToday] = useState<boolean | null>(null);

  const exempt = isPro || !rewarded.isAvailable;
  const needsAd = !exempt && !(frequency === 'daily' && seenToday === true);

  const pass = useCallback(async (): Promise<boolean> => {
    if (exempt) return true;

    const key = `${KEY_PREFIX}${id}`;
    if (frequency === 'daily') {
      // 캐시가 없으면 저장소에서 확인. 앱을 켜둔 채 자정을 넘겨도 날짜 비교라 옳게 동작한다.
      const stored = await AsyncStorage.getItem(key).catch(() => null);
      if (stored === todayKey()) {
        setSeenToday(true);
        return true;
      }
    }

    setWatching(true);
    try {
      const rewardedOk = await rewarded.show();
      // 사용자가 보상 지점 전에 닫으면 false — 게이트를 통과시키지 않는다.
      if (!rewardedOk) return false;

      if (frequency === 'daily') {
        await AsyncStorage.setItem(key, todayKey()).catch(() => { /* 기록 실패는 무해 */ });
        setSeenToday(true);
      }
      return true;
    } catch {
      // 광고 로드/재생 실패는 사용자 잘못이 아니다 → 통과시킨다.
      // 막아버리면 광고 서버 장애가 곧 기능 장애가 된다.
      return true;
    } finally {
      setWatching(false);
    }
  }, [exempt, frequency, id, rewarded]);

  return { needsAd, watching, pass };
}
