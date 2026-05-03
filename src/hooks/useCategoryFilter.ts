/**
 * useCategoryFilter — 캘린더의 카테고리 dim 토글 + 그 결과로 도출된
 * eventsByDate 의 변형 (`displayEventsByDate`).
 *
 * Phase 2.1 분할 — calendar.tsx 에서 카테고리/dim 관련 5개 state +
 * memo 조합을 한 곳으로 묶었다. UI 는 (dimmedCats, toggle, displayEventsByDate)
 * 만 받는다.
 *
 * 동작:
 *  - 사용자가 카테고리 chip 을 끄면 그 카테고리에 속한 (또는 sentinel
 *    '__none__' = 카테고리 없음) 이벤트의 색에 ~19% alpha 를 덧붙여 dim.
 *  - 카테고리 목록은 mount 시 한 번 fetch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, EventSummary } from '@/types';
import { getCategories } from '@/services/categoryService';

type EventsByDate = Record<string, EventSummary[]>;

interface UseCategoryFilterResult {
  categories: Category[];
  dimmedCats: Set<string>;
  toggleCategoryDim: (bucket: string) => void;
  displayEventsByDate: EventsByDate;
  /** 카테고리 필터 모달 visibility 는 화면 부모가 제어 — 여기선 데이터만. */
}

export function useCategoryFilter(eventsByDate: EventsByDate): UseCategoryFilterResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [dimmedCats, setDimmedCats] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getCategories()
      .then((list) => { if (!cancelled) setCategories(list); })
      .catch(() => { /* 비치명적 — 빈 목록으로 진행 */ });
    return () => { cancelled = true; };
  }, []);

  const toggleCategoryDim = useCallback((bucket: string) => {
    setDimmedCats((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }, []);

  // dim 적용된 사본. dim 카테고리에 속한 이벤트 색 끝에 0x30 (≈19% alpha)
  // 덧붙여 RN 이 그대로 fade 렌더하게 한다.
  const displayEventsByDate = useMemo(() => {
    if (dimmedCats.size === 0) return eventsByDate;
    const out: EventsByDate = {};
    for (const [key, events] of Object.entries(eventsByDate)) {
      out[key] = events.map((e) => {
        const bucket = e.categoryId ?? '__none__';
        if (!dimmedCats.has(bucket)) return e;
        const c = e.color;
        const dimmed = c.length === 7 ? `${c}30` : c;
        return { ...e, color: dimmed };
      });
    }
    return out;
  }, [eventsByDate, dimmedCats]);

  return { categories, dimmedCats, toggleCategoryDim, displayEventsByDate };
}
