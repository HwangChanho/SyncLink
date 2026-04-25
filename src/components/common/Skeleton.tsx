/**
 * Skeleton — pulsing placeholder block used in place of ActivityIndicator
 * while a card is still loading data.
 *
 * Why bother:
 *   - Spinner-only loading states feel uncertain — users don't know how
 *     long they'll wait or what's coming.
 *   - Skeleton matches the eventual layout, so the reveal feels like
 *     "the data populated" rather than "a thing replaced a spinner".
 *
 * Usage:
 *   <Skeleton width={200} height={16} />
 *   <Skeleton width="80%" height={14} radius={6} />
 *
 * Sprint 18 TASK-1813.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { DimensionValue, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Border radius — small numbers for text rows, larger for avatars. */
  radius?: number;
  /** Optional outer style for layout (margins, alignSelf, etc.). */
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: SkeletonProps) {
  const colors = useColors();
  // Animated.Value 0..1 drives a gentle opacity pulse — cheaper than the
  // shimmer-gradient approach and works on every platform without extra deps.
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius: radius, opacity: pulse, backgroundColor: colors.border },
        style,
      ]}
    />
  );
}

/**
 * Convenience wrapper rendering several skeleton lines stacked vertically —
 * the common case for paragraph placeholders.
 */
export function SkeletonLines({
  lines = 3,
  spacing = 8,
  lineHeight = 14,
  widths,
  style,
}: {
  lines?: number;
  spacing?: number;
  lineHeight?: number;
  /** Optional per-line width overrides; last line typically narrower. */
  widths?: DimensionValue[];
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={widths?.[i] ?? (i === lines - 1 ? '60%' : '100%')}
          height={lineHeight}
          {...(i > 0 ? { style: { marginTop: spacing } } : {})}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
