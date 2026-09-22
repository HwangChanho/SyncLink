/**
 * PressableScale — 누르는 동안 살짝 작아졌다가 떼면 말랑하게 돌아오는 Pressable.
 *
 * 쓰임: FAB(일정·할 일 추가 버튼) 등 "눌러 보고 싶은" 큰 버튼. 1.5.0 귀엽게 개편.
 * 기존 TouchableOpacity(투명도만 바뀜) 자리에 그대로 바꿔 끼울 수 있게
 * Pressable 의 props 를 전부 받는다.
 *
 * 🔴 시스템 "동작 줄이기"가 켜져 있으면 크기 변화 대신 투명도만 살짝 바꾼다
 *    (눌렸다는 피드백 자체는 남겨야 한다).
 */
import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /** 겉모양 스타일(원·그림자 등). 애니메이션되는 바깥 뷰에 적용된다 */
  style?: StyleProp<ViewStyle>;
  /** 눌렸을 때 크기 비율. 기본 0.92 — 더 작으면 "찌그러진" 느낌이 난다 */
  scaleTo?: number;
}

export function PressableScale({
  style,
  scaleTo = 0.92,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        {...rest}
        // 바깥 뷰의 모양을 그대로 채워 누를 수 있는 영역이 줄지 않게 한다
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        onPressIn={(e) => {
          if (reduceMotion) opacity.value = withTiming(0.8, { duration: 80 });
          // 누를 때는 튕기지 않고 빠르게 들어간다(dampingRatio 1 = 임계 감쇠)
          else scale.value = withSpring(scaleTo, { duration: 150, dampingRatio: 1 });
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          if (reduceMotion) opacity.value = withTiming(1, { duration: 120 });
          // 떼는 쪽은 감쇠를 낮춰 살짝 튕기며 돌아오게 한다(말랑한 느낌의 핵심).
          // 🔴 duration + dampingRatio 로 적는다 — reanimated 4 기본 질량(4) 함정은 PopOnActivate 참고
          else scale.value = withSpring(1, { duration: 350, dampingRatio: 0.45 });
          onPressOut?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
