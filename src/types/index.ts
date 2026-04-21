/**
 * Public type surface for the SyncDay app.
 *
 * Import types from here: import type { Event, Space } from '@/types'
 * Do NOT import directly from sub-files in components/screens.
 */

// Database row types (for service layer only)
export type {
  Database,
  UserRow, UserInsert, UserUpdate,
  SpaceRow, SpaceInsert, SpaceUpdate,
  SpaceTypeDb, SpaceMemberRoleDb, SpaceMemberRow,
  EventRow, EventInsert, EventUpdate,
  EventShareRow, EventShareInsert,
  TodoRow, TodoInsert, TodoUpdate, TodoPriorityDb,
  CategoryRow, CategoryInsert, CategoryUpdate,
  AnniversaryRow, AnniversaryInsert,
  AiChatLogRow, AiChatLogInsert,
  NotificationLogRow, NotificationLogInsert, NotificationTypeDb,
  RepeatTypeDb, NotificationSettings,
  EventReactionRow, EventReactionInsert,
  EventCommentRow, EventCommentInsert, EventCommentUpdate,
} from './database';

// Event domain types
export type {
  Event, EventSummary, CreateEventInput, UpdateEventInput,
  RepeatType, BuiltinCategory, FreeTimeSlot,
  DateRange,
  EventReaction, EventComment, ReactionEmoji, ReactionSummary,
} from './event';

// Space domain types
export type {
  Space, SpaceSummary, SpaceMember, SpaceType, SpaceMemberRole,
  CreateSpaceInput, UpdateSpaceInput,
  Anniversary, CreateAnniversaryInput,
} from './space';

// Todo domain types
export type {
  Todo, TodoSummary, CreateTodoInput, UpdateTodoInput,
  TodoPriority, ContentType, TodoFilter, NoteFilter,
  Note, CreateNoteInput, UpdateNoteInput,
} from './todo';

// Category domain types
export type {
  Category, CreateCategoryInput, UpdateCategoryInput,
} from './category';

// AI types
export type {
  Confidence, ParsedField, ParsedEventFields,
  NLParseResult, AiParseRequest, AiParseResponse,
  AiUsageRecord, SmartReminderMessage,
} from './ai';
