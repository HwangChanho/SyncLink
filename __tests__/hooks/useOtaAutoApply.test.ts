/**
 * useOtaAutoApply 테스트 — 2026-09-29 LEAD «OTA 버튼 안 눌리고 내부적으로 변경사항 반영되게».
 *
 * 잠그는 것:
 *   - 받아 둔 업데이트는 **백그라운드 1분 이상 → 복귀** 순간에만 적용(리로드)한다
 *   - 사용자가 화면을 쓰는 중(복귀 이벤트 없음)이나 잠깐(1분 미만) 나갔다 온 경우엔 적용하지 않는다
 *     (리로드는 쓰던 입력을 지운다)
 *   - inactive(알림센터 내리기 등)는 앱을 떠난 걸로 치지 않는다
 *   - 받을 업데이트가 없으면 아무리 오래 비워도 리로드하지 않는다
 */
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockFetch = jest.fn();
const mockApply = jest.fn();

// 판단 함수(shouldApplyOnResume)는 진짜를 쓰고, 서버·리로드만 가짜로 바꾼다
jest.mock('@/services/otaUpdateService', () => ({
  ...jest.requireActual('@/services/otaUpdateService'),
  fetchOtaUpdateIfAvailable: (...a: unknown[]) => mockFetch(...a),
  applyOtaUpdate: (...a: unknown[]) => mockApply(...a),
}));

import { useOtaAutoApply } from '@/hooks/useOtaAutoApply';

/** AppState 'change' 리스너를 가로채 테스트에서 상태 전환을 흉내 낸다 */
let emit: (s: AppStateStatus) => void = () => {};
let now = 1_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    emit = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  mockApply.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** 훅을 띄우고 시작 시 확인(다운로드)이 끝날 때까지 기다린다 */
async function mountWithUpdate(isNew: boolean) {
  mockFetch.mockResolvedValue(isNew);
  renderHook(() => useOtaAutoApply());
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  await act(async () => {}); // fetch 결과(readyRef) 반영
}

/** 백그라운드로 갔다가 ms 뒤 돌아온다 */
function leaveAndReturn(ms: number) {
  act(() => emit('background'));
  now += ms;
  act(() => emit('active'));
}

describe('useOtaAutoApply', () => {
  it('받아 둔 업데이트는 1분 이상 비웠다가 돌아오면 조용히 적용한다', async () => {
    await mountWithUpdate(true);
    expect(mockApply).not.toHaveBeenCalled(); // 받자마자 리로드하지 않는다
    leaveAndReturn(60 * 1000);
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('1분 안에 돌아오면 적용하지 않는다(쓰던 입력 보존)', async () => {
    await mountWithUpdate(true);
    leaveAndReturn(59 * 1000);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('inactive 만 거친 복귀는 떠난 걸로 치지 않는다', async () => {
    await mountWithUpdate(true);
    act(() => emit('inactive'));
    now += 10 * 60 * 1000;
    act(() => emit('active'));
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('받은 업데이트가 없으면 오래 비워도 리로드하지 않는다', async () => {
    await mountWithUpdate(false);
    leaveAndReturn(10 * 60 * 1000);
    expect(mockApply).not.toHaveBeenCalled();
    // 대신 복귀 때 다시 확인한다(5분 간격을 넘겼으므로)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
