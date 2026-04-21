/**
 * __tests__/components/EventCard.test.tsx
 *
 * TASK-710: Sprint 7 회귀 테스트 — EventBlock 컴포넌트 렌더링 검증
 *
 * 배경:
 *  TASK-701에서 planner.tsx의 TodoRow / NoteCard에 memo 래핑이 적용됐으며,
 *  캘린더 이벤트 카드 역할은 EventBlock 컴포넌트(calendar/EventBlock.tsx)가 담당합니다.
 *  이 파일은 EventBlock의 렌더링, props 전달, 상호작용 동작을 검증합니다.
 *
 * 전략:
 *  - @testing-library/react-native로 렌더링
 *  - StyleSheet, radius, textStyles는 순수 JS 객체 → mock 불필요
 *  - onPress 콜백 검증으로 사용자 상호작용 커버
 *
 * 커버리지:
 *  기본 렌더링    — title 텍스트 표시
 *  색상 적용      — 배경색(80% opacity hex 접미 CC), 보더 색상
 *  높이 클램핑    — MIN_HEIGHT(22) 미만 값 → 22로 고정
 *  subtitle 표시  — height >= 38 → numberOfLines=2, < 38 → numberOfLines=1
 *  onPress 콜백   — 탭 시 event 객체와 함께 호출
 *  widthFraction  — 0.5 전달 시 width="50%"
 *  leftFraction   — 0.25 전달 시 left="25%"
 *  기본값         — widthFraction/leftFraction 미전달 시 width="100%", left="0%"
 *
 * @task TASK-710
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { EventBlock } from '@/components/calendar/EventBlock';
import type { EventSummary } from '@/types';

// ─── 픽스처 ────────────────────────────────────────────────────────────────────

/**
 * EventSummary 기본 픽스처 생성 헬퍼.
 * @param overrides - 덮어쓸 필드
 */
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

/** 공통 기본 픽스처 */
const baseEvent = makeEvent({ id: 'evt-1' });

/** 기본 위치/크기 props */
const defaultLayout = {
  topOffset: 540,  // 09:00 → 9 * HOUR_HEIGHT(60) = 540
  height:    60,   // 1시간 = 1 × 60px
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
        <EventBlock
          event={baseEvent}
          {...defaultLayout}
          onPress={jest.fn()}
        />,
      );

      expect(getByText('Test Event')).toBeTruthy();
    });

    it('title이 빈 문자열인 이벤트도 에러 없이 렌더링된다', () => {
      const emptyTitleEvent = makeEvent({ id: 'evt-empty', title: '' });

      expect(() =>
        render(
          <EventBlock
            event={emptyTitleEvent}
            {...defaultLayout}
            onPress={jest.fn()}
          />,
        ),
      ).not.toThrow();
    });

    it('긴 title은 truncation 없이 렌더링된다 (numberOfLines는 Text 레벨)', () => {
      const longTitle = '매우 긴 이벤트 제목입니다: 팀 전체 킥오프 미팅 및 분기별 리뷰';
      const longEvent = makeEvent({ id: 'evt-long', title: longTitle });

      const { getByText } = render(
        <EventBlock
          event={longEvent}
          {...defaultLayout}
          onPress={jest.fn()}
        />,
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
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={colorEvent}
          {...defaultLayout}
          onPress={jest.fn()}
        />,
      );

      // TouchableOpacity의 style prop에서 backgroundColor 검증
      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, string>;

      expect(dynamicStyle.backgroundColor).toBe('#FF6584CC');
    });

    it('보더 색상은 event.color 그대로 적용된다', () => {
      const colorEvent = makeEvent({ id: 'evt-border', color: '#43E97B' });
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={colorEvent}
          {...defaultLayout}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, string>;

      expect(dynamicStyle.borderLeftColor).toBe('#43E97B');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 높이 클램핑 (MIN_HEIGHT = 22)
  // ════════════════════════════════════════════════════════════════════════════

  describe('높이 클램핑', () => {
    it('height < MIN_HEIGHT(22) 이면 실제 높이는 22로 고정된다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          topOffset={0}
          height={10}           // MIN_HEIGHT 미만
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, number>;

      expect(dynamicStyle.height).toBe(22);
    });

    it('height >= MIN_HEIGHT(22) 이면 전달된 height가 그대로 사용된다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          topOffset={0}
          height={60}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, number>;

      expect(dynamicStyle.height).toBe(60);
    });

    it('height = MIN_HEIGHT(22) 경계값은 22를 그대로 사용한다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          topOffset={0}
          height={22}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, number>;

      expect(dynamicStyle.height).toBe(22);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // subtitle 표시 조건 (height >= 38 → numberOfLines=2)
  // ════════════════════════════════════════════════════════════════════════════

  describe('subtitle 조건부 표시', () => {
    it('height >= 38 → title Text의 numberOfLines가 2이다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          topOffset={0}
          height={60}           // >= 38
          onPress={jest.fn()}
        />,
      );

      const { Text } = require('react-native');
      const textEl = UNSAFE_getByType(Text);

      expect(textEl.props.numberOfLines).toBe(2);
    });

    it('height < 38 → title Text의 numberOfLines가 1이다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          topOffset={0}
          height={30}           // < 38
          onPress={jest.fn()}
        />,
      );

      const { Text } = require('react-native');
      const textEl = UNSAFE_getByType(Text);

      expect(textEl.props.numberOfLines).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // onPress 콜백
  // ════════════════════════════════════════════════════════════════════════════

  describe('onPress 콜백', () => {
    it('블록 탭 시 onPress가 1회 호출된다', () => {
      const onPress = jest.fn();
      const { getByText } = render(
        <EventBlock
          event={baseEvent}
          {...defaultLayout}
          onPress={onPress}
        />,
      );

      fireEvent.press(getByText('Test Event'));

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('onPress에 event 객체가 전달된다', () => {
      const onPress = jest.fn();
      const eventWithData = makeEvent({ id: 'evt-press', title: '미팅', color: '#4A6CF7' });

      const { getByText } = render(
        <EventBlock
          event={eventWithData}
          {...defaultLayout}
          onPress={onPress}
        />,
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
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          {...defaultLayout}
          widthFraction={0.5}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, string>;

      expect(dynamicStyle.width).toBe('50%');
    });

    it('leftFraction=0.25 전달 시 left="25%"', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          {...defaultLayout}
          leftFraction={0.25}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, string>;

      expect(dynamicStyle.left).toBe('25%');
    });

    it('widthFraction/leftFraction 미전달 시 기본값 width="100%", left="0%"', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          {...defaultLayout}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, string>;

      expect(dynamicStyle.width).toBe('100%');
      expect(dynamicStyle.left).toBe('0%');
    });

    it('topOffset이 TouchableOpacity style에 정확히 반영된다', () => {
      const { UNSAFE_getByType } = render(
        <EventBlock
          event={baseEvent}
          topOffset={540}
          height={60}
          onPress={jest.fn()}
        />,
      );

      const { TouchableOpacity } = require('react-native');
      const touchable = UNSAFE_getByType(TouchableOpacity);
      const styleArray = touchable.props.style as Array<object>;
      const dynamicStyle = styleArray[1] as Record<string, number>;

      expect(dynamicStyle.top).toBe(540);
    });
  });
});
