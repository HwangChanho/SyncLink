/**
 * fitnessStatsService — v1.2.1 헬스/러닝 통계.
 *
 * 헬스: event_workout_parts 집계 (부위별 횟수).
 * 러닝: events 의 distance_km 합산 + avg_pace_seconds 평균.
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import type { WorkoutPartDb } from '@/types';

export interface WorkoutPartStat {
  part:  WorkoutPartDb;
  count: number;
}

/**
 * 최근 N 일간 (default 30) 본인 헬스 일정의 부위별 횟수.
 * 가장 많이 한 부위가 상단에 오도록 desc 정렬.
 */
export async function getWorkoutPartStats(days: number = 30): Promise<WorkoutPartStat[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // event_workout_parts 의 event 가 본인 + 헬스 + 기간 안인 것만.
  // FK 없이 join — events 가 RLS 로 본인 행만 보여줌.
  const { data, error } = await (supabase as any)
    .from('event_workout_parts')
    .select('part, events!inner(user_id, start_at, event_kind)')
    .eq('events.user_id', userId)
    .eq('events.event_kind', 'workout')
    .gte('events.start_at', since);
  if (error) return [];

  const counts = new Map<WorkoutPartDb, number>();
  for (const row of (data ?? []) as Array<{ part: WorkoutPartDb }>) {
    counts.set(row.part, (counts.get(row.part) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([part, count]) => ({ part, count }))
    .sort((a, b) => b.count - a.count);
}

export interface RunningStat {
  /** YYYY-WW (ISO week) 또는 YYYY-MM. period 기준에 따라 다름. */
  bucket:        string;
  totalKm:       number;
  avgPaceSeconds: number;
  count:         number;
}

/**
 * 최근 N 주 (default 12) 의 주별 러닝 누적 km + 평균 페이스.
 */
export async function getRunningWeeklyStats(weeks: number = 12): Promise<RunningStat[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('events')
    .select('start_at, distance_km, avg_pace_seconds')
    .eq('user_id', userId)
    .eq('event_kind', 'running')
    .gte('start_at', since);
  if (error) return [];

  // 주 단위 grouping. 시작일을 일요일 기준으로 정규화.
  const buckets = new Map<string, { totalKm: number; paceSum: number; count: number }>();
  for (const r of (data ?? []) as Array<{ start_at: string; distance_km: number | null; avg_pace_seconds: number | null }>) {
    const d = new Date(r.start_at);
    // 일요일 = 0 으로 그 주 일요일 ISO date 추출.
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - d.getDay());
    sunday.setHours(0, 0, 0, 0);
    const key = sunday.toISOString().slice(0, 10);
    const cur = buckets.get(key) ?? { totalKm: 0, paceSum: 0, count: 0 };
    cur.totalKm += r.distance_km ?? 0;
    cur.paceSum += r.avg_pace_seconds ?? 0;
    cur.count   += 1;
    buckets.set(key, cur);
  }

  return [...buckets.entries()]
    .map(([bucket, v]) => ({
      bucket,
      totalKm:        Math.round(v.totalKm * 100) / 100,
      avgPaceSeconds: v.count > 0 ? Math.round(v.paceSum / v.count) : 0,
      count:          v.count,
    }))
    .sort((a, b) => b.bucket.localeCompare(a.bucket)); // newest first
}
