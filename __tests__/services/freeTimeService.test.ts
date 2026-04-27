/**
 * __tests__/services/freeTimeService.test.ts
 *
 * Free time service 테스트 스위트
 *
 * 전략:
 *  - @/lib/supabase 전체를 mock → 실제 DB 호출 차단
 *  - makeChain() 헬퍼: Supabase 쿼리 체인을 thenable 지원
 *  - findFreeTimeSlots는 내부에서 2번의 from() 호출을 하므로
 *    mockReturnValueOnce 체이닝으로 구분:
 *    1차: space_members 쿼리, 2차: events 쿼리
 *
 * 커버리지:
 *  기본 동작     — 이벤트 없을 때 전체 범위가 free slot
 *  머지 알고리즘  — 겹치는 이벤트 머지, 연속 슬롯 사이 gap 감지
 *  멤버 없음     — space_members 빈 배열 → 빈 배열 반환
 *  미니멈 기간   — minDurationMinutes 조건 필터링
 *  에러 처리     — memberError, eventError → throw
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase';
import { findFreeTimeSlots, findFreeSlots } from '@/services/freeTimeService';
import type { DateRange } from '@/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인 mock 생성.
 */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    lte:    jest.fn().mockReturnThis(),
    gte:    jest.fn().mockReturnThis(),
    is:     jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** 1시간 범위 (09:00 ~ 10:00) */
const oneHourRange: DateRange = {
  start: new Date('2026-04-20T09:00:00.000Z'),
  end:   new Date('2026-04-20T10:00:00.000Z'),
};

/** 8시간 범위 (09:00 ~ 17:00) — 업무 시간 시뮬레이션 */
const workDayRange: DateRange = {
  start: new Date('2026-04-20T09:00:00.000Z'),
  end:   new Date('2026-04-20T17:00:00.000Z'),
};

/** 기본 멤버 응답 */
const memberData = [
  { user_id: 'user-a' },
  { user_id: 'user-b' },
];

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('findFreeTimeSlots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 멤버 없음
  // ══════════════════════════════════════════════════════════════════════════

  describe('멤버 없음', () => {
    it('space_members가 빈 배열이면 빈 배열 반환', async () => {
      const memberChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValueOnce(memberChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      expect(result).toEqual([]);
      // events 쿼리는 호출되지 않아야 함
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });

    it('space_members가 null이면 빈 배열 반환', async () => {
      const memberChain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValueOnce(memberChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      expect(result).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 이벤트 없음 (전체 범위가 free)
  // ══════════════════════════════════════════════════════════════════════════

  describe('이벤트 없음', () => {
    it('이벤트가 없으면 전체 범위를 단일 free slot으로 반환', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      expect(result).toHaveLength(1);
      expect(result[0].startAt).toEqual(workDayRange.start);
      expect(result[0].endAt).toEqual(workDayRange.end);
      // 8시간 = 480분
      expect(result[0].durationMinutes).toBe(480);
      expect(result[0].participantIds).toEqual(['user-a', 'user-b']);
    });

    it('전체 범위가 minDurationMinutes 미만이면 빈 배열 반환', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      // 1시간 범위에서 minDurationMinutes=120 설정 → 조건 미달
      const result = await findFreeTimeSlots('space-1', oneHourRange, 120);

      expect(result).toEqual([]);
    });

    it('이벤트 data가 null이면 전체 범위 free slot 반환', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      expect(result).toHaveLength(1);
      expect(result[0].durationMinutes).toBe(480);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 이벤트 있음 — gap 감지
  // ══════════════════════════════════════════════════════════════════════════

  describe('이벤트 있음 — gap 감지', () => {
    it('범위 중간에 이벤트가 있으면 앞/뒤 gap을 free slot으로 반환', async () => {
      // 11:00~12:00 이벤트 1개 (workDayRange: 09:00~17:00)
      const event = {
        user_id:  'user-a',
        start_at: '2026-04-20T11:00:00.000Z',
        end_at:   '2026-04-20T12:00:00.000Z',
        all_day:  false,
      };
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [event], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      // 09:00~11:00 (120분) + 12:00~17:00 (300분) = 2개
      expect(result).toHaveLength(2);
      expect(result[0].durationMinutes).toBe(120); // 09:00~11:00
      expect(result[1].durationMinutes).toBe(300); // 12:00~17:00
    });

    it('이벤트가 범위 시작부터 시작하면 앞 gap 없음', async () => {
      // 09:00~11:00 이벤트
      const event = {
        user_id:  'user-a',
        start_at: '2026-04-20T09:00:00.000Z',
        end_at:   '2026-04-20T11:00:00.000Z',
        all_day:  false,
      };
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [event], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      // 11:00~17:00 (360분) 1개만
      expect(result).toHaveLength(1);
      expect(result[0].durationMinutes).toBe(360);
    });

    it('이벤트가 범위 끝까지 이어지면 뒤 gap 없음', async () => {
      // 15:00~17:00 이벤트
      const event = {
        user_id:  'user-a',
        start_at: '2026-04-20T15:00:00.000Z',
        end_at:   '2026-04-20T17:00:00.000Z',
        all_day:  false,
      };
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [event], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      // 09:00~15:00 (360분) 1개만
      expect(result).toHaveLength(1);
      expect(result[0].durationMinutes).toBe(360);
    });

    it('범위 전체를 덮는 이벤트 → free slot 없음', async () => {
      // 09:00~17:00 이벤트 (workDayRange 전체)
      const event = {
        user_id:  'user-a',
        start_at: '2026-04-20T09:00:00.000Z',
        end_at:   '2026-04-20T17:00:00.000Z',
        all_day:  false,
      };
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [event], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      expect(result).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 겹치는 이벤트 머지
  // ══════════════════════════════════════════════════════════════════════════

  describe('겹치는 이벤트 머지', () => {
    it('겹치는 두 이벤트는 하나의 busy 구간으로 머지', async () => {
      // 이벤트 A: 10:00~12:00, 이벤트 B: 11:00~13:00 → 머지: 10:00~13:00
      const events = [
        { user_id: 'user-a', start_at: '2026-04-20T10:00:00.000Z', end_at: '2026-04-20T12:00:00.000Z', all_day: false },
        { user_id: 'user-b', start_at: '2026-04-20T11:00:00.000Z', end_at: '2026-04-20T13:00:00.000Z', all_day: false },
      ];
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: events, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      // 09:00~10:00 (60분) + 13:00~17:00 (240분) = 2개
      expect(result).toHaveLength(2);
      expect(result[0].durationMinutes).toBe(60);  // 09:00~10:00
      expect(result[1].durationMinutes).toBe(240); // 13:00~17:00
    });

    it('연속한 이벤트(끝-시작 일치)는 하나로 머지', async () => {
      // 이벤트 A: 10:00~11:00, 이벤트 B: 11:00~12:00 → 머지: 10:00~12:00
      const events = [
        { user_id: 'user-a', start_at: '2026-04-20T10:00:00.000Z', end_at: '2026-04-20T11:00:00.000Z', all_day: false },
        { user_id: 'user-b', start_at: '2026-04-20T11:00:00.000Z', end_at: '2026-04-20T12:00:00.000Z', all_day: false },
      ];
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: events, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      // 09:00~10:00 (60분) + 12:00~17:00 (300분) = 2개
      expect(result).toHaveLength(2);
      expect(result[0].durationMinutes).toBe(60);
      expect(result[1].durationMinutes).toBe(300);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // minDurationMinutes 필터
  // ══════════════════════════════════════════════════════════════════════════

  describe('minDurationMinutes 필터', () => {
    it('기본값(60분) 미만 gap은 제외', async () => {
      // 10:30~11:00 이벤트 → 앞 gap: 90분(통과), 뒤 gap: 30분(미달 → 제외)
      // workDayRange: 09:00~17:00이므로 뒤 gap은 11:00~17:00 = 360분(통과)
      // 하지만 gap이 짧은 경우를 테스트하기 위해 짧은 range 사용
      const shortRange: DateRange = {
        start: new Date('2026-04-20T09:00:00.000Z'),
        end:   new Date('2026-04-20T10:30:00.000Z'), // 90분 범위
      };
      const event = {
        user_id:  'user-a',
        start_at: '2026-04-20T09:30:00.000Z', // 30분 후 시작
        end_at:   '2026-04-20T10:30:00.000Z', // 범위 끝까지
        all_day:  false,
      };
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [event], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      // minDurationMinutes=60 → 09:00~09:30 (30분) gap은 제외
      const result = await findFreeTimeSlots('space-1', shortRange, 60);

      expect(result).toEqual([]);
    });

    it('minDurationMinutes=30으로 낮추면 30분 gap도 포함', async () => {
      const shortRange: DateRange = {
        start: new Date('2026-04-20T09:00:00.000Z'),
        end:   new Date('2026-04-20T10:30:00.000Z'), // 90분 범위
      };
      const event = {
        user_id:  'user-a',
        start_at: '2026-04-20T09:30:00.000Z',
        end_at:   '2026-04-20T10:30:00.000Z',
        all_day:  false,
      };
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [event], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      // minDurationMinutes=30 → 09:00~09:30 (30분) gap 포함
      const result = await findFreeTimeSlots('space-1', shortRange, 30);

      expect(result).toHaveLength(1);
      expect(result[0].durationMinutes).toBe(30);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 에러 처리
  // ══════════════════════════════════════════════════════════════════════════

  describe('에러 처리', () => {
    it('space_members 쿼리 에러 → throw', async () => {
      const memberChain = makeChain({ data: null, error: new Error('멤버 조회 실패') });
      (supabase.from as jest.Mock).mockReturnValueOnce(memberChain);

      await expect(findFreeTimeSlots('space-1', workDayRange)).rejects.toThrow('멤버 조회 실패');
    });

    it('events 쿼리 에러 → throw', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: null, error: new Error('이벤트 조회 실패') });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      await expect(findFreeTimeSlots('space-1', workDayRange)).rejects.toThrow('이벤트 조회 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DB 쿼리 조건 검증
  // ══════════════════════════════════════════════════════════════════════════

  describe('DB 쿼리 조건 검증', () => {
    it('space_members 쿼리는 space_id eq 조건 사용', async () => {
      const memberChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValueOnce(memberChain);

      await findFreeTimeSlots('space-xyz', workDayRange);

      expect(supabase.from).toHaveBeenCalledWith('space_members');
      expect(memberChain.eq).toHaveBeenCalledWith('space_id', 'space-xyz');
    });

    it('events 쿼리는 all_day=false 조건 포함 (all-day 이벤트 제외)', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      await findFreeTimeSlots('space-1', workDayRange);

      expect(supabase.from).toHaveBeenCalledWith('events');
      expect(eventChain.eq).toHaveBeenCalledWith('all_day', false);
    });

    it('events 쿼리에 날짜 범위 조건 포함', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      await findFreeTimeSlots('space-1', workDayRange);

      expect(eventChain.lte).toHaveBeenCalledWith('start_at', workDayRange.end.toISOString());
      expect(eventChain.gte).toHaveBeenCalledWith('end_at', workDayRange.start.toISOString());
    });

    it('events 쿼리에 멤버 ID 배열로 in() 조건 사용', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      await findFreeTimeSlots('space-1', workDayRange);

      expect(eventChain.in).toHaveBeenCalledWith('user_id', ['user-a', 'user-b']);
    });

    it('반환된 FreeTimeSlot에 participantIds 포함', async () => {
      const memberChain = makeChain({ data: memberData, error: null });
      const eventChain  = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(memberChain)
        .mockReturnValueOnce(eventChain);

      const result = await findFreeTimeSlots('space-1', workDayRange);

      expect(result[0].participantIds).toEqual(['user-a', 'user-b']);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// findFreeSlots (PRD 4.2 Tier 1) — 신규 API 단위 테스트
// ════════════════════════════════════════════════════════════════════════════

/**
 * findFreeSlots는 옵션 객체 시그니처와 `start`/`end` 필드 (PRD 사양) 사용.
 * - 기본 minSlotMinutes: 30 (findFreeTimeSlots의 60과 다름)
 * - participantUserIds 옵션 시 space_members 쿼리 생략
 *
 * 5개 미션 요구 케이스를 모두 커버:
 *  1. 일정 없음 → 전체 range
 *  2. 일정 1개 → 앞/뒤 2 슬롯
 *  3. 일정 2개 겹침 → 정확한 빈 슬롯
 *  4. minSlotMinutes 필터 적용
 *  5. 다중 참가자 (participantUserIds 명시) 일정 교집합
 */
describe('findFreeSlots (PRD 4.2 Tier 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. 일정 없음 → 전체 range 반환 ──────────────────────────────────────
  it('일정 없음 → 전체 range 반환 (기본 minSlotMinutes=30)', async () => {
    const memberChain = makeChain({ data: memberData, error: null });
    const eventChain  = makeChain({ data: [], error: null });
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(memberChain)
      .mockReturnValueOnce(eventChain);

    const result = await findFreeSlots('space-1', workDayRange);

    expect(result).toHaveLength(1);
    // PRD 스펙: start/end 필드 (startAt/endAt 아님)
    expect(result[0].start).toEqual(workDayRange.start);
    expect(result[0].end).toEqual(workDayRange.end);
    expect(result[0].durationMinutes).toBe(480);
  });

  // ── 2. 일정 1개 → 앞/뒤 2 슬롯 ─────────────────────────────────────────
  it('일정 1개 → 앞/뒤 2 슬롯 반환', async () => {
    // 11:00~12:00 이벤트 (workDayRange: 09:00~17:00)
    const event = {
      user_id:  'user-a',
      start_at: '2026-04-20T11:00:00.000Z',
      end_at:   '2026-04-20T12:00:00.000Z',
      all_day:  false,
    };
    const memberChain = makeChain({ data: memberData, error: null });
    const eventChain  = makeChain({ data: [event], error: null });
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(memberChain)
      .mockReturnValueOnce(eventChain);

    const result = await findFreeSlots('space-1', workDayRange);

    expect(result).toHaveLength(2);
    // 첫 슬롯: 09:00~11:00 (120분)
    expect(result[0].start).toEqual(new Date('2026-04-20T09:00:00.000Z'));
    expect(result[0].end).toEqual(new Date('2026-04-20T11:00:00.000Z'));
    expect(result[0].durationMinutes).toBe(120);
    // 둘째 슬롯: 12:00~17:00 (300분)
    expect(result[1].start).toEqual(new Date('2026-04-20T12:00:00.000Z'));
    expect(result[1].end).toEqual(new Date('2026-04-20T17:00:00.000Z'));
    expect(result[1].durationMinutes).toBe(300);
  });

  // ── 3. 일정 2개 겹침 → 정확한 빈 슬롯 ──────────────────────────────────
  it('일정 2개 겹침 → 머지 후 정확한 빈 슬롯 반환', async () => {
    // 이벤트 A: 10:00~12:00 (user-a), 이벤트 B: 11:00~14:00 (user-b)
    // 머지 결과: 10:00~14:00 → free: 09:00~10:00, 14:00~17:00
    const events = [
      { user_id: 'user-a', start_at: '2026-04-20T10:00:00.000Z', end_at: '2026-04-20T12:00:00.000Z', all_day: false },
      { user_id: 'user-b', start_at: '2026-04-20T11:00:00.000Z', end_at: '2026-04-20T14:00:00.000Z', all_day: false },
    ];
    const memberChain = makeChain({ data: memberData, error: null });
    const eventChain  = makeChain({ data: events, error: null });
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(memberChain)
      .mockReturnValueOnce(eventChain);

    const result = await findFreeSlots('space-1', workDayRange);

    expect(result).toHaveLength(2);
    expect(result[0].durationMinutes).toBe(60);  // 09:00~10:00
    expect(result[0].end).toEqual(new Date('2026-04-20T10:00:00.000Z'));
    expect(result[1].start).toEqual(new Date('2026-04-20T14:00:00.000Z'));
    expect(result[1].durationMinutes).toBe(180); // 14:00~17:00
  });

  // ── 4. minSlotMinutes 필터 적용 ────────────────────────────────────────
  it('minSlotMinutes 옵션이 짧은 gap을 필터', async () => {
    // 09:30~16:30 이벤트 → 앞 30분, 뒤 30분 gap
    const event = {
      user_id:  'user-a',
      start_at: '2026-04-20T09:30:00.000Z',
      end_at:   '2026-04-20T16:30:00.000Z',
      all_day:  false,
    };
    const memberChain = makeChain({ data: memberData, error: null });
    const eventChain  = makeChain({ data: [event], error: null });
    (supabase.from as jest.Mock)
      .mockReturnValueOnce(memberChain)
      .mockReturnValueOnce(eventChain);

    // minSlotMinutes=60 → 30분 gap 둘 다 제외
    const result = await findFreeSlots('space-1', workDayRange, { minSlotMinutes: 60 });

    expect(result).toEqual([]);
  });

  // ── 5. 다중 참가자 (participantUserIds) 일정 교집합 ────────────────────
  it('participantUserIds 옵션 시 space_members 쿼리 생략하고 지정한 user들의 교집합 계산', async () => {
    // user-c와 user-d만 명시 → space_members 쿼리는 호출되지 않음
    // 이벤트: user-c가 10:00~11:00, user-d가 14:00~15:00 → free: 3 슬롯
    const events = [
      { user_id: 'user-c', start_at: '2026-04-20T10:00:00.000Z', end_at: '2026-04-20T11:00:00.000Z', all_day: false },
      { user_id: 'user-d', start_at: '2026-04-20T14:00:00.000Z', end_at: '2026-04-20T15:00:00.000Z', all_day: false },
    ];
    const eventChain = makeChain({ data: events, error: null });
    // 첫 from() 호출이 events여야 함 (space_members 호출 없음)
    (supabase.from as jest.Mock).mockReturnValueOnce(eventChain);

    const result = await findFreeSlots(
      'space-1',
      workDayRange,
      { participantUserIds: ['user-c', 'user-d'], minSlotMinutes: 30 },
    );

    // space_members 호출 없이 events만 1회 호출
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('events');
    // 지정된 user IDs로 in() 쿼리
    expect(eventChain.in).toHaveBeenCalledWith('user_id', ['user-c', 'user-d']);

    // free 슬롯: 09:00~10:00 (60분), 11:00~14:00 (180분), 15:00~17:00 (120분)
    expect(result).toHaveLength(3);
    expect(result[0].durationMinutes).toBe(60);
    expect(result[1].durationMinutes).toBe(180);
    expect(result[2].durationMinutes).toBe(120);
  });
});
