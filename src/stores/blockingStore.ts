/**
 * blockingStore — 전역 BlockingOverlay 상태.
 *
 * Build-98 LEAD: "스페이스 탈퇴할 때나 다른 중요 작업할 때 인디케이터 뷰
 * 하나 깔고 다른 입력 막아. 동작 끝나면 다시 다른 행동 가능하게."
 *
 * 사용 패턴:
 *   import { useBlockingStore, runBlocking } from '@/stores/blockingStore';
 *   await runBlocking('Space 탈퇴 중…', () => spaceService.leaveSpace(id));
 */

import { create } from 'zustand';

interface BlockingState {
  visible: boolean;
  message: string;
  show: (message?: string) => void;
  hide: () => void;
}

export const useBlockingStore = create<BlockingState>((set) => ({
  visible: false,
  message: '',
  show: (message = '처리 중…') => set({ visible: true, message }),
  hide: () => set({ visible: false, message: '' }),
}));

/**
 * 비동기 작업을 BlockingOverlay 로 감싼다. try/finally 로 hide 보장 — 작업
 * 실패해도 overlay 가 무한 노출되지 않음.
 *
 * @example
 *   await runBlocking('Space 탈퇴 중…', () => spaceService.leaveSpace(id));
 */
export async function runBlocking<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const { show, hide } = useBlockingStore.getState();
  show(message);
  try {
    return await fn();
  } finally {
    hide();
  }
}
