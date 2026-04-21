/**
 * __tests__/services/eventShareService.test.ts
 *
 * Event share service 테스트 스위트
 *
 * 전략:
 *  - @/lib/supabase 전체를 mock → 실제 DB 호출 차단
 *  - makeChain() 헬퍼: Supabase 쿼리 체인을 thenable 지원
 *
 * 커버리지:
 *  shareEventToSpace    — upsert 호출, 중복 safe (idempotent), 에러 throw
 *  unshareEventFromSpace — delete + eq 조건, 에러 throw
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase';
import {
  shareEventToSpace,
  unshareEventFromSpace,
} from '@/services/eventShareService';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인 mock 생성.
 */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('eventShareService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // shareEventToSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('shareEventToSpace', () => {
    it('event_shares 테이블에 upsert 호출', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await shareEventToSpace('event-1', 'space-1');

      expect(supabase.from).toHaveBeenCalledWith('event_shares');
      expect(chain.upsert).toHaveBeenCalledWith(
        { event_id: 'event-1', space_id: 'space-1' },
        { onConflict: 'event_id,space_id' }
      );
    });

    it('중복 공유 시에도 에러 없음 (idempotent — onConflict로 처리)', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      // 동일한 이벤트-스페이스 조합을 두 번 호출해도 에러 없음
      await expect(shareEventToSpace('event-1', 'space-1')).resolves.toBeUndefined();
      await expect(shareEventToSpace('event-1', 'space-1')).resolves.toBeUndefined();
    });

    it('성공 시 undefined 반환', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await shareEventToSpace('event-1', 'space-1');

      expect(result).toBeUndefined();
    });

    it('DB 에러 → throw', async () => {
      const chain = makeChain({ data: null, error: new Error('공유 실패') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(shareEventToSpace('event-1', 'space-1')).rejects.toThrow('공유 실패');
    });

    it('다른 event_id와 space_id 조합으로 정확히 upsert 호출', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await shareEventToSpace('event-xyz', 'space-abc');

      expect(chain.upsert).toHaveBeenCalledWith(
        { event_id: 'event-xyz', space_id: 'space-abc' },
        expect.any(Object)
      );
    });

    it('onConflict 옵션에 event_id,space_id 복합 키 사용', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await shareEventToSpace('event-1', 'space-1');

      expect(chain.upsert).toHaveBeenCalledWith(
        expect.any(Object),
        { onConflict: 'event_id,space_id' }
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // unshareEventFromSpace
  // ══════════════════════════════════════════════════════════════════════════

  describe('unshareEventFromSpace', () => {
    it('event_shares 테이블에서 해당 행 delete', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await unshareEventFromSpace('event-1', 'space-1');

      expect(supabase.from).toHaveBeenCalledWith('event_shares');
      expect(chain.delete).toHaveBeenCalled();
    });

    it('event_id eq 조건으로 특정 이벤트만 삭제', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await unshareEventFromSpace('event-1', 'space-1');

      expect(chain.eq).toHaveBeenCalledWith('event_id', 'event-1');
    });

    it('space_id eq 조건으로 특정 스페이스에서만 삭제', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await unshareEventFromSpace('event-1', 'space-1');

      expect(chain.eq).toHaveBeenCalledWith('space_id', 'space-1');
    });

    it('event_id와 space_id 모두 eq 조건으로 정확한 행 삭제', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await unshareEventFromSpace('event-abc', 'space-xyz');

      // 두 조건 모두 사용
      expect(chain.eq).toHaveBeenCalledWith('event_id', 'event-abc');
      expect(chain.eq).toHaveBeenCalledWith('space_id', 'space-xyz');
    });

    it('성공 시 undefined 반환', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await unshareEventFromSpace('event-1', 'space-1');

      expect(result).toBeUndefined();
    });

    it('DB 에러 → throw', async () => {
      const chain = makeChain({ data: null, error: new Error('삭제 실패') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(
        unshareEventFromSpace('event-1', 'space-1')
      ).rejects.toThrow('삭제 실패');
    });

    it('존재하지 않는 공유 해제 시도 시 에러 없음 (RLS가 처리)', async () => {
      // 행이 없어도 delete 자체는 에러 없이 완료
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(
        unshareEventFromSpace('nonexistent-event', 'space-1')
      ).resolves.toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 통합: share → unshare 시나리오
  // ══════════════════════════════════════════════════════════════════════════

  describe('공유 → 공유 해제 시나리오', () => {
    it('공유 후 해제 시 각각 올바른 테이블 조작 수행', async () => {
      const shareChain = makeChain({ data: null, error: null });
      const unshareChain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(shareChain)
        .mockReturnValueOnce(unshareChain);

      await shareEventToSpace('event-1', 'space-1');
      await unshareEventFromSpace('event-1', 'space-1');

      // 두 번 모두 event_shares 테이블 사용
      expect(supabase.from).toHaveBeenNthCalledWith(1, 'event_shares');
      expect(supabase.from).toHaveBeenNthCalledWith(2, 'event_shares');
      // 각각 upsert, delete 호출
      expect(shareChain.upsert).toHaveBeenCalled();
      expect(unshareChain.delete).toHaveBeenCalled();
    });
  });
});
