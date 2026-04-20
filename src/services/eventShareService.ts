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
    ) as { error: Error | null };

  if (error) throw error;
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
    .eq('space_id', spaceId) as { error: Error | null };

  if (error) throw error;
}
