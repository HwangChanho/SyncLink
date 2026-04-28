/**
 * __tests__/services/aiService.test.ts
 *
 * TASK-311: AI Service Test Suite (QA)
 *
 * 커버리지:
 *  parseNaturalLanguage — 로컬 파서 우선, confidence='low'일 때만 AI fallback,
 *                         일일 한도(FREE_AI_DAILY_LIMIT=5) 초과 시 에러 반환,
 *                         Edge Function 오류 처리, 자정 이후 사용량 자동 리셋
 *  getDailyUsage        — 오늘 기록 없음 → callCount=0,
 *                         어제 기록 있으면 자동 리셋 → callCount=0
 *  hasRemainingDailyLimit — 한도 미초과 → true, 초과 → false
 *
 * ── Mock 구조 ─────────────────────────────────────────────────────────────────
 *  @/lib/nlParser       — parseLocally 반환값으로 confidence 레벨 제어
 *  @/lib/supabase       — supabase.functions.invoke 호출 여부 및 반환값 제어
 *  AsyncStorage         — jest.setup.js 전역 in-memory mock 사용
 *                         키: 'synclink:ai_usage' (aiService.ts 내부 상수와 동일)
 *
 * @task TASK-311
 * @depends TASK-301 (aiService.ts implementation)
 */

// ─── Mock 선언 (hoisted — import 보다 앞에 위치해야 함) ───────────────────────

jest.mock('@/lib/nlParser', () => ({
  parseLocally: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
  getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
}));

// PRD 4.2 Tier 3: activitySuggestions mock
jest.mock('@/lib/activitySuggestions', () => ({
  getRuleBaseline: jest.fn((_slot: unknown, _locale: string) => ({
    timeOfDay:   'afternoon',
    slotLength:  'medium',
    activities:  ['영화', '보드게임', '미팅'] as [string, string, string],
  })),
}));

// PRD 4.2 Tier 3: subscriptionStore mock
const mockCanUseFreeTimeRec  = jest.fn(() => true);
const mockConsumeFreeTimeRec = jest.fn();

jest.mock('@/stores/subscriptionStore', () => ({
  useSubscriptionStore: {
    getState: () => ({
      canUseFreeTimeRec:  mockCanUseFreeTimeRec,
      consumeFreeTimeRec: mockConsumeFreeTimeRec,
    }),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { parseLocally } from '@/lib/nlParser';
import {
  parseNaturalLanguage,
  getDailyUsage,
  getTodayUsage,
  hasRemainingDailyLimit,
  getFreeTimeRecommendations,
  recommendationCacheKey,
  invalidateRecommendationCache,
} from '@/services/aiService';
import type { NLParseResult, AiUsageRecord } from '@/types';
import type { FreeSlot } from '@/types/freeTime';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** aiService.ts 내부 AsyncStorage 키 (변경 시 함께 수정 필요) */
const AI_USAGE_STORAGE_KEY = 'synclink:ai_usage';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * 로컬 시간 기준 YYYY-MM-DD 문자열 반환.
 * aiService.ts의 todayDateString()과 동일한 방식으로 구성.
 */
function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today(): string {
  return localDateString();
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateString(d);
}

/**
 * AsyncStorage에 AI 사용량 기록 주입.
 * aiService.ts가 읽는 키와 동일한 키('synclink:ai_usage')에 저장.
 */
async function setUsageRecord(record: AiUsageRecord): Promise<void> {
  await AsyncStorage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(record));
}

/**
 * 지정 confidence를 반환하는 NLParseResult 픽스처.
 * high/medium: title 필드 포함, low: parsed 비어 있음.
 */
function makeLocalResult(confidence: NLParseResult['confidence']): NLParseResult {
  return {
    parsed: confidence !== 'low'
      ? { title: { value: '테스트 미팅', confidence } }
      : {},
    confidence,
    source: 'local',
    rawInput: '테스트 입력',
    processingMs: 1,
  };
}

/**
 * Edge Function 성공 응답 mock 값 생성.
 */
function makeAiResponse(overrides?: Partial<NLParseResult>) {
  const result: NLParseResult = {
    parsed: { title: { value: 'AI 파싱 미팅', confidence: 'high' } },
    confidence: 'high',
    source: 'ai',
    rawInput: '테스트 입력',
    processingMs: null,
    ...overrides,
  };
  return { data: { result, tokensUsed: 50 }, error: null };
}

// ─── 타입 단언 헬퍼 ───────────────────────────────────────────────────────────

const mockParseLocally    = parseLocally as jest.MockedFunction<typeof parseLocally>;
const mockFunctionsInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

// ─── parseNaturalLanguage ─────────────────────────────────────────────────────

describe('parseNaturalLanguage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  test('confidence=high → AI 호출 없음, 로컬 결과 그대로 반환', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('high'));

    const result = await parseNaturalLanguage('내일 오후 3시 미팅');

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(result.confidence).toBe('high');
    expect(result.source).toBe('local');
  });

  test('confidence=medium → AI 호출 없음, 로컬 결과 그대로 반환', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('medium'));

    const result = await parseNaturalLanguage('내일 점심');

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(result.confidence).toBe('medium');
    expect(result.source).toBe('local');
  });

  test('confidence=low + 한도 미초과 → supabase.functions.invoke 호출', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('low'));
    mockFunctionsInvoke.mockResolvedValue(makeAiResponse());

    const result = await parseNaturalLanguage('뭔가 있었는데');

    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    expect(mockFunctionsInvoke).toHaveBeenCalledWith(
      'parse-event',
      expect.objectContaining({ body: expect.any(Object) }),
    );
    expect(result.source).toBe('ai');
  });

  test('confidence=low + AI 호출 성공 → 사용량 callCount 1 증가', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('low'));
    mockFunctionsInvoke.mockResolvedValue(makeAiResponse());

    await parseNaturalLanguage('뭔가 있었는데');

    const usage = await getDailyUsage();
    expect(usage.callCount).toBe(1);
  });

  test('일일 5회 초과 → invoke 미호출, error 필드 포함 결과 반환', async () => {
    await setUsageRecord({ date: today(), callCount: 5, tokensUsed: 250 });
    mockParseLocally.mockReturnValue(makeLocalResult('low'));

    const result = await parseNaturalLanguage('뭔가 있었는데');

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.confidence).toBe('low');
  });

  test('Edge Function 오류 → error 필드 포함 결과 반환 (앱 크래시 없음)', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('low'));
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: new Error('Network error'),
    });

    const result = await parseNaturalLanguage('뭔가 있었는데');

    // 에러가 있어도 항상 NLParseResult 구조를 반환
    expect(result.error).toBeDefined();
    expect(result).toHaveProperty('parsed');
    expect(result).toHaveProperty('confidence');
  });

  test('Edge Function 오류 후에도 사용량 1 증가 (재시도 남용 방지)', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('low'));
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: new Error('Network error'),
    });

    await parseNaturalLanguage('뭔가 있었는데');

    const usage = await getDailyUsage();
    expect(usage.callCount).toBe(1);
  });

  test('날짜 자정 넘겨 어제 기록 → 사용량 리셋 후 AI 호출 가능', async () => {
    // 어제 5회 사용 기록
    await setUsageRecord({ date: yesterday(), callCount: 5, tokensUsed: 250 });
    mockParseLocally.mockReturnValue(makeLocalResult('low'));
    mockFunctionsInvoke.mockResolvedValue(makeAiResponse());

    const result = await parseNaturalLanguage('뭔가 있었는데');

    // 날짜가 바뀌었으므로 AI 호출이 허용되어야 함
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    expect(result.error).toBeUndefined();
  });

  test('API 키가 invoke 요청 body에 포함되지 않음 (Edge Function 경유 확인)', async () => {
    mockParseLocally.mockReturnValue(makeLocalResult('low'));
    mockFunctionsInvoke.mockResolvedValue(makeAiResponse());

    await parseNaturalLanguage('뭔가 있었는데');

    const callBody = (mockFunctionsInvoke.mock.calls[0][1] as { body?: unknown })?.body;
    const bodyStr = JSON.stringify(callBody ?? {});
    // Claude API 키나 anthropic 관련 정보가 클라이언트에서 전송되면 안 됨
    expect(bodyStr).not.toContain('anthropic');
    expect(bodyStr).not.toContain('api_key');
  });
});

// ─── getDailyUsage ────────────────────────────────────────────────────────────

describe('getDailyUsage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('오늘 기록 없으면 callCount=0 반환', async () => {
    const usage = await getDailyUsage();
    expect(usage.callCount).toBe(0);
    expect(usage.date).toBe(today());
  });

  test('오늘 기록 있으면 해당 callCount 반환', async () => {
    await setUsageRecord({ date: today(), callCount: 3, tokensUsed: 150 });
    const usage = await getDailyUsage();
    expect(usage.callCount).toBe(3);
    expect(usage.tokensUsed).toBe(150);
  });

  test('어제 기록만 있으면 자동 리셋 후 callCount=0 반환', async () => {
    await setUsageRecord({ date: yesterday(), callCount: 5, tokensUsed: 250 });
    const usage = await getDailyUsage();
    expect(usage.callCount).toBe(0);
    expect(usage.date).toBe(today());
  });

  test('반환된 date는 항상 오늘 날짜 형식(YYYY-MM-DD)', async () => {
    const usage = await getDailyUsage();
    expect(usage.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(usage.date).toBe(today());
  });

  test('getTodayUsage는 getDailyUsage의 호환 alias (동일 결과)', async () => {
    await setUsageRecord({ date: today(), callCount: 2, tokensUsed: 100 });
    const a = await getDailyUsage();
    const b = await getTodayUsage();
    expect(a).toEqual(b);
  });
});

// ─── hasRemainingDailyLimit ───────────────────────────────────────────────────

describe('hasRemainingDailyLimit', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('사용 기록 없음 → true (한도 여유 있음)', async () => {
    await expect(hasRemainingDailyLimit()).resolves.toBe(true);
  });

  test('4회 사용 → true (FREE_AI_DAILY_LIMIT=5 미만)', async () => {
    await setUsageRecord({ date: today(), callCount: 4, tokensUsed: 200 });
    await expect(hasRemainingDailyLimit()).resolves.toBe(true);
  });

  test('5회 사용 → false (한도 도달)', async () => {
    await setUsageRecord({ date: today(), callCount: 5, tokensUsed: 250 });
    await expect(hasRemainingDailyLimit()).resolves.toBe(false);
  });

  test('어제 5회 사용 → true (오늘 새 한도로 리셋)', async () => {
    await setUsageRecord({ date: yesterday(), callCount: 5, tokensUsed: 250 });
    await expect(hasRemainingDailyLimit()).resolves.toBe(true);
  });
});

// ─── getFreeTimeRecommendations (PRD 4.2 Tier 3) ─────────────────────────────

/**
 * 테스트용 FreeSlot 픽스처.
 * 오후 2시 ~ 4시 (120분) 슬롯.
 */
function makeSlot(overrides: Partial<FreeSlot> = {}): FreeSlot {
  const start = new Date('2026-04-28T14:00:00+09:00'); // 오후 2시
  const end   = new Date('2026-04-28T16:00:00+09:00'); // 오후 4시
  return {
    start,
    end,
    durationMinutes: 120,
    ...overrides,
  };
}

/**
 * Edge Function AI 성공 응답 mock 생성.
 */
function makeEdgeRecResponse(slotCount = 1) {
  return {
    data: {
      recommendations: Array.from({ length: slotCount }, (_, i) => ({
        slot: {
          start:           new Date('2026-04-28T14:00:00+09:00').toISOString(),
          end:             new Date('2026-04-28T16:00:00+09:00').toISOString(),
          durationMinutes: 120,
        },
        activities: [
          { name: `AI 활동 ${i + 1}-1`, reason: '추천 이유', fitScore: 0.9 },
          { name: `AI 활동 ${i + 1}-2`, reason: '추천 이유', fitScore: 0.8 },
          { name: `AI 활동 ${i + 1}-3`, reason: '추천 이유', fitScore: 0.7 },
        ],
      })),
      fromCache: false,
      source: 'ai',
    },
    error: null,
  };
}

describe('getFreeTimeRecommendations', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    // 기본: 쿼터 허용 상태
    mockCanUseFreeTimeRec.mockReturnValue(true);
  });

  // ── 케이스 1: 룰 baseline ──────────────────────────────────────────────────

  test('forceAI=false → Edge Function 호출 없이 룰 baseline 반환', async () => {
    const slot = makeSlot();
    const result = await getFreeTimeRecommendations([slot], 'ko', false);

    // Edge Function(invoke) 호출 없음
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();

    // 룰 source
    expect(result.source).toBe('rule');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].source).toBe('rule');

    // 룰 사전 mock 활동 포함 확인
    expect(result.recommendations[0].activities[0].name).toBe('영화');
  });

  test('canUseFreeTimeRec()=false → AI 호출 없이 룰 baseline 반환', async () => {
    mockCanUseFreeTimeRec.mockReturnValue(false);

    const slot = makeSlot();
    const result = await getFreeTimeRecommendations([slot], 'ko', true);

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(result.source).toBe('rule');
    // consumeFreeTimeRec 호출 없음 (쿼터 소모 안 됨)
    expect(mockConsumeFreeTimeRec).not.toHaveBeenCalled();
  });

  // ── 케이스 2: AI 호출 성공 ────────────────────────────────────────────────

  test('forceAI=true + 쿼터 허용 → Edge Function 호출 후 AI 결과 반환', async () => {
    const slot = makeSlot();
    mockFunctionsInvoke.mockResolvedValue(makeEdgeRecResponse(1));

    const result = await getFreeTimeRecommendations([slot], 'ko', true);

    // Edge Function 호출됨
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    expect(mockFunctionsInvoke).toHaveBeenCalledWith(
      'recommend-free-time',
      expect.objectContaining({
        body: expect.objectContaining({ forceAI: true }),
      }),
    );

    // AI source 반환
    expect(result.source).toBe('ai');
    expect(result.recommendations[0].source).toBe('ai');
    expect(result.recommendations[0].activities[0].name).toContain('AI 활동');

    // consumeFreeTimeRec 1회 호출 (쿼터 기록)
    expect(mockConsumeFreeTimeRec).toHaveBeenCalledTimes(1);
  });

  // ── 케이스 3: 캐시 hit (Edge Fn fromCache=true) ───────────────────────────

  test('Edge Function fromCache=true → 쿼터 기록 & 결과에 fromCache=true 전파', async () => {
    const slot = makeSlot();
    // Edge Function이 캐시에서 응답했다고 시뮬레이션
    const cachedResponse = {
      data: {
        ...makeEdgeRecResponse(1).data,
        fromCache: true,
      },
      error: null,
    };
    mockFunctionsInvoke.mockResolvedValue(cachedResponse);

    const result = await getFreeTimeRecommendations([slot], 'ko', true);

    // 캐시 응답도 AI source로 처리됨 (Edge Fn에서 이미 결과를 반환)
    expect(result.source).toBe('ai');
    expect(result.recommendations[0].fromCache).toBe(true);

    // 캐시라도 성공 응답이면 consumeFreeTimeRec 기록 (서버가 허용한 것)
    expect(mockConsumeFreeTimeRec).toHaveBeenCalledTimes(1);
  });

  // ── 추가: 빈 슬롯 배열 입력 ──────────────────────────────────────────────

  test('빈 슬롯 배열 → 빈 결과 즉시 반환 (Edge Fn 호출 없음)', async () => {
    const result = await getFreeTimeRecommendations([], 'ko', true);

    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(result.recommendations).toHaveLength(0);
    expect(result.source).toBe('rule');
  });

  test('Edge Function 오류 → 룰 baseline으로 graceful degradation (크래시 없음)', async () => {
    const slot = makeSlot();
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: new Error('Network error') });

    const result = await getFreeTimeRecommendations([slot], 'ko', true);

    // 오류 시 룰 결과로 fallback
    expect(result.source).toBe('rule');
    expect(result.recommendations[0].source).toBe('rule');
    // consumeFreeTimeRec 호출 안 됨 (실패 시 쿼터 소모 안 함)
    expect(mockConsumeFreeTimeRec).not.toHaveBeenCalled();
  });

  // ── Day 3: 클라이언트 AsyncStorage 24h TTL 캐시 ─────────────────────────────

  test('캐시 hit — AI 결과 캐시 저장 후 재호출 시 Edge Function 미호출, fromCache=true 반환', async () => {
    const slot = makeSlot();

    // 1차 호출: Edge Function 성공 → 캐시 저장됨
    mockFunctionsInvoke.mockResolvedValue(makeEdgeRecResponse(1));
    const first = await getFreeTimeRecommendations([slot], 'ko', true);
    expect(first.source).toBe('ai');
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);

    // mock 초기화: 2차 호출 시 invoke/consumeFreeTimeRec 횟수를 0부터 다시 측정
    mockFunctionsInvoke.mockClear();
    mockConsumeFreeTimeRec.mockClear();

    // 2차 호출: 캐시 hit → Edge Function 호출 없음, fromCache=true
    const second = await getFreeTimeRecommendations([slot], 'ko', true);
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(second.source).toBe('ai');
    expect(second.recommendations[0].fromCache).toBe(true);
    // 캐시 hit 시 consumeFreeTimeRec 미호출 (쿼터 소모 없음)
    expect(mockConsumeFreeTimeRec).toHaveBeenCalledTimes(0);
  });

  test('TTL 만료 — 캐시 저장 후 25h 경과 시 miss 처리되어 Edge Function 재호출', async () => {
    const slot = makeSlot();

    // 1차 호출: 캐시 저장
    mockFunctionsInvoke.mockResolvedValue(makeEdgeRecResponse(1));
    await getFreeTimeRecommendations([slot], 'ko', true);
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    mockFunctionsInvoke.mockClear();
    mockConsumeFreeTimeRec.mockClear();

    // 캐시 키를 직접 읽어서 cachedAt을 25h 전으로 조작 (TTL 만료 시뮬레이션)
    const cacheKey = recommendationCacheKey(slot.start, slot.durationMinutes, 'ko');
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { result: unknown; cachedAt: string };
      const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ ...parsed, cachedAt: expiredAt }));
    }

    // 2차 호출: TTL 만료 → cache miss → Edge Function 재호출
    mockFunctionsInvoke.mockResolvedValue(makeEdgeRecResponse(1));
    const result = await getFreeTimeRecommendations([slot], 'ko', true);
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('ai');
    // TTL 만료 후 재호출이므로 쿼터 다시 소모
    expect(mockConsumeFreeTimeRec).toHaveBeenCalledTimes(1);
  });
});
