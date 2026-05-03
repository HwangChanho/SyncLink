/**
 * FreeBannerAd — AdMob 배너 (Free 플랜 전용).
 *
 * 동작:
 *  - 사용자가 Pro 면 아무것도 렌더하지 않는다 (subscriptionStore.plan).
 *  - Web 또는 AdMob App ID 미설정이면 렌더하지 않는다 (silent no-op).
 *  - DEV 빌드는 SDK 의 TestIds.BANNER 를 사용해 실 노출 발생을 막는다.
 *
 * 의도:
 *  - 자연어 입력바 하단처럼 화면 하단 도크에 한 줄 끼워 노출.
 *  - 화면 어느 곳에나 두면 OK — 컴포넌트 자체에 plan/Platform/SDK 로딩
 *    가드가 모두 들어 있어서 부모는 그냥 렌더만 하면 된다.
 *  - SDK 가 없으면 null 반환이라 의존성 미설치 환경 (jest, web) 에서도
 *    안전하다.
 *
 * Sprint LEAD 2026-05-03 — "기본 버전은 자연어 입력바 하단에 배너,
 * Pro 는 안나오게."
 */

import { useMemo } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

interface Props {
  /** 외부 컨테이너에 적용할 스타일 (배경색/패딩 등). */
  style?: ViewStyle;
}

/**
 * AdMob 배너 unit ID 해석.
 *  - DEV 빌드: SDK TestIds.BANNER (실 노출 차단)
 *  - PROD: EXPO_PUBLIC_ADMOB_BANNER_ID_{platform}
 *  - 둘 다 없으면 undefined → 컴포넌트 미렌더
 */
function resolveBannerUnitId(testIdBanner?: string): string | undefined {
  if (__DEV__ && testIdBanner) return testIdBanner;
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_ADMOB_BANNER_ID_IOS;
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_ADMOB_BANNER_ID_ANDROID;
  return undefined;
}

export function FreeBannerAd({ style }: Props) {
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');

  // SDK 동적 로딩. Web 이나 모듈 미설치 환경에서는 silent fail 하도록 try.
  // useMemo 로 한 번만 시도. SDK 결과를 제외한 모든 분기는 cheap.
  const sdk = useMemo(() => {
    if (Platform.OS === 'web') return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('react-native-google-mobile-ads');
      return mod;
    } catch {
      return null;
    }
  }, []);

  // ── 가드 순서 (가장 cheap 한 것부터) ──────────────────────────────────────
  if (isPro) return null;
  if (Platform.OS === 'web') return null;
  if (!sdk) return null;

  const unitId = resolveBannerUnitId(sdk.TestIds?.BANNER);
  if (!unitId) return null;

  const { BannerAd, BannerAdSize } = sdk;
  if (!BannerAd) return null;

  return (
    <View style={style}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{
          // 비개인화 광고는 RC 동의 흐름 별도 도입 시 토글. 기본값으로 둠.
          requestNonPersonalizedAdsOnly: false,
        }}
      />
    </View>
  );
}
