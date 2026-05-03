/**
 * Database row types — auto-derived from Supabase schema.
 *
 * These types represent the exact shape of DB rows.
 * Do NOT add business logic here; use domain types in event.ts / space.ts etc.
 *
 * Naming convention:
 *  - DbRow suffix: raw DB row (snake_case columns)
 *  - Insert suffix: omit auto-generated fields (id, created_at, updated_at)
 *  - Update suffix: all fields optional
 */

// ─── USERS ────────────────────────────────────────────────────────────────────

/** Raw DB row for the `users` table (mirrors auth.users + public profile). */
export interface UserRow {
  id: string;               // uuid, references auth.users(id)
  email: string | null;
  nickname: string;
  avatar_url: string | null;
  push_token: string | null;
  push_enabled: boolean;    // master switch for push notifications (005_push_tokens.sql)
  notification_settings: NotificationSettings;
  created_at: string;       // ISO-8601 timestamp
  updated_at: string;
}

/** JSON column shape for notification preferences. */
export interface NotificationSettings {
  event_reminders: boolean;
  partner_changes: boolean;
  space_invites: boolean;
  smart_reminders: boolean;
}

export type UserInsert = Omit<UserRow, 'created_at' | 'updated_at'>;
export type UserUpdate = Partial<Omit<UserRow, 'id' | 'created_at'>>;

// ─── SPACES ───────────────────────────────────────────────────────────────────

/** Space type: 'couple' limits membership to 2, 'group' allows N members. */
export type SpaceTypeDb = 'couple' | 'group';

/** Raw DB row for the `spaces` table. */
export interface SpaceRow {
  id: string;               // uuid
  name: string;
  type: SpaceTypeDb;
  invite_code: string;      // 6-char alphanumeric, unique
  cover_image_url: string | null;
  created_by: string;       // uuid, references users(id)
  created_at: string;
  updated_at: string;
  // IDEA-016: invite code lifecycle columns (022_invite_code_lifecycle.sql)
  /** Expiry timestamp for the invite code. NULL = never expires. */
  invite_code_expires_at: string | null;
  /** Maximum number of redemptions allowed. NULL = unlimited. */
  invite_code_max_uses: number | null;
  /** Number of successful redemptions of the current invite code. */
  invite_code_uses_count: number;
}

export type SpaceInsert = Omit<SpaceRow, 'id' | 'created_at' | 'updated_at'>;
export type SpaceUpdate = Partial<Omit<SpaceRow, 'id' | 'created_at' | 'created_by'>>;

// ─── SPACE_MEMBERS ────────────────────────────────────────────────────────────

export type SpaceMemberRoleDb = 'owner' | 'member';

/** Junction table: users ↔ spaces (N:M). */
export interface SpaceMemberRow {
  id: string;
  space_id: string;
  user_id: string;
  role: SpaceMemberRoleDb;
  color: string;            // hex color assigned to this member's events
  joined_at: string;
}

export type SpaceMemberInsert = Omit<SpaceMemberRow, 'id' | 'joined_at'>;

// ─── EVENTS ───────────────────────────────────────────────────────────────────

// 'custom_weekly' = 특정 요일들만 반복 (예: 월/수/금). 이때 events.repeat_weekdays
// 컬럼이 0..6 (일=0, 월=1, … 토=6) 의 부분집합을 보유. migration 024 참조.
export type RepeatTypeDb = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_weekly';
export type EventColorDb = string; // hex color

/** Raw DB row for the `events` table. Owned by a single user. */
export interface EventRow {
  id: string;               // uuid
  user_id: string;          // owner
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;         // ISO-8601
  end_at: string;           // ISO-8601
  all_day: boolean;
  repeat_type: RepeatTypeDb;
  /** 'custom_weekly' 일 때만 의미. 0=일, 1=월, … 6=토. */
  repeat_weekdays: number[] | null;
  repeat_until: string | null;
  category_id: string | null;
  color: EventColorDb | null;
  created_at: string;
  updated_at: string;
}

export type EventInsert = Omit<EventRow, 'id' | 'created_at' | 'updated_at'>;
export type EventUpdate = Partial<Omit<EventRow, 'id' | 'user_id' | 'created_at'>>;

// ─── EVENT_SHARES ─────────────────────────────────────────────────────────────

/** Maps an event to a space (one event can be shared to multiple spaces). */
export interface EventShareRow {
  id: string;
  event_id: string;
  space_id: string;
  shared_at: string;
}

export type EventShareInsert = Omit<EventShareRow, 'id' | 'shared_at'>;

// ─── TODOS ────────────────────────────────────────────────────────────────────

export type TodoPriorityDb = 'low' | 'medium' | 'high';

/** Raw DB row for the `todos` table. */
export interface TodoRow {
  id: string;
  user_id: string;
  space_id: string | null;  // null = private todo
  title: string;
  description: string | null;
  due_date: string | null;  // ISO-8601 date (시간 없을 때만 사용)
  /** Build-65 — 시간 포함 due_at (timestamptz). 있으면 우선 사용. */
  due_at: string | null;
  priority: TodoPriorityDb;
  is_completed: boolean;
  completed_at: string | null;
  category_id: string | null;
  /** 'todo' = regular todo item; 'note' = free-form note (ADR-003). */
  content_type: 'todo' | 'note';
  /** User-defined sort position within a category/list. */
  sort_order: number;
  /** Optional link to an event (for "related todos" on event detail screen). */
  event_id: string | null;
  created_at: string;
  updated_at: string;
}

export type TodoInsert = Omit<TodoRow, 'id' | 'created_at' | 'updated_at'>;
export type TodoUpdate = Partial<Omit<TodoRow, 'id' | 'user_id' | 'created_at'>>;

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

/** User-defined category for events and todos. */
export interface CategoryRow {
  id: string;
  /** null = system default category (개인/업무/기타); non-null = user-defined. */
  user_id: string | null;
  name: string;
  color: string;            // hex color
  icon: string | null;      // icon name (e.g. 'calendar', 'heart')
  created_at: string;
}

export type CategoryInsert = Omit<CategoryRow, 'id' | 'created_at'>;
export type CategoryUpdate = Partial<Omit<CategoryRow, 'id' | 'user_id' | 'created_at'>>;

// ─── EVENT_REACTIONS ──────────────────────────────────────────────────────────

/**
 * Emoji reaction on an event. One row per user per emoji per event.
 * UNIQUE(event_id, user_id, emoji) is enforced at the DB level.
 */
export interface EventReactionRow {
  id: string;
  event_id: string;
  user_id: string;
  /** Unicode emoji string: '❤️', '👍', '😄', '🎉', '😮', '😢' */
  emoji: string;
  created_at: string;
}

export type EventReactionInsert = Omit<EventReactionRow, 'id' | 'created_at'>;

// ─── EVENT_COMMENTS ───────────────────────────────────────────────────────────

/** Comment on an event. Content must be 1–500 characters (enforced by DB CHECK). */
export interface EventCommentRow {
  id: string;
  event_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export type EventCommentInsert = Omit<EventCommentRow, 'id' | 'created_at' | 'updated_at'>;
export type EventCommentUpdate = Pick<EventCommentRow, 'content'>;

// ─── ANNIVERSARIES ────────────────────────────────────────────────────────────

/** Anniversary / D-day entry. Linked to a space. */
export interface AnniversaryRow {
  id: string;
  space_id: string;
  title: string;
  date: string;             // ISO-8601 date
  repeat_yearly: boolean;
  created_by: string;
  created_at: string;
}

export type AnniversaryInsert = Omit<AnniversaryRow, 'id' | 'created_at'>;

// ─── NOTIFICATION_LOGS ────────────────────────────────────────────────────────

export type NotificationTypeDb = 'reminder' | 'invite' | 'share';

/** Tracks push notifications sent to users (prevents duplicate delivery). */
export interface NotificationLogRow {
  id: string;
  user_id: string;
  event_id: string | null;
  notification_type: NotificationTypeDb;
  sent_at: string;          // ISO-8601 timestamp
}

export type NotificationLogInsert = Omit<NotificationLogRow, 'id' | 'sent_at'>;

// ─── AI_CHAT_LOGS ─────────────────────────────────────────────────────────────

/** Stores NL parse requests and AI responses for context and debugging. */
export interface AiChatLogRow {
  id: string;
  user_id: string;
  input_text: string;
  parsed_result: Record<string, unknown>; // JSON
  model_used: 'local' | 'haiku' | 'sonnet';
  tokens_used: number | null;
  created_at: string;
}

export type AiChatLogInsert = Omit<AiChatLogRow, 'id' | 'created_at'>;

// ─── DATABASE SCHEMA (aggregate type for Supabase client generics) ────────────

/**
 * Used with createClient<Database>() to enable full type-safety.
 * Will be expanded as tables are finalized.
 */
export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: UserInsert;
        Update: UserUpdate;
      };
      spaces: {
        Row: SpaceRow;
        Insert: SpaceInsert;
        Update: SpaceUpdate;
      };
      space_members: {
        Row: SpaceMemberRow;
        Insert: SpaceMemberInsert;
        Update: Partial<SpaceMemberRow>;
      };
      events: {
        Row: EventRow;
        Insert: EventInsert;
        Update: EventUpdate;
      };
      event_shares: {
        Row: EventShareRow;
        Insert: EventShareInsert;
        Update: never;
      };
      todos: {
        Row: TodoRow;
        Insert: TodoInsert;
        Update: TodoUpdate;
      };
      categories: {
        Row: CategoryRow;
        Insert: CategoryInsert;
        Update: CategoryUpdate;
      };
      anniversaries: {
        Row: AnniversaryRow;
        Insert: AnniversaryInsert;
        Update: Partial<AnniversaryRow>;
      };
      ai_chat_logs: {
        Row: AiChatLogRow;
        Insert: AiChatLogInsert;
        Update: never;
      };
      notification_logs: {
        Row: NotificationLogRow;
        Insert: NotificationLogInsert;
        Update: never;
      };
      event_reactions: {
        Row: EventReactionRow;
        Insert: EventReactionInsert;
        Update: never;
      };
      event_comments: {
        Row: EventCommentRow;
        Insert: EventCommentInsert;
        Update: EventCommentUpdate;
      };
    };
  };
}
