/**
 * __tests__/components/EventBlockGestureHandler.test.tsx
 *
 * TASK-009 Day 4+5 — useUndoToast + useOptimisticReschedule 단위 테스트.
 *
 * 전략:
 *   - useUndoToast: renderHook으로 훅 상태(toast visible/label/onUndo) 검증.
 *   - useOptimisticReschedule:
 *       · findConflictingEvents mock → 충돌 없을 때 즉시 update 호출 검증.
 *       · findConflictingEvents mock → 충돌 있을 때 Alert.alert 호출 검증.
 *       · updateEvent 실패 시 rollback + Alert.alert 호출 검증.
 *       · onMoved 콜백: 성공 시 호출, 실패 시 미호출 검증.
 *   - UndoToast 컴포넌트: 렌더링 + "되돌리기" 버튼 탭 검증.
 *
 * Mock 전략:
 *   - eventService (findConflictingEvents, updateEvent) 전체 mock.
 *   - spaceStore (activeSpaceId) mock.
 *   - eventStore (upsertEvent) mock — getState() 반환값 주입.
 *   - Alert.alert mock — jest.fn()으로 교체 후 호출 인수 검증.
 *
 * @task TASK-009 Day 4+5
 */

import React from 'react';
import { Alert } from 'react-native';
import { renderHook, act, render, fireEvent } from '@testing-library/react-native';

// ─── Module mocks (선언부 호이스팅 필수) ──────────────────────────────────────

jest.mock('@/services/eventService', () => ({
  findConflictingEvents: jest.fn(),
  updateEvent: jest.fn(),
}));

jest.mock('@/stores/spaceStore', () => ({
  useSpaceStore: {
    getState: jest.fn(() => ({ activeSpaceId: 'space-001' })),
  },
}));

jest.mock('@/stores/eventStore', () => ({
  useEventStore: {
    getState: jest.fn(() => ({
      upsertEvent: jest.fn(),
    })),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  useUndoToast,
  UndoToast,
  useOptimisticReschedule,
} from '@/components/calendar/EventBlockGestureHandler';
import type { DroppedPayload } from '@/components/calendar/EventBlockGestureHandler';
import { findConflictingEvents, updateEvent } from '@/services/eventService';
import { useSpaceStore } from '@/stores/spaceStore';
import { useEventStore } from '@/stores/eventStore';
import type { EventSummary } from '@/types';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Typed mock references for convenient assertion. */
const mockFindConflicts = findConflictingEvents as jest.MockedFunction<typeof findConflictingEvents>;
const mockUpdateEvent   = updateEvent           as jest.MockedFunction<typeof updateEvent>;
const mockGetSpaceState = useSpaceStore.getState as jest.MockedFunction<typeof useSpaceStore.getState>;
const mockGetEventState = useEventStore.getState as jest.MockedFunction<typeof useEventStore.getState>;

/** Minimal EventSummary fixture. */
const makeEvent = (overrides?: Partial<EventSummary>): EventSummary => ({
  id:      'evt-001',
  title:   '팀 미팅',
  startAt: new Date(2026, 0, 12, 9, 0),
  endAt:   new Date(2026, 0, 12, 10, 0),
  allDay:  false,
  color:   '#6C63FF',
  isOwn:   true,
  ...overrides,
});

/** Minimal DroppedPayload fixture. */
const makePayload = (event: EventSummary): DroppedPayload => ({
  event,
  dayDelta:    0,
  minuteDelta: 30,
  newStartAt:  new Date(2026, 0, 12, 9, 30),
  newEndAt:    new Date(2026, 0, 12, 10, 30),
});

// ─── useUndoToast ─────────────────────────────────────────────────────────────

describe('useUndoToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('초기 상태: toast = null', () => {
    const { result } = renderHook(() => useUndoToast());
    expect(result.current.toast).toBeNull();
  });

  it('showUndo 호출 후 toast.visible = true + label 설정', () => {
    const { result } = renderHook(() => useUndoToast());
    const undoFn = jest.fn();

    act(() => {
      result.current.showUndo('팀 미팅', undoFn);
    });

    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.visible).toBe(true);
    expect(result.current.toast?.label).toBe('팀 미팅');
  });

  it('5초 후 toast 자동 dismiss', () => {
    const { result } = renderHook(() => useUndoToast());

    act(() => {
      result.current.showUndo('팀 미팅', jest.fn());
    });

    expect(result.current.toast).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(result.current.toast).toBeNull();
  });

  it('5초 이전 자동 dismiss 안 됨', () => {
    const { result } = renderHook(() => useUndoToast());

    act(() => {
      result.current.showUndo('팀 미팅', jest.fn());
    });

    act(() => {
      jest.advanceTimersByTime(4999);
    });

    expect(result.current.toast).not.toBeNull();
  });

  it('toast.onUndo 호출 시 undoFn 실행 + toast null', () => {
    const { result } = renderHook(() => useUndoToast());
    const undoFn = jest.fn();

    act(() => {
      result.current.showUndo('팀 미팅', undoFn);
    });

    act(() => {
      result.current.toast!.onUndo();
    });

    expect(undoFn).toHaveBeenCalledTimes(1);
    expect(result.current.toast).toBeNull();
  });

  it('onUndo 후 타이머 만료해도 에러 없음', () => {
    const { result } = renderHook(() => useUndoToast());

    // showUndo를 먼저 실행해 toast를 설정한다
    act(() => {
      result.current.showUndo('팀 미팅', jest.fn());
    });

    // toast 참조를 캡처한 뒤 onUndo 호출
    const captured = result.current.toast!;
    act(() => {
      captured.onUndo();
    });

    // 타이머 만료해도 이미 null이므로 문제없어야 함
    expect(() => act(() => { jest.advanceTimersByTime(5000); })).not.toThrow();
    expect(result.current.toast).toBeNull();
  });

  it('showUndo를 연속 호출하면 마지막 토스트만 유지', () => {
    const { result } = renderHook(() => useUndoToast());

    act(() => {
      result.current.showUndo('첫 번째', jest.fn());
    });

    act(() => {
      result.current.showUndo('두 번째', jest.fn());
    });

    expect(result.current.toast?.label).toBe('두 번째');
  });
});

// ─── UndoToast component ─────────────────────────────────────────────────────

describe('UndoToast', () => {
  it('레이블과 되돌리기 버튼 렌더링', () => {
    const onUndo = jest.fn();
    const toast = { visible: true, label: '팀 미팅', onUndo };

    const { getByTestId, getByText } = render(<UndoToast toast={toast} />);

    expect(getByTestId('undo-toast')).toBeTruthy();
    expect(getByText('"팀 미팅" 이동됨')).toBeTruthy();
    expect(getByTestId('undo-toast-button')).toBeTruthy();
  });

  it('되돌리기 버튼 탭 시 onUndo 콜백 호출', () => {
    const onUndo = jest.fn();
    const toast = { visible: true, label: '팀 미팅', onUndo };

    const { getByTestId } = render(<UndoToast toast={toast} />);

    fireEvent.press(getByTestId('undo-toast-button'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

// ─── useOptimisticReschedule ─────────────────────────────────────────────────

describe('useOptimisticReschedule', () => {
  let mockUpsertEvent: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertEvent = jest.fn();
    mockGetEventState.mockReturnValue({ upsertEvent: mockUpsertEvent } as ReturnType<typeof useEventStore.getState>);
    mockGetSpaceState.mockReturnValue({ activeSpaceId: 'space-001' } as ReturnType<typeof useSpaceStore.getState>);
    mockFindConflicts.mockResolvedValue([]);
    mockUpdateEvent.mockResolvedValue(undefined as never);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 충돌 없음 ──────────────────────────────────────────────────────────────

  it('충돌 없음: findConflictingEvents 호출 후 updateEvent 호출', async () => {
    const { result } = renderHook(() => useOptimisticReschedule());
    const event = makeEvent();
    const payload = makePayload(event);

    await act(async () => {
      await result.current(payload);
    });

    expect(mockFindConflicts).toHaveBeenCalledWith(
      'space-001',
      payload.newStartAt,
      payload.newEndAt,
      event.id,
    );
    expect(mockUpdateEvent).toHaveBeenCalledWith(event.id, {
      startAt: payload.newStartAt,
      endAt:   payload.newEndAt,
    });
  });

  it('충돌 없음: 낙관적 upsert → updateEvent 순서 보장', async () => {
    const callOrder: string[] = [];
    mockUpsertEvent.mockImplementation(() => { callOrder.push('upsert'); });
    mockUpdateEvent.mockImplementation(async () => { callOrder.push('update'); });

    const { result } = renderHook(() => useOptimisticReschedule());
    const event = makeEvent();

    await act(async () => {
      await result.current(makePayload(event));
    });

    expect(callOrder).toEqual(['upsert', 'update']);
  });

  it('충돌 없음 + onMoved 콜백: 성공 시 호출', async () => {
    const onMoved = jest.fn();
    const { result } = renderHook(() => useOptimisticReschedule({ onMoved }));
    const event = makeEvent();

    await act(async () => {
      await result.current(makePayload(event));
    });

    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(onMoved).toHaveBeenCalledWith(event.title, expect.any(Function));
  });

  // ── 충돌 있음 ──────────────────────────────────────────────────────────────

  it('충돌 있음: Alert.alert 호출 (conflict 경고)', async () => {
    mockFindConflicts.mockResolvedValue([
      {
        id: 'conflict-evt-1',
        title: '기존 회의',
        ownerNickname: '홍길동',
        startAt: new Date(2026, 0, 12, 9, 0),
        endAt:   new Date(2026, 0, 12, 10, 30),
      },
    ]);

    // Alert.alert는 콜백 없이 그냥 호출됨 — resolve(false) 시뮬레이션 불필요
    // (mock 구현이 아무것도 안 하면 Promise never resolves 이슈 방지를 위해
    //  Alert.alert 자체 호출 여부만 검증)
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(
      (_title, _msg, buttons) => {
        // 취소 버튼(첫 번째) 즉시 호출해 Promise 완료시킴
        (buttons?.[0] as { onPress?: () => void })?.onPress?.();
      },
    );

    const { result } = renderHook(() => useOptimisticReschedule());
    const event = makeEvent();

    await act(async () => {
      await result.current(makePayload(event));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    // 타이틀 확인
    expect(alertSpy.mock.calls[0]?.[0]).toBe('일정 겹침');
  });

  it('충돌 → 취소 선택 시: updateEvent 미호출 + upsert 미호출', async () => {
    mockFindConflicts.mockResolvedValue([
      {
        id: 'conflict-evt-1',
        title: '기존 회의',
        ownerNickname: '홍길동',
        startAt: new Date(2026, 0, 12, 9, 0),
        endAt:   new Date(2026, 0, 12, 10, 30),
      },
    ]);

    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      // 취소(첫 번째 버튼) 호출
      (buttons?.[0] as { onPress?: () => void })?.onPress?.();
    });

    const { result } = renderHook(() => useOptimisticReschedule());

    await act(async () => {
      await result.current(makePayload(makeEvent()));
    });

    expect(mockUpsertEvent).not.toHaveBeenCalled();
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it('충돌 → 이동 확인 시: updateEvent 호출', async () => {
    mockFindConflicts.mockResolvedValue([
      {
        id: 'conflict-evt-1',
        title: '기존 회의',
        ownerNickname: '홍길동',
        startAt: new Date(2026, 0, 12, 9, 0),
        endAt:   new Date(2026, 0, 12, 10, 30),
      },
    ]);

    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      // 이동(두 번째 버튼) 호출
      (buttons?.[1] as { onPress?: () => void })?.onPress?.();
    });

    const { result } = renderHook(() => useOptimisticReschedule());
    const event = makeEvent();
    const payload = makePayload(event);

    await act(async () => {
      await result.current(payload);
    });

    expect(mockUpdateEvent).toHaveBeenCalledWith(event.id, {
      startAt: payload.newStartAt,
      endAt:   payload.newEndAt,
    });
  });

  // ── 네트워크 실패 (rollback) ──────────────────────────────────────────────

  it('updateEvent 실패 시: rollback upsert 호출 + Alert.alert 호출', async () => {
    mockUpdateEvent.mockRejectedValue(new Error('Network error'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { result } = renderHook(() => useOptimisticReschedule());
    const event = makeEvent();

    await act(async () => {
      await result.current(makePayload(event));
    });

    // upsertEvent 2회 호출: 1회=낙관적 업데이트, 2회=롤백
    expect(mockUpsertEvent).toHaveBeenCalledTimes(2);
    // 두 번째 upsert 호출은 원본 이벤트로 롤백
    expect(mockUpsertEvent.mock.calls[1]?.[0]).toMatchObject({ id: event.id });
    // Alert 표시
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe('이동 실패');
  });

  it('updateEvent 실패 시: onMoved 미호출', async () => {
    mockUpdateEvent.mockRejectedValue(new Error('Network error'));
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onMoved = jest.fn();

    const { result } = renderHook(() => useOptimisticReschedule({ onMoved }));

    await act(async () => {
      await result.current(makePayload(makeEvent()));
    });

    expect(onMoved).not.toHaveBeenCalled();
  });

  // ── spaceId 없음 (충돌 체크 skip) ────────────────────────────────────────

  it('activeSpaceId null → findConflictingEvents 미호출', async () => {
    mockGetSpaceState.mockReturnValue({ activeSpaceId: null } as ReturnType<typeof useSpaceStore.getState>);

    const { result } = renderHook(() => useOptimisticReschedule());

    await act(async () => {
      await result.current(makePayload(makeEvent()));
    });

    expect(mockFindConflicts).not.toHaveBeenCalled();
    // updateEvent는 정상 호출됨
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
  });
});
