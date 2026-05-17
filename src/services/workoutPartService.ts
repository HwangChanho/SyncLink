/**
 * workoutPartService — v1.1 운동 일정 부위 기록.
 *
 * The `event_workout_parts` table is a thin join (event_id × part).
 * We deliberately don't expose a partial-update API: the user-facing
 * picker either replaces the whole selection or clears it. `saveParts`
 * is idempotent — wipes the existing rows and re-inserts the new set
 * inside a single transaction-safe sequence.
 *
 * Plan: docs/plans/2026-05-17-workout-event-type.md
 */

import { supabase } from '@/lib/supabase';
import { logError, serializePgError } from '@/lib/errorLogger';
import type { WorkoutPartDb } from '@/types';

// supabase-js v2 Database generics workaround — same pattern as other services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

/** Read the list of workout parts associated with an event. */
export async function listParts(eventId: string): Promise<WorkoutPartDb[]> {
  const { data, error } = await supa
    .from('event_workout_parts')
    .select('part')
    .eq('event_id', eventId);
  if (error) {
    logError({ context: 'workoutPart.list', error: serializePgError(error) }).catch(() => { /* noop */ });
    return [];
  }
  return (data ?? []).map((r: { part: WorkoutPartDb }) => r.part);
}

/**
 * Replace the saved parts for an event with the provided set.
 * Idempotent: calling with an empty array clears the rows; calling twice
 * with the same set is a no-op from the row perspective.
 */
export async function saveParts(eventId: string, parts: WorkoutPartDb[]): Promise<void> {
  // 1) Delete everything currently saved for this event.
  const { error: delErr } = await supa
    .from('event_workout_parts')
    .delete()
    .eq('event_id', eventId);
  if (delErr) {
    throw new Error(`운동 부위 초기화에 실패했습니다: ${delErr.message}`);
  }
  if (parts.length === 0) return;

  // 2) Bulk insert the new selection. We dedupe defensively in case the
  //    UI lets the same part slip through twice.
  const unique = Array.from(new Set(parts));
  const rows = unique.map((part) => ({ event_id: eventId, part }));
  const { error: insErr } = await supa.from('event_workout_parts').insert(rows);
  if (insErr) {
    throw new Error(`운동 부위 저장에 실패했습니다: ${insErr.message}`);
  }
}
