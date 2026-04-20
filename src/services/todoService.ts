/**
 * Todo service — adapter over Supabase todos table.
 *
 * Handles personal and shared todos + notes.
 *
 * Notes are stored as todos with a special 'note' category to avoid
 * a separate table. This decision is logged in DECISIONS.md (ADR-003).
 */

import type {
  Todo, TodoSummary, CreateTodoInput, UpdateTodoInput,
  Note, CreateNoteInput, UpdateNoteInput,
} from '@/types';

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface TodoFilter {
  spaceId?: string;         // filter by space (null = personal only)
  isCompleted?: boolean;
  categoryId?: string;
  dueBefore?: Date;
  dueAfter?: Date;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get todos for the current user, with optional filters.
 *
 * @param filter - Optional filter criteria
 * @returns Array of TodoSummary sorted by due_date ASC, then created_at DESC
 */
export async function getTodos(_filter?: TodoFilter): Promise<TodoSummary[]> {
  throw new Error('Not implemented: getTodos');
}

/**
 * Get a single todo by ID.
 *
 * @param todoId - UUID of the todo
 * @returns Full Todo object
 * @throws Error if not found or access denied
 */
export async function getTodoById(_todoId: string): Promise<Todo> {
  throw new Error('Not implemented: getTodoById');
}

/**
 * Create a new todo.
 *
 * @param input - Todo creation payload
 * @returns Newly created Todo
 */
export async function createTodo(_input: CreateTodoInput): Promise<Todo> {
  throw new Error('Not implemented: createTodo');
}

/**
 * Update a todo.
 *
 * @param todoId - UUID of the todo
 * @param updates - Fields to update
 * @returns Updated Todo
 */
export async function updateTodo(_todoId: string, _updates: UpdateTodoInput): Promise<Todo> {
  throw new Error('Not implemented: updateTodo');
}

/**
 * Toggle todo completion status.
 * Sets completedAt timestamp when marking as complete; clears it on uncheck.
 *
 * @param todoId - UUID of the todo
 * @param isCompleted - Target completion state
 * @returns Updated Todo
 */
export async function toggleTodoComplete(_todoId: string, _isCompleted: boolean): Promise<Todo> {
  throw new Error('Not implemented: toggleTodoComplete');
}

/**
 * Delete a todo.
 *
 * @param todoId - UUID of the todo
 */
export async function deleteTodo(_todoId: string): Promise<void> {
  throw new Error('Not implemented: deleteTodo');
}

// ─── Notes ────────────────────────────────────────────────────────────────────

/**
 * Get all notes for the current user.
 *
 * @returns Array of Note sorted by updatedAt DESC
 */
export async function getNotes(): Promise<Note[]> {
  throw new Error('Not implemented: getNotes');
}

/**
 * Create a new note.
 *
 * @param input - Note creation payload
 * @returns Newly created Note
 */
export async function createNote(_input: CreateNoteInput): Promise<Note> {
  throw new Error('Not implemented: createNote');
}

/**
 * Update a note.
 *
 * @param noteId - UUID of the note
 * @param updates - Fields to update
 * @returns Updated Note
 */
export async function updateNote(_noteId: string, _updates: UpdateNoteInput): Promise<Note> {
  throw new Error('Not implemented: updateNote');
}

/**
 * Delete a note.
 *
 * @param noteId - UUID of the note
 */
export async function deleteNote(_noteId: string): Promise<void> {
  throw new Error('Not implemented: deleteNote');
}
