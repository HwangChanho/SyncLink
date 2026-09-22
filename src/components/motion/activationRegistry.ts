/**
 * activationRegistry — "방금 켜졌다(완료됐다)" 는 표시를 아주 잠깐 기억하는 저장소.
 *
 * 🔴 왜 필요한가(1.5.0 웹 실측으로 발견):
 *   플래너는 할 일을 완료하면 그 행을 "완료" 묶음으로 옮긴다. 이때 체크박스 컴포넌트가
 *   **새로 마운트**된다(토글할 때마다 DOM 노드가 바뀌는 것을 확인). 새 컴포넌트는 처음부터
 *   완료 상태로 태어나므로 "false → true 로 바뀌는 순간" 을 볼 수 없고, 그래서 팝 애니메이션이
 *   한 번도 보이지 않았다.
 *
 * 해법: 누르는 쪽이 `markJustActivated(key)` 로 표시를 남기고, 새로 마운트된
 *   PopOnActivate 가 `consumeJustActivated(key)` 로 확인해 튄다. 목록 구조와 무관하게 동작한다.
 *
 * 🔑 구독(subscribeActivation): 탭바 아이콘처럼 **재마운트도, 값 변화도 없는** 경우를 위해
 *   이미 마운트된 컴포넌트가 표시 순간을 바로 받을 수 있게 한다. react-navigation 탭바는
 *   아이콘을 focused=true/false 두 벌 겹쳐 두고 투명도만 바꾸므로 각 인스턴스의 값이 영영
 *   바뀌지 않는다(bottom-tabs TabBarIcon.tsx). 탭을 누르는 순간 표시하면 이미 떠 있는
 *   "선택됨" 아이콘이 받아서 튄다.
 *
 * 모듈 전역 Map 이라 앱 전체에서 공유된다. 표시는 한 번 읽으면 지워지고,
 * 읽히지 않아도 WINDOW_MS 가 지나면 무효라 쌓여서 엉뚱한 때 튀는 일이 없다.
 */

/** 표시가 유효한 시간. 저장 → 재렌더 → 재마운트까지 넉넉히 잡되 사람이 체감할 만큼 길지 않게 */
const WINDOW_MS = 800;

/** key → 표시한 시각(ms) */
const recent = new Map<string, number>();

/** key → 표시 순간 알림을 받을 콜백들. 콜백이 true 를 돌려주면 "처리했다" 로 보고 표시를 지운다 */
const listeners = new Map<string, Set<() => boolean>>();

/**
 * 방금 켜졌다고 표시한다(예: 할 일 완료 버튼을 누른 순간).
 * @param key - 대상 식별자(예: `todo:<id>`)
 * @param now - 현재 시각(테스트 주입용)
 */
export function markJustActivated(key: string, now: number = Date.now()): void {
  recent.set(key, now);
  // 이미 마운트된 구독자에게 바로 알린다. 하나라도 처리하면 표시를 지워 두 번 튀지 않게 한다
  // (처리하지 않으면 표시를 남겨 두어, 곧 새로 마운트될 컴포넌트가 가져가게 한다)
  let handled = false;
  listeners.get(key)?.forEach((fn) => {
    if (fn()) handled = true;
  });
  if (handled) recent.delete(key);
}

/**
 * 표시 순간 알림을 구독한다.
 * @param key - 대상 식별자
 * @param fn  - 표시될 때 불린다. 실제로 반응(애니메이션)했으면 true 를 돌려준다
 * @returns 구독 해제 함수(언마운트 때 부를 것)
 */
export function subscribeActivation(key: string, fn: () => boolean): () => void {
  const set = listeners.get(key) ?? new Set<() => boolean>();
  set.add(fn);
  listeners.set(key, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * 방금 켜진 표시가 있으면 true 를 돌려주고 표시를 지운다(한 번만 튀게).
 * @param key - markJustActivated 에 넘긴 것과 같은 식별자
 * @param now - 현재 시각(테스트 주입용)
 * @returns WINDOW_MS 안에 표시됐으면 true
 */
export function consumeJustActivated(key: string, now: number = Date.now()): boolean {
  const at = recent.get(key);
  if (at === undefined) return false;
  recent.delete(key);
  return now - at < WINDOW_MS;
}
