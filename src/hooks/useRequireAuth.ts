/**
 * useRequireAuth — 값 있는 동작을 부드러운 로그인 권유 뒤에 두는 가드.
 *
 * 로그인 상태면 `action` 을 실행하고, 둘러보는 게스트면 LoginPromptSheet
 * (하단 시트)를 띄우는 함수를 돌려준다. 생성·공유·AI 동작을 감싸면 게스트가
 * 로그인 화면으로 튕기는 대신 부드러운 권유를 받는다.
 *
 *   const requireAuth = useRequireAuth();
 *   <Pressable onPress={() => requireAuth(() => router.push('/event/create'), 'event_create')} />
 *
 * 2026-06-04 게스트 진입 계획 Part A / Phase 2.
 */

import { useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useLoginPromptStore } from '@/stores/loginPromptStore';
import type { LoginPromptSource } from '@/services/funnelService';

export function useRequireAuth(): (
  action: () => void,
  source: LoginPromptSource,
  message?: string,
) => boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const open = useLoginPromptStore((s) => s.open);

  /**
   * @param action   로그인 상태에서만 실행된다.
   * @param source   게스트가 하려던 일. 퍼널 `login_prompt:<source>` 로 남는다.
   *                 **필수** — 빠뜨리면 "무엇을 하려다 막혔나"를 못 가린다.
   * @param message  게스트 경로에서 시트에 띄울 상황별 문구(선택).
   * @returns        action 이 실행됐으면 true, 게스트 권유가 열렸으면 false.
   */
  return useCallback(
    (action: () => void, source: LoginPromptSource, message?: string): boolean => {
      if (isAuthenticated) {
        action();
        return true;
      }
      open(source, message);
      return false;
    },
    [isAuthenticated, open],
  );
}
