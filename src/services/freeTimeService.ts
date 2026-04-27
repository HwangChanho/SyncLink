/**
 * Free time service — finds contiguous free slots shared by space members.
 *
 * PRD 4.2 Free Time Finder (Tier 1): pure DB-query based slot finder.
 *  - No AI calls.
 *  - No UI logic.
 *  - Results are sorted by start time.
 *
 * Two public APIs:
 *  1. `findFreeSlots(spaceId, range, options?)` — PRD-spec contract.
 *     Returns `FreeSlot[]` with `{ start, end, durationMinutes }`.
 *     Default `minSlotMinutes` = 30.
 *  2. `findFreeTimeSlots(spaceId, range, minDurationMinutes?)` — Legacy.
 *     Returns `FreeTimeSlot[]` with `participantIds` for the existing
 *     space screen UI. Default minimum = 60.
 *
 * Both are thin layers over the shared internal `computeFreeSlots`
 * algorithm to guarantee identical merging/gap-detection logic.
 *
 * Algorithm (client-side, O(n log n)):
 *  1. Resolve participants (space members, optionally filtered).
 *  2. Fetch all timed (non-all-day) events for those users in range.
 *  3. Sort by start time and merge overlapping busy intervals.
 *  4. Identify gaps between merged intervals that meet the minimum.
 *
 * NOTE: Uses `supabase as any` workaround for supabase-js v2 Relationships
 * type limitation — same pattern as eventService.ts.
 */

import { supabase } from '@/lib/supabase';
import type { DateRange } from '@/types';
import type { FreeTimeSlot } from '@/types';
import type { FreeSlot, FreeSlotOptions } from '@/types/freeTime';

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Internal types ─────────────────────────────────────────────────────────

/**
 * Raw busy interval used by the merging algorithm. Stored as ms timestamps
 * for fast arithmetic; converted back to Date only at the boundary.
 */
interface BusyInterval {
  start: number;
  end:   number;
}

/** Raw event row shape returned by the Supabase select() below. */
interface EventRow {
  user_id:  string;
  start_at: string;
  end_at:   string;
  all_day:  boolean;
}

// ─── Private helpers ────────────────────────────────────────────────────────

/**
 * Resolve which user IDs to compute the intersection over.
 *
 * - If `participantUserIds` is provided, return them as-is (no DB call —
 *   caller is asserting these are valid space members; RLS still applies
 *   to the events query downstream).
 * - Otherwise fetch all members of the space.
 *
 * Returns `null` if the resolution yields no users (caller should short-
 * circuit to an empty result).
 */
async function resolveParticipantIds(
  spaceId: string,
  participantUserIds: string[] | undefined,
): Promise<string[] | null> {
  if (participantUserIds !== undefined) {
    // Empty explicit list → no participants → no slots.
    return participantUserIds.length === 0 ? null : participantUserIds;
  }

  const { data: members, error: memberError } = await supa
    .from('space_members')
    .select('user_id')
    .eq('space_id', spaceId) as {
      data: { user_id: string }[] | null;
      error: Error | null;
    };

  if (memberError) throw memberError;
  if (!members || members.length === 0) return null;

  return members.map((m: { user_id: string }) => m.user_id);
}

/**
 * Fetch every timed (non-all-day) event for the given users that overlaps
 * the date range. The exact `lte`/`gte` predicates mirror eventService's
 * range-overlap pattern (event.start_at ≤ range.end AND event.end_at ≥
 * range.start).
 */
async function fetchBusyEvents(
  userIds: string[],
  range: DateRange,
): Promise<EventRow[]> {
  const { data: eventRows, error: eventError } = await supa
    .from('events')
    .select('user_id, start_at, end_at, all_day')
    .in('user_id', userIds)
    .eq('all_day', false)
    .lte('start_at', range.end.toISOString())
    .gte('end_at', range.start.toISOString()) as {
      data: EventRow[] | null;
      error: Error | null;
    };

  if (eventError) throw eventError;
  return eventRows ?? [];
}

/**
 * Pure function: given busy intervals + a range + a minimum gap, return
 * the contiguous free windows. Side-effect free; safe to unit test
 * without Supabase mocks.
 *
 * Steps:
 *  1. Clamp each event to the range, drop fully-outside ones.
 *  2. Sort by start, merge overlapping/adjacent intervals.
 *  3. Walk gaps: before-first, between-each, after-last.
 *  4. Filter by `minMs`.
 */
function computeFreeSlots(
  events: EventRow[],
  range: DateRange,
  minDurationMinutes: number,
): FreeSlot[] {
  const rangeStartMs = range.start.getTime();
  const rangeEndMs   = range.end.getTime();
  const minMs        = minDurationMinutes * 60_000;

  // No events → entire range is potentially free
  if (events.length === 0) {
    const total = rangeEndMs - rangeStartMs;
    if (total >= minMs) {
      return [{
        start:           range.start,
        end:             range.end,
        durationMinutes: Math.round(total / 60_000),
      }];
    }
    return [];
  }

  // ─── 1. Clamp + sort ──────────────────────────────────────────────────
  const busyPeriods: BusyInterval[] = events
    .map(e => ({
      start: Math.max(new Date(e.start_at).getTime(), rangeStartMs),
      end:   Math.min(new Date(e.end_at).getTime(),   rangeEndMs),
    }))
    .filter(p => p.end > p.start)
    .sort((a, b) => a.start - b.start);

  // ─── 2. Merge overlapping/adjacent intervals ──────────────────────────
  const merged: BusyInterval[] = [];
  for (const period of busyPeriods) {
    const last = merged[merged.length - 1];
    if (last && period.start <= last.end) {
      last.end = Math.max(last.end, period.end);
    } else {
      merged.push({ start: period.start, end: period.end });
    }
  }

  // ─── 3. Walk gaps ─────────────────────────────────────────────────────
  const slots: FreeSlot[] = [];

  // Gap before first busy period
  const firstBusy   = merged[0];
  const firstGapEnd = firstBusy ? firstBusy.start : rangeEndMs;
  if (firstGapEnd - rangeStartMs >= minMs) {
    slots.push({
      start:           new Date(rangeStartMs),
      end:             new Date(firstGapEnd),
      durationMinutes: Math.round((firstGapEnd - rangeStartMs) / 60_000),
    });
  }

  // Gaps between busy periods
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i]!.end;
    const gapEnd   = merged[i + 1]!.start;
    if (gapEnd - gapStart >= minMs) {
      slots.push({
        start:           new Date(gapStart),
        end:             new Date(gapEnd),
        durationMinutes: Math.round((gapEnd - gapStart) / 60_000),
      });
    }
  }

  // Gap after last busy period
  const lastBusy = merged[merged.length - 1];
  if (lastBusy && rangeEndMs - lastBusy.end >= minMs) {
    slots.push({
      start:           new Date(lastBusy.end),
      end:             new Date(rangeEndMs),
      durationMinutes: Math.round((rangeEndMs - lastBusy.end) / 60_000),
    });
  }

  return slots;
}

// ─── Public API: PRD-spec Tier 1 ─────────────────────────────────────────────

/**
 * PRD 4.2 Tier 1 free-time finder.
 *
 * Find contiguous free time slots shared by all (or selected) members of
 * a space within the given range.
 *
 * @param spaceId  UUID of the space
 * @param range    Date range to search (inclusive start, inclusive end)
 * @param options  Optional bag:
 *                   - `minSlotMinutes`     default 30
 *                   - `participantUserIds` restrict intersection to these
 *                                          user IDs instead of full space
 * @returns `FreeSlot[]` sorted ascending by `start`. Empty if no eligible
 *          gap exists or the participant set is empty.
 *
 * @example
 *   const slots = await findFreeSlots('space-1', { start, end });
 *   const pair  = await findFreeSlots('space-1', { start, end }, {
 *     minSlotMinutes: 60,
 *     participantUserIds: ['alice', 'bob'],
 *   });
 */
export async function findFreeSlots(
  spaceId: string,
  range: DateRange,
  options: FreeSlotOptions = {},
): Promise<FreeSlot[]> {
  const minSlotMinutes = options.minSlotMinutes ?? 30;

  const userIds = await resolveParticipantIds(spaceId, options.participantUserIds);
  if (!userIds) return [];

  const events = await fetchBusyEvents(userIds, range);
  return computeFreeSlots(events, range, minSlotMinutes);
}

// ─── Public API: legacy ──────────────────────────────────────────────────────

/**
 * Find contiguous free time slots common to ALL members of a space.
 *
 * Legacy API retained for `src/app/space/[id].tsx` which renders
 * participant badges. Returns `FreeTimeSlot[]` with `participantIds`.
 *
 * For new callers prefer `findFreeSlots` (PRD-spec contract).
 *
 * @param spaceId               UUID of the space
 * @param range                 Date range to search
 * @param minDurationMinutes    Minimum gap length in minutes (default: 60)
 * @returns FreeTimeSlot[] sorted by startAt
 */
export async function findFreeTimeSlots(
  spaceId: string,
  range: DateRange,
  minDurationMinutes = 60,
): Promise<FreeTimeSlot[]> {
  const userIds = await resolveParticipantIds(spaceId, undefined);
  if (!userIds) return [];

  const events = await fetchBusyEvents(userIds, range);
  const slots  = computeFreeSlots(events, range, minDurationMinutes);

  // Adapt to legacy shape (FreeSlot → FreeTimeSlot with participantIds)
  return slots.map(s => ({
    startAt:         s.start,
    endAt:           s.end,
    durationMinutes: s.durationMinutes,
    participantIds:  userIds,
  }));
}
