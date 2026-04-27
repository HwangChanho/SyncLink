/**
 * __tests__/services/spaceService.leave.test.ts
 *
 * TASK-612: Space Leave + deleteAccount 테스트 스위트
 *
 * Sprint 27 R1 — IDEA-011 Phase A 추가 커버리지:
 *  leaveSpace — 본인이 만든 events 의 event_shares 행이 이 Space 한정으로 삭제됨
 *  leaveSpace — 본인 events 가 0개면 event_shares DELETE 자체를 생략
 *  leaveSpace — events 조회 실패 시 에러 throw, 멤버십 삭제 안 함
 *  leaveSpace — event_shares 삭제 실패 시 에러 throw, 멤버십 삭제 안 함
 *
 * 기존 커버리지:
 *  leaveSpace — 일반 member 탈퇴 → space_members DELETE 호출
 *  leaveSpace — owner 탈퇴 + 다른 멤버 있음 → 소유권 이전 후 DELETE
 *  leaveSpace — 마지막 멤버 탈퇴 → space_members DELETE + spaces DELETE
 *  leaveSpace — 멤버가 아닌 사용자 → "해당 Space의 멤버가 아닙니다." 에러 throw
 *  leaveSpace — 미인증 → "로그인이 필요합니다." 에러 throw
 *  leaveSpace — 멤버 조회 DB 에러 → 에러 throw
 *  leaveSpace — DELETE 에러 → 에러 throw
 *
 * deleteAccount 관련 케이스는 authService.test.ts 에 이미 포함되어 있으므로
 * 여기서는 leaveSpace에만 집중합니다.
 *
 * Mock 전략:
 *  - TDZ-safe 팩토리 패턴: jest.mock 내부에서 chain/fromFn 생성 후 __참조 export
 *  - makeChain(): thenable + .single() dual-mode 체인 빌더
 *  - 복수 from() 호출은 mockReturnValueOnce 체이닝으로 순서 보장
 *
 * leaveSpace 호출 순서 (Sprint 27 R1 갱신):
 *   1) from('space_members') SELECT - 멤버 전체 조회
 *   2) from('events')        SELECT - 본인 events.id 목록
 *   3) from('event_shares')  DELETE - (본인 일정 ≥ 1개일 때만)
 *   4) from('space_members') UPDATE - (owner 탈퇴 시만) 소유권 이전
 *   5) from('space_members') DELETE - 본인 멤버십 제거
 *   6) from('spaces')        DELETE - (마지막 멤버였을 때만) Space 삭제
 *
 * @task TASK-612
 * @sprint 27 R1 — IDEA-011 Phase A
 */

// ─── Mock 선언 (TDZ-safe) ─────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => {
  const chain: Record<string, jest.Mock> = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    neq:         jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    single:      jest.fn(),
    maybeSingle: jest.fn(),
  };

  const fromFn = jest.fn().mockReturnValue(chain);

  return {
    supabase: { from: fromFn },
    getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
    __chain:  chain,
    __fromFn: fromFn,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getCurrentUserId } from '@/lib/supabase';
import { leaveSpace } from '@/services/spaceService';
import type { SpaceMemberRow } from '@/types';

// ─── Mock 참조 추출 ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __fromFn: fromFn } = require('@/lib/supabase') as any;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인의 dual-mode thenable mock 생성.
 * await chain     → resolvedValue (non-single 쿼리, 예: order → thenable)
 * await chain.single() → resolvedValue
 */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ch: any = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    neq:         jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(resolvedValue),
    maybeSingle: jest.fn().mockResolvedValue(resolvedValue),
    then:  promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return ch;
}

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

/** 현재 로그인 유저 (user-123)의 일반 member 행 */
const myMemberRow: SpaceMemberRow = {
  id:        'member-row-001',
  space_id:  'space-001',
  user_id:   'user-123',
  role:      'member',
  color:     '#8B5CF6',
  joined_at: new Date('2026-01-10').toISOString(),
};

/** 다른 유저의 member 행 */
const otherMemberRow: SpaceMemberRow = {
  id:        'member-row-002',
  space_id:  'space-001',
  user_id:   'other-user-456',
  role:      'member',
  color:     '#FB7185',
  joined_at: new Date('2026-01-11').toISOString(),
};

/** 현재 로그인 유저 (user-123)의 owner 행 */
const myOwnerRow: SpaceMemberRow = {
  ...myMemberRow,
  role: 'owner',
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('spaceService — leaveSpace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
    fromFn.mockReturnValue(makeChain({ data: null, error: null }));
  });

  // ════════════════════════════════════════════════════════════════════════
  // 일반 탈퇴 (member role)
  // ════════════════════════════════════════════════════════════════════════

  describe('일반 member 탈퇴', () => {
    it('space_members에서 DELETE 호출 확인 (eq id 조건)', async () => {
      // leaveSpace 내부 호출 순서 (Sprint 27 R1 IDEA-011-A 적용 후):
      //   1) from('space_members') SELECT — 멤버 조회
      //   2) from('events')        SELECT — 본인 events.id (여기선 빈 배열 → 다음 단계 생략)
      //   3) from('space_members') DELETE — 내 행 삭제
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const deleteChain = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)  // 멤버 조회
        .mockReturnValueOnce(myEventsChain)       // 본인 events 조회 (빈 결과)
        .mockReturnValueOnce(deleteChain);        // 내 행 삭제

      await leaveSpace('space-001');

      // DELETE가 올바른 테이블에 호출되었는지 확인
      expect(fromFn).toHaveBeenCalledWith('space_members');
      expect(deleteChain.delete).toHaveBeenCalled();
      expect(deleteChain.eq).toHaveBeenCalledWith('id', myMemberRow.id);
    });

    it('탈퇴 후 다른 멤버가 남아있으면 spaces DELETE 미호출', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const deleteChain = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(deleteChain);

      await leaveSpace('space-001');

      // from() 호출 횟수: 멤버 조회(1) + events 조회(1) + 멤버 삭제(1) = 3회
      // spaces DELETE 발생 시 4회 → 3회여야 함
      expect(fromFn).toHaveBeenCalledTimes(3);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // owner 탈퇴 — 소유권 이전
  // ════════════════════════════════════════════════════════════════════════

  describe('owner 탈퇴 — 소유권 이전', () => {
    it('owner이고 다른 멤버 있음 → 소유권 이전 UPDATE 후 내 행 DELETE', async () => {
      // 멤버 목록: owner(user-123), member(other-user-456)
      // joined_at 기준 ASC 정렬이므로 otherMemberRow가 "다음 owner" 대상
      const membersFetchChain = makeChain({
        data: [myOwnerRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const updateChain = makeChain({ data: null, error: null });  // 소유권 이전
      const deleteChain = makeChain({ data: null, error: null });  // 내 행 삭제

      fromFn
        .mockReturnValueOnce(membersFetchChain)  // 멤버 조회
        .mockReturnValueOnce(myEventsChain)       // 본인 events 조회
        .mockReturnValueOnce(updateChain)         // UPDATE role='owner'
        .mockReturnValueOnce(deleteChain);        // DELETE 내 행

      await leaveSpace('space-001');

      // 소유권 이전 UPDATE 검증
      expect(updateChain.update).toHaveBeenCalledWith({ role: 'owner' });
      expect(updateChain.eq).toHaveBeenCalledWith('id', otherMemberRow.id);

      // 내 멤버십 삭제 검증
      expect(deleteChain.delete).toHaveBeenCalled();
      expect(deleteChain.eq).toHaveBeenCalledWith('id', myOwnerRow.id);
    });

    it('소유권 이전 UPDATE 에러 → 에러 throw, DELETE 미호출', async () => {
      const membersFetchChain = makeChain({
        data: [myOwnerRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const updateError = new Error('update failed');
      const updateChain = makeChain({ data: null, error: updateError });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(updateChain);

      await expect(leaveSpace('space-001')).rejects.toThrow('update failed');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 마지막 멤버 탈퇴 — Space 자동 삭제
  // ════════════════════════════════════════════════════════════════════════

  describe('마지막 멤버 탈퇴 — Space 삭제', () => {
    it('마지막 멤버 탈퇴 시 space_members DELETE + spaces DELETE 모두 호출', async () => {
      // 본인만 있는 멤버 목록
      const membersFetchChain = makeChain({
        data: [myMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const memberDeleteChain = makeChain({ data: null, error: null });
      const spaceDeleteChain  = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)   // 멤버 조회
        .mockReturnValueOnce(myEventsChain)        // 본인 events 조회 (빈 결과)
        .mockReturnValueOnce(memberDeleteChain)   // 내 행 삭제
        .mockReturnValueOnce(spaceDeleteChain);   // Space 삭제

      await leaveSpace('space-001');

      // Space 삭제 검증 (from('spaces').delete().eq('id', ...))
      expect(fromFn).toHaveBeenCalledWith('spaces');
      expect(spaceDeleteChain.delete).toHaveBeenCalled();
      expect(spaceDeleteChain.eq).toHaveBeenCalledWith('id', 'space-001');
    });

    it('Space 삭제 DB 에러 → 에러 throw', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const memberDeleteChain = makeChain({ data: null, error: null });
      const spaceDeleteChain  = makeChain({
        data:  null,
        error: new Error('space delete failed'),
      });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(memberDeleteChain)
        .mockReturnValueOnce(spaceDeleteChain);

      await expect(leaveSpace('space-001')).rejects.toThrow('space delete failed');
    });

    it('owner이고 마지막 멤버 → 소유권 이전 생략, 바로 Space 삭제', async () => {
      // owner이지만 다른 멤버가 없음 → 소유권 이전 로직 생략
      const membersFetchChain = makeChain({
        data: [myOwnerRow],  // owner만 있음
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const memberDeleteChain = makeChain({ data: null, error: null });
      const spaceDeleteChain  = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(memberDeleteChain)
        .mockReturnValueOnce(spaceDeleteChain);

      await leaveSpace('space-001');

      // UPDATE(소유권 이전) 없이 from이 4번만 호출되어야 함
      // 멤버 조회(1) + events 조회(1) + 멤버 삭제(1) + Space 삭제(1) = 4
      expect(fromFn).toHaveBeenCalledTimes(4);
      // spaces 테이블이 대상인 삭제 확인
      expect(fromFn).toHaveBeenCalledWith('spaces');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // IDEA-011 Phase A — 본인 공유 일정 정리
  // ════════════════════════════════════════════════════════════════════════

  describe('IDEA-011-A — 본인 공유 일정 정리 (event_shares)', () => {
    /**
     * 본인이 만든 events 가 있는 경우, leaveSpace 는 다음 두 가지를
     * 추가로 수행해야 한다:
     *  - events SELECT id WHERE user_id=me
     *  - event_shares DELETE WHERE space_id=X AND event_id IN (id 목록)
     *
     * 그 후에야 멤버십 DELETE 가 진행된다. 멤버십 DELETE 가 먼저 일어나면
     * RLS 가 본인 events / event_shares 접근권을 박탈할 수 있어 잔존
     * 공유가 영구적으로 남는 부조리를 유발하기 때문이다.
     */
    it('본인 events 가 있으면 event_shares DELETE 호출 (space_id + event_id IN 조건)', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      // 본인 일정 2개
      const myEventsChain = makeChain({
        data: [{ id: 'evt-1' }, { id: 'evt-2' }],
        error: null,
      });
      const sharesDeleteChain = makeChain({ data: null, error: null });
      const memberDeleteChain = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)   // 1) space_members SELECT
        .mockReturnValueOnce(myEventsChain)        // 2) events SELECT
        .mockReturnValueOnce(sharesDeleteChain)    // 3) event_shares DELETE
        .mockReturnValueOnce(memberDeleteChain);   // 4) space_members DELETE

      await leaveSpace('space-001');

      // event_shares 테이블 호출 검증
      expect(fromFn).toHaveBeenCalledWith('event_shares');
      expect(sharesDeleteChain.delete).toHaveBeenCalled();
      // 이 Space 한정으로 좁힘
      expect(sharesDeleteChain.eq).toHaveBeenCalledWith('space_id', 'space-001');
      // 본인 events.id 만 대상
      expect(sharesDeleteChain.in).toHaveBeenCalledWith('event_id', ['evt-1', 'evt-2']);
    });

    it('본인 events 가 0개면 event_shares DELETE 호출 자체를 생략', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const memberDeleteChain = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(memberDeleteChain);

      await leaveSpace('space-001');

      // event_shares 테이블 호출이 없어야 함 (불필요한 빈 IN 절 방지)
      expect(fromFn).not.toHaveBeenCalledWith('event_shares');
    });

    it('events 조회 실패 → 에러 throw, 멤버십 DELETE 미호출', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({
        data: null,
        error: new Error('events SELECT failed'),
      });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain);

      await expect(leaveSpace('space-001')).rejects.toThrow('events SELECT failed');
      // 멤버십이 살아있어야 함 — events 조회 실패 시 일관성 우선 보존
      expect(fromFn).not.toHaveBeenCalledWith('spaces');
    });

    it('event_shares DELETE 실패 → 에러 throw, 멤버십 DELETE 미호출', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({
        data: [{ id: 'evt-1' }],
        error: null,
      });
      const sharesDeleteChain = makeChain({
        data: null,
        error: new Error('event_shares DELETE blocked by RLS'),
      });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(sharesDeleteChain);

      await expect(leaveSpace('space-001')).rejects.toThrow(
        'event_shares DELETE blocked by RLS',
      );
      // 잔존 공유 정리 실패 → 멤버십도 그대로 유지
      expect(fromFn).not.toHaveBeenCalledWith('spaces');
    });

    it('owner 탈퇴 + 본인 일정 있음 → events 정리가 소유권 이전보다 먼저 일어남', async () => {
      // 호출 순서: members → events → event_shares → UPDATE(owner 이전) → DELETE(내 행)
      const membersFetchChain = makeChain({
        data: [myOwnerRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({
        data: [{ id: 'evt-9' }],
        error: null,
      });
      const sharesDeleteChain = makeChain({ data: null, error: null });
      const updateChain = makeChain({ data: null, error: null });
      const memberDeleteChain = makeChain({ data: null, error: null });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(sharesDeleteChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(memberDeleteChain);

      await leaveSpace('space-001');

      // 호출 순서 검증: from() 의 mock.calls 순서로 비교
      const callTables = fromFn.mock.calls.map((c: unknown[]) => c[0]);
      expect(callTables).toEqual([
        'space_members',  // 1) 멤버 조회
        'events',         // 2) 본인 일정 조회
        'event_shares',   // 3) 공유 정리
        'space_members',  // 4) 소유권 이전
        'space_members',  // 5) 본인 멤버십 삭제
      ]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 에러 케이스
  // ════════════════════════════════════════════════════════════════════════

  describe('에러 케이스', () => {
    it('미인증 → "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(leaveSpace('space-001')).rejects.toThrow('로그인이 필요합니다.');
    });

    it('멤버 조회 DB 에러 → 에러 throw', async () => {
      fromFn.mockReturnValueOnce(
        makeChain({ data: null, error: new Error('DB connection timeout') }),
      );

      await expect(leaveSpace('space-001')).rejects.toThrow('DB connection timeout');
    });

    it('멤버가 아닌 사용자 탈퇴 시도 → "해당 Space의 멤버가 아닙니다." 에러 throw', async () => {
      // 멤버 목록에 user-123이 없음
      const otherUsersOnly = [otherMemberRow];
      fromFn.mockReturnValueOnce(makeChain({ data: otherUsersOnly, error: null }));

      await expect(leaveSpace('space-001')).rejects.toThrow(
        '해당 Space의 멤버가 아닙니다.',
      );
    });

    it('빈 멤버 목록 → "해당 Space의 멤버가 아닙니다." 에러 throw', async () => {
      fromFn.mockReturnValueOnce(makeChain({ data: [], error: null }));

      await expect(leaveSpace('space-001')).rejects.toThrow(
        '해당 Space의 멤버가 아닙니다.',
      );
    });

    it('멤버 DELETE 에러 → 에러 throw', async () => {
      const membersFetchChain = makeChain({
        data: [myMemberRow, otherMemberRow],
        error: null,
      });
      const myEventsChain = makeChain({ data: [], error: null });
      const deleteError = new Error('RLS policy violation');
      const deleteChain = makeChain({ data: null, error: deleteError });

      fromFn
        .mockReturnValueOnce(membersFetchChain)
        .mockReturnValueOnce(myEventsChain)
        .mockReturnValueOnce(deleteChain);

      await expect(leaveSpace('space-001')).rejects.toThrow('RLS policy violation');
    });
  });
});
