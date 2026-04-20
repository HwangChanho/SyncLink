/**
 * __tests__/components/MonthView.test.tsx
 *
 * TASK-210: Calendar View Test Suite — MonthView.tsx 유닛 테스트
 *
 * 전략:
 *  - @testing-library/react-native로 컴포넌트 렌더링
 *  - 상수(colors, spacing, typography)는 순수 JS 객체이므로 mock 불필요
 *  - EventDot은 단순 View 컴포넌트, mock 없이 실제 사용
 *  - 날짜 계산 검증: buildMonthCells 내부 함수는 렌더링 결과로 간접 검증
 *
 * 커버리지:
 *  DOW 헤더         — 일~토 7개 레이블 렌더링
 *  날짜 그리드       — 28일(2월), 35일(5주) 달 셀 수 검증
 *  이전/다음달 여백  — 현재 달과 다른 달 날짜가 함께 렌더링되는지 확인
 *  EventDot          — eventsByDate에 이벤트 있는 날짜에 점 렌더링
 *  +N 오버플로우     — MAX_DOTS(3) 초과 시 "+N" 텍스트 렌더링
 *  onDateSelect      — 날짜 탭 시 콜백 호출 + 올바른 Date 전달
 *
 * @task TASK-210
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MonthView } from '@/components/calendar/MonthView';
import { EventDot } from '@/components/calendar/EventDot';
import type { EventSummary } from '@/types';

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * EventSummary 픽스처 생성 헬퍼.
 * @param overrides - 덮어쓸 필드
 */
function makeEvent(overrides: Partial<EventSummary> & { id: string }): EventSummary {
  return {
    title:   'Test Event',
    startAt: new Date('2026-02-15T09:00:00Z'),
    endAt:   new Date('2026-02-15T10:00:00Z'),
    allDay:  false,
    color:   '#6C63FF',
    isOwn:   true,
    ...overrides,
  };
}

// ─── 날짜 상수 ────────────────────────────────────────────────────────────────

/**
 * Feb 2026 (2026-02-01 = Sunday):
 *  - firstDOW = 0 → 이전 달 패딩 없음
 *  - 28일 (윤년 아님)
 *  - 28 % 7 = 0 → 다음 달 패딩 없음
 *  → 총 28개 셀 (4주 × 7일)
 */
const FEB_2026 = new Date(2026, 1, 1);

/**
 * Jan 2026 (2026-01-01 = Thursday):
 *  - firstDOW = 4 → 이전 달 패딩 4일 (Dec 28~31)
 *  - 31일
 *  - 4 + 31 = 35, 35 % 7 = 0 → 다음 달 패딩 없음
 *  → 총 35개 셀 (5주 × 7일)
 */
const JAN_2026 = new Date(2026, 0, 1);

// ─── 공통 기본 Props ──────────────────────────────────────────────────────────

const defaultProps = {
  currentMonth:  FEB_2026,
  selectedDate:  new Date(2026, 1, 15), // Feb 15
  eventsByDate:  {} as Record<string, EventSummary[]>,
  onDateSelect:  jest.fn(),
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('MonthView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DOW 헤더
  // ══════════════════════════════════════════════════════════════════════════

  describe('DOW 헤더', () => {
    it('일 월 화 수 목 금 토 7개 레이블 모두 렌더링', () => {
      const { getByText } = render(<MonthView {...defaultProps} />);

      expect(getByText('일')).toBeTruthy();
      expect(getByText('월')).toBeTruthy();
      expect(getByText('화')).toBeTruthy();
      expect(getByText('수')).toBeTruthy();
      expect(getByText('목')).toBeTruthy();
      expect(getByText('금')).toBeTruthy();
      expect(getByText('토')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 날짜 그리드 셀 수
  // ══════════════════════════════════════════════════════════════════════════

  describe('날짜 그리드', () => {
    it('Feb 2026 — 28개 날짜 숫자 렌더링 (이전/다음 달 패딩 없음)', () => {
      const { getAllByText } = render(
        <MonthView {...defaultProps} currentMonth={FEB_2026} />,
      );

      // TouchableOpacity는 accessibilityRole="button"을 명시하지 않으므로
      // getAllByRole('button') 대신 숫자 텍스트 (/^\d+$/) 카운트로 셀 수 검증.
      // Feb 2026: 패딩 없이 1~28 = 28개
      const dateCells = getAllByText(/^\d+$/);
      expect(dateCells).toHaveLength(28);
    });

    it('Feb 2026 — 날짜 1~28 모두 렌더링, 29일은 없음', () => {
      const { getByText, queryByText } = render(
        <MonthView {...defaultProps} currentMonth={FEB_2026} />,
      );

      expect(getByText('1')).toBeTruthy();
      expect(getByText('28')).toBeTruthy();
      // Feb 2026는 28일이고 다음 달 패딩도 없으므로 "29"는 렌더링되지 않아야 함
      expect(queryByText('29')).toBeNull();
    });

    it('Jan 2026 — 35개 날짜 숫자 렌더링 (이전 달 패딩 4일 포함)', () => {
      const { getAllByText } = render(
        <MonthView
          {...defaultProps}
          currentMonth={JAN_2026}
          selectedDate={new Date(2026, 0, 15)}
        />,
      );

      // Jan 2026: Dec 28,29,30,31(패딩) + Jan 1~31 = 35개
      const dateCells = getAllByText(/^\d+$/);
      expect(dateCells).toHaveLength(35);
    });

    it('Jan 2026 — 이전 달 패딩(Dec 28~31)과 현재 달(Jan 1~31) 함께 렌더링', () => {
      const { getAllByText } = render(
        <MonthView
          {...defaultProps}
          currentMonth={JAN_2026}
          selectedDate={new Date(2026, 0, 15)}
        />,
      );

      // "31"은 Dec 31(패딩)과 Jan 31(현재 달) 두 번 나타남
      expect(getAllByText('31')).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EventDot 렌더링
  // ══════════════════════════════════════════════════════════════════════════

  describe('EventDot', () => {
    it('이벤트 있는 날짜에 EventDot 컴포넌트 렌더링', () => {
      const events: EventSummary[] = [
        makeEvent({ id: 'e1', color: '#6C63FF' }),
      ];

      const { UNSAFE_getAllByType } = render(
        <MonthView
          {...defaultProps}
          eventsByDate={{ '2026-02-15': events }}
        />,
      );

      const dots = UNSAFE_getAllByType(EventDot);
      expect(dots).toHaveLength(1);
    });

    it('EventDot에 이벤트 color prop 전달', () => {
      const events: EventSummary[] = [
        makeEvent({ id: 'e1', color: '#FF6584' }),
      ];

      const { UNSAFE_getAllByType } = render(
        <MonthView
          {...defaultProps}
          eventsByDate={{ '2026-02-15': events }}
        />,
      );

      const [dot] = UNSAFE_getAllByType(EventDot);
      expect(dot!.props.color).toBe('#FF6584');
    });

    it('이벤트 없는 날짜에는 EventDot 미렌더링', () => {
      const { UNSAFE_queryAllByType } = render(
        <MonthView {...defaultProps} eventsByDate={{}} />,
      );

      expect(UNSAFE_queryAllByType(EventDot)).toHaveLength(0);
    });

    it('MAX_DOTS(3)개 이벤트 → 점 3개 렌더링', () => {
      const events: EventSummary[] = [
        makeEvent({ id: 'e1', color: '#111111' }),
        makeEvent({ id: 'e2', color: '#222222' }),
        makeEvent({ id: 'e3', color: '#333333' }),
      ];

      const { UNSAFE_getAllByType, queryByText } = render(
        <MonthView
          {...defaultProps}
          eventsByDate={{ '2026-02-15': events }}
        />,
      );

      expect(UNSAFE_getAllByType(EventDot)).toHaveLength(3);
      // 오버플로우 없음
      expect(queryByText(/^\+/)).toBeNull();
    });

    it('4개 이상 이벤트 → 점 3개 + "+N" 오버플로우 텍스트 렌더링', () => {
      const events: EventSummary[] = [
        makeEvent({ id: 'e1', color: '#111111' }),
        makeEvent({ id: 'e2', color: '#222222' }),
        makeEvent({ id: 'e3', color: '#333333' }),
        makeEvent({ id: 'e4', color: '#444444' }),
        makeEvent({ id: 'e5', color: '#555555' }),
      ];

      const { UNSAFE_getAllByType, getByText } = render(
        <MonthView
          {...defaultProps}
          eventsByDate={{ '2026-02-15': events }}
        />,
      );

      // 점은 최대 3개
      expect(UNSAFE_getAllByType(EventDot)).toHaveLength(3);
      // 오버플로우: 5 - 3 = "+2"
      expect(getByText('+2')).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // onDateSelect 콜백
  // ══════════════════════════════════════════════════════════════════════════

  describe('onDateSelect', () => {
    it('날짜 셀 탭 시 onDateSelect 콜백 호출', () => {
      const onDateSelect = jest.fn();
      const { getAllByText } = render(
        <MonthView {...defaultProps} onDateSelect={onDateSelect} />,
      );

      // Feb 2026에서 "15" 텍스트를 가진 셀 탭
      fireEvent.press(getAllByText('15')[0]!);

      expect(onDateSelect).toHaveBeenCalledTimes(1);
    });

    it('탭한 날짜에 해당하는 Date 객체 전달', () => {
      const onDateSelect = jest.fn();
      const { getAllByText } = render(
        <MonthView {...defaultProps} onDateSelect={onDateSelect} />,
      );

      fireEvent.press(getAllByText('10')[0]!);

      const calledWith: Date = onDateSelect.mock.calls[0][0];
      expect(calledWith).toBeInstanceOf(Date);
      expect(calledWith.getFullYear()).toBe(2026);
      expect(calledWith.getMonth()).toBe(1);   // 0-indexed, Feb = 1
      expect(calledWith.getDate()).toBe(10);
    });

    it('각 날짜 셀마다 독립적으로 onDateSelect 호출', () => {
      const onDateSelect = jest.fn();
      const { getAllByText } = render(
        <MonthView {...defaultProps} onDateSelect={onDateSelect} />,
      );

      fireEvent.press(getAllByText('1')[0]!);
      fireEvent.press(getAllByText('28')[0]!);

      expect(onDateSelect).toHaveBeenCalledTimes(2);
    });
  });
});
