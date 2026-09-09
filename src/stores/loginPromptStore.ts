/**
 * loginPromptStore — 게스트용 LoginPromptSheet 의 전역 표시 상태.
 *
 * 둘러보는 게스트가 값 있는 동작(일정 생성·AI 입력·공유)을 시도하면 강제 이동
 * 대신 부드러운 로그인 권유 시트를 띄운다. 시트 자체는 루트 레이아웃에 한 번만
 * 마운트되고 이 스토어를 읽는다. 2026-06-04 게스트 계획 Part A / Phase 2.
 *
 * 🔑 **퍼널 계측이 여기 있는 이유** (1.4.14):
 * "게스트가 막힌 순간"은 호출부가 아니라 **시트가 열렸다는 사실**이다.
 * 계측을 호출부마다 흩어 두면 새 호출부가 생길 때마다 빠뜨린다 — 실제로
 * `event_created` 가 그렇게 4개 경로에서 누락돼 있었다. `open()` 한 곳에서
 * 남기면 **어떤 경로로 열어도 반드시 세어진다.**
 */

import { create } from 'zustand';
import { trackFunnel, type LoginPromptSource } from '@/services/funnelService';

interface LoginPromptState {
  /** 시트가 보이는지 여부. */
  visible: boolean;
  /** 기본 본문 문구를 대체할 상황별 안내 문구(없으면 null). */
  message: string | null;
  /**
   * 시트를 띄운다.
   *
   * @param source   게스트가 하려던 일. **필수** — 선택으로 두면 값이 비어
   *                 들어와 집계가 무의미해진다(계측 공백을 메우려고 넣은 값이다).
   * @param message  상황별 안내 문구(선택).
   */
  open: (source: LoginPromptSource, message?: string) => void;
  /** 시트를 닫는다. */
  close: () => void;
}

export const useLoginPromptStore = create<LoginPromptState>((set) => ({
  visible: false,
  message: null,
  open: (source, message) => {
    // 기록은 화면 갱신을 막지 않는다 — 실패해도 조용히 삼켜진다(funnelService 규약).
    void trackFunnel(`login_prompt:${source}`);
    set({ visible: true, message: message ?? null });
  },
  close: () => set({ visible: false }),
}));
