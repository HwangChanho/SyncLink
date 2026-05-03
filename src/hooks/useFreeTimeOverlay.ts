/**
 * useFreeTimeOverlay — PRD 4.2 Tier 2 의 "빈 시간 보기" 토글 + 데이터 fetch
 * 책임을 캘린더 화면에서 분리한 hook.
 *
 * Phase 2.1 분할 — calendar.tsx 에서 ~80줄 차지하던 4개의 state + 2개의
 * effect 를 한 곳에 모았다. 캘린더는 이 hook 의 결과 (slots, isOn, ...)
 * 만 받고 fetch 라이프사이클은 신경 쓸 필요 없다.
 *
 * 동작 요약:
 *  - mount 시 사용자의 Space 목록을 한번 로드. 첫 로드면 모든 Space 를
 *    기본 선택 ("내가 공유 중인 사람들이 모두 비는 시간" 기본 의도).
 *  - isOn=true 가 되거나 selectedSpaceIds / selectedDate / viewMode 가
 *    바뀔 때마다 free-time 슬롯을 다시 가져온다.
 *  - 한 번에 여러 Space 를 합쳐 보여주는 deduplication 은 Tier 3 의
 *    분 이슈라 여기선 단순 concat.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ViewMode } from '@/components/calendar/CalendarHeader';
import { findFreeSlots } from '@/services/freeTimeService';
import { getMySpaces } from '@/services/spaceService';
import type { SpaceSummary } from '@/types';
import type { FreeSlot } from '@/types/freeTime';
import { getViewRange } from '@/lib/calendarRange';

interface UseFreeTimeOverlayArgs {
  selectedDate: Date;
  viewMode: ViewMode;
}

interface UseFreeTimeOverlayResult {
  /** 토글 상태. */
  isOn: boolean;
  /** 토글 — UI 의 토글 버튼이 호출. */
  toggle: () => void;
  /** 사용자가 속한 Space 목록 (chip 선택지 용). */
  mySpaces: SpaceSummary[];
  /** 선택된 Space 들의 ID set. */
  selectedSpaceIds: Set<string>;
  /** Space chip 토글 — 선택/해제. */
  toggleSpaceSelection: (spaceId: string) => void;
  /** 현재 view 범위에서 계산된 빈 슬롯들. */
  slots: FreeSlot[];
  /** "fetched 했지만 0개" 와 "아직 fetch 전" 을 구분하기 위한 플래그. */
  loaded: boolean;
}

export function useFreeTimeOverlay({
  selectedDate,
  viewMode,
}: UseFreeTimeOverlayArgs): UseFreeTimeOverlayResult {
  const [isOn, setIsOn] = useState(false);
  const [mySpaces, setMySpaces] = useState<SpaceSummary[]>([]);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [loaded, setLoaded] = useState(false);

  // mount 시 Space 목록 로드 + 첫 로드면 모두 기본 선택
  useEffect(() => {
    let cancelled = false;
    getMySpaces().then((spaces) => {
      if (cancelled) return;
      setMySpaces(spaces);
      setSelectedSpaceIds((prev) => prev.size === 0
        ? new Set(spaces.map((s) => s.id))
        : prev);
    }).catch(() => { /* 비치명적 — UI 는 빈 상태 표시 */ });
    return () => { cancelled = true; };
  }, []);

  // 슬롯 fetch — 토글이 켜져 있을 때만, 의존값 변경마다 재실행
  useEffect(() => {
    if (!isOn) {
      setLoaded(false);
      return;
    }
    if (selectedSpaceIds.size === 0) {
      setSlots([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    const range = getViewRange(selectedDate, viewMode);
    const ids = Array.from(selectedSpaceIds);
    Promise.all(
      ids.map((spaceId) =>
        findFreeSlots(spaceId, range, { minSlotMinutes: 30 }).catch(() => [] as FreeSlot[]),
      ),
    )
      .then((perSpace) => {
        if (cancelled) return;
        setSlots(perSpace.flat());
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [isOn, selectedSpaceIds, selectedDate, viewMode]);

  const toggle = useCallback(() => setIsOn((p) => !p), []);

  const toggleSpaceSelection = useCallback((spaceId: string) => {
    setSelectedSpaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      return next;
    });
  }, []);

  return {
    isOn,
    toggle,
    mySpaces,
    selectedSpaceIds,
    toggleSpaceSelection,
    slots,
    loaded,
  };
}
