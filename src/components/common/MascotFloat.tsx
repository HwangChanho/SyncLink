/**
 * MascotFloat — the app mascot (둥근 일정요정) with a gentle continuous bob.
 *
 * Adds a touch of "cute diary" life to empty states / greetings. Uses the
 * built-in Animated API with useNativeDriver (matching Skeleton) — no extra
 * deps, runs on the native thread at 60fps and pauses cleanly on unmount.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Image } from 'react-native';
import type { ViewStyle } from 'react-native';

// Bundled mascot asset (512px, sourced from the confirmed iso_1 concept).
const MASCOT = require('../../../assets/mascot/fairy.png');

interface MascotFloatProps {
  /** Rendered size (square), in px. */
  size?: number;
  /** Vertical travel of the bob, in px. */
  amplitude?: number;
  /** Optional outer layout style. */
  style?: ViewStyle;
}

export function MascotFloat({ size = 140, amplitude = 10, style }: MascotFloatProps) {
  // 0..1 drives a small vertical bob — alive but not distracting.
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  // Map 0..1 → 0..-amplitude so the mascot floats upward then settles.
  const translateY = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -amplitude],
  });

  return (
    <Animated.View style={[{ transform: [{ translateY }] }, style]}>
      <Image
        source={MASCOT}
        style={{ width: size, height: size }}
        resizeMode="contain"
        // Static asset — fade-in not needed; render immediately.
        fadeDuration={0}
      />
    </Animated.View>
  );
}
