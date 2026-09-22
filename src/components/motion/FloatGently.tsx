/**
 * FloatGently — 자식을 위아래로 아주 천천히 둥실거리게 하는 래퍼.
 *
 * 쓰임: 빈 상태(EmptyState)의 큰 아이콘. 1.5.0 귀엽게 개편.
 * "아무것도 없다" 는 화면이 멈춰 있지 않고 살아 있는 느낌을 주는 게 목적이라
 * 움직임은 눈에 띄지 않을 만큼 작게(±4px, 한 번 오가는 데 약 3.2초) 둔다.
 *
 * 🔴 시스템 "동작 줄이기"가 켜져 있으면 움직이지 않는다(무한 반복 모션은 접근성 기준상
 *    끌 수 있어야 한다).
 */
import React, { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface FloatGentlyProps {
  children?: React.ReactNode;
  /** 오르내리는 폭(px). 기본 4 */
  distance?: number;
}

export function FloatGently({ children, distance = 4 }: FloatGentlyProps) {
  const y = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    // -distance ↔ +distance 를 부드럽게 무한 왕복(reverse=true)
    y.value = -distance;
    y.value = withRepeat(
      withTiming(distance, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    // 화면을 떠나면 반복을 멈춘다 — 안 멈추면 보이지 않는 뷰가 계속 프레임을 쓴다
    return () => cancelAnimation(y);
  }, [distance, reduceMotion, y]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
