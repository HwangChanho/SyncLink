/**
 * AI service — orchestrates NL parsing and smart reminder generation.
 *
 * Architecture:
 *  1. Try local parser first (nlParser.ts) — 0 API cost, < 10ms
 *  2. If confidence === 'low', call parse-event Edge Function (Claude Haiku)
 *  3. Check daily limit before any API call
 *
 * The Edge Function acts as a secure proxy — the Claude API key NEVER
 * leaves the server. This file only calls the Edge Function endpoint.
 *
 * Daily limits (FREE tier):
 *  - FREE_AI_DAILY_LIMIT = 5 calls/day (from config.ts)
 *  - Tracked in AsyncStorage under AI_USAGE_STORAGE_KEY
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';
import { parseLocally } from '@/lib/nlParser';
import { FREE_AI_DAILY_LIMIT, EDGE_FUNCTIONS } from '@/constants/config';
import type { NLParseResult, AiUsageRecord, AiParseResponse } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for daily AI usage tracking. */
const AI_USAGE_STORAGE_KEY = 'syncday:ai_usage';

/** YYYY-MM-DD string for today in local time. */
const todayDateString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Storage helpers ──────────────────────────────────────────────────────────

/**
 * Reads the stored AiUsageRecord.
 * Returns a fresh record with callCount=0 when:
 *  - nothing is stored yet, or
 *  - the stored record is from a previous day (auto-reset).
 */
async function readUsageRecord(): Promise<AiUsageRecord> {
  const today = todayDateString();
  try {
    const raw = await AsyncStorage.getItem(AI_USAGE_STORAGE_KEY);
    if (!raw) return { date: today, callCount: 0, tokensUsed: 0 };

    const stored: AiUsageRecord = JSON.parse(raw);
    // Auto-reset when the stored date is different from today
    if (stored.date !== today) {
      return { date: today, callCount: 0, tokensUsed: 0 };
    }
    return stored;
  } catch {
    // Corrupted storage — return clean record
    return { date: today, callCount: 0, tokensUsed: 0 };
  }
}

/**
 * Persists an AiUsageRecord to AsyncStorage.
 */
async function writeUsageRecord(record: AiUsageRecord): Promise<void> {
  await AsyncStorage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(record));
}

/** Internal return type that bundles NLParseResult with token accounting. */
interface EdgeFunctionResult {
  nlResult: NLParseResult;
  tokensUsed: number;
}

// ─── Edge Function caller ─────────────────────────────────────────────────────

/**
 * Calls the parse-event Edge Function and converts the AI response into
 * an NLParseResult that matches the local parser's return shape.
 *
 * Date strings from the AI are converted to Date objects here.
 * On any network/parse failure, returns an NLParseResult with confidence='low'
 * and an error field so the caller can degrade gracefully.
 *
 * @param text - Raw user input text
 * @returns EdgeFunctionResult — NLParseResult + token count for usage tracking
 */
async function callEdgeFunction(text: string): Promise<EdgeFunctionResult> {
  try {
    const { data, error } = await supabase.functions.invoke<AiParseResponse>(
      EDGE_FUNCTIONS.PARSE_EVENT,
      {
        body: {
          text,
          contextDatetime: new Date().toISOString(),
          locale: 'ko-KR',
        },
      },
    );

    if (error || !data) {
      throw new Error(error?.message ?? 'Empty response from Edge Function');
    }

    const { result, tokensUsed: tokens } = data;

    // Convert ISO-8601 date strings (from Deno/JSON serialization) to Date objects.
    // The AI returns dates as strings; ParsedField<Date> expects actual Date instances.
    const parsed = { ...result.parsed };
    if (parsed.startAt) {
      const rawStart = parsed.startAt.value as unknown as string;
      parsed.startAt = { value: new Date(rawStart), confidence: parsed.startAt.confidence };
    }
    if (parsed.endAt) {
      const rawEnd = parsed.endAt.value as unknown as string;
      parsed.endAt = { value: new Date(rawEnd), confidence: parsed.endAt.confidence };
    }

    return {
      nlResult: {
        parsed,
        confidence: result.confidence,
        source: 'ai',
        rawInput: text,
        processingMs: null,
      },
      tokensUsed: tokens,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI parsing failed';
    return {
      nlResult: {
        parsed: {},
        confidence: 'low',
        source: 'ai',
        rawInput: text,
        processingMs: null,
        error: message,
      },
      tokensUsed: 0,
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse natural language text into event fields.
 *
 * Pipeline:
 *  1. Run local parser synchronously (always, no API cost)
 *  2. Return immediately if confidence !== 'low'
 *  3. Check daily AI limit — return error result if exceeded
 *  4. Call parse-event Edge Function (Claude Haiku)
 *  5. Record usage in AsyncStorage
 *  6. Return AI result
 *
 * @param text - Raw user input (e.g. "내일 오후 3시 카페 미팅")
 * @returns NLParseResult (always returns something; may have empty parsed fields)
 */
export async function parseNaturalLanguage(text: string): Promise<NLParseResult> {
  // Step 1 & 2: local parse first
  const localResult = parseLocally(text);
  if (localResult.confidence !== 'low') {
    return localResult;
  }

  // Step 3: check daily limit before making an API call
  const usage = await readUsageRecord();
  if (usage.callCount >= FREE_AI_DAILY_LIMIT) {
    return {
      parsed: {},
      confidence: 'low',
      source: 'local',
      rawInput: text,
      processingMs: null,
      error: `오늘 AI 파싱 한도(${FREE_AI_DAILY_LIMIT}회)에 도달했어요. 직접 입력해주세요.`,
    };
  }

  // Step 4: call Edge Function
  const { nlResult, tokensUsed } = await callEdgeFunction(text);

  // Step 5: record usage — count even on failure to prevent retry abuse
  await writeUsageRecord({
    date: usage.date,
    callCount: usage.callCount + 1,
    tokensUsed: usage.tokensUsed + tokensUsed,
  });

  return nlResult;
}

/**
 * Get today's AI API usage for the current user.
 *
 * @returns AiUsageRecord for today (callCount 0 if no calls yet)
 */
export async function getDailyUsage(): Promise<AiUsageRecord> {
  return readUsageRecord();
}

/** @deprecated Use getDailyUsage() instead */
export async function getTodayUsage(): Promise<AiUsageRecord> {
  return getDailyUsage();
}

/**
 * Check if the user has remaining AI calls today.
 *
 * @returns true if the user can make more AI calls today
 */
export async function hasRemainingDailyLimit(): Promise<boolean> {
  const usage = await readUsageRecord();
  return usage.callCount < FREE_AI_DAILY_LIMIT;
}

/**
 * Reset daily AI usage counter (for testing / date rollover).
 * In production, the counter resets automatically at midnight via readUsageRecord().
 */
export async function resetDailyUsage(): Promise<void> {
  const today = todayDateString();
  await writeUsageRecord({ date: today, callCount: 0, tokensUsed: 0 });
}

// ─── Weekly review cache key ──────────────────────────────────────────────────

/**
 * Builds the AsyncStorage key for a weekly review cache entry.
 * Keyed by week-start ISO date string (YYYY-MM-DD) so each week gets its own entry.
 *
 * @param weekStart - Monday of the review week
 */
function weeklyReviewCacheKey(weekStart: Date): string {
  const y = weekStart.getFullYear();
  const m = String(weekStart.getMonth() + 1).padStart(2, '0');
  const d = String(weekStart.getDate()).padStart(2, '0');
  return `syncday:weekly_review:${y}-${m}-${d}`;
}

/** Shape stored in AsyncStorage for a cached weekly review. */
interface CachedWeeklyReview {
  review: string;
  generatedAt: string; // ISO-8601
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the AI-generated weekly review for the week starting on weekStart.
 *
 * Strategy:
 *  1. Check AsyncStorage cache — if the current week's review exists, return it
 *     immediately without calling the Edge Function (saves API cost).
 *  2. Call the weekly-review Edge Function (Claude Haiku, max 200 tokens).
 *  3. Persist result to AsyncStorage for same-week re-visits.
 *
 * The cache key includes the week-start date so each week gets a fresh review.
 * Reviews from previous weeks remain in cache (harmless, small size).
 *
 * @param weekStart - Monday of the week to review (local midnight)
 * @returns Object with review text and generation timestamp
 * @throws If Edge Function returns an error
 */
export async function getWeeklyReview(weekStart: Date): Promise<{
  review: string;
  generatedAt: Date;
}> {
  const cacheKey = weeklyReviewCacheKey(weekStart);

  // Step 1: check cache
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached: CachedWeeklyReview = JSON.parse(raw);
      return { review: cached.review, generatedAt: new Date(cached.generatedAt) };
    }
  } catch {
    // Cache miss or parse error — fall through to Edge Function call
  }

  // Step 2: call Edge Function
  const { data, error } = await supabase.functions.invoke<{
    review: string;
    generatedAt: string;
  }>(EDGE_FUNCTIONS.WEEKLY_REVIEW, {
    body: { weekStart: weekStart.toISOString() },
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'Weekly review 생성에 실패했습니다.');
  }

  const result = { review: data.review, generatedAt: new Date(data.generatedAt) };

  // Step 3: persist to cache (fire-and-forget)
  AsyncStorage.setItem(cacheKey, JSON.stringify({
    review: result.review,
    generatedAt: result.generatedAt.toISOString(),
  } satisfies CachedWeeklyReview)).catch(() => {
    // Cache write failure is non-critical
  });

  return result;
}

/**
 * Generate a weekly review summary for the current user.
 * Only available for Pro users. Returns null for free users.
 *
 * Calls the weekly-review Edge Function (Claude Haiku batch).
 *
 * @param weekStartDate - Monday of the target week
 * @returns Markdown-formatted weekly review string, or null
 * @deprecated Use getWeeklyReview() instead (TASK-504)
 */
export async function generateWeeklyReview(_weekStartDate: Date): Promise<string | null> {
  // Pro-tier feature — not yet implemented
  return null;
}

/**
 * Request AI activity recommendations for a free time slot.
 * Only called when user explicitly taps on a free slot (Tier 3: Claude Sonnet).
 *
 * @param spaceId - UUID of the space (for context about the couple/group)
 * @param slotStart - Start of the free time window
 * @param slotEnd - End of the free time window
 * @returns Array of activity recommendation strings
 */
export async function getActivityRecommendations(
  _spaceId: string,
  _slotStart: Date,
  _slotEnd: Date,
): Promise<string[]> {
  // Pro-tier feature — not yet implemented
  return [];
}
