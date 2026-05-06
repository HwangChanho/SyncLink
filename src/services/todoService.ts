/**
 * Todo service — CRUD operations on the `todos` table.
 *
 * Responsibilities:
 *  - Fetch todos / notes with optional filters
 *  - Create, update, delete todos and notes
 *  - Toggle completion state (with completedAt timestamp)
 *  - Batch reorder (sort_order update)
 *
 * Notes are stored as todos with content_type = 'note' (ADR-003).
 * getNotes / createNote are convenience wrappers over the core CRUD.
 *
 * DB column ↔ domain field mapping:
 *  - todos.description → Todo.content  (unified field name)
 *  - todos.is_completed → Todo.isCompleted
 *  - todos.content_type → Todo.contentType
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import type {
  Todo, TodoSummary, CreateTodoInput, UpdateTodoInput,
  TodoFilter, NoteFilter, ContentType,
  Note, CreateNoteInput, UpdateNoteInput,
  TodoRow,
} from '@/types';

// Build-92 — Tier 1 (todo CRUD) 의 Postgrest error 직렬화 헬퍼.
// instanceof Error 안 잡히는 plain object 도 message/code/details 추출.
function serializePgError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { raw: String(err) };
  const e = err as Record<string, unknown>;
  return {
    message: e.message ?? null,
    code:    e.code    ?? null,
    details: e.details ?? null,
    hint:    e.hint    ?? null,
  };
}

// supabase-js v2 workaround for missing Relationships types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Maps a raw TodoRow (snake_case) to a typed Todo domain object (camelCase).
 * The `description` DB column is exposed as `content` in the domain.
 */
function toTodo(row: TodoRow): Todo {
  return {
    id:           row.id,
    userId:       row.user_id,
    spaceId:      row.space_id,
    title:        row.title,
    content:      row.description,
    contentType:  (row.content_type ?? 'todo') as ContentType,
    dueDate:      row.due_date    ? new Date(row.due_date)    : null,
    dueAt:        row.due_at       ? new Date(row.due_at)       : null,
    priority:     row.priority,
    isCompleted:  row.is_completed,
    completedAt:  row.completed_at ? new Date(row.completed_at) : null,
    categoryId:   row.category_id,
    sortOrder:    row.sort_order  ?? 0,
    eventId:      row.event_id    ?? null,
    createdAt:    new Date(row.created_at),
    updatedAt:    new Date(row.updated_at),
  };
}

/**
 * Maps a raw TodoRow to a lightweight TodoSummary for list rendering.
 */
function toTodoSummary(row: TodoRow): TodoSummary {
  return {
    id:          row.id,
    title:       row.title,
    dueDate:     row.due_date ? new Date(row.due_date) : null,
    dueAt:       row.due_at   ? new Date(row.due_at)   : null,
    priority:    row.priority,
    isCompleted: row.is_completed,
    contentType: (row.content_type ?? 'todo') as ContentType,
    categoryId:  row.category_id,
  };
}

/**
 * Converts a Todo domain object back to a Note shape (for Note-specific callers).
 */
function todoToNote(todo: Todo): Note {
  return {
    id:        todo.id,
    userId:    todo.userId,
    title:     todo.title,
    content:   todo.content ?? '',
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

// ─── Public API — Todos ───────────────────────────────────────────────────────

/**
 * Fetch todos for the current user, optionally filtered.
 *
 * Default behavior: returns only contentType='todo' items unless
 * filter.contentType is explicitly set to 'note' or left undefined.
 *
 * @param filter - Optional filter criteria
 * @returns Array of TodoSummary sorted by sort_order ASC, then created_at DESC
 */
export async function getTodos(filter?: TodoFilter): Promise<TodoSummary[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  let query = supa
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    // Default to 'todo' unless caller overrides content_type filter
    .eq('content_type', filter?.contentType ?? 'todo');

  // Optional filters
  if (filter?.categoryId !== undefined) {
    query = query.eq('category_id', filter.categoryId);
  }
  if (filter?.isCompleted !== undefined) {
    query = query.eq('is_completed', filter.isCompleted);
  }
  if (filter?.dueBefore !== undefined) {
    query = query.lte('due_date', filter.dueBefore.toISOString().split('T')[0]);
  }
  if (filter?.dueAfter !== undefined) {
    query = query.gte('due_date', filter.dueAfter.toISOString().split('T')[0]);
  }
  if (filter?.spaceId !== undefined) {
    query = query.eq('space_id', filter.spaceId);
  }

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false }) as {
      data: TodoRow[] | null;
      error: Error | null;
    };

  if (error) throw error;
  return (data ?? []).map(toTodoSummary);
}

/**
 * Fetch a single todo by ID.
 *
 * @param todoId - UUID of the todo
 * @returns Full Todo object
 * @throws If not found or access denied
 */
export async function getTodoById(todoId: string): Promise<Todo> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supa
    .from('todos')
    .select('*')
    .eq('id', todoId)
    .eq('user_id', userId)
    .single() as { data: TodoRow | null; error: Error | null };

  if (error || !data) throw new Error('할일을 찾을 수 없습니다.');
  return toTodo(data);
}

/**
 * Create a new todo (or note).
 *
 * @param input - Todo creation payload
 * @returns Newly created Todo
 */
export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Build-65 — due_at 컬럼은 migration 025 적용 환경에서만 존재. conditional
  // spread 로 컬럼 없는 환경 호환 (Build-57 repeat_weekdays 동일 패턴).
  // dueAt 우선 — 시간 있는 todo 면 due_date 도 자동으로 그 날짜 (날짜 기반
  // 쿼리 호환).
  const insertPayload: Record<string, unknown> = {
    user_id:      userId,
    title:        input.title,
    description:  input.content ?? null,
    content_type: input.contentType ?? 'todo',
    due_date:     (input.dueAt ?? input.dueDate)?.toISOString().split('T')[0] ?? null,
    priority:     input.priority ?? 'medium',
    space_id:     input.spaceId ?? null,
    category_id:  input.categoryId ?? null,
    event_id:     input.eventId ?? null,
    is_completed: false,
    sort_order:   0,
  };
  if (input.dueAt) {
    insertPayload.due_at = input.dueAt.toISOString();
  }

  const { data, error } = await supa
    .from('todos')
    .insert(insertPayload)
    .select()
    .single() as { data: TodoRow | null; error: Error | null };

  if (error || !data) {
    void logError({
      context: 'todo.create',
      error:   error ?? new Error('todo INSERT no row'),
      userId,
      details: { supabaseError: serializePgError(error), spaceId: input.spaceId, contentType: input.contentType ?? 'todo' },
    });
    throw error ?? new Error('할일 생성에 실패했습니다.');
  }
  return toTodo(data);
}

/**
 * Update a todo's fields (owner only — enforced by RLS).
 *
 * Builds a partial patch from non-undefined fields to avoid overwriting
 * unchanged values.
 *
 * @param todoId  - UUID of the todo
 * @param updates - Fields to change
 * @returns Updated Todo
 */
export async function updateTodo(todoId: string, updates: UpdateTodoInput): Promise<Todo> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Build patch from only the provided fields
  const patch: Record<string, unknown> = {};
  if (updates.title       !== undefined) patch.title        = updates.title;
  if (updates.content     !== undefined) patch.description  = updates.content ?? null;
  if (updates.dueDate     !== undefined) patch.due_date     = updates.dueDate?.toISOString().split('T')[0] ?? null;
  // Build-65 — dueAt explicit 변경 시만 set. 컬럼 없는 환경 호환을 위해
  // null 일 때만 명시적으로 null 보내고, undefined 면 키 자체 미포함.
  if (updates.dueAt !== undefined) {
    patch.due_at = updates.dueAt?.toISOString() ?? null;
    // dueAt set/clear 시 due_date 도 동기화 (날짜 기반 쿼리 호환).
    if (updates.dueAt) {
      patch.due_date = updates.dueAt.toISOString().split('T')[0];
    }
  }
  if (updates.priority    !== undefined) patch.priority     = updates.priority;
  if (updates.categoryId  !== undefined) patch.category_id  = updates.categoryId ?? null;
  if (updates.isCompleted !== undefined) patch.is_completed = updates.isCompleted;
  if (updates.eventId     !== undefined) patch.event_id     = updates.eventId ?? null;

  if (Object.keys(patch).length === 0) return getTodoById(todoId);

  const { error } = await supa
    .from('todos')
    .update(patch)
    .eq('id', todoId)
    .eq('user_id', userId) as { error: Error | null };

  if (error) {
    void logError({
      context: 'todo.update',
      error,
      userId,
      details: { todoId, changedKeys: Object.keys(patch), supabaseError: serializePgError(error) },
    });
    throw error;
  }
  return getTodoById(todoId);
}

/**
 * Delete a todo permanently (owner only — enforced by RLS).
 *
 * @param todoId - UUID of the todo
 */
export async function deleteTodo(todoId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { error } = await supa
    .from('todos')
    .delete()
    .eq('id', todoId)
    .eq('user_id', userId) as { error: Error | null };

  if (error) {
    void logError({
      context: 'todo.delete',
      error,
      userId,
      details: { todoId, supabaseError: serializePgError(error) },
    });
    throw error;
  }
}

/**
 * Toggle a todo's completion state.
 * Sets completedAt to now when marking complete; clears it when unchecking.
 *
 * @param todoId      - UUID of the todo
 * @param isCompleted - Target completion state
 * @returns Updated Todo
 */
export async function toggleTodoComplete(todoId: string, isCompleted: boolean): Promise<Todo> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { error } = await supa
    .from('todos')
    .update({
      is_completed: isCompleted,
      // Set completedAt on completion; clear on uncheck
      completed_at: isCompleted ? new Date().toISOString() : null,
    })
    .eq('id', todoId)
    .eq('user_id', userId) as { error: Error | null };

  if (error) {
    void logError({
      context: 'todo.toggleComplete',
      error,
      userId,
      details: { todoId, isCompleted, supabaseError: serializePgError(error) },
    });
    throw error;
  }
  return getTodoById(todoId);
}

/**
 * Batch update sort_order for a list of todos.
 * Used for drag-to-reorder functionality.
 *
 * @param ids - Ordered array of todo IDs (index = new sort_order)
 */
export async function reorderTodos(ids: string[]): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Build batch upsert: each entry sets sort_order = index position
  const updates = ids.map((id, index) => ({
    id,
    sort_order: index,
  }));

  // Supabase upsert with onConflict: update sort_order only
  const { error } = await supa
    .from('todos')
    .upsert(updates, { onConflict: 'id', ignoreDuplicates: false })
    .eq('user_id', userId) as { error: Error | null };

  if (error) throw error;
}

// ─── Public API — Notes (content_type = 'note' convenience wrappers) ─────────

/**
 * Fetch all notes for the current user.
 *
 * @param filter - Optional filter (only spaceId is supported)
 * @returns Array of Todo with contentType='note', sorted by updatedAt DESC
 */
export async function getNotes(filter?: NoteFilter): Promise<Todo[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  let query = supa
    .from('todos')
    .select('*')
    .eq('user_id', userId)
    .eq('content_type', 'note');

  if (filter?.spaceId !== undefined) {
    query = query.eq('space_id', filter.spaceId);
  }

  const { data, error } = await query
    .order('updated_at', { ascending: false }) as {
      data: TodoRow[] | null;
      error: Error | null;
    };

  if (error) throw error;
  return (data ?? []).map(toTodo);
}

/**
 * Create a new note.
 *
 * @param input - Note creation payload (title + content)
 * @returns Newly created Todo with contentType='note'
 */
export async function createNote(input: CreateNoteInput): Promise<Todo> {
  return createTodo({
    title:       input.title,
    content:     input.content,
    contentType: 'note',
  });
}

/**
 * Update a note's title or content.
 *
 * @param noteId  - UUID of the note
 * @param updates - Fields to change
 * @returns Updated Todo (contentType='note')
 */
export async function updateNote(noteId: string, updates: UpdateNoteInput): Promise<Todo> {
  // Build patch omitting undefined fields (required by exactOptionalPropertyTypes)
  return updateTodo(noteId, {
    ...(updates.title   !== undefined ? { title:   updates.title   } : {}),
    ...(updates.content !== undefined ? { content: updates.content } : {}),
  });
}

/**
 * Delete a note permanently.
 *
 * @param noteId - UUID of the note
 */
export async function deleteNote(noteId: string): Promise<void> {
  return deleteTodo(noteId);
}

// ─── Legacy Note adapter (backward compat) ───────────────────────────────────

/**
 * @deprecated Use getNotes() which returns Todo[] directly.
 * Wraps getNotes() and converts to the legacy Note shape.
 */
export async function getNotesLegacy(): Promise<Note[]> {
  const todos = await getNotes();
  return todos.map(todoToNote);
}

// Re-export filter types for callers that import from this module
export type { TodoFilter, NoteFilter };
