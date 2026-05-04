/**
 * __tests__/stores/eventStore.test.ts
 *
 * TASK-210: Calendar View Test Suite — eventStore.ts 유닛 테스트
 *
 * 전략:
 *  - Zustand store를 직접 import하여 상태 머신처럼 검증
 *  - useEventStore.getState() / setState()로 사이드이펙트 없는 순수 상태 테스트
 *  - 각 테스트 전 beforeEach에서 고정 날짜 기준 초기 상태로 리셋
 *  - startAt/endAt에 UTC 날짜 문자열 사용 → 타임존 오프셋으로 인한
 *    toISOString() 키 불일치 방지
 *
 * 커버리지:
 *  초기 상태            — eventsByDate={}, selectedDate=Date, isFetching=false, error=null
 *  setEventsForDate     — 날짜 키에 배열 설정, 교체, 다른 날짜 미영향
 *  upsertEvent          — 새 이벤트 추가, 기존 id 교체, 같은 날 복수 이벤트
 *  removeEvent          — 단일 제거, 다중 날짜 버킷에서 제거, 없는 id 무시
 *  setSelectedDate      — selectedDate 업데이트
 *  setFetching          — true/false 토글
 *  setError             — 에러 설정 및 null 해제
 *  fetchEvents          — getEventsInRange 호출 후 eventsByDate 업데이트, 에러 처리
 *
 * @task TASK-210
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

/**
 * eventStore.ts가 eventService.getEventsInRange를 직접 import하므로 mock 필요.
 * factory 버전으로 기본값([]) 설정 → 테스트별 mockResolvedValue로 오버라이드.
 */
jest.mock('@/services/eventService', () => ({
  getEventsInRange: jest.fn().mockResolvedValue([]),
}));

import * as eventService from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';
import type { EventSummary } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/**
 * UTC 날짜 사용: toISOString().split('T')[0] = '2026-01-15'가 모든 타임존에서 동일.
 */
const mockEvent1: EventSummary = {
  id: 'evt-001',
  title: 'Team Meeting',
  startAt: new Date('2026-01-15T09:00:00.000Z'),
  endAt:   new Date('2026-01-15T10:00:00.000Z'),
  allDay:  false,
  color:   '#6C63FF',
  isOwn:   true,
};

const mockEvent2: EventSummary = {
  id: 'evt-002',
  title: 'Lunch with Alice',
  startAt: new Date('2026-01-15T12:00:00.000Z'),
  endAt:   new Date('2026-01-15T13:00:00.000Z'),
  allDay:  false,
  color:   '#FF6584',
  isOwn:   false,
};

const mockEvent3: EventSummary = {
  id: 'evt-003',
  title: 'Sprint Review',
  startAt: new Date('2026-01-16T14:00:00.000Z'),
  endAt:   new Date('2026-01-16T15:00:00.000Z'),
  allDay:  false,
  color:   '#43BFBB',
  isOwn:   true,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('eventStore', () => {
  /**
   * 각 테스트 전 스토어를 고정된 초기 상태로 리셋.
   * Zustand 싱글톤 특성상 테스트 간 상태 오염 방지 필수.
   */
  beforeEach(() => {
    useEventStore.setState({
      eventsByDate:    {},
      selectedDate:    new Date('2026-01-15T00:00:00.000Z'),
      isFetching:      false,
      error:           null,
      // Build-71 — fetchedDateKeys 초기화 (이전 테스트 캐시 hit 으로
      // fetchEvents 가 skip 되는 것 방지).
      fetchedDateKeys: new Set<string>(),
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 초기 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('초기 상태', () => {
    it('eventsByDate는 빈 객체', () => {
      expect(useEventStore.getState().eventsByDate).toEqual({});
    });

    it('isFetching = false', () => {
      expect(useEventStore.getState().isFetching).toBe(false);
    });

    it('error = null', () => {
      expect(useEventStore.getState().error).toBeNull();
    });

    it('selectedDate는 Date 인스턴스', () => {
      expect(useEventStore.getState().selectedDate).toBeInstanceOf(Date);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setEventsForDate
  // ══════════════════════════════════════════════════════════════════════════

  describe('setEventsForDate', () => {
    it('날짜 키에 이벤트 배열 설정', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toEqual([mockEvent1]);
    });

    it('같은 날짜에 재설정 시 기존 배열 완전 교체', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent2]);

      const events = useEventStore.getState().eventsByDate['2026-01-15'];
      expect(events).toHaveLength(1);
      expect(events![0]!.id).toBe('evt-002');
    });

    it('다른 날짜에 설정해도 기존 날짜 이벤트 미영향', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);
      useEventStore.getState().setEventsForDate('2026-01-16', [mockEvent3]);

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toEqual([mockEvent1]);
      expect(useEventStore.getState().eventsByDate['2026-01-16']).toEqual([mockEvent3]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // upsertEvent
  // ══════════════════════════════════════════════════════════════════════════

  describe('upsertEvent', () => {
    it('새 이벤트: startAt UTC 날짜 키 버킷에 추가', () => {
      useEventStore.getState().upsertEvent(mockEvent1);

      // mockEvent1.startAt = '2026-01-15T09:00Z' → key = '2026-01-15'
      const dateKey = mockEvent1.startAt.toISOString().split('T')[0];
      expect(useEventStore.getState().eventsByDate[dateKey!]).toContainEqual(mockEvent1);
    });

    it('기존 id와 동일한 이벤트: 배열 길이 유지하며 내용 교체', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);

      const updated: EventSummary = { ...mockEvent1, title: 'Updated Meeting' };
      useEventStore.getState().upsertEvent(updated);

      const events = useEventStore.getState().eventsByDate['2026-01-15']!;
      expect(events).toHaveLength(1);
      expect(events[0]!.title).toBe('Updated Meeting');
    });

    it('같은 날짜에 다른 id 이벤트 추가 시 배열 확장', () => {
      useEventStore.getState().upsertEvent(mockEvent1);
      useEventStore.getState().upsertEvent(mockEvent2);

      // 둘 다 2026-01-15 버킷
      const events = useEventStore.getState().eventsByDate['2026-01-15']!;
      expect(events).toHaveLength(2);
    });

    it('서로 다른 날짜 이벤트는 각각 별도 버킷에 저장', () => {
      useEventStore.getState().upsertEvent(mockEvent1); // 2026-01-15
      useEventStore.getState().upsertEvent(mockEvent3); // 2026-01-16

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toHaveLength(1);
      expect(useEventStore.getState().eventsByDate['2026-01-16']).toHaveLength(1);
    });

    // ── drag-to-reschedule regression (TASK-009 fix) ─────────────────────────

    it('[TASK-009 fix] 날짜 이동 시 원래 버킷에서 제거되고 새 버킷에만 존재', () => {
      // Arrange: 이벤트를 Jan 15에 세팅
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);

      // Act: 같은 이벤트를 Jan 16으로 이동 (drag-to-reschedule optimistic update)
      const movedEvent: EventSummary = {
        ...mockEvent1,
        startAt: new Date('2026-01-16T09:00:00.000Z'),
        endAt:   new Date('2026-01-16T10:00:00.000Z'),
      };
      useEventStore.getState().upsertEvent(movedEvent);

      // Assert: Jan 15 버킷에서 해당 이벤트가 사라져야 함 (ghost copy 방지)
      const jan15 = useEventStore.getState().eventsByDate['2026-01-15'] ?? [];
      expect(jan15.find((e) => e.id === mockEvent1.id)).toBeUndefined();

      // Assert: Jan 16 버킷에 새 버전이 들어와야 함
      const jan16 = useEventStore.getState().eventsByDate['2026-01-16'] ?? [];
      expect(jan16.find((e) => e.id === mockEvent1.id)).toBeDefined();
      expect(jan16.find((e) => e.id === mockEvent1.id)?.startAt).toEqual(movedEvent.startAt);
    });

    it('[TASK-009 fix] 같은 날짜 내 시간 이동 시 버킷 길이 불변', () => {
      // Arrange: Jan 15에 두 이벤트 세팅
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1, mockEvent2]);

      // Act: mockEvent1을 같은 날 오후로 이동
      const movedSameDay: EventSummary = {
        ...mockEvent1,
        startAt: new Date('2026-01-15T14:00:00.000Z'),
        endAt:   new Date('2026-01-15T15:00:00.000Z'),
      };
      useEventStore.getState().upsertEvent(movedSameDay);

      // Assert: 버킷은 여전히 2개 (ghost copy 없이 교체)
      const jan15 = useEventStore.getState().eventsByDate['2026-01-15'] ?? [];
      expect(jan15).toHaveLength(2);
      const moved = jan15.find((e) => e.id === mockEvent1.id);
      expect(moved?.startAt).toEqual(movedSameDay.startAt);
    });

    // TASK-005 / ADR-009: 로컬 timezone 기반 dateKey
    // 시스템 timezone이 KST 가정. KST 28일 00:30 = UTC 27일 15:30.
    // 옛 코드(toISOString)였으면 dateKey="2026-04-27" → 27일에 표시됐던 버그.
    // 새 코드(localDateKey)는 시스템 timezone 기준 → "2026-04-28" 유지.
    it('TASK-005: KST 자정 가까운 시간도 사용자가 입력한 날짜 기준으로 grouping', () => {
      // new Date(year, month, day, hour, minute) 는 시스템 timezone 기준 Date 객체 생성
      // KST 시스템에서 KST 28일 00:30 의미
      const lateNightEvent: EventSummary = {
        ...mockEvent1,
        id: 'evt-late-night',
        startAt: new Date(2026, 3, 28, 0, 30), // 2026-04-28 00:30 (시스템 timezone)
        endAt:   new Date(2026, 3, 28, 1, 30),
      };

      useEventStore.getState().upsertEvent(lateNightEvent);

      // 시스템 KST 가정: dateKey="2026-04-28" 으로 grouping
      // (옛 toISOString 방식이면 "2026-04-27" — fail)
      // CI가 다른 timezone에서 돌면 다른 키일 수 있으나 사용자 시스템 = 그 사용자 입력 기준
      const expectedKey = `${lateNightEvent.startAt.getFullYear()}-${String(lateNightEvent.startAt.getMonth()+1).padStart(2,'0')}-${String(lateNightEvent.startAt.getDate()).padStart(2,'0')}`;
      expect(useEventStore.getState().eventsByDate[expectedKey]).toContainEqual(lateNightEvent);
      // 이전 버그 시나리오: toISOString 키에는 들어가지 않음을 명시
      const utcKey = lateNightEvent.startAt.toISOString().split('T')[0]!;
      if (utcKey !== expectedKey) {
        expect(useEventStore.getState().eventsByDate[utcKey] ?? []).not.toContainEqual(lateNightEvent);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // removeEvent
  // ══════════════════════════════════════════════════════════════════════════

  describe('removeEvent', () => {
    it('단일 날짜 버킷에서 id로 제거', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1, mockEvent2]);

      useEventStore.getState().removeEvent('evt-001');

      const events = useEventStore.getState().eventsByDate['2026-01-15']!;
      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBe('evt-002');
    });

    it('복수 날짜 버킷 모두에서 동일 id 제거', () => {
      // 두 날짜 모두에 evt-001 삽입 (같은 id, 다른 날짜 시뮬레이션)
      const evt1OnDay2: EventSummary = {
        ...mockEvent1,
        startAt: new Date('2026-01-16T09:00:00.000Z'),
        endAt:   new Date('2026-01-16T10:00:00.000Z'),
      };
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);
      useEventStore.getState().setEventsForDate('2026-01-16', [evt1OnDay2]);

      useEventStore.getState().removeEvent('evt-001');

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toHaveLength(0);
      expect(useEventStore.getState().eventsByDate['2026-01-16']).toHaveLength(0);
    });

    it('존재하지 않는 id 제거 시도 → 상태 변화 없음', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);

      useEventStore.getState().removeEvent('non-existent-id');

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setSelectedDate
  // ══════════════════════════════════════════════════════════════════════════

  describe('setSelectedDate', () => {
    it('새 Date 객체로 selectedDate 업데이트', () => {
      const newDate = new Date('2026-03-20T00:00:00.000Z');
      useEventStore.getState().setSelectedDate(newDate);

      expect(useEventStore.getState().selectedDate).toEqual(newDate);
    });

    it('selectedDate 변경이 eventsByDate에 영향 없음', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);
      useEventStore.getState().setSelectedDate(new Date('2026-03-20T00:00:00.000Z'));

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toEqual([mockEvent1]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setFetching
  // ══════════════════════════════════════════════════════════════════════════

  describe('setFetching', () => {
    it('true 설정', () => {
      useEventStore.getState().setFetching(true);

      expect(useEventStore.getState().isFetching).toBe(true);
    });

    it('false 복원', () => {
      useEventStore.setState({ isFetching: true });
      useEventStore.getState().setFetching(false);

      expect(useEventStore.getState().isFetching).toBe(false);
    });

    it('isFetching 변경이 다른 상태에 영향 없음', () => {
      useEventStore.getState().setEventsForDate('2026-01-15', [mockEvent1]);
      useEventStore.getState().setFetching(true);

      // eventsByDate 유지 확인
      expect(useEventStore.getState().eventsByDate['2026-01-15']).toEqual([mockEvent1]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setError
  // ══════════════════════════════════════════════════════════════════════════

  describe('setError', () => {
    it('에러 메시지 설정', () => {
      useEventStore.getState().setError('네트워크 오류가 발생했습니다.');

      expect(useEventStore.getState().error).toBe('네트워크 오류가 발생했습니다.');
    });

    it('null로 에러 해제', () => {
      useEventStore.setState({ error: '기존 오류' });
      useEventStore.getState().setError(null);

      expect(useEventStore.getState().error).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchEvents — TASK-201 구현 후 통합 테스트
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchEvents', () => {
    const RANGE = { start: new Date('2026-01-01'), end: new Date('2026-01-31') };

    beforeEach(() => {
      // 각 테스트 전 mock 초기화 → 기본값 [] 유지
      (eventService.getEventsInRange as jest.Mock).mockResolvedValue([]);
    });

    it('성공: getEventsInRange 반환값을 날짜 키 버킷으로 분류', async () => {
      (eventService.getEventsInRange as jest.Mock).mockResolvedValue([mockEvent1, mockEvent2]);

      await useEventStore.getState().fetchEvents(RANGE);

      // mockEvent1, mockEvent2 모두 2026-01-15 버킷
      const events = useEventStore.getState().eventsByDate['2026-01-15'];
      expect(events).toHaveLength(2);
      expect(events).toEqual(expect.arrayContaining([mockEvent1, mockEvent2]));
    });

    it('성공: 완료 후 isFetching=false, error=null', async () => {
      await useEventStore.getState().fetchEvents(RANGE);

      expect(useEventStore.getState().isFetching).toBe(false);
      expect(useEventStore.getState().error).toBeNull();
    });

    it('실패: error 상태 설정, isFetching=false', async () => {
      (eventService.getEventsInRange as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await useEventStore.getState().fetchEvents(RANGE);

      expect(useEventStore.getState().isFetching).toBe(false);
      expect(useEventStore.getState().error).toContain('Network error');
    });

    it('기존 다른 날짜 이벤트 보존 (범위 밖 데이터 유지)', async () => {
      useEventStore.getState().setEventsForDate('2026-03-10', [mockEvent3]);
      (eventService.getEventsInRange as jest.Mock).mockResolvedValue([mockEvent1]);

      await useEventStore.getState().fetchEvents(RANGE);

      expect(useEventStore.getState().eventsByDate['2026-01-15']).toHaveLength(1);
      expect(useEventStore.getState().eventsByDate['2026-03-10']).toEqual([mockEvent3]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E1 fix — 이벤트 생성 직후 store 갱신 검증 (Sprint 28)
  // 시나리오: create.tsx의 performSave가 createEvent 성공 후 upsertEvent를
  //           호출하면, 이후 fetchEvents 없이도 해당 날짜 버킷에 이벤트가
  //           즉시 반영되어야 한다. (useFocusEffect re-fetch 전에도 store OK)
  // ══════════════════════════════════════════════════════════════════════════

  describe('E1 fix — 이벤트 생성 직후 즉시 store 반영', () => {
    /**
     * performSave 흐름 재현:
     *  1. createEvent 반환값으로 upsertEvent 호출 (optimistic)
     *  2. 곧이어 useFocusEffect → fetchEvents 호출 시 merge 후에도 이벤트 유지
     */
    it('upsertEvent 호출 직후 해당 날짜 버킷에 이벤트 즉시 반영', () => {
      // 빈 store에서 시작 — fetchEvents 없이 upsertEvent만으로 반영되는지 검증
      expect(useEventStore.getState().eventsByDate['2026-01-15']).toBeUndefined();

      // performSave가 createEvent 성공 후 호출하는 upsertEvent 시뮬레이션
      useEventStore.getState().upsertEvent(mockEvent1);

      const dateKey = `${mockEvent1.startAt.getFullYear()}-${String(mockEvent1.startAt.getMonth() + 1).padStart(2, '0')}-${String(mockEvent1.startAt.getDate()).padStart(2, '0')}`;
      const bucket = useEventStore.getState().eventsByDate[dateKey];
      expect(bucket).toBeDefined();
      expect(bucket).toHaveLength(1);
      expect(bucket![0]!.id).toBe(mockEvent1.id);
    });

    it('upsertEvent 후 fetchEvents(re-fetch) 시 동일 이벤트가 중복 없이 유지됨', async () => {
      // 1. optimistic upsert (create.tsx performSave 시뮬레이션)
      useEventStore.getState().upsertEvent(mockEvent1);

      // 2. useFocusEffect re-fetch — 서버가 동일 이벤트를 반환하는 시나리오
      (eventService.getEventsInRange as jest.Mock).mockResolvedValue([mockEvent1]);
      const RANGE = { start: new Date('2026-01-01'), end: new Date('2026-01-31') };
      await useEventStore.getState().fetchEvents(RANGE);

      // fetchEvents는 byDate를 merge-overwrite하므로 같은 날짜 버킷은 교체됨.
      // 결과: 중복 없이 mockEvent1 하나만 존재해야 한다.
      const dateKey = `${mockEvent1.startAt.getFullYear()}-${String(mockEvent1.startAt.getMonth() + 1).padStart(2, '0')}-${String(mockEvent1.startAt.getDate()).padStart(2, '0')}`;
      const bucket = useEventStore.getState().eventsByDate[dateKey];
      expect(bucket).toHaveLength(1);
      expect(bucket![0]!.id).toBe(mockEvent1.id);
    });

    it('upsertEvent가 다른 날짜 버킷에 영향을 주지 않음 (범위 밖 이벤트 보존)', () => {
      // 미리 다른 날짜에 이벤트 설정
      useEventStore.getState().setEventsForDate('2026-01-16', [mockEvent3]);

      // 새 이벤트 upsert (1-15 버킷)
      useEventStore.getState().upsertEvent(mockEvent1);

      // 1-16 버킷은 변경되지 않아야 함
      expect(useEventStore.getState().eventsByDate['2026-01-16']).toEqual([mockEvent3]);
    });
  });
});
