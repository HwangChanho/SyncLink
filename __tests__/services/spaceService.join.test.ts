/**
 * __tests__/services/spaceService.join.test.ts
 *
 * TASK-610: Space Join / Deeplink 테스트 스위트
 *
 * 커버리지:
 *  getSpaceByInviteCode — 유효한 코드 → SpaceSummary 반환
 *  getSpaceByInviteCode — 존재하지 않는 코드 → Error throw
 *  getSpaceByInviteCode — DB 에러 → Error throw
 *  getSpaceByInviteCode — 코드는 자동으로 대문자 변환되어 비교
 *  joinSpace            — 신규 멤버 → space_members INSERT 호출
 *  joinSpace            — 이미 멤버인 경우 → INSERT 생략 (idempotent)
 *  joinSpace            — unique constraint violation → 성공으로 처리
 *  joinSpace            — 미인증 → "로그인이 필요합니다." 에러 throw
 *  joinSpace            — DB fetch 에러 → 에러 throw
 *  joinSpace            — INSERT 에러(unique 제외) → 에러 throw
 *
 * Mock 전략:
 *  - TDZ-safe 팩토리 패턴: jest.mock 내부에서 chain 객체를 생성하고 __chain/__fromFn으로 export
 *  - makeChain(): thenable + .single() 지원 dual-mode 체인 빌더
 *  - getCurrentUserId: 기본값 'user-123', 테스트별로 mockResolvedValue로 재정의
 *
 * @task TASK-610
 */

// ─── Mock 선언 (TDZ-safe) ─────────────────────────────────────────────────────

/**
 * @/lib/supabase 전체를 팩토리 내부에서 대체.
 * 팩토리 외부 변수를 절대 참조하지 않음 — TDZ 오류 방지.
 * __chain, __fromFn 으로 jest.fn() 참조를 export하여 테스트에서 재사용.
 */
jest.mock('@/lib/supabase', () => {
  // 체인 내 각 메서드 — mockReturnThis()로 builder 패턴 지원
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
    // 테스트에서 참조하기 위한 내부 mock 참조 export
    __chain:  chain,
    __fromFn: fromFn,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getCurrentUserId } from '@/lib/supabase';
import {
  getSpaceByInviteCode,
  joinSpace,
} from '@/services/spaceService';
import type { SpaceRow } from '@/types';

// ─── Mock 참조 추출 ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __chain: chain, __fromFn: fromFn } = require('@/lib/supabase') as any;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인의 dual-mode thenable mock 생성.
 *
 * - await chain     → resolvedValue (non-single 쿼리)
 * - await chain.single() → resolvedValue (single row 쿼리)
 * - await chain.maybeSingle() → resolvedValue (optional single row 쿼리)
 *
 * @param resolvedValue - { data, error } 형태의 resolve 값
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
    // chain 자체를 await 할 수 있도록 thenable 처리
    then:  promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return ch;
}

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

/** spaces 테이블 row 픽스처 */
const mockSpaceRow: SpaceRow = {
  id:               'space-001',
  name:             'Test Space',
  type:             'team',
  invite_code:      'ABCD12',
  cover_image_url:  null,
  created_by:       'owner-user',
  created_at:       new Date('2026-01-01').toISOString(),
  updated_at:       new Date('2026-01-01').toISOString(),
};

/** space_members 카운트 쿼리 픽스처 (2명) */
const mockMemberCountRows = [
  { space_id: 'space-001' },
  { space_id: 'space-001' },
];

/** space_members 멤버 목록 픽스처 (user-456 포함) */
const mockMemberRows = [
  { user_id: 'other-user-456' },
  { user_id: 'another-user-789' },
];

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('spaceService — getSpaceByInviteCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본 인증 상태 복원
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
    // fromFn 기본 체인 복원 (단일 체인 공유 방식)
    fromFn.mockReturnValue(chain);
  });

  it('유효한 코드 → SpaceSummary 반환 (id, name, type, memberCount 포함)', async () => {
    // getSpaceByInviteCode는 2번의 from() 호출:
    //   1) spaces에서 invite_code로 조회 → .single()
    //   2) space_members에서 count 조회 → await chain
    fromFn
      .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
      .mockReturnValueOnce(makeChain({ data: mockMemberCountRows, error: null }));

    const result = await getSpaceByInviteCode('ABCD12');

    expect(result.id).toBe('space-001');
    expect(result.name).toBe('Test Space');
    expect(result.type).toBe('team');
    expect(result.memberCount).toBe(2);
  });

  it('소문자 코드 입력 → 자동 대문자 변환 후 조회', async () => {
    fromFn
      .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));

    await getSpaceByInviteCode('abcd12');

    // from('spaces') 이후 .eq('invite_code', ...) 에 대문자 코드가 전달되어야 함
    // eq 호출 확인: 첫 번째 from() 체인에서 eq가 호출됨
    const firstChain = fromFn.mock.results[0]?.value;
    expect(firstChain.eq).toHaveBeenCalledWith('invite_code', 'ABCD12');
  });

  it('존재하지 않는 코드 → "유효하지 않은 초대 코드입니다." 에러 throw', async () => {
    fromFn.mockReturnValueOnce(
      makeChain({ data: null, error: new Error('row not found') }),
    );

    await expect(getSpaceByInviteCode('ZZZZZZ')).rejects.toThrow(
      '유효하지 않은 초대 코드입니다.',
    );
  });

  it('spaceRow=null, error=null → "유효하지 않은 초대 코드입니다." 에러 throw', async () => {
    fromFn.mockReturnValueOnce(makeChain({ data: null, error: null }));

    await expect(getSpaceByInviteCode('XXXXXX')).rejects.toThrow(
      '유효하지 않은 초대 코드입니다.',
    );
  });

  it('memberCount 쿼리 DB 에러 → 에러 throw', async () => {
    fromFn
      .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
      .mockReturnValueOnce(
        makeChain({ data: null, error: new Error('count query failed') }),
      );

    await expect(getSpaceByInviteCode('ABCD12')).rejects.toThrow('count query failed');
  });

  it('멤버가 없는 Space → memberCount = 0', async () => {
    fromFn
      .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));

    const result = await getSpaceByInviteCode('ABCD12');

    expect(result.memberCount).toBe(0);
  });

  it('memberCount 데이터가 null → memberCount = 0 (null coalesce)', async () => {
    fromFn
      .mockReturnValueOnce(makeChain({ data: mockSpaceRow, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await getSpaceByInviteCode('ABCD12');

    expect(result.memberCount).toBe(0);
  });

  it('반환된 SpaceSummary에 coverImageUrl 포함', async () => {
    const spaceWithCover: SpaceRow = {
      ...mockSpaceRow,
      cover_image_url: 'https://example.com/cover.jpg',
    };
    fromFn
      .mockReturnValueOnce(makeChain({ data: spaceWithCover, error: null }))
      .mockReturnValueOnce(makeChain({ data: mockMemberCountRows, error: null }));

    const result = await getSpaceByInviteCode('ABCD12');

    expect(result.coverImageUrl).toBe('https://example.com/cover.jpg');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('spaceService — joinSpace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
    fromFn.mockReturnValue(chain);
  });

  it('신규 멤버 → 현재 멤버 조회 후 INSERT 호출', async () => {
    // 1차 from(): space_members에서 현재 멤버 목록 조회 (user-123 미포함)
    // 2차 from(): space_members에 INSERT
    const fetchChain  = makeChain({ data: mockMemberRows, error: null });
    const insertChain = makeChain({ data: null, error: null });

    fromFn
      .mockReturnValueOnce(fetchChain)
      .mockReturnValueOnce(insertChain);

    await joinSpace('space-001');

    // INSERT가 올바른 테이블에 호출되었는지 확인
    expect(fromFn).toHaveBeenCalledWith('space_members');
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        space_id: 'space-001',
        user_id:  'user-123',
        role:     'member',
      }),
    );
  });

  it('이미 멤버인 경우 → INSERT 호출 없이 idempotent 종료', async () => {
    // 현재 멤버 목록에 user-123이 포함
    const alreadyMemberRows = [{ user_id: 'user-123' }];
    fromFn.mockReturnValueOnce(makeChain({ data: alreadyMemberRows, error: null }));

    await joinSpace('space-001');

    // from()은 멤버 조회 한 번만 호출 (INSERT 체인 없음)
    expect(fromFn).toHaveBeenCalledTimes(1);
  });

  it('unique constraint violation → 성공으로 처리 (에러 throw 없음)', async () => {
    // 현재 멤버 목록에 없지만 INSERT 시 unique constraint 에러 발생
    const uniqueError = new Error('duplicate key value violates unique constraint');
    fromFn
      .mockReturnValueOnce(makeChain({ data: [], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: uniqueError }));

    // unique 오류는 무시되어야 함
    await expect(joinSpace('space-001')).resolves.toBeUndefined();
  });

  it('일반 INSERT 에러(unique 제외) → 에러 throw', async () => {
    const dbError = new Error('foreign key constraint violation');
    fromFn
      .mockReturnValueOnce(makeChain({ data: [], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: dbError }));

    await expect(joinSpace('space-001')).rejects.toThrow(
      'foreign key constraint violation',
    );
  });

  it('미인증 → "로그인이 필요합니다." 에러 throw', async () => {
    (getCurrentUserId as jest.Mock).mockResolvedValue(null);

    await expect(joinSpace('space-001')).rejects.toThrow('로그인이 필요합니다.');
  });

  it('멤버 목록 fetch 에러 → 에러 throw', async () => {
    fromFn.mockReturnValueOnce(
      makeChain({ data: null, error: new Error('network error') }),
    );

    await expect(joinSpace('space-001')).rejects.toThrow('network error');
  });

  it('color 할당: 멤버가 0명일 때 index=0 색상 할당', async () => {
    const insertChain = makeChain({ data: null, error: null });
    fromFn
      .mockReturnValueOnce(makeChain({ data: [], error: null }))
      .mockReturnValueOnce(insertChain);

    await joinSpace('space-001');

    // INSERT payload에 color 필드가 존재해야 함
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ color: expect.any(String) }),
    );
  });

  it('color 할당: 기존 멤버 수에 따라 색상 인덱스 순환', async () => {
    // 기존 멤버 6명 → 색상 배열 순환
    const sixMembers = Array.from({ length: 6 }, (_, i) => ({ user_id: `user-${i}` }));
    const insertChain = makeChain({ data: null, error: null });

    fromFn
      .mockReturnValueOnce(makeChain({ data: sixMembers, error: null }))
      .mockReturnValueOnce(insertChain);

    await joinSpace('space-001');

    // color가 지정됨 (인덱스 6 % 배열크기 = 유효한 색상)
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ color: expect.any(String) }),
    );
  });
});
