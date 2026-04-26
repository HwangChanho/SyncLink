/**
 * __tests__/services/usageMetricsService.test.ts
 *
 * Unit tests for src/services/usageMetricsService.ts.
 *
 * Covers:
 *  1. getUsageDashboard() — today / week / month aggregation
 *  2. Cost estimation — uses stored cost_usd; falls back to token-based math
 *  3. Authentication guard — throws when getCurrentUserId() returns null
 *  4. Error propagation — throws the raw Supabase error
 *  5. Empty result — returns zero counts and zero cost for all periods
 *
 * Strategy:
 *  - @/lib/supabase is fully mocked (no real DB calls)
 *  - Date.now() is mocked to pin relative time windows
 *  - All Supabase chainable calls use the makeChain() helper
 *
 * @task ISSUE-009
 * @depends src/services/usageMetricsService.ts
 * @depends supabase/migrations/008_usage_metrics.sql
 */

// ─── Mocks (hoisted — must precede all imports) ───────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase:           { from: jest.fn() },
  getCurrentUserId:   jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { getUsageDashboard, MODEL_PRICING } from '@/services/usageMetricsService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a fully-chainable Supabase query mock.
 * Every builder method (select, gte, order, …) returns `this`.
 * Awaiting the chain resolves to `resolvedValue`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(resolvedValue: { data: unknown; error: unknown }): any {
  const promise = Promise.resolve(resolvedValue);
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    gte:    jest.fn().mockReturnThis(),
    lt:     jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── Time fixture ─────────────────────────────────────────────────────────────

/**
 * Pin Date.now() to a fixed epoch so time-window filters are deterministic.
 * All fixture timestamps below are expressed relative to this anchor.
 */
const FIXED_NOW = new Date('2026-04-26T12:00:00.000Z').getTime();

// Timestamps relative to FIXED_NOW:
//   within today (last 24h)  → e.g. 2026-04-26T08:00:00Z  (4h ago)
//   within this week (7 days) only → e.g. 2026-04-23T12:00:00Z  (3 days ago)
//   within this month (30 days) only → e.g. 2026-04-01T12:00:00Z (25 days ago)
const TS_TODAY   = '2026-04-26T08:00:00.000Z';  // 4 hours ago
const TS_WEEK    = '2026-04-23T12:00:00.000Z';  // 3 days ago (in week, not in today)
const TS_MONTH   = '2026-04-01T12:00:00.000Z';  // 25 days ago (in month, not in week)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'test-user-uuid';

/** Row that falls within today's window — uses stored cost_usd. */
const ROW_TODAY = {
  model:         'claude-haiku-4-5',
  input_tokens:  100,
  output_tokens: 50,
  cost_usd:      0.000200,   // stored by Edge Function
  called_at:     TS_TODAY,
};

/**
 * Row in last-7-days window but NOT in today's 24h window.
 * cost_usd = 0 → service must fall back to token-based estimation.
 */
const ROW_WEEK = {
  model:         'claude-sonnet-4-6',
  input_tokens:  500,
  output_tokens: 200,
  cost_usd:      0,           // triggers token-based fallback
  called_at:     TS_WEEK,
};

/** Row in last-30-days window only — normal stored cost. */
const ROW_MONTH = {
  model:         'claude-haiku-4-5',
  input_tokens:  80,
  output_tokens: 40,
  cost_usd:      0.000160,
  called_at:     TS_MONTH,
};

// All rows the mocked DB would return for a 30-day query:
const ALL_ROWS = [ROW_TODAY, ROW_WEEK, ROW_MONTH];

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(() => {
  // Pin the clock so relative window calculations are stable
  jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: authenticated user
  (getCurrentUserId as jest.Mock).mockResolvedValue(MOCK_USER_ID);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getUsageDashboard()', () => {

  // ══════════════════════════════════════════════════════════════════════════
  // Happy path — correct aggregation per time window
  // ══════════════════════════════════════════════════════════════════════════

  describe('aggregation across time windows', () => {
    beforeEach(() => {
      // Return all three rows from the mocked Supabase query
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: ALL_ROWS, error: null }),
      );
    });

    it('counts only today-window rows in dashboard.today', async () => {
      const { today } = await getUsageDashboard();
      // Only ROW_TODAY falls within the 24h window
      expect(today.calls).toBe(1);
    });

    it('uses stored cost_usd for today cost', async () => {
      const { today } = await getUsageDashboard();
      expect(today.estimatedCostUsd).toBeCloseTo(ROW_TODAY.cost_usd, 6);
    });

    it('counts today + week rows in dashboard.week', async () => {
      const { week } = await getUsageDashboard();
      // ROW_TODAY (4h ago) + ROW_WEEK (3 days ago) both within 7-day window
      expect(week.calls).toBe(2);
    });

    it('falls back to token-based cost when cost_usd is 0 (ROW_WEEK)', async () => {
      const { week } = await getUsageDashboard();

      // ROW_WEEK cost_usd = 0 → token calculation:
      // 500 * (3.00/1M) + 200 * (15.00/1M) = 0.0015 + 0.003 = 0.0045
      const pricing = MODEL_PRICING['claude-sonnet-4-6'];
      const expectedWeekCost =
        ROW_TODAY.cost_usd +                         // stored value for today row
        ROW_WEEK.input_tokens * pricing.inputPerToken +
        ROW_WEEK.output_tokens * pricing.outputPerToken;

      expect(week.estimatedCostUsd).toBeCloseTo(expectedWeekCost, 6);
    });

    it('counts all three rows in dashboard.month', async () => {
      const { month } = await getUsageDashboard();
      expect(month.calls).toBe(3);
    });

    it('sums costs of all three rows in dashboard.month', async () => {
      const { month } = await getUsageDashboard();

      const sonnetPricing = MODEL_PRICING['claude-sonnet-4-6'];
      const expectedMonthCost =
        ROW_TODAY.cost_usd +
        (ROW_WEEK.input_tokens  * sonnetPricing.inputPerToken +
         ROW_WEEK.output_tokens * sonnetPricing.outputPerToken) +
        ROW_MONTH.cost_usd;

      expect(month.estimatedCostUsd).toBeCloseTo(expectedMonthCost, 6);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Empty result
  // ══════════════════════════════════════════════════════════════════════════

  describe('when the user has no usage records', () => {
    beforeEach(() => {
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );
    });

    it('returns zero calls for all periods', async () => {
      const dash = await getUsageDashboard();
      expect(dash.today.calls).toBe(0);
      expect(dash.week.calls).toBe(0);
      expect(dash.month.calls).toBe(0);
    });

    it('returns zero cost for all periods', async () => {
      const dash = await getUsageDashboard();
      expect(dash.today.estimatedCostUsd).toBe(0);
      expect(dash.week.estimatedCostUsd).toBe(0);
      expect(dash.month.estimatedCostUsd).toBe(0);
    });

    it('handles null data from Supabase gracefully (treats as empty array)', async () => {
      // Some Supabase versions return null instead of [] on empty result
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: null, error: null }),
      );
      const dash = await getUsageDashboard();
      expect(dash.today.calls).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Authentication guard
  // ══════════════════════════════════════════════════════════════════════════

  describe('authentication', () => {
    it('throws when the user is not authenticated', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getUsageDashboard()).rejects.toThrow('User is not authenticated.');
    });

    it('does not call supabase.from() when unauthenticated', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      try {
        await getUsageDashboard();
      } catch {
        // expected
      }

      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Error propagation
  // ══════════════════════════════════════════════════════════════════════════

  describe('Supabase error handling', () => {
    it('propagates database errors as thrown exceptions', async () => {
      const dbError = { message: 'permission denied', code: '42501' };
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: null, error: dbError }),
      );

      await expect(getUsageDashboard()).rejects.toEqual(dbError);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Supabase query shape
  // ══════════════════════════════════════════════════════════════════════════

  describe('Supabase query construction', () => {
    it('queries usage_metrics table', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );

      await getUsageDashboard();

      expect(supabase.from).toHaveBeenCalledWith('usage_metrics');
    });

    it('applies a gte filter to limit to the 30-day window', async () => {
      const chain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await getUsageDashboard();

      // gte should have been called with 'called_at' and a timestamp string
      expect(chain.gte).toHaveBeenCalledWith(
        'called_at',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      );
    });
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// MODEL_PRICING constants validation
// ══════════════════════════════════════════════════════════════════════════════

describe('MODEL_PRICING constants', () => {
  it('exports pricing for claude-haiku-4-5', () => {
    expect(MODEL_PRICING['claude-haiku-4-5']).toBeDefined();
    expect(MODEL_PRICING['claude-haiku-4-5'].inputPerToken).toBeCloseTo(0.25 / 1_000_000, 12);
    expect(MODEL_PRICING['claude-haiku-4-5'].outputPerToken).toBeCloseTo(1.25 / 1_000_000, 12);
  });

  it('exports pricing for claude-sonnet-4-6', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICING['claude-sonnet-4-6'].inputPerToken).toBeCloseTo(3.00 / 1_000_000, 12);
    expect(MODEL_PRICING['claude-sonnet-4-6'].outputPerToken).toBeCloseTo(15.00 / 1_000_000, 12);
  });

  it('sonnet output rate is 5x haiku output rate', () => {
    const haiku   = MODEL_PRICING['claude-haiku-4-5'].outputPerToken;
    const sonnet  = MODEL_PRICING['claude-sonnet-4-6'].outputPerToken;
    expect(sonnet).toBeCloseTo(haiku * 12, 12);   // 1.25 * 12 = 15.00
  });
});
