/**
 * useGridDragHandler — root PanResponder for the calendar time grid.
 *
 * After four failed library-based attempts (RNGH ScrollView swap, vx
 * gating, PanResponder fallback at the EventBlock level, Phase 1.1's
 * Gesture.Simultaneous LongPress+Pan composition) the user asked for a
 * fully self-implemented version with no external gesture dependency.
 *
 * Architecture:
 *  - A single PanResponder lives at the top of the day-columns container.
 *    It hit-tests touches against pre-computed event rectangles. When a
 *    touch lands on empty space the responder yields (returns false) so
 *    the surrounding ScrollView keeps its native scroll behaviour intact.
 *  - When a touch lands on an event card the responder grants itself and
 *    starts a 500 ms long-press timer. Finger movement above 8 px before
 *    the timer fires cancels the timer (treated as a scroll/tap).
 *  - Once the timer fires, we enter `dragState` — the parent component
 *    renders a floating `DragGhost` that follows the finger via the
 *    container-local coordinates we expose. Original card stays dimmed.
 *  - On release: compute snapped (dayDelta, minuteDelta) via the existing
 *    `computeRescheduleDelta` helper and call `onDropped`. If there was
 *    no drag (timer cancelled, short tap), call `onTap` with the event so
 *    EventBlock's missing onPress can be replayed by the parent.
 *
 * Why this works where the library path didn't:
 *  - Only one gesture system (RN's PanResponder). No coordination races.
 *  - Hit-test happens in JS at touchStart, so we know up front whether to
 *    yield. No "child claims the touch then parent steals it" races.
 *  - ScrollView gets unaffected touches verbatim — no scroll vs drag fight.
 */

import { useMemo, useRef, useState } from 'react';
import { PanResponder, type PanResponderInstance } from 'react-native';

import {
  computeRescheduleDelta,
  DEFAULT_PX_PER_MINUTE,
  DEFAULT_SNAP_MINUTES,
} from '@/lib/calendarGeometry';
import type { EventSummary } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Pre-computed rectangle for one event, in container-local pixels. Built
 * once per render by the parent (WeekView/DayView) from its `layouts` data.
 */
export interface DragLayoutRect {
  event: EventSummary;
  /** Container-local x of the rect. */
  left: number;
  /** Container-local y of the rect. */
  top: number;
  width: number;
  height: number;
  /** Day-column index (0..6 in WeekView, always 0 in DayView). */
  dayIndex: number;
}

/**
 * Live drag state surfaced to the parent so it can render the floating
 * ghost and dim the original card. `null` while idle.
 */
export interface DragState {
  event: EventSummary;
  /** Original rectangle so the ghost can mirror size + colour. */
  rect: DragLayoutRect;
  /** Container-local finger position right now (centre of ghost). */
  fingerX: number;
  fingerY: number;
  /** Cumulative deltas — parent uses these to render a snap highlight. */
  dx: number;
  dy: number;
}

interface Options {
  layouts: DragLayoutRect[];
  /** Pixel width of one day column (DayView passes 0). */
  columnWidth: number;
  /** Pixels per minute of the vertical time axis. */
  pxPerMinute?: number;
  /** Minute snap step on drop. */
  snapMinutes?: number;
  /** 'week' or 'day' — controls dayDelta calculation. */
  viewMode: 'week' | 'day';
  /** Called when a drop produces a non-zero delta. */
  onDropped: (
    event: EventSummary,
    dayDelta: number,
    minuteDelta: number,
  ) => void;
  /**
   * Called when a touch on an event ended without entering drag mode (i.e.
   * a tap). Lets the parent forward to onEventPress because PanResponder
   * has swallowed the original Text.onPress.
   */
  onTap: (event: EventSummary) => void;
  /**
   * Build-55 — fires when the user briefly taps an EMPTY area of the grid
   * (no chip hit, no drag, finger lifts within 350 ms with <8 px move).
   * Parent uses this to open the event-create screen pre-filled with the
   * tapped date + time. Skipped when the user is scrolling because the
   * responder yields via onPanResponderTerminationRequest as soon as
   * UIScrollView asks for control.
   *
   * Coordinates are container-local (same space as `layouts`) so the
   * parent can convert (x → dayIndex, y → hour:minute) using its own
   * columnWidth + pxPerMinute.
   */
  onEmptyTap?: (localX: number, localY: number) => void;
  /**
   * Build-57 — fires when the user drops a dragged event onto the
   * "delete zone" (i.e. the finger lifts while above the eventsArea —
   * fingerY < deleteZoneThreshold, default 0). Parent typically shows
   * a trash button at the top of the calendar while dragState !== null
   * and routes this callback to a delete-confirm dialog.
   */
  onDelete?: (event: EventSummary) => void;
  /**
   * Container-local Y threshold for the delete zone. Drops where
   * fingerY < threshold are treated as deletes instead of moves.
   * Default 0 — the area immediately above the time grid. Pass a
   * larger negative number (e.g. -40) to match a taller trash button.
   */
  deleteZoneThreshold?: number;
  /**
   * Live page position of the eventsArea container (top-left in screen pt).
   * The hook subtracts this from pageX/pageY to get touch coords in the
   * same space as `layouts`. Required because PanResponder's locationX/Y
   * is relative to the *touched view* (often a deeper child like an
   * EventBlock), not the responder view — making locationX/Y unusable for
   * hit-testing against rects in the responder's coord space. The parent
   * keeps this ref live by measuring on layout + scroll.
   */
  pageOffsetRef: { current: { x: number; y: number } };
}

// ─── Hit-test ────────────────────────────────────────────────────────────────

function hitTest(layouts: DragLayoutRect[], x: number, y: number): DragLayoutRect | null {
  // Iterate in reverse so visually-on-top events (rendered last) win ties.
  for (let i = layouts.length - 1; i >= 0; i--) {
    const r = layouts[i]!;
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
      return r;
    }
  }
  return null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGridDragHandler({
  layouts,
  columnWidth,
  pxPerMinute = DEFAULT_PX_PER_MINUTE,
  snapMinutes = DEFAULT_SNAP_MINUTES,
  viewMode,
  onDropped,
  onTap,
  onEmptyTap,
  onDelete,
  deleteZoneThreshold = 0,
  pageOffsetRef,
}: Options): {
  panHandlers: PanResponderInstance['panHandlers'];
  dragState: DragState | null;
  /**
   * The event currently in the long-press "wait" window — i.e. the user
   * has touched a chip but the 500 ms timer hasn't fired yet. Surfaced so
   * the parent can render a visual progress indicator (ring, scale, etc).
   * Also doubles as live diagnostics: if this never becomes non-null when
   * the user presses a chip, hit-testing isn't running — meaning the
   * outer ScrollView (or some other parent) is intercepting the touch.
   */
  candidateEvent: EventSummary | null;
  /**
   * Build-43 diagnostic — last touch resolution result. Surfaced as a
   * single-line string so the parent can render it on screen even on
   * production TestFlight builds where __DEV__ console.log is silent.
   * Format: "x=… y=… layouts=N hit=title|MISS".
   */
  debugInfo: string;
} {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [candidateEvent, setCandidateEvent] = useState<EventSummary | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('B50-ready');

  // Refs are needed inside the PanResponder closure because the responder is
  // memoised — re-creating it on every render would tear down active touches.
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = dragState;

  // Per-touch state stored in refs (PanResponder callbacks fire across
  // multiple frames; useState would lose the value mid-gesture).
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateRef = useRef<DragLayoutRect | null>(null);
  const startXY = useRef({ x: 0, y: 0 });
  const grantTime = useRef(0);

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const responder = useMemo(
    () => PanResponder.create({
      // Hit-test on touch start. Yield (false) when the touch is on empty
      // space so the parent ScrollView keeps native scroll behaviour.
      // Capture phase — runs before children. Doing the hit-test here lets
      // us claim touches that landed on event chips before any inner view
      // (Text, EventBlock) becomes the touch target. If we return true we
      // also persist the candidate so onPanResponderGrant can pick it up;
      // otherwise grant gets called with an empty candidateRef and the
      // long-press timer never starts (Build-47 regression).
      //
      // The debug bar is updated from BOTH capture (when we claim) and
      // bubble (when no event was hit) so the user always sees the
      // current touch result instead of the bar going stale.
      onStartShouldSetPanResponderCapture: (e) => {
        const { pageX, pageY } = e.nativeEvent;
        const off = pageOffsetRef.current;
        const localX = pageX - off.x;
        const localY = pageY - off.y;
        const layoutsLen = layoutsRef.current.length;
        const hit = hitTest(layoutsRef.current, localX, localY);
        const first = layoutsRef.current[0];
        const firstStr = first
          ? `L=${Math.round(first.left)} T=${Math.round(first.top)} W=${Math.round(first.width)} H=${Math.round(first.height)}`
          : 'no-rect';
        const info = `${hit ? 'CAP' : 'cap'} local(${Math.round(localX)},${Math.round(localY)}) off(${Math.round(off.x)},${Math.round(off.y)}) page(${Math.round(pageX)},${Math.round(pageY)}) N=${layoutsLen} ${firstStr} hit=${hit ? 'OK' : 'MISS'}`;
        setDebugInfo(info);
        // Always remember the touch start coords — needed for
        // empty-area tap detection on release. Even if no chip was hit
        // we may still want to fire onEmptyTap.
        startXY.current = { x: localX, y: localY };
        if (!hit) {
          // Empty area — only claim when the parent actually wants tap
          // events. Otherwise yield (preserves vertical scroll exactly
          // as before this change shipped).
          candidateRef.current = null;
          if (!onEmptyTap) return false;
          // Claim, but yield instantly to ScrollView the moment it asks
          // for control (see onPanResponderTerminationRequest below).
          return true;
        }
        candidateRef.current = hit;
        setCandidateEvent(hit.event);
        return true;
      },
      // Bubble phase — only reached when capture didn't claim (no hit).
      // Kept as a safety net + extra diagnostics so we can tell whether
      // capture-phase numbers and bubble-phase numbers ever disagree.
      onStartShouldSetPanResponder: (e) => {
        const { pageX, pageY } = e.nativeEvent;
        const off = pageOffsetRef.current;
        const localX = pageX - off.x;
        const localY = pageY - off.y;
        const hit = hitTest(layoutsRef.current, localX, localY);
        if (!hit) return false;
        candidateRef.current = hit;
        startXY.current = { x: localX, y: localY };
        setCandidateEvent(hit.event);
        return true;
      },
      // Don't try to take over once the gesture is already in flight —
      // the start-time decision above is the only chance.
      onMoveShouldSetPanResponder: () => false,

      onPanResponderGrant: () => {
        grantTime.current = Date.now();
        cancelLongPress();
        const candidate = candidateRef.current;
        if (!candidate) return;
        // Schedule drag-mode entry. If the finger moves too much before
        // this fires, onPanResponderMove cancels the timer.
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          // Drag mode takes over the visual; ring/dim handoff to ghost.
          setCandidateEvent(null);
          setDragState({
            event:    candidate.event,
            rect:     candidate,
            fingerX:  startXY.current.x,
            fingerY:  startXY.current.y,
            dx: 0,
            dy: 0,
          });
        }, 280);
      },

      onPanResponderMove: (_, gs) => {
        // Already dragging — track the finger.
        if (dragStateRef.current) {
          setDragState((prev) => prev ? {
            ...prev,
            fingerX: startXY.current.x + gs.dx,
            fingerY: startXY.current.y + gs.dy,
            dx: gs.dx,
            dy: gs.dy,
          } : null);
          return;
        }
        // Not yet in drag mode — small movements OK, larger ones cancel
        // the long-press timer (user is probably trying to scroll/tap).
        if (Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8) {
          cancelLongPress();
          setCandidateEvent(null);
        }
      },

      onPanResponderRelease: (_, gs) => {
        cancelLongPress();
        setCandidateEvent(null);
        const drag = dragStateRef.current;
        if (drag) {
          // Build-57 — delete zone check FIRST. Finger that ended above
          // the eventsArea (fingerY < threshold) means the user dragged
          // the chip up into the trash button at the top of the screen.
          const finalFingerY = startXY.current.y + gs.dy;
          if (onDelete && finalFingerY < deleteZoneThreshold) {
            onDelete(drag.event);
            setDragState(null);
            candidateRef.current = null;
            return;
          }
          // Drop computed via the same helper that powered the prior
          // implementations — kept stable so existing tests still apply.
          const { dayDelta, minuteDelta } = computeRescheduleDelta({
            dx: gs.dx,
            dy: gs.dy,
            columnWidth,
            pxPerMinute,
            snapMinutes,
            viewMode,
          });
          if (dayDelta !== 0 || minuteDelta !== 0) {
            onDropped(drag.event, dayDelta, minuteDelta);
          }
          setDragState(null);
          candidateRef.current = null;
          return;
        }
        // No drag → was it a tap? (short, no movement)
        const dt    = Date.now() - grantTime.current;
        const moved = Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8;
        if (dt < 350 && !moved) {
          if (candidateRef.current) {
            onTap(candidateRef.current.event);
          } else if (onEmptyTap) {
            // Empty-area quick tap — open create screen with date/time
            // pre-fill computed from the touch coords (parent decides
            // how to translate localX/Y → date + hour).
            onEmptyTap(startXY.current.x, startXY.current.y);
          }
        }
        candidateRef.current = null;
      },

      onPanResponderTerminate: () => {
        cancelLongPress();
        setCandidateEvent(null);
        if (dragStateRef.current) setDragState(null);
        candidateRef.current = null;
      },
      // Refuse to release the responder while a drag is in progress so
      // the outer calendar's left/right swipe-to-navigate gesture can't
      // steal mid-drag (Build-49 user report). Before drag mode kicks
      // in we still allow termination so a quick scroll is honoured —
      // critical for the empty-area claim path: UIScrollView grabs
      // control as soon as the user starts a vertical pan and the
      // empty-tap callback never fires (which is the desired behaviour
      // — taps and scrolls stay disambiguated).
      onPanResponderTerminationRequest: () => dragStateRef.current === null,
    }),
    // The responder closure reads layouts/dragState via refs and reads the
    // numeric props directly — only the latter need to invalidate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnWidth, pxPerMinute, snapMinutes, viewMode, onDropped, onTap, onEmptyTap, onDelete, deleteZoneThreshold],
  );

  return { panHandlers: responder.panHandlers, dragState, candidateEvent, debugInfo };
}
