/**
 * Todo / Planner domain types.
 *
 * Todos can be personal (spaceId = null) or shared within a space.
 * When a due date is set, the todo is auto-reflected in the calendar view.
 *
 * Notes are stored as Todos with contentType = 'note' (ADR-003).
 * This avoids a separate table and simplifies queries/stores.
 */

import type { TodoPriorityDb } from './database';

// ─── Enums ────────────────────────────────────────────────────────────────────

export type TodoPriority = TodoPriorityDb;

/** Distinguishes regular todo items from free-form notes (ADR-003). */
export type ContentType = 'todo' | 'note';

// ─── Core domain types ────────────────────────────────────────────────────────

/** Full todo object (includes notes when contentType = 'note'). */
export interface Todo {
  id: string;
  userId: string;
  /** null = private todo; non-null = shared within that space */
  spaceId: string | null;
  title: string;
  /** Free-form content. For todos = description; for notes = body text. */
  content: string | null;
  /** 'todo' = regular checklist item; 'note' = free-form markdown note. */
  contentType: ContentType;
  dueDate: Date | null;
  priority: TodoPriority;
  isCompleted: boolean;
  completedAt: Date | null;
  categoryId: string | null;
  /** Sort position within a category for drag-to-reorder. */
  sortOrder: number;
  /** Optional link to an event (shown in event detail "related todos"). */
  eventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal todo used in lists (omit heavy fields). */
export interface TodoSummary {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: TodoPriority;
  isCompleted: boolean;
  contentType: ContentType;
  categoryId: string | null;
}

// ─── Filter ──────────────────────────────────────────────────────────────────

/** Filter criteria for getTodos() and fetchTodos(). */
export interface TodoFilter {
  /** Limit to todos shared in a specific space (null = personal only). */
  spaceId?: string;
  /** Filter by completion state. */
  isCompleted?: boolean;
  /** Filter by category. */
  categoryId?: string;
  /** Filter by content type. */
  contentType?: ContentType;
  /** Include only todos due before this date (inclusive). */
  dueBefore?: Date;
  /** Include only todos due after this date (inclusive). */
  dueAfter?: Date;
}

/** Filter criteria for getNotes(). */
export type NoteFilter = Pick<TodoFilter, 'spaceId'>;

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateTodoInput {
  title: string;
  /** Free-form content / description. Stored in todos.description column. */
  content?: string;
  /** Defaults to 'todo' if not provided. */
  contentType?: ContentType;
  dueDate?: Date;
  priority?: TodoPriority;
  spaceId?: string;
  categoryId?: string;
  eventId?: string;
}

export interface UpdateTodoInput {
  title?: string;
  content?: string;
  dueDate?: Date | null;
  priority?: TodoPriority;
  categoryId?: string | null;
  isCompleted?: boolean;
  eventId?: string | null;
}

// ─── Notes / Memos ────────────────────────────────────────────────────────────

/**
 * Free-form text note.
 * @deprecated Prefer using Todo with contentType='note' directly.
 * Kept for backward compatibility with existing Note-specific APIs.
 */
export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNoteInput {
  title: string;
  content: string;
}

export type UpdateNoteInput = Partial<CreateNoteInput>;
