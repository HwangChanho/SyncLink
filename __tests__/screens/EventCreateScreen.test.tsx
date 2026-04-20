/**
 * __tests__/screens/EventCreateScreen.test.tsx
 *
 * TASK-211: Event CRUD Test Suite — EventCreateScreen (src/app/event/create.tsx) 유닛 테스트
 *
 * 전략:
 *  - createEvent 서비스를 jest.mock → 실제 Supabase 호출 차단
 *  - useEventStore / useSpaceStore를 jest.mock → 스토어 사이드이펙트 없는 순수 UI 테스트
 *  - Alert.alert를 jest.spyOn → 유효성 검사 및 에러 메시지 검증
 *  - useRouter mock → router.back() 호출 여부 확인
 *
 * 커버리지:
 *  렌더링       — 헤더, 제목 입력, 종일 토글, 시작/종료 행, 반복 칩, Space 공유 섹션
 *  유효성 검사  — 제목 미입력 시 Alert 표시, createEvent 미호출
 *  저장 성공    — createEvent → upsertEvent → router.back()
 *  저장 실패    — Alert('저장 실패', ...) 표시, router.back() 미호출
 *  저장 중 상태 — ActivityIndicator 표시, "저장" 텍스트 사라짐
 *  취소         — router.back() 호출
 *  allDay 토글  — 종료 행 표시/숨김, createEvent에 allDay:true 전달
 *  date 파라미터 — 날짜 pre-fill 확인
 *
 * @task TASK-211
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────
// jest.mock은 파일 최상단으로 호이스팅됨. import보다 먼저 선언해야 함.

// SafeAreaView: 네이티브 safe area inset 불필요 → 단순 View로 대체
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

// expo-router: useRouter / useLocalSearchParams를 테스트별로 제어할 수 있게 mock
// jest.setup.js의 전역 mock을 이 파일에서 override
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
  useSegments: jest.fn(() => []),
  Link: ({ children }: { children: unknown }) => children,
  Redirect: () => null,
}));

// eventService: createEvent mock — 실제 Supabase 호출 차단
jest.mock('@/services/eventService', () => ({
  createEvent: jest.fn(),
}));

// eventStore: useEventStore mock — upsertEvent 호출 여부만 검증
jest.mock('@/stores/eventStore', () => ({
  useEventStore: jest.fn(),
}));

// spaceStore: useSpaceStore mock — spaces 배열 제어
jest.mock('@/stores/spaceStore', () => ({
  useSpaceStore: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import EventCreateScreen from '@/app/event/create';
import { createEvent } from '@/services/eventService';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import type { Event, SpaceSummary } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/** createEvent 성공 반환값 픽스처 */
const mockCreatedEvent: Event = {
  id: 'evt-001',
  userId: 'user-001',
  title: '팀 미팅',
  description: null,
  location: null,
  startAt: new Date(2026, 3, 20, 9, 0),
  endAt:   new Date(2026, 3, 20, 10, 0),
  allDay: false,
  repeatType: 'none',
  repeatUntil: null,
  categoryId: null,
  color: '#7C3AED',
  sharedSpaceIds: [],
  ownerNickname: 'TestUser',
  isOwn: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Space 목록 픽스처 */
const mockSpace: SpaceSummary = {
  id: 'space-001',
  name: '우리 팀',
  type: 'couple',
  memberCount: 2,
  coverImageUrl: null,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('EventCreateScreen', () => {
  // 각 테스트에서 공유할 mock 참조
  let mockBack: jest.Mock;
  let mockUpsertEvent: jest.Mock;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // router.back에 대한 일관된 spy 생성
    mockBack = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({
      back: mockBack,
      push: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn().mockReturnValue(true),
    });

    // date 파라미터 없는 기본 상태
    (useLocalSearchParams as jest.Mock).mockReturnValue({});

    // upsertEvent spy
    mockUpsertEvent = jest.fn();
    (useEventStore as jest.Mock).mockReturnValue({ upsertEvent: mockUpsertEvent });

    // spaces 없는 기본 상태 (공유 섹션 숨김)
    (useSpaceStore as jest.Mock).mockReturnValue({ spaces: [] });

    // Alert.alert spy — 실제 Alert UI 표시 없이 호출 여부만 검증
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('렌더링', () => {
    it('"새 일정" 헤더 텍스트가 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('새 일정')).toBeTruthy();
    });

    it('"저장" 버튼이 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('저장')).toBeTruthy();
    });

    it('"취소" 버튼이 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('취소')).toBeTruthy();
    });

    it('"제목" placeholder 입력 필드가 렌더링됨', () => {
      const { getByPlaceholderText } = render(<EventCreateScreen />);
      expect(getByPlaceholderText('제목')).toBeTruthy();
    });

    it('"종일" 토글 레이블이 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('종일')).toBeTruthy();
    });

    it('"시작" 시간 행이 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('시작')).toBeTruthy();
    });

    it('"종료" 시간 행이 기본 상태(allDay=false)에서 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('종료')).toBeTruthy();
    });

    it('반복 옵션 칩 5개가 모두 렌더링됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('반복 없음')).toBeTruthy();
      expect(getByText('매일')).toBeTruthy();
      expect(getByText('매주')).toBeTruthy();
      expect(getByText('매월')).toBeTruthy();
      expect(getByText('매년')).toBeTruthy();
    });

    it('spaces가 없으면 "공유할 Space" 섹션이 렌더링되지 않음', () => {
      const { queryByText } = render(<EventCreateScreen />);
      expect(queryByText('공유할 Space')).toBeNull();
    });

    it('spaces가 있으면 Space 이름과 "공유할 Space" 레이블이 렌더링됨', () => {
      (useSpaceStore as jest.Mock).mockReturnValue({ spaces: [mockSpace] });
      const { getByText } = render(<EventCreateScreen />);
      expect(getByText('공유할 Space')).toBeTruthy();
      expect(getByText('우리 팀')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 유효성 검사
  // ══════════════════════════════════════════════════════════════════════════

  describe('유효성 검사', () => {
    it('제목 미입력 상태로 저장 시 Alert("입력 오류") 표시됨', async () => {
      const { getByText } = render(<EventCreateScreen />);

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      expect(alertSpy).toHaveBeenCalledWith('입력 오류', '제목을 입력해 주세요.');
    });

    it('제목 미입력 시 createEvent가 호출되지 않음', async () => {
      const { getByText } = render(<EventCreateScreen />);

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      expect(createEvent).not.toHaveBeenCalled();
    });

    it('제목 미입력 시 router.back()이 호출되지 않음', async () => {
      const { getByText } = render(<EventCreateScreen />);

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 저장 성공
  // ══════════════════════════════════════════════════════════════════════════

  describe('저장 성공', () => {
    it('제목 입력 후 저장 → createEvent가 1회 호출됨', async () => {
      (createEvent as jest.Mock).mockResolvedValue(mockCreatedEvent);

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(createEvent).toHaveBeenCalledTimes(1);
      });
    });

    it('제목이 trim되어 createEvent에 전달됨', async () => {
      (createEvent as jest.Mock).mockResolvedValue(mockCreatedEvent);

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '  스프린트 회의  ');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(createEvent).toHaveBeenCalledWith(
          expect.objectContaining({ title: '스프린트 회의' }),
        );
      });
    });

    it('createEvent 성공 → upsertEvent가 1회 호출됨', async () => {
      (createEvent as jest.Mock).mockResolvedValue(mockCreatedEvent);

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(mockUpsertEvent).toHaveBeenCalledTimes(1);
      });
    });

    it('createEvent 성공 → router.back()이 호출됨', async () => {
      (createEvent as jest.Mock).mockResolvedValue(mockCreatedEvent);

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(mockBack).toHaveBeenCalledTimes(1);
      });
    });

    it('저장 성공 시 Alert가 호출되지 않음', async () => {
      (createEvent as jest.Mock).mockResolvedValue(mockCreatedEvent);

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(mockBack).toHaveBeenCalled();
      });
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 저장 실패
  // ══════════════════════════════════════════════════════════════════════════

  describe('저장 실패', () => {
    it('createEvent 실패 → Alert("저장 실패", error.message) 표시됨', async () => {
      (createEvent as jest.Mock).mockRejectedValue(new Error('네트워크 오류'));

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('저장 실패', '네트워크 오류');
      });
    });

    it('createEvent 실패 → router.back()이 호출되지 않음', async () => {
      (createEvent as jest.Mock).mockRejectedValue(new Error('서버 오류'));

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalled();
      });
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('Error 인스턴스 아닌 실패값: 기본 에러 메시지("일정을 저장하지 못했습니다.") 표시됨', async () => {
      // err instanceof Error가 false인 경우
      (createEvent as jest.Mock).mockRejectedValue('unknown error');

      const { getByPlaceholderText, getByText } = render(<EventCreateScreen />);
      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('저장 실패', '일정을 저장하지 못했습니다.');
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 저장 중 상태 (isSaving)
  // ══════════════════════════════════════════════════════════════════════════

  describe('저장 중 상태', () => {
    it('저장 진행 중 "저장" 텍스트가 사라지고 ActivityIndicator가 표시됨', async () => {
      // createEvent가 resolve되지 않도록 대기 상태 유지
      let resolveSave!: (value: Event) => void;
      (createEvent as jest.Mock).mockReturnValue(
        new Promise<Event>(resolve => { resolveSave = resolve; }),
      );

      const { getByPlaceholderText, getByText, queryByText, UNSAFE_getByType } =
        render(<EventCreateScreen />);

      fireEvent.changeText(getByPlaceholderText('제목'), '팀 미팅');

      // press 후 act flush → isSaving=true 상태로 진입
      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      // isSaving=true: "저장" 텍스트 대신 ActivityIndicator 렌더링
      expect(queryByText('저장')).toBeNull();
      expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

      // cleanup: 미해결 Promise 정리
      await act(async () => { resolveSave(mockCreatedEvent); });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 취소
  // ══════════════════════════════════════════════════════════════════════════

  describe('취소', () => {
    it('"취소" 버튼 누르면 router.back()이 1회 호출됨', () => {
      const { getByText } = render(<EventCreateScreen />);
      fireEvent.press(getByText('취소'));
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // allDay 토글
  // ══════════════════════════════════════════════════════════════════════════

  describe('allDay 토글', () => {
    it('종일 토글 활성화 시 "종료" 행이 숨겨짐', () => {
      const { UNSAFE_getByType, queryByText, getByText } = render(<EventCreateScreen />);
      const { Switch } = require('react-native');

      // 초기 상태: "종료" 표시
      expect(getByText('종료')).toBeTruthy();

      // Switch를 true로 토글
      fireEvent(UNSAFE_getByType(Switch), 'valueChange', true);

      // allDay=true → !allDay 조건 false → "종료" 행 숨김
      expect(queryByText('종료')).toBeNull();
    });

    it('종일 토글 비활성화 시 "종료" 행이 다시 표시됨', () => {
      const { UNSAFE_getByType, queryByText, getByText } = render(<EventCreateScreen />);
      const { Switch } = require('react-native');

      // 켜기
      fireEvent(UNSAFE_getByType(Switch), 'valueChange', true);
      expect(queryByText('종료')).toBeNull();

      // 끄기
      fireEvent(UNSAFE_getByType(Switch), 'valueChange', false);
      expect(getByText('종료')).toBeTruthy();
    });

    it('allDay=true 로 저장 시 createEvent에 allDay:true가 전달됨', async () => {
      (createEvent as jest.Mock).mockResolvedValue({
        ...mockCreatedEvent,
        allDay: true,
      });

      const { getByPlaceholderText, getByText, UNSAFE_getByType } = render(<EventCreateScreen />);
      const { Switch } = require('react-native');

      fireEvent.changeText(getByPlaceholderText('제목'), '종일 미팅');
      fireEvent(UNSAFE_getByType(Switch), 'valueChange', true);

      await act(async () => {
        fireEvent.press(getByText('저장'));
      });

      await waitFor(() => {
        expect(createEvent).toHaveBeenCalledWith(
          expect.objectContaining({ allDay: true }),
        );
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // date 파라미터
  // ══════════════════════════════════════════════════════════════════════════

  describe('date 파라미터', () => {
    it('date=2026-04-20 파라미터가 있으면 시작 날짜에 "2026년 4월 20일"이 표시됨', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({ date: '2026-04-20' });

      const { getAllByText } = render(<EventCreateScreen />);
      // 시작/종료 행 모두 해당 날짜로 렌더링
      const dateTexts = getAllByText(/2026년 4월 20일/);
      expect(dateTexts.length).toBeGreaterThanOrEqual(1);
    });
  });
});
