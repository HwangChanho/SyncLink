/**
 * EventBlock — tappable / long-press-draggable event card for WeekView and
 * DayView time grids.
 *
 * Positioned absolutely within a day column.
 * Supports overlapping event layout via widthFraction / leftFraction props.
 *
 * Interaction model:
 *  - Tap                → onPress (navigate to detail)
 *  - Long-press 500 ms  → enter drag mode (elevated, semi-transparent)
 *  - Pan during drag    → follow the finger in both axes
 *  - Release            → onReschedule(event, dayDelta, minuteDelta); the
 *                         parent converts those deltas into updated
 *                         startAt / endAt and persists via eventService
 *
 * Time snapping: 15-minute increments (HOUR_HEIGHT / 4).
 * Day snapping: the event block snaps to the nearest column by rounding
 *               (dx / columnWidth). The parent tells us the column width
 *               because only the grid knows its own layout.
 */

import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text } from 'react-native';
import type { EventSummary } from '@/types';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Smallest height that still renders legibly (1-line title). */
const MIN_HEIGHT = 22;
/** How many pixels per minute the grid uses. 60 px/hour → 1 px/min. */
const PX_PER_MINUTE = 1;
/** Minute granularity for the time snap on drop. */
const SNAP_MINUTES = 15;
/** How long the user must hold before drag begins. */
const LONG_PRESS_MS = 500;
/** How many pixels of finger movement cancels a pending long-press. */
const MOVE_CANCEL_THRESHOLD = 6;

interface EventBlockProps {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction?: number;
  leftFraction?: number;
  onPress: (event: EventSummary) => void;
  /**
   * Optional reschedule callback. When provided, long-press enables a drag
   * gesture that, on release, passes the computed day + minute deltas.
   * `dayDelta` is how many columns the block moved (-6..6 in a week view,
   * always 0 for DayView because parent passes columnWidth = 0).
   * `minuteDelta` is snapped to 15-min steps.
   */
  onReschedule?: (
    event: EventSummary,
    dayDelta: number,
    minuteDelta: number,
  ) => void;
  /**
   * Pixel width of a single day column in the parent grid. Used to convert
   * horizontal drag distance into a day delta. Pass 0 (or omit) to disable
   * horizontal snapping (DayView case).
   */
  columnWidth?: number;
  /**
   * Optional pre-resolved translated title (Sprint 19 TASK-1907). Parent
   * looks this up via useTranslatedTitles for the whole visible range so
   * we don't fetch per-block. Falls back to event.title when undefined.
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
  onReschedule,
  columnWidth = 0,
  translatedTitle,
}: EventBlockProps) {
  const blockHeight = Math.max(height, MIN_HEIGHT);
  const showSubtitle = blockHeight >= 38;
  const bgColor = `${event.color}CC`;

  // Translation for drag preview. Persistent between renders.
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [dragging, setDragging] = useState(false);

  // Refs so the PanResponder callbacks (created once) see latest values.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const tapCancelledRef = useRef(false);

  const responder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => !!onReschedule,
      onPanResponderGrant: () => {
        tapCancelledRef.current = false;
        draggingRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
          draggingRef.current = true;
          setDragging(true);
        }, LONG_PRESS_MS);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (draggingRef.current) {
          translate.setValue({ x: gestureState.dx, y: gestureState.dy });
          return;
        }
        // Cancel long-press if finger moved too far before threshold.
        if (
          Math.abs(gestureState.dx) > MOVE_CANCEL_THRESHOLD ||
          Math.abs(gestureState.dy) > MOVE_CANCEL_THRESHOLD
        ) {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
          tapCancelledRef.current = true;
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        if (draggingRef.current && onReschedule) {
          const dx = gestureState.dx;
          const dy = gestureState.dy;
          const dayDelta =
            columnWidth > 0 ? Math.round(dx / columnWidth) : 0;
          const rawMinutes = dy / PX_PER_MINUTE;
          const minuteDelta = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
          // Reset translation first so the block pops back into place; parent
          // is responsible for re-rendering with updated startAt.
          translate.setValue({ x: 0, y: 0 });
          draggingRef.current = false;
          setDragging(false);
          if (dayDelta !== 0 || minuteDelta !== 0) {
            onReschedule(event, dayDelta, minuteDelta);
          }
          return;
        }
        // Not a drag → treat as tap, unless cancelled by movement.
        translate.setValue({ x: 0, y: 0 });
        draggingRef.current = false;
        setDragging(false);
        if (!tapCancelledRef.current) {
          onPress(event);
        }
      },
      onPanResponderTerminate: () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        translate.setValue({ x: 0, y: 0 });
        draggingRef.current = false;
        setDragging(false);
      },
    }),
    // PanResponder is created once — closed-over values (event, onReschedule,
    // columnWidth, onPress) go through the callback closures above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event.id, columnWidth, !!onReschedule],
  );

  return (
    <Animated.View
      testID="event-block"
      {...responder.panHandlers}
      style={[
        styles.block,
        {
          backgroundColor: bgColor,
          borderLeftColor: event.color,
          top: topOffset,
          height: blockHeight,
          left: `${leftFraction * 100}%`,
          width: `${widthFraction * 100}%`,
          transform: translate.getTranslateTransform(),
          opacity: dragging ? 0.85 : 1,
          // Lift during drag so the block floats over neighbouring columns.
          zIndex: dragging ? 10 : 1,
          elevation: dragging ? 8 : 0,
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
    </Animated.View>
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
