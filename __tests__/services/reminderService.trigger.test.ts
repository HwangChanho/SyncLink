/**
 * __tests__/services/reminderService.trigger.test.ts
 *
 * `addReminder` / `updateReminders` 의 **트리거 시각 계산**만 좁혀서 보는 스위트.
 *
 * 왜 따로 있나 — D-Day 알림이 전날 자정에 울리던 결함(`03b5d49`)의 수정은
 * 화면(`create-dday.tsx`)이 기준 시각을 목표일 **오전 9시**로 넘기는 것이었다.
 * 화면 쪽 테스트(`__tests__/screens/CreateDDayScreen.test.tsx`)는 거기까지만 잡는다.
 * 그 시각을 **실제로 알림 스케줄러에 어떻게 쓰는지**는 이 서비스의 몫이라,
 * 여기서 이어 잠근다. 둘이 합쳐져야 "화면 → DB → expo-notifications" 사슬이
 * 끊긴 데 없이 검증된다.
 *
 * 여기서 고정하는 계약:
 *   1. `triggerAt = eventStartAt − minutesBefore × 60초` 그대로 스케줄한다
 *   2. 트리거가 **과거면 조용히 스케줄하지 않는다**(행은 남고 `notif_id` 는 null)
 *   3. `minutes_before` 는 화면이 준 값 그대로 저장한다(알림 문구가 여기서 나온다)
 *
 * ⚠️ 2번은 결함이 아니라 현재 의도된 동작이다. 다만 **사용자에게 표시가 없다** —
 *    목표일이 7일 이내인데 "일주일 전"을 고르면 아무 일도 일어나지 않는다.
 *    별건으로 다룰 문제이므로, 지금 동작을 사실대로 고정해 둔다.
 *
 * 전략:
 *  - `@/lib/supabase` 직접 mock → 인증·테이블 접근 제어
 *  - `expo-notifications` 는 jest.setup.js 의 전역 mock 사용
 *    (`scheduleEventReminder` 는 실제 구현을 태워 스케줄러 인자까지 확인한다)
 *  - `Platform.OS` 를 'ios' 로 고정 → 웹 조기 반환 경로를 타지 않게 한다
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: jest.fn() as any,
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as ExpoNotifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { addReminder, updateReminders } from '@/services/reminderService';

// ─── 고정 시각 ────────────────────────────────────────────────────────────────

/** 테스트 기준 "지금". */
const NOW = new Date(2026, 8, 10, 14, 30, 0, 0);           // 2026-09-10 14:30
/** D-Day 화면이 넘기는 기준 시각 = 목표일 오전 9시. */
const NOTIFY_BASE = new Date(2026, 8, 17, 9, 0, 0, 0);     // 2026-09-17 09:00

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * `supabase.from()` 이 돌려줄 체인 mock.
 *
 * 모든 빌더 메서드가 자기 자신을 돌려주고, 체인 자체가 thenable 이라
 * `delete().eq()` 처럼 끝에서 await 하는 호출과 `insert().select().single()`
 * 처럼 `single()` 로 끝나는 호출을 한 객체로 처리한다.
 *
 * @param single - `.single()` 이 resolve 할 값
 * @param awaited - 체인을 그대로 await 했을 때 resolve 할 값
 */
function makeChain(
  single: unknown = { data: null, error: null },
  awaited: unknown = { data: [], error: null },
) {
  const promise = Promise.resolve(awaited);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    eq:     jest.fn(() => chain),
    order:  jest.fn(() => chain),
    single: jest.fn().mockResolvedValue(single),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

/** `event_reminders` INSERT 가 돌려주는 행 모양. */
const insertedRow = {
  id: 'rem-001',
  event_id: 'dday-001',
  user_id: 'user-001',
  minutes_before: 1440,
  notif_id: null,
  created_at: NOW.toISOString(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('reminderService — 트리거 시각 계산', () => {
  let chain: ReturnType<typeof makeChain>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    // 웹이면 scheduleEventReminder 가 빈 문자열로 조기 반환한다 → 네이티브로 고정
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user-001' } },
      error: null,
    });

    chain = makeChain({ data: { ...insertedRow }, error: null });
    (supabase.from as jest.Mock).mockReturnValue(chain);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('addReminder', () => {
    it('목표일 09시 − 1440분 = 전날 09시로 스케줄한다', async () => {
      await addReminder('dday-001', 1440, '전역일', NOTIFY_BASE);

      expect(ExpoNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
      const arg = (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];

      // 🔴 결함 당시에는 기준이 목표일 자정이라 여기가 09-16 00:00 이 됐다.
      expect(arg.trigger.date).toEqual(new Date(2026, 8, 16, 9, 0, 0, 0));
      expect((arg.trigger.date as Date).getHours()).toBe(9);
      expect(arg.trigger.type).toBe('date');
      expect(arg.content.title).toBe('전역일');
      expect(arg.content.data).toEqual({ eventId: 'dday-001', type: 'event_reminder' });
    });

    it('3일 전·일주일 전도 같은 규칙으로 09시에 잡힌다', async () => {
      // 목표일을 넉넉히 뒤로 둬야 세 프리셋 모두 미래가 된다.
      const farBase = new Date(2026, 9, 20, 9, 0, 0, 0); // 2026-10-20 09:00

      await addReminder('dday-001', 4320, '전역일', farBase);   // 3일 전
      await addReminder('dday-001', 10080, '전역일', farBase);  // 일주일 전

      const calls = (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mock.calls;
      expect(calls[0][0].trigger.date).toEqual(new Date(2026, 9, 17, 9, 0, 0, 0));
      expect(calls[1][0].trigger.date).toEqual(new Date(2026, 9, 13, 9, 0, 0, 0));
    });

    it('스케줄된 알림 ID 를 행에 되써 넣는다 (나중에 취소하려면 필요하다)', async () => {
      const result = await addReminder('dday-001', 1440, '전역일', NOTIFY_BASE);

      expect(chain.update).toHaveBeenCalledWith({ notif_id: 'mock-notification-id' });
      expect(result.notifId).toBe('mock-notification-id');
    });

    it('minutes_before 는 받은 값 그대로 저장한다 — 알림 문구가 여기서 나온다', async () => {
      await addReminder('dday-001', 1440, '전역일', NOTIFY_BASE);

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'dday-001',
          user_id: 'user-001',
          minutes_before: 1440,   // 09시 보정이 이 값까지 바꾸면 "1일 전"이 어긋난다
        }),
      );
      // 본문도 저장값 기준으로 만들어진다
      const arg = (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
      expect(arg.content.body).toBe('1일 전 알림');
    });

    it('트리거가 이미 지났으면 스케줄하지 않는다 (행은 남고 notif_id 는 null)', async () => {
      // 목표일이 3일 뒤인데 "일주일 전"을 고른 상황 → 트리거는 4일 전, 즉 과거.
      const nearBase = new Date(2026, 8, 13, 9, 0, 0, 0); // 2026-09-13 09:00

      const result = await addReminder('dday-001', 10080, '전역일', nearBase);

      expect(ExpoNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
      expect(chain.update).not.toHaveBeenCalled();
      expect(result.notifId).toBeNull();
      // ⚠️ 사용자에게는 아무 표시가 없다 — 별건으로 다룰 문제(현재 동작을 고정).
    });

    it('스케줄러가 실패해도 리마인더 행은 남는다', async () => {
      (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mockRejectedValueOnce(
        new Error('권한 없음'),
      );

      const result = await addReminder('dday-001', 1440, '전역일', NOTIFY_BASE);

      expect(result.id).toBe('rem-001');
      expect(result.notifId).toBeNull();
    });

    it('로그인하지 않았으면 아무것도 넣지 않는다', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      await expect(addReminder('dday-001', 1440, '전역일', NOTIFY_BASE)).rejects.toThrow(
        '로그인이 필요합니다.',
      );
      expect(chain.insert).not.toHaveBeenCalled();
      expect(ExpoNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });

  describe('updateReminders', () => {
    it('기존 알림을 취소·삭제한 뒤 새 목록을 같은 기준 시각으로 다시 잡는다', async () => {
      // 기존 행 하나가 이미 스케줄돼 있는 상태
      chain = makeChain(
        { data: { ...insertedRow }, error: null },
        {
          data: [{ ...insertedRow, id: 'rem-old', notif_id: 'old-notif' }],
          error: null,
        },
      );
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await updateReminders('dday-001', [1440], '전역일', NOTIFY_BASE);

      // 옛 알림 취소 → 행 삭제 → 새 알림 스케줄
      expect(ExpoNotifications.cancelScheduledNotificationAsync)
        .toHaveBeenCalledWith('old-notif');
      expect(chain.delete).toHaveBeenCalled();

      const arg = (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
      expect(arg.trigger.date).toEqual(new Date(2026, 8, 16, 9, 0, 0, 0));
    });

    it('같은 분 값이 겹치면 한 번만 넣는다', async () => {
      await updateReminders('dday-001', [1440, 1440, 4320], '전역일', NOTIFY_BASE);

      const minutes = chain.insert.mock.calls.map(
        (c: unknown[]) => (c[0] as { minutes_before: number }).minutes_before,
      );
      expect(minutes.sort((a: number, b: number) => a - b)).toEqual([1440, 4320]);
    });

    it('빈 목록이면 전부 지우고 새로 잡지 않는다', async () => {
      await updateReminders('dday-001', [], '전역일', NOTIFY_BASE);

      expect(chain.delete).toHaveBeenCalled();
      expect(chain.insert).not.toHaveBeenCalled();
      expect(ExpoNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });
});
