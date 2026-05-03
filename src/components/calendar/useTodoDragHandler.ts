/**
 * useTodoDragHandler — Build-66
 *
 * 시간 없는 todo (all-day strip 의 chip) 를 길게 눌러 grid 영역으로 끌어
 * 놓으면 dueAt 이 drop 위치의 시각으로 설정되는 PanResponder hook.
 *
 * 이벤트 드래그 (`useGridDragHandler`) 와 같은 스크린에서 공존하지만 다음
 * 이유로 충돌 없이 동작:
 *  - todo 드래그 PanResponder 는 chip 자체에 부착 → 이벤트 그리드의
 *    PanResponder 와 다른 view 트리에서 시작.
 *  - 시작이 strip 이므로 grid 의 hit-test 는 어차피 false → 이벤트 드래그
 *    핸들러는 capture 도 안 함.
 *  - drop 시 grid 영역의 page rect 를 직접 hit-test 해 grid 안일 때만
 *    onDrop 콜백 호출 — 그렇지 않으면 모든 작업 취소 (체기지 변경 없음).
 *
 * 사용 예 (WeekView):
 *  ```ts
 *  const { todoDragState, getPanHandlers } = useTodoDragHandler({
 *    eventsAreaPageOffsetRef: pageOffsetRef,
 *    columnWidth,
 *    weekDays,
 *    hourHeight: HOUR_HEIGHT,
 *    onDrop: (todoId, newDueAt) => updateTodo(todoId, { dueAt: newDueAt }),
 *  });
 *  // ...
 *  <View {...getPanHandlers(td.id)} />
 *  ```
 */

import { useCallback, useRef, useState } from 'react';
import { PanResponder, type PanResponderInstance } from 'react-native';
import { computeTodoDropTarget } from '@/lib/calendarGeometry';

/** 살아 있는 todo drag 상태. ghost 렌더에 사용. */
export interface TodoDragState {
  /** drag 시작된 todo id. */
  todoId: string;
  /** 화면 상의 현재 손가락 page 좌표. ghost 위치에 사용. */
  pageX: number;
  pageY: number;
}

interface Args {
  /**
   * eventsArea 의 현재 page 좌표 (top-left). WeekView 가 이미 측정해
   * 두는 ref 를 그대로 받음. drop 시 hit-test 와 grid 내부 좌표 변환에
   * 둘 다 사용.
   */
  eventsAreaPageOffsetRef: { current: { x: number; y: number } };
  /** 한 컬럼의 px 너비 (week=7분할, day=전체). */
  columnWidth: number;
  /**
   * 컬럼 인덱스 → 해당 날짜. WeekView 의 weekDays, DayView 는
   * [selectedDate] 한 개. 빈 배열이면 drop 무시.
   */
  weekDays: Date[];
  /** 한 시간이 차지하는 픽셀. */
  hourHeight: number;
  /** snap 단위(분). 기본 30. */
  snapMinutes?: number;
  /**
   * Drop 시 호출. grid 안에서 손가락이 떨어진 (날짜+시각) 의 Date 와 함께
   * 호출. caller 는 보통 todoStore.updateTodo({ dueAt }) 를 호출.
   */
  onDrop: (todoId: string, newDueAt: Date) => void;
  /** Long-press 시작 임계값 (ms). 기본 350. 너무 짧으면 strip 스크롤과 충돌. */
  longPressMs?: number;
}

interface Result {
  /** ghost 렌더용 — null 이면 drag 중 아님. */
  todoDragState: TodoDragState | null;
  /** 각 chip 에 ...spread 해서 부착. */
  getPanHandlers: (todoId: string) => PanResponderInstance['panHandlers'];
}

export function useTodoDragHandler({
  eventsAreaPageOffsetRef,
  columnWidth,
  weekDays,
  hourHeight,
  snapMinutes = 30,
  onDrop,
  longPressMs = 350,
}: Args): Result {
  const [todoDragState, setTodoDragState] = useState<TodoDragState | null>(null);

  // long-press 가 fire 되기 전까진 drag 가 실제로 시작되지 않음. 타이머
  // ref 로 cancel 가능하게 보관.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 활성 drag 중인 todoId — closure 가 아니라 ref 로 들고 있어야 release
  // 시점에 최신 값을 참조 가능 (state 는 비동기 갱신).
  const activeIdRef = useRef<string | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const getPanHandlers = useCallback(
    (todoId: string) => {
      const responder = PanResponder.create({
        // touch 시작 시점엔 capture 하지 않음 — long-press 가 fire 되어야
        // 본격적으로 drag 모드로 들어감. 그 전엔 부모(터치/스크롤)에 양보.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gestureState) => {
          // long-press fire 후 (activeId 가 set 된 상태) 에서 손가락이
          // 움직이면 drag 로 인식.
          return activeIdRef.current === todoId &&
            (Math.abs(gestureState.dx) > 1 || Math.abs(gestureState.dy) > 1);
        },

        onPanResponderGrant: (evt) => {
          // 첫 터치 — long-press 타이머 시작. 타이머가 fire 되면 비로소
          // drag state 를 만들어 ghost 가 보이기 시작한다.
          const { pageX, pageY } = evt.nativeEvent;
          cancelLongPress();
          longPressTimerRef.current = setTimeout(() => {
            activeIdRef.current = todoId;
            setTodoDragState({ todoId, pageX, pageY });
          }, longPressMs);
        },

        onPanResponderMove: (evt) => {
          const { pageX, pageY } = evt.nativeEvent;
          // 타이머 fire 전에 손가락이 많이 움직이면 의도 안 한 drag —
          // 타이머 cancel 해서 strip 스크롤/탭 으로 양보.
          if (activeIdRef.current !== todoId) {
            cancelLongPress();
            return;
          }
          setTodoDragState({ todoId, pageX, pageY });
        },

        onPanResponderRelease: (evt) => {
          cancelLongPress();
          const dragging = activeIdRef.current;
          activeIdRef.current = null;
          setTodoDragState(null);
          if (dragging !== todoId) return; // 진짜 drag 가 아니면 종료

          const { pageX, pageY } = evt.nativeEvent;
          const offset = eventsAreaPageOffsetRef.current;
          // hit-test + snap 은 순수 함수에 위임 (단위 테스트 가능).
          const newDueAt = computeTodoDropTarget({
            pageX, pageY,
            eventsAreaPageX: offset.x,
            eventsAreaPageY: offset.y,
            columnWidth,
            weekDays,
            hourHeight,
            snapMinutes,
          });
          if (newDueAt) onDrop(todoId, newDueAt);
        },

        onPanResponderTerminate: () => {
          cancelLongPress();
          activeIdRef.current = null;
          setTodoDragState(null);
        },
      });
      return responder.panHandlers;
    },
    [
      cancelLongPress,
      columnWidth,
      eventsAreaPageOffsetRef,
      hourHeight,
      longPressMs,
      onDrop,
      snapMinutes,
      weekDays,
    ],
  );

  return { todoDragState, getPanHandlers };
}
