/**
 * Event realtime service — Supabase Realtime subscriptions for shared events.
 *
 * Creates one channel per space the current user belongs to, filtering on
 * event_shares rows for that space. Automatically reconnects when the app
 * returns to the foreground.
 *
 * Depends on:
 *  - eventService.getEventById — to hydrate INSERT/UPDATE payloads into EventSummary
 *  - AppState (react-native) — for foreground reconnect
 */

import { AppState } from 'react-native';
import { supabase, getCurrentUserId } from '@/lib/supabase';
import { memberEventColors } from '@/constants/colors';
import { getEventById } from '@/services/eventService';
import type { EventSummary } from '@/types';

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

/**
 * Subscribe to realtime changes for events shared to the user's spaces.
 *
 * Creates one Supabase Realtime channel per space the user belongs to,
 * filtered to that space's event_shares rows. Reconnects automatically
 * when the app returns to the foreground (AppState 'active').
 *
 * @param onInsert - Called when a new event is shared to a user's space
 * @param onUpdate - Called when a visible shared event's details change
 * @param onDelete - Called with eventId when an event is unshared
 * @returns Unsubscribe function — call on component unmount
 */
export function subscribeToSharedEvents(
  onInsert: (event: EventSummary) => void,
  onUpdate: (event: EventSummary) => void,
  onDelete: (eventId: string) => void,
): () => void {
  const channels: ReturnType<typeof supabase.channel>[] = [];
  let isActive = true;

  async function connect() {
    // Tear down existing channels before reconnecting
    for (const ch of [...channels]) {
      void supabase.removeChannel(ch);
    }
    channels.length = 0;

    const userId = await getCurrentUserId();
    if (!userId || !isActive) return;

    const { data: memberships } = await supa
      .from('space_members')
      .select('space_id')
      .eq('user_id', userId) as {
        data: Array<{ space_id: string }> | null;
        error: Error | null;
      };

    if (!memberships || memberships.length === 0) return;

    for (const { space_id } of memberships) {
      if (!isActive) break;

      // Build channel with three postgres_changes listeners.
      // supabase-js v2 types only expose two overloads for .on('postgres_changes')
      // before falling back to 'system' — cast to any for the third call.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ch = (supabase
        .channel(`space-events:${space_id}`)
        // New event shared to this space
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'event_shares', filter: `space_id=eq.${space_id}` },
          async (payload: { new: { event_id: string } }) => {
            try {
              const event = await getEventById(payload.new.event_id);
              onInsert({
                id:      event.id,
                title:   event.title,
                startAt: event.startAt,
                endAt:   event.endAt,
                allDay:  event.allDay,
                color:   event.color ?? memberEventColors[1],
                isOwn:   event.isOwn,
              });
            } catch {
              // Event might not be accessible yet — ignore
            }
          },
        )
        // Shared event details updated
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'event_shares', filter: `space_id=eq.${space_id}` },
          async (payload: { new: { event_id: string } }) => {
            try {
              const event = await getEventById(payload.new.event_id);
              onUpdate({
                id:      event.id,
                title:   event.title,
                startAt: event.startAt,
                endAt:   event.endAt,
                allDay:  event.allDay,
                color:   event.color ?? memberEventColors[1],
                isOwn:   event.isOwn,
              });
            } catch {
              // Ignore
            }
          },
        ) as any)
        // Event unshared from this space (cast above avoids TS2769 overload exhaustion)
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'event_shares', filter: `space_id=eq.${space_id}` },
          (payload: { old: { event_id: string } }) => {
            onDelete(payload.old.event_id);
          },
        )
        .subscribe() as ReturnType<typeof supabase.channel>;

      channels.push(ch);
    }
  }

  // Initial connection
  void connect();

  // Reconnect when app returns to foreground
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && isActive) {
      void connect();
    }
  });

  return () => {
    isActive = false;
    appStateSub.remove();
    for (const ch of [...channels]) {
      void supabase.removeChannel(ch);
    }
    channels.length = 0;
  };
}
