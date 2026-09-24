/**
 * brandFontsReady — 브랜드 글꼴(주아·나눔스퀘어라운드) 로딩이 끝났는지 알리는 작은 전역 신호.
 *
 * 🔴 왜 필요한가(2026-09-24 LEAD 실기 스크린샷 — "오늘 일정이 없어ᅀ" 끝 글자 잘림):
 *   루트 레이아웃은 글꼴을 받는 동안 스플래시를 **덮어 씌울 뿐**, 그 아래에서 화면(Stack)은
 *   이미 그려진다. 그때 글꼴이 아직 없으니 iOS 는 텍스트 폭을 **시스템 글꼴로** 잰다.
 *   글꼴이 도착해도 스타일 값은 그대로라 **다시 재지 않고**, 더 넓은 브랜드 글꼴을 좁은 칸에
 *   그려 끝 글자가 잘렸다(탭 라벨 잘림도 같은 뿌리였을 가능성이 크다).
 *
 * 해법: 준비되기 전에는 AppText 가 브랜드 글꼴을 **아예 지정하지 않고**, 준비되면 지정한다.
 *   스타일 값이 바뀌므로 iOS 가 폭을 다시 잰다.
 *
 * zustand 대신 useSyncExternalStore 를 쓴 이유: 값 하나·쓰는 곳 하나라 스토어를 만들 만큼이
 *   아니고, 텍스트마다 구독하므로 가장 가벼운 형태가 좋다.
 */
import { useSyncExternalStore } from 'react';

let ready = false;
const listeners = new Set<() => void>();

/**
 * 글꼴 로딩이 끝났음을 알린다(루트 레이아웃이 한 번 부른다). 두 번째 호출부터는 무시.
 */
export function markBrandFontsReady(): void {
  if (ready) return;
  ready = true;
  listeners.forEach((fn) => fn());
}

/** 현재 값(구독 없이 읽기 — 테스트·비컴포넌트용) */
export function areBrandFontsReady(): boolean {
  return ready;
}

/**
 * 컴포넌트에서 구독한다. 준비되는 순간 한 번 다시 렌더된다.
 * @returns 브랜드 글꼴을 써도 되면 true
 */
export function useBrandFontsReady(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ready,
    () => ready,
  );
}

/** 테스트 전용: 초기 상태로 되돌린다 */
export function __resetBrandFontsReadyForTest(): void {
  ready = false;
}
