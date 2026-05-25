/**
 * insightsService — AI 분석 대시보드의 자연어 인사이트.
 *
 * Edge Function `generate-insights` 를 호출해 통계 → 한국어 2~3 문장 + 액션
 * 제안을 받는다. AI 코멘트 카드에서 사용.
 *
 * Free 1일 1회, Pro 무제한 — quota 는 Edge Function 측 _shared/quota.ts 에서.
 */
import { supabase } from '@/lib/supabase';
import type { EventStats } from './analyticsService';

/** Edge Function 응답 형태. */
export interface InsightResult {
  /** 한국어 2~3 문장 자연어 인사이트. */
  comment: string;
  /** 선택적 액션 제안 (1줄). 없으면 빈 문자열. */
  suggestion: string;
  /** 응답 모델명 (디버깅용). */
  model?: string;
  /** Free 사용자가 일일 한도 초과인지. */
  quotaExceeded?: boolean;
}

/**
 * stats → 자연어 인사이트.
 *
 * - 호출 비용: Claude Haiku 1회. 일일 quota 적용.
 * - 에러: throw — 호출 측에서 catch & 보여줌.
 *
 * @param stats analyticsService.getEventStatsForRange 결과
 */
export async function generateInsight(stats: EventStats): Promise<InsightResult> {
  // Edge Function 으로 stats 의 핵심만 보냄 (불필요 필드 제외해 prompt token 절약).
  const payload = {
    range: {
      start: stats.range.start.toISOString(),
      end:   stats.range.end.toISOString(),
    },
    totalCount:    stats.totalCount,
    totalMinutes:  stats.totalMinutes,
    ownCount:      stats.ownCount,
    busiestDow:    stats.busiestDow,
    quietestDow:   stats.quietestDow,
    emptyDayCount: stats.emptyDayCount,
    byCategory:    stats.byCategory.slice(0, 6).map(c => ({
      name:    c.name,
      count:   c.count,
      minutes: c.minutes,
    })),
    byDayOfWeek:   stats.byDayOfWeek.map(d => ({ dow: d.dow, count: d.count })),
    byHourBucket:  stats.byHourBucket.map(b => ({ bucket: b.bucket, count: b.count })),
  };

  const { data, error } = await supabase.functions.invoke('generate-insights', {
    body: payload,
  });

  if (error) throw error;
  if (!data) throw new Error('인사이트 응답이 비어있어요.');

  return data as InsightResult;
}
