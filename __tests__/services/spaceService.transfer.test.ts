/**
 * __tests__/services/spaceService.transfer.test.ts
 *
 * IDEA-011 Phase B — transferOwnership 단위 테스트
 *
 * 커버리지:
 *  1. 권한 없음 (member) → throw
 *  2. 정상 양도 → UPDATE(promote) + UPDATE(demote) 순서 확인
 *  3. non-member 에게 양도 시도 → throw
 *  4. 자기 자신에게 양도 → throw (assertOwner 전에 즉시 차단)
 *
 * Mock 전략:
 *  - TDZ-safe 팩토리 패턴 (spaceService.leave.test.ts 와 동일 구조)
 *  - makeChain(): thenable + .single() dual-mode 체인 빌더
 *  - transferOwnership 내부 from() 호출 순서:
 *      1) space_members SELECT .single() — assertOwner (caller role 확인)
 *      2) space_members SELECT .single() — targetMembership 확인
 *      3) space_members UPDATE           — promote new owner
 *      4) space_members UPDATE           — demote old owner
 *
 * @task IDEA-011-B
 * @sprint 28
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
    getCurrentUserId: jest.fn().mockResolvedValue('user-owner'),
    __chain:  chain,
    __fromFn: fromFn,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getCurrentUserId } from '@/lib/supabase';
import { transferOwnership } from '@/services/spaceService';

// ─── Mock 참조 추출 ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __fromFn: fromFn } = require('@/lib/supabase') as any;

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인의 dual-mode thenable mock 생성.
 *  await chain          → resolvedValue (non-single 쿼리)
 *  await chain.single() → resolvedValue
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

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('spaceService — transferOwnership (IDEA-011 Phase B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본 로그인 유저: 'user-owner'
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-owner');
    fromFn.mockReturnValue(makeChain({ data: null, error: null }));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 케이스 1: 권한 없음 (caller = member role)
  // ══════════════════════════════════════════════════════════════════════════

  it('caller가 owner가 아니면(member) throw — assertOwner 실패', async () => {
    // assertOwner 내부: from('space_members').select('role').eq(...).single()
    // → role = 'member' 반환 → assertOwner가 throw
    const assertChain = makeChain({ data: { role: 'member' }, error: null });
    fromFn.mockReturnValueOnce(assertChain);

    await expect(
      transferOwnership('space-001', 'user-target'),
    ).rejects.toThrow('Space 관리자만 이 작업을 수행할 수 있습니다.');

    // assertOwner 이후 단계는 호출되지 않아야 함
    expect(fromFn).toHaveBeenCalledTimes(1);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 케이스 2: 정상 양도 — UPDATE promote + demote 순서 검증
  // ══════════════════════════════════════════════════════════════════════════

  it('정상 양도: promote(new owner) → demote(caller) 순서로 UPDATE 호출', async () => {
    // (1) assertOwner: caller = owner
    const assertChain = makeChain({ data: { role: 'owner' }, error: null });
    // (2) targetMembership: new owner가 멤버임을 확인
    const targetMemberChain = makeChain({
      data: { id: 'row-target', role: 'member' },
      error: null,
    });
    // (3) promote: UPDATE new owner → role = 'owner'
    const promoteChain = makeChain({ data: null, error: null });
    // (4) demote: UPDATE caller → role = 'member'
    const demoteChain = makeChain({ data: null, error: null });

    fromFn
      .mockReturnValueOnce(assertChain)
      .mockReturnValueOnce(targetMemberChain)
      .mockReturnValueOnce(promoteChain)
      .mockReturnValueOnce(demoteChain);

    await transferOwnership('space-001', 'user-target');

    // promote 검증: new owner에게 role = 'owner'
    expect(promoteChain.update).toHaveBeenCalledWith({ role: 'owner' });
    expect(promoteChain.eq).toHaveBeenCalledWith('space_id', 'space-001');
    expect(promoteChain.eq).toHaveBeenCalledWith('user_id', 'user-target');

    // demote 검증: caller에게 role = 'member'
    expect(demoteChain.update).toHaveBeenCalledWith({ role: 'member' });
    expect(demoteChain.eq).toHaveBeenCalledWith('space_id', 'space-001');
    expect(demoteChain.eq).toHaveBeenCalledWith('user_id', 'user-owner');

    // 총 from() 호출 4회 (assert + target + promote + demote)
    expect(fromFn).toHaveBeenCalledTimes(4);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 케이스 3: 대상이 Space 멤버가 아닌 경우 → throw
  // ══════════════════════════════════════════════════════════════════════════

  it('대상 유저가 Space 멤버가 아니면 throw', async () => {
    // (1) assertOwner: caller = owner 통과
    const assertChain = makeChain({ data: { role: 'owner' }, error: null });
    // (2) targetMembership: .single() → data null (멤버 없음)
    // supabase .single()은 row 없으면 data: null, error가 있거나 없을 수 있음.
    // 여기서는 data: null, error: null (no-row) 케이스로 시뮬레이션.
    const targetNotFoundChain = makeChain({ data: null, error: null });

    fromFn
      .mockReturnValueOnce(assertChain)
      .mockReturnValueOnce(targetNotFoundChain);

    await expect(
      transferOwnership('space-001', 'user-nonmember'),
    ).rejects.toThrow('소유권을 양도할 멤버가 해당 Space에 존재하지 않습니다.');

    // promote/demote는 호출되지 않아야 함
    expect(fromFn).toHaveBeenCalledTimes(2);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 케이스 4: 자기 자신에게 양도 → assertOwner 전에 즉시 차단
  // ══════════════════════════════════════════════════════════════════════════

  it('자기 자신에게 양도 시도 → assertOwner 이전에 throw', async () => {
    // getCurrentUserId = 'user-owner', newOwnerUserId = 'user-owner' → 즉시 차단
    await expect(
      transferOwnership('space-001', 'user-owner'),
    ).rejects.toThrow('자기 자신에게 소유권을 양도할 수 없습니다.');

    // DB 호출이 전혀 발생하지 않아야 함 (early exit)
    expect(fromFn).not.toHaveBeenCalled();
  });
});
