/**
 * useBootConnectionNotice — 부팅이 서버 때문에 멈췄을 때 «연결 안내» 를 켤지 정하는 훅. (2026-11-27)
 *
 * 켜지는 경우 두 가지:
 *   ① 시간 감시: 부팅(인증 초기화 + 프로필 조회)이 delayMs 를 넘긴다.
 *      — 인증 초기화가 토큰 갱신에서 멈추는 경우처럼, 조회 결과가 아예 안 오는 상황까지 잡는다.
 *   ② 즉시 보고: 프로필 조회가 'unreachable' 로 끝나 RootLayout 이 reportUnreachable() 을 부른다.
 *
 * 부팅이 끝나면(isBooting=false) 즉시 꺼진다 — 늦게라도 프로필이 오면 안내 없이 그대로 진입한다.
 *
 * @param isBooting - 부팅 중인가(useAuthStore 의 isLoading)
 * @param delayMs   - 시간 감시 길이(ms). 테스트에서 짧게 주려고 인자로 받는다.
 * @returns visible: 안내를 보여 줄지 · reportUnreachable: 조회 실패를 바로 알린다
 */

import { useCallback, useEffect, useState } from 'react';
import { BOOT_CONNECTION_NOTICE_MS } from '@/lib/bootConnection';

export function useBootConnectionNotice(
  isBooting: boolean,
  delayMs: number = BOOT_CONNECTION_NOTICE_MS,
): { visible: boolean; reportUnreachable: () => void } {
  const [flagged, setFlagged] = useState(false);

  useEffect(() => {
    // 부팅 상태가 바뀔 때마다 새로 센다 — 이전 부팅(또는 부팅 밖)의 보고가 남지 않게.
    setFlagged(false);
    if (!isBooting) return undefined;
    const timer = setTimeout(() => setFlagged(true), delayMs);
    return () => clearTimeout(timer);
  }, [isBooting, delayMs]);

  // 안정적인 참조 — RootLayout 의 인증 구독(빈 의존성 effect)에서 불러도 낡지 않는다.
  const reportUnreachable = useCallback(() => setFlagged(true), []);

  // isBooting 을 한 번 더 곱해, 부팅이 끝난 그 렌더에서 바로 꺼지게 한다(effect 를 기다리지 않음).
  return { visible: flagged && isBooting, reportUnreachable };
}
