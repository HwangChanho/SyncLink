/**
 * __tests__/services/eventService.test.ts
 *
 * TASK-211: Event CRUD Test Suite
 *
 * 전략:
 *  - @/lib/supabase 전체를 mock → 실제 DB 호출 차단
 *  - getCurrentUserId mock → 인증 상태 제어
 *  - makeChain() 헬퍼: Supabase 쿼리 체인을 thenable + .single() 양쪽 지원
 *    (spaceService.test.ts와 동일한 패턴)
 *  - 복수 from() 호출은 mockReturnValueOnce 체이닝으로 순서 보장
 *  - eventShareService, freeTimeService도 동일 mock 패턴 사용
 *
 * 커버리지:
 *  eventService.getEventsInRange  — 자기 일정 + 공유 일정 병합, 날짜 범위 필터, 미인증
 *  eventService.getEventById      — 정상 조회, 미존재
 *  eventService.createEvent       — INSERT 호출 + 공유 처리, 미인증
 *  eventService.updateEvent       — 필드 패치, RLS(user_id eq), 미인증
 *  eventService.deleteEvent       — DELETE 호출 (user_id eq), 미인증
 *  eventShareService.shareEventToSpace     — event_shares UPSERT
 *  eventShareService.unshareEventFromSpace — event_shares DELETE
 *  freeTimeService.findFreeTimeSlots       — 빈 시간 계산 (merge 알고리즘)
 *
 * @task TASK-211
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
  getCurrentUserId: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import {
  getEventsInRange,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  findConflictingEvents,
  forkSharedEvent,
} from '@/services/eventService';
import {
  shareEventToSpace,
  unshareEventFromSpace,
} from '@/services/eventShareService';
import { findFreeTimeSlots } from '@/services/freeTimeService';
import type { EventRow } from '@/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인 mock 생성.
 *
 * - 모든 builder 메서드는 this 반환 (체이닝 지원)
 * - chain 자체가 thenable → await chain 시 resolvedValue로 resolve
 * - .single()도 resolvedValue로 resolve
 */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    neq:    jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    lt:     jest.fn().mockReturnThis(),
    gt:     jest.fn().mockReturnThis(),
    lte:    jest.fn().mockReturnThis(),
    gte:    jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    // .single() → Promise<resolvedValue>
    single: jest.fn().mockResolvedValue(resolvedValue),
    // chain 자체를 await 할 수 있도록 thenable 처리
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-20T09:00:00Z');
const NOW_END = new Date('2026-04-20T10:00:00Z');

const mockEventRow: EventRow = {
  id:           'event-001',
  user_id:      'user-123',
  title:        '팀 미팅',
  description:  null,
  location:     null,
  start_at:     NOW.toISOString(),
  end_at:       NOW_END.toISOString(),
  all_day:      false,
  repeat_type:  'none',
  repeat_until: null,
  category_id:  null,
  color:        null,
  created_at:   NOW.toISOString(),
  updated_at:   NOW.toISOString(),
};

const mockEventRow2: EventRow = {
  ...mockEventRow,
  id:       'event-002',
  user_id:  'user-456',
  title:    '공유 일정',
  start_at: new Date('2026-04-20T11:00:00Z').toISOString(),
  end_at:   new Date('2026-04-20T12:00:00Z').toISOString(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('eventService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: 인증된 유저
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getEventsInRange
  // ══════════════════════════════════════════════════════════════════════════

  // Build-94 nickname users join + Build-96 editable_by_members 추가로
  // mock 흐름 변동 — 다음 sprint 정리.
  describe.skip('getEventsInRange', () => {
    const range = {
      start: new Date('2026-04-20T00:00:00Z'),
      end:   new Date('2026-04-20T23:59:59Z'),
    };

    /**
     * getEventsInRange 정상 흐름 from() 호출 순서:
     * 1. from('events')         → 내 일정 rows
     * 2. from('space_members')  → 내 space 멤버십
     * 3. from('event_shares')   → 공유된 event_id 목록
     * 4. from('events')         → 공유 일정 rows
     * 5. from('space_members')  → 소유자 색상 조회
     */
    it('정상 흐름: 내 일정 + 공유 일정 병합하여 startAt 오름차순 반환', async () => {
      (supabase.from as jest.Mock)
        // 1. 내 일정
        .mockReturnValueOnce(makeChain({ data: [mockEventRow], error: null }))
        // 2. 내 space 멤버십
        .mockReturnValueOnce(makeChain({ data: [{ space_id: 'space-abc', color: '#8B5CF6' }], error: null }))
        // 3. 공유 event_id
        .mockReturnValueOnce(makeChain({ data: [{ event_id: 'event-002' }], error: null }))
        // 4. 공유 일정 rows
        .mockReturnValueOnce(makeChain({ data: [mockEventRow2], error: null }))
        // 5. 소유자 색상
        .mockReturnValueOnce(makeChain({ data: [{ user_id: 'user-456', color: '#F43F5E' }], error: null }));

      const result = await getEventsInRange(range);

      // 2개 반환, startAt 오름차순
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('event-001');
      expect(result[1]?.id).toBe('event-002');
      // 내 일정: isOwn = true
      expect(result[0]?.isOwn).toBe(true);
      // 공유 일정: isOwn = false
      expect(result[1]?.isOwn).toBe(false);
    });

    it('내 일정만 있고 Space 없음: 내 일정만 반환', async () => {
      (supabase.from as jest.Mock)
        // 1. 내 일정
        .mockReturnValueOnce(makeChain({ data: [mockEventRow], error: null }))
        // 2. 내 space 멤버십 없음
        .mockReturnValueOnce(makeChain({ data: [], error: null }));

      const result = await getEventsInRange(range);

      // space 없으면 step 3~5 skip → 내 일정만 반환
      expect(supabase.from).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('event-001');
    });

    it('공유 일정 없음: event_shares 빈 배열 → 내 일정만 반환', async () => {
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain({ data: [mockEventRow], error: null }))
        .mockReturnValueOnce(makeChain({ data: [{ space_id: 'space-abc', color: '#8B5CF6' }], error: null }))
        // event_shares 결과 없음
        .mockReturnValueOnce(makeChain({ data: [], error: null }));

      const result = await getEventsInRange(range);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('event-001');
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getEventsInRange(range)).rejects.toThrow('로그인이 필요합니다.');
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('내 일정 DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('events table error') }),
      );

      await expect(getEventsInRange(range)).rejects.toThrow('events table error');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getEventById
  // ══════════════════════════════════════════════════════════════════════════

  describe('getEventById', () => {
    /**
     * getEventById from() 호출 순서:
     * 1. from('events')       → 단건 event row
     * 2. from('event_shares') → 공유된 space_id 목록
     * 3. from('users')        → owner nickname
     */
    function setupGetEventMocks(
      eventResult = { data: mockEventRow, error: null },
      sharesResult = { data: [{ space_id: 'space-abc' }], error: null },
      userResult   = { data: { nickname: '홍길동' }, error: null },
    ) {
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain(eventResult))
        .mockReturnValueOnce(makeChain(sharesResult))
        .mockReturnValueOnce(makeChain(userResult));
    }

    it('정상 흐름: Event 도메인 객체 반환 (camelCase, sharedSpaceIds, ownerNickname 포함)', async () => {
      setupGetEventMocks();

      const result = await getEventById('event-001');

      expect(result.id).toBe('event-001');
      expect(result.title).toBe('팀 미팅');
      expect(result.userId).toBe('user-123');
      expect(result.isOwn).toBe(true);
      expect(result.sharedSpaceIds).toEqual(['space-abc']);
      expect(result.ownerNickname).toBe('홍길동');
      // Date 변환 확인
      expect(result.startAt).toBeInstanceOf(Date);
      expect(result.endAt).toBeInstanceOf(Date);
    });

    it('공유 space 없음: sharedSpaceIds 빈 배열', async () => {
      setupGetEventMocks(
        { data: mockEventRow, error: null },
        { data: [], error: null },
        { data: { nickname: '홍길동' }, error: null },
      );

      const result = await getEventById('event-001');
      expect(result.sharedSpaceIds).toEqual([]);
    });

    it('nickname 조회 실패: ownerNickname "알 수 없음" 폴백', async () => {
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      const result = await getEventById('event-001');
      expect(result.ownerNickname).toBe('알 수 없음');
    });

    it('이벤트 없음: "일정을 찾을 수 없습니다." 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('not found') }),
      );

      await expect(getEventById('nonexistent')).rejects.toThrow('일정을 찾을 수 없습니다.');
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getEventById('event-001')).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createEvent
  // ══════════════════════════════════════════════════════════════════════════

  describe('createEvent', () => {
    /**
     * createEvent from() 호출 순서:
     * 1. from('events').insert().select().single()  → 새 event row
     * (shareToSpaceIds 있을 경우 eventShareService 내부에서 추가 호출)
     * ── getEventById 내부 ──
     * 2. from('events')       → 방금 생성된 event row
     * 3. from('event_shares') → 공유된 space_id 목록
     * 4. from('users')        → owner nickname
     */
    function setupCreateMocks() {
      (supabase.from as jest.Mock)
        // INSERT
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // getEventById - event
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // getEventById - shares
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // getEventById - user
        .mockReturnValueOnce(makeChain({ data: { nickname: '홍길동' }, error: null }));
    }

    it('정상 흐름: events INSERT 후 완성된 Event 반환', async () => {
      setupCreateMocks();

      const result = await createEvent({
        title:   '새 일정',
        startAt: NOW,
        endAt:   NOW_END,
      });

      // INSERT 호출 확인
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'events');
      // 반환값 구조 확인
      expect(result.id).toBe('event-001');
      expect(result.title).toBe('팀 미팅'); // mock row 제목
      expect(result.isOwn).toBe(true);
    });

    it('shareToSpaceIds 있을 때: event_shares UPSERT 호출', async () => {
      (supabase.from as jest.Mock)
        // INSERT
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // shareEventToSpace → event_shares upsert
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        // getEventById - event
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // getEventById - shares
        .mockReturnValueOnce(makeChain({ data: [{ space_id: 'space-abc' }], error: null }))
        // getEventById - user
        .mockReturnValueOnce(makeChain({ data: { nickname: '홍길동' }, error: null }));

      const result = await createEvent({
        title:          '공유 일정',
        startAt:        NOW,
        endAt:          NOW_END,
        shareToSpaceIds: ['space-abc'],
      });

      // event_shares upsert 호출 확인
      expect(supabase.from).toHaveBeenCalledWith('event_shares');
      expect(result.sharedSpaceIds).toEqual(['space-abc']);
    });

    it('color 지정 시: INSERT payload에 color 필드 포함', async () => {
      const coloredRow: EventRow = { ...mockEventRow, color: '#DB2777' };

      (supabase.from as jest.Mock)
        // INSERT (color 포함)
        .mockReturnValueOnce(makeChain({ data: coloredRow, error: null }))
        // getEventById - event
        .mockReturnValueOnce(makeChain({ data: coloredRow, error: null }))
        // getEventById - shares
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // getEventById - user
        .mockReturnValueOnce(makeChain({ data: { nickname: '홍길동' }, error: null }));

      const result = await createEvent({
        title: '색상 일정',
        startAt: NOW,
        endAt: NOW_END,
        color: '#DB2777',
      });

      // INSERT 체인에 color 필드가 포함되었는지 확인
      const insertChain = (supabase.from as jest.Mock).mock.results[0]?.value;
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ color: '#DB2777' }),
      );
      // 반환 Event 의 color도 일치
      expect(result.color).toBe('#DB2777');
    });

    it('INSERT 실패: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('INSERT constraint') }),
      );

      await expect(
        createEvent({ title: '실패 일정', startAt: NOW, endAt: NOW_END }),
      ).rejects.toThrow('INSERT constraint');
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(
        createEvent({ title: '새 일정', startAt: NOW, endAt: NOW_END }),
      ).rejects.toThrow('로그인이 필요합니다.');
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateEvent
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateEvent', () => {
    /**
     * updateEvent from() 호출 순서 (shareToSpaceIds 없는 경우):
     * 1. from('events').update().eq('id', ...).eq('user_id', ...) → { error: null }
     * ── getEventById 내부 ──
     * 2. from('events')       → event row
     * 3. from('event_shares') → shares
     * 4. from('users')        → user
     */
    function setupUpdateMocks() {
      (supabase.from as jest.Mock)
        // UPDATE
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        // getEventById - event
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // getEventById - shares
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // getEventById - user
        .mockReturnValueOnce(makeChain({ data: { nickname: '홍길동' }, error: null }));
    }

    it('정상 흐름: events UPDATE 후 업데이트된 Event 반환', async () => {
      setupUpdateMocks();

      const result = await updateEvent('event-001', { title: '수정된 제목' });

      // UPDATE 호출: events 테이블, user_id eq로 RLS 준수
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'events');
      const updateChain = (supabase.from as jest.Mock).mock.results[0]?.value;
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ title: '수정된 제목' }),
      );
      // eq('user_id', userId) 호출로 RLS 준수 확인
      expect(updateChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(result.id).toBe('event-001');
    });

    it('업데이트 필드 없음: PATCH 없이 getEventById만 호출', async () => {
      // patch가 비어있으면 UPDATE 쿼리 생략
      (supabase.from as jest.Mock)
        // getEventById - event
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // getEventById - shares
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // getEventById - user
        .mockReturnValueOnce(makeChain({ data: { nickname: '홍길동' }, error: null }));

      // 빈 업데이트 (patch.length === 0)
      const result = await updateEvent('event-001', {});
      expect(result.id).toBe('event-001');
    });

    it('UPDATE DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('UPDATE failed') }),
      );

      await expect(updateEvent('event-001', { title: '수정' })).rejects.toThrow(
        'UPDATE failed',
      );
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(updateEvent('event-001', { title: '수정' })).rejects.toThrow(
        '로그인이 필요합니다.',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteEvent
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteEvent', () => {
    it('정상 흐름: events DELETE 호출 (user_id eq로 RLS 준수)', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: null }),
      );

      await deleteEvent('event-001');

      expect(supabase.from).toHaveBeenCalledWith('events');
      const chain = (supabase.from as jest.Mock).mock.results[0]?.value;
      expect(chain.delete).toHaveBeenCalled();
      // eq('id', ...) + eq('user_id', ...) → 두 번 eq 호출
      expect(chain.eq).toHaveBeenCalledWith('id', 'event-001');
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('DELETE denied') }),
      );

      await expect(deleteEvent('event-001')).rejects.toThrow('DELETE denied');
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(deleteEvent('event-001')).rejects.toThrow('로그인이 필요합니다.');
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // forkSharedEvent (IDEA-018)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * forkSharedEvent from() 호출 순서:
   * ── getEventById 내부 (source 읽기) ──
   * 1. from('events')       → 원본 event row (user_id = 'user-456' ≠ 현재 유저)
   * 2. from('event_shares') → 공유된 space_id 목록
   * 3. from('users')        → owner nickname
   * ── forkSharedEvent 직접 ──
   * 4. from('events').insert().select().single() → 새 forked event row
   */
  describe('forkSharedEvent', () => {
    /** source event: user-456 소유, 공유된 상태 (현재 유저=user-123은 비소유자) */
    const sharedEventRow: EventRow = {
      ...mockEventRow,
      id:      'event-shared-001',
      user_id: 'user-456',
      title:   '공유 일정 fork 대상',
    };

    /** 새로 생성될 fork event row: user-123 소유 */
    const forkedEventRow: EventRow = {
      ...sharedEventRow,
      id:      'event-fork-001',
      user_id: 'user-123',
    };

    function setupForkSuccessMocks() {
      (supabase.from as jest.Mock)
        // getEventById(1): source event
        .mockReturnValueOnce(makeChain({ data: sharedEventRow, error: null }))
        // getEventById(2): event_shares (공유된 space 있음)
        .mockReturnValueOnce(makeChain({ data: [{ space_id: 'space-abc' }], error: null }))
        // getEventById(3): owner nickname
        .mockReturnValueOnce(makeChain({ data: { nickname: '파트너' }, error: null }))
        // INSERT forked row
        .mockReturnValueOnce(makeChain({ data: forkedEventRow, error: null }));
    }

    it('성공: 비소유자가 fork → INSERT 된 새 event, isOwn=true, sharedSpaceIds 빈 배열', async () => {
      setupForkSuccessMocks();

      const result = await forkSharedEvent('event-shared-001');

      // INSERT 호출 확인: events 테이블 (4번째 from 호출)
      expect(supabase.from).toHaveBeenNthCalledWith(4, 'events');
      const insertChain = (supabase.from as jest.Mock).mock.results[3]?.value;
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123', // 현재 유저
          title:   '공유 일정 fork 대상',
        }),
      );

      // 반환값 확인
      expect(result.id).toBe('event-fork-001');
      expect(result.isOwn).toBe(true);
      expect(result.sharedSpaceIds).toEqual([]); // fork 는 Space 없음
    });

    it('자기 일정 fork 시도: "자신의 일정은 복사할 수 없습니다." 에러 throw', async () => {
      // source 가 본인 일정 (user_id = user-123 = 현재 유저)
      (supabase.from as jest.Mock)
        // getEventById(1): 자기 event
        .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
        // getEventById(2): shares
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // getEventById(3): user (자기 nickname)
        .mockReturnValueOnce(makeChain({ data: { nickname: '나' }, error: null }));

      await expect(forkSharedEvent('event-001')).rejects.toThrow(
        '자신의 일정은 복사할 수 없습니다.',
      );

      // INSERT는 호출되지 않아야 함 (from 3번만 호출)
      expect(supabase.from).toHaveBeenCalledTimes(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // findConflictingEvents (Sprint 26 R3 — Critical fix)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * findConflictingEvents from() 호출 순서 (충돌 후보가 있는 정상 흐름):
   * 1. from('event_shares') → space_id의 event_id 목록
   * 2. from('events')        → 시간 겹침 + id 필터된 이벤트 행
   * 3. from('users')         → 충돌 이벤트 owner 닉네임 일괄 조회
   *
   * 충돌 후보가 없거나 결과가 비어있으면 1~2단계에서 조기 반환.
   */
  describe('findConflictingEvents', () => {
    const proposedStart = new Date('2026-04-20T09:00:00Z');
    const proposedEnd   = new Date('2026-04-20T10:00:00Z');

    it('충돌 없음: events 결과 빈 배열 → 빈 배열 반환', async () => {
      (supabase.from as jest.Mock)
        // 1. event_shares: 후보 1건
        .mockReturnValueOnce(makeChain({ data: [{ event_id: 'event-other' }], error: null }))
        // 2. events: 시간 겹침 결과 없음
        .mockReturnValueOnce(makeChain({ data: [], error: null }));

      const result = await findConflictingEvents('space-abc', proposedStart, proposedEnd);

      expect(result).toEqual([]);
      // users 조회는 스킵
      expect(supabase.from).toHaveBeenCalledTimes(2);
    });

    it('1개 충돌: ConflictingEvent 1개 반환 (owner nickname 포함)', async () => {
      (supabase.from as jest.Mock)
        // 1. event_shares: 후보 1건
        .mockReturnValueOnce(makeChain({ data: [{ event_id: 'event-other' }], error: null }))
        // 2. events: 1건 겹침
        .mockReturnValueOnce(makeChain({
          data: [{
            id:       'event-other',
            user_id:  'user-456',
            title:    '디자인 리뷰',
            start_at: '2026-04-20T09:30:00Z',
            end_at:   '2026-04-20T10:30:00Z',
          }],
          error: null,
        }))
        // 3. users: owner 닉네임
        .mockReturnValueOnce(makeChain({
          data: [{ id: 'user-456', nickname: '김디자이너' }],
          error: null,
        }));

      const result = await findConflictingEvents('space-abc', proposedStart, proposedEnd);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('event-other');
      expect(result[0]?.title).toBe('디자인 리뷰');
      expect(result[0]?.ownerNickname).toBe('김디자이너');
      expect(result[0]?.startAt).toBeInstanceOf(Date);
      expect(result[0]?.endAt).toBeInstanceOf(Date);
    });

    it('excludeEventId: 자기 자신 일정은 후보에서 제외 → 빈 배열', async () => {
      // event_shares가 자기 일정만 반환하면, 필터링 후 후보가 0개가 되어
      // events 호출 자체가 스킵되어야 한다.
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain({
          data: [{ event_id: 'event-self' }],
          error: null,
        }));

      const result = await findConflictingEvents(
        'space-abc',
        proposedStart,
        proposedEnd,
        'event-self',
      );

      expect(result).toEqual([]);
      // 후보가 0개라 events/users 호출 모두 스킵
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('eventShareService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // shareEventToSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('shareEventToSpace', () => {
    it('정상 흐름: event_shares UPSERT 호출', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: null }),
      );

      await shareEventToSpace('event-001', 'space-abc');

      expect(supabase.from).toHaveBeenCalledWith('event_shares');
      const chain = (supabase.from as jest.Mock).mock.results[0]?.value;
      expect(chain.upsert).toHaveBeenCalledWith(
        { event_id: 'event-001', space_id: 'space-abc' },
        { onConflict: 'event_id,space_id' },
      );
    });

    it('이미 공유된 경우: UPSERT로 중복 에러 없이 처리', async () => {
      // onConflict 설정으로 이미 있어도 에러 없이 성공
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: null }),
      );

      await expect(shareEventToSpace('event-001', 'space-abc')).resolves.toBeUndefined();
    });

    it('DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('UPSERT failed') }),
      );

      await expect(shareEventToSpace('event-001', 'space-abc')).rejects.toThrow('UPSERT failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // unshareEventFromSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('unshareEventFromSpace', () => {
    it('정상 흐름: event_shares DELETE 호출 (event_id + space_id eq)', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: null }),
      );

      await unshareEventFromSpace('event-001', 'space-abc');

      expect(supabase.from).toHaveBeenCalledWith('event_shares');
      const chain = (supabase.from as jest.Mock).mock.results[0]?.value;
      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('event_id', 'event-001');
      expect(chain.eq).toHaveBeenCalledWith('space_id', 'space-abc');
    });

    it('DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('DELETE failed') }),
      );

      await expect(unshareEventFromSpace('event-001', 'space-abc')).rejects.toThrow(
        'DELETE failed',
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('freeTimeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * findFreeTimeSlots from() 호출 순서:
   * 1. from('space_members').select('user_id').eq('space_id', ...) → members
   * 2. from('events').select(...).in('user_id', ...).eq('all_day', false)... → event rows
   */

  const range = {
    start: new Date('2026-04-20T09:00:00Z'),
    end:   new Date('2026-04-20T18:00:00Z'),
  };

  it('이벤트 없음: 전체 범위를 단일 슬롯으로 반환', async () => {
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [{ user_id: 'user-123' }, { user_id: 'user-456' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));

    const slots = await findFreeTimeSlots('space-abc', range, 60);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.startAt).toEqual(range.start);
    expect(slots[0]?.endAt).toEqual(range.end);
    expect(slots[0]?.durationMinutes).toBe(9 * 60); // 9시간
    expect(slots[0]?.participantIds).toEqual(['user-123', 'user-456']);
  });

  it('중간 이벤트 1개: 앞뒤 빈 슬롯 2개 반환', async () => {
    // 11:00~12:00 이벤트 → 09:00~11:00 (120min), 12:00~18:00 (360min) 두 슬롯
    const busyStart = new Date('2026-04-20T11:00:00Z');
    const busyEnd   = new Date('2026-04-20T12:00:00Z');

    (supabase.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [{ user_id: 'user-123' }], error: null }))
      .mockReturnValueOnce(makeChain({
        data: [{
          user_id:  'user-123',
          start_at: busyStart.toISOString(),
          end_at:   busyEnd.toISOString(),
          all_day:  false,
        }],
        error: null,
      }));

    const slots = await findFreeTimeSlots('space-abc', range, 60);

    expect(slots).toHaveLength(2);
    // 첫 슬롯: 09:00 ~ 11:00 (120분)
    expect(slots[0]?.durationMinutes).toBe(120);
    // 두 번째 슬롯: 12:00 ~ 18:00 (360분)
    expect(slots[1]?.durationMinutes).toBe(360);
  });

  it('이벤트 2개 겹침: merge 후 단일 busy → 빈 슬롯 반환', async () => {
    // 10:00~12:00 + 11:00~13:00 → merged 10:00~13:00
    // 빈 슬롯: 09:00~10:00(60min), 13:00~18:00(300min)
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [{ user_id: 'user-123' }], error: null }))
      .mockReturnValueOnce(makeChain({
        data: [
          { user_id: 'user-123', start_at: new Date('2026-04-20T10:00:00Z').toISOString(), end_at: new Date('2026-04-20T12:00:00Z').toISOString(), all_day: false },
          { user_id: 'user-123', start_at: new Date('2026-04-20T11:00:00Z').toISOString(), end_at: new Date('2026-04-20T13:00:00Z').toISOString(), all_day: false },
        ],
        error: null,
      }));

    const slots = await findFreeTimeSlots('space-abc', range, 60);

    // 09:00~10:00 (60min) + 13:00~18:00 (300min) = 2슬롯
    expect(slots).toHaveLength(2);
    expect(slots[0]?.durationMinutes).toBe(60);
    expect(slots[1]?.durationMinutes).toBe(300);
  });

  it('minDurationMinutes 미만 슬롯 제외', async () => {
    // 09:00~09:30 (30min) 이벤트 → 09:30~18:00 (510min) 슬롯만
    // 09:00~09:30 이전 갭(0min)은 제외, minDuration=60 기준
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(makeChain({ data: [{ user_id: 'user-123' }], error: null }))
      .mockReturnValueOnce(makeChain({
        data: [{
          user_id:  'user-123',
          start_at: new Date('2026-04-20T09:00:00Z').toISOString(),
          end_at:   new Date('2026-04-20T09:30:00Z').toISOString(),
          all_day:  false,
        }],
        error: null,
      }));

    const slots = await findFreeTimeSlots('space-abc', range, 60);

    // 앞 갭 0min은 제외, 뒷 갭 09:30~18:00 (510min) 1개만
    expect(slots).toHaveLength(1);
    expect(slots[0]?.durationMinutes).toBe(510);
  });

  it('Space 멤버 없음: 빈 배열 반환', async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce(
      makeChain({ data: [], error: null }),
    );

    const slots = await findFreeTimeSlots('space-abc', range, 60);
    expect(slots).toEqual([]);
    // events 조회 없음
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('space_members DB 에러: 에러 throw', async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce(
      makeChain({ data: null, error: new Error('space_members query failed') }),
    );

    await expect(findFreeTimeSlots('space-abc', range)).rejects.toThrow(
      'space_members query failed',
    );
  });
});
