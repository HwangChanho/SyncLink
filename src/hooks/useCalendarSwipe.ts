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
import { Animated, Dimensions, PanResponder } from 'react-native';

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
  const screenWidth = Dimensions.get('window').width;

  const animateCommit = useCallback((direction: -1 | 1) => {
    Animated.sequence([
      // 현재 view 를 swipe 방향 반대편으로 날린다.
      Animated.timing(swipeX, {
        toValue: -direction * screenWidth,
        duration: 160,
        useNativeDriver: true,
      }),
      // 즉시 반대편 끝으로 워프 — 새 period 가 거기서 들어옴.
      Animated.timing(swipeX, {
        toValue: direction * screenWidth,
        duration: 0,
        useNativeDriver: true,
      }),
      Animated.spring(swipeX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
        speed: 14,
      }),
    ]).start();
  }, [swipeX, screenWidth]);

  const panResponder = useRef(
    PanResponder.create({
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
        swipeX.setValue(gs.dx * 0.6);
      },
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) < SWIPE_THRESHOLD) {
          // 임계값 미만 — 원위치 bounce.
          Animated.spring(swipeX, {
            toValue: 0, useNativeDriver: true, bounciness: 4,
          }).start();
          return;
        }
        const direction: -1 | 1 = gs.dx < 0 ? 1 : -1;
        onShiftRef.current(direction);
        animateCommit(direction);
      },
    }),
  ).current;

  return {
    panHandlers: panResponder.panHandlers,
    swipeX,
  };
}
