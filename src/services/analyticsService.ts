/**
 * analyticsService — AI 분석 대시보드 (Sprint 1 / Phase 1).
 *
 * 사용자 events 를 받아 화면에 표시할 통계를 JS 에서 집계한다.
 * 1~3 개월 범위 = events ~수백 건 이라 client-side 집계 충분.
 * 큰 범위 / Pro 기능 확장 시 supabase view 또는 RPC 로 마이그레이션 검토.
 *
 * 사용처:
 *   - /(tabs)/analytics 화면 카드들
 *   - generate-insights Edge Function (서버에서 같은 통계 → AI 자연어)
 */
import { getEventsInRange } from './eventService';
import { getCategories } from './categoryService';

/** 분석 대상 기간. */
export interface AnalyticsRange {
  /** inclusive */
  start: Date;
  /** inclusive */
  end: Date;
}

/** 시간대 4분할 (활동 패턴 heat map 용). */
export type HourBucket = 'morning' | 'afternoon' | 'evening' | 'night';

/** 카테고리별 집계 한 row. */
export interface CategoryStat {
  /** null = 카테고리 미지정 (기본). */
  categoryId: string | null;
  name: string;
  color: string;
  count: number;
  /** 총 누적 분. allDay 는 24h = 1440 분 환산. */
  minutes: number;
}

/** 요일별 집계 한 row. */
export interface DayOfWeekStat {
  /** 0 = 일요일, 6 = 토요일 (Date.getDay()). */
  dow: number;
  count: number;
  minutes: number;
}

/** 시간대 4분할 한 row. */
export interface HourBucketStat {
  bucket: HourBucket;
  count: number;
  minutes: number;
}

/** Phase 1 — 분석 화면의 기본 카드들이 한 번에 받는 집계 결과. */
export interface EventStats {
  range: { start: Date; end: Date };
  totalCount: number;
  totalMinutes: number;
  /** 자기 일정만 (공유 받은 일정 제외) 카운트. */
  ownCount: number;
  /** 카테고리별 — count desc 정렬. */
  byCategory: CategoryStat[];
  /** 요일별 — dow asc (일~토). 0 row 포함. */
  byDayOfWeek: DayOfWeekStat[];
  /** 시간대별 — morning → night 순서. */
  byHourBucket: HourBucketStat[];
  /** 가장 일정이 많은 요일 (count 기준 max). null = 일정 0 일 때. */
  busiestDow: number | null;
  /** 가장 한가한 요일. null = 일정 0 일 때. */
  quietestDow: number | null;
  /** "비어있는" 일 수 (일정 0 개인 날) — 사용자에게 휴식 패턴 보여주는 카드. */
  emptyDayCount: number;
}

/** 시간 → 4분할 bucket. */
function hourToBucket(hour: number): HourBucket {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** 두 Date 사이 분 차이. 음수면 0. */
function diffMinutes(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

/** YYYY-MM-DD 로컬 key. */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 지정 기간 events 의 분석 통계.
 *
 * - allDay = 하루치 1440분 환산
 * - 카테고리 미지정 = "기타" 로 그룹 (id=null)
 * - 다일 일정은 startAt 기준 1 일에만 카운트 (현재). 향후 일별 분배 로직 검토.
 *
 * @param range 분석 대상 기간 (inclusive)
 * @returns Phase 1 카드들이 그리는 모든 집계
 */
export async function getEventStatsForRange(range: AnalyticsRange): Promise<EventStats> {
  const [events, categories] = await Promise.all([
    getEventsInRange({ start: range.start, end: range.end }),
    getCategories(),
  ]);

  // ─── 카테고리 lookup ───────────────────────────────────────────────────
  const categoryMap = new Map<string, { name: string; color: string }>();
  for (const cat of categories) {
    categoryMap.set(cat.id, { name: cat.name, color: cat.color });
  }
  const UNCATEGORIZED_KEY = '__none__';
  const UNCATEGORIZED_NAME = '기타';
  const UNCATEGORIZED_COLOR = '#9CA3AF';

  // ─── 누적 buffers ──────────────────────────────────────────────────────
  type Agg = { count: number; minutes: number };
  const byCatBuf = new Map<string, Agg & { name: string; color: string }>();
  const byDowBuf: Agg[] = Array.from({ length: 7 }, () => ({ count: 0, minutes: 0 }));
  const byBucketBuf: Record<HourBucket, Agg> = {
    morning:   { count: 0, minutes: 0 },
    afternoon: { count: 0, minutes: 0 },
    evening:   { count: 0, minutes: 0 },
    night:     { count: 0, minutes: 0 },
  };

  // 일정이 있는 날 set (emptyDayCount 산출용).
  const daysWithEvents = new Set<string>();

  let totalCount = 0;
  let totalMinutes = 0;
  let ownCount = 0;

  for (const ev of events) {
    totalCount += 1;
    if (ev.isOwn) ownCount += 1;
    const minutes = ev.allDay ? 1440 : diffMinutes(ev.startAt, ev.endAt);
    totalMinutes += minutes;
    daysWithEvents.add(dayKey(ev.startAt));

    // 카테고리
    const catId = ev.categoryId ?? null;
    const key = catId ?? UNCATEGORIZED_KEY;
    const meta = catId ? categoryMap.get(catId) : null;
    const existing = byCatBuf.get(key);
    if (existing) {
      existing.count += 1;
      existing.minutes += minutes;
    } else {
      byCatBuf.set(key, {
        count: 1,
        minutes,
        name:  meta?.name ?? UNCATEGORIZED_NAME,
        color: meta?.color ?? ev.color ?? UNCATEGORIZED_COLOR,
      });
    }

    // 요일
    const dow = ev.startAt.getDay();
    byDowBuf[dow]!.count += 1;
    byDowBuf[dow]!.minutes += minutes;

    // 시간대 (allDay 는 분배하지 않음 — 전 bucket 에 1 씩 더하면 왜곡).
    if (!ev.allDay) {
      const bucket = hourToBucket(ev.startAt.getHours());
      byBucketBuf[bucket].count += 1;
      byBucketBuf[bucket].minutes += minutes;
    }
  }

  // ─── byCategory → 정렬된 배열 ──────────────────────────────────────────
  const byCategory: CategoryStat[] = Array.from(byCatBuf.entries())
    .map(([key, v]) => ({
      categoryId: key === UNCATEGORIZED_KEY ? null : key,
      name:       v.name,
      color:      v.color,
      count:      v.count,
      minutes:    v.minutes,
    }))
    .sort((a, b) => b.count - a.count);

  // ─── byDayOfWeek → 배열 + 가장 바쁜/한가한 요일 ────────────────────────
  const byDayOfWeek: DayOfWeekStat[] = byDowBuf.map((v, dow) => ({ dow, ...v }));
  let busiestDow: number | null = null;
  let quietestDow: number | null = null;
  if (totalCount > 0) {
    let maxC = -1;
    let minC = Infinity;
    for (const d of byDayOfWeek) {
      if (d.count > maxC) { maxC = d.count; busiestDow = d.dow; }
      if (d.count < minC) { minC = d.count; quietestDow = d.dow; }
    }
  }

  // ─── byHourBucket ──────────────────────────────────────────────────────
  const byHourBucket: HourBucketStat[] = (
    ['morning', 'afternoon', 'evening', 'night'] as const
  ).map((bucket) => ({ bucket, ...byBucketBuf[bucket] }));

  // ─── empty day count ───────────────────────────────────────────────────
  const totalDays = Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1,
  );
  const emptyDayCount = Math.max(0, totalDays - daysWithEvents.size);

  return {
    range:       { start: range.start, end: range.end },
    totalCount,
    totalMinutes,
    ownCount,
    byCategory,
    byDayOfWeek,
    byHourBucket,
    busiestDow,
    quietestDow,
    emptyDayCount,
  };
}

/**
 * 기간 프리셋 → AnalyticsRange. 화면 segment 컨트롤에서 사용.
 *
 * - 'week'    = 오늘 포함 직전 7일 (today - 6 ~ today)
 * - 'month'   = 오늘 포함 직전 30일
 * - 'quarter' = 오늘 포함 직전 90일
 */
export function presetRange(preset: 'week' | 'month' | 'quarter', now: Date = new Date()): AnalyticsRange {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  const days = preset === 'week' ? 6 : preset === 'month' ? 29 : 89;
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}
