/**
 * __tests__/services/funnelService.test.ts
 *
 * 퍼널 로깅(이탈 지점 기록)의 계약을 고정한다.
 *
 * 여기서 지키려는 것은 세 가지뿐이고, 셋 다 어기면 조용히 망가지는 종류다:
 *  ① 같은 단계는 세션당 한 번만 남는다 — 안 그러면 홈이 다시 그려질 때마다 쌓여
 *     "도달 인원"이 부풀고 퍼널이 거짓말을 한다.
 *  ② `always: true` 는 그 제한을 무시한다(일정 생성은 여러 번 세는 게 의미 있다).
 *  ③ **무슨 일이 있어도 throw 하지 않는다** — 기록 실패가 화면을 깨뜨리면 본말전도다.
 */

// ─── Mock 선언 (jest.mock 은 hoist 되므로 import 보다 위) ─────────────────────

const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockGetSession = jest.fn().mockResolvedValue({
  data: { session: { user: { id: 'user-1' } } },
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({ insert: mockInsert })),
    auth: { getSession: () => mockGetSession() },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'anon-fixed-uuid-for-test',
}));

jest.mock('expo-constants', () => ({
  expoConfig: { version: '9.9.9' },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { trackFunnel, __resetFunnelSessionForTest } from '@/services/funnelService';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  __resetFunnelSessionForTest();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('trackFunnel', () => {
  describe('기록 내용', () => {
    it('단계·플랫폼·앱버전·익명ID 를 함께 남긴다', async () => {
      await trackFunnel('home_view');

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'home_view',
          anon_id: 'anon-fixed-uuid-for-test',
          app_version: '9.9.9',
        }),
      );
    });

    it('로그인 상태면 user_id 를 함께 남긴다', async () => {
      await trackFunnel('signed_in');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1' }),
      );
    });

    it('비로그인이면 user_id 는 null 이다 (로그인 전 단계도 남아야 하므로)', async () => {
      mockGetSession.mockResolvedValue({ data: { session: null } });
      await trackFunnel('login_view');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: null }),
      );
    });
  });

  describe('세션당 1회 제한', () => {
    it('같은 단계를 여러 번 불러도 한 번만 남는다', async () => {
      await trackFunnel('home_view');
      await trackFunnel('home_view');
      await trackFunnel('home_view');

      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('다른 단계는 각각 남는다', async () => {
      await trackFunnel('app_open');
      await trackFunnel('home_view');

      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it('always: true 면 제한을 무시하고 매번 남는다', async () => {
      await trackFunnel('event_created', { always: true });
      await trackFunnel('event_created', { always: true });

      expect(mockInsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('실패해도 화면을 깨뜨리지 않는다', () => {
    it('insert 가 throw 해도 reject 하지 않는다', async () => {
      mockInsert.mockRejectedValue(new Error('network down'));
      await expect(trackFunnel('home_view')).resolves.toBeUndefined();
    });

    it('세션 조회가 throw 해도 reject 하지 않는다', async () => {
      mockGetSession.mockRejectedValue(new Error('auth exploded'));
      await expect(trackFunnel('home_view')).resolves.toBeUndefined();
    });
  });
});
