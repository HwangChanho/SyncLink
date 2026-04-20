/**
 * EventDot — small colored circle for MonthView grid cells.
 *
 * Rendered in a row beneath the date number to indicate events.
 * Max 3 dots are shown per cell; overflow is handled by the parent.
 */

import { View, StyleSheet } from 'react-native';

const DOT_SIZE = 5;

interface EventDotProps {
  /** Hex color string from the event (e.g. '#6C63FF'). */
  color: string;
}

/**
 * Renders a single colored dot representing one event on a calendar day.
 * Used inside MonthView's day cells.
 */
export function EventDot({ color }: EventDotProps) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginHorizontal: 1.5,
  },
});
