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
export type UserRow = {
  id: string;               // uuid, references auth.users(id)
  email: string | null;
  nickname: string;
  avatar_url: string | null;
  push_token: string | null;
  push_enabled: boolean;    // master switch for push notifications (005_push_tokens.sql)
  notification_settings: NotificationSettings;
  /** v1.2.0 — ISO 3166-1 alpha-2. 캘린더 공휴일/지역 포맷에 사용. default 'KR'. */
  country_code: string;
  /** v1.2.3 — 새 일정 생성 시 자동 적용할 기본 리마인더 분 단위 배열. default [10]. */
  default_reminder_minutes: number[];
  created_at: string;       // ISO-8601 timestamp
  updated_at: string;
};

/** JSON column shape for notification preferences. */
export type NotificationSettings = {
  event_reminders: boolean;
  partner_changes: boolean;
  space_invites: boolean;
  smart_reminders: boolean;
};

export type UserInsert = Omit<UserRow, 'created_at' | 'updated_at'>;
export type UserUpdate = Partial<Omit<UserRow, 'id' | 'created_at'>>;

// ─── SPACES ───────────────────────────────────────────────────────────────────

/** Space type: 'couple' limits membership to 2, 'group' allows N members. */
export type SpaceTypeDb = 'couple' | 'group';

/** Raw DB row for the `spaces` table. */
export type SpaceRow = {
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
};

export type SpaceInsert = Omit<SpaceRow, 'id' | 'created_at' | 'updated_at'>;
export type SpaceUpdate = Partial<Omit<SpaceRow, 'id' | 'created_at' | 'created_by'>>;

// ─── SPACE_MEMBERS ────────────────────────────────────────────────────────────

export type SpaceMemberRoleDb = 'owner' | 'member';

/** Junction table: users ↔ spaces (N:M). */
export type SpaceMemberRow = {
  id: string;
  space_id: string;
  user_id: string;
  role: SpaceMemberRoleDb;
  color: string;            // hex color assigned to this member's events
  joined_at: string;
  /**
   * v1.2.1 — 채팅 화면 진입 시 now() 로 갱신. unread badge 계산의 기준점.
   * DB default now() 라 INSERT 시에는 넘기지 않는다.
   */
  last_read_at: string;
  /** v1.2.1 — 이 Space 의 채팅 알림 수신 여부. DB default true 라 INSERT 시 생략. */
  notifications_enabled: boolean;
};

/**
 * INSERT 페이로드 — DB 가 기본값을 채워 주는 컬럼은 optional 로 둔다.
 * (last_read_at=now() / notifications_enabled=true)
 */
export type SpaceMemberInsert =
  Omit<SpaceMemberRow, 'id' | 'joined_at' | 'last_read_at' | 'notifications_enabled'>
  & Partial<Pick<SpaceMemberRow, 'last_read_at' | 'notifications_enabled'>>;

// ─── EVENTS ───────────────────────────────────────────────────────────────────

// 'custom_weekly' = 특정 요일들만 반복 (예: 월/수/금). 이때 events.repeat_weekdays
// 컬럼이 0..6 (일=0, 월=1, … 토=6) 의 부분집합을 보유. migration 024 참조.
export type RepeatTypeDb = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_weekly';
export type EventColorDb = string; // hex color

/** v1.1 — discriminator for the new workout event UX flow. */
export type EventKindDb = 'general' | 'workout' | 'running';

/** Anatomy buckets used by the body-silhouette picker. Matches the
 *  `workout_part` enum in migration 037. */
export type WorkoutPartDb =
  | 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core' | 'cardio'
  // v1.1.2 — 세분화: 어깨 사이 승모, 하체를 허벅지·종아리로 분리.
  // `legs` 는 backwards-compat 으로 enum 에 유지 (옛 데이터 표시용),
  // 신규 UI 는 thighs/calves 로 분리 저장.
  | 'trapezius' | 'thighs' | 'calves';

/** Raw DB row for the `event_workout_parts` join table. */
export type EventWorkoutPartRow = {
  event_id: string;
  part:     WorkoutPartDb;
};

/** Raw DB row for the `events` table. Owned by a single user. */
export type EventRow = {
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
  /** Build-96 — true: share 받은 멤버도 UPDATE 가능. default false. */
  editable_by_members: boolean;
  /** v1.1 — 'workout' = 헬스, 'running' = 러닝, 'general' = 기본. */
  event_kind: EventKindDb;
  /** v1.1.2 — running 일 때 사용자가 기록한 거리 (km). nullable. */
  distance_km: number | null;
  /** v1.1.2 — running 일 때 평균 페이스를 초 단위로 저장 (분/km 계산용). nullable. */
  avg_pace_seconds: number | null;
  /** v1.3 — 상대일 일정: 기준일 (발급일/주문일). ISO date 'YYYY-MM-DD'. NULL = 일반 일정. */
  base_date: string | null;
  /** v1.3 — 기준일로부터 +N일. start_at 은 (base_date + offset_days) 로 미리 계산해 저장. */
  offset_days: number | null;
  /** v1.3 — D-day 표시용 라벨 ("도착예상"/"수령"/"만료" 등). */
  offset_label: string | null;
  created_at: string;
  updated_at: string;
};

export type EventInsert = Omit<EventRow, 'id' | 'created_at' | 'updated_at'>;
export type EventUpdate = Partial<Omit<EventRow, 'id' | 'user_id' | 'created_at'>>;

// ─── EVENT_SHARES ─────────────────────────────────────────────────────────────

/** Maps an event to a space (one event can be shared to multiple spaces). */
export type EventShareRow = {
  id: string;
  event_id: string;
  space_id: string;
  shared_at: string;
};

export type EventShareInsert = Omit<EventShareRow, 'id' | 'shared_at'>;

// ─── TODOS ────────────────────────────────────────────────────────────────────

export type TodoPriorityDb = 'low' | 'medium' | 'high';

/** Raw DB row for the `todos` table. */
export type TodoRow = {
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
};

export type TodoInsert = Omit<TodoRow, 'id' | 'created_at' | 'updated_at'>;
export type TodoUpdate = Partial<Omit<TodoRow, 'id' | 'user_id' | 'created_at'>>;

// ─── TODO ATTACHMENTS ─────────────────────────────────────────────────────────

/** Attachment kind: photo or voice memo. */
export type TodoAttachmentKindDb = 'photo' | 'voice';

/** Raw DB row for `todo_attachments`. Owned by single user; cascade on todo delete. */
export type TodoAttachmentRow = {
  id:           string;
  todo_id:      string;
  user_id:      string;
  kind:         TodoAttachmentKindDb;
  storage_path: string;
  duration_ms:  number | null;
  width:        number | null;
  height:       number | null;
  size_bytes:   number | null;
  created_at:   string;
};

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

/** User-defined category for events and todos. */
export type CategoryRow = {
  id: string;
  /** null = system default category (개인/업무/기타); non-null = user-defined. */
  user_id: string | null;
  name: string;
  color: string;            // hex color
  icon: string | null;      // icon name (e.g. 'calendar', 'heart')
  created_at: string;
};

export type CategoryInsert = Omit<CategoryRow, 'id' | 'created_at'>;
export type CategoryUpdate = Partial<Omit<CategoryRow, 'id' | 'user_id' | 'created_at'>>;

// ─── EVENT_REACTIONS ──────────────────────────────────────────────────────────

/**
 * Emoji reaction on an event. One row per user per emoji per event.
 * UNIQUE(event_id, user_id, emoji) is enforced at the DB level.
 */
export type EventReactionRow = {
  id: string;
  event_id: string;
  user_id: string;
  /** Unicode emoji string: '❤️', '👍', '😄', '🎉', '😮', '😢' */
  emoji: string;
  created_at: string;
};

export type EventReactionInsert = Omit<EventReactionRow, 'id' | 'created_at'>;

// ─── EVENT_COMMENTS ───────────────────────────────────────────────────────────

/** Comment on an event. Content must be 1–500 characters (enforced by DB CHECK). */
export type EventCommentRow = {
  id: string;
  event_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type EventCommentInsert = Omit<EventCommentRow, 'id' | 'created_at' | 'updated_at'>;
export type EventCommentUpdate = Pick<EventCommentRow, 'content'>;

// ─── ANNIVERSARIES ────────────────────────────────────────────────────────────

/** Anniversary / D-day entry. Linked to a space. */
export type AnniversaryRow = {
  id: string;
  space_id: string;
  title: string;
  date: string;             // ISO-8601 date
  repeat_yearly: boolean;
  created_by: string;
  created_at: string;
};

export type AnniversaryInsert = Omit<AnniversaryRow, 'id' | 'created_at'>;

// ─── NOTIFICATION_LOGS ────────────────────────────────────────────────────────

export type NotificationTypeDb = 'reminder' | 'invite' | 'share';

/** Tracks push notifications sent to users (prevents duplicate delivery). */
export type NotificationLogRow = {
  id: string;
  user_id: string;
  event_id: string | null;
  notification_type: NotificationTypeDb;
  sent_at: string;          // ISO-8601 timestamp
};

export type NotificationLogInsert = Omit<NotificationLogRow, 'id' | 'sent_at'>;

// ─── AI_CHAT_LOGS ─────────────────────────────────────────────────────────────

/** Stores NL parse requests and AI responses for context and debugging. */
export type AiChatLogRow = {
  id: string;
  user_id: string;
  input_text: string;
  parsed_result: Record<string, unknown>; // JSON
  model_used: 'local' | 'haiku' | 'sonnet';
  tokens_used: number | null;
  created_at: string;
};

export type AiChatLogInsert = Omit<AiChatLogRow, 'id' | 'created_at'>;

// ─── EVENT IMAGES ─────────────────────────────────────────────────────────────

/** Raw DB row for `event_images` (migration 041). 일정당 최대 5장. */
export type EventImageRow = {
  id:         string;
  event_id:   string;
  url:        string;
  /** 0-based 표시 순서. (event_id, position) 이 UNIQUE 라 upsert 키로 쓰인다. */
  position:   number;
  created_at: string;
};

/** `id`/`created_at`/`position` 은 DB 기본값이 있어 생략 가능하다. */
export type EventImageInsert =
  Pick<EventImageRow, 'event_id' | 'url'>
  & Partial<Pick<EventImageRow, 'id' | 'position' | 'created_at'>>;

// ─── SPACE MESSAGES ───────────────────────────────────────────────────────────

/**
 * Raw DB row for `space_messages` (migration 043 + `tags` 컬럼).
 * CHECK 제약: `body` 와 `image_url` 중 최소 하나는 NOT NULL 이어야 한다.
 */
export type SpaceMessageRow = {
  id:         string;
  space_id:   string;
  sender_id:  string;
  body:       string | null;
  image_url:  string | null;
  /** v1.2.1 — AI 자동 태그 1–3개(한국어). null = 미분석. */
  tags:       string[] | null;
  created_at: string;
};

/**
 * `id` 는 보통 DB 가 생성하지만, 이미지 메시지는 Storage 경로를 먼저 만들려고
 * 클라이언트가 UUID 를 미리 정해 넘긴다 → optional 로 둔다.
 */
export type SpaceMessageInsert =
  Pick<SpaceMessageRow, 'space_id' | 'sender_id'>
  & Partial<Pick<SpaceMessageRow, 'id' | 'body' | 'image_url' | 'tags' | 'created_at'>>;

// ─── FUNNEL EVENTS (073) ──────────────────────────────────────────────────────

/**
 * Raw DB row for `funnel_events` — 이탈 지점 기록.
 *
 * 🔴 `interface` 가 아니라 `type` 이어야 한다. interface 는 암묵적 인덱스 시그니처를
 *    못 받아서 Supabase 타입 클라이언트 전체가 `never` 로 죽는다(2026-08-26 사례).
 */
export type FunnelEventRow = {
  /** bigint identity — append-only 로그라 시간순으로 증가한다. */
  id: number;
  /** 로그인 전 단계는 null. */
  user_id: string | null;
  /** 기기 로컬 난수. 로그인 전/후를 잇는 유일한 연결고리. */
  anon_id: string;
  /** FunnelStep union 값 (DB 는 자유 text, 통제는 funnelService 에서). */
  step: string;
  platform: string | null;
  app_version: string | null;
  created_at: string;
};

/** id 와 created_at 은 DB 가 채운다. */
export type FunnelEventInsert = Omit<FunnelEventRow, 'id' | 'created_at'>;

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
        Relationships: [];
      };
      spaces: {
        Row: SpaceRow;
        Insert: SpaceInsert;
        Update: SpaceUpdate;
        Relationships: [];
      };
      space_members: {
        Row: SpaceMemberRow;
        Insert: SpaceMemberInsert;
        Update: Partial<SpaceMemberRow>;
        Relationships: [];
      };
      events: {
        Row: EventRow;
        Insert: EventInsert;
        Update: EventUpdate;
        Relationships: [];
      };
      event_shares: {
        Row: EventShareRow;
        Insert: EventShareInsert;
        Update: never;
        Relationships: [];
      };
      todos: {
        Row: TodoRow;
        Insert: TodoInsert;
        Update: TodoUpdate;
        Relationships: [];
      };
      categories: {
        Row: CategoryRow;
        Insert: CategoryInsert;
        Update: CategoryUpdate;
        Relationships: [];
      };
      anniversaries: {
        Row: AnniversaryRow;
        Insert: AnniversaryInsert;
        Update: Partial<AnniversaryRow>;
        Relationships: [];
      };
      ai_chat_logs: {
        Row: AiChatLogRow;
        Insert: AiChatLogInsert;
        Update: never;
        Relationships: [];
      };
      notification_logs: {
        Row: NotificationLogRow;
        Insert: NotificationLogInsert;
        Update: never;
        Relationships: [];
      };
      event_reactions: {
        Row: EventReactionRow;
        Insert: EventReactionInsert;
        Update: never;
        Relationships: [];
      };
      event_comments: {
        Row: EventCommentRow;
        Insert: EventCommentInsert;
        Update: EventCommentUpdate;
        Relationships: [];
      };
      event_images: {
        Row: EventImageRow;
        Insert: EventImageInsert;
        // upsert(onConflict: 'event_id,position') 로 url 만 갱신한다.
        Update: Partial<EventImageRow>;
        Relationships: [];
      };
      space_messages: {
        Row: SpaceMessageRow;
        Insert: SpaceMessageInsert;
        // 전송된 메시지는 수정하지 않는다 — tags 는 Edge Function 이 채운다.
        Update: Partial<Pick<SpaceMessageRow, 'tags'>>;
        Relationships: [];
      };
      funnel_events: {
        Row: FunnelEventRow;
        Insert: FunnelEventInsert;
        // append-only 로그다. 남긴 기록은 고치지 않는다.
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
