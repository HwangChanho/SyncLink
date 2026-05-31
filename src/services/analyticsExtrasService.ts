/**
 * analyticsExtrasService — 분석 탭 확장 집계 (히트맵 + 주별 추이).
 *
 * 기존 analyticsService(getEventStatsForRange)를 건드리지 않고 추가 시각화에
 * 필요한 집계만 별도 제공한다. analyticsService 와 동일하게
 * eventService.getEventsInRange 경유 (컴포넌트 → 서비스 레이어 규칙 준수).
 *
 * 반환 이벤트는 매핑된 도메인 객체로 startAt/endAt(Date) 를 가진다.
 */
import { getEventsInRange } from './eventService';

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface DayHourGrid {
  /** grid[dow(0=일~6=토)][bucket(0=아침~3=밤)] = 일정 수 */
  grid: number[][];
  /** 격자 내 최대값 (히트맵 농도 정규화용). 0 이면 데이터 없음. */
  max: number;
  /** 전체 합계 (빈 상태 판별용). */
  total: number;
}

export interface WeeklyTrendPoint {
  /** "M/D" 주 시작(월요일) 라벨. */
  label: string;
  count: number;
}

export interface OwnershipSplit {
  /** 내가 직접 등록한 일정. */
  own: { count: number; minutes: number };
  /** Space 에서 공유받은(타인이 등록) 일정. */
  shared: { count: number; minutes: number };
  /** 공유받은 비율(%) — 전체 대비. 0~100. */
  sharedPct: number;
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/** 시간(0~23) → 4분할 인덱스. 아침5-12 / 낮12-17 / 저녁17-22 / 밤22-5. */
function hourToBucketIndex(hour: number): number {
  if (hour >= 5 && hour < 12) return 0;
  if (hour >= 12 && hour < 17) return 1;
  if (hour >= 17 && hour < 22) return 2;
  return 3;
}

// ─── 집계 ────────────────────────────────────────────────────────────────────

/**
 * 요일 × 시간대 격자 히트맵.
 *
 * @param range 집계 기간 (start~end, inclusive)
 */
export async function getDayHourGrid(
  range: { start: Date; end: Date },
): Promise<DayHourGrid> {
  const events = await getEventsInRange({ start: range.start, end: range.end });

  // 7행(요일) × 4열(시간대) 0 초기화.
  const grid: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0]);
  let max = 0;
  let total = 0;

  for (const ev of events) {
    const start = ev.startAt;
    const dow = start.getDay();
    const bucket = hourToBucketIndex(start.getHours());
    const row = grid[dow]!;
    const next = (row[bucket] ?? 0) + 1;
    row[bucket] = next;
    total += 1;
    if (next > max) max = next;
  }

  return { grid, max, total };
}

/**
 * 최근 N주 주별 일정 수 추이 (월요일 시작 주).
 *
 * 오늘이 포함된 주를 마지막으로 과거 방향 N개 주를 버킷팅한다.
 *
 * @param weeks 주 개수 (기본 8)
 */
export async function getWeeklyTrend(weeks = 8): Promise<WeeklyTrendPoint[]> {
  const now = new Date();

  // 이번 주 월요일 00:00 (월=1 기준; 일요일이면 직전 월요일로).
  const monday = new Date(now);
  const day = monday.getDay(); // 0=일~6=토
  const diffToMonday = (day + 6) % 7;
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - diffToMonday);

  // 집계 시작 = (weeks-1) 주 전 월요일, 끝 = 이번 주 일요일 23:59:59.
  const start = new Date(monday);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const events = await getEventsInRange({ start, end });

  // 주 버킷 초기화 (라벨 = 주 시작 "M/D").
  const points: WeeklyTrendPoint[] = Array.from({ length: weeks }, (_, i) => {
    const wkStart = new Date(start);
    wkStart.setDate(wkStart.getDate() + i * 7);
    return { label: `${wkStart.getMonth() + 1}/${wkStart.getDate()}`, count: 0 };
  });

  const startMs = start.getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  for (const ev of events) {
    const weekIndex = Math.floor((ev.startAt.getTime() - startMs) / weekMs);
    if (weekIndex >= 0 && weekIndex < weeks) {
      points[weekIndex]!.count += 1;
    }
  }

  return points;
}

/** 일정 길이(분). allDay 는 하루(1440분) 환산 — analyticsService 와 동일 규칙. */
function eventMinutes(ev: { startAt: Date; endAt: Date; allDay: boolean }): number {
  if (ev.allDay) return 1440;
  return Math.max(0, Math.round((ev.endAt.getTime() - ev.startAt.getTime()) / 60000));
}

/**
 * 내가 등록 vs 공유받은 일정 비중.
 *
 * EventSummary.isOwn(true=내 일정) 기준 분리. Space 별 세분화는 event_shares
 * 조회가 필요해 보류하고, 커플·팀 분담을 가장 잘 보여주는 own/shared 비중만 제공.
 *
 * @param range 집계 기간 (start~end, inclusive)
 */
export async function getOwnershipSplit(
  range: { start: Date; end: Date },
): Promise<OwnershipSplit> {
  const events = await getEventsInRange({ start: range.start, end: range.end });

  const own = { count: 0, minutes: 0 };
  const shared = { count: 0, minutes: 0 };

  for (const ev of events) {
    const mins = eventMinutes(ev);
    const bucket = ev.isOwn ? own : shared;
    bucket.count += 1;
    bucket.minutes += mins;
  }

  const total = own.count + shared.count;
  const sharedPct = total > 0 ? Math.round((shared.count / total) * 100) : 0;
  return { own, shared, sharedPct };
}
