/**
 * useRouteBreadcrumb — 화면이 바뀔 때마다 Sentry 에 흔적을 남긴다.
 *
 * 왜 필요했나: 2026-08-30 fatal 크래시(SYNKLINK-1A)를 조사할 때 **크래시 직전에
 * 어느 화면이었는지 알 방법이 없었다.** Sentry breadcrumb 에는 `ui.lifecycle` 만
 * 있었고(뷰컨트롤러 종류만 알려준다), 퍼널은 7단계만 기록한다. 그 결과
 * "로그인 화면에서 죽었다"는 것조차 확정하지 못하고 추정으로 남았다.
 *
 * 설계:
 *  - `usePathname()` 만 본다. Sentry 의 reactNavigationIntegration 을 쓰지 않는 이유는
 *    SDK 버전에 따라 API 가 바뀌고 네이티브 설정이 얽히는데, 여기서 필요한 건
 *    "어느 화면인가" 하나뿐이라 그 비용을 치를 이유가 없다. 이 방식은 웹에서도 그대로 돈다.
 *  - 실패해도 화면에 영향이 없어야 하므로 예외를 삼킨다.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import { addNavigationBreadcrumb } from '@/lib/sentry';

/**
 * 경로에서 식별자를 지운다 — 화면 이름만 남기고 개인정보는 보내지 않는다.
 *
 *   /event/9a3f1c2e-…      → /event/[id]
 *   /space/12/chat         → /space/[n]/chat
 *   /space/join/AB12CD     → /space/join/[code]
 */
export function sanitizeRoute(path: string): string {
  return path
    // UUID
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/[id]')
    // 초대 코드(영숫자 6~12자 대문자 위주) — join 경로에서만 쓰이므로 그 뒤에 붙은 것만
    .replace(/(\/join)\/[A-Za-z0-9]{4,16}/g, '$1/[code]')
    // 숫자 id
    .replace(/\/\d+(?=\/|$)/g, '/[n]');
}

/** 화면 전환을 Sentry breadcrumb 으로 남긴다. 루트 레이아웃에서 한 번만 부른다. */
export function useRouteBreadcrumb(): void {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    try {
      const safe = sanitizeRoute(pathname || '/');
      if (prev.current === safe) return;
      addNavigationBreadcrumb(prev.current, safe);
      prev.current = safe;
    } catch {
      // 기록 실패가 화면을 깨뜨리면 본말전도다.
    }
  }, [pathname]);
}
