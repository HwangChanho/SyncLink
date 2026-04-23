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

// ─── Imports ──────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { parseLocally } from '@/lib/nlParser';
import {
  parseNaturalLanguage,
  getDailyUsage,
  getTodayUsage,
  hasRemainingDailyLimit,
} from '@/services/aiService';
import type { NLParseResult, AiUsageRecord } from '@/types';

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
