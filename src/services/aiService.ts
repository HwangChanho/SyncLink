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
import { parseLocally, parseMultiple } from '@/lib/nlParser';
import { FREE_AI_DAILY_LIMIT, EDGE_FUNCTIONS } from '@/constants/config';
import { getRuleBaseline } from '@/lib/activitySuggestions';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import type { NLParseResult, AiUsageRecord, AiParseResponse } from '@/types';
import type { FreeSlot } from '@/types/freeTime';
import type { SupportedLocale } from '@/lib/activitySuggestions';

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for daily AI usage tracking. */
const AI_USAGE_STORAGE_KEY = 'synclink:ai_usage';

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
  /**
   * v1.4.11 — 사진 여러 장에서 일정이 2건 이상 나온 경우 전부.
   * 1건이면 undefined (그때는 `nlResult` 하나만 쓰면 된다).
   */
  nlResults?: NLParseResult[];
  tokensUsed: number;
}

/** 비서에게 보낼 사진 한 장. */
export interface AiImageAttachment {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

/**
 * 한 요청에 붙일 수 있는 사진 수 (v1.4.11 — LEAD 요청으로 1 → 10).
 * parse-event Edge Fn 의 MAX_IMAGES 와 같은 값을 유지할 것.
 * 서버가 진짜 관문이고 이 상수는 UI 가 미리 막아 주기 위한 것이다.
 */
export const MAX_NL_IMAGES = 10;

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
async function callEdgeFunction(
  text: string,
  images?: AiImageAttachment[],
): Promise<EdgeFunctionResult> {
  // Build-51 — pull live i18n locale so the Edge Function picks the right
  // system prompt instead of always using Korean. Fallback to 'ko' for
  // safety if the i18n module hasn't been initialised yet.
  let locale = 'ko';
  try {
    // Lazy import to avoid pulling i18next into every aiService caller's
    // bundle (it's already loaded by the app shell so this is free).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const i18nMod = require('@/lib/i18n');
    const i18n = i18nMod?.default ?? i18nMod;
    if (typeof i18n?.language === 'string') locale = i18n.language;
  } catch {
    // fall through with 'ko'
  }

  try {
    const { data, error } = await supabase.functions.invoke<AiParseResponse>(
      EDGE_FUNCTIONS.PARSE_EVENT,
      {
        body: {
          text,
          contextDatetime: new Date().toISOString(),
          locale,
          // v1.4.11 — 사진은 배열로 보낸다. 서버는 구버전 단수 필드도 계속 받지만
          // 신버전 클라이언트는 배열만 채운다(둘 다 보내면 중복될 수 있다).
          ...(images?.length ? { images } : {}),
        },
      },
    );

    if (error || !data) {
      // 크레딧 소진 등 AI 일시 중단(503 ai_unavailable) → 명확한 안내로 치환.
      let bodyKey = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === 'function') {
          const b = await ctx.json();
          bodyKey = typeof b?.error === 'string' ? b.error : '';
        }
      } catch { /* 무시 */ }
      if (/ai_unavailable/i.test(bodyKey) || /503/.test(error?.message ?? '')) {
        throw new Error('AI 기능을 일시적으로 사용할 수 없어요. 직접 입력하거나 잠시 후 다시 시도해 주세요.');
      }
      throw new Error(error?.message ?? 'Empty response from Edge Function');
    }

    const { result, tokensUsed: tokens } = data;
    // v1.4.11 — 사진 여러 장이면 서버가 results 배열을 함께 준다.
    // 구버전 서버(배포 전)는 이 필드가 없으므로 result 하나로 되돌아간다.
    const rawItems = Array.isArray(data.results) && data.results.length > 0
      ? data.results
      : [result];

    /**
     * ISO-8601 문자열(Deno/JSON 직렬화)을 Date 객체로 되돌린다.
     * AI 는 날짜를 문자열로 주지만 ParsedField<Date> 는 실제 Date 를 기대한다.
     */
    const toNlResult = (item: typeof result): NLParseResult => {
      const parsed = { ...item.parsed };
      if (parsed.startAt) {
        const rawStart = parsed.startAt.value as unknown as string;
        parsed.startAt = { value: new Date(rawStart), confidence: parsed.startAt.confidence };
      }
      if (parsed.endAt) {
        const rawEnd = parsed.endAt.value as unknown as string;
        parsed.endAt = { value: new Date(rawEnd), confidence: parsed.endAt.confidence };
      }
      return {
        parsed,
        confidence: item.confidence,
        source: 'ai',
        rawInput: text,
        processingMs: null,
      };
    };

    const nlResults = rawItems.map(toNlResult);
    // rawItems 는 최소 1개지만(results 가 비면 [result] 로 떨어진다) tsconfig 의
    // noUncheckedIndexedAccess 가 그걸 모른다 — result 로 한 번 더 받쳐 준다.
    const firstResult = nlResults[0] ?? toNlResult(result);

    return {
      nlResult: firstResult,
      ...(nlResults.length > 1 && { nlResults }),
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
/**
 * Multi-event variant of parseNaturalLanguage.
 *
 * Tries the local multi-segment splitter first ("내일 9시 회의, 12시 점심"
 * → 2 events). If the splitter found multiple segments and at least one
 * resolved to high/medium confidence, returns the local list directly —
 * cheap, no API call. Otherwise falls back to the existing single-event
 * Edge Function path so simple Korean inputs still get AI help.
 *
 * Always returns at least one element. Quota / error cases mirror the
 * single-event helper so callers can use either uniformly.
 */
export async function parseNaturalLanguageMulti(text: string): Promise<NLParseResult[]> {
  // v1.2.9 — AI-only 정책. 단, 콤마/세미콜론으로 명시 enumeration 한 경우만
  // 로컬 splitter 로 분할 후 각 segment 를 AI 로 개별 파싱.
  // (multi-event AI parsing 은 follow-up — 현재는 splitter + AI per-segment.)
  const hasMultiSeparator = /[,;]|그리고\s|\sand\s/i.test(text);
  if (hasMultiSeparator) {
    const local = parseMultiple(text);
    if (local.length > 1) {
      // 각 segment 의 rawInput 을 AI 에 다시 보내 정확도 향상.
      const results = await Promise.all(local.map((r) => parseNaturalLanguage(r.rawInput || text)));
      return results;
    }
  }
  // 단일 입력 → AI 로 1회 파싱.
  const single = await parseNaturalLanguage(text);
  return [single];
}

export async function parseNaturalLanguage(
  text: string,
  options?: {
    /**
     * 첨부 사진. v1.4.11 부터 최대 {@link MAX_NL_IMAGES} 장.
     * 여러 장에서 일정이 여럿 나오면 **첫 건만** 돌아온다 —
     * 전부 받으려면 {@link parseNaturalLanguageWithImages} 를 쓸 것.
     */
    images?: AiImageAttachment[];
  },
): Promise<NLParseResult> {
  const results = await parseNaturalLanguageWithImages(text, options?.images);
  // 항상 1건 이상을 주지만(실패도 error 1건) 타입상 빈 배열이 가능해 방어한다.
  return results[0] ?? {
    parsed: {},
    confidence: 'low',
    source: 'ai',
    rawInput: text,
    processingMs: null,
    error: 'AI parsing failed',
  };
}

/**
 * 사진 첨부 파싱의 다중 결과 버전.
 *
 * 사진을 여러 장 보내면 일정도 여러 건 나올 수 있어(예: 시간표 스크린샷)
 * 서버가 `results` 배열을 준다. 이 함수는 그 배열을 그대로 돌려준다.
 * 결과가 1건이면 원소 1개짜리 배열이다 — 호출부는 항상 배열로 다루면 된다.
 *
 * @param text   함께 보낼 지시문(비어 있어도 됨 — 사진만으로도 파싱한다)
 * @param images 첨부 사진 (없으면 텍스트 전용 경로와 동일하게 동작)
 * @returns 최소 1건. 실패 시 confidence='low' + error 가 담긴 1건.
 */
export async function parseNaturalLanguageWithImages(
  text: string,
  images?: AiImageAttachment[],
): Promise<NLParseResult[]> {
  const hasImage = !!images?.length;

  // v1.2.9 — LEAD 결정: 로컬 정규식 파서를 제거하고 모든 입력을 AI 로
  // 통일. 이유: regex 가 "6~9시" 같은 경계 패턴을 자주 놓치고 (시 첫 숫자
  // 누락 → endHour 만 시작점으로 잡힘) title 잔여물도 흘림. AI 통일 시
  // 일관된 품질 + UX. 비용 영향 ~$10/월 (100 사용자 기준) 으로 미미.
  // parseLocally 는 quota 도달 시 graceful fallback 으로만 사용.

  // Step 3: client-side daily limit (text 만). image 한도는 server quota 가
  // 별도 (parse-event-vision: free 2/day). 클라이언트에선 굳이 사전 차단 X.
  // v1.2.9 — quota 초과 시 로컬 파서로 graceful degrade (사용자 차단 대신).
  if (!hasImage) {
    const usage = await readUsageRecord();
    if (usage.callCount >= FREE_AI_DAILY_LIMIT) {
      const localFallback = parseLocally(text);
      if (localFallback.confidence !== 'low') return [localFallback];
      return [{
        parsed: {},
        confidence: 'low',
        source: 'local',
        rawInput: text,
        processingMs: null,
        error: `오늘 AI 파싱 한도(${FREE_AI_DAILY_LIMIT}회)에 도달했어요. 직접 입력해주세요.`,
      }];
    }
  }

  // Step 4: call Edge Function — image 가 있으면 함께 전달 (서버에서 vision
  // 모델 + vision quota 사용).
  const { nlResult, nlResults, tokensUsed } = await callEdgeFunction(text, images);

  // Step 5: record usage — text 흐름만 클라 카운트 (image 는 server-only).
  if (!hasImage) {
    const usage = await readUsageRecord();
    await writeUsageRecord({
      date:       usage.date,
      callCount:  usage.callCount + 1,
      tokensUsed: usage.tokensUsed + tokensUsed,
    });
  }

  // 서버가 여러 건을 줬으면 전부, 아니면 한 건짜리 배열.
  return nlResults ?? [nlResult];
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
function weeklyReviewCacheKey(weekStart: Date, locale: string): string {
  const y = weekStart.getFullYear();
  const m = String(weekStart.getMonth() + 1).padStart(2, '0');
  const d = String(weekStart.getDate()).padStart(2, '0');
  return `synclink:weekly_review:${y}-${m}-${d}:${locale}`;
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
export async function getWeeklyReview(
  weekStart: Date,
  locale: string = 'ko',
): Promise<{
  review: string;
  generatedAt: Date;
}> {
  const cacheKey = weeklyReviewCacheKey(weekStart, locale);

  // Step 1: check cache (locale-scoped)
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const cached: CachedWeeklyReview = JSON.parse(raw);
      return { review: cached.review, generatedAt: new Date(cached.generatedAt) };
    }
  } catch {
    // Cache miss or parse error — fall through to Edge Function call
  }

  // Step 2: call Edge Function (locale 전달)
  const { data, error } = await supabase.functions.invoke<{
    review: string;
    generatedAt: string;
  }>(EDGE_FUNCTIONS.WEEKLY_REVIEW, {
    body: { weekStart: weekStart.toISOString(), locale },
  });

  if (error || !data) {
    // supabase-js wraps Edge Function errors as FunctionsHttpError.
    // The generic message is always "Edge Function returned a non-2xx status code".
    // The actual error body lives in error.context — read it for a meaningful message.
    let message = error?.message ?? 'Weekly review 생성에 실패했습니다.';
    try {
      const body = await (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.();
      if (body?.error) message = body.error;
    } catch { /* ignore — use generic message */ }
    throw new Error(message);
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
 * @deprecated Use getFreeTimeRecommendations() (PRD 4.2 Tier 3 옵션 C 구현)
 */
export async function getActivityRecommendations(
  _spaceId: string,
  _slotStart: Date,
  _slotEnd: Date,
): Promise<string[]> {
  // Pro-tier feature — not yet implemented
  return [];
}

// ─── PRD 4.2 Tier 3: Free Time AI Recommendations ────────────────────────────

/**
 * 단일 활동 아이템 (Edge Function + 룰 모두에서 사용).
 *  - name:      활동 이름 (locale 언어)
 *  - reason:    추천 이유 (AI 응답 시만 포함)
 *  - fitScore:  슬롯 적합도 0-1 (AI 응답 시만 포함)
 */
export interface ActivityItem {
  name: string;
  reason?: string;
  fitScore?: number;
}

/**
 * 단일 슬롯에 대한 활동 추천 결과.
 */
export interface SlotRecommendation {
  /** 추천 대상 빈 슬롯 */
  slot: FreeSlot;
  /** 추천 활동 목록 (최대 3개) */
  activities: ActivityItem[];
  /** 'rule': 룰 baseline, 'ai': Claude 응답 */
  source: 'rule' | 'ai';
  /** AsyncStorage 캐시 또는 Edge Function 캐시에서 왔으면 true */
  fromCache: boolean;
}

/**
 * getFreeTimeRecommendations 반환 타입.
 */
export interface FreeTimeRecommendationsResult {
  recommendations: SlotRecommendation[];
  /** 전체 응답 source ('rule' 또는 'ai') */
  source: 'rule' | 'ai';
}

/**
 * Edge Function으로부터 받은 응답 형태 (내부 타입).
 */
interface EdgeRecommendResponse {
  recommendations: {
    slot: { start: string; end: string; durationMinutes: number };
    activities: ActivityItem[];
  }[];
  fromCache: boolean;
  source: 'rule' | 'ai';
}

// ─── Day 3: 추천 캐시 레이어 ─────────────────────────────────────────────────

/** 캐시 TTL: 24시간 (ms 단위) */
const REC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * AsyncStorage에 저장되는 추천 캐시 엔트리 형태.
 *
 * @property result      - 캐시된 FreeTimeRecommendationsResult
 * @property cachedAt    - 저장 시각 (ISO-8601 문자열)
 */
interface CachedRecommendation {
  result: FreeTimeRecommendationsResult;
  cachedAt: string; // ISO-8601
}

/**
 * 활동 추천 캐시 키 생성 헬퍼.
 *
 * 동일한 "슬롯 컨텍스트"(슬롯 시작 시각의 시간 단위 + 슬롯 길이 버킷 + locale)에
 * 대해 24h 동안 동일한 캐시 키를 생성한다.
 *
 * 키 구성: `freetime-rec:{YYYY-MM-DDTHH}:{durationBucket}:{locale}`
 *  - 시작 시각을 시간(H) 단위로 truncate → 같은 시간대 슬롯은 동일 캐시 공유
 *  - durationBucket: 'short'(30-59m) | 'medium'(60-119m) | 'long'(120m+)
 *  - locale: 'ko' | 'en' | 'zh' | 'ja'
 *
 * 여러 슬롯이 입력될 경우 첫 번째 슬롯 기준으로 키를 생성한다 (대표 슬롯).
 * 캐시 hit율 목표: 60% 이상 (plan §3 Day 3).
 *
 * @param slotStart       - 대표 슬롯의 시작 시각 (Date)
 * @param durationMinutes - 대표 슬롯의 길이 (분)
 * @param locale          - 응답 언어
 * @returns AsyncStorage 캐시 키 문자열
 *
 * @example
 *   recommendationCacheKey(new Date('2026-04-28T14:30:00'), 90, 'ko')
 *   // → 'freetime-rec:2026-04-28T14:medium:ko'
 */
export function recommendationCacheKey(
  slotStart: Date,
  durationMinutes: number,
  locale: string,
): string {
  // 시작 시각을 시간(H) 단위로 truncate: "YYYY-MM-DDTHH"
  const y  = slotStart.getFullYear();
  const mo = String(slotStart.getMonth() + 1).padStart(2, '0');
  const d  = String(slotStart.getDate()).padStart(2, '0');
  const h  = String(slotStart.getHours()).padStart(2, '0');
  const hourKey = `${y}-${mo}-${d}T${h}`;

  // 슬롯 길이 버킷 (activitySuggestions.classifySlotLength 과 동일 기준)
  const durationBucket =
    durationMinutes < 60  ? 'short'
    : durationMinutes < 120 ? 'medium'
    : 'long';

  // locale 정규화 (지원 범위 밖이면 'ko')
  const safeLocale = (['ko', 'en', 'zh', 'ja'] as const).includes(locale as SupportedLocale)
    ? locale
    : 'ko';

  return `freetime-rec:${hourKey}:${durationBucket}:${safeLocale}`;
}

/**
 * AsyncStorage에서 추천 캐시를 읽는다.
 * TTL 24h 초과 시 null 반환 (miss 처리).
 *
 * @param cacheKey - recommendationCacheKey() 로 생성한 키
 * @returns 캐시된 FreeTimeRecommendationsResult, 또는 null (miss / expired)
 */
async function readRecommendationCache(
  cacheKey: string,
): Promise<FreeTimeRecommendationsResult | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return null;

    const cached: CachedRecommendation = JSON.parse(raw);

    // TTL 체크: 저장 시각 + 24h 초과 여부
    const cachedAt = new Date(cached.cachedAt).getTime();
    const isExpired = Date.now() - cachedAt > REC_CACHE_TTL_MS;
    if (isExpired) {
      // 만료된 엔트리 — 삭제 후 miss 처리 (fire-and-forget)
      AsyncStorage.removeItem(cacheKey).catch(() => { /* non-critical */ });
      return null;
    }

    return cached.result;
  } catch {
    // 파싱 실패 등 — cache miss로 처리
    return null;
  }
}

/**
 * 추천 결과를 AsyncStorage에 캐시 저장 (fire-and-forget).
 *
 * @param cacheKey - recommendationCacheKey() 로 생성한 키
 * @param result   - 캐시할 FreeTimeRecommendationsResult
 */
function writeRecommendationCache(
  cacheKey: string,
  result: FreeTimeRecommendationsResult,
): void {
  const entry: CachedRecommendation = {
    result,
    cachedAt: new Date().toISOString(),
  };
  AsyncStorage.setItem(cacheKey, JSON.stringify(entry)).catch(() => {
    // 캐시 쓰기 실패는 non-critical — 다음 호출 시 재시도
  });
}

/**
 * 특정 슬롯의 추천 캐시를 강제 삭제한다 (사용자가 "다시 추천" 탭 시 호출).
 *
 * @param slotStart       - 캐시를 비울 슬롯의 시작 시각
 * @param durationMinutes - 슬롯 길이 (분)
 * @param locale          - 추천 언어
 */
export async function invalidateRecommendationCache(
  slotStart: Date,
  durationMinutes: number,
  locale: string,
): Promise<void> {
  const key = recommendationCacheKey(slotStart, durationMinutes, locale);
  await AsyncStorage.removeItem(key).catch(() => { /* non-critical */ });
}

/**
 * PRD 4.2 Tier 3 — AI 활동 추천 (옵션 C 하이브리드 + 24h 클라이언트 캐시).
 *
 * 전략:
 *  1. 룰 baseline 즉시 계산 (0ms, 비용 0) — 항상 수행.
 *  2. AsyncStorage 24h 캐시 확인 (Day 3 추가):
 *     - 캐시 hit  → fromCache=true 로 즉시 반환 (Edge Fn 호출 0, 쿼터 소모 0).
 *     - 캐시 miss → Step 3으로 진행.
 *  3. subscriptionStore.canUseFreeTimeRec() 확인:
 *     - 한도 초과 → 룰 결과만 반환 (graceful degradation).
 *     - 한도 내   → forceAI=true 로 Edge Function 호출 (AI 결과로 교체).
 *  4. Edge Function 호출 성공 시 → consumeFreeTimeRec() 기록 + 캐시 저장 후 AI 결과 반환.
 *  5. Edge Function 실패 / 응답 없음 → 룰 결과 반환 (앱 크래시 없음).
 *
 * 캐시 키: recommendationCacheKey(slots[0].start, slots[0].durationMinutes, locale)
 * 캐시 TTL: 24h (REC_CACHE_TTL_MS)
 * 강제 갱신: invalidateRecommendationCache() 호출 후 이 함수 재호출.
 *
 * @param slots       - 추천 대상 FreeSlot 배열 (Tier 1 결과)
 * @param locale      - 응답 언어 ('ko' | 'en' | 'zh' | 'ja')
 * @param forceAI     - true 이면 쿼터 허용 시 AI 호출 강제 (기본: true)
 * @param preferences - 사용자 관심 카테고리 (없으면 시간대 기반 룰만 사용)
 * @returns FreeTimeRecommendationsResult (fromCache=true 이면 캐시에서 반환)
 */
export async function getFreeTimeRecommendations(
  slots: FreeSlot[],
  locale: SupportedLocale | string = 'ko',
  forceAI = true,
  preferences?: string[],
): Promise<FreeTimeRecommendationsResult> {
  if (slots.length === 0) {
    return { recommendations: [], source: 'rule' };
  }

  // Step 1: 룰 baseline 즉시 계산 (항상 수행)
  const ruleResults: SlotRecommendation[] = slots.map((slot) => {
    const rule = getRuleBaseline(slot, locale);
    return {
      slot,
      activities: rule.activities.map((name) => ({ name })),
      source:     'rule' as const,
      fromCache:  false,
    };
  });

  // Step 2: 클라이언트 캐시 확인 (Day 3)
  // 대표 슬롯(첫 번째)을 기준으로 캐시 키 생성
  // slots.length > 0 은 위에서 보장됨 (non-null assertion 안전)
  const primarySlot = slots[0]!;
  const cacheKey = recommendationCacheKey(
    primarySlot.start,
    primarySlot.durationMinutes,
    locale,
  );

  if (forceAI) {
    // forceAI=false 이면 캐시 확인 자체를 skip (룰만 원하는 경우)
    const cached = await readRecommendationCache(cacheKey);
    if (cached) {
      // 캐시 hit: 각 SlotRecommendation에 fromCache=true 마킹
      const cachedWithFlag: FreeTimeRecommendationsResult = {
        source: cached.source,
        recommendations: cached.recommendations.map((rec) => ({
          ...rec,
          fromCache: true,
        })),
      };
      return cachedWithFlag;
    }
  }

  // Step 3: AI 쿼터 확인
  const store = useSubscriptionStore.getState();
  if (!forceAI || !store.canUseFreeTimeRec()) {
    // 한도 초과 또는 AI 불필요 → 룰 결과 반환
    return { recommendations: ruleResults, source: 'rule' };
  }

  // Step 4: Edge Function 호출 (AI 추천)
  // BUDGET_GUARDRAILS.md 패턴: 호출 직전 카운터 로깅 (개발/스테이징 환경)
  // 실제 비용 모니터링은 Supabase Studio의 Edge Function 호출 통계 대시보드를 사용.
  // 클라이언트 측에서는 __DEV__ 환경에서만 콘솔 로깅으로 호출 추적.
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(
      '[BUDGET] recommend-free-time Edge Fn 호출',
      { slotCount: slots.length, locale, hasPref: !!preferences?.length },
    );
  }

  try {
    // freeSlots를 JSON 직렬화 가능한 형태로 변환
    const freeSlotInputs = slots.map((s) => ({
      start:           s.start.toISOString(),
      end:             s.end.toISOString(),
      durationMinutes: s.durationMinutes,
    }));

    const { data, error } = await supabase.functions.invoke<EdgeRecommendResponse>(
      EDGE_FUNCTIONS.RECOMMEND_FREE_TIME,
      {
        body: {
          freeSlots:        freeSlotInputs,
          userPreferences:  preferences && preferences.length > 0
            ? { categories: preferences }
            : undefined,
          locale,
          forceAI: true,
        },
      },
    );

    if (error || !data) {
      // Edge Function 실패 → 룰 결과로 graceful degradation
      return { recommendations: ruleResults, source: 'rule' };
    }

    // Step 5: 성공 → 쿼터 소비 기록
    store.consumeFreeTimeRec();

    // Edge 응답을 SlotRecommendation 형태로 변환
    // (슬롯 순서는 요청 순서와 동일하다고 가정)
    // slots[0]은 앞에서 length === 0 체크로 보장됨 (non-null assertion 안전)
    const aiResults: SlotRecommendation[] = data.recommendations.map((rec, idx) => ({
      slot:       slots[idx] ?? slots[0]!,  // 인덱스 안전 처리
      activities: rec.activities,
      source:     'ai' as const,
      fromCache:  data.fromCache, // Edge Fn 서버 캐시 여부를 클라이언트로 전파
    }));

    const aiResult: FreeTimeRecommendationsResult = {
      recommendations: aiResults,
      source: 'ai',
    };

    // Step 6: 클라이언트 캐시 저장 (fire-and-forget)
    writeRecommendationCache(cacheKey, aiResult);

    return aiResult;

  } catch {
    // 네트워크 오류 등 → 룰 결과로 graceful degradation
    return { recommendations: ruleResults, source: 'rule' };
  }
}

// ─── Date suggestion ──────────────────────────────────────────────────────────

/** Time slot shape returned by the suggest-date Edge Function. */
export interface DateSuggestionSlot {
  /** ISO-8601 start of the free window. */
  start: string;
  /** ISO-8601 end of the free window. */
  end: string;
}

/** Result of getDateSuggestion(). */
export interface DateSuggestionResult {
  /** Natural-language suggestion from Claude Haiku. */
  suggestion: string;
  /** Top shared free-time slots (max 3). */
  slots: DateSuggestionSlot[];
}

/**
 * Get an AI-generated date / meetup suggestion for a Space.
 *
 * Calls the `suggest-date` Edge Function which:
 *  1. Finds free time slots shared across all Space members for the week.
 *  2. Passes them to Claude Haiku for a friendly suggestion string.
 *
 * @param spaceId   - UUID of the Space to suggest a date for
 * @param weekStart - ISO-8601 string for the Monday of the target week
 * @param locale    - BCP-47 language tag (e.g. 'ko', 'en', 'ja', 'zh') for the AI response
 * @returns DateSuggestionResult — suggestion text + matching slots
 * @throws If the Edge Function returns an error
 */
export async function getDateSuggestion(
  spaceId: string,
  weekStart: string,
  locale = 'ko',
): Promise<DateSuggestionResult> {
  const { data, error } = await supabase.functions.invoke<DateSuggestionResult>(
    EDGE_FUNCTIONS.SUGGEST_DATE,
    { body: { spaceId, weekStart, locale } },
  );

  if (error || !data) {
    let message = error?.message ?? 'Date suggestion failed.';
    try {
      const body = await (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } })?.context?.json?.();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  return data;
}
