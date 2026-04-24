/**
 * __tests__/services/usageMetrics.test.ts
 *
 * TASK-1203: Usage Metrics cost-calculation logic tests (QA)
 *
 * Context:
 *  usage_metrics is populated exclusively by Edge Functions (parse-event,
 *  smart-reminder, weekly-review) using the Supabase service role.
 *  There is NO client-side service file for this table — the client only
 *  SELECTs its own rows via Supabase (RLS: auth.uid() = user_id).
 *
 * What we test here:
 *  1. Cost calculation helpers (pure math — extracted from parse-event logic):
 *     - Haiku pricing: $0.80 / 1M input, $4.00 / 1M output
 *     - Edge cases: zero tokens, large token counts, rounding precision
 *  2. Client-side read pattern — querying usage_metrics via mocked Supabase:
 *     - Returns own rows filtered by user_id
 *     - Handles empty result set
 *     - Propagates Supabase errors
 *
 * Strategy:
 *  - @/lib/supabase fully mocked → no real DB calls
 *  - Cost helpers are pure functions defined inline (mirrors Edge Function logic)
 *    so the test stays self-contained and doesn't depend on server-side Deno code
 *
 * @task TASK-1203
 * @depends supabase/migrations/008_usage_metrics.sql
 * @depends supabase/functions/parse-event/index.ts (cost constants)
 */

// ─── Mock ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase:           { from: jest.fn() },
  getCurrentUserId:   jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';

// ─── Cost calculation helpers (mirrors Edge Function constants) ───────────────

/**
 * Claude Haiku pricing constants (as used in parse-event Edge Function).
 * Input: $0.80 per 1M tokens
 * Output: $4.00 per 1M tokens
 */
const HAIKU_INPUT_COST_PER_TOKEN  = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;

/**
 * Calculate the USD cost for a single AI call.
 *
 * @param inputTokens  - Number of input tokens consumed
 * @param outputTokens - Number of output tokens consumed
 * @param inputRate    - Cost per input token in USD (default: Haiku pricing)
 * @param outputRate   - Cost per output token in USD (default: Haiku pricing)
 * @returns Total cost in USD
 */
function calculateCostUsd(
  inputTokens:  number,
  outputTokens: number,
  inputRate:    number = HAIKU_INPUT_COST_PER_TOKEN,
  outputRate:   number = HAIKU_OUTPUT_COST_PER_TOKEN,
): number {
  return inputTokens * inputRate + outputTokens * outputRate;
}

// ─── Supabase query chain helper (same pattern as categoryService.test.ts) ────

/**
 * Create a mock Supabase query builder chain.
 *
 * - All builder methods return `this` (chainable)
 * - Chain is thenable: `await chain` resolves to `resolvedValue`
 * - `.single()` also resolves to `resolvedValue`
 */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    gte:    jest.fn().mockReturnThis(),
    lt:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolvedValue),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-abc-123';

/** Sample usage_metrics rows as returned from Supabase */
const mockRows = [
  {
    id:            'metric-1',
    user_id:       MOCK_USER_ID,
    function_name: 'parse-event',
    model:         'claude-haiku-4-5',
    input_tokens:  100,
    output_tokens: 50,
    cost_usd:      0.000280,
    called_at:     '2026-04-23T10:00:00.000Z',
  },
  {
    id:            'metric-2',
    user_id:       MOCK_USER_ID,
    function_name: 'weekly-review',
    model:         'claude-sonnet-4-6',
    input_tokens:  500,
    output_tokens: 200,
    cost_usd:      0.004400,
    called_at:     '2026-04-23T09:00:00.000Z',
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('usageMetrics — cost calculation', () => {
  // ══════════════════════════════════════════════════════════════════════════
  // Pure cost calculation logic
  // ══════════════════════════════════════════════════════════════════════════

  describe('calculateCostUsd() — Haiku pricing', () => {
    it('calculates cost correctly for typical parse-event call (100 input, 50 output)', () => {
      // 100 * 0.80/1M + 50 * 4.00/1M = 0.000080 + 0.000200 = 0.000280
      const cost = calculateCostUsd(100, 50);
      expect(cost).toBeCloseTo(0.000280, 6);
    });

    it('returns 0 when both token counts are zero', () => {
      const cost = calculateCostUsd(0, 0);
      expect(cost).toBe(0);
    });

    it('handles large token counts without precision loss', () => {
      // 1M input + 1M output: $0.80 + $4.00 = $4.80
      const cost = calculateCostUsd(1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(4.80, 4);
    });

    it('correctly weights output tokens more expensive than input tokens', () => {
      // Output is 5× more expensive than input (4.00 vs 0.80)
      const inputOnlyCost  = calculateCostUsd(1000, 0);
      const outputOnlyCost = calculateCostUsd(0, 1000);
      expect(outputOnlyCost).toBeCloseTo(inputOnlyCost * 5, 8);
    });

    it('accepts custom rate overrides (for Sonnet pricing)', () => {
      // Claude Sonnet 4.6: $3.00 input / $15.00 output per 1M tokens
      const SONNET_INPUT  = 3.00  / 1_000_000;
      const SONNET_OUTPUT = 15.00 / 1_000_000;
      const cost = calculateCostUsd(500, 200, SONNET_INPUT, SONNET_OUTPUT);
      // 500 * 3/1M + 200 * 15/1M = 0.0015 + 0.003 = 0.0045
      expect(cost).toBeCloseTo(0.0045, 6);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Supabase client read pattern
  // ══════════════════════════════════════════════════════════════════════════

  describe('usage_metrics Supabase read pattern', () => {
    const mockFrom = supabase.from as jest.Mock;

    beforeEach(() => {
      jest.clearAllMocks();
      (getCurrentUserId as jest.Mock).mockResolvedValue(MOCK_USER_ID);
    });

    /**
     * Simulate a client-side query:
     * supabase.from('usage_metrics').select('*').eq('user_id', userId).order('called_at', { ascending: false })
     *
     * This mirrors what a DevDashboard component or service would do.
     */
    async function fetchUserMetrics(userId: string) {
      const { data, error } = await supabase
        .from('usage_metrics')
        .select('*')
        .eq('user_id', userId)
        .order('called_at', { ascending: false });
      if (error) throw error;
      return data;
    }

    it('returns own usage rows for an authenticated user', async () => {
      // Arrange
      mockFrom.mockReturnValueOnce(makeChain({ data: mockRows, error: null }));

      // Act
      const result = await fetchUserMetrics(MOCK_USER_ID);

      // Assert
      expect(mockFrom).toHaveBeenCalledWith('usage_metrics');
      expect(result).toHaveLength(2);
      expect(result).toEqual(mockRows);
    });

    it('returns empty array when user has no metrics yet', async () => {
      // Arrange
      mockFrom.mockReturnValueOnce(makeChain({ data: [], error: null }));

      // Act
      const result = await fetchUserMetrics(MOCK_USER_ID);

      // Assert
      expect(result).toHaveLength(0);
    });

    it('throws when Supabase returns an error', async () => {
      // Arrange
      const dbError = { message: 'permission denied', code: '42501' };
      mockFrom.mockReturnValueOnce(makeChain({ data: null, error: dbError }));

      // Act & Assert
      await expect(fetchUserMetrics(MOCK_USER_ID)).rejects.toEqual(dbError);
    });
  });
});
