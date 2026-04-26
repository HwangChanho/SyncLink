/**
 * __tests__/components/EventCard.test.tsx
 *
 * TASK-710: Sprint 7 회귀 테스트 — EventBlock 컴포넌트 렌더링 검증
 *
 * Sprint 19 업데이트: EventBlock이 TouchableOpacity → Animated.View + PanResponder로
 * 변경됨. testID="event-block" + StyleSheet.flatten으로 스타일 검증.
 * Text.onPress로 콜백 검증.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { EventBlock } from '@/components/calendar/EventBlock';
import type { EventSummary } from '@/types';

// ─── 픽스처 ────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventSummary> & { id: string }): EventSummary {
  return {
    title:   'Test Event',
    startAt: new Date('2026-04-21T09:00:00'),
    endAt:   new Date('2026-04-21T10:00:00'),
    allDay:  false,
    color:   '#6C63FF',
    isOwn:   true,
    ...overrides,
  };
}

const baseEvent = makeEvent({ id: 'evt-1' });

const defaultLayout = {
  topOffset: 540,
  height:    60,
};

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe('EventBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 기본 렌더링
  // ════════════════════════════════════════════════════════════════════════════

  describe('기본 렌더링', () => {
    it('event.title 텍스트를 화면에 렌더링한다', () => {
      const { getByText } = render(
        <EventBlock event={baseEvent} {...defaultLayout} onPress={jest.fn()} />,
      );
      expect(getByText('Test Event')).toBeTruthy();
    });

    it('title이 빈 문자열인 이벤트도 에러 없이 렌더링된다', () => {
      const emptyTitleEvent = makeEvent({ id: 'evt-empty', title: '' });
      expect(() =>
        render(<EventBlock event={emptyTitleEvent} {...defaultLayout} onPress={jest.fn()} />),
      ).not.toThrow();
    });

    it('긴 title은 truncation 없이 렌더링된다 (numberOfLines는 Text 레벨)', () => {
      const longTitle = '매우 긴 이벤트 제목입니다: 팀 전체 킥오프 미팅 및 분기별 리뷰';
      const longEvent = makeEvent({ id: 'evt-long', title: longTitle });
      const { getByText } = render(
        <EventBlock event={longEvent} {...defaultLayout} onPress={jest.fn()} />,
      );
      expect(getByText(longTitle)).toBeTruthy();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 색상 적용
  // ════════════════════════════════════════════════════════════════════════════

  describe('색상 적용', () => {
    it('배경색은 event.color + "CC" (80% 불투명도 hex) 형식이다', () => {
      const colorEvent = makeEvent({ id: 'evt-color', color: '#FF6584' });
      const { getByTestId } = render(
        <EventBlock event={colorEvent} {...defaultLayout} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.backgroundColor).toBe('#FF6584CC');
    });

    it('보더 색상은 event.color 그대로 적용된다', () => {
      const colorEvent = makeEvent({ id: 'evt-border', color: '#43E97B' });
      const { getByTestId } = render(
        <EventBlock event={colorEvent} {...defaultLayout} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.borderLeftColor).toBe('#43E97B');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 높이 클램핑 (MIN_HEIGHT = 22)
  // ════════════════════════════════════════════════════════════════════════════

  describe('높이 클램핑', () => {
    it('height < MIN_HEIGHT(22) 이면 실제 높이는 22로 고정된다', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} topOffset={0} height={10} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.height).toBe(22);
    });

    it('height >= MIN_HEIGHT(22) 이면 전달된 height가 그대로 사용된다', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} topOffset={0} height={60} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.height).toBe(60);
    });

    it('height = MIN_HEIGHT(22) 경계값은 22를 그대로 사용한다', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} topOffset={0} height={22} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.height).toBe(22);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // subtitle 표시 조건 (height >= 38 → numberOfLines=2)
  // ════════════════════════════════════════════════════════════════════════════

  describe('subtitle 조건부 표시', () => {
    it('height >= 38 → title Text의 numberOfLines가 2이다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock event={baseEvent} topOffset={0} height={60} onPress={jest.fn()} />,
      );

      const { Text } = require('react-native');
      const textEl = UNSAFE_getByType(Text);
      expect(textEl.props.numberOfLines).toBe(2);
    });

    it('height < 38 → title Text의 numberOfLines가 1이다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock event={baseEvent} topOffset={0} height={30} onPress={jest.fn()} />,
      );

      const { Text } = require('react-native');
      const textEl = UNSAFE_getByType(Text);
      expect(textEl.props.numberOfLines).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // onPress 콜백 — Text.onPress via title tap
  // ════════════════════════════════════════════════════════════════════════════

  describe('onPress 콜백', () => {
    it('블록 탭 시 onPress가 1회 호출된다', () => {
      const onPress = jest.fn();
      const { getByText } = render(
        <EventBlock event={baseEvent} {...defaultLayout} onPress={onPress} />,
      );

      fireEvent.press(getByText('Test Event'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('onPress에 event 객체가 전달된다', () => {
      const onPress = jest.fn();
      const eventWithData = makeEvent({ id: 'evt-press', title: '미팅', color: '#4A6CF7' });

      const { getByText } = render(
        <EventBlock event={eventWithData} {...defaultLayout} onPress={onPress} />,
      );

      fireEvent.press(getByText('미팅'));
      expect(onPress).toHaveBeenCalledWith(eventWithData);
    });

    it('서로 다른 event를 가진 두 블록 탭 → 각각 올바른 event 전달', () => {
      const onPress = jest.fn();
      const eventA = makeEvent({ id: 'evt-a', title: '이벤트 A' });
      const eventB = makeEvent({ id: 'evt-b', title: '이벤트 B' });

      const { getByText } = render(
        <>
          <EventBlock event={eventA} topOffset={0}   height={60} onPress={onPress} />
          <EventBlock event={eventB} topOffset={120} height={60} onPress={onPress} />
        </>,
      );

      fireEvent.press(getByText('이벤트 A'));
      expect(onPress).toHaveBeenLastCalledWith(eventA);

      fireEvent.press(getByText('이벤트 B'));
      expect(onPress).toHaveBeenLastCalledWith(eventB);

      expect(onPress).toHaveBeenCalledTimes(2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // widthFraction / leftFraction — 겹치는 이벤트 레이아웃
  // ════════════════════════════════════════════════════════════════════════════

  describe('widthFraction / leftFraction', () => {
    it('widthFraction=0.5 전달 시 width="50%"', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} {...defaultLayout} widthFraction={0.5} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.width).toBe('50%');
    });

    it('leftFraction=0.25 전달 시 left="25%"', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} {...defaultLayout} leftFraction={0.25} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.left).toBe('25%');
    });

    it('widthFraction/leftFraction 미전달 시 기본값 width="100%", left="0%"', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} {...defaultLayout} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.width).toBe('100%');
      expect(flat.left).toBe('0%');
    });

    it('topOffset이 Animated.View style에 정확히 반영된다', () => {
      const { getByTestId } = render(
        <EventBlock event={baseEvent} topOffset={540} height={60} onPress={jest.fn()} />,
      );

      const flat = StyleSheet.flatten(getByTestId('event-block').props.style);
      expect(flat.top).toBe(540);
    });
  });
});
