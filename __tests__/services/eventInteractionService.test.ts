/**
 * __tests__/services/eventInteractionService.test.ts
 *
 * TASK-510: Event Interaction Service 테스트 스위트
 *
 * 커버리지:
 *  getReactions           — DB에서 eventId 기준 조회, 도메인 객체 변환
 *  getReactionSummaries   — 집계 + 내 반응 감지, display order 정렬
 *  toggleReaction         — 없으면 INSERT, 있으면 DELETE (토글)
 *  getComments            — eventId 기준 정렬 조회
 *  addComment             — 빈 문자열/500자 초과 유효성 검사, INSERT 후 반환
 *  updateComment          — 유효성 검사, UPDATE 후 반환
 *  deleteComment          — DELETE 호출 (RLS mock)
 *  subscribeToEventInteractions — 채널 생성, on() 2회 등록, unsubscribe 반환
 *
 * Mock 전략:
 *  - jest.mock 팩토리 내부에서 jest.fn()을 직접 생성.
 *    팩토리 외부 const 변수를 팩토리 내에서 참조하면 TDZ(Temporal Dead Zone)로 인해
 *    undefined가 될 수 있습니다. 따라서 팩토리 안에서 직접 생성한 뒤
 *    jest.mocked(supabase) / require()로 접근합니다.
 *  - mockChain 객체: 모든 메서드가 자신을 반환하는 단일 체인 객체.
 *    setupChain()에서 각 테스트 전 초기화합니다.
 *
 * @task TASK-510
 * @depends TASK-503 (DEV)
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

/**
 * supabase mock.
 * 팩토리 내부에서 직접 jest.fn()을 생성하여 TDZ 문제를 방지합니다.
 * 외부에서 접근할 때는 _supabaseMock / _getCurrentUserIdMock 헬퍼를 사용합니다.
 */
jest.mock('@/lib/supabase', () => {
  const channelObj = {
    on:        jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
  };
  const chain = {
    select:      jest.fn(),
    insert:      jest.fn(),
    update:      jest.fn(),
    delete:      jest.fn(),
    eq:          jest.fn(),
    order:       jest.fn(),
    single:      jest.fn(),
    maybeSingle: jest.fn(),
  };
  const fromFn = jest.fn().mockReturnValue(chain);

  return {
    supabase: {
      from:          fromFn,
      channel:       jest.fn().mockReturnValue(channelObj),
      removeChannel: jest.fn(),
    },
    getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
    // 테스트에서 체인/채널 객체에 접근하기 위한 내부 참조
    __chain:      chain,
    __channelObj: channelObj,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import {
  getReactions,
  getReactionSummaries,
  toggleReaction,
  getComments,
  addComment,
  updateComment,
  deleteComment,
  subscribeToEventInteractions,
  REACTION_EMOJIS,
} from '@/services/eventInteractionService';
import type { EventReactionRow, EventCommentRow } from '@/types';

// ─── Mock 접근 헬퍼 ───────────────────────────────────────────────────────────

/**
 * jest.mock 팩토리 내부에서 생성한 체인 객체에 접근합니다.
 * require()를 통해 팩토리 반환값에서 __chain을 꺼냅니다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockModule = require('@/lib/supabase') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockChain:     Record<string, jest.Mock> = mockModule.__chain;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockChannelObj: Record<string, jest.Mock> = mockModule.__channelObj;
const mockFrom          = supabase.from          as jest.Mock;
const mockChannel       = supabase.channel       as jest.Mock;
const mockRemoveChannel = supabase.removeChannel as jest.Mock;
const mockGetCurrUser   = getCurrentUserId       as jest.Mock;

// ─── 체인 설정 헬퍼 ───────────────────────────────────────────────────────────

/**
 * 각 테스트 전 체인 메서드들이 mockChain 자신을 반환하도록 재설정합니다.
 * 마지막 await 대상 메서드(order/single/maybeSingle/eq)에는
 * 테스트별로 mockResolvedValueOnce를 별도 주입해야 합니다.
 */
function setupChain() {
  Object.values(mockChain).forEach(fn => fn.mockReset());

  mockChain.select.mockReturnValue(mockChain);
  mockChain.insert.mockReturnValue(mockChain);
  mockChain.update.mockReturnValue(mockChain);
  mockChain.delete.mockReturnValue(mockChain);
  mockChain.eq.mockReturnValue(mockChain);
  mockChain.order.mockReturnValue(mockChain);
  mockChain.single.mockReturnValue(mockChain);
  mockChain.maybeSingle.mockReturnValue(mockChain);

  mockFrom.mockReturnValue(mockChain);
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** DB에서 반환되는 raw reaction row 픽스처 */
const reactionRow: EventReactionRow = {
  id:         'reaction-1',
  event_id:   'event-abc',
  user_id:    'user-123',
  emoji:      '❤️',
  created_at: '2026-04-20T09:00:00.000Z',
};

/** DB에서 반환되는 raw comment row 픽스처 (users join 포함) */
const commentRow: EventCommentRow & {
  users?: { nickname?: string; avatar_url?: string | null } | null;
} = {
  id:         'comment-1',
  event_id:   'event-abc',
  user_id:    'user-123',
  content:    '기대돼요!',
  created_at: '2026-04-20T09:00:00.000Z',
  updated_at: '2026-04-20T09:00:00.000Z',
  users:      { nickname: '테스트유저', avatar_url: null },
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('eventInteractionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupChain();

    // getCurrentUserId 기본값: user-123 반환
    mockGetCurrUser.mockResolvedValue('user-123');

    // channel: mockChannelObj 반환
    Object.values(mockChannelObj).forEach(fn => fn.mockReset());
    mockChannelObj.on.mockReturnThis();
    mockChannelObj.subscribe.mockReturnThis();
    mockChannel.mockReturnValue(mockChannelObj);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getReactions
  // ══════════════════════════════════════════════════════════════════════════

  describe('getReactions', () => {
    it('eventId 기준 event_reactions 테이블 조회', async () => {
      mockChain.order.mockResolvedValueOnce({ data: [reactionRow], error: null });

      await getReactions('event-abc');

      expect(mockFrom).toHaveBeenCalledWith('event_reactions');
    });

    it('raw row를 EventReaction 도메인 객체로 변환', async () => {
      mockChain.order.mockResolvedValueOnce({ data: [reactionRow], error: null });

      const [reaction] = await getReactions('event-abc');

      expect(reaction.id).toBe('reaction-1');
      expect(reaction.eventId).toBe('event-abc');
      expect(reaction.userId).toBe('user-123');
      expect(reaction.emoji).toBe('❤️');
      expect(reaction.createdAt).toBeInstanceOf(Date);
    });

    it('데이터 없으면 빈 배열 반환', async () => {
      mockChain.order.mockResolvedValueOnce({ data: null, error: null });

      expect(await getReactions('event-abc')).toEqual([]);
    });

    it('DB 에러 발생 시 throw', async () => {
      mockChain.order.mockResolvedValueOnce({ data: null, error: new Error('DB error') });

      await expect(getReactions('event-abc')).rejects.toThrow('DB error');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getReactionSummaries
  // ══════════════════════════════════════════════════════════════════════════

  describe('getReactionSummaries', () => {
    it('현재 유저의 반응에 isMyReaction=true 표시', async () => {
      const anotherRow: EventReactionRow = {
        ...reactionRow,
        id:      'reaction-2',
        user_id: 'user-456',
      };
      mockChain.order.mockResolvedValueOnce({ data: [reactionRow, anotherRow], error: null });

      const summaries = await getReactionSummaries('event-abc');

      expect(summaries).toHaveLength(1);
      expect(summaries[0].emoji).toBe('❤️');
      expect(summaries[0].count).toBe(2);
      expect(summaries[0].isMyReaction).toBe(true);
    });

    it('내 반응이 아닌 경우 isMyReaction=false', async () => {
      const othersRow: EventReactionRow = {
        ...reactionRow,
        id:      'reaction-other',
        user_id: 'user-999',
      };
      mockChain.order.mockResolvedValueOnce({ data: [othersRow], error: null });

      const [summary] = await getReactionSummaries('event-abc');

      expect(summary.isMyReaction).toBe(false);
    });

    it('REACTION_EMOJIS 순서대로 정렬 (❤️ < 👍)', async () => {
      const thumbsRow: EventReactionRow = {
        ...reactionRow,
        id:    'reaction-thumbs',
        emoji: '👍',
      };
      // DB: 👍, ❤️ 순서 반환
      mockChain.order.mockResolvedValueOnce({ data: [thumbsRow, reactionRow], error: null });

      const summaries = await getReactionSummaries('event-abc');

      expect(REACTION_EMOJIS.indexOf(summaries[0].emoji)).toBeLessThan(
        REACTION_EMOJIS.indexOf(summaries[1].emoji),
      );
    });

    it('반응이 없으면 빈 배열 반환', async () => {
      mockChain.order.mockResolvedValueOnce({ data: [], error: null });

      expect(await getReactionSummaries('event-abc')).toEqual([]);
    });

    it('로그인하지 않은 경우 throw', async () => {
      mockGetCurrUser.mockResolvedValueOnce(null);

      await expect(getReactionSummaries('event-abc')).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // toggleReaction
  // ══════════════════════════════════════════════════════════════════════════

  describe('toggleReaction', () => {
    it('반응이 없으면 INSERT (toggle-on)', async () => {
      // 체크 쿼리: maybeSingle → 없음
      mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      // INSERT → 성공
      mockChain.insert.mockResolvedValueOnce({ error: null });

      await toggleReaction('event-abc', '❤️');

      expect(mockChain.insert).toHaveBeenCalledTimes(1);
    });

    it('반응이 이미 있으면 DELETE (toggle-off)', async () => {
      // 체크 쿼리: 기존 반응 있음 (maybySingle에서 resolve)
      mockChain.maybeSingle.mockResolvedValueOnce({ data: { id: 'reaction-1' }, error: null });
      // DELETE 쿼리: from.delete.eq → 마지막 eq에서 resolve
      // eq는 체크 쿼리에서 3번(event_id, user_id, emoji), DELETE에서 1번(id) 호출됨.
      // setupChain에서 eq.mockReturnValue(mockChain)으로 기본 설정되어 있으므로
      // DELETE의 eq(마지막 호출)에 대해 mockResolvedValueOnce를 별도 주입합니다.
      mockChain.eq
        .mockReturnValueOnce(mockChain)   // 체크: eq('event_id')
        .mockReturnValueOnce(mockChain)   // 체크: eq('user_id')
        .mockReturnValueOnce(mockChain)   // 체크: eq('emoji') → maybeSingle로 이어짐
        .mockResolvedValueOnce({ error: null }); // DELETE: eq('id') → await

      await toggleReaction('event-abc', '❤️');

      expect(mockChain.delete).toHaveBeenCalledTimes(1);
    });

    it('로그인하지 않은 경우 throw', async () => {
      mockGetCurrUser.mockResolvedValueOnce(null);

      await expect(toggleReaction('event-abc', '❤️')).rejects.toThrow('로그인이 필요합니다.');
    });

    it('INSERT 실패 시 throw', async () => {
      mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mockChain.insert.mockResolvedValueOnce({ error: new Error('INSERT 실패') });

      await expect(toggleReaction('event-abc', '👍')).rejects.toThrow('INSERT 실패');
    });

    it('DELETE 실패 시 throw', async () => {
      // 체크 쿼리: 기존 반응 있음
      mockChain.maybeSingle.mockResolvedValueOnce({ data: { id: 'reaction-1' }, error: null });
      // 체크 쿼리의 eq 3번 → mockChain 반환, DELETE의 eq 1번 → error 반환
      mockChain.eq
        .mockReturnValueOnce(mockChain)   // 체크: eq('event_id')
        .mockReturnValueOnce(mockChain)   // 체크: eq('user_id')
        .mockReturnValueOnce(mockChain)   // 체크: eq('emoji')
        .mockResolvedValueOnce({ error: new Error('DELETE 실패') }); // DELETE: eq('id')

      await expect(toggleReaction('event-abc', '👍')).rejects.toThrow('DELETE 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getComments
  // ══════════════════════════════════════════════════════════════════════════

  describe('getComments', () => {
    it('eventId 기준 event_comments 조회 후 도메인 변환', async () => {
      mockChain.order.mockResolvedValueOnce({ data: [commentRow], error: null });

      const comments = await getComments('event-abc');

      expect(mockFrom).toHaveBeenCalledWith('event_comments');
      expect(comments[0].id).toBe('comment-1');
      expect(comments[0].authorNickname).toBe('테스트유저');
      expect(comments[0].createdAt).toBeInstanceOf(Date);
    });

    it('users join이 null인 경우 authorNickname = 알 수 없음', async () => {
      mockChain.order.mockResolvedValueOnce({ data: [{ ...commentRow, users: null }], error: null });

      const [comment] = await getComments('event-abc');

      expect(comment.authorNickname).toBe('알 수 없음');
    });

    it('데이터 없으면 빈 배열', async () => {
      mockChain.order.mockResolvedValueOnce({ data: null, error: null });

      expect(await getComments('event-abc')).toEqual([]);
    });

    it('DB 에러 시 throw', async () => {
      mockChain.order.mockResolvedValueOnce({ data: null, error: new Error('조회 실패') });

      await expect(getComments('event-abc')).rejects.toThrow('조회 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // addComment
  // ══════════════════════════════════════════════════════════════════════════

  describe('addComment', () => {
    it('정상 입력 시 INSERT 후 EventComment 반환', async () => {
      mockChain.single.mockResolvedValueOnce({ data: commentRow, error: null });

      const comment = await addComment('event-abc', '기대돼요!');

      expect(comment.id).toBe('comment-1');
      expect(comment.content).toBe('기대돼요!');
    });

    it('빈 문자열 입력 시 throw', async () => {
      await expect(addComment('event-abc', '')).rejects.toThrow('코멘트 내용을 입력해 주세요.');
    });

    it('공백만 있는 문자열 입력 시 throw', async () => {
      await expect(addComment('event-abc', '   ')).rejects.toThrow('코멘트 내용을 입력해 주세요.');
    });

    it('500자 초과 입력 시 throw', async () => {
      await expect(addComment('event-abc', 'a'.repeat(501))).rejects.toThrow('500자');
    });

    it('정확히 500자는 통과 (경계값 테스트)', async () => {
      const exactContent = 'a'.repeat(500);
      mockChain.single.mockResolvedValueOnce({
        data: { ...commentRow, content: exactContent },
        error: null,
      });

      await expect(addComment('event-abc', exactContent)).resolves.toBeDefined();
    });

    it('로그인하지 않은 경우 throw', async () => {
      mockGetCurrUser.mockResolvedValueOnce(null);

      await expect(addComment('event-abc', '내용')).rejects.toThrow('로그인이 필요합니다.');
    });

    it('DB 에러 시 throw', async () => {
      mockChain.single.mockResolvedValueOnce({ data: null, error: new Error('DB 에러') });

      await expect(addComment('event-abc', '내용')).rejects.toThrow('DB 에러');
    });

    it('content는 trim 처리 후 insert에 전달', async () => {
      mockChain.single.mockResolvedValueOnce({ data: commentRow, error: null });

      await addComment('event-abc', '  내용  ');

      expect(mockChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ content: '내용' }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateComment
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateComment', () => {
    it('정상 입력 시 UPDATE 후 EventComment 반환', async () => {
      mockChain.single.mockResolvedValueOnce({
        data: { ...commentRow, content: '수정된 내용' },
        error: null,
      });

      const result = await updateComment('comment-1', '수정된 내용');

      expect(result.content).toBe('수정된 내용');
    });

    it('빈 문자열 입력 시 throw', async () => {
      await expect(updateComment('comment-1', '')).rejects.toThrow('코멘트 내용을 입력해 주세요.');
    });

    it('500자 초과 시 throw', async () => {
      await expect(updateComment('comment-1', 'x'.repeat(501))).rejects.toThrow('500자');
    });

    it('DB 에러 시 throw', async () => {
      mockChain.single.mockResolvedValueOnce({ data: null, error: new Error('수정 실패') });

      await expect(updateComment('comment-1', '내용')).rejects.toThrow('수정 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteComment
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteComment', () => {
    it('commentId 기준 DELETE 호출', async () => {
      // delete().eq() → 최종 await
      mockChain.eq.mockResolvedValueOnce({ error: null });

      await deleteComment('comment-1');

      expect(mockFrom).toHaveBeenCalledWith('event_comments');
      expect(mockChain.delete).toHaveBeenCalledTimes(1);
    });

    it('DB 에러 시 throw', async () => {
      mockChain.eq.mockResolvedValueOnce({ error: new Error('삭제 실패') });

      await expect(deleteComment('comment-1')).rejects.toThrow('삭제 실패');
    });

    it('RLS mock — 다른 유저 코멘트 삭제 시 DB 레벨 에러 propagate', async () => {
      mockChain.eq.mockResolvedValueOnce({
        error: new Error('new row violates row-level security policy'),
      });

      await expect(deleteComment('comment-other')).rejects.toThrow('row-level security');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // subscribeToEventInteractions
  // ══════════════════════════════════════════════════════════════════════════

  describe('subscribeToEventInteractions', () => {
    it('eventId 기반 채널 이름으로 channel() 호출', () => {
      subscribeToEventInteractions('event-abc', jest.fn(), jest.fn());

      expect(mockChannel).toHaveBeenCalledWith('event-interactions:event-abc');
    });

    it('on()이 reactions과 comments 각각 1회씩 총 2회 호출됨', () => {
      subscribeToEventInteractions('event-abc', jest.fn(), jest.fn());

      expect(mockChannelObj.on).toHaveBeenCalledTimes(2);
    });

    it('subscribe()가 호출됨', () => {
      subscribeToEventInteractions('event-abc', jest.fn(), jest.fn());

      expect(mockChannelObj.subscribe).toHaveBeenCalledTimes(1);
    });

    it('반환된 함수 호출 시 removeChannel 실행 (cleanup)', () => {
      const unsubscribe = subscribeToEventInteractions('event-abc', jest.fn(), jest.fn());

      unsubscribe();

      expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    });

    it('event_reactions 테이블 필터로 on() 등록됨', () => {
      subscribeToEventInteractions('event-abc', jest.fn(), jest.fn());

      expect(mockChannelObj.on).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({ table: 'event_reactions' }),
        expect.any(Function),
      );
    });

    it('event_comments 테이블 필터로 on() 등록됨', () => {
      subscribeToEventInteractions('event-abc', jest.fn(), jest.fn());

      expect(mockChannelObj.on).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({ table: 'event_comments' }),
        expect.any(Function),
      );
    });

    it('event_reactions on() 콜백 호출 시 onReactionChange 실행됨', () => {
      const onReaction = jest.fn();
      const onComment  = jest.fn();

      subscribeToEventInteractions('event-abc', onReaction, onComment);

      // 첫 번째 on() 호출의 세 번째 인자(콜백) 추출
      const reactionCallback = mockChannelObj.on.mock.calls[0][2] as () => void;
      reactionCallback();

      expect(onReaction).toHaveBeenCalledTimes(1);
      expect(onComment).not.toHaveBeenCalled();
    });

    it('event_comments on() 콜백 호출 시 onCommentChange 실행됨', () => {
      const onReaction = jest.fn();
      const onComment  = jest.fn();

      subscribeToEventInteractions('event-abc', onReaction, onComment);

      // 두 번째 on() 호출의 세 번째 인자(콜백) 추출
      const commentCallback = mockChannelObj.on.mock.calls[1][2] as () => void;
      commentCallback();

      expect(onComment).toHaveBeenCalledTimes(1);
      expect(onReaction).not.toHaveBeenCalled();
    });
  });
});
