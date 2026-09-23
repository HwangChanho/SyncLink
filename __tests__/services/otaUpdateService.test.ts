/**
 * otaUpdateService 테스트 — 1.5.0 OTA 업데이트 안내.
 *
 * 잠그는 것:
 *   - 새 업데이트가 있으면 내려받고 true(→ 배너가 뜬다)
 *   - 없거나 / 확인·다운로드가 실패하면 false — **예외를 밖으로 던지지 않는다**
 *     (업데이트 확인 실패가 앱 사용을 막으면 안 된다)
 *   - 업데이트가 꺼진 바이너리에서는 서버를 부르지도 않는다
 */
const mockCheck = jest.fn();
const mockFetch = jest.fn();
const mockReload = jest.fn();
const mockUpdates = { isEnabled: true };

jest.mock('expo-updates', () => ({
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  checkForUpdateAsync: (...a: unknown[]) => mockCheck(...a),
  fetchUpdateAsync: (...a: unknown[]) => mockFetch(...a),
  reloadAsync: (...a: unknown[]) => mockReload(...a),
}));

// __DEV__ 는 jest 에서 true 라 서비스가 항상 건너뛴다 → 운영 빌드처럼 false 로 둔다
const g = globalThis as unknown as { __DEV__: boolean };
const originalDev = g.__DEV__;

import {
  applyOtaUpdate,
  canCheckOtaUpdate,
  fetchOtaUpdateIfAvailable,
} from '@/services/otaUpdateService';

describe('otaUpdateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    g.__DEV__ = false;
    mockUpdates.isEnabled = true;
  });
  afterAll(() => {
    g.__DEV__ = originalDev;
  });

  it('새 업데이트가 있으면 내려받고 true', async () => {
    mockCheck.mockResolvedValue({ isAvailable: true });
    mockFetch.mockResolvedValue({ isNew: true });
    await expect(fetchOtaUpdateIfAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('새 업데이트가 없으면 내려받지 않고 false', async () => {
    mockCheck.mockResolvedValue({ isAvailable: false });
    await expect(fetchOtaUpdateIfAvailable()).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('확인이 실패해도(오프라인 등) 예외 없이 false', async () => {
    mockCheck.mockRejectedValue(new Error('network'));
    await expect(fetchOtaUpdateIfAvailable()).resolves.toBe(false);
  });

  it('업데이트가 꺼진 바이너리에서는 서버를 부르지 않는다', async () => {
    mockUpdates.isEnabled = false;
    expect(canCheckOtaUpdate()).toBe(false);
    await expect(fetchOtaUpdateIfAvailable()).resolves.toBe(false);
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('개발 빌드(__DEV__)에서는 확인하지 않는다', () => {
    g.__DEV__ = true;
    expect(canCheckOtaUpdate()).toBe(false);
  });

  it('적용은 리로드를 부른다', async () => {
    await applyOtaUpdate();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
