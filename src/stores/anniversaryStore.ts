/**
 * anniversaryStore — 사용자가 속한 모든 Space 의 기념일을 보관.
 *
 * Build-91 LEAD: "같이 등록하는 기념일은 무조건 노출" — 캘린더 (월/주/일)
 * 모든 뷰에 표시. anniversary 는 events 와 별도 lifecycle 이라 별도
 * store. dateKey (YYYY-MM-DD) 별 grouping 은 occurrencesByDate(year, month)
 * 가 lazy 계산 — repeat_yearly=true 면 그 해의 같은 월/일에 매핑.
 */

import { create } from 'zustand';
import { getAllUserAnniversaries } from '@/services/space/anniversaries';
import type { Anniversary } from '@/types';

interface AnniversaryState {
  anniversaries: Anniversary[];
  isLoading:     boolean;

  fetchAll:      () => Promise<void>;
  /**
   * 특정 (year, month) 의 dateKey → occurrences 매핑. repeat_yearly=true 면
   * 해당 year 의 같은 month/day 로 매핑, false 면 원본 date 가 그 month 에
   * 들어갈 때만.
   *
   * 캘린더 뷰가 매 렌더마다 호출 — 데이터 양이 작아 메모이즈 안 함 (보통
   * 사용자 당 < 20 anniversary).
   */
  occurrencesByDate: (year: number, month: number) => Record<string, Anniversary[]>;
  reset:         () => void;
}

function fmtKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const useAnniversaryStore = create<AnniversaryState>((set, get) => ({
  anniversaries: [],
  isLoading:     false,

  fetchAll: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const list = await getAllUserAnniversaries();
      set({ anniversaries: list });
    } catch {
      // 캘린더 보조 데이터 — 실패해도 events 흐름엔 영향 없게 silent.
    } finally {
      set({ isLoading: false });
    }
  },

  occurrencesByDate: (year: number, month: number) => {
    const map: Record<string, Anniversary[]> = {};
    for (const a of get().anniversaries) {
      const d = a.date;
      if (a.repeatYearly) {
        // repeat_yearly: 그 해의 같은 month/day. month 가 일치해야 표시.
        if (d.getMonth() !== month) continue;
        const key = fmtKey(year, month, d.getDate());
        (map[key] ??= []).push(a);
      } else {
        // one-shot: 원본 date 가 해당 (year, month) 에 정확히 일치해야.
        if (d.getFullYear() !== year || d.getMonth() !== month) continue;
        const key = fmtKey(d.getFullYear(), d.getMonth(), d.getDate());
        (map[key] ??= []).push(a);
      }
    }
    return map;
  },

  reset: () => set({ anniversaries: [], isLoading: false }),
}));
