/**
 * usageMetricsService.ts
 *
 * Service layer for reading AI usage metrics from the usage_metrics table.
 * Follows the adapter pattern — all Supabase calls are centralized here;
 * components never call Supabase directly.
 *
 * Usage data is written exclusively by Edge Functions (parse-event,
 * smart-reminder, weekly-review) using the service role. This service
 * only handles client-side SELECTs (RLS: auth.uid() = user_id).
 *
 * @see supabase/migrations/008_usage_metrics.sql — table schema
 * @see supabase/functions/parse-event/index.ts   — INSERT side
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';

// ─── Pricing constants ────────────────────────────────────────────────────────

/**
 * Claude model pricing in USD per token.
 * Source: https://www.anthropic.com/api
 *
 * haiku-3  : $0.25/M input, $1.25/M output
 * sonnet-3.5: $3.00/M input, $15.00/M output
 *
 * Note: The Edge Function stores cost_usd at INSERT time using its own
 * constants (based on the actual model called). These client-side rates
 * are used as a fallback estimator when re-computing from raw token counts.
 */
export const MODEL_PRICING: Record<string, { inputPerToken: number; outputPerToken: number }> = {
  // Claude Haiku 3 (cheapest — used by parse-event for most calls)
  'claude-haiku-3':     { inputPerToken: 0.25 / 1_000_000,  outputPerToken: 1.25  / 1_000_000 },
  // Haiku 3.5 (matches Edge Function model IDs that include a minor version suffix)
  'claude-haiku-3-5':   { inputPerToken: 0.25 / 1_000_000,  outputPerToken: 1.25  / 1_000_000 },
  // Claude Haiku 4.5 (current alias used in parse-event Edge Function)
  'claude-haiku-4-5':   { inputPerToken: 0.25 / 1_000_000,  outputPerToken: 1.25  / 1_000_000 },
  // Claude Sonnet 3.5 / 4.6 — heavier model for weekly-review, smart-reminder
  'claude-sonnet-3-5':  { inputPerToken: 3.00 / 1_000_000,  outputPerToken: 15.00 / 1_000_000 },
  'claude-sonnet-4-6':  { inputPerToken: 3.00 / 1_000_000,  outputPerToken: 15.00 / 1_000_000 },
} as const;

/**
 * Fallback pricing rates when the model string doesn't match any known key.
 * Defined as a literal object (not a Record lookup) so TypeScript treats it
 * as a guaranteed non-undefined value under noUncheckedIndexedAccess.
 * Defaults to Haiku pricing (the most common model in this project).
 */
const FALLBACK_PRICING: { inputPerToken: number; outputPerToken: number } = {
  inputPerToken:  0.25 / 1_000_000,
  outputPerToken: 1.25 / 1_000_000,
};

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Aggregated AI usage statistics for a single time window.
 */
export interface UsagePeriodStats {
  /** Number of AI API calls in this period. */
  calls: number;
  /** Estimated total cost in USD for this period. */
  estimatedCostUsd: number;
}

/**
 * Full dashboard payload returned by getUsageDashboard().
 * Each field represents a rolling time window relative to the call time.
 */
export interface UsageDashboard {
  today: UsagePeriodStats;
  week:  UsagePeriodStats;
  month: UsagePeriodStats;
}

// ─── Raw row shape returned by Supabase ───────────────────────────────────────

/**
 * Minimal subset of the usage_metrics row we read from Supabase.
 * The full schema is in 008_usage_metrics.sql; we only pull what we need
 * to avoid unnecessary data transfer.
 */
interface UsageMetricsRow {
  model:         string;
  input_tokens:  number;
  output_tokens: number;
  cost_usd:      number;
  called_at:     string;  // ISO 8601 timestamp
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Estimate the USD cost of a single API call.
 *
 * Prefers the stored cost_usd value (set by Edge Function at call time with
 * exact token counts). Falls back to re-computing from tokens when cost_usd
 * is 0 or missing (defensive coding against schema changes or mock data).
 *
 * @param row - Raw usage_metrics row
 * @returns Estimated cost in USD
 */
function estimateCost(row: UsageMetricsRow): number {
  // Use the pre-computed cost stored by the Edge Function when available.
  if (row.cost_usd > 0) return row.cost_usd;

  // Re-compute from token counts using client-side pricing constants.
  // modelKey lookup may be undefined under noUncheckedIndexedAccess; the
  // nullish coalescing to FALLBACK_PRICING ensures we always have a valid rate.
  const modelKey = row.model as keyof typeof MODEL_PRICING;
  const inputRate  = MODEL_PRICING[modelKey]?.inputPerToken  ?? FALLBACK_PRICING.inputPerToken;
  const outputRate = MODEL_PRICING[modelKey]?.outputPerToken ?? FALLBACK_PRICING.outputPerToken;
  return row.input_tokens * inputRate + row.output_tokens * outputRate;
}

/**
 * Aggregate an array of usage_metrics rows into UsagePeriodStats.
 *
 * @param rows - Rows already filtered to the desired time window
 * @returns { calls, estimatedCostUsd }
 */
function aggregateRows(rows: UsageMetricsRow[]): UsagePeriodStats {
  return rows.reduce<UsagePeriodStats>(
    (acc, row) => ({
      calls:            acc.calls + 1,
      estimatedCostUsd: acc.estimatedCostUsd + estimateCost(row),
    }),
    { calls: 0, estimatedCostUsd: 0 },
  );
}

/**
 * Returns a UTC timestamp string representing the start of a window
 * relative to now.
 *
 * @param offsetMs - Milliseconds to subtract from the current time
 * @returns ISO 8601 string suitable for a Supabase `gte` filter
 */
function windowStart(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

// Millisecond offsets for each time window
const ONE_DAY_MS   = 24 * 60 * 60 * 1_000;
const ONE_WEEK_MS  = 7  * ONE_DAY_MS;
const ONE_MONTH_MS = 30 * ONE_DAY_MS;   // approximation — good enough for a dashboard

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch AI usage statistics for the authenticated user across three windows:
 * today (last 24h), this week (last 7 days), this month (last 30 days).
 *
 * Implementation notes:
 *  - A single Supabase query fetches the last 30 days of rows; we then
 *    slice in-memory for the shorter windows. This avoids three round-trips.
 *  - RLS (auth.uid() = user_id) ensures users can only read their own data.
 *    We don't add a redundant client-side eq('user_id') filter — RLS handles it.
 *
 * @throws Error if the user is not authenticated
 * @throws Error if the Supabase query fails (network, RLS, etc.)
 *
 * @returns UsageDashboard — today, week, month stats
 */
export async function getUsageDashboard(): Promise<UsageDashboard> {
  // Verify the user is authenticated before hitting the database.
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('User is not authenticated.');
  }

  // Compute the oldest timestamp we need — month window is the largest.
  const monthAgo = windowStart(ONE_MONTH_MS);

  // Single query: fetch all rows within the month window, ordered newest first.
  // RLS ensures only this user's rows are returned (no eq('user_id') needed).
  const { data, error } = await supabase
    .from('usage_metrics')
    .select('model, input_tokens, output_tokens, cost_usd, called_at')
    .gte('called_at', monthAgo)
    .order('called_at', { ascending: false });

  if (error) throw error;

  // Supabase returns null when the query matches zero rows on some versions.
  const rows = (data ?? []) as UsageMetricsRow[];

  // Slice into each time window in-memory.
  const dayStart   = windowStart(ONE_DAY_MS);
  const weekStart  = windowStart(ONE_WEEK_MS);

  const todayRows  = rows.filter(r => r.called_at >= dayStart);
  const weekRows   = rows.filter(r => r.called_at >= weekStart);
  const monthRows  = rows;   // already filtered to month window

  return {
    today: aggregateRows(todayRows),
    week:  aggregateRows(weekRows),
    month: aggregateRows(monthRows),
  };
}
