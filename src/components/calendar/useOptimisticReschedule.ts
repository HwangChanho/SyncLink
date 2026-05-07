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

import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { findConflictingEvents, updateEvent } from '@/services/eventService';
import type { EventSummary } from '@/types';

/**
 * Payload passed to the drop handler. Owns its own definition now (was
 * previously re-exported from EventBlockGestureHandler.tsx, which is
 * being retired in Phase 5 in favour of useGridDragHandler).
 */
export interface DroppedPayload {
  event:       EventSummary;
  dayDelta:    number;
  minuteDelta: number;
  newStartAt:  Date;
  newEndAt:    Date;
}

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

    // Build-98 LEAD: "옮기는 것 자체를 막아야 한다". useGridDragHandler 가
    // 이미 가드하지만, 어떤 경로로 여기 도달해도 멈추는 3중 안전망. 본인
    // 소유 (isOwn) 또는 owner 가 편집 허용한 경우 (editableByMembers) 만
    // 통과. 그 외는 store upsert 자체 안 함 → 화면에 옮겨지는 시각도 X.
    if (!originalEvent.isOwn && !originalEvent.editableByMembers) {
      Alert.alert(
        '편집 권한 없음',
        '다른 사람이 등록한 일정이라 옮길 수 없어요.\n등록자가 "멤버 편집 허용" 을 켜면 다 같이 편집할 수 있어요.',
        [{ text: '확인' }],
      );
      return;
    }

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
