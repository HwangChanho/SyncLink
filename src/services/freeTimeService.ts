/**
 * Free time service — finds contiguous free slots shared by all space members.
 *
 * Algorithm (client-side, O(n log n)):
 *  1. Fetch all timed (non-all-day) events for all space members within range.
 *  2. Sort by start time and merge overlapping busy intervals.
 *  3. Identify gaps between merged intervals that meet minDurationMinutes.
 *
 * NOTE: Uses `supabase as any` workaround for supabase-js v2 Relationships
 * type limitation — same pattern as eventService.ts.
 */

import { supabase } from '@/lib/supabase';
import type { FreeTimeSlot, DateRange } from '@/types';

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

/**
 * Find contiguous free time slots common to ALL members of a space.
 *
 * @param spaceId - UUID of the space
 * @param range - Date range to search
 * @param minDurationMinutes - Minimum gap length in minutes to include (default: 60)
 * @returns FreeTimeSlot[] sorted by startAt
 */
export async function findFreeTimeSlots(
  spaceId: string,
  range: DateRange,
  minDurationMinutes = 60,
): Promise<FreeTimeSlot[]> {
  // ─── 1. Get space members ──────────────────────────────────────────────
  const { data: members, error: memberError } = await supa
    .from('space_members')
    .select('user_id')
    .eq('space_id', spaceId) as {
      data: Array<{ user_id: string }> | null;
      error: Error | null;
    };

  if (memberError) throw memberError;
  if (!members || members.length === 0) return [];

  const memberIds = members.map((m: { user_id: string }) => m.user_id);

  // ─── 2. Fetch all timed events for members in range ───────────────────
  const { data: eventRows, error: eventError } = await supa
    .from('events')
    .select('user_id, start_at, end_at, all_day')
    .in('user_id', memberIds)
    .eq('all_day', false)
    .lte('start_at', range.end.toISOString())
    .gte('end_at', range.start.toISOString()) as {
      data: Array<{ user_id: string; start_at: string; end_at: string; all_day: boolean }> | null;
      error: Error | null;
    };

  if (eventError) throw eventError;

  const rangeStartMs = range.start.getTime();
  const rangeEndMs   = range.end.getTime();
  const minMs        = minDurationMinutes * 60_000;

  // If no events, the entire range is free
  if (!eventRows || eventRows.length === 0) {
    const durationMinutes = Math.round((rangeEndMs - rangeStartMs) / 60_000);
    if (durationMinutes >= minDurationMinutes) {
      return [{
        startAt: range.start,
        endAt:   range.end,
        durationMinutes,
        participantIds: memberIds,
      }];
    }
    return [];
  }

  // ─── 3. Sort and merge busy intervals ─────────────────────────────────
  const busyPeriods = eventRows
    .map((e: { start_at: string; end_at: string }) => ({
      start: Math.max(new Date(e.start_at).getTime(), rangeStartMs),
      end:   Math.min(new Date(e.end_at).getTime(),   rangeEndMs),
    }))
    .filter((p: { start: number; end: number }) => p.end > p.start)
    .sort((a: { start: number }, b: { start: number }) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const period of busyPeriods) {
    const last = merged[merged.length - 1];
    if (last && period.start <= last.end) {
      last.end = Math.max(last.end, period.end);
    } else {
      merged.push({ start: period.start, end: period.end });
    }
  }

  // ─── 4. Find gaps that meet the minimum duration ──────────────────────
  const freeSlots: FreeTimeSlot[] = [];

  // Gap before first busy period
  const firstBusy   = merged[0];
  const firstGapEnd = firstBusy ? firstBusy.start : rangeEndMs;
  if (firstGapEnd - rangeStartMs >= minMs) {
    freeSlots.push({
      startAt:         new Date(rangeStartMs),
      endAt:           new Date(firstGapEnd),
      durationMinutes: Math.round((firstGapEnd - rangeStartMs) / 60_000),
      participantIds:  memberIds,
    });
  }

  // Gaps between busy periods
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i]!.end;
    const gapEnd   = merged[i + 1]!.start;
    if (gapEnd - gapStart >= minMs) {
      freeSlots.push({
        startAt:         new Date(gapStart),
        endAt:           new Date(gapEnd),
        durationMinutes: Math.round((gapEnd - gapStart) / 60_000),
        participantIds:  memberIds,
      });
    }
  }

  // Gap after last busy period
  const lastBusy = merged[merged.length - 1];
  if (lastBusy && rangeEndMs - lastBusy.end >= minMs) {
    freeSlots.push({
      startAt:         new Date(lastBusy.end),
      endAt:           new Date(rangeEndMs),
      durationMinutes: Math.round((rangeEndMs - lastBusy.end) / 60_000),
      participantIds:  memberIds,
    });
  }

  return freeSlots;
}
