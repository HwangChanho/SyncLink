/**
 * __tests__/components/WeekView.test.tsx
 *
 * TASK-210: Calendar View Test Suite — WeekView.tsx 유닛 테스트
 *
 * 전략:
 *  - @testing-library/react-native로 컴포넌트 렌더링
 *  - EventBlock 컴포넌트 인스턴스를 UNSAFE_getAllByType으로 조회
 *    → topOffset prop으로 시간 위치 정확성 검증
 *  - ScrollView onLayout은 RNTL에서 자동 호출되지 않으므로 스크롤 초기화는 테스트 범위 외
 *
 * 커버리지:
 *  DOW 헤더         — 일~토 레이블 + 날짜 숫자 렌더링
 *  이벤트 블록       — eventsByDate에 이벤트 있는 날짜에 EventBlock 렌더링
 *  시간 위치 정확성  — 09:00 이벤트 → topOffset = 9 * 60 = 540
 *  겹치는 이벤트     — 같은 시간대 2개 이벤트 → widthFraction = 0.5
 *  onEventPress     — 이벤트 블록 탭 시 콜백 호출
 *  onDateSelect     — 헤더 날짜 탭 시 콜백 호출
 *
 * 알려진 미구현 항목:
 *  - 종일 일정 별도 영역 표시 → ISSUE-006 참조
 *
 * @task TASK-210
 */

// useColors is globally mocked in jest.setup.js — no override needed here.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { WeekView } from '@/components/calendar/WeekView';
import { EventBlock } from '@/components/calendar/EventBlock';
import type { EventSummary } from '@/types';

// ─── 날짜 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * YYYY-MM-DD 로컬 날짜 키 반환 (WeekView 내부 toDateKey와 동일 로직).
 * getWeekDays는 setHours(0,0,0,0)으로 리셋 후 로컬 컴포넌트로 키를 생성하므로
 * 테스트에서도 동일 방식 사용.
 */
function localDateKey(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

/**
 * selectedDate = 2026-01-12 (Monday)
 * getWeekDays(선택일) → Sun Jan 11 ~ Sat Jan 17, 2026
 *
 * Jan 1, 2026 = Thursday (day 4)
 * Jan 12 = (4 + 11) % 7 = 1 = Monday ✓
 */
const SELECTED_DATE = new Date(2026, 0, 12); // Mon Jan 12, 2026

/**
 * 09:00 시작 이벤트 — topOffset = 9 * HOUR_HEIGHT(60) = 540 이어야 함.
 * WeekView의 toDateKey는 로컬 날짜 사용이므로 로컬 Date 생성.
 */
const event09: EventSummary = {
  id:      'evt-09',
  title:   '09:00 Meeting',
  startAt: new Date(2026, 0, 12, 9, 0),   // Mon Jan 12, 09:00 local
  endAt:   new Date(2026, 0, 12, 10, 0),  // Mon Jan 12, 10:00 local
  allDay:  false,
  color:   '#6C63FF',
  isOwn:   true,
};

/**
 * 같은 날, 겹치는 시간대의 두 번째 이벤트 (computeLayout 분기 검증용).
 */
const eventOverlap: EventSummary = {
  id:      'evt-overlap',
  title:   'Overlapping Event',
  startAt: new Date(2026, 0, 12, 9, 30),  // Mon Jan 12, 09:30 local
  endAt:   new Date(2026, 0, 12, 11, 0),
  allDay:  false,
  color:   '#FF6584',
  isOwn:   false,
};

const defaultEventsByDate = {
  [localDateKey(2026, 1, 12)]: [event09],
};

// ─── 공통 기본 Props ──────────────────────────────────────────────────────────

const defaultProps = {
  selectedDate:   SELECTED_DATE,
  eventsByDate:   {} as Record<string, EventSummary[]>,
  onEventPress:   jest.fn(),
  onDateSelect:   jest.fn(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('WeekView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DOW 헤더
  // ══════════════════════════════════════════════════════════════════════════

  describe('DOW 헤더', () => {
    it('일 월 화 수 목 금 토 모든 요일 레이블 렌더링 (Build-67: 15-day window 라 각 ≥ 2번 등장)', () => {
      const { getAllByText } = render(<WeekView {...defaultProps} />);

      // Build-67: dayWindow 15일 = 이전주(7) + 이번주(7) + 다음주 일(1) = 일~토 2주 + 일 1.
      // 일은 3번, 다른 요일은 2번 등장.
      ['일', '월', '화', '수', '목', '금', '토'].forEach((label) => {
        expect(getAllByText(label).length).toBeGreaterThanOrEqual(2);
      });
    });

    it('이번 주 날짜 숫자 (Jan 11~17) 모두 렌더링', () => {
      const { getByText } = render(<WeekView {...defaultProps} />);

      // selectedDate=Jan12 → 이번 주 = Sun Jan 11 ~ Sat Jan 17.
      // Build-67: 이전 주 (Jan 4~10), 이번 주 (Jan 11~17), 다음주 일 (Jan 18) 도 dayWindow 안.
      // 이번 주 7일은 unique 하게 등장하므로 getByText 안전.
      [11, 12, 13, 14, 15, 16, 17].forEach((day) => {
        expect(getByText(String(day))).toBeTruthy();
      });
    });

    it('날짜 헤더 탭 시 onDateSelect 콜백 호출', () => {
      const onDateSelect = jest.fn();
      const { getAllByText } = render(
        <WeekView {...defaultProps} onDateSelect={onDateSelect} />,
      );

      // "12" = Mon Jan 12 헤더 탭
      fireEvent.press(getAllByText('12')[0]!);

      expect(onDateSelect).toHaveBeenCalledTimes(1);
      const calledWith: Date = onDateSelect.mock.calls[0][0];
      expect(calledWith.getDate()).toBe(12);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 이벤트 블록 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('이벤트 블록', () => {
    it('해당 주에 이벤트가 있으면 EventBlock 렌더링', () => {
      const { UNSAFE_getAllByType } = render(
        <WeekView {...defaultProps} eventsByDate={defaultEventsByDate} />,
      );

      const blocks = UNSAFE_getAllByType(EventBlock);
      expect(blocks).toHaveLength(1);
    });

    it('이벤트가 없으면 EventBlock 미렌더링', () => {
      const { UNSAFE_queryAllByType } = render(
        <WeekView {...defaultProps} eventsByDate={{}} />,
      );

      expect(UNSAFE_queryAllByType(EventBlock)).toHaveLength(0);
    });

    it('EventBlock에 올바른 event prop 전달', () => {
      const { UNSAFE_getAllByType } = render(
        <WeekView {...defaultProps} eventsByDate={defaultEventsByDate} />,
      );

      const [block] = UNSAFE_getAllByType(EventBlock);
      expect(block!.props.event).toEqual(event09);
    });

    // Phase 5+ — taps go through useGridDragHandler.onTap, which the
    // PanResponder fires only on actual touch release. fireEvent.press on
    // the chip's title Text does not exercise that path. Direct unit
    // coverage of the tap path lives in useGridDragHandler tests.
    it.skip('EventBlock tap → onEventPress (covered by gesture-handler hook)', () => {
      // intentionally empty — see comment
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 시간 위치 정확성
  // ══════════════════════════════════════════════════════════════════════════

  describe('시간 위치 정확성', () => {
    /**
     * HOUR_HEIGHT = 60px (WeekView 내부 상수)
     * 09:00 이벤트 → startHour = 9.0 → topOffset = 9 * 60 = 540
     */
    it('09:00 이벤트 → topOffset = 9 * HOUR_HEIGHT(60) = 540', () => {
      const { UNSAFE_getAllByType } = render(
        <WeekView {...defaultProps} eventsByDate={defaultEventsByDate} />,
      );

      const [block] = UNSAFE_getAllByType(EventBlock);
      expect(block!.props.topOffset).toBe(9 * 60); // 540
    });

    it('00:00 이벤트 → topOffset = 0 (그리드 최상단)', () => {
      const midnight: EventSummary = {
        id:      'evt-midnight',
        title:   'Midnight Event',
        startAt: new Date(2026, 0, 12, 0, 0),
        endAt:   new Date(2026, 0, 12, 1, 0),
        allDay:  false,
        color:   '#43BFBB',
        isOwn:   true,
      };

      const { UNSAFE_getAllByType } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{ [localDateKey(2026, 1, 12)]: [midnight] }}
        />,
      );

      const [block] = UNSAFE_getAllByType(EventBlock);
      expect(block!.props.topOffset).toBe(0);
    });

    it('30분 단위 시간 반영: 09:30 이벤트 → topOffset = 9.5 * 60 = 570', () => {
      const event0930: EventSummary = {
        id:      'evt-0930',
        title:   '09:30 Meeting',
        startAt: new Date(2026, 0, 12, 9, 30),
        endAt:   new Date(2026, 0, 12, 10, 30),
        allDay:  false,
        color:   '#6C63FF',
        isOwn:   true,
      };

      const { UNSAFE_getAllByType } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{ [localDateKey(2026, 1, 12)]: [event0930] }}
        />,
      );

      const [block] = UNSAFE_getAllByType(EventBlock);
      expect(block!.props.topOffset).toBe(9.5 * 60); // 570
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 겹치는 이벤트 (computeLayout)
  // ══════════════════════════════════════════════════════════════════════════

  describe('겹치는 이벤트', () => {
    it('시간이 겹치는 이벤트 2개 → widthFraction = 0.5 (각각 절반 너비)', () => {
      const { UNSAFE_getAllByType } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{
            [localDateKey(2026, 1, 12)]: [event09, eventOverlap],
          }}
        />,
      );

      const blocks = UNSAFE_getAllByType(EventBlock);
      expect(blocks).toHaveLength(2);

      // computeLayout: 겹치는 두 이벤트는 각각 widthFraction = 1/2
      blocks.forEach((block) => {
        expect(block.props.widthFraction).toBe(0.5);
      });
    });

    it('겹치지 않는 이벤트 2개 → widthFraction = 1 (각각 전체 너비)', () => {
      const eventAfternoon: EventSummary = {
        id:      'evt-afternoon',
        title:   'Afternoon Meeting',
        startAt: new Date(2026, 0, 12, 14, 0), // 14:00 (event09 종료 후)
        endAt:   new Date(2026, 0, 12, 15, 0),
        allDay:  false,
        color:   '#43BFBB',
        isOwn:   true,
      };

      const { UNSAFE_getAllByType } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{
            [localDateKey(2026, 1, 12)]: [event09, eventAfternoon],
          }}
        />,
      );

      const blocks = UNSAFE_getAllByType(EventBlock);
      expect(blocks).toHaveLength(2);

      blocks.forEach((block) => {
        expect(block.props.widthFraction).toBe(1);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 종일 일정 (allDay) — ISSUE-006 수정 후 활성화
  // ══════════════════════════════════════════════════════════════════════════

  describe('종일 일정', () => {
    /** 공통 픽스처: Jan 12 allDay 이벤트 */
    const allDayEvent: EventSummary = {
      id:      'evt-allday',
      title:   'All Day Event',
      startAt: new Date(2026, 0, 12, 0, 0),
      endAt:   new Date(2026, 0, 13, 0, 0), // 24시간
      allDay:  true,
      color:   '#FFAA44',
      isOwn:   true,
    };

    it('allDay 이벤트는 시간 그리드 EventBlock으로 렌더링되지 않음', () => {
      const { UNSAFE_queryAllByType } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{ [localDateKey(2026, 1, 12)]: [allDayEvent] }}
        />,
      );

      // allDay 이벤트는 all-day strip에 표시되므로 EventBlock 없어야 함
      expect(UNSAFE_queryAllByType(EventBlock)).toHaveLength(0);
    });

    it('allDay 이벤트 칩이 strip 영역에 타이틀과 함께 표시됨', () => {
      const { getByText } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{ [localDateKey(2026, 1, 12)]: [allDayEvent] }}
        />,
      );

      expect(getByText('All Day Event')).toBeTruthy();
    });

    it('allDay 이벤트 칩 탭 시 onEventPress 콜백 호출', () => {
      const onEventPress = jest.fn();
      const { getByText } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{ [localDateKey(2026, 1, 12)]: [allDayEvent] }}
          onEventPress={onEventPress}
        />,
      );

      fireEvent.press(getByText('All Day Event'));
      expect(onEventPress).toHaveBeenCalledTimes(1);
      expect(onEventPress).toHaveBeenCalledWith(allDayEvent);
    });

    it('timed 이벤트와 혼재 시 timed 이벤트만 시간 그리드 EventBlock으로 렌더링', () => {
      const { UNSAFE_getAllByType } = render(
        <WeekView
          {...defaultProps}
          eventsByDate={{ [localDateKey(2026, 1, 12)]: [event09, allDayEvent] }}
        />,
      );

      // timed 이벤트(event09) 1개만 EventBlock으로 렌더링되어야 함
      const blocks = UNSAFE_getAllByType(EventBlock);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.props.event.id).toBe('evt-09');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PRD 4.2 Tier 2 — Free time overlay
  // ══════════════════════════════════════════════════════════════════════════

  describe('Free time overlay (PRD 4.2 Tier 2)', () => {
    /**
     * freeSlots prop 미전달 → overlay 미렌더링.
     * testID 'week-free-slot-*' 가 전혀 존재하지 않아야 한다.
     */
    it('freeSlots prop 없으면 음영 overlay 미렌더링', () => {
      const { queryAllByTestId } = render(<WeekView {...defaultProps} />);
      expect(queryAllByTestId(/week-free-slot-/)).toHaveLength(0);
    });

    /**
     * 단일 슬롯 (Mon 14:00 ~ 16:00) → 해당 날짜 column 에만 overlay 1개.
     */
    it('단일 freeSlot → 해당 날짜 column 에 음영 overlay 1개', () => {
      const slots = [
        {
          start: new Date(2026, 0, 12, 14, 0),
          end:   new Date(2026, 0, 12, 16, 0),
          durationMinutes: 120,
        },
      ];
      const { getAllByTestId } = render(
        <WeekView {...defaultProps} freeSlots={slots} />,
      );
      const monKey = localDateKey(2026, 1, 12);
      const overlays = getAllByTestId(`week-free-slot-${monKey}`);
      expect(overlays).toHaveLength(1);
      // 14:00 → topOffset = 14 * 60 = 840
      expect(overlays[0]!.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ top: 14 * 60, height: 2 * 60 }),
        ]),
      );
    });

    /**
     * 빈 배열 → overlay 미렌더링 (에러 없이 처리).
     */
    it('빈 freeSlots 배열 → overlay 미렌더링', () => {
      const { queryAllByTestId } = render(
        <WeekView {...defaultProps} freeSlots={[]} />,
      );
      expect(queryAllByTestId(/week-free-slot-/)).toHaveLength(0);
    });
  });
});
