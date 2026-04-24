/**
 * subscriptionStore — ad credit branch tests.
 *
 * Covers the new Sprint 14 TASK-1403 behaviors:
 *   - canUseAI() returns 'quota' when free limit is exhausted but credits > 0
 *   - canUseAI() returns 'no-credit' when quota is exhausted and no credits
 *   - consumeAI() decrements aiUsageToday first, then ad credits
 *   - refreshCredits() loads from the service layer
 *   - consumeAdCredit() optimistic decrement + rollback on failure
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The `mock` prefix is required for jest's out-of-scope variable check.
const mockFetchAdCreditBalance = jest.fn<Promise<number>, []>();
const mockConsumeAdCreditRemote = jest.fn<Promise<number | null>, []>();
jest.mock('@/services/creditService', () => ({
  fetchAdCreditBalance: () => mockFetchAdCreditBalance(),
  consumeAdCreditRemote: () => mockConsumeAdCreditRemote(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  FREE_AI_DAILY_LIMIT,
  useSubscriptionStore,
} from '@/stores/subscriptionStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's YYYY-MM-DD. Mirrors the store's internal helper. */
function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('subscriptionStore — ad credits', () => {
  beforeEach(() => {
    // Reset Zustand store state to a deterministic baseline.
    useSubscriptionStore.setState({
      plan: 'free',
      aiUsageToday: 0,
      lastResetDate: todayString(),
      weeklyReviewUsedThisMonth: 0,
      adCredits: 0,
    });
    mockFetchAdCreditBalance.mockReset();
    mockConsumeAdCreditRemote.mockReset();
  });

  describe('canUseAI() — three-way reason', () => {
    it('returns ok when quota is fresh', () => {
      const result = useSubscriptionStore.getState().canUseAI();
      expect(result).toEqual({ allowed: true, reason: 'ok' });
    });

    it("returns 'quota' when quota exhausted but credits > 0", () => {
      useSubscriptionStore.setState({
        aiUsageToday: FREE_AI_DAILY_LIMIT,
        adCredits: 2,
      });
      expect(useSubscriptionStore.getState().canUseAI()).toEqual({
        allowed: true,
        reason: 'quota',
      });
    });

    it("returns 'no-credit' when quota exhausted and no credits", () => {
      useSubscriptionStore.setState({
        aiUsageToday: FREE_AI_DAILY_LIMIT,
        adCredits: 0,
      });
      expect(useSubscriptionStore.getState().canUseAI()).toEqual({
        allowed: false,
        reason: 'no-credit',
      });
    });
  });

  describe('consumeAI() — quota then credits', () => {
    it('increments aiUsageToday while under the free limit', async () => {
      await useSubscriptionStore.getState().consumeAI();
      expect(useSubscriptionStore.getState().aiUsageToday).toBe(1);
      expect(mockConsumeAdCreditRemote).not.toHaveBeenCalled();
    });

    it('decrements adCredits once quota is exhausted', async () => {
      useSubscriptionStore.setState({
        aiUsageToday: FREE_AI_DAILY_LIMIT,
        adCredits: 2,
      });
      mockConsumeAdCreditRemote.mockResolvedValue(1);

      await useSubscriptionStore.getState().consumeAI();

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(FREE_AI_DAILY_LIMIT);
      expect(useSubscriptionStore.getState().adCredits).toBe(1);
      expect(mockConsumeAdCreditRemote).toHaveBeenCalledTimes(1);
    });

    it('no-ops when quota and credits are both depleted', async () => {
      useSubscriptionStore.setState({
        aiUsageToday: FREE_AI_DAILY_LIMIT,
        adCredits: 0,
      });

      await useSubscriptionStore.getState().consumeAI();

      expect(useSubscriptionStore.getState().aiUsageToday).toBe(FREE_AI_DAILY_LIMIT);
      expect(useSubscriptionStore.getState().adCredits).toBe(0);
      expect(mockConsumeAdCreditRemote).not.toHaveBeenCalled();
    });
  });

  describe('refreshCredits()', () => {
    it('updates adCredits from the service', async () => {
      mockFetchAdCreditBalance.mockResolvedValue(5);
      await useSubscriptionStore.getState().refreshCredits();
      expect(useSubscriptionStore.getState().adCredits).toBe(5);
    });

    it('silently keeps existing balance on error', async () => {
      useSubscriptionStore.setState({ adCredits: 3 });
      mockFetchAdCreditBalance.mockRejectedValue(new Error('network'));
      await useSubscriptionStore.getState().refreshCredits();
      expect(useSubscriptionStore.getState().adCredits).toBe(3);
    });
  });

  describe('consumeAdCredit()', () => {
    it('returns false when balance is zero', async () => {
      useSubscriptionStore.setState({ adCredits: 0 });
      const ok = await useSubscriptionStore.getState().consumeAdCredit();
      expect(ok).toBe(false);
      expect(mockConsumeAdCreditRemote).not.toHaveBeenCalled();
    });

    it('optimistic decrement then settles to server value', async () => {
      useSubscriptionStore.setState({ adCredits: 3 });
      mockConsumeAdCreditRemote.mockResolvedValue(2);
      const ok = await useSubscriptionStore.getState().consumeAdCredit();
      expect(ok).toBe(true);
      expect(useSubscriptionStore.getState().adCredits).toBe(2);
    });

    it('rolls back balance on remote failure', async () => {
      useSubscriptionStore.setState({ adCredits: 3 });
      mockConsumeAdCreditRemote.mockResolvedValue(null);
      const ok = await useSubscriptionStore.getState().consumeAdCredit();
      expect(ok).toBe(false);
      expect(useSubscriptionStore.getState().adCredits).toBe(3);
    });
  });
});
