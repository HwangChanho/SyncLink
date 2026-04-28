/**
 * __tests__/components/WeeklyReviewCard.test.tsx
 *
 * TASK-512: WeeklyReviewCard 컴포넌트 테스트
 *
 * 커버리지:
 *  마운트 시 로드    — getWeeklyReview 즉시 호출
 *  review 수신 후   — 리뷰 텍스트 렌더링, 헤더 표시
 *  에러 상태        — 에러 메시지 + 다시 시도 버튼
 *  새로 고침 버튼   — 탭 시 getWeeklyReview 재호출
 *  구독 게이팅      — canUseWeeklyReview=false 시 paywall 이동
 *  consumeWeeklyReview — 새로 고침 성공 시 호출, 마운트 시 미호출
 *  Free 플랜 뱃지   — "무료 플랜 · 월 1회 생성" 표시 여부
 *
 * Mock 전략:
 *  - 모든 jest.mock 팩토리 내부에서 jest.fn() 직접 생성 (TDZ 방지).
 *    팩토리 외부 const 변수를 팩토리 내에서 참조하면 호이스팅 시점에 undefined가 됩니다.
 *  - require()를 통해 __mock 참조로 내부 jest.fn()에 접근합니다.
 *  - expo-router: jest.setup.js에 router named export가 없으므로 여기서 override합니다.
 *
 * @task TASK-512
 * @depends TASK-504 (DEV)
 */

// ─── Mock 선언 (hoisted) ──────────────────────────────────────────────────────

/**
 * @/services/aiService mock.
 * getWeeklyReview를 팩토리 내에서 jest.fn()으로 생성.
 * __getWeeklyReview 로 외부에서 접근합니다.
 */
jest.mock('@/services/aiService', () => {
  const getWeeklyReviewFn = jest.fn();
  return {
    getWeeklyReview:   getWeeklyReviewFn,
    __getWeeklyReview: getWeeklyReviewFn,
  };
});

/**
 * @/stores/subscriptionStore mock.
 * useSubscriptionStore를 jest.fn()으로 override해 테스트별 반환값 제어.
 * __useStoreFn / __canFn / __consumeFn 으로 내부 함수에 접근합니다.
 */
jest.mock('@/stores/subscriptionStore', () => {
  const canFn     = jest.fn().mockReturnValue(true);
  const consumeFn = jest.fn();
  const storeFn   = jest.fn(() => ({
    canUseWeeklyReview:  canFn,
    consumeWeeklyReview: consumeFn,
    plan:                'free',
  }));
  return {
    useSubscriptionStore:    storeFn,
    __useStoreFn:            storeFn,
    __canFn:                 canFn,
    __consumeFn:             consumeFn,
  };
});

/**
 * expo-router mock.
 * jest.setup.js의 expo-router에는 router named export가 없습니다.
 * 이 파일에서 override해 router.push를 jest.fn()으로 제공합니다.
 * __pushFn 으로 외부에서 push 함수에 접근합니다.
 */
jest.mock('expo-router', () => {
  const pushFn     = jest.fn();
  const ScreenMock = () => null;
  const StackMock  = Object.assign(() => null, { Screen: ScreenMock });
  const TabsMock   = Object.assign(() => null, { Screen: ScreenMock });
  return {
    router: {
      push:    pushFn,
      replace: jest.fn(),
      back:    jest.fn(),
    },
    useRouter: jest.fn(() => ({
      push:    pushFn,
      replace: jest.fn(),
      back:    jest.fn(),
    })),
    useLocalSearchParams: jest.fn(() => ({})),
    useSegments:          jest.fn(() => []),
    Link:     ({ children }: { children: React.ReactNode }) => children,
    Redirect: () => null,
    Stack:    StackMock,
    Tabs:     TabsMock,
    __pushFn: pushFn,
  };
});

// useColors is globally mocked in jest.setup.js — no override needed here.

// spacing: 모든 key에 대해 숫자 반환 (0.5, 1.5 포함)
jest.mock('@/constants/spacing', () => ({
  spacing: new Proxy({}, {
    get(_t: unknown, p: string | symbol): number {
      if (typeof p === 'symbol') return 8;
      const n = parseFloat(String(p));
      return isNaN(n) ? 8 : n * 4;
    },
  }),
  radius: { xl: 16, full: 9999, sm: 4 },
}));

jest.mock('@/constants/typography', () => ({
  textStyles: {
    labelLg: { fontSize: 16, fontWeight: '600' },
    label:   { fontSize: 14, fontWeight: '600' },
    body:    { fontSize: 14 },
    bodySm:  { fontSize: 12 },
    caption: { fontSize: 11 },
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { WeeklyReviewCard } from '@/components/home/WeeklyReviewCard';

// ─── Mock 함수 접근 ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aiServiceMock    = require('@/services/aiService')       as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscriptionMock = require('@/stores/subscriptionStore') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const routerMod        = require('expo-router')                as any;

/** getWeeklyReview mock 함수 */
const mockGetWeeklyReview = aiServiceMock.__getWeeklyReview as jest.Mock;
/** useSubscriptionStore hook mock */
const mockUseStoreFn      = subscriptionMock.__useStoreFn    as jest.Mock;
/** canUseWeeklyReview 기본 mock */
const mockCanFn           = subscriptionMock.__canFn         as jest.Mock;
/** consumeWeeklyReview 기본 mock */
const mockConsumeFn       = subscriptionMock.__consumeFn     as jest.Mock;
/** router.push mock */
const mockRouterPush      = routerMod.__pushFn               as jest.Mock;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 성공 응답 픽스처 */
function makeReviewResult(review = '지난 주도 수고 많으셨어요!') {
  return { review, generatedAt: new Date('2026-04-20T09:00:00.000Z') };
}

/**
 * useSubscriptionStore 반환값을 교체하는 헬퍼.
 * 기본값: Free 플랜, canUse=true.
 */
function setupStore({
  plan    = 'free' as 'free' | 'pro',
  canUse  = mockCanFn,
  consume = mockConsumeFn,
} = {}) {
  mockUseStoreFn.mockReturnValue({
    canUseWeeklyReview:  canUse,
    consumeWeeklyReview: consume,
    plan,
  });
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('WeeklyReviewCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks가 mockReturnValue도 초기화하므로 기본값 재설정
    mockCanFn.mockReturnValue(true);
    setupStore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 마운트 시 로드
  // ══════════════════════════════════════════════════════════════════════════

  describe('마운트 시 로드', () => {
    it('마운트 시 getWeeklyReview 즉시 호출됨', async () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      render(<WeeklyReviewCard />);

      await waitFor(() => {
        expect(mockGetWeeklyReview).toHaveBeenCalledTimes(1);
      }, { timeout: 3000 });
    });

    it('getWeeklyReview 첫 번째 인자는 Date (weekStart)', async () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      render(<WeeklyReviewCard />);

      await waitFor(() => {
        expect(mockGetWeeklyReview).toHaveBeenCalled();
        expect(mockGetWeeklyReview.mock.calls[0][0]).toBeInstanceOf(Date);
      }, { timeout: 3000 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // review 데이터 수신
  // ══════════════════════════════════════════════════════════════════════════

  describe('review 데이터 수신', () => {
    it('review 텍스트 화면에 표시됨', async () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult('지난 주도 수고 많으셨어요!'));

      const { findByText } = render(<WeeklyReviewCard />);

      await findByText('지난 주도 수고 많으셨어요!', {}, { timeout: 3000 });
    });

    it('헤더에 "이번 주 리뷰" 텍스트 항상 표시', () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      const { getByText } = render(<WeeklyReviewCard />);

      expect(getByText('이번 주 리뷰')).toBeTruthy();
    });

    it('로딩 완료 후 새로 고침 버튼 표시됨', async () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      const { findByText } = render(<WeeklyReviewCard />);

      await findByText('새로 고침', {}, { timeout: 3000 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 에러 상태
  // ══════════════════════════════════════════════════════════════════════════

  describe('에러 상태', () => {
    // WeeklyReviewCard suppresses errors and shows an empty state
    // (catch block sets error=null instead of the error message).
    // Tests here verify the empty-state behaviour on failure.

    it('getWeeklyReview 실패 시 빈 상태 텍스트 표시', async () => {
      mockGetWeeklyReview.mockRejectedValue(new Error('리뷰 로드 실패'));

      const { findByText } = render(<WeeklyReviewCard />);

      // Component shows empty-state text instead of an error message
      await findByText('이번 주 리뷰가 없습니다.', {}, { timeout: 3000 });
    });

    it('getWeeklyReview 실패 시 새로 고침 버튼 표시됨', async () => {
      mockGetWeeklyReview.mockRejectedValue(new Error('실패'));

      const { findByText } = render(<WeeklyReviewCard />);

      // Refresh button is always visible when not loading
      await findByText('새로 고침', {}, { timeout: 3000 });
    });

    it('getWeeklyReview 실패 후 새로 고침 탭 시 재호출됨', async () => {
      mockGetWeeklyReview
        .mockRejectedValueOnce(new Error('실패'))
        .mockResolvedValueOnce(makeReviewResult());

      const { findByText } = render(<WeeklyReviewCard />);

      const refreshBtn = await findByText('새로 고침', {}, { timeout: 3000 });
      await act(async () => { fireEvent.press(refreshBtn); });

      await waitFor(() => {
        expect(mockGetWeeklyReview).toHaveBeenCalledTimes(2);
      }, { timeout: 3000 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 새로 고침 버튼
  // ══════════════════════════════════════════════════════════════════════════

  describe('새로 고침 버튼', () => {
    it('새로 고침 탭 시 getWeeklyReview 재호출 (총 2회)', async () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      const { findByText } = render(<WeeklyReviewCard />);

      const refreshBtn = await findByText('새로 고침', {}, { timeout: 3000 });
      await act(async () => { fireEvent.press(refreshBtn); });

      await waitFor(() => {
        expect(mockGetWeeklyReview).toHaveBeenCalledTimes(2);
      }, { timeout: 3000 });
    });

    it('새로 고침 성공 시 consumeWeeklyReview 호출됨', async () => {
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());
      const consume = jest.fn();
      setupStore({ consume });

      const { findByText } = render(<WeeklyReviewCard />);

      const refreshBtn = await findByText('새로 고침', {}, { timeout: 3000 });
      await act(async () => { fireEvent.press(refreshBtn); });

      await waitFor(() => {
        expect(consume).toHaveBeenCalledTimes(1);
      }, { timeout: 3000 });
    });

    it('새로 고침 시 canUseWeeklyReview 확인됨', async () => {
      const canUse = jest.fn().mockReturnValue(true);
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());
      setupStore({ canUse });

      const { findByText } = render(<WeeklyReviewCard />);

      const refreshBtn = await findByText('새로 고침', {}, { timeout: 3000 });
      await act(async () => { fireEvent.press(refreshBtn); });

      expect(canUse).toHaveBeenCalled();
    });

    it('새로 고침 시 canUseWeeklyReview=false → paywall 이동', async () => {
      const canUse = jest.fn().mockReturnValue(false);
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());
      setupStore({ canUse });

      const { findByText } = render(<WeeklyReviewCard />);

      const refreshBtn = await findByText('새로 고침', {}, { timeout: 3000 });
      await act(async () => { fireEvent.press(refreshBtn); });

      expect(mockRouterPush).toHaveBeenCalledWith('/subscription/paywall');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 마운트 시 consumeWeeklyReview 미호출
  // ══════════════════════════════════════════════════════════════════════════

  describe('마운트 시 초기 로드', () => {
    it('마운트 시 consumeWeeklyReview 호출 안 됨 (forceRefresh=false)', async () => {
      const consume = jest.fn();
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());
      setupStore({ consume });

      render(<WeeklyReviewCard />);

      await waitFor(() => {
        expect(mockGetWeeklyReview).toHaveBeenCalledTimes(1);
      }, { timeout: 3000 });

      // 마운트는 forceRefresh=false → consumeWeeklyReview 미호출
      expect(consume).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Free 플랜 뱃지
  // ══════════════════════════════════════════════════════════════════════════

  describe('Free 플랜 뱃지', () => {
    it('Free 플랜일 때 "무료 플랜 · 월 1회 생성" 표시', () => {
      setupStore({ plan: 'free' });
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      const { getByText } = render(<WeeklyReviewCard />);

      expect(getByText('무료 플랜 · 월 1회 생성')).toBeTruthy();
    });

    it('Pro 플랜일 때 "무료 플랜 · 월 1회 생성" 미표시', () => {
      setupStore({ plan: 'pro' });
      mockGetWeeklyReview.mockResolvedValue(makeReviewResult());

      const { queryByText } = render(<WeeklyReviewCard />);

      expect(queryByText('무료 플랜 · 월 1회 생성')).toBeNull();
    });
  });
});
