/**
 * EventBlockGestureHandler — TASK-009 Drag-to-Reschedule PoC (Days 1-3).
 *
 * ## What this file does (current state after Day 3)
 *
 * Day 1 — Gesture infra + visual feedback
 *   - GestureDetector (Pan) with PAN_ACTIVATION_PX dead-zone.
 *   - Reanimated shared values (translateX/Y, isActive) drive 60fps animation.
 *   - Scale lift + opacity dim while dragging.
 *
 * Day 2 — calendarGeometry integration + drop-target highlight
 *   - Accepts `columnWidth` and `slotHeight` (px/min) from WeekView via props.
 *   - Calls `computeRescheduleDelta` on every gesture update to derive a
 *     snapped hover time, which is forwarded to the parent via `onHoverSlot`.
 *   - Parent (WeekView) renders a translucent highlight at the hover slot.
 *   - On drag end the snapped (dayDelta, minuteDelta) is reported via `onDropped`.
 *     `console.log` markers from Day 1 are removed from hot paths.
 *
 * Day 3 — Optimistic update + eventService rollback
 *   - `onDropped` triggers the store upsert (optimistic), then the network call.
 *   - On network failure: rollback via second upsert + Alert.alert to user.
 *   - This component itself is stateless w.r.t. the store — the callback
 *     pattern keeps it decoupled from Zustand and usable in tests.
 *
 * ## What this file is NOT (yet)
 *   - Day 4: conflict detection (overlapping events in same space).
 *   - Day 5: month/agenda view integration + Maestro e2e.
 *
 * ## Feature flag
 *   Only rendered by WeekView when `__DEV__ && config.dragMode === 'gh'`.
 *   The production EventBlock (PanResponder) keeps shipping unchanged until
 *   Day 5 promotes this component to production.
 *
 * @task TASK-009
 */

import { useCallback, useMemo, useRef } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  applyDelta,
  computeRescheduleDelta,
  DEFAULT_PX_PER_MINUTE,
  DEFAULT_SNAP_MINUTES,
} from '@/lib/calendarGeometry';
import { useEventStore } from '@/stores/eventStore';
import { updateEvent } from '@/services/eventService';
import type { EventSummary } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Smallest rendered height (matches EventBlock). */
const MIN_HEIGHT = 22;

/**
 * Dead-zone before we steal touches from the surrounding ScrollView.
 * 8 px is the same threshold react-navigation uses for swipe-back.
 */
const PAN_ACTIVATION_PX = 8;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Payload emitted by `onDropped` (Day 3 entry point for optimistic update).
 * The parent (or a hook wrapping useEventStore + eventService) acts on this.
 */
export interface DroppedPayload {
  event:       EventSummary;
  dayDelta:    number;
  minuteDelta: number;
  newStartAt:  Date;
  newEndAt:    Date;
}

/**
 * Props for EventBlockGestureHandler.
 *
 * Surface area is deliberately kept close to EventBlock so WeekView can
 * swap them behind a feature flag without structural changes.
 */
interface EventBlockGestureHandlerProps {
  event:          EventSummary;
  topOffset:      number;
  height:         number;
  widthFraction?: number;
  leftFraction?:  number;

  /** Tap handler — fires when no pan gesture was detected. */
  onPress?: (event: EventSummary) => void;

  // ── Day 2 geometry inputs ────────────────────────────────────────────────

  /**
   * Pixel width of a single day column in the parent grid.
   * Forwarded from WeekView's `onLayout` measurement.
   * Pass 0 (or omit) for DayView where there are no horizontal columns.
   */
  columnWidth?: number;

  /**
   * Pixels per minute on the vertical time axis.
   * Defaults to DEFAULT_PX_PER_MINUTE (1 px/min = 60 px/hour,
   * matching WeekView/DayView's HOUR_HEIGHT = 60).
   */
  pxPerMinute?: number;

  /**
   * Called on every snapped position change during drag.
   * Parent uses this to render a drop-target highlight at the hover slot.
   * `null` means drag ended or was cancelled.
   *
   * @param minuteOfDay - Snapped minute-of-day (multiple of snapMinutes)
   * @param dayIndex    - 0-based day column index (0 = Sunday in WeekView)
   */
  onHoverSlot?: (minuteOfDay: number | null, dayIndex: number | null) => void;

  // ── Day 3 drop / update ──────────────────────────────────────────────────

  /**
   * Called on drop (pan end) with computed deltas + pre-computed new dates.
   * If `(dayDelta, minuteDelta) = (0, 0)` this is NOT called (no-op drop).
   *
   * Implementor responsibilities (in the parent / a hook):
   *  1. upsertEvent(optimistic snapshot) in the Zustand store.
   *  2. eventService.updateEvent(event.id, { startAt, endAt }).
   *  3. On failure: upsertEvent(original) to rollback + show Alert.
   */
  onDropped?: (payload: DroppedPayload) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GestureHandler-powered event card for WeekView/DayView time grids.
 *
 * Rendered behind a feature flag in WeekView:
 *   `__DEV__ && config.dragMode === 'gh'`
 *
 * Completely isolated from production code paths — EventBlock still ships
 * with PanResponder for all production users until Day 5.
 */
export function EventBlockGestureHandler({
  event,
  topOffset,
  height,
  widthFraction = 1,
  leftFraction  = 0,
  onPress,
  columnWidth   = 0,
  pxPerMinute   = DEFAULT_PX_PER_MINUTE,
  onHoverSlot,
  onDropped,
}: EventBlockGestureHandlerProps) {
  const blockHeight = Math.max(height, MIN_HEIGHT);
  const showSubtitle = blockHeight >= 38;
  const bgColor = `${event.color}CC`;

  // ── Reanimated shared values (UI thread, 60 fps) ─────────────────────────

  /** Cumulative finger offset from drag start (pixels). */
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  /**
   * 0 = idle, 1 = dragging. Drives the "picked up" visual effect.
   * Spring-animated so the lift/drop feels physical.
   */
  const isActive = useSharedValue(0);

  // ── Stable refs for JS-thread callbacks ──────────────────────────────────

  /**
   * Keep the latest base event reference accessible inside worklets without
   * recreating the gesture object on every re-render.
   */
  const eventRef = useRef(event);
  eventRef.current = event;

  // ── JS-thread callbacks invoked via runOnJS ───────────────────────────────

  /**
   * Compute the snapped position and notify parent of the hover slot.
   * Runs on the JS thread (called via runOnJS from the worklet).
   *
   * @param dx - Cumulative horizontal delta (px)
   * @param dy - Cumulative vertical delta (px)
   */
  const notifyHover = useCallback(
    (dx: number, dy: number) => {
      if (!onHoverSlot) return;

      const { dayDelta, minuteDelta } = computeRescheduleDelta({
        dx,
        dy,
        columnWidth,
        pxPerMinute,
        snapMinutes: DEFAULT_SNAP_MINUTES,
      });

      // Compute absolute minute-of-day for the hover slot
      const baseMinuteOfDay =
        eventRef.current.startAt.getHours() * 60 +
        eventRef.current.startAt.getMinutes();
      const hoverMinuteOfDay = Math.max(
        0,
        Math.min(baseMinuteOfDay + minuteDelta, 24 * 60 - DEFAULT_SNAP_MINUTES),
      );

      // Base day index from the event's date (0 = Sunday)
      const baseDayIndex = eventRef.current.startAt.getDay();
      const hoverDayIndex = baseDayIndex + dayDelta;

      onHoverSlot(hoverMinuteOfDay, hoverDayIndex);
    },
    [onHoverSlot, columnWidth, pxPerMinute],
  );

  /**
   * Clear the hover highlight. Called on drag end / cancellation.
   */
  const clearHover = useCallback(() => {
    onHoverSlot?.(null, null);
  }, [onHoverSlot]);

  /**
   * Handle a successful drop.
   * Computes final (dayDelta, minuteDelta) and new Date values, then calls
   * `onDropped` if the event actually moved.
   * Runs on JS thread (via runOnJS from worklet onEnd).
   */
  const handleDrop = useCallback(
    (dx: number, dy: number) => {
      if (!onDropped) return;

      const { dayDelta, minuteDelta } = computeRescheduleDelta({
        dx,
        dy,
        columnWidth,
        pxPerMinute,
        snapMinutes: DEFAULT_SNAP_MINUTES,
      });

      // No-op drop — don't call onDropped
      if (dayDelta === 0 && minuteDelta === 0) return;

      const { newStartAt, newEndAt } = applyDelta(
        eventRef.current.startAt,
        eventRef.current.endAt,
        dayDelta,
        minuteDelta,
      );

      onDropped({
        event:      eventRef.current,
        dayDelta,
        minuteDelta,
        newStartAt,
        newEndAt,
      });
    },
    [onDropped, columnWidth, pxPerMinute],
  );

  // ── Gesture definition ────────────────────────────────────────────────────

  /**
   * Build the pan gesture once per event identity.
   * Worklet closures capture stable shared-value handles; JS callbacks go
   * through runOnJS so they can access the React state and Zustand store.
   */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        // Small dead-zone prevents scroll from being hijacked by an
        // accidental slight movement during a long-press.
        .minDistance(PAN_ACTIVATION_PX)
        .onStart(() => {
          'worklet';
          // Lift the card — spring for physical feel
          isActive.value = withSpring(1);
        })
        .onUpdate((evt) => {
          'worklet';
          // Track finger 1:1 — no spring here, spring only on lift/drop
          translateX.value = evt.translationX;
          translateY.value = evt.translationY;
          // Notify JS thread about hover slot (runs asynchronously via bridge)
          runOnJS(notifyHover)(evt.translationX, evt.translationY);
        })
        .onEnd((evt) => {
          'worklet';
          // Clear hover highlight, then spring back to origin.
          // (The parent re-renders the event at its new position via store.)
          runOnJS(clearHover)();
          runOnJS(handleDrop)(evt.translationX, evt.translationY);
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
          isActive.value   = withSpring(0);
        })
        .onFinalize(() => {
          'worklet';
          // Safety net: gesture cancelled externally (e.g. another handler wins)
          if (isActive.value !== 0) {
            runOnJS(clearHover)();
            isActive.value   = withSpring(0);
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
          }
        }),
    // Recreate only when event identity or geometry props change.
    // notifyHover/clearHover/handleDrop are stable useCallback refs captured
    // via the runOnJS bridge so we don't need them in the deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event.id, columnWidth, pxPerMinute],
  );

  // ── Animated style (UI thread) ────────────────────────────────────────────

  /**
   * Drives transform + opacity from shared values. Runs entirely on the
   * UI thread — no JS bridge crossing per frame.
   */
  const animatedStyle = useAnimatedStyle(() => {
    const lift = isActive.value;
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        // 1.0 → 1.04 scale-up gives a "picked up" affordance
        { scale: 1 + lift * 0.04 },
      ],
      // Slight dimming so the block reads as "in-flight"
      opacity: 1 - lift * 0.15,
      // zIndex boost needs to come from the JS layer; handled via elevation
      // on Android and a wrapper View on iOS in future Day 5 refinement.
    };
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        testID="event-block-gh"
        style={[
          styles.block,
          {
            backgroundColor: bgColor,
            borderLeftColor: event.color,
            top:   topOffset,
            height: blockHeight,
            left:  `${leftFraction * 100}%`,
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: 'hidden',
    elevation: 1,
  },
  title: {
    ...textStyles.labelSm,
    color: '#1F2937',
  },
});

// ─── Optimistic-update hook (Day 3 logic, separated for testability) ──────────

/**
 * useOptimisticReschedule — encapsulates the optimistic-update + rollback
 * logic for drag-to-reschedule so EventBlockGestureHandler stays pure.
 *
 * Usage (in WeekView or a parent screen):
 *
 * ```tsx
 * const handleDrop = useOptimisticReschedule();
 *
 * <EventBlockGestureHandler
 *   ...
 *   onDropped={handleDrop}
 * />
 * ```
 *
 * Internals:
 *  1. Optimistically upsert the moved event into the Zustand store.
 *  2. Call eventService.updateEvent to persist.
 *  3. On failure: upsert original back + show Alert.
 *
 * The hook is declared in this file to keep the Day 3 logic co-located with
 * the component it serves. Move to a hooks/ file if it grows beyond ~60 lines.
 *
 * @returns A stable `onDropped` callback ref for use as the component prop.
 */
export function useOptimisticReschedule(): (payload: DroppedPayload) => void {
  return useCallback(async (payload: DroppedPayload) => {
    const store = useEventStore.getState();
    const originalEvent = payload.event;

    // Build the optimistic version of the event with the new times
    const optimisticEvent: EventSummary = {
      ...originalEvent,
      startAt: payload.newStartAt,
      endAt:   payload.newEndAt,
    };

    // 1. Optimistic upsert — UI responds immediately before network round-trip
    store.upsertEvent(optimisticEvent);

    try {
      // 2. Persist to Supabase via event service
      await updateEvent(originalEvent.id, {
        startAt: payload.newStartAt,
        endAt:   payload.newEndAt,
      });
    } catch {
      // 3. Network failure — rollback to original and notify user
      store.upsertEvent(originalEvent);
      Alert.alert(
        '이동 실패',
        '일정 시간을 변경하지 못했습니다. 다시 시도해 주세요.',
        [{ text: '확인' }],
      );
    }
  // useCallback with no deps — store.getState() always returns latest state,
  // and updateEvent is a stable module-level function.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) as (payload: DroppedPayload) => void;
}
