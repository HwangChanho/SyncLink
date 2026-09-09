/**
 * createEvent 의 퍼널 계측 회귀 방지 (1.4.14).
 *
 * 왜 별도 파일인가: `eventService.test.ts` 는 계측을 mock 으로 지우고
 * 데이터 로직만 본다(그쪽 호출 횟수 단언이 흔들리지 않게). 계측이 **실제로
 * 불리는지**는 여기서만 지킨다.
 *
 * 지키는 것 — 1.4.13 까지 있던 결함이 되돌아오지 못하게:
 *  ① 일정이 만들어지면 **경로와 무관하게** `event_created` 가 남는다.
 *     (그전엔 일반 일정 폼 한 곳에서만 남겨 운동·D-Day·상대일·AI 입력바가 빠졌다.)
 *  ② 세션당 1회 억제를 풀고(`always: true`) 매번 남긴다 — 두 번째 생성도 세야 한다.
 *  ③ INSERT 가 실패하면 남기지 않는다. "만들어지지 않은 일정"을 세면 분모가 거짓이 된다.
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
  getCurrentUserId: jest.fn(),
}));

jest.mock('@/services/funnelService', () => ({
  trackFunnel: jest.fn(),
}));

// 공유·부위저장·알림은 이 파일의 관심사가 아니다.
jest.mock('@/services/eventShareService', () => ({
  shareEventToSpace: jest.fn().mockResolvedValue(undefined),
  unshareEventFromSpace: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { createEvent } from '@/services/eventService';
import { trackFunnel } from '@/services/funnelService';
import type { EventRow } from '@/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** Supabase 쿼리 체인 mock — 모든 builder 는 this, await 하면 resolvedValue. */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolvedValue),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

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

/** INSERT → getEventById(event / shares / users) 4단 체인. */
function setupCreateMocks() {
  (supabase.from as jest.Mock)
    .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
    .mockReturnValueOnce(makeChain({ data: mockEventRow, error: null }))
    .mockReturnValueOnce(makeChain({ data: [], error: null }))
    .mockReturnValueOnce(makeChain({ data: { nickname: '홍길동' }, error: null }));
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe('createEvent 퍼널 계측', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
  });

  it('일정이 만들어지면 event_created 를 남긴다', async () => {
    setupCreateMocks();

    await createEvent({ title: '새 일정', startAt: NOW, endAt: NOW_END });

    expect(trackFunnel).toHaveBeenCalledWith('event_created', { always: true });
  });

  it('세션당 1회 억제를 푼다 — 두 번 만들면 두 번 남는다', async () => {
    setupCreateMocks();
    await createEvent({ title: '첫 일정', startAt: NOW, endAt: NOW_END });
    setupCreateMocks();
    await createEvent({ title: '둘째 일정', startAt: NOW, endAt: NOW_END });

    expect(trackFunnel).toHaveBeenCalledTimes(2);
    // always 를 빠뜨리면 두 번째가 funnelService 안에서 조용히 삼켜진다.
    expect(trackFunnel).toHaveBeenNthCalledWith(2, 'event_created', { always: true });
  });

  it('운동 일정(다른 등록 경로)도 똑같이 남는다', async () => {
    setupCreateMocks();

    await createEvent({
      title: '헬스', startAt: NOW, endAt: NOW_END, eventKind: 'workout',
    });

    // 🔴 1.4.13 결함의 핵심: 화면별로 계측하면 이 경로가 빠진다.
    expect(trackFunnel).toHaveBeenCalledWith('event_created', { always: true });
  });

  it('INSERT 가 실패하면 남기지 않는다', async () => {
    // 🔑 error 는 반드시 Error 인스턴스여야 한다 — createEvent 가 받은 값을
    //    그대로 throw 하므로, 평범한 객체를 주면 rejects.toThrow() 가 안 잡힌다.
    (supabase.from as jest.Mock).mockReturnValueOnce(
      makeChain({ data: null, error: new Error('INSERT constraint') }),
    );

    await expect(
      createEvent({ title: '실패 일정', startAt: NOW, endAt: NOW_END }),
    ).rejects.toThrow('INSERT constraint');

    expect(trackFunnel).not.toHaveBeenCalled();
  });

  it('미인증이면 남기지 않는다', async () => {
    (getCurrentUserId as jest.Mock).mockResolvedValue(null);

    await expect(
      createEvent({ title: '새 일정', startAt: NOW, endAt: NOW_END }),
    ).rejects.toThrow();

    expect(trackFunnel).not.toHaveBeenCalled();
  });
});
