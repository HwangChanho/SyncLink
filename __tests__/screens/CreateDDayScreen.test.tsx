/**
 * __tests__/screens/CreateDDayScreen.test.tsx
 *
 * D-Day 등록 화면(`src/app/event/create-dday.tsx`) 단위 테스트.
 *
 * 왜 이 테스트가 있나 — 2026-09-03 에 **D-Day 알림이 전날 자정에 울리는 결함**이
 * 있었다(커밋 `03b5d49`). 원인은 D-Day 가 종일 일정이라 `start_at` 이 목표일
 * **자정**인데, 알림 트리거를 거기서 `minutes_before` 만큼 빼서 계산했기 때문이다.
 * "하루 전"(1440분)이 곧 전날 00:00 이 됐다 — 자는 시간에 울린다.
 * 수정은 트리거 계산의 기준만 목표일 **오전 9시**(`NOTIFY_HOUR`)로 옮긴 것이다.
 *
 * 🔴 이 결함은 실기 검증 없이 출시됐고, 되돌아오기 쉬운 종류다. 실제 기기에서
 *    알림을 받아보는 검증은 사람만 할 수 있으므로, **계산이 어긋나는 회귀만이라도**
 *    여기서 잠근다. 즉 이 스위트가 지키는 건 두 가지다:
 *      1) `updateReminders` 에 넘어가는 기준 시각이 목표일 **09:00** 일 것
 *      2) 그 09:00 이 일정 저장(`createEvent`)에는 **새지 않을** 것
 *         (`start_at` 은 종일 일정이라 자정이어야 D-Day 배지·캘린더가 맞는다)
 *
 * 전략:
 *  - `createEvent` / `updateReminders` 를 jest.mock → Supabase·알림 스케줄러 차단
 *  - `useEventStore` 를 jest.mock → 스토어 사이드이펙트 제거
 *  - `DateTimeModal` 을 확인 버튼 하나로 대체 → 목표일 변경 경로를 제어
 *  - `jest.setSystemTime` 으로 "오늘"을 고정 → 기대값을 상수로 쓸 수 있다
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────
// jest.mock 은 파일 최상단으로 호이스팅된다. import 보다 먼저 선언해야 한다.

// SafeAreaView: 네이티브 safe area inset 불필요 → 단순 View 로 대체
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  return {
    SafeAreaView: ({ children, ...props }: { children: unknown; [key: string]: unknown }) =>
      mockReact.createElement('View', props, children),
    SafeAreaProvider: ({ children }: { children: unknown }) =>
      mockReact.createElement('View', null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// expo-router: router.back() 호출 여부를 테스트별로 확인하려고 재정의
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
  useSegments: jest.fn(() => []),
  Link: ({ children }: { children: unknown }) => children,
  Redirect: () => null,
}));

// eventService: 실제 Supabase 호출 차단
jest.mock('@/services/eventService', () => ({
  createEvent: jest.fn(),
}));

// reminderService: 이 테스트의 핵심 관측 지점 — 어떤 인자로 불렸는지만 본다
jest.mock('@/services/reminderService', () => ({
  updateReminders: jest.fn(),
}));

// eventStore: upsertEvent 호출 여부만 검증
jest.mock('@/stores/eventStore', () => ({
  useEventStore: jest.fn(),
}));

/**
 * DateTimeModal 이 확인 시 돌려줄 날짜.
 *
 * jest.mock 팩토리 안에서 참조하려면 이름이 `mock` 으로 시작해야 한다
 * (babel-plugin-jest-hoist 가 그 접두사만 호이스팅 예외로 허용한다).
 * 각 테스트에서 값을 바꿔 목표일 변경 경로를 흉내 낸다.
 */
let mockPickedDate = new Date(2026, 8, 17, 0, 0, 0, 0);

// DateTimeModal: 네이티브 피커 대신 "확인" 버튼 하나로 대체
jest.mock('@/components/common/DateTimeModal', () => {
  const mockReact = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    DateTimeModal: ({ visible, onConfirm }: { visible: boolean; onConfirm: (d: Date) => void }) =>
      visible
        ? mockReact.createElement(
            Pressable,
            { testID: 'mock-datetime-confirm', onPress: () => onConfirm(mockPickedDate) },
            mockReact.createElement(Text, null, '확인'),
          )
        : null,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import CreateDDayScreen from '@/app/event/create-dday';
import { createEvent } from '@/services/eventService';
import { updateReminders } from '@/services/reminderService';
import { useEventStore } from '@/stores/eventStore';
import type { Event } from '@/types';

// ─── 고정 시각 ────────────────────────────────────────────────────────────────

/** 테스트 기준 "지금". 자정에서 멀리 떨어뜨려 날짜 경계 오차를 없앤다. */
const NOW = new Date(2026, 8, 10, 14, 30, 0, 0);      // 2026-09-10 14:30
/** 화면이 계산할 "오늘"(자정 정규화). */
const TODAY = new Date(2026, 8, 10, 0, 0, 0, 0);      // 2026-09-10 00:00
/** 기본 목표일 — 화면 기본값은 오늘 + 7일. */
const DEFAULT_TARGET = new Date(2026, 8, 17, 0, 0, 0, 0); // 2026-09-17 00:00
/** 알림 트리거 계산의 기준 = 목표일 오전 9시. */
const DEFAULT_NOTIFY_BASE = new Date(2026, 8, 17, 9, 0, 0, 0);

/** 하루(ms) — 트리거 시각 파생 계산에 쓴다. */
const DAY_MS = 86_400_000;

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** createEvent 성공 반환값. 화면은 id·title·시각만 실제로 쓴다. */
const mockCreatedEvent: Event = {
  id: 'dday-001',
  userId: 'user-001',
  title: '전역일',
  description: null,
  location: null,
  startAt: DEFAULT_TARGET,
  endAt: DEFAULT_TARGET,
  allDay: true,
  repeatType: 'none',
  repeatUntil: null,
  categoryId: null,
  color: '#7C3AED',
  sharedSpaceIds: [],
  ownerNickname: 'TestUser',
  isOwn: true,
  createdAt: NOW,
  updatedAt: NOW,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('CreateDDayScreen', () => {
  let mockBack: jest.Mock;
  let mockUpsertEvent: jest.Mock;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // "오늘"을 고정한다 — 기본 목표일(오늘+7)과 트리거 기대값이 상수가 된다.
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    mockPickedDate = DEFAULT_TARGET;

    mockBack = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({
      back: mockBack,
      push: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn().mockReturnValue(true),
    });

    mockUpsertEvent = jest.fn();
    (useEventStore as unknown as jest.Mock).mockReturnValue({ upsertEvent: mockUpsertEvent });

    (createEvent as jest.Mock).mockResolvedValue(mockCreatedEvent);
    (updateReminders as jest.Mock).mockResolvedValue([]);

    // showAlert 는 네이티브에서 Alert.alert 로 내려간다.
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  /**
   * 제목을 채우고 저장을 누르는 공통 절차.
   *
   * @param utils  - render() 결과
   * @param title  - 입력할 제목
   */
  const fillAndSave = (utils: ReturnType<typeof render>, title = '전역일') => {
    fireEvent.changeText(utils.getByTestId('dday-title-input'), title);
    fireEvent.press(utils.getByText('저장'));
  };

  // ── 🔴 회귀 방지의 핵심 ────────────────────────────────────────────────────
  describe('알림 트리거 기준 시각 (03b5d49 회귀 방지)', () => {
    it('updateReminders 에 목표일 오전 9시를 넘긴다 — 자정이 아니다', async () => {
      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils);

      await waitFor(() => expect(updateReminders).toHaveBeenCalled());

      const [eventId, minutesList, title, notifyBase] =
        (updateReminders as jest.Mock).mock.calls[0];

      expect(eventId).toBe('dday-001');
      expect(minutesList).toEqual([1440]);          // 기본 선택 = 하루 전
      expect(title).toBe('전역일');

      // 핵심 단언 — 기준 시각이 09:00 이어야 한다.
      expect((notifyBase as Date).getTime()).toBe(DEFAULT_NOTIFY_BASE.getTime());
      expect((notifyBase as Date).getHours()).toBe(9);
      expect((notifyBase as Date).getHours()).not.toBe(0);
    });

    it('"하루 전" 은 전날 오전 9시에 울린다 — 전날 자정이 아니다', async () => {
      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils);

      await waitFor(() => expect(updateReminders).toHaveBeenCalled());

      const [, minutesList, , notifyBase] = (updateReminders as jest.Mock).mock.calls[0];

      // reminderService.addReminder 가 하는 계산을 그대로 재현한다:
      //   triggerAt = notifyBase - minutes_before * 60_000
      const triggerAt = new Date(
        (notifyBase as Date).getTime() - (minutesList as number[])[0]! * 60_000,
      );

      expect(triggerAt).toEqual(new Date(2026, 8, 16, 9, 0, 0, 0)); // 목표일 전날 09:00
      expect(triggerAt.getHours()).toBe(9);
    });

    it('3일 전·일주일 전 프리셋도 모두 오전 9시에 울린다', async () => {
      const utils = render(<CreateDDayScreen />);

      // 기본(하루 전)에 더해 나머지 두 개도 켠다 → [1440, 4320, 10080]
      fireEvent.press(utils.getByTestId('dday-reminder-3'));
      fireEvent.press(utils.getByTestId('dday-reminder-7'));
      fillAndSave(utils);

      await waitFor(() => expect(updateReminders).toHaveBeenCalled());

      const [, minutesList, , notifyBase] = (updateReminders as jest.Mock).mock.calls[0];
      expect(minutesList).toEqual([1440, 4320, 10080]);

      // 프리셋 전부를 파생 계산해 09:00 인지 확인한다. 결함 당시에는 이 셋이
      // 전부 자정이었다 — "당일(0분)만 자정"이라는 판단이 틀렸던 지점이다.
      const expected = [
        new Date(2026, 8, 16, 9, 0, 0, 0), // 1440분  = 하루 전
        new Date(2026, 8, 14, 9, 0, 0, 0), // 4320분  = 3일 전
        new Date(2026, 8, 10, 9, 0, 0, 0), // 10080분 = 일주일 전
      ];
      (minutesList as number[]).forEach((minutes, i) => {
        const triggerAt = new Date((notifyBase as Date).getTime() - minutes * 60_000);
        expect(triggerAt).toEqual(expected[i]);
        expect(triggerAt.getHours()).toBe(9);
      });
    });

    it('목표일을 바꿔도 기준은 그 날의 오전 9시다', async () => {
      // 피커가 12월 25일(시각이 섞인 값)을 돌려주는 상황
      mockPickedDate = new Date(2026, 11, 25, 13, 45, 0, 0);

      const utils = render(<CreateDDayScreen />);
      fireEvent.press(utils.getByTestId('dday-date-button'));
      fireEvent.press(utils.getByTestId('mock-datetime-confirm'));
      fillAndSave(utils, '크리스마스');

      await waitFor(() => expect(updateReminders).toHaveBeenCalled());

      const [, , , notifyBase] = (updateReminders as jest.Mock).mock.calls[0];
      // 피커가 준 13:45 는 버려지고 09:00 이 되어야 한다.
      expect(notifyBase).toEqual(new Date(2026, 11, 25, 9, 0, 0, 0));
    });
  });

  // ── 저장 구조: 알림 시각이 일정에 새지 않아야 한다 ─────────────────────────
  describe('일정 저장 구조', () => {
    it('start_at·end_at 은 목표일 자정이고 종일 일정이다', async () => {
      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils);

      await waitFor(() => expect(createEvent).toHaveBeenCalled());

      const arg = (createEvent as jest.Mock).mock.calls[0][0];
      expect(arg.allDay).toBe(true);
      expect(arg.startAt).toEqual(DEFAULT_TARGET);
      expect(arg.endAt).toEqual(DEFAULT_TARGET);
      // 🔴 NOTIFY_HOUR 가 일정 저장까지 번지면 캘린더 표시가 어긋난다.
      expect((arg.startAt as Date).getHours()).toBe(0);
    });

    it('baseDate=오늘 · offsetDays=남은 일수 로 저장한다 (DDayBadge 조건)', async () => {
      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils);

      await waitFor(() => expect(createEvent).toHaveBeenCalled());

      const arg = (createEvent as jest.Mock).mock.calls[0][0];
      expect(arg.baseDate).toEqual(TODAY);
      expect(arg.offsetDays).toBe(7);
      expect(arg.title).toBe('전역일');
    });

    it('저장 후 스토어에 넣고 화면을 닫는다', async () => {
      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils);

      await waitFor(() => expect(mockBack).toHaveBeenCalled());
      expect(mockUpsertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dday-001', allDay: true, isOwn: true }),
      );
    });
  });

  // ── 알림 선택 / 실패 처리 ─────────────────────────────────────────────────
  describe('알림 선택과 실패 처리', () => {
    it('알림을 모두 끄면 updateReminders 를 부르지 않는다', async () => {
      const utils = render(<CreateDDayScreen />);

      // 기본값 '하루 전'만 켜져 있으므로 한 번 누르면 전부 꺼진다.
      fireEvent.press(utils.getByTestId('dday-reminder-1'));
      fillAndSave(utils);

      await waitFor(() => expect(createEvent).toHaveBeenCalled());
      expect(updateReminders).not.toHaveBeenCalled();
    });

    it('알림 설정이 실패해도 일정은 저장되고 화면은 닫힌다', async () => {
      (updateReminders as jest.Mock).mockRejectedValue(new Error('네트워크 오류'));

      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils);

      // 알림 실패가 저장 자체를 되돌리면 안 된다.
      await waitFor(() => expect(mockBack).toHaveBeenCalled());
      expect(createEvent).toHaveBeenCalledTimes(1);
      expect(mockUpsertEvent).toHaveBeenCalled();
    });
  });

  // ── 유효성 검사 ───────────────────────────────────────────────────────────
  describe('유효성 검사', () => {
    it('제목이 비면 저장하지 않고 안내한다', async () => {
      const utils = render(<CreateDDayScreen />);
      fireEvent.press(utils.getByText('저장'));

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(createEvent).not.toHaveBeenCalled();
      expect(updateReminders).not.toHaveBeenCalled();
    });

    it('공백만 입력해도 저장하지 않는다', async () => {
      const utils = render(<CreateDDayScreen />);
      fillAndSave(utils, '   ');

      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(createEvent).not.toHaveBeenCalled();
    });
  });

  // ── 목표일 기본값 ─────────────────────────────────────────────────────────
  it('목표일 기본값은 일주일 뒤다', () => {
    const utils = render(<CreateDDayScreen />);
    // 화면 표기는 "2026. 9. 17." 형식
    expect(utils.getByText('2026. 9. 17.')).toBeTruthy();
    // 하루가 밀리지 않았는지 파생 확인
    expect(DEFAULT_TARGET.getTime() - TODAY.getTime()).toBe(7 * DAY_MS);
  });
});
