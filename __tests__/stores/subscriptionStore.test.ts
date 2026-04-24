/**
 * __tests__/stores/subscriptionStore.test.ts
 *
 * TASK-510: Subscription Store 테스트 스위트
 *
 * 커버리지:
 *  canUseAI          — Free + 4회 → true, 5회 → false, Pro → 무제한
 *  consumeAI         — aiUsageToday 증가
 *  자정 리셋          — lastResetDate가 오늘이면 리셋 안 함, 어제면 리셋
 *  setPlan           — plan 변경 후 canUseAI() 결과 변화
 *  canUseWeeklyReview — Free + 0회 → true, 1회 → false, Pro → 무제한
 *  consumeWeeklyReview — weeklyReviewUsedThisMonth 증가
 *  월별 리셋          — lastReviewResetMonth가 이전 달이면 리셋
 *  hydrate           — AsyncStorage에서 상태 복원 (날짜 비교 포함)
 *
 * Mock 전략:
 *  - @react-native-async-storage/async-storage: jest mock
 *  - lastResetDate / lastReviewResetMonth를 직접 setState로 조작
 *
 * @task TASK-510
 * @depends TASK-505 (DEV)
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Sprint 14 TASK-1403: mock out the credit service so the store's
// quota/credit branches don't hit Supabase during unit tests.
jest.mock('@/services/creditService', () => ({
  fetchAdCreditBalance: jest.fn(async () => 0),
  consumeAdCreditRemote: jest.fn(async () => null),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useSubscriptionStore,
  FREE_AI_DAILY_LIMIT,
  FREE_WEEKLY_REVIEW_MONTHLY_LIMIT,
} from '@/stores/subscriptionStore';

// ─── 헬퍼: 날짜 문자열 ────────────────────────────────────────────────────────

/**
 * 로컬 시간 기준 YYYY-MM-DD 반환.
 * subscriptionStore.ts의 todayString()과 동일한 방식.
 */
function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 로컬 시간 기준 YYYY-MM 반환.
 * subscriptionStore.ts의 currentMonthString()과 동일.
 */
function localMonthString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 어제 날짜 문자열 */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateString(d);
}

/** 지난 달 문자열 */
function lastMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return localMonthString(d);
}

// ─── 초기 상태 헬퍼 ───────────────────────────────────────────────────────────

/**
 * 스토어를 깨끗한 기본 상태로 리셋.
 * 각 테스트 전에 호출하여 테스트 간 상태 격리.
 */
function resetStore() {
  useSubscriptionStore.setState({
    plan:                        'free',
    aiUsageToday:                0,
    lastResetDate:               localDateString(),   // 오늘
    weeklyReviewUsedThisMonth:   0,
    lastReviewResetMonth:        localMonthString(),  // 이번 달
  });
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('useSubscriptionStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    resetStore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // canUseAI — Free 플랜 기본 동작
  // ══════════════════════════════════════════════════════════════════════════

  describe('canUseAI — Free 플랜', () => {
    it('사용 0회 → true', () => {
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
    });

    it(`사용 ${FREE_AI_DAILY_LIMIT - 1}회 → true (한도 미달)`, () => {
      useSubscriptionStore.setState({ aiUsageToday: FREE_AI_DAILY_LIMIT - 1 });

      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
    });

    it(`사용 ${FREE_AI_DAILY_LIMIT}회 → false (한도 도달)`, () => {
      useSubscriptionStore.setState({ aiUsageToday: FREE_AI_DAILY_LIMIT });

      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(false);
    });

    it('한도 초과 상태(6회)에서도 false', () => {
      useSubscriptionStore.setState({ aiUsageToday: FREE_AI_DAILY_LIMIT + 1 });

      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // canUseAI — Pro 플랜 (무제한)
  // ══════════════════════════════════════════════════════════════════════════

  describe('canUseAI — Pro 플랜', () => {
    beforeEach(() => {
      useSubscriptionStore.setState({ plan: 'pro' });
    });

    it('Pro + 0회 → true', () => {
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
    });

    it('Pro + 한도 초과 횟수에서도 → true (무제한)', () => {
      useSubscriptionStore.setState({ aiUsageToday: FREE_AI_DAILY_LIMIT + 100 });

      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // canUseAI — 자정 리셋
  // ══════════════════════════════════════════════════════════════════════════

  describe('canUseAI — 자정 리셋', () => {
    it('어제 날짜로 lastResetDate 설정 시 → 리셋 후 true 반환', () => {
      /**
       * 핸드오프 패턴대로:
       *  1. lastResetDate를 어제로 세팅
       *  2. aiUsageToday를 FREE_AI_DAILY_LIMIT (5)으로 소진
       *  3. canUseAI() 호출 → 자동 리셋 → true
       */
      useSubscriptionStore.setState({
        aiUsageToday:  FREE_AI_DAILY_LIMIT,
        lastResetDate: yesterday(),
      });

      const result = useSubscriptionStore.getState().canUseAI();

      expect(result.allowed).toBe(true);
    });

    it('자정 리셋 후 aiUsageToday = 0으로 갱신됨', () => {
      useSubscriptionStore.setState({
        aiUsageToday:  FREE_AI_DAILY_LIMIT,
        lastResetDate: yesterday(),
      });

      useSubscriptionStore.getState().canUseAI(); // 리셋 트리거

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(0);
    });

    it('자정 리셋 후 lastResetDate가 오늘 날짜로 갱신됨', () => {
      useSubscriptionStore.setState({
        aiUsageToday:  3,
        lastResetDate: yesterday(),
      });

      useSubscriptionStore.getState().canUseAI();

      expect(useSubscriptionStore.getState().lastResetDate).toBe(localDateString());
    });

    it('오늘 날짜이면 리셋 없음 — aiUsageToday 유지', () => {
      useSubscriptionStore.setState({
        aiUsageToday:  3,
        lastResetDate: localDateString(), // 오늘
      });

      useSubscriptionStore.getState().canUseAI();

      // 리셋되지 않아 여전히 3
      expect(useSubscriptionStore.getState().aiUsageToday).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // consumeAI
  // ══════════════════════════════════════════════════════════════════════════

  describe('consumeAI', () => {
    it('consumeAI 호출 시 aiUsageToday 1 증가', () => {
      useSubscriptionStore.getState().consumeAI();

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(1);
    });

    it('연속 3회 호출 시 aiUsageToday = 3', () => {
      useSubscriptionStore.getState().consumeAI();
      useSubscriptionStore.getState().consumeAI();
      useSubscriptionStore.getState().consumeAI();

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(3);
    });

    it('consumeAI 시 AsyncStorage.setItem 호출됨 (persist)', () => {
      useSubscriptionStore.getState().consumeAI();

      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    });

    it('어제 날짜 상태에서 consumeAI 시 카운터 0→1 (리셋 후 증가)', () => {
      useSubscriptionStore.setState({
        aiUsageToday:  FREE_AI_DAILY_LIMIT,
        lastResetDate: yesterday(),
      });

      useSubscriptionStore.getState().consumeAI();

      // 리셋 후 1이 됨
      expect(useSubscriptionStore.getState().aiUsageToday).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setPlan
  // ══════════════════════════════════════════════════════════════════════════

  describe('setPlan', () => {
    it("setPlan('pro') 후 canUseAI() = true (무제한)", () => {
      // Free 상태에서 한도 소진
      useSubscriptionStore.setState({ aiUsageToday: FREE_AI_DAILY_LIMIT });
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(false);

      // Pro로 업그레이드
      useSubscriptionStore.getState().setPlan('pro');

      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
    });

    it("setPlan('free') 후 plan = 'free'", () => {
      useSubscriptionStore.setState({ plan: 'pro' });

      useSubscriptionStore.getState().setPlan('free');

      expect(useSubscriptionStore.getState().plan).toBe('free');
    });

    it('setPlan 호출 시 AsyncStorage.setItem 호출됨', () => {
      useSubscriptionStore.getState().setPlan('pro');

      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // canUseWeeklyReview
  // ══════════════════════════════════════════════════════════════════════════

  describe('canUseWeeklyReview — Free 플랜', () => {
    it('이번 달 0회 → true', () => {
      expect(useSubscriptionStore.getState().canUseWeeklyReview()).toBe(true);
    });

    it(`이번 달 ${FREE_WEEKLY_REVIEW_MONTHLY_LIMIT}회 → false (월 한도 도달)`, () => {
      useSubscriptionStore.setState({
        weeklyReviewUsedThisMonth: FREE_WEEKLY_REVIEW_MONTHLY_LIMIT,
      });

      expect(useSubscriptionStore.getState().canUseWeeklyReview()).toBe(false);
    });

    it('지난 달 기록으로 설정 시 → 리셋 후 true', () => {
      useSubscriptionStore.setState({
        weeklyReviewUsedThisMonth: FREE_WEEKLY_REVIEW_MONTHLY_LIMIT,
        lastReviewResetMonth:      lastMonth(),
      });

      expect(useSubscriptionStore.getState().canUseWeeklyReview()).toBe(true);
    });
  });

  describe('canUseWeeklyReview — Pro 플랜', () => {
    it('Pro + 한도 초과 시에도 true', () => {
      useSubscriptionStore.setState({
        plan:                      'pro',
        weeklyReviewUsedThisMonth: 100,
      });

      expect(useSubscriptionStore.getState().canUseWeeklyReview()).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // consumeWeeklyReview
  // ══════════════════════════════════════════════════════════════════════════

  describe('consumeWeeklyReview', () => {
    it('consumeWeeklyReview 호출 시 weeklyReviewUsedThisMonth 1 증가', () => {
      useSubscriptionStore.getState().consumeWeeklyReview();

      expect(useSubscriptionStore.getState().weeklyReviewUsedThisMonth).toBe(1);
    });

    it('consumeWeeklyReview 후 canUseWeeklyReview = false (Free, 월 1회 한도)', () => {
      useSubscriptionStore.getState().consumeWeeklyReview();

      expect(useSubscriptionStore.getState().canUseWeeklyReview()).toBe(false);
    });

    it('지난 달 기록 상태에서 consumeWeeklyReview → 리셋 후 1', () => {
      useSubscriptionStore.setState({
        weeklyReviewUsedThisMonth: FREE_WEEKLY_REVIEW_MONTHLY_LIMIT,
        lastReviewResetMonth:      lastMonth(),
      });

      useSubscriptionStore.getState().consumeWeeklyReview();

      expect(useSubscriptionStore.getState().weeklyReviewUsedThisMonth).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // hydrate
  // ══════════════════════════════════════════════════════════════════════════

  describe('hydrate', () => {
    const SUBSCRIPTION_KEY = 'synclink:subscription';

    it('AsyncStorage에 저장된 plan 복원', async () => {
      await AsyncStorage.setItem(
        SUBSCRIPTION_KEY,
        JSON.stringify({ plan: 'pro', aiUsageToday: 0, lastResetDate: localDateString() }),
      );

      await useSubscriptionStore.getState().hydrate();

      expect(useSubscriptionStore.getState().plan).toBe('pro');
    });

    it('저장된 날짜가 오늘이면 aiUsageToday 유지', async () => {
      await AsyncStorage.setItem(
        SUBSCRIPTION_KEY,
        JSON.stringify({
          plan:          'free',
          aiUsageToday:  3,
          lastResetDate: localDateString(), // 오늘
        }),
      );

      await useSubscriptionStore.getState().hydrate();

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(3);
    });

    it('저장된 날짜가 어제이면 aiUsageToday 리셋 (0)', async () => {
      await AsyncStorage.setItem(
        SUBSCRIPTION_KEY,
        JSON.stringify({
          plan:          'free',
          aiUsageToday:  5,
          lastResetDate: yesterday(), // 어제
        }),
      );

      await useSubscriptionStore.getState().hydrate();

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(0);
    });

    it('AsyncStorage 비어 있으면 기본값 유지', async () => {
      await useSubscriptionStore.getState().hydrate();

      expect(useSubscriptionStore.getState().plan).toBe('free');
      expect(useSubscriptionStore.getState().aiUsageToday).toBe(0);
    });

    it('저장된 JSON이 손상된 경우 기본값 유지 (크래시 없음)', async () => {
      await AsyncStorage.setItem(SUBSCRIPTION_KEY, '{invalid json}');

      // hydrate는 throw 없이 완료되어야 함
      await expect(useSubscriptionStore.getState().hydrate()).resolves.toBeUndefined();
      // 기본값 유지
      expect(useSubscriptionStore.getState().plan).toBe('free');
    });

    it('저장된 달이 지난 달이면 weeklyReviewUsedThisMonth 리셋', async () => {
      await AsyncStorage.setItem(
        SUBSCRIPTION_KEY,
        JSON.stringify({
          plan:                      'free',
          weeklyReviewUsedThisMonth: 1,
          lastReviewResetMonth:      lastMonth(),
        }),
      );

      await useSubscriptionStore.getState().hydrate();

      expect(useSubscriptionStore.getState().weeklyReviewUsedThisMonth).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 복합 시나리오
  // ══════════════════════════════════════════════════════════════════════════

  describe('복합 시나리오', () => {
    it('Free 플랜에서 5회 소진 → Paywall 필요, Pro 업그레이드 → 다시 사용 가능', () => {
      // 1. 5회 소진
      for (let i = 0; i < FREE_AI_DAILY_LIMIT; i++) {
        useSubscriptionStore.getState().consumeAI();
      }
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(false);

      // 2. Pro 업그레이드
      useSubscriptionStore.getState().setPlan('pro');

      // 3. 다시 사용 가능
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
    });

    it('consumeAI 연속 호출 후 자정 리셋 → 리셋 후 canUseAI true', () => {
      // 오늘 5회 소진
      useSubscriptionStore.setState({ aiUsageToday: FREE_AI_DAILY_LIMIT });
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(false);

      // 자정이 지났다고 가정 (lastResetDate를 어제로 변경)
      useSubscriptionStore.setState({ lastResetDate: yesterday() });

      // 다음 날 canUseAI 호출 → 리셋 → true
      expect(useSubscriptionStore.getState().canUseAI().allowed).toBe(true);
      expect(useSubscriptionStore.getState().aiUsageToday).toBe(0);
    });
  });
});
