/**
 * __tests__/services/spaceService.join.test.ts
 *
 * TASK-610: Space Join / Deeplink 테스트 스위트
 *
 * 커버리지:
 *  (2026-10-13) 미리보기·가입이 서버 RPC(migration 077)로 바뀌어 rpc mock 기준으로 다시 썼다.
 *  getSpaceByInviteCode  — preview RPC 결과 → SpaceSummary · spaces 직접 조회 안 함 · 0행/오류 → 유효하지 않은 코드
 *  joinSpaceByInviteLink — 미리보기 인원수로 색 계산 → join RPC · 이미 멤버면 멱등 · 서버 오류 키 → 사용자 문구
 *
 * Mock 전략:
 *  - TDZ-safe 팩토리 패턴: jest.mock 내부에서 chain 객체를 생성하고 __chain/__fromFn으로 export
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
  const rpcFn  = jest.fn();

  return {
    supabase: { from: fromFn, rpc: rpcFn },
    getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
    // 테스트에서 참조하기 위한 내부 mock 참조 export
    __chain:  chain,
    __fromFn: fromFn,
    __rpcFn:  rpcFn,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { getCurrentUserId } from '@/lib/supabase';
import {
  getSpaceByInviteCode,
  joinSpaceByInviteLink,
} from '@/services/spaceService';
import { getMemberColor } from '@/constants/colors';

// ─── Mock 참조 추출 ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __chain: chain, __fromFn: fromFn, __rpcFn: rpcFn } = require('@/lib/supabase') as any;

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

/** preview_space_by_invite_code RPC 한 행 픽스처 (멤버 2명) */
const mockPreviewRow = {
  id:              'space-001',
  name:            'Test Space',
  type:            'group',
  member_count:    2,
  cover_image_url: null as string | null,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('spaceService — getSpaceByInviteCode (preview RPC)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
    fromFn.mockReturnValue(chain);
  });

  it('유효한 코드 → RPC 결과를 SpaceSummary 로 반환', async () => {
    rpcFn.mockResolvedValueOnce({ data: [mockPreviewRow], error: null });

    const result = await getSpaceByInviteCode('ABCD12');

    expect(rpcFn).toHaveBeenCalledWith('preview_space_by_invite_code', { p_code: 'ABCD12' });
    expect(result).toEqual({
      id: 'space-001', name: 'Test Space', type: 'group', memberCount: 2, coverImageUrl: null,
    });
  });

  it('spaces 를 직접 읽지 않는다 — 비멤버는 RLS 로 0행이라 링크 진입이 늘 실패하던 회귀 방지', async () => {
    rpcFn.mockResolvedValueOnce({ data: [mockPreviewRow], error: null });

    await getSpaceByInviteCode('ABCD12');

    expect(fromFn).not.toHaveBeenCalled();
  });

  it('없는 코드(0행) → "유효하지 않은 초대 코드입니다." 에러 throw', async () => {
    rpcFn.mockResolvedValueOnce({ data: [], error: null });

    await expect(getSpaceByInviteCode('ZZZZZZ')).rejects.toThrow('유효하지 않은 초대 코드입니다.');
  });

  it('RPC 오류 → "유효하지 않은 초대 코드입니다." 에러 throw', async () => {
    rpcFn.mockResolvedValueOnce({ data: null, error: { message: 'network' } });

    await expect(getSpaceByInviteCode('ABCD12')).rejects.toThrow('유효하지 않은 초대 코드입니다.');
  });

  it('표지 URL 을 그대로 전달', async () => {
    rpcFn.mockResolvedValueOnce({
      data: [{ ...mockPreviewRow, cover_image_url: 'https://example.com/cover.jpg' }], error: null,
    });

    const result = await getSpaceByInviteCode('ABCD12');

    expect(result.coverImageUrl).toBe('https://example.com/cover.jpg');
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe('spaceService — joinSpaceByInviteLink (join RPC)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
    fromFn.mockReturnValue(chain);
  });

  it('미리보기 인원수로 색을 계산해 가입 RPC 호출 → Space id 반환 (직접 INSERT 없음)', async () => {
    rpcFn
      .mockResolvedValueOnce({ data: [mockPreviewRow], error: null })
      .mockResolvedValueOnce({ data: 'space-001', error: null });

    await expect(joinSpaceByInviteLink('ABCD12')).resolves.toBe('space-001');

    expect(rpcFn).toHaveBeenNthCalledWith(2, 'join_space_by_invite_code', {
      p_code:  'ABCD12',
      p_color: getMemberColor(2),
    });
    expect(fromFn).not.toHaveBeenCalled();
  });

  it('이미 멤버 → 오류 없이 그 Space id (멱등)', async () => {
    rpcFn
      .mockResolvedValueOnce({ data: [mockPreviewRow], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'already_member' } });

    await expect(joinSpaceByInviteLink('ABCD12')).resolves.toBe('space-001');
  });

  it.each([
    ['invite_expired',    '초대 코드가 만료되었습니다.'],
    ['invite_max_uses',   '초대 코드 사용 한도에 도달했습니다.'],
    ['couple_space_full', '커플 Space는 최대 2명까지 참여할 수 있습니다.'],
    ['invite_invalid',    '유효하지 않은 초대 코드입니다.'],
  ])('서버 오류 키 %s → 사용자 문구', async (key, message) => {
    rpcFn
      .mockResolvedValueOnce({ data: [mockPreviewRow], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: key } });

    await expect(joinSpaceByInviteLink('ABCD12')).rejects.toThrow(message);
  });

  it('모르는 오류 → 원래 메시지 그대로', async () => {
    rpcFn
      .mockResolvedValueOnce({ data: [mockPreviewRow], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await expect(joinSpaceByInviteLink('ABCD12')).rejects.toThrow('boom');
  });

  it('미인증 → "로그인이 필요합니다." 에러 throw (RPC 호출 없음)', async () => {
    (getCurrentUserId as jest.Mock).mockResolvedValue(null);

    await expect(joinSpaceByInviteLink('ABCD12')).rejects.toThrow('로그인이 필요합니다.');
    expect(rpcFn).not.toHaveBeenCalled();
  });
});
