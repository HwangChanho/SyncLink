/**
 * EventBlock — tappable event card for WeekView and DayView time grids.
 *
 * Positioned absolutely within a day column.
 * Supports overlapping event layout via widthFraction / leftFraction props.
 *
 * Color usage:
 *  - Background: event.color at 80% opacity
 *  - Left border: event.color at full opacity (visual anchor)
 */

import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { EventSummary } from '@/types';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Smallest height that still renders legibly (1-line title). */
const MIN_HEIGHT = 22;

interface EventBlockProps {
  event: EventSummary;
  /**
   * Pixel distance from the top of the time container.
   * Computed from event.startAt: (hours * 60 + minutes) / 60 * HOUR_HEIGHT
   */
  topOffset: number;
  /**
   * Pixel height based on event duration.
   * Clamped to MIN_HEIGHT so very short events are still visible.
   */
  height: number;
  /**
   * Fraction of the day-column width this block should occupy (0–1).
   * Default 1 (full width). Set < 1 when overlapping events are side-by-side.
   */
  widthFraction?: number;
  /**
   * Left offset as a fraction of the day-column width (0–1).
   * Default 0. Shifts overlapping blocks into adjacent sub-columns.
   */
  leftFraction?: number;
  /** Called when the user taps the block. */
  onPress: (event: EventSummary) => void;
}

/**
 * Absolutely-positioned event card for the weekly and daily time-grid views.
 * Parent must have `position: 'relative'` and a defined height.
 */
export function EventBlock({
  event,
  topOffset,
  height,
  widthFraction = 1,
  leftFraction = 0,
  onPress,
}: EventBlockProps) {
  const blockHeight = Math.max(height, MIN_HEIGHT);
  // Only show time label if the block is tall enough
  const showSubtitle = blockHeight >= 38;

  // Build a semi-transparent background by appending hex alpha (CC = ~80%)
  const bgColor = `${event.color}CC`;

  return (
    <TouchableOpacity
      style={[
        styles.block,
        {
          backgroundColor: bgColor,
          borderLeftColor: event.color,
          top: topOffset,
          height: blockHeight,
          // Percentage strings work for absolute-positioned children in RN
          left: `${leftFraction * 100}%`,
          width: `${widthFraction * 100}%`,
        },
      ]}
      onPress={() => onPress(event)}
      activeOpacity={0.75}
    >
      <Text style={styles.title} numberOfLines={showSubtitle ? 2 : 1}>
        {event.title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  title: {
    ...textStyles.labelSm,
    color: '#1F2937',
  },
});
