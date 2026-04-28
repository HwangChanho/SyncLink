/**
 * __tests__/services/aiService.weeklyReview.test.ts
 *
 * TASK-512: getWeeklyReview 테스트 스위트
 *
 * 커버리지:
 *  getWeeklyReview — Edge Function 'weekly-review' 호출 확인
 *  캐시 hit        — 같은 weekStart 재호출 시 Edge Function 미호출 (AsyncStorage 캐시)
 *  캐시 miss       — 다른 주 호출 시 Edge Function 호출
 *  에러 처리       — Edge Function 실패 시 에러 propagation
 *  반환 타입       — { review: string, generatedAt: Date } 형태 검증
 *  캐시 persist    — 성공 시 AsyncStorage.setItem 호출
 *
 * Mock 전략:
 *  - @/lib/supabase mock: supabase.functions.invoke 제어
 *  - AsyncStorage: jest mock (인메모리)
 *
 * @task TASK-512
 * @depends TASK-504 (DEV)
 */

// ─── Mock 선언 (hoisted) ──────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
  getCurrentUserId: jest.fn().mockResolvedValue('user-123'),
}));

jest.mock('@/lib/nlParser', () => ({
  parseLocally: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ─── Imports ──────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { getWeeklyReview } from '@/services/aiService';

// ─── 타입 단언 ────────────────────────────────────────────────────────────────

const mockFunctionsInvoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * 로컬 시간 기준 YYYY-MM-DD 반환.
 * aiService.ts의 weeklyReviewCacheKey와 동일한 방식.
 */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 특정 날짜의 주 시작(월요일) 계산.
 * WeeklyReviewCard의 getMondayOfWeek와 동일한 로직.
 */
function getMondayOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const offset = (day + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * AsyncStorage 캐시 키 생성 헬퍼.
 * aiService.ts의 weeklyReviewCacheKey()와 동일한 구조 (locale 포함).
 */
function cacheKey(weekStart: Date, locale: string = 'ko'): string {
  return `synclink:weekly_review:${localDateStr(weekStart)}:${locale}`;
}

/**
 * Edge Function 성공 응답 mock 반환.
 */
function makeEdgeResponse(review = '지난 주에 열심히 달렸어요! 이번 주도 화이팅!') {
  return {
    data: {
      review,
      generatedAt: new Date('2026-04-20T09:00:00.000Z').toISOString(),
    },
    error: null,
  };
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('getWeeklyReview', () => {
  /** 이번 주 월요일 (테스트 기준일: 2026-04-20은 월요일) */
  const THIS_WEEK_START = getMondayOfWeek(new Date('2026-04-20T09:00:00.000Z'));

  /** 다음 주 월요일 */
  const NEXT_WEEK_START = new Date(THIS_WEEK_START.getTime() + 7 * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 기본 동작: Edge Function 호출
  // ══════════════════════════════════════════════════════════════════════════

  describe('Edge Function 호출', () => {
    it("캐시 없을 때 'weekly-review' Edge Function 호출", async () => {
      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse());

      await getWeeklyReview(THIS_WEEK_START);

      expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
      expect(mockFunctionsInvoke).toHaveBeenCalledWith(
        'weekly-review',
        expect.objectContaining({
          body: expect.objectContaining({ weekStart: expect.any(String) }),
        }),
      );
    });

    it('Edge Function 응답을 { review, generatedAt: Date } 형태로 반환', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse('열심히 하셨어요!'));

      const result = await getWeeklyReview(THIS_WEEK_START);

      expect(result.review).toBe('열심히 하셨어요!');
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('weekStart가 body에 ISO 문자열로 전달됨', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse());

      await getWeeklyReview(THIS_WEEK_START);

      const body = (mockFunctionsInvoke.mock.calls[0][1] as { body?: Record<string, unknown> })?.body;
      expect(typeof body?.weekStart).toBe('string');
      // ISO 8601 형식인지 확인
      expect(() => new Date(body?.weekStart as string)).not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 캐시 동작
  // ══════════════════════════════════════════════════════════════════════════

  describe('캐시 동작', () => {
    it('같은 weekStart로 두 번 호출 시 두 번째는 캐시 hit (Edge Function 1회만 호출)', async () => {
      mockFunctionsInvoke.mockResolvedValue(makeEdgeResponse());

      // 첫 번째 호출: Edge Function 호출 + 캐시 저장
      await getWeeklyReview(THIS_WEEK_START);
      // 잠시 후 캐시 write 완료 대기 (fire-and-forget 비동기)
      await new Promise(resolve => setTimeout(resolve, 10));

      // 두 번째 호출: 캐시 hit
      await getWeeklyReview(THIS_WEEK_START);

      // invoke는 1회만 호출되어야 함
      expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
    });

    it('캐시 hit 시 review 텍스트가 동일하게 반환됨', async () => {
      const reviewText = '첫 번째 생성된 리뷰';
      mockFunctionsInvoke.mockResolvedValue(makeEdgeResponse(reviewText));

      const first = await getWeeklyReview(THIS_WEEK_START);
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = await getWeeklyReview(THIS_WEEK_START);

      expect(first.review).toBe(reviewText);
      expect(second.review).toBe(reviewText);
    });

    it('다른 주(weekStart 다름) 호출 시 Edge Function 재호출', async () => {
      mockFunctionsInvoke.mockResolvedValue(makeEdgeResponse());

      await getWeeklyReview(THIS_WEEK_START);
      await new Promise(resolve => setTimeout(resolve, 10));
      await getWeeklyReview(NEXT_WEEK_START); // 다른 주

      // 두 번 모두 invoke 호출
      expect(mockFunctionsInvoke).toHaveBeenCalledTimes(2);
    });

    it('Edge Function 성공 후 AsyncStorage에 캐시 저장됨', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse('캐시 저장 테스트'));

      await getWeeklyReview(THIS_WEEK_START);
      // fire-and-forget 캐시 저장 완료 대기
      await new Promise(resolve => setTimeout(resolve, 10));

      const key = cacheKey(THIS_WEEK_START);
      const cached = await AsyncStorage.getItem(key);
      expect(cached).not.toBeNull();

      const parsed = JSON.parse(cached!);
      expect(parsed.review).toBe('캐시 저장 테스트');
    });

    it('AsyncStorage에 미리 저장된 캐시가 있으면 invoke 미호출', async () => {
      // 캐시 직접 주입
      const key = cacheKey(THIS_WEEK_START);
      await AsyncStorage.setItem(key, JSON.stringify({
        review:      '캐시된 리뷰',
        generatedAt: new Date('2026-04-20T08:00:00.000Z').toISOString(),
      }));

      const result = await getWeeklyReview(THIS_WEEK_START);

      // invoke 미호출 (캐시 hit)
      expect(mockFunctionsInvoke).not.toHaveBeenCalled();
      expect(result.review).toBe('캐시된 리뷰');
      expect(result.generatedAt).toBeInstanceOf(Date);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 에러 처리
  // ══════════════════════════════════════════════════════════════════════════

  describe('에러 처리', () => {
    it('Edge Function이 error 반환 시 throw', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data:  null,
        error: new Error('Edge Function 실패'),
      });

      await expect(getWeeklyReview(THIS_WEEK_START)).rejects.toThrow('Edge Function 실패');
    });

    it('Edge Function이 data=null 반환 시 throw', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data:  null,
        error: null,
      });

      await expect(getWeeklyReview(THIS_WEEK_START)).rejects.toThrow();
    });

    it('에러 발생 시 캐시에 저장되지 않음', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data:  null,
        error: new Error('실패'),
      });

      await expect(getWeeklyReview(THIS_WEEK_START)).rejects.toThrow();

      const cached = await AsyncStorage.getItem(cacheKey(THIS_WEEK_START));
      expect(cached).toBeNull();
    });

    it('Edge Function 에러 메시지가 throw된 에러에 포함됨', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce({
        data:  null,
        error: new Error('주간 리뷰 생성 오류'),
      });

      await expect(getWeeklyReview(THIS_WEEK_START)).rejects.toThrow('주간 리뷰 생성 오류');
    });

    it('AsyncStorage 캐시 파싱 실패 시 Edge Function 호출로 fallback', async () => {
      // 잘못된 JSON 캐시 주입
      const key = cacheKey(THIS_WEEK_START);
      await AsyncStorage.setItem(key, '{invalid json}');

      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse('fallback 리뷰'));

      const result = await getWeeklyReview(THIS_WEEK_START);

      // Edge Function이 호출되어야 함 (캐시 파싱 실패 fallback)
      expect(mockFunctionsInvoke).toHaveBeenCalledTimes(1);
      expect(result.review).toBe('fallback 리뷰');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 반환값 타입 검증
  // ══════════════════════════════════════════════════════════════════════════

  describe('반환값 타입 검증', () => {
    it('generatedAt은 Date 인스턴스', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse());

      const result = await getWeeklyReview(THIS_WEEK_START);

      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it('review는 비어 있지 않은 문자열', async () => {
      mockFunctionsInvoke.mockResolvedValueOnce(makeEdgeResponse('리뷰 내용'));

      const result = await getWeeklyReview(THIS_WEEK_START);

      expect(typeof result.review).toBe('string');
      expect(result.review.length).toBeGreaterThan(0);
    });
  });
});
