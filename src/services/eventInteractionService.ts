/**
 * Event interaction service — emoji reactions and comments on events.
 *
 * Responsibilities:
 *  - Fetch and toggle emoji reactions (INSERT on first use, DELETE on toggle-off)
 *  - CRUD for event comments (add, update, delete — own comments only)
 *  - Realtime subscription for live reaction/comment updates
 *
 * Business rules:
 *  - UNIQUE(event_id, user_id, emoji): one row per user-emoji combination
 *  - Comment content: 1–500 characters (validated both here and in DB CHECK)
 *  - Only the comment author can update or delete their own comment (enforced by RLS)
 *  - Reactions/comments are visible to: the event owner + all space members who
 *    can see the event (RLS enforced at DB level — see migration 007_event_social.sql)
 *
 * Realtime:
 *  - Supabase Realtime channel per event ID
 *  - Returns an unsubscribe function for cleanup on component unmount
 *
 * NOTE: Uses `supabase as any` — same pattern as eventService.ts / spaceService.ts.
 *
 * TASK-503 (Sprint 5)
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import type {
  EventReaction, EventComment, ReactionEmoji, ReactionSummary,
  EventReactionRow, EventCommentRow,
} from '@/types';

// Workaround: supabase-js v2 Relationships type limitation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Allowed emojis ───────────────────────────────────────────────────────────

/** Ordered list of supported reaction emojis. Used for UI display order. */
export const REACTION_EMOJIS: ReactionEmoji[] = ['❤️', '👍', '😄', '🎉', '😮', '😢'];

// ─── Internal converters ──────────────────────────────────────────────────────

/**
 * Converts a raw DB reaction row to the domain EventReaction object.
 *
 * @param row - Raw row from event_reactions table
 * @returns EventReaction domain object
 */
function toReaction(row: EventReactionRow): EventReaction {
  return {
    id:        row.id,
    eventId:   row.event_id,
    userId:    row.user_id,
    emoji:     row.emoji as ReactionEmoji,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Converts a raw DB comment row (enriched with author data) to EventComment.
 *
 * @param row - Raw DB row, optionally joined with users table
 * @returns EventComment domain object
 */
function toComment(row: EventCommentRow & {
  users?: { nickname?: string; avatar_url?: string | null } | null;
}): EventComment {
  return {
    id:              row.id,
    eventId:         row.event_id,
    userId:          row.user_id,
    authorNickname:  row.users?.nickname ?? '알 수 없음',
    authorAvatarUrl: row.users?.avatar_url ?? null,
    content:         row.content,
    createdAt:       new Date(row.created_at),
    updatedAt:       new Date(row.updated_at),
  };
}

// ─── Reactions API ────────────────────────────────────────────────────────────

/**
 * Fetch all reactions for an event.
 *
 * @param eventId - UUID of the event
 * @returns Array of EventReaction objects (all users)
 */
export async function getReactions(eventId: string): Promise<EventReaction[]> {
  const { data, error } = await supa
    .from('event_reactions')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at') as { data: EventReactionRow[] | null; error: Error | null };

  if (error) throw error;
  return (data ?? []).map(toReaction);
}

/**
 * Aggregate reactions into per-emoji summaries for the reaction bar display.
 *
 * @param eventId - UUID of the event
 * @returns ReactionSummary[] in REACTION_EMOJIS display order (count > 0 only)
 */
export async function getReactionSummaries(eventId: string): Promise<ReactionSummary[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const reactions = await getReactions(eventId);

  // Aggregate counts and detect own reactions
  const summaryMap = new Map<ReactionEmoji, { count: number; isMyReaction: boolean }>();
  for (const r of reactions) {
    const prev = summaryMap.get(r.emoji) ?? { count: 0, isMyReaction: false };
    summaryMap.set(r.emoji, {
      count: prev.count + 1,
      isMyReaction: prev.isMyReaction || r.userId === userId,
    });
  }

  // Return in canonical display order, omit zero-count emojis
  return REACTION_EMOJIS
    .filter(e => summaryMap.has(e))
    .map(e => ({
      emoji: e,
      count: summaryMap.get(e)!.count,
      isMyReaction: summaryMap.get(e)!.isMyReaction,
    }));
}

/**
 * Toggle an emoji reaction for the current user on an event.
 * If a reaction with this emoji already exists, it is deleted (toggle-off).
 * Otherwise, a new reaction row is inserted (toggle-on).
 *
 * Uses UNIQUE(event_id, user_id, emoji) to prevent duplicate creation.
 *
 * @param eventId - UUID of the event
 * @param emoji   - Emoji to toggle
 */
export async function toggleReaction(eventId: string, emoji: ReactionEmoji): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Check if the reaction already exists
  const { data: existing } = await supa
    .from('event_reactions')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle() as { data: { id: string } | null; error: Error | null };

  if (existing) {
    // Toggle off: delete the existing reaction
    const { error } = await supa
      .from('event_reactions')
      .delete()
      .eq('id', existing.id) as { error: Error | null };

    if (error) throw error;
  } else {
    // Toggle on: insert a new reaction
    const { error } = await supa
      .from('event_reactions')
      .insert({ event_id: eventId, user_id: userId, emoji }) as { error: Error | null };

    if (error) throw error;
  }
}

// ─── Comments API ─────────────────────────────────────────────────────────────

/**
 * Fetch all comments for an event, including author nicknames.
 * Comments are sorted oldest-first for chat-style display.
 *
 * @param eventId - UUID of the event
 * @returns Array of EventComment objects, oldest first
 */
export async function getComments(eventId: string): Promise<EventComment[]> {
  // Fetch comments with author info via a join on users table.
  // supabase-js v2 join syntax uses select('*, users(nickname, avatar_url)').
  const { data, error } = await supa
    .from('event_comments')
    .select('*, users(nickname, avatar_url)')
    .eq('event_id', eventId)
    .order('created_at') as {
      data: Array<EventCommentRow & {
        users?: { nickname?: string; avatar_url?: string | null } | null;
      }> | null;
      error: Error | null;
    };

  if (error) throw error;
  return (data ?? []).map(toComment);
}

/**
 * Add a new comment to an event.
 * Content must be 1–500 characters; DB CHECK constraint enforces the upper bound.
 *
 * @param eventId - UUID of the event
 * @param content - Comment text (1–500 characters)
 * @returns The newly created EventComment
 * @throws If content length is outside allowed range or user is not authenticated
 */
export async function addComment(eventId: string, content: string): Promise<EventComment> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Client-side validation mirrors the DB CHECK constraint
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error('코멘트 내용을 입력해 주세요.');
  }
  if (trimmed.length > 500) {
    throw new Error('코멘트는 500자 이하로 입력해 주세요.');
  }

  const { data: row, error } = await supa
    .from('event_comments')
    .insert({ event_id: eventId, user_id: userId, content: trimmed })
    .select('*, users(nickname, avatar_url)')
    .single() as {
      data: (EventCommentRow & {
        users?: { nickname?: string; avatar_url?: string | null } | null;
      }) | null;
      error: Error | null;
    };

  if (error || !row) throw error ?? new Error('코멘트 작성에 실패했습니다.');
  return toComment(row);
}

/**
 * Update the content of an existing comment (author only — enforced by RLS).
 *
 * @param commentId - UUID of the comment to update
 * @param content   - New comment text (1–500 characters)
 * @returns The updated EventComment
 */
export async function updateComment(commentId: string, content: string): Promise<EventComment> {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error('코멘트 내용을 입력해 주세요.');
  }
  if (trimmed.length > 500) {
    throw new Error('코멘트는 500자 이하로 입력해 주세요.');
  }

  const { data: row, error } = await supa
    .from('event_comments')
    .update({ content: trimmed })
    .eq('id', commentId)
    .select('*, users(nickname, avatar_url)')
    .single() as {
      data: (EventCommentRow & {
        users?: { nickname?: string; avatar_url?: string | null } | null;
      }) | null;
      error: Error | null;
    };

  if (error || !row) throw error ?? new Error('코멘트 수정에 실패했습니다.');
  return toComment(row);
}

/**
 * Delete a comment permanently (author only — enforced by RLS).
 *
 * @param commentId - UUID of the comment to delete
 */
export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supa
    .from('event_comments')
    .delete()
    .eq('id', commentId) as { error: Error | null };

  if (error) throw error;
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to live reaction and comment changes for an event.
 * Sets up a single Supabase Realtime channel that listens to both tables.
 *
 * @param eventId        - UUID of the event to subscribe to
 * @param onReactionChange - Callback fired when any reaction changes for this event
 * @param onCommentChange  - Callback fired when any comment changes for this event
 * @returns Unsubscribe function — call on component unmount to clean up
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   const unsub = subscribeToEventInteractions(eventId, loadReactions, loadComments);
 *   return unsub;
 * }, [eventId]);
 * ```
 */
export function subscribeToEventInteractions(
  eventId: string,
  onReactionChange: () => void,
  onCommentChange: () => void,
): () => void {
  // Use a deterministic channel name per event to avoid duplicate channels
  const channelName = `event-interactions:${eventId}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channel = (supabase as any)
    .channel(channelName)
    // Listen to all INSERT/UPDATE/DELETE changes on event_reactions for this event
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_reactions',
        filter: `event_id=eq.${eventId}`,
      },
      () => { onReactionChange(); },
    )
    // Listen to all INSERT/UPDATE/DELETE changes on event_comments for this event
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_comments',
        filter: `event_id=eq.${eventId}`,
      },
      () => { onCommentChange(); },
    )
    .subscribe();

  // Return cleanup function for useEffect
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any).removeChannel(channel);
  };
}
