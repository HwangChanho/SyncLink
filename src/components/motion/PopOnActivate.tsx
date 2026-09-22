/**
 * PopOnActivate — `active` 가 false → true 로 바뀌는 순간 한 번 "통" 튀는 래퍼.
 *
 * 쓰임: 할 일 체크박스(완료 도장). 1.5.0 「우리하루」 귀엽게 개편.
 *
 * 동작: 0.8 로 살짝 눌렸다가 → 1.15 로 부풀고 → 1 로 스프링 복귀(약 0.5초).
 *   - true → false(완료 취소)에는 튀지 않는다 — 되돌리기까지 축하할 이유는 없다.
 *   - 첫 렌더에 이미 true 인 항목(원래 완료돼 있던 할 일)도 튀지 않는다.
 *     목록을 열 때마다 완료 항목이 전부 튀면 산만하다.
 *     단, activationKey 로 "방금 켜짐" 표시가 남아 있으면 새로 마운트돼도 튄다(activationRegistry).
 *   - 🔴 시스템 "동작 줄이기"가 켜져 있으면 애니메이션하지 않는다(접근성).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { consumeJustActivated, subscribeActivation } from './activationRegistry';

interface PopOnActivateProps {
  /** 이 값이 false → true 로 바뀔 때 튄다 */
  active: boolean;
  /**
   * 재마운트 대비 식별자(선택). 켜지는 순간 행이 다른 목록으로 옮겨져 이 컴포넌트가
   * 새로 만들어지는 곳(플래너 완료 묶음)에서 쓴다. 누르는 쪽이
   * `markJustActivated(activationKey)` 를 불러 두면, 새로 마운트돼도 한 번 튄다.
   * @see activationRegistry
   */
  activationKey?: string;
  /** 감싼 뷰의 스타일(체크박스 원 모양 등을 그대로 넘긴다) */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function PopOnActivate({ active, activationKey, style, children }: PopOnActivateProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();
  // 직전 값 — 첫 렌더에는 현재 값으로 시작해 "원래 완료" 항목이 튀지 않게 한다
  const prev = useRef(active);

  // 최신 active 를 구독 콜백에서 읽기 위한 ref(콜백은 한 번만 등록한다)
  const activeRef = useRef(active);
  activeRef.current = active;

  /** 한 번 튀기기. 동작 줄이기면 아무것도 하지 않는다 */
  const pop = useCallback(() => {
    if (reduceMotion) return;
    // 🔴 부푸는 구간을 스프링으로 하면 목표(1.15)를 크게 넘어 1.42 까지 부풀고 1.5초 넘게
    //    출렁였다(웹 실측). 부풀기는 정해진 시간의 timing 으로, 복귀만 스프링으로 한다.
    //    복귀는 한 번 살짝 내려갔다 멈추는 정도(dampingRatio 0.45)면 말랑함이 충분하다.
    // 🔴 스프링은 반드시 duration + dampingRatio 로 적는다 — reanimated 4 는 기본 질량이 4 라
    //    damping/stiffness 만 적으면 감쇠비가 계산의 절반이 되어 2초 넘게 출렁였다(웹 실측).
    scale.value = withSequence(
      withTiming(0.8, { duration: 70 }),
      withTiming(1.15, { duration: 130, easing: Easing.out(Easing.quad) }),
      withSpring(1, { duration: 300, dampingRatio: 0.45 }),
    );
  }, [reduceMotion, scale]);

  // 이미 마운트된 상태에서 "방금 켜짐" 신호를 받는 경로(탭바 아이콘처럼 값이 안 바뀌는 곳)
  useEffect(() => {
    if (!activationKey) return;
    return subscribeActivation(activationKey, () => {
      // 지금 켜져 있는 인스턴스만 반응한다(탭바의 "선택 안 됨" 아이콘·완료 전 체크박스는 무시)
      if (!activeRef.current) return false;
      pop();
      return true;
    });
  }, [activationKey, pop]);

  useEffect(() => {
    const turnedOn = !prev.current && active;
    prev.current = active;
    // 같은 인스턴스에서 켜졌거나, 새로 마운트됐지만 "방금 켜짐" 표시가 남아 있으면 튄다.
    // 표시는 어느 경우든 소비해 두 번 튀지 않게 한다.
    const justMarked = activationKey ? consumeJustActivated(activationKey) : false;
    if (turnedOn || (active && justMarked)) pop();
  }, [active, activationKey, pop]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
