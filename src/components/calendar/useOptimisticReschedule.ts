/**
 * useOptimisticReschedule — drop handler hook for drag-to-reschedule.
 *
 * Encapsulates: conflict detection → optimistic store upsert → server save
 * → undo notification (or rollback on failure). EventBlockGestureHandler
 * stays focused on the gesture animation; this hook handles the data flow.
 *
 * Conflict detection (Day 4 of TASK-009):
 *  - Calls findConflictingEvents(spaceId, newStart, newEnd, eventId)
 *  - On conflict: shows an Alert with cancel/confirm. Cancel aborts the move.
 *  - spaceId comes from useSpaceStore.activeSpaceId — when null, the check
 *    is skipped (personal-only events).
 *
 * Extracted from EventBlockGestureHandler.tsx during Phase 1.2 of the v1.0
 * stabilization plan.
 */

import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import type { DroppedPayload } from './EventBlockGestureHandler';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { findConflictingEvents, updateEvent } from '@/services/eventService';
import type { EventSummary } from '@/types';

interface Options {
  /**
   * Called after a successful move with `(label, undoFn)`. Wire this to
   * `useUndoToast.showUndo` to get the 5-second undo banner.
   */
  onMoved?: (label: string, undoFn: () => void) => void;
}

/**
 * Returns a stable `onDropped` callback for `<EventBlockGestureHandler>`.
 *
 * @example
 * const { toast, showUndo } = useUndoToast();
 * const handleDrop = useOptimisticReschedule({ onMoved: showUndo });
 * <EventBlockGestureHandler onDropped={handleDrop} … />
 */
export function useOptimisticReschedule(
  opts?: Options,
): (payload: DroppedPayload) => void {
  // Keep opts stable so the callback dep array stays empty.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  return useCallback(async (payload: DroppedPayload) => {
    const store = useEventStore.getState();
    const originalEvent = payload.event;

    const optimisticEvent: EventSummary = {
      ...originalEvent,
      startAt: payload.newStartAt,
      endAt:   payload.newEndAt,
    };

    // ── Conflict gate ──────────────────────────────────────────────────────
    const spaceId = useSpaceStore.getState().activeSpaceId;

    if (spaceId) {
      // findConflictingEvents returns [] on network error so a transient
      // failure never blocks a move.
      const conflicts = await findConflictingEvents(
        spaceId,
        payload.newStartAt,
        payload.newEndAt,
        originalEvent.id,
      );

      if (conflicts.length > 0) {
        const conflictList = conflicts
          .slice(0, 3)
          .map((c) => `• ${c.title}`)
          .join('\n');
        const suffix = conflicts.length > 3
          ? `\n외 ${conflicts.length - 3}개`
          : '';

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

        if (!confirmed) return;
      }
    }

    // ── Optimistic upsert + server save ────────────────────────────────────
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(
        '[DragDrop] optimistic upsert',
        '| id:', originalEvent.id,
        '| oldStart:', originalEvent.startAt.toISOString(),
        '| newStart:', payload.newStartAt.toISOString(),
      );
    }
    store.upsertEvent(optimisticEvent);

    try {
      await updateEvent(originalEvent.id, {
        startAt: payload.newStartAt,
        endAt:   payload.newEndAt,
      });

      // Show undo toast — undo restores the original event in store + server.
      optsRef.current?.onMoved?.(originalEvent.title, async () => {
        store.upsertEvent(originalEvent);
        try {
          await updateEvent(originalEvent.id, {
            startAt: originalEvent.startAt,
            endAt:   originalEvent.endAt,
          });
        } catch {
          // Undo network failure: store already rolled back; next sync
          // re-fetches the truth from the server.
        }
      });
    } catch {
      // Initial save failed — rollback the optimistic update + alert user.
      store.upsertEvent(originalEvent);
      Alert.alert(
        '이동 실패',
        '일정 시간을 변경하지 못했습니다. 다시 시도해 주세요.',
        [{ text: '확인' }],
      );
    }
  // store/spaceStore .getState() always reads latest; service fns are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) as (payload: DroppedPayload) => void;
}
