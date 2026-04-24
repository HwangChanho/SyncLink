/**
 * Event service — CRUD operations on the `events` table.
 *
 * Responsibilities:
 *  - Fetch events in a date range (own + shared via event_shares)
 *  - Fetch a single event by ID
 *  - Create, update, and delete events
 *
 * RLS guarantees:
 *  - Users can only INSERT/UPDATE/DELETE their own events
 *  - Users can SELECT events shared to their spaces via event_shares
 *
 * Related services:
 *  - eventShareService.ts  — share/unshare an event to a space
 *  - eventRealtimeService.ts — Supabase Realtime subscription
 *  - freeTimeService.ts    — free-time slot finder
 *
 * NOTE: Uses `supabase as any` workaround for supabase-js v2 Relationships
 * type limitation — same pattern as spaceService.ts.
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { memberEventColors } from '@/constants/colors';
import { shareEventToSpace, unshareEventFromSpace } from '@/services/eventShareService';
import { cancelEventReminders } from '@/services/notificationService';
import type {
  Event, EventSummary, CreateEventInput, UpdateEventInput,
  EventRow, DateRange,
} from '@/types';

// Re-export for backward compatibility (canonical source: @/types)
export type { DateRange };

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Converts an EventRow to an EventSummary for calendar rendering. */
function toEventSummary(row: EventRow, isOwn: boolean, color: string): EventSummary {
  return {
    id:     row.id,
    title:  row.title,
    startAt: new Date(row.start_at),
    endAt:   new Date(row.end_at),
    allDay:  row.all_day,
    color:   row.color ?? color,
    isOwn,
  };
}

/** Converts an EventRow + enriched data to a full Event domain object. */
function toEvent(
  row: EventRow,
  sharedSpaceIds: string[],
  ownerNickname: string,
  isOwn: boolean,
): Event {
  return {
    id:           row.id,
    userId:       row.user_id,
    title:        row.title,
    description:  row.description,
    location:     row.location,
    startAt:      new Date(row.start_at),
    endAt:        new Date(row.end_at),
    allDay:       row.all_day,
    repeatType:   row.repeat_type,
    repeatUntil:  row.repeat_until ? new Date(row.repeat_until) : null,
    categoryId:   row.category_id,
    color:        row.color,
    sharedSpaceIds,
    ownerNickname,
    isOwn,
    createdAt:    new Date(row.created_at),
    updatedAt:    new Date(row.updated_at),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all events visible to the current user within a date range.
 *
 * Strategy:
 *  1. Fetch the user's own events in range.
 *  2. Get the user's space memberships (to know which shared events to include).
 *  3. Fetch event_shares for those spaces, then fetch the actual events.
 *  4. Merge own + shared, sort by startAt.
 *
 * Color assignment:
 *  - Own events: event.color or memberEventColors[0] (violet)
 *  - Shared events: event owner's space_members.color, fallback memberEventColors[1] (rose)
 *
 * @param range - Inclusive start and end dates
 * @returns EventSummary[] sorted by startAt
 */
export async function getEventsInRange(range: DateRange): Promise<EventSummary[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const startIso = range.start.toISOString();
  const endIso   = range.end.toISOString();

  // ─── 1. Own events in range ─────────────────────────────────────────────
  const { data: ownRows, error: ownError } = await supa
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .lte('start_at', endIso)
    .gte('end_at', startIso)
    .order('start_at') as { data: EventRow[] | null; error: Error | null };

  if (ownError) throw ownError;

  const ownSummaries: EventSummary[] = (ownRows ?? []).map(row =>
    toEventSummary(row, true, memberEventColors[0]),
  );
  const ownEventIds = new Set(ownSummaries.map(e => e.id));

  // ─── 2. Space memberships ──────────────────────────────────────────────
  const { data: myMemberships, error: memberError } = await supa
    .from('space_members')
    .select('space_id, color')
    .eq('user_id', userId) as {
      data: Array<{ space_id: string; color: string }> | null;
      error: Error | null;
    };

  if (memberError) throw memberError;

  const mySpaceIds = (myMemberships ?? []).map(m => m.space_id);
  if (mySpaceIds.length === 0) return ownSummaries;

  // ─── 3. Event IDs shared to my spaces ─────────────────────────────────
  const { data: sharedRefs, error: shareError } = await supa
    .from('event_shares')
    .select('event_id')
    .in('space_id', mySpaceIds) as {
      data: Array<{ event_id: string }> | null;
      error: Error | null;
    };

  if (shareError) throw shareError;

  // Deduplicate and exclude own events
  const sharedEventIds = [
    ...new Set((sharedRefs ?? []).map(r => r.event_id).filter(id => !ownEventIds.has(id))),
  ];

  if (sharedEventIds.length === 0) return ownSummaries;

  // ─── 4. Fetch shared events within range ──────────────────────────────
  const { data: sharedRows, error: sharedError } = await supa
    .from('events')
    .select('*')
    .in('id', sharedEventIds)
    .lte('start_at', endIso)
    .gte('end_at', startIso)
    .order('start_at') as { data: EventRow[] | null; error: Error | null };

  if (sharedError) throw sharedError;

  if (!sharedRows || sharedRows.length === 0) return ownSummaries;

  // ─── 5. Resolve member colors for event owners ─────────────────────────
  const ownerIds = [...new Set(sharedRows.map(r => r.user_id))];
  const { data: ownerMemberships } = await supa
    .from('space_members')
    .select('user_id, color')
    .in('user_id', ownerIds)
    .in('space_id', mySpaceIds) as {
      data: Array<{ user_id: string; color: string }> | null;
      error: Error | null;
    };

  // user_id → color map (first found membership wins)
  const ownerColorMap = new Map<string, string>();
  for (const m of ownerMemberships ?? []) {
    if (!ownerColorMap.has(m.user_id)) {
      ownerColorMap.set(m.user_id, m.color);
    }
  }

  const sharedSummaries: EventSummary[] = sharedRows.map(row =>
    toEventSummary(
      row,
      false,
      ownerColorMap.get(row.user_id) ?? memberEventColors[1],
    ),
  );

  // ─── 6. Merge and sort ─────────────────────────────────────────────────
  return [...ownSummaries, ...sharedSummaries].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
}

/**
 * Fetch full event details by ID.
 * Populates sharedSpaceIds and ownerNickname via supplementary queries.
 *
 * @param eventId - UUID of the event
 * @returns Full Event object
 * @throws If event not found or user has no access
 */
export async function getEventById(eventId: string): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Fetch event row
  const { data: row, error } = await supa
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single() as { data: EventRow | null; error: Error | null };

  if (error || !row) throw new Error('일정을 찾을 수 없습니다.');

  // Fetch space IDs this event is shared to
  const { data: shares } = await supa
    .from('event_shares')
    .select('space_id')
    .eq('event_id', eventId) as {
      data: Array<{ space_id: string }> | null;
      error: Error | null;
    };

  // Fetch owner's nickname
  const { data: ownerRow } = await supa
    .from('users')
    .select('nickname')
    .eq('id', row.user_id)
    .single() as { data: { nickname: string } | null; error: Error | null };

  return toEvent(
    row,
    (shares ?? []).map(s => s.space_id),
    ownerRow?.nickname ?? '알 수 없음',
    row.user_id === userId,
  );
}

/**
 * Create a new event. Optionally share it to one or more spaces immediately.
 *
 * After INSERT, fetches the full Event (with sharedSpaceIds and ownerNickname)
 * via getEventById to guarantee a consistent return type.
 *
 * @param input - Event creation payload
 * @returns Newly created Event
 */
export async function createEvent(input: CreateEventInput): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: row, error } = await supa
    .from('events')
    .insert({
      user_id:      userId,
      title:        input.title,
      description:  input.description ?? null,
      location:     input.location ?? null,
      start_at:     input.startAt.toISOString(),
      end_at:       input.endAt.toISOString(),
      all_day:      input.allDay ?? false,
      repeat_type:  input.repeatType ?? 'none',
      repeat_until: input.repeatUntil?.toISOString() ?? null,
      category_id:  input.categoryId ?? null,
      color:        input.color ?? null,
    })
    .select()
    .single() as { data: EventRow | null; error: Error | null };

  if (error || !row) throw error ?? new Error('일정 생성에 실패했습니다.');

  // Share to requested spaces (in parallel for speed)
  if (input.shareToSpaceIds && input.shareToSpaceIds.length > 0) {
    await Promise.all(
      input.shareToSpaceIds.map(spaceId => shareEventToSpace(row.id, spaceId)),
    );
  }

  const event = await getEventById(row.id);

  // NOTE: Reminder scheduling is now handled by reminderService (TASK-1304).
  // The caller (create.tsx / edit screen) is responsible for calling
  // reminderService.updateReminders() after createEvent() returns.

  return event;
}

/**
 * Update an existing event (owner only — enforced by RLS).
 *
 * Builds a partial patch object from non-undefined fields only to avoid
 * accidentally overwriting fields that weren't included in the update payload.
 *
 * @param eventId - UUID of the event to update
 * @param updates - Fields to change
 * @returns Updated Event
 */
export async function updateEvent(eventId: string, updates: UpdateEventInput): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Build patch with only the provided fields
  const patch: Record<string, unknown> = {};
  if (updates.title       !== undefined) patch.title        = updates.title;
  if (updates.description !== undefined) patch.description  = updates.description || null;
  if (updates.location    !== undefined) patch.location     = updates.location || null;
  if (updates.startAt     !== undefined) patch.start_at     = updates.startAt.toISOString();
  if (updates.endAt       !== undefined) patch.end_at       = updates.endAt.toISOString();
  if (updates.allDay      !== undefined) patch.all_day      = updates.allDay;
  if (updates.repeatType  !== undefined) patch.repeat_type  = updates.repeatType;
  if (updates.repeatUntil !== undefined) patch.repeat_until = updates.repeatUntil?.toISOString() ?? null;
  if (updates.categoryId  !== undefined) patch.category_id  = updates.categoryId ?? null;
  if (updates.color       !== undefined) patch.color        = updates.color ?? null;

  if (Object.keys(patch).length > 0) {
    const { error } = await supa
      .from('events')
      .update(patch)
      .eq('id', eventId)
      .eq('user_id', userId) as { error: Error | null };

    if (error) throw error;
  }

  // Apply space sharing changes if specified
  if (updates.shareToSpaceIds !== undefined) {
    const current = await getEventById(eventId);
    const toAdd    = updates.shareToSpaceIds.filter(id => !current.sharedSpaceIds.includes(id));
    const toRemove = current.sharedSpaceIds.filter(id => !updates.shareToSpaceIds!.includes(id));
    await Promise.all([
      ...toAdd.map(id    => shareEventToSpace(eventId, id)),
      ...toRemove.map(id => unshareEventFromSpace(eventId, id)),
    ]);
  }

  const updatedEvent = await getEventById(eventId);

  // NOTE: Reminder rescheduling is now handled by reminderService (TASK-1304).
  // The edit screen calls reminderService.updateReminders() on save.
  // cancelEventReminders is still called here only if startAt changed, to
  // prevent stale local notifications from a previous state.
  if (updates.startAt !== undefined) {
    void cancelEventReminders(eventId);
  }

  return updatedEvent;
}

/**
 * Delete an event permanently (owner only — enforced by RLS).
 * Cascade-deletes all event_shares rows in the DB.
 *
 * @param eventId - UUID of the event to delete
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { error } = await supa
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('user_id', userId) as { error: Error | null };

  if (error) throw error;
}
