/**
 * Todo / Planner domain types.
 *
 * Todos can be personal (spaceId = null) or shared within a space.
 * When a due date is set, the todo is auto-reflected in the calendar view.
 */

import type { TodoPriorityDb } from './database';

// ─── Enums ────────────────────────────────────────────────────────────────────

export type TodoPriority = TodoPriorityDb;

// ─── Core domain types ────────────────────────────────────────────────────────

/** Full todo object. */
export interface Todo {
  id: string;
  userId: string;
  /** null = private todo; non-null = shared within that space */
  spaceId: string | null;
  title: string;
  description: string | null;
  dueDate: Date | null;
  priority: TodoPriority;
  isCompleted: boolean;
  completedAt: Date | null;
  categoryId: string | null;
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
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateTodoInput {
  title: string;
  description?: string;
  dueDate?: Date;
  priority?: TodoPriority;
  spaceId?: string;
  categoryId?: string;
}

export type UpdateTodoInput = Partial<CreateTodoInput> & {
  isCompleted?: boolean;
};

// ─── Notes / Memos ────────────────────────────────────────────────────────────

/**
 * Free-form text note. Stored as a special todo with no due date.
 * (Reusing the todos table with a 'note' category to avoid schema bloat.)
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
