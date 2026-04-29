/**
 * EventBlockGestureHandler — RNGH long-press + pan event card.
 *
 * The single canonical drag-capable event chip used by WeekView and DayView.
 * Wraps an Animated.View with a Gesture.Simultaneous(LongPress, Pan) so:
 *   - LongPress (500 ms hold, 20 pt jitter tolerance) fires the haptic +
 *     visual lift the moment the threshold is reached.
 *   - Pan.activateAfterLongPress takes over the touch and tracks the finger
 *     1:1 with sharedValues (Reanimated, UI thread).
 *   - On end, the snapped (dayDelta, minuteDelta) is reported via `onDropped`
 *     while the chip springs back so the parent can re-render at the new
 *     position from the store.
 *
 * Surrounding orchestration:
 *   - WeekView/DayView use ScrollView from react-native-gesture-handler so
 *     vertical scroll vs the inner long-press are resolved natively.
 *   - calendar.tsx outer PanResponder requires `vx > 0.3` so a slow drag
 *     never gets stolen by the page-swipe handler.
 *
 * Companion modules:
 *   - UndoToast.tsx — `useUndoToast`, `<UndoToast/>` (5-second undo banner)
 *   - useOptimisticReschedule.ts — drop handler with conflict gate +
 *     optimistic store upsert + rollback
 *
 * Re-exports the legacy hook/component names so existing imports keep working.
 */

import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useColors } from '@/hooks/useColors';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  applyDelta,
  computeRescheduleDelta,
  DEFAULT_PX_PER_MINUTE,
  DEFAULT_SNAP_MINUTES,
} from '@/lib/calendarGeometry';
import type { EventSummary } from '@/types';

// Re-export the companion hooks/components so consumers can still do
// `import { UndoToast, useUndoToast, useOptimisticReschedule } from './EventBlockGestureHandler'`.
export { UndoToast, useUndoToast } from './UndoToast';
export type { UndoToastState } from './UndoToast';
export { useOptimisticReschedule } from './useOptimisticReschedule';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Smallest rendered height (matches EventBlock). */
const MIN_HEIGHT = 22;

/** Owner-indicator dot size for shared (non-own) events. */
const OWNER_DOT_SIZE = 7;

/**
 * Long-press hold duration (ms) before the pan gesture activates.
 *
 * 500 ms matches the iPhone Calendar app and gives the user enough time to
 * settle their finger without accidentally cancelling. The surrounding
 * ScrollView must come from react-native-gesture-handler so it participates
 * in RNGH's orchestration system — that way scroll vs drag conflicts are
 * resolved natively.
 */
const LONG_PRESS_MS = 500;

/**
 * Maximum finger movement (px) tolerated during the long-press wait.
 * Default RNGH tolerance is ~10pt which is too tight for fingers that
 * naturally tremor while held still — 20pt feels stable.
 */
const LONG_PRESS_MAX_DISTANCE = 20;

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
 * Surface area is deliberately kept close to EventBlock so WeekView/DayView
 * can swap them behind a feature flag without structural changes.
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
   * View mode — controls whether horizontal drag produces dayDelta.
   * 'day' mode: dayDelta is always 0 (single-column).
   * 'week' mode: dayDelta computed from dx / columnWidth.
   */
  viewMode?: 'week' | 'day';

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

  /**
   * Optional pre-resolved translated title (Sprint 19 TASK-1907). Parent
   * looks this up via useTranslatedTitles for the whole visible range so we
   * don't fetch per-block. Falls back to event.title when undefined.
   */
  translatedTitle?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GestureHandler-powered event card for WeekView/DayView time grids.
 *
 * Rendered behind a feature flag in WeekView/DayView:
 *   `__DEV__ && config.dragMode === 'gh'`
 *
 * Completely isolated from production code paths — EventBlock still ships
 * with PanResponder for all production users.
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
  viewMode      = 'week',
  onHoverSlot,
  onDropped,
  translatedTitle,
}: EventBlockGestureHandlerProps) {
  // Resolve theme-aware color tokens for dynamic styling
  const colors = useColors();
  const styles = makeStyles(colors);

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
        viewMode,
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
    [onHoverSlot, columnWidth, pxPerMinute, viewMode],
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
        viewMode,
      });

      if (__DEV__) {
        // Diagnostic: log drop details so LEAD can verify the full call chain.
        // Output example: [DragDrop] onEnd event:<id> dx:12.3 dy:45.0 dayDelta:0 minuteDelta:30
        console.log(
          '[DragDrop] onEnd fired',
          '| event:', eventRef.current.id,
          '| dx:', dx.toFixed(1), 'dy:', dy.toFixed(1),
          '| dayDelta:', dayDelta, 'minuteDelta:', minuteDelta,
        );
      }

      // No-op drop — don't call onDropped
      if (dayDelta === 0 && minuteDelta === 0) {
        if (__DEV__) console.log('[DragDrop] no-op drop (delta=0,0) — skipping onDropped');
        return;
      }

      const { newStartAt, newEndAt } = applyDelta(
        eventRef.current.startAt,
        eventRef.current.endAt,
        dayDelta,
        minuteDelta,
      );

      if (__DEV__) {
        console.log(
          '[DragDrop] calling onDropped',
          '| newStart:', newStartAt.toISOString(),
          '| newEnd:', newEndAt.toISOString(),
        );
      }

      onDropped({
        event:      eventRef.current,
        dayDelta,
        minuteDelta,
        newStartAt,
        newEndAt,
      });
    },
    [onDropped, columnWidth, pxPerMinute, viewMode],
  );

  // ── Gesture definition ────────────────────────────────────────────────────

  /**
   * Fires a short haptic buzz when the long-press threshold is reached.
   * Uses React Native's built-in Vibration API (no extra package).
   * Called via runOnJS from the worklet so it runs on the JS thread.
   */
  const triggerHaptic = useCallback(() => {
    // [delay, duration] pattern — 0 ms delay + 30 ms buzz.
    // On iOS the actual vibration pattern is approximated by the system
    // (Taptic Engine fires a short impact). On Android it vibrates for 30 ms.
    Vibration.vibrate([0, 30]);
  }, []);

  /**
   * Build the long-press + pan gesture pair once per event identity.
   * Worklet closures capture stable shared-value handles; JS callbacks go
   * through runOnJS so they can access the React state and Zustand store.
   *
   * Architecture:
   *   - LongPress (minDuration LONG_PRESS_MS, maxDistance LONG_PRESS_MAX_DISTANCE)
   *     triggers the haptic + visual lift the moment the threshold is reached.
   *   - Pan (.activateAfterLongPress) only activates AFTER the same hold, so
   *     the pan handlers track the actual reschedule motion.
   *   - Composing them with Gesture.Simultaneous lets the LongPress fire its
   *     onStart (haptic) without preventing the Pan from taking over the touch.
   *
   * The explicit `.maxDistance(LONG_PRESS_MAX_DISTANCE)` is critical — RNGH's
   * default tolerance (~10pt) is too tight for natural finger jitter and was
   * the root cause of the drag-not-activating reports across builds 38–40.
   */
  const composedGesture = useMemo(() => {
    const longPress = Gesture.LongPress()
      .minDuration(LONG_PRESS_MS)
      .maxDistance(LONG_PRESS_MAX_DISTANCE)
      .onStart(() => {
        'worklet';
        // Haptic feedback + visual lift the instant long-press fires —
        // gives the user immediate confirmation that drag mode is active.
        runOnJS(triggerHaptic)();
        isActive.value = withSpring(1);
      });

    const pan = Gesture.Pan()
      .activateAfterLongPress(LONG_PRESS_MS)
      .onUpdate((evt) => {
        'worklet';
        // Track finger 1:1 — no spring here, spring only on lift/drop.
        translateX.value = evt.translationX;
        translateY.value = evt.translationY;
        runOnJS(notifyHover)(evt.translationX, evt.translationY);
      })
      .onEnd((evt) => {
        'worklet';
        runOnJS(clearHover)();
        runOnJS(handleDrop)(evt.translationX, evt.translationY);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        isActive.value   = withSpring(0);
      })
      .onFinalize(() => {
        'worklet';
        if (isActive.value !== 0) {
          runOnJS(clearHover)();
          isActive.value   = withSpring(0);
          translateX.value = withSpring(0);
          translateY.value = withSpring(0);
        }
      });

    return Gesture.Simultaneous(longPress, pan);
    // Recreate only when event identity or geometry props change.
    // notifyHover/clearHover/handleDrop/triggerHaptic are stable useCallback
    // refs captured via the runOnJS bridge — not needed in deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, columnWidth, pxPerMinute, viewMode]);

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
    };
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <GestureDetector gesture={composedGesture}>
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
          {translatedTitle ?? event.title}
        </Text>

        {/*
         * Owner indicator dot — shown only for shared (Space) events that
         * belong to another member. Uses event.color (resolved server-side
         * to the owner's member color) so the dot blends with the chip.
         */}
        {!event.isOwn && (
          <View
            testID="owner-dot"
            style={[styles.ownerDot, { backgroundColor: event.color }]}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component so it reacts to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
      // textPrimary adapts: gray-900 in light, white in dark
      color: colors.textPrimary,
    },
    /**
     * Small dot at the top-right corner — marks shared (Space) events that
     * belong to another member. Mirrors EventBlock for visual parity.
     */
    ownerDot: {
      position: 'absolute',
      top: 3,
      right: 3,
      width:  OWNER_DOT_SIZE,
      height: OWNER_DOT_SIZE,
      borderRadius: OWNER_DOT_SIZE / 2,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.85)',
    },
  });
}

