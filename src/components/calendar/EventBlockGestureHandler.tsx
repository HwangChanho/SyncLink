/**
 * EventBlockGestureHandler — Sprint 27 TASK-009 Day 1 PoC.
 *
 * Goal: Validate that we can replace the existing PanResponder-based
 * drag-to-reschedule gesture (see EventBlock.tsx) with the modern
 * react-native-gesture-handler v2 + react-native-reanimated v3 stack
 * recommended in `docs/plans/2026-04-28-task-009-drag-to-reschedule.md`
 * (Option A — accepted by LEAD on 2026-04-28).
 *
 * Day 1 scope (deliberately narrow — 1/5 of TASK-009):
 *   1. Wrap an event card in `GestureDetector` + `Pan().minDistance(...)`.
 *   2. Provide visual feedback during drag via a Reanimated `useSharedValue`
 *      driving a `useAnimatedStyle` translateY (and translateX). No DB
 *      mutation, no slot snapping, no parent callback wiring yet.
 *   3. Emit `console.log` markers in onStart / onUpdate / onEnd so we can
 *      eyeball gesture detection in a dev build (and produce the short
 *      capture the plan asks for).
 *   4. Stay completely isolated from production code paths so the existing
 *      EventBlock + WeekView/DayView keep working unchanged. Day 2 wires
 *      this into the real grid via `calendarGeometry.ts`.
 *
 * What this file is NOT (yet):
 *   - It does NOT call onReschedule, eventService, or any store.
 *   - It does NOT integrate with WeekView / DayView columnWidth math.
 *   - It does NOT replace EventBlock — the production component still ships
 *     with the existing PanResponder implementation until Day 3.
 *
 * Day 2 prerequisite (handed off to next session):
 *   - Build `src/lib/calendarGeometry.ts` to map screen-space (dx, dy) to
 *     (dayDelta, minuteDelta) given the parent grid's column width and
 *     pixels-per-minute. EventBlock currently computes this inline; pull
 *     it out so this PoC and the real block can share one source of truth.
 *   - Wire WeekView to render this PoC behind a feature flag for QA
 *     comparison vs PanResponder.
 */

import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { EventSummary } from '@/types';

/** Smallest height that still renders legibly (matches EventBlock). */
const MIN_HEIGHT = 22;
/**
 * Pan activation distance in pixels. We want a small dead-zone so a tap
 * doesn't get hijacked as a pan; 8 px matches the convention used by
 * react-navigation's swipe-to-go-back gesture.
 */
const PAN_ACTIVATION_PX = 8;

/**
 * Props mirror the subset of EventBlock we exercise during Day 1. Keeping
 * the surface area minimal makes the PoC easy to delete/replace in Day 2.
 */
interface EventBlockGestureHandlerProps {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction?: number;
  leftFraction?: number;
  /**
   * Tap handler. Day 1 still wires onPress so we can confirm taps and
   * pans don't fight each other once we move to GestureDetector.
   */
  onPress?: (event: EventSummary) => void;
  /**
   * Optional hook so a host (e.g. a Storybook-style dev screen) can observe
   * the lifecycle without us emitting console.log in production. Defaults
   * to a no-op; PoC dev usage just relies on the console output below.
   */
  onGestureLog?: (
    phase: 'start' | 'update' | 'end',
    payload: { translationX: number; translationY: number },
  ) => void;
}

/**
 * PoC card. Uses the same colour treatment + layout primitives as
 * EventBlock so visual diffs in QA are trivial to spot.
 */
export function EventBlockGestureHandler({
  event,
  topOffset,
  height,
  widthFraction = 1,
  leftFraction = 0,
  onPress,
  onGestureLog,
}: EventBlockGestureHandlerProps) {
  const blockHeight = Math.max(height, MIN_HEIGHT);
  const showSubtitle = blockHeight >= 38;
  const bgColor = `${event.color}CC`;

  // Shared values run on the UI thread so the visual translation is
  // produced at 60 fps without crossing the JS bridge per frame — this
  // is the headline win over the existing PanResponder implementation.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isActive = useSharedValue(0);

  /**
   * Tiny JS-thread helpers. Worklets cannot call console.log on Hermes
   * directly with formatted strings, so we hop back to JS via runOnJS.
   * In real builds this is cheap because it only fires on start/end.
   */
  const logPhase = (
    phase: 'start' | 'update' | 'end',
    translationX: number,
    translationY: number,
  ) => {
    // eslint-disable-next-line no-console
    console.log(
      `[EventBlockGestureHandler] ${phase} event=${event.id} ` +
        `dx=${translationX.toFixed(1)} dy=${translationY.toFixed(1)}`,
    );
    onGestureLog?.(phase, { translationX, translationY });
  };

  /**
   * Build the gesture once per event id. We deliberately do NOT depend on
   * onPress/onGestureLog refs here — the closure is fine for the PoC and
   * Day 2 will introduce a proper composed gesture (Tap + Long-press +
   * Pan) once we know the final activation rules.
   */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        // Require a small movement before we steal touches from the
        // surrounding ScrollView (calendar grid). Without this, every
        // attempt to scroll would trigger a drag.
        .minDistance(PAN_ACTIVATION_PX)
        .onStart((evt) => {
          'worklet';
          isActive.value = withSpring(1);
          runOnJS(logPhase)('start', evt.translationX, evt.translationY);
        })
        .onUpdate((evt) => {
          'worklet';
          // Direct assignment — no spring — so the card tracks the finger
          // 1:1. Spring is reserved for the active/inactive lift below.
          translateX.value = evt.translationX;
          translateY.value = evt.translationY;
        })
        .onEnd((evt) => {
          'worklet';
          // Day 1 has no drop target, so simply spring back to origin.
          // Day 2 will replace this with snap-to-slot via calendarGeometry.
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
          isActive.value = withSpring(0);
          runOnJS(logPhase)('end', evt.translationX, evt.translationY);
        })
        .onFinalize(() => {
          'worklet';
          // Safety net: if the gesture is cancelled (e.g. another handler
          // wins the race), make sure we still reset visual state.
          if (isActive.value !== 0) {
            isActive.value = withSpring(0);
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
          }
        }),
    // Recreate only when the event identity changes; the worklet captures
    // current shared-value handles which are stable for the component's
    // lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event.id],
  );

  /**
   * Animated style — runs entirely on the UI thread. Lifts the block
   * (opacity + zIndex hint via scale) when the user is dragging so it
   * floats above neighbouring events, mirroring native calendar UX.
   */
  const animatedStyle = useAnimatedStyle(() => {
    const lift = isActive.value;
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        // 1.0 idle → 1.04 dragging gives a subtle "picked up" affordance
        // without distorting the time-grid alignment too much.
        { scale: 1 + lift * 0.04 },
      ],
      opacity: 1 - lift * 0.15,
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        testID="event-block-gh"
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
          animatedStyle,
        ]}
      >
        <Text
          style={styles.title}
          numberOfLines={showSubtitle ? 2 : 1}
          onPress={onPress ? () => onPress(event) : undefined}
        >
          {event.title}
        </Text>
      </Animated.View>
    </GestureDetector>
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
    // Slight elevation hint so even at rest the PoC card matches the
    // EventBlock visual weight. Real elevation toggling during drag is
    // handled by animatedStyle's scale + opacity above.
    elevation: 1,
  },
  title: {
    ...textStyles.labelSm,
    color: '#1F2937',
  },
});
