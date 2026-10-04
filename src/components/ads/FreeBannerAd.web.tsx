/**
 * FreeBannerAd (웹) — AdSense 고정 배너 320×50 (Free 플랜 전용).
 *
 * 네이티브 FreeBannerAd.tsx(AdMob)의 웹 짝이다. Metro 가 웹 번들에서는 `.web.tsx` 를
 * 우선 해석하므로 부모(NLInputBar)는 플랫폼을 신경 쓰지 않고 그대로 렌더하면 된다.
 *
 * 동작:
 *  - Pro 면 아무것도 렌더하지 않는다(네이티브와 같은 subscriptionStore.plan 가드).
 *  - DEV(로컬 dev 웹)에서는 렌더하지 않는다 — localhost 노출은 무효 트래픽으로 잡힐 수 있다.
 *  - 마운트 때 `adsbygoogle.push({})` 를 한 번 호출해 이 <ins> 슬롯을 채우게 한다.
 *
 * 전제:
 *  - AdSense 로더 스크립트는 index.html <head> 에 있다(scripts/web/patch-index-head.mjs 가 빌드 후 주입).
 *    로더가 아직 안 받아졌어도 push 는 큐(배열)에 쌓였다가 로더가 뜨면 처리된다.
 *  - 사이트가 AdSense 승인 전이면 슬롯은 빈 자리로 남는다(높이 50 은 차지한다).
 *
 * LEAD 2026-10-05 — «웹에도 광고 적용해».
 */

import { createElement, useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

interface Props {
  /** 외부 컨테이너에 적용할 스타일 (배경색/패딩 등). */
  style?: ViewStyle;
}

/** AdSense 게시자 ID — ads.txt·patch-index-head.mjs 와 같은 값. 공개값이다. */
const ADSENSE_CLIENT = 'ca-pub-2936938026486482';
/** AdSense 광고 단위 «uriharu-web-inputbar-banner»(디스플레이 · 고정 320×50). */
const ADSENSE_SLOT = '1061175429';

/** 로더가 window 에 붙이는 큐. 로더 전에는 우리가 배열로 만들어 둔다. */
type AdsQueue = unknown[];
declare global {
  interface Window {
    adsbygoogle?: AdsQueue;
  }
}

export function FreeBannerAd({ style }: Props) {
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');
  const show = !isPro && !__DEV__;

  // 슬롯이 DOM 에 붙은 뒤 한 번만 채우기 요청. show 가 false→true 로 바뀌면(Pro 해지 등) 새 <ins> 에 다시 요청한다.
  useEffect(() => {
    if (!show) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 광고 차단기·로더 오류 — 광고가 안 뜰 뿐 앱 동작에는 영향이 없어야 한다.
    }
  }, [show]);

  if (!show) return null;

  return (
    <View style={[{ alignItems: 'center' }, style]}>
      {/* RN 에는 <ins> 가 없어 react-dom 요소를 직접 만든다(웹 번들 전용 파일이라 안전). */}
      {createElement('ins', {
        className: 'adsbygoogle',
        style: { display: 'inline-block', width: 320, height: 50 },
        'data-ad-client': ADSENSE_CLIENT,
        'data-ad-slot': ADSENSE_SLOT,
      })}
    </View>
  );
}
