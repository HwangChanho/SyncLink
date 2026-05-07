/**
 * Event share service — manages event_shares junction table.
 *
 * Responsibilities:
 *  - Share an event to a space (INSERT into event_shares)
 *  - Unshare an event from a space (DELETE from event_shares)
 *
 * RLS guarantees:
 *  - Only the event owner can share/unshare (enforced by DB policy)
 *
 * NOTE: Uses `supabase as any` workaround for supabase-js v2 Relationships
 * type limitation — same pattern as spaceService.ts and eventService.ts.
 */

import { supabase } from '@/lib/supabase';

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

/**
 * Share an event to a space (idempotent — safe to call even if already shared).
 * Creates a row in event_shares. The event must be owned by the current user.
 *
 * @param eventId - UUID of the event
 * @param spaceId - UUID of the target space
 */
export async function shareEventToSpace(eventId: string, spaceId: string): Promise<void> {
  const { error } = await supa
    .from('event_shares')
    .upsert(
      { event_id: eventId, space_id: spaceId },
      { onConflict: 'event_id,space_id' },
    ) as { error: { message?: string; code?: string; details?: string; hint?: string } | null };

  if (error) {
    // Build-92 진단 — caller 에서 generic "공유 설정 변경에 실패" 만 노출
    // 되어 root cause 추적 어려움. PostgrestError 의 message/code 를
    // throw 메시지에 포함해 사용자/error_logs 모두에 보이도록.
    const detail = error.code ? ` [${error.code}]` : '';
    throw new Error(`event_shares INSERT 실패${detail}: ${error.message ?? 'unknown'}`);
  }
}

/**
 * Unshare an event from a space (deletes the event_shares row).
 *
 * @param eventId - UUID of the event
 * @param spaceId - UUID of the space to unshare from
 */
export async function unshareEventFromSpace(eventId: string, spaceId: string): Promise<void> {
  const { error } = await supa
    .from('event_shares')
    .delete()
    .eq('event_id', eventId)
    .eq('space_id', spaceId) as { error: { message?: string; code?: string; details?: string; hint?: string } | null };

  if (error) {
    const detail = error.code ? ` [${error.code}]` : '';
    throw new Error(`event_shares DELETE 실패${detail}: ${error.message ?? 'unknown'}`);
  }
}
