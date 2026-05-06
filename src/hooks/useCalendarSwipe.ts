/**
 * useCalendarSwipe — 캘린더 화면의 좌우 스와이프 네비게이션 + Animated
 * 트랜지션. PanResponder 와 Animated.Value 를 한 hook 으로 묶어서 캘린더
 * 화면이 단순히 panHandlers + 스타일만 받아 적용할 수 있게 한다.
 *
 * Phase 2.1 분할 — calendar.tsx 의 ~80 줄 짜리 swipe 로직을 옮겼다.
 *
 * 동작:
 *  - 가로 우세 + 빠른 swipe (vx > 0.3) 일 때만 PanResponder claim.
 *    느린 드래그 (vx ≈ 0) 는 EventBlock 의 RNGH 드래그라 yield.
 *  - 손가락 이동에 0.6 비율 rubber-banding.
 *  - SWIPE_THRESHOLD 이상 이동 시 commit — onShift(direction) 호출 +
 *    fly-off + 새 view slide-in 애니메이션.
 *  - isDraggingRef 가 true 면 절대 claim 안 함 (chip 드래그 보호).
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

const SWIPE_THRESHOLD = 60;
const SWIPE_RATIO = 1.5;

interface Args {
  /** 현재 view mode 를 PanResponder closure 안에서 최신 값으로 읽기 위함. */
  viewMode: string;
  /** 자식 (WeekView/DayView) 가 chip drag 모드일 때 swipe 차단. */
  isDragging: boolean;
  /** 좌우 스와이프 commit 시 호출. -1 = 이전, 1 = 다음. */
  onShift: (direction: -1 | 1) => void;
}

export function useCalendarSwipe({ viewMode, isDragging, onShift }: Args) {
  const viewModeRef = useRef(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  const isDraggingRef = useRef(isDragging);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);

  // Build-60 fix — PanResponder 가 useRef 로 한 번만 생성되므로 onShift
  // closure 도 mount 시점 값으로 고정된다. parent 의 onShift 가 viewMode
  // 를 보고 분기하는데, 옛 closure 는 옛 viewMode 만 알기 때문에 "주
  // 모드에서 1일 이동" 같은 변경이 적용되지 않는다 (LEAD 보고 "주 이동
  // 적용 안됐는데"). onShift 도 ref 로 관리해서 항상 최신 콜백을 호출.
  const onShiftRef = useRef(onShift);
  useEffect(() => { onShiftRef.current = onShift; }, [onShift]);

  const swipeX = useRef(new Animated.Value(0)).current;

  // Build-83 LEAD: month swipe 멀미. Build 82 의 setValue(0) 즉시 reset 은
  // 시각적 jolt 가 너무 큼 ("멀미남"). 짧은 timing 으로 부드러운 transition
  // — 빠르되 (180ms) 갑작스럽지 않게. spring 의 overshoot/oscillation 회피.
  // useNativeDriver 로 JS thread 의존 없이 60fps 보장.
  const animateCommit = useCallback(() => {
    Animated.timing(swipeX, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [swipeX]);

  // Build-83 LEAD: 월 뷰 셀 살짝 탭만 해도 일정 등록으로 진입하는 문제.
  // capture variant 가 자식의 TouchableOpacity 보다 우선해서 horizontal
  // 의도면 onPress 를 cancel. 임계값을 일반 ShouldSet 보다 빠르게 잡되
  // (dx>8, vx>0.15) 정적 탭은 통과시키도록 균형.
  const horizIntent = (gs: { dx: number; dy: number; vx: number }) =>
    !isDraggingRef.current &&
    viewModeRef.current !== 'week' &&
    Math.abs(gs.dx) > Math.abs(gs.dy) * SWIPE_RATIO &&
    Math.abs(gs.dx) > 8 &&
    Math.abs(gs.vx) > 0.15;

  const panResponder = useRef(
    PanResponder.create({
      // 자식 onPress 보다 우선 — 손가락 이동이 horizontal 의도면 즉시 가져와
      // 셀 탭을 cancel. 정적 탭 (dx≈0, vx≈0) 은 자식이 처리.
      onMoveShouldSetPanResponderCapture: (_, gs) => horizIntent(gs),
      onMoveShouldSetPanResponder: (_, gs) =>
        // Hard gate — chip drag 중엔 절대 claim 금지.
        !isDraggingRef.current &&
        // Build-67 LEAD bug: 주 모드에서 좌우 스와이프하면 inner WeekView 의
        // horizontal ScrollView (15-day window, 1day snap) 와 outer fly-off
        // 애니메이션이 동시에 firing 되어 "주 단위로 휙 이동" 처럼 느껴지고
        // 헤더 selectedDate 가 inner scroll 위치와 어긋남. inner 가 owns 하도록
        // outer 는 week 일 때 완전히 yield 한다. month/day 는 기존 동작 유지.
        viewModeRef.current !== 'week' &&
        Math.abs(gs.dx) > Math.abs(gs.dy) * SWIPE_RATIO &&
        Math.abs(gs.dx) > 10 &&
        Math.abs(gs.vx) > 0.3,
      onPanResponderMove: (_, gs) => {
        // Build-83 — rubber-banding 0.4 (Build 82 의 0.3 보다 살짝 ↑). 손가락
        // 추적이 너무 적으면 인터랙션 dead 같은 느낌. 적당한 시각 피드백.
        swipeX.setValue(gs.dx * 0.4);
      },
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < SWIPE_THRESHOLD) {
          // Build-83 — 짧은 timing 으로 부드러운 원위치 (120ms). spring
          // 오버슈트 없이 깔끔.
          Animated.timing(swipeX, {
            toValue: 0,
            duration: 120,
            useNativeDriver: true,
          }).start();
          return;
        }
        const direction: -1 | 1 = gs.dx < 0 ? 1 : -1;
        onShiftRef.current(direction);
        animateCommit();
      },
    }),
  ).current;

  return {
    panHandlers: panResponder.panHandlers,
    swipeX,
  };
}
