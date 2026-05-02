/**
 * useMonthDragHandler — long-press detection for month-view rescheduling.
 *
 * Build-54 redesign (LEAD UX feedback): the original drag-with-finger
 * flow felt fragile in month view because the user had to keep the
 * finger pressed continuously through three sub-gestures (long-press,
 * pick from popup, drop on cell). Releasing at any point cancelled.
 *
 * The new flow is a clean two-tap pattern:
 *   1. Long-press a day cell that contains at least one event.
 *      • 1 event  → parent enters targeting directly (skip popup).
 *      • 2+ events → parent shows a Modal listing the events. The
 *                    user picks one, parent enters targeting.
 *   2. Targeting mode highlights every day cell as a drop target;
 *      tapping any cell finalises the move.
 *
 * The hook only owns the long-press detection PanResponder. Modal +
 * targeting state live in MonthView so the gesture surface stays
 * small and the picker can be a regular tappable Modal.
 *
 * Coordinates: same `pageX/pageY - measured eventsArea offset` pattern
 * as the week-grid hook (locationX/Y from PanResponder is unreliable;
 * see useGridDragHandler.ts for the rationale).
 */

import { useMemo, useRef, useState } from 'react';
import { PanResponder, type PanResponderInstance } from 'react-native';
import type { EventSummary } from '@/types';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Pre-computed rectangle of one event chip inside a cell, in eventsArea-local px. */
export interface MonthEventLayout {
  event: EventSummary;
  /** ISO date key of the day the chip is rendered in. */
  dateKey: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pre-computed rectangle of one day cell — used for hit-test. */
export interface MonthCellLayout {
  date: Date;
  dateKey: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Options {
  eventLayouts: MonthEventLayout[];
  cellLayouts: MonthCellLayout[];
  /**
   * Full per-day event lists. eventLayouts is capped at MAX_BARS visible
   * chips, but the picker should surface every event on the day so we
   * keep this independent reference.
   */
  eventsByDate: Record<string, EventSummary[]>;
  pageOffsetRef: { current: { x: number; y: number } };
  /**
   * Called after long-press fires on a day cell that has events.
   * Parent decides what to do:
   *   - cellEvents.length === 1: enter targeting directly
   *   - cellEvents.length >= 2: show the picker Modal
   */
  onLongPressCell: (cellEvents: EventSummary[]) => void;
  /**
   * Called when the user briefly tapped a chip without entering long-press.
   * Parent typically routes this to the day's drill-down view so the
   * tap-on-chip UX stays in line with cell-tap UX.
   */
  onChipTap?: (event: EventSummary) => void;
}

// ─── Hit-test helpers ──────────────────────────────────────────────────────

function hitTestEvent(layouts: MonthEventLayout[], x: number, y: number): MonthEventLayout | null {
  // Iterate in reverse so the visually-on-top chip wins ties.
  for (let i = layouts.length - 1; i >= 0; i--) {
    const r = layouts[i]!;
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
      return r;
    }
  }
  return null;
}

function hitTestCell(cells: MonthCellLayout[], x: number, y: number): MonthCellLayout | null {
  for (const c of cells) {
    if (x >= c.left && x <= c.left + c.width && y >= c.top && y <= c.top + c.height) {
      return c;
    }
  }
  return null;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useMonthDragHandler({
  eventLayouts,
  cellLayouts,
  eventsByDate,
  pageOffsetRef,
  onLongPressCell,
  onChipTap,
}: Options): {
  panHandlers: PanResponderInstance['panHandlers'];
  candidateEvent: EventSummary | null;
} {
  const [candidateEvent, setCandidateEvent] = useState<EventSummary | null>(null);

  const eventLayoutsRef = useRef(eventLayouts);
  eventLayoutsRef.current = eventLayouts;
  const cellLayoutsRef = useRef(cellLayouts);
  cellLayoutsRef.current = cellLayouts;
  const eventsByDateRef = useRef(eventsByDate);
  eventsByDateRef.current = eventsByDate;

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Initial touch context: which chip (if any) and which cell the touch
  // landed on. Used by the long-press handler + tap forwarding.
  const candidateChipRef = useRef<MonthEventLayout | null>(null);
  const candidateCellRef = useRef<MonthCellLayout | null>(null);
  const startXY = useRef({ x: 0, y: 0 });
  const grantTime = useRef(0);
  const longPressFired = useRef(false);

  const cancelLongPress = (): void => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const responder = useMemo(
    () => PanResponder.create({
      // Capture catches taps on day cells that already have events.
      // Empty cells fall through to the parent's TouchableOpacity so
      // tap-to-drill-down + onLongPress quick-create still work.
      onStartShouldSetPanResponderCapture: (e) => {
        const { pageX, pageY } = e.nativeEvent;
        const off = pageOffsetRef.current;
        const localX = pageX - off.x;
        const localY = pageY - off.y;
        const cellHit = hitTestCell(cellLayoutsRef.current, localX, localY);
        if (!cellHit) return false;
        const cellEvents = eventsByDateRef.current[cellHit.dateKey] ?? [];
        if (cellEvents.length === 0) return false;
        candidateCellRef.current = cellHit;
        candidateChipRef.current = hitTestEvent(eventLayoutsRef.current, localX, localY);
        startXY.current = { x: localX, y: localY };
        longPressFired.current = false;
        // Visual ring on the specific chip (if any) so the user sees
        // the touch was registered.
        setCandidateEvent(candidateChipRef.current?.event ?? null);
        return true;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,

      onPanResponderGrant: () => {
        grantTime.current = Date.now();
        cancelLongPress();
        if (!candidateCellRef.current) return;
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          longPressFired.current = true;
          setCandidateEvent(null);
          const cell = candidateCellRef.current;
          if (!cell) return;
          const events = eventsByDateRef.current[cell.dateKey] ?? [];
          if (events.length === 0) return;
          // Hand control to the parent — it shows the modal (multi) or
          // enters targeting directly (single).
          onLongPressCell(events);
        }, 280);
      },

      onPanResponderMove: (_, gs) => {
        if (longPressFired.current) return;
        // Pre-fire — cancel long-press if the finger wandered.
        if (Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8) {
          cancelLongPress();
          setCandidateEvent(null);
        }
      },

      onPanResponderRelease: (_, gs) => {
        cancelLongPress();
        setCandidateEvent(null);
        if (longPressFired.current) {
          // Long-press already handed off; release is just cleanup.
          longPressFired.current = false;
          candidateChipRef.current = null;
          candidateCellRef.current = null;
          return;
        }
        // Quick tap — if it was on a specific chip, forward to onChipTap.
        const dt = Date.now() - grantTime.current;
        const moved = Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8;
        if (dt < 350 && !moved && candidateChipRef.current && onChipTap) {
          onChipTap(candidateChipRef.current.event);
        }
        candidateChipRef.current = null;
        candidateCellRef.current = null;
      },

      onPanResponderTerminate: () => {
        cancelLongPress();
        setCandidateEvent(null);
        candidateChipRef.current = null;
        candidateCellRef.current = null;
        longPressFired.current = false;
      },
      onPanResponderTerminationRequest: () => true,
    }),
    // Closures read layouts via refs; only the user callbacks need to
    // invalidate the responder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onLongPressCell, onChipTap],
  );

  return {
    panHandlers: responder.panHandlers,
    candidateEvent,
  };
}
