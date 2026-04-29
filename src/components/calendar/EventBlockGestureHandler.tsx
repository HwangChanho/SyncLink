/**
 * EventBlockGestureHandler — TASK-009 Drag-to-Reschedule PoC (Days 1-5).
 *
 * ## What this file does (final state after Day 5)
 *
 * Day 1 — Gesture infra + visual feedback
 *   - GestureDetector (Pan) with PAN_ACTIVATION_PX dead-zone.
 *   - Reanimated shared values (translateX/Y, isActive) drive 60fps animation.
 *   - Scale lift + opacity dim while dragging.
 *
 * Day 2 — calendarGeometry integration + drop-target highlight
 *   - Accepts `columnWidth` and `pxPerMinute` (px/min) from WeekView via props.
 *   - Calls `computeRescheduleDelta` on every gesture update to derive a
 *     snapped hover time, which is forwarded to the parent via `onHoverSlot`.
 *   - Parent (WeekView) renders a translucent highlight at the hover slot.
 *   - On drag end the snapped (dayDelta, minuteDelta) is reported via `onDropped`.
 *
 * Day 3 — Optimistic update + eventService rollback
 *   - `onDropped` triggers the store upsert (optimistic), then the network call.
 *   - On network failure: rollback via second upsert + Alert.alert to user.
 *   - This component itself is stateless w.r.t. the store — the callback
 *     pattern keeps it decoupled from Zustand and usable in tests.
 *
 * Day 4 — Conflict detection + Undo toast
 *   - useOptimisticReschedule now calls findConflictingEvents before saving.
 *   - Conflict found → Alert "다음 일정과 겹칩니다… 이동할까요?" (취소 = rollback).
 *   - After successful drop: 5-second Undo toast via useUndoToast hook.
 *   - spaceId resolved from useSpaceStore.activeSpaceId (EventSummary has no spaceId).
 *
 * Day 5 — DayView integration
 *   - DayView now uses EventBlockGestureHandler behind the same DRAG_MODE_GH flag.
 *   - MonthView: drag skip — cell too small. Long-press → modal (carry to R3).
 *   - Maestro e2e smoke script: e2e/flows/22_drag_to_reschedule.yaml (written only).
 *
 * ## Long-press activation (LEAD fix, 2026-04-28)
 *   - Previously used `.minDistance(8)` — drag activated immediately on any movement,
 *     which conflicted with the surrounding ScrollView swipe gesture.
 *   - Now uses `.activateAfterLongPress(LONG_PRESS_MS)` (500 ms) so the user must
 *     hold for half a second before drag starts. This matches the iPhone Calendar
 *     app's interaction model and eliminates swipe/drag conflicts.
 *   - Vibration.vibrate([0, 30]) fires on long-press activation as haptic feedback
 *     (uses React Native's built-in Vibration API — no extra package needed).
 *
 * ## Feature flag
 *   Only rendered by WeekView/DayView when `__DEV__ && config.dragMode === 'gh'`.
 *   The production EventBlock (PanResponder) keeps shipping unchanged.
 *
 * @task TASK-009
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
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
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { findConflictingEvents, updateEvent } from '@/services/eventService';
import type { EventSummary } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Smallest rendered height (matches EventBlock). */
const MIN_HEIGHT = 22;

/**
 * Long-press hold duration (ms) before the pan gesture activates.
 *
 * 300 ms feels snappy while still clearly distinguishing a tap from a drag.
 * The surrounding ScrollView is now from react-native-gesture-handler, which
 * participates in RNGH's orchestration system — so scroll vs drag conflicts
 * are resolved natively without needing a long dead-zone period.
 */
const LONG_PRESS_MS = 300;

/**
 * Duration of the Undo toast in milliseconds.
 * User has 5 seconds to revert a drag-to-reschedule action.
 */
const UNDO_TOAST_DURATION_MS = 5_000;

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
   * Build the pan gesture once per event identity.
   * Worklet closures capture stable shared-value handles; JS callbacks go
   * through runOnJS so they can access the React state and Zustand store.
   *
   * Long-press activation:
   *   `.activateAfterLongPress(LONG_PRESS_MS)` requires the finger to be held
   *   still for 500 ms before the pan gesture activates. This prevents the
   *   drag from conflicting with the surrounding horizontal scroll/swipe — a
   *   quick swipe across the event block will not trigger drag mode.
   *   On activation, a haptic buzz confirms to the user that drag is ready.
   */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        // Require a 500 ms hold before the drag mode engages.
        // This matches the iPhone Calendar app's long-press-then-drag UX and
        // prevents the surrounding ScrollView from losing horizontal swipes.
        .activateAfterLongPress(LONG_PRESS_MS)
        .onStart(() => {
          'worklet';
          // Haptic feedback confirms long-press threshold reached.
          runOnJS(triggerHaptic)();
          // Lift the card — spring for physical feel.
          isActive.value = withSpring(1);
        })
        .onUpdate((evt) => {
          'worklet';
          // Track finger 1:1 — no spring here, spring only on lift/drop.
          translateX.value = evt.translationX;
          translateY.value = evt.translationY;
          // Notify JS thread about hover slot (runs asynchronously via bridge).
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
          // Safety net: gesture cancelled externally (e.g. another handler wins).
          if (isActive.value !== 0) {
            runOnJS(clearHover)();
            isActive.value   = withSpring(0);
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
          }
        }),
    // Recreate only when event identity or geometry props change.
    // notifyHover/clearHover/handleDrop/triggerHaptic are stable useCallback
    // refs captured via the runOnJS bridge — not needed in deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event.id, columnWidth, pxPerMinute, viewMode],
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
  });
}

// ─── Undo toast hook ──────────────────────────────────────────────────────────

/**
 * Undo toast state returned by useUndoToast.
 * Parent renders the toast UI when `visible` is true.
 */
export interface UndoToastState {
  /** Whether the toast is currently visible. */
  visible: boolean;
  /** Label describing the undo action (e.g. event title). */
  label: string;
  /** Call this to immediately undo the last drag-to-reschedule. */
  onUndo: () => void;
}

/**
 * useUndoToast — manages a 5-second "undo" toast for drag-to-reschedule.
 *
 * After a successful reschedule, call `showUndo(label, undoCallback)`.
 * The toast auto-dismisses after UNDO_TOAST_DURATION_MS.
 * If the user taps "되돌리기", `undoCallback` is invoked immediately.
 *
 * @returns `{ toast, showUndo }` — toast state + trigger function.
 */
export function useUndoToast(): {
  toast: UndoToastState | null;
  showUndo: (label: string, undoFn: () => void) => void;
} {
  const [toast, setToast] = useState<UndoToastState | null>(null);
  // Holds the auto-dismiss timer so we can clear it on early undo.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndo = useCallback((label: string, undoFn: () => void) => {
    // Clear any existing timer before starting a new one.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    const onUndo = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setToast(null);
      undoFn();
    };

    setToast({ visible: true, label, onUndo });

    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, UNDO_TOAST_DURATION_MS);
  }, []);

  return { toast, showUndo };
}

// ─── Undo toast UI component ──────────────────────────────────────────────────

/**
 * UndoToast — lightweight toast banner rendered at the bottom of the calendar
 * while a reschedule undo is available (5 seconds).
 *
 * Caller is responsible for positioning this over the calendar view.
 * Typically rendered as an absolute-positioned overlay inside WeekView/DayView.
 *
 * @example
 * ```tsx
 * const { toast, showUndo } = useUndoToast();
 * // …
 * {toast && <UndoToast toast={toast} />}
 * ```
 */
export function UndoToast({ toast }: { toast: UndoToastState }) {
  // Resolve theme-aware color tokens so toast adapts to light and dark mode
  const colors = useColors();
  const toastStyles = makeToastStyles(colors);

  return (
    <View style={toastStyles.container} testID="undo-toast">
      <Text style={toastStyles.label} numberOfLines={1}>
        "{toast.label}" 이동됨
      </Text>
      <TouchableOpacity
        onPress={toast.onUndo}
        activeOpacity={0.7}
        testID="undo-toast-button"
      >
        <Text style={toastStyles.undoButton}>되돌리기</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Dynamic toast styles factory — adapts to the active theme.
 * The toast uses surfaceAlt as background (dark grey in dark mode,
 * light grey in light mode) so it remains visually distinct from page content
 * without being invisible against either theme's background.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeToastStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      bottom: 16,
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // surfaceAlt: gray-100 light / gray-700 dark — distinct from page bg
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 10,
      elevation: 8,
      // iOS shadow
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    label: {
      ...textStyles.labelSm,
      // textPrimary: gray-900 in light, white in dark
      color: colors.textPrimary,
      flex: 1,
      marginRight: 12,
    },
    undoButton: {
      ...textStyles.labelSm,
      // primary: violet-600 in light, violet-400 in dark
      color: colors.primary,
      fontWeight: '700',
    },
  });
}

// ─── Optimistic-update hook (Day 3 + Day 4 conflict detection) ────────────────

/**
 * useOptimisticReschedule — encapsulates the optimistic-update + rollback
 * logic for drag-to-reschedule so EventBlockGestureHandler stays pure.
 *
 * **Day 4 additions:**
 *  - Before saving: calls `findConflictingEvents(spaceId, newStartAt, newEndAt, eventId)`.
 *  - Conflict found: Alert "다음 일정과 겹칩니다… 이동할까요?" with Confirm/Cancel.
 *  - Cancel → rollback (no network call). Confirm → proceed with update.
 *  - No conflict → update immediately (no extra round-trip).
 *  - After successful update: calls `onMoved(label, rollbackFn)` so the
 *    parent can show a 5-second Undo toast.
 *
 * spaceId resolution:
 *  EventSummary does not carry a spaceId field. We resolve it from
 *  `useSpaceStore.getState().activeSpaceId`. If no active space is set (e.g.
 *  personal events only), conflict check is skipped.
 *
 * Usage:
 * ```tsx
 * const { toast, showUndo } = useUndoToast();
 * const handleDrop = useOptimisticReschedule({ onMoved: showUndo });
 *
 * <EventBlockGestureHandler onDropped={handleDrop} … />
 * {toast && <UndoToast toast={toast} />}
 * ```
 *
 * @param opts.onMoved - Called after a successful move with (label, undoFn).
 *                       Connect to useUndoToast.showUndo.
 *
 * @returns A stable `onDropped` callback ref for use as the component prop.
 */
export function useOptimisticReschedule(opts?: {
  onMoved?: (label: string, undoFn: () => void) => void;
}): (payload: DroppedPayload) => void {
  // Keep opts stable so the callback dep array stays clean.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  return useCallback(async (payload: DroppedPayload) => {
    const store = useEventStore.getState();
    const originalEvent = payload.event;

    // Build the optimistic version of the event with the new times
    const optimisticEvent: EventSummary = {
      ...originalEvent,
      startAt: payload.newStartAt,
      endAt:   payload.newEndAt,
    };

    // ─── Day 4: Conflict detection ──────────────────────────────────────────

    // Resolve spaceId from the active space store (EventSummary has no spaceId).
    const spaceId = useSpaceStore.getState().activeSpaceId;

    if (spaceId) {
      // Best-effort: findConflictingEvents returns [] on network error so we
      // never block the move due to a failed conflict check.
      const conflicts = await findConflictingEvents(
        spaceId,
        payload.newStartAt,
        payload.newEndAt,
        originalEvent.id, // exclude the event being moved from its own conflict
      );

      if (conflicts.length > 0) {
        // Format a concise conflict summary for the alert body.
        const conflictList = conflicts
          .slice(0, 3) // cap at 3 to keep alert readable
          .map((c) => `• ${c.title}`)
          .join('\n');
        const suffix = conflicts.length > 3
          ? `\n외 ${conflicts.length - 3}개`
          : '';

        // Show conflict alert and let the user decide.
        // React Native's Alert is callback-based so we wrap it in a Promise.
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '일정 겹침',
            `다음 일정과 겹칩니다:\n${conflictList}${suffix}\n\n그래도 이동할까요?`,
            [
              { text: '취소', style: 'cancel', onPress: () => resolve(false) },
              { text: '이동', style: 'default', onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });

        if (!confirmed) {
          // User cancelled — no optimistic update was made yet, so nothing to rollback.
          return;
        }
      }
    }

    // ─── Optimistic upsert (after conflict gate passed) ─────────────────────

    if (__DEV__) {
      // Diagnostic: confirm the optimistic update path is reached and show
      // the before/after times so LEAD can verify the store is being updated.
      console.log(
        '[DragDrop] useOptimisticReschedule: upsertEvent (optimistic)',
        '| id:', originalEvent.id,
        '| oldStart:', originalEvent.startAt.toISOString(),
        '| newStart:', payload.newStartAt.toISOString(),
      );
    }

    // 1. Optimistic upsert — UI responds immediately before network round-trip.
    store.upsertEvent(optimisticEvent);

    try {
      // 2. Persist to Supabase via event service.
      await updateEvent(originalEvent.id, {
        startAt: payload.newStartAt,
        endAt:   payload.newEndAt,
      });

      if (__DEV__) {
        console.log('[DragDrop] updateEvent succeeded — reschedule committed to server');
      }

      // 3. Notify parent to show Undo toast (Day 4).
      //    The undo closure reverts the store to the original event and
      //    calls updateEvent with the original times.
      optsRef.current?.onMoved?.(originalEvent.title, async () => {
        store.upsertEvent(originalEvent);
        try {
          await updateEvent(originalEvent.id, {
            startAt: originalEvent.startAt,
            endAt:   originalEvent.endAt,
          });
        } catch {
          // Undo network failure — rollback already happened in store,
          // so silently ignore (next sync will re-fetch truth from server).
        }
      });
    } catch {
      // Network failure on initial save — rollback to original and notify user.
      store.upsertEvent(originalEvent);
      Alert.alert(
        '이동 실패',
        '일정 시간을 변경하지 못했습니다. 다시 시도해 주세요.',
        [{ text: '확인' }],
      );
    }
  // useCallback with no deps — store.getState() always returns latest state,
  // spaceStore.getState() same, and updateEvent/findConflictingEvents are
  // stable module-level functions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) as (payload: DroppedPayload) => void;
}
