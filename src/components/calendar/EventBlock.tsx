/**
 * EventBlock — display-only event card for WeekView and DayView time grids.
 *
 * Positioned absolutely within a day column.
 * Supports overlapping event layout via widthFraction / leftFraction props.
 *
 * Drag-to-reschedule lives in EventBlockGestureHandler (RNGH + Reanimated).
 * EventBlock is the simple, gesture-free render path used by tests and any
 * non-interactive surface that just needs the visual chip.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Smallest height that still renders legibly (1-line title). */
const MIN_HEIGHT = 22;

/**
 * Diameter of the owner-indicator dot rendered on Space events.
 * Kept at 7px so it remains visible without overlapping the title text.
 */
const OWNER_DOT_SIZE = 7;

interface EventBlockProps {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction?: number;
  leftFraction?: number;
  onPress: (event: EventSummary) => void;
  /**
   * Optional pre-resolved translated title (Sprint 19 TASK-1907). Falls back
   * to event.title when undefined.
   */
  translatedTitle?: string;
}

export function EventBlock({
  event,
  topOffset,
  height,
  widthFraction = 1,
  leftFraction = 0,
  onPress,
  translatedTitle,
}: EventBlockProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const blockHeight = Math.max(height, MIN_HEIGHT);
  const showSubtitle = blockHeight >= 38;
  const bgColor = `${event.color}CC`;

  return (
    <View
      testID="event-block"
      style={[
        styles.block,
        {
          backgroundColor: bgColor,
          borderLeftColor: event.color,
          top: topOffset,
          height: blockHeight,
          left: `${leftFraction * 100}%`,
          width: `${widthFraction * 100}%`,
        },
      ]}
    >
      <Text
        style={styles.title}
        numberOfLines={showSubtitle ? 2 : 1}
        onPress={() => onPress(event)}
      >
        {translatedTitle ?? event.title}
      </Text>

      {!event.isOwn && (
        <View
          testID="owner-dot"
          style={[styles.ownerDot, { backgroundColor: event.color }]}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
      color: colors.textPrimary,
    },
    ownerDot: {
      position: 'absolute',
      top: 3,
      right: 3,
      width: OWNER_DOT_SIZE,
      height: OWNER_DOT_SIZE,
      borderRadius: OWNER_DOT_SIZE / 2,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.85)',
    },
  });
}
