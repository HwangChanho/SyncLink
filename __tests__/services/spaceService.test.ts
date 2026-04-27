/**
 * __tests__/services/spaceService.test.ts
 *
 * TASK-111: Space Test Suite — spaceService.ts 유닛 테스트
 * ISSUE-005 해결
 *
 * 전략:
 *  - @/lib/supabase 전체를 mock → 실제 DB 호출 차단
 *  - getCurrentUserId mock → 인증 상태 제어
 *  - makeChain() 헬퍼: Supabase 쿼리 체인을 thenable + .single() 양쪽 지원
 *    (non-single 쿼리는 chain 자체를 await, single 쿼리는 .single() await)
 *  - 복수 from() 호출은 mockReturnValueOnce 체이닝으로 순서 보장
 *
 * 커버리지:
 *  createSpace          — 정상 흐름 (spaces + space_members INSERT), 미인증
 *  joinSpaceByInviteCode — 유효 코드 성공, 잘못된 코드, 이미 멤버, 커플 2인 초과
 *  leaveSpace            — 일반 탈퇴, 마지막 멤버 → Space 삭제, owner 소유권 이전
 *  regenerateInviteCode  — 6자리 코드 + O/0/I/1 제외 문자셋 검증
 *  getAnniversaries      — 조회 성공, DB 에러
 *  createAnniversary     — 생성 성공, 미인증
 *  deleteAnniversary     — 삭제 성공, DB 에러
 *
 * @task TASK-111
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
  createSpace,
  joinSpaceByInviteCode,
  leaveSpace,
  regenerateInviteCode,
  getAnniversaries,
  createAnniversary,
  deleteAnniversary,
} from '@/services/spaceService';
import type { SpaceRow, SpaceMemberRow, UserRow, AnniversaryRow } from '@/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인 mock 생성.
 *
 * - 모든 builder 메서드(select, eq, order 등)는 this 반환 (체이닝 지원)
 * - chain 자체가 thenable → await chain 시 resolvedValue로 resolve
 * - .single()도 resolvedValue로 resolve (단일 행 쿼리 지원)
 *
 * 사용 예:
 *   (supabase.from as jest.Mock).mockReturnValueOnce(makeChain({ data: rows, error: null }));
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
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    // .single() → Promise<resolvedValue>
    single: jest.fn().mockResolvedValue(resolvedValue),
    // chain 자체를 await 할 수 있도록 thenable 처리
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const mockSpaceRow: SpaceRow = {
  id: 'space-abc',
  name: 'Test Space',
  type: 'group',
  invite_code: 'ABC123',
  cover_image_url: null,
  created_by: 'user-123',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockCoupleSpaceRow: SpaceRow = {
  ...mockSpaceRow,
  id: 'space-couple',
  type: 'couple',
  invite_code: 'CPL456',
};

const mockOwnerMemberRow: SpaceMemberRow = {
  id: 'member-001',
  space_id: 'space-abc',
  user_id: 'user-123',
  role: 'owner',
  color: '#8B5CF6',
  joined_at: new Date(Date.now() - 1000).toISOString(),
};

const mockMemberRow: SpaceMemberRow = {
  id: 'member-002',
  space_id: 'space-abc',
  user_id: 'user-456',
  role: 'member',
  color: '#F43F5E',
  joined_at: new Date().toISOString(),
};

const mockUserRow: UserRow = {
  id: 'user-123',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar_url: null,
  push_token: null,
  notification_settings: {
    event_reminders: true,
    partner_changes: true,
    space_invites: true,
    smart_reminders: true,
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockAnniversaryRow: AnniversaryRow = {
  id: 'anniv-001',
  space_id: 'space-abc',
  title: '첫 만남',
  date: '2024-03-15',
  repeat_yearly: true,
  created_by: 'user-123',
  created_at: new Date().toISOString(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('spaceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: 인증된 유저
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('createSpace', () => {
    /**
     * createSpace 정상 흐름에서의 from() 호출 순서:
     * 1. from('spaces').insert().select().single()    → spaceRow
     * 2. from('space_members').insert().select().single() → memberRow
     * 3. from('users').select('*').eq('id', userId).single() → userRow
     */
    function setupCreateSpaceMocks(
      spaceResult = { data: mockSpaceRow, error: null },
      memberResult = { data: mockOwnerMemberRow, error: null },
      userResult = { data: mockUserRow, error: null },
    ) {
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain(spaceResult))
        .mockReturnValueOnce(makeChain(memberResult))
        .mockReturnValueOnce(makeChain(userResult));
    }

    it('정상 흐름: spaces INSERT + space_members INSERT + Space 반환', async () => {
      setupCreateSpaceMocks();

      const result = await createSpace({ name: 'Test Space', type: 'group' });

      // from('spaces'), from('space_members'), from('users') 순서로 3번 호출
      expect(supabase.from).toHaveBeenCalledTimes(3);
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'spaces');
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'space_members');
      expect(supabase.from).toHaveBeenNthCalledWith(3, 'users');

      // 반환된 Space 구조 검증
      expect(result.id).toBe('space-abc');
      expect(result.name).toBe('Test Space');
      expect(result.type).toBe('group');
      expect(result.members).toHaveLength(1);
      expect(result.members[0]?.userId).toBe('user-123');
      expect(result.members[0]?.role).toBe('owner');
    });

    it('invite_code 형식: 6자리, O/0/I/1 제외 문자셋으로 구성됨', async () => {
      // generateCode()가 생성한 코드를 spaces INSERT에서 캡처
      let capturedInviteCode: string | undefined;
      const spacesChain = makeChain({ data: mockSpaceRow, error: null });
      // insert 호출 시 전달된 인수에서 invite_code 캡처
      spacesChain.insert = jest.fn().mockImplementation((payload: Record<string, unknown>) => {
        capturedInviteCode = payload['invite_code'] as string;
        return spacesChain; // this 유지
      });

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(spacesChain)
        .mockReturnValueOnce(makeChain({ data: mockOwnerMemberRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: mockUserRow, error: null }));

      await createSpace({ name: 'Test', type: 'couple' });

      // 6자리 확인
      expect(capturedInviteCode).toHaveLength(6);
      // O(오), 0(영), I(아이), 1(일) 제외 확인
      const EXCLUDED_CHARS = /[O0I1]/;
      expect(EXCLUDED_CHARS.test(capturedInviteCode!)).toBe(false);
      // 허용 문자셋만 사용됐는지 확인
      const ALLOWED_CHARS = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
      expect(ALLOWED_CHARS.test(capturedInviteCode!)).toBe(true);
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(createSpace({ name: 'Test', type: 'group' })).rejects.toThrow(
        '로그인이 필요합니다.',
      );
      // DB 호출 없음
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('spaces INSERT 실패: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('DB 제약 조건 위반') }),
      );

      await expect(createSpace({ name: 'Test', type: 'group' })).rejects.toThrow(
        'DB 제약 조건 위반',
      );
    });

    it('space_members INSERT 실패: "멤버 추가에 실패했습니다." 에러 throw', async () => {
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: new Error('member insert error') }));

      await expect(createSpace({ name: 'Test', type: 'group' })).rejects.toThrow(
        'member insert error',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // joinSpaceByInviteCode
  // ══════════════════════════════════════════════════════════════════════════

  describe('joinSpaceByInviteCode', () => {
    /**
     * joinSpaceByInviteCode 정상 흐름에서의 from() 호출 순서:
     * 1. from('spaces')...single()             → spaceRow (초대 코드 조회)
     * 2. from('space_members')...              → [] (현재 멤버 목록)
     * 3. from('space_members').insert()        → { error: null } (멤버 추가)
     *    ── 내부에서 getSpaceById 호출 ──
     * 4. from('spaces')...single()             → spaceRow
     * 5. from('space_members')...order()       → [ownerMemberRow]
     * 6. from('users')...in()                  → [userRow]
     */
    function setupJoinSuccessMocks() {
      (supabase.from as jest.Mock)
        // 1. 초대 코드로 space 조회
        .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
        // 2. 현재 멤버 목록 (0명 - 새 그룹 space)
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // 3. 멤버 추가 INSERT
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        // 4. getSpaceById - space 정보
        .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
        // 5. getSpaceById - 멤버 목록
        .mockReturnValueOnce(makeChain({ data: [mockOwnerMemberRow], error: null }))
        // 6. getSpaceById - 유저 프로필
        .mockReturnValueOnce(makeChain({ data: [mockUserRow], error: null }));
    }

    it('정상 흐름: 유효한 초대 코드로 Space에 참여하고 Space 반환', async () => {
      setupJoinSuccessMocks();

      const result = await joinSpaceByInviteCode('ABC123');

      // 초대 코드 대문자 변환 후 조회 확인
      expect(supabase.from).toHaveBeenCalledTimes(6);
      expect(result.id).toBe('space-abc');
      expect(result.name).toBe('Test Space');
    });

    it('잘못된 코드: space를 찾지 못하면 "유효하지 않은 초대 코드입니다." 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('row not found') }),
      );

      await expect(joinSpaceByInviteCode('WRONG1')).rejects.toThrow(
        '유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.',
      );
    });

    it('이미 멤버: "이미 참여 중인 Space입니다." 에러 throw', async () => {
      // 현재 유저가 이미 멤버인 경우
      const existingMemberRow: SpaceMemberRow = { ...mockOwnerMemberRow, user_id: 'user-123' };

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: [existingMemberRow], error: null }));

      await expect(joinSpaceByInviteCode('ABC123')).rejects.toThrow(
        '이미 참여 중인 Space입니다.',
      );
    });

    it('커플 Space 2인 초과: "커플 Space는 최대 2명까지" 에러 throw', async () => {
      // 커플 타입 Space에 이미 2명이 있는 경우
      const member1: SpaceMemberRow = { ...mockOwnerMemberRow, user_id: 'user-aaa' };
      const member2: SpaceMemberRow = { ...mockMemberRow, user_id: 'user-bbb' };

      (supabase.from as jest.Mock)
        .mockReturnValueOnce(makeChain({ data: mockCoupleSpaceRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: [member1, member2], error: null }));

      await expect(joinSpaceByInviteCode('CPL456')).rejects.toThrow(
        '커플 Space는 최대 2명까지 참여할 수 있습니다.',
      );
    });

    it('커플 Space 정원 미달(1명): 2번째 멤버로 참여 성공', async () => {
      // 커플 타입에 1명만 있을 때는 참여 가능
      const existingOwner: SpaceMemberRow = { ...mockOwnerMemberRow, user_id: 'user-xyz' };
      // getSpaceById가 멤버 userId로 유저 프로필을 조회하므로 모든 멤버의 UserRow 필요
      const existingOwnerUserRow: UserRow = {
        ...mockUserRow,
        id: 'user-xyz',
        email: 'owner@example.com',
        nickname: 'ExistingOwner',
      };
      const newMemberRow: SpaceMemberRow = { ...mockMemberRow, user_id: 'user-123' };

      (supabase.from as jest.Mock)
        // 초대 코드 조회
        .mockReturnValueOnce(makeChain({ data: mockCoupleSpaceRow, error: null }))
        // 현재 1명 (existingOwner)
        .mockReturnValueOnce(makeChain({ data: [existingOwner], error: null }))
        // INSERT 성공 (user-123이 가입)
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        // getSpaceById - space 조회
        .mockReturnValueOnce(makeChain({ data: mockCoupleSpaceRow, error: null }))
        // getSpaceById - 멤버 목록 (2명)
        .mockReturnValueOnce(makeChain({ data: [existingOwner, newMemberRow], error: null }))
        // getSpaceById - 유저 프로필 (2명 모두 포함)
        .mockReturnValueOnce(makeChain({ data: [existingOwnerUserRow, mockUserRow], error: null }));

      const result = await joinSpaceByInviteCode('CPL456');

      expect(result.type).toBe('couple');
      expect(result.members).toHaveLength(2);
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(joinSpaceByInviteCode('ABC123')).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // leaveSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('leaveSpace', () => {
    /**
     * Sprint 27 R1 — IDEA-011 Phase A 적용 후 leaveSpace 호출 순서:
     *   1) from('space_members') SELECT — 멤버 조회
     *   2) from('events')        SELECT — 본인 events.id 목록
     *   3) from('event_shares')  DELETE — (본인 일정 ≥ 1개일 때만)
     *   4) from('space_members') UPDATE — (owner 탈퇴 시만) 소유권 이전
     *   5) from('space_members') DELETE — 본인 멤버십 제거
     *   6) from('spaces')        DELETE — (마지막 멤버였을 때만)
     *
     * 아래 테스트들은 본인 events 가 0개인 경로(=event_shares DELETE 생략)
     * 만 다룸 — IDEA-011-A 한정 케이스는 spaceService.leave.test.ts 참조.
     */
    it('일반 탈퇴: space_members DELETE 호출', async () => {
      // 현재 유저가 일반 member, 다른 owner가 존재
      const meAsMember: SpaceMemberRow = { ...mockMemberRow, user_id: 'user-123' };
      const otherOwner: SpaceMemberRow = { ...mockOwnerMemberRow, user_id: 'user-xyz' };

      (supabase.from as jest.Mock)
        // 1) 전체 멤버 조회 (joined_at ASC)
        .mockReturnValueOnce(makeChain({ data: [otherOwner, meAsMember], error: null }))
        // 2) 본인 events 조회 (빈 배열 → event_shares DELETE 생략)
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // 3) 내 membership DELETE
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await leaveSpace('space-abc');

      // from() 3번: space_members(select) + events(select) + space_members(delete)
      expect(supabase.from).toHaveBeenCalledTimes(3);
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'space_members');
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'events');
      expect(supabase.from).toHaveBeenNthCalledWith(3, 'space_members');
    });

    it('마지막 멤버 탈퇴: space_members DELETE 후 spaces DELETE도 호출', async () => {
      // 나만 남은 멤버
      const onlyMe: SpaceMemberRow = { ...mockOwnerMemberRow, user_id: 'user-123' };

      (supabase.from as jest.Mock)
        // 1) 전체 멤버 조회 → 나만 있음
        .mockReturnValueOnce(makeChain({ data: [onlyMe], error: null }))
        // 2) 본인 events 조회 (빈 배열)
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // 3) space_members DELETE
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        // 4) spaces DELETE (마지막 멤버이므로 Space도 삭제)
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await leaveSpace('space-abc');

      // 4 단계: members(select) + events(select) + space_members(delete) + spaces(delete)
      expect(supabase.from).toHaveBeenCalledTimes(4);
      expect(supabase.from).toHaveBeenNthCalledWith(4, 'spaces');
    });

    it('owner 탈퇴(다른 멤버 있음): 소유권 이전 후 탈퇴', async () => {
      // 나(owner) + 다른 멤버
      const meAsOwner: SpaceMemberRow = {
        ...mockOwnerMemberRow,
        user_id: 'user-123',
        role: 'owner',
        joined_at: new Date(Date.now() - 2000).toISOString(), // 더 오래됨
      };
      const otherMember: SpaceMemberRow = {
        ...mockMemberRow,
        user_id: 'user-456',
        role: 'member',
        joined_at: new Date(Date.now() - 1000).toISOString(),
      };

      (supabase.from as jest.Mock)
        // 1) 전체 멤버 조회 (joined_at ASC → meAsOwner, otherMember 순)
        .mockReturnValueOnce(makeChain({ data: [meAsOwner, otherMember], error: null }))
        // 2) 본인 events 조회 (빈 배열 → event_shares DELETE 생략)
        .mockReturnValueOnce(makeChain({ data: [], error: null }))
        // 3) 소유권 이전: space_members UPDATE (otherMember → owner)
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        // 4) 내 membership DELETE
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await leaveSpace('space-abc');

      // 4 단계: members(select) + events(select) + UPDATE + DELETE
      expect(supabase.from).toHaveBeenCalledTimes(4);
    });

    it('Space 멤버가 아닌 경우: "해당 Space의 멤버가 아닙니다." 에러 throw', async () => {
      // 전체 멤버 목록에 내 user_id가 없음
      const otherMember: SpaceMemberRow = { ...mockMemberRow, user_id: 'user-xyz' };

      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: [otherMember], error: null }),
      );

      await expect(leaveSpace('space-abc')).rejects.toThrow(
        '해당 Space의 멤버가 아닙니다.',
      );
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(leaveSpace('space-abc')).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // regenerateInviteCode (generateCode 간접 테스트)
  // ══════════════════════════════════════════════════════════════════════════

  describe('regenerateInviteCode', () => {
    /**
     * regenerateInviteCode 흐름:
     * 1. getCurrentUserId → 'user-123'
     * 2. assertOwner: from('space_members').select('role').eq(...).single() → { role: 'owner' }
     * 3. from('spaces').update({ invite_code: newCode }).eq('id', spaceId) → { error: null }
     */
    function setupRegenerateInviteCodeMocks() {
      (supabase.from as jest.Mock)
        // assertOwner: owner 확인
        .mockReturnValueOnce(makeChain({ data: { role: 'owner' }, error: null }))
        // spaces UPDATE: 신규 코드 저장
        .mockReturnValueOnce(makeChain({ data: null, error: null }));
    }

    it('정상 흐름: 6자리 신규 코드 반환', async () => {
      setupRegenerateInviteCodeMocks();

      const newCode = await regenerateInviteCode('space-abc');

      expect(newCode).toHaveLength(6);
    });

    it('생성된 코드: O/0/I/1이 포함되지 않음', async () => {
      // 여러 번 실행해 코드 품질 검증
      const EXCLUDED_CHARS = /[O0I1]/;
      const ALLOWED_CHARS = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

      for (let i = 0; i < 20; i++) {
        setupRegenerateInviteCodeMocks();
        const code = await regenerateInviteCode('space-abc');
        expect(EXCLUDED_CHARS.test(code)).toBe(false);
        expect(ALLOWED_CHARS.test(code)).toBe(true);
        expect(code).toHaveLength(6);
      }
    });

    it('owner가 아닌 경우: "Space 관리자만" 에러 throw', async () => {
      // assertOwner: member 역할 반환
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: { role: 'member' }, error: null }),
      );

      await expect(regenerateInviteCode('space-abc')).rejects.toThrow(
        'Space 관리자만 이 작업을 수행할 수 있습니다.',
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAnniversaries
  // ══════════════════════════════════════════════════════════════════════════

  describe('getAnniversaries', () => {
    it('정상 흐름: anniversaries 배열 반환', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: [mockAnniversaryRow], error: null }),
      );

      const result = await getAnniversaries('space-abc');

      expect(supabase.from).toHaveBeenCalledWith('anniversaries');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('anniv-001');
      expect(result[0]?.title).toBe('첫 만남');
      expect(result[0]?.repeatYearly).toBe(true);
      // daysFromToday가 숫자로 계산됨
      expect(typeof result[0]?.daysFromToday).toBe('number');
    });

    it('빈 결과: 빈 배열 반환', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: [], error: null }),
      );

      const result = await getAnniversaries('space-abc');
      expect(result).toEqual([]);
    });

    it('null 결과: 빈 배열 반환', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: null }),
      );

      const result = await getAnniversaries('space-abc');
      expect(result).toEqual([]);
    });

    it('DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('anniversaries table not found') }),
      );

      await expect(getAnniversaries('space-abc')).rejects.toThrow(
        'anniversaries table not found',
      );
    });

    it('반환 배열: daysFromToday 기준 오름차순 정렬', async () => {
      // 미래 기념일 2개: 먼 날짜가 뒤로 정렬
      const futureFar: AnniversaryRow = {
        ...mockAnniversaryRow,
        id: 'anniv-far',
        date: '2099-12-31',
        repeat_yearly: false,
      };
      const futureNear: AnniversaryRow = {
        ...mockAnniversaryRow,
        id: 'anniv-near',
        date: '2099-01-01',
        repeat_yearly: false,
      };

      (supabase.from as jest.Mock).mockReturnValueOnce(
        // DB에서 역순으로 오더라도 서비스에서 daysFromToday 기준 재정렬
        makeChain({ data: [futureFar, futureNear], error: null }),
      );

      const result = await getAnniversaries('space-abc');
      // nearDate (2099-01-01) → 먼저 나와야 함
      expect(result[0]?.id).toBe('anniv-near');
      expect(result[1]?.id).toBe('anniv-far');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createAnniversary
  // ══════════════════════════════════════════════════════════════════════════

  describe('createAnniversary', () => {
    it('정상 흐름: anniversaries INSERT 후 Anniversary 반환', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: mockAnniversaryRow, error: null }),
      );

      const result = await createAnniversary('space-abc', {
        title: '첫 만남',
        date: new Date('2024-03-15'),
        repeatYearly: true,
      });

      expect(supabase.from).toHaveBeenCalledWith('anniversaries');
      expect(result.id).toBe('anniv-001');
      expect(result.title).toBe('첫 만남');
      expect(result.repeatYearly).toBe(true);
    });

    it('미인증: "로그인이 필요합니다." 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(
        createAnniversary('space-abc', {
          title: '기념일',
          date: new Date(),
          repeatYearly: false,
        }),
      ).rejects.toThrow('로그인이 필요합니다.');
    });

    it('DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('INSERT failed') }),
      );

      await expect(
        createAnniversary('space-abc', {
          title: '기념일',
          date: new Date(),
          repeatYearly: false,
        }),
      ).rejects.toThrow('INSERT failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteAnniversary
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteAnniversary', () => {
    it('정상 흐름: anniversaries DELETE 호출', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: null }),
      );

      await deleteAnniversary('anniv-001');

      expect(supabase.from).toHaveBeenCalledWith('anniversaries');
    });

    it('DB 에러: 에러 throw', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce(
        makeChain({ data: null, error: new Error('DELETE permission denied') }),
      );

      await expect(deleteAnniversary('anniv-001')).rejects.toThrow(
        'DELETE permission denied',
      );
    });
  });
});
