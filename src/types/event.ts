/**
 * Event domain types.
 *
 * These are the "application layer" types used in components and stores.
 * They differ from DbRow types: camelCase fields, enriched with relations.
 */

import type { RepeatTypeDb } from './database';

// ─── Enums ────────────────────────────────────────────────────────────────────

/** How an event repeats. Maps 1:1 to DB enum. */
export type RepeatType = RepeatTypeDb;

/** Built-in event category types (user can also create custom categories). */
export type BuiltinCategory =
  | 'personal'
  | 'work'
  | 'date'          // couple-specific
  | 'family'
  | 'health'
  | 'social'
  | 'travel'
  | 'holiday'
  | 'other';

// ─── Core domain type ─────────────────────────────────────────────────────────

/** Full event object used in UI and stores (camelCase, enriched). */
export interface Event {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  repeatType: RepeatType;
  /** 'custom_weekly' 일 때만 사용. 0=일, 1=월, … 6=토 (JS Date.getDay() 호환). */
  repeatWeekdays: number[] | null;
  repeatUntil: Date | null;
  categoryId: string | null;
  /** Hex color for display. Falls back to user's space member color if null. */
  color: string | null;
  /** IDs of spaces this event is shared to. */
  sharedSpaceIds: string[];
  /** Owner's display name (populated from join). */
  ownerNickname: string;
  /** True if the current user owns this event. */
  isOwn: boolean;
  /**
   * Build-96 — true 이면 share 받은 space 의 멤버도 UPDATE 가능 (drag-to-
   * reschedule, edit). owner 가 등록 폼에서 토글로 결정. default false.
   */
  editableByMembers: boolean;
  /** v1.1 — 'workout' 이면 body-parts UI 와 💪 prefix 활성. */
  eventKind: 'general' | 'workout';
  /** v1.1 — 'workout' kind 일 때 사용자가 기록한 운동 부위. */
  workoutParts: ('chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core' | 'cardio')[];
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal event summary used in calendar grid cells. */
export interface EventSummary {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  color: string;
  isOwn: boolean;
  /**
   * Category bucket this event belongs to. null/undefined = uncategorised.
   * Included so the calendar can dim events whose category the user
   * has toggled off in the category filter chip.
   */
  categoryId?: string | null;
  /**
   * Build-94 — 공유 받은 (isOwn=false) 이벤트의 등록자 닉네임. 캘린더
   * 셀에 누가 등록했는지 prefix 로 표시. own event 는 undefined.
   */
  ownerNickname?: string;
  /**
   * Build-96 — owner 가 "편집 허용" 토글한 경우 true. 클라가 멤버일 때
   * drag-to-reschedule 가드 우회 조건.
   */
  editableByMembers?: boolean;
  /** v1.1 — 'workout' 이면 캘린더 셀에 💪 prefix 표시. default 'general'. */
  eventKind?: 'general' | 'workout';
}

/** Payload when creating a new event (omit server-generated fields). */
export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  startAt: Date;
  endAt: Date;
  allDay?: boolean;
  repeatType?: RepeatType;
  /** repeatType === 'custom_weekly' 일 때 필수. 0..6 부분집합. */
  repeatWeekdays?: number[];
  repeatUntil?: Date;
  categoryId?: string;
  /**
   * Hex color override for this event.
   * null = clear the override (fall back to category/member color).
   * undefined = do not touch the existing color value (patch semantics).
   */
  color?: string | null;
  /** Space IDs to share this event to immediately upon creation. */
  shareToSpaceIds?: string[];
  /**
   * Build-96 — true 면 share 받은 space 의 멤버도 reschedule/edit 가능.
   * default false (owner-only). update 시 undefined 면 기존 값 유지.
   */
  editableByMembers?: boolean;
  /** v1.1 — 운동 일정 모드. 기본 'general'. */
  eventKind?: 'general' | 'workout';
  /** v1.1 — eventKind === 'workout' 일 때 사용자가 선택한 부위 코드 배열.
   *  general 모드면 무시. saveParts 가 멱등이므로 update 시 항상 새 배열로
   *  교체 (기존 row 모두 삭제 후 insert). */
  workoutParts?: ('chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core' | 'cardio')[];
}

/** Payload when updating an event. */
export type UpdateEventInput = Partial<CreateEventInput>;

// ─── Event interaction types (TASK-503) ──────────────────────────────────────

/**
 * Supported emoji reactions on events.
 * Limited to a curated set so the reaction bar stays compact.
 */
export type ReactionEmoji = '❤️' | '👍' | '😄' | '🎉' | '😮' | '😢';

/** An emoji reaction left by a user on an event. */
export interface EventReaction {
  id: string;
  eventId: string;
  userId: string;
  emoji: ReactionEmoji;
  createdAt: Date;
}

/** Aggregated reaction counts per emoji, with current-user indicator. */
export interface ReactionSummary {
  emoji: ReactionEmoji;
  /** Total count of this emoji across all users. */
  count: number;
  /** True if the current user has reacted with this emoji. */
  isMyReaction: boolean;
}

/** A comment left by a user on an event. */
export interface EventComment {
  id: string;
  eventId: string;
  userId: string;
  /** Author's display name (populated via join). */
  authorNickname: string;
  /** Author's avatar URL (may be null). */
  authorAvatarUrl: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Date range ───────────────────────────────────────────────────────────────

/**
 * Inclusive date range used across eventService, freeTimeService, and eventStore.
 * Promoted from eventService.ts (ADR decision: shared domain type → @/types).
 */
export interface DateRange {
  start: Date;
  end: Date;
}

// ─── Time slot (free-time finder) ────────────────────────────────────────────

/** A contiguous free window in a calendar, shared across participants. */
export interface FreeTimeSlot {
  startAt: Date;
  endAt: Date;
  /** Duration in minutes. */
  durationMinutes: number;
  /** User IDs who are all free during this window. */
  participantIds: string[];
}
