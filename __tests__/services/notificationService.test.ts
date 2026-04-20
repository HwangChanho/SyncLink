/**
 * __tests__/services/notificationService.test.ts
 *
 * TASK-411: 알림 서비스 테스트 스위트
 *
 * 전략:
 *  - expo-notifications: jest.setup.js에서 전역 mock 처리됨
 *    (scheduleNotificationAsync → 'mock-notification-id' 반환)
 *  - @/lib/supabase: 직접 mock → registerPushToken의 users 테이블 업데이트 제어
 *  - react-native Platform.OS: jest.setup.js 이후 jest.spyOn으로 재정의
 *
 * 커버리지:
 *  requestPermission         — granted → true, denied → false, web → false
 *  registerPushToken         — 권한 획득 후 token 반환 + users 테이블 업데이트
 *  scheduleLocalNotification — scheduleNotificationAsync 호출 + notificationId 반환
 *  cancelNotification        — cancelScheduledNotificationAsync 호출
 *  cancelEventReminders      — 특정 eventId 알림만 취소
 *  initializeNotifications   — registerPushToken 호출 (non-throwing)
 *  setupNotificationHandlers — 리스너 등록 + cleanup 함수 반환
 *
 * @task TASK-411
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

// @/lib/supabase를 직접 mock → registerPushToken 내 users 테이블 업데이트 제어
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: jest.fn() as any,
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
import * as ExpoNotifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import {
  requestPermission,
  registerPushToken,
  scheduleLocalNotification,
  cancelNotification,
  cancelEventReminders,
  initializeNotifications,
  setupNotificationHandlers,
} from '@/services/notificationService';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * supabase.from() 체인 mock 생성.
 * update(...).eq(...) 체인을 지원.
 */
function makeSupabaseChain(resolvedValue: unknown = undefined) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    update: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

/**
 * Platform.OS를 테스트 내에서 임시 변경하는 헬퍼.
 * jest-expo 환경에서는 Object.defineProperty로 getter를 재정의해야 합니다.
 */
function setPlatformOS(os: string): void {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
}

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: iOS 환경 (push 알림 지원)
    setPlatformOS('ios');
  });

  afterEach(() => {
    // 테스트 후 기본값(ios) 복원
    setPlatformOS('ios');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // requestPermission
  // ══════════════════════════════════════════════════════════════════════════

  describe('requestPermission', () => {
    it('이미 권한이 granted → true 반환 (requestPermissionsAsync 미호출)', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });

      const result = await requestPermission();

      expect(result).toBe(true);
      expect(ExpoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('권한 미허용 상태에서 사용자가 허용 → true 반환', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
      });
      (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });

      const result = await requestPermission();

      expect(ExpoNotifications.requestPermissionsAsync).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('사용자가 권한 거부 → false 반환', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
      });
      (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });

      const result = await requestPermission();

      expect(result).toBe(false);
    });

    it('웹 환경(Platform.OS=web) → false 반환 (권한 API 미호출)', async () => {
      setPlatformOS('web');

      const result = await requestPermission();

      expect(result).toBe(false);
      expect(ExpoNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // registerPushToken
  // ══════════════════════════════════════════════════════════════════════════

  describe('registerPushToken', () => {
    it('권한 획득 + 토큰 취득 + users 테이블 push_token 업데이트', async () => {
      // 권한 granted
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      // 토큰 반환
      (ExpoNotifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'ExpoToken[test-token]',
      });
      // 인증 유저
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
      });
      // supabase.from().update().eq() 체인
      const chain = makeSupabaseChain();
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await registerPushToken();

      expect(result).toEqual({
        token:    'ExpoToken[test-token]',
        platform: 'ios',
      });
      // users 테이블에 push_token 업데이트 확인
      expect(supabase.from).toHaveBeenCalledWith('users');
      expect(chain.update).toHaveBeenCalledWith({ push_token: 'ExpoToken[test-token]' });
      expect(chain.eq).toHaveBeenCalledWith('id', 'user-123');
    });

    it('권한 거부 시 null 반환 (토큰 취득 시도 안 함)', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
      (ExpoNotifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

      const result = await registerPushToken();

      expect(result).toBeNull();
      expect(ExpoNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('웹 환경 → null 반환', async () => {
      setPlatformOS('web');

      const result = await registerPushToken();

      expect(result).toBeNull();
    });

    it('getExpoPushTokenAsync 실패 시 null 반환 (에러 비전파)', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (ExpoNotifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
        new Error('물리 기기 필요')
      );

      const result = await registerPushToken();

      // 에러를 throw하지 않고 null 반환해야 함
      expect(result).toBeNull();
    });

    it('로그인 안 된 경우(user=null) users 테이블 업데이트 건너뜀', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (ExpoNotifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'ExpoToken[test]',
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
      });

      const result = await registerPushToken();

      // 토큰은 반환하지만 DB 업데이트는 건너뜀
      expect(result).toEqual({ token: 'ExpoToken[test]', platform: 'ios' });
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // scheduleLocalNotification
  // ══════════════════════════════════════════════════════════════════════════

  describe('scheduleLocalNotification', () => {
    const triggerDate = new Date('2026-04-20T10:00:00.000Z');

    it('scheduleNotificationAsync 호출 후 notificationId 반환', async () => {
      (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue(
        'test-notif-id'
      );

      const id = await scheduleLocalNotification({
        title:   '알림 제목',
        body:    '알림 내용',
        trigger: triggerDate,
      });

      expect(ExpoNotifications.scheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: '알림 제목',
          body:  '알림 내용',
          data:  {},
          sound: true,
        },
        trigger: {
          type: ExpoNotifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
      expect(id).toBe('test-notif-id');
    });

    it('data 파라미터 포함 시 content.data에 전달', async () => {
      (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('id-1');

      await scheduleLocalNotification({
        title:   '제목',
        body:    '내용',
        trigger: triggerDate,
        data:    { eventId: 'event-123', type: 'reminder' },
      });

      expect(ExpoNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            data: { eventId: 'event-123', type: 'reminder' },
          }),
        })
      );
    });

    it('data 파라미터 없을 시 빈 객체로 기본값 설정', async () => {
      (ExpoNotifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('id-2');

      await scheduleLocalNotification({ title: '제목', body: '내용', trigger: triggerDate });

      expect(ExpoNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({ data: {} }),
        })
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // cancelNotification
  // ══════════════════════════════════════════════════════════════════════════

  describe('cancelNotification', () => {
    it('cancelScheduledNotificationAsync 호출 확인', async () => {
      (ExpoNotifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);

      await cancelNotification('notif-id-123');

      expect(ExpoNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
        'notif-id-123'
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // cancelEventReminders
  // ══════════════════════════════════════════════════════════════════════════

  describe('cancelEventReminders', () => {
    it('특정 eventId를 가진 알림만 취소', async () => {
      const scheduledNotifications = [
        {
          identifier: 'notif-1',
          content: { data: { eventId: 'event-abc', type: 'event_reminder' } },
        },
        {
          identifier: 'notif-2',
          content: { data: { eventId: 'event-xyz', type: 'event_reminder' } },
        },
        {
          identifier: 'notif-3',
          content: { data: { eventId: 'event-abc', type: 'event_reminder' } },
        },
      ];
      (ExpoNotifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue(
        scheduledNotifications
      );
      (ExpoNotifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);

      await cancelEventReminders('event-abc');

      // event-abc의 알림만 취소 (notif-1, notif-3)
      expect(ExpoNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
      expect(ExpoNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
      expect(ExpoNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-3');
      // event-xyz 알림은 취소 안 함
      expect(ExpoNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('notif-2');
    });

    it('해당 eventId 알림 없을 시 취소 호출 없음', async () => {
      (ExpoNotifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);

      await cancelEventReminders('event-nonexistent');

      expect(ExpoNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // initializeNotifications
  // ══════════════════════════════════════════════════════════════════════════

  describe('initializeNotifications', () => {
    it('registerPushToken 호출 (권한 요청 + 토큰 등록)', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (ExpoNotifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'ExpoToken[mock]',
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
      });
      const chain = makeSupabaseChain();
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await initializeNotifications();

      // 내부적으로 getExpoPushTokenAsync가 호출되었는지 확인
      expect(ExpoNotifications.getExpoPushTokenAsync).toHaveBeenCalled();
    });

    it('내부 오류 발생 시 에러를 throw하지 않음 (non-throwing)', async () => {
      (ExpoNotifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (ExpoNotifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
        new Error('토큰 취득 실패')
      );

      // initializeNotifications는 에러를 외부로 전파하지 않아야 함
      await expect(initializeNotifications()).resolves.toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setupNotificationHandlers
  // ══════════════════════════════════════════════════════════════════════════

  describe('setupNotificationHandlers', () => {
    it('addNotificationReceivedListener + addNotificationResponseReceivedListener 등록', () => {
      const onReceived = jest.fn();
      const onTapped   = jest.fn();

      setupNotificationHandlers(onReceived, onTapped);

      expect(ExpoNotifications.addNotificationReceivedListener).toHaveBeenCalledWith(
        expect.any(Function)
      );
      expect(ExpoNotifications.addNotificationResponseReceivedListener).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('반환된 cleanup 함수 호출 시 리스너 해제', () => {
      const removeMock = jest.fn();
      (ExpoNotifications.addNotificationReceivedListener as jest.Mock).mockReturnValue({
        remove: removeMock,
      });
      (ExpoNotifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue({
        remove: removeMock,
      });

      const cleanup = setupNotificationHandlers(jest.fn(), jest.fn());
      cleanup();

      // 두 리스너 모두 remove() 호출되어야 함
      expect(removeMock).toHaveBeenCalledTimes(2);
    });
  });
});
