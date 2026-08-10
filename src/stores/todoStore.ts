/**
 * Todo store — cached todo/note state for the Planner tab and Home screen.
 *
 * Wraps todoService.ts. Provides:
 *  - Todos and Notes lists keyed separately for quick tab switching
 *  - Optimistic updates: UI reflects changes instantly, rolls back on error
 *  - Filter state for category/completion filtering in the Planner tab
 *
 * Design note:
 *  - `todos` contains contentType='todo' items
 *  - `notes` contains contentType='note' items
 *  - Both are plain Todo[] (not Note[]) since Notes are Todos under the hood (ADR-003)
 *
 * Optimistic update pattern:
 *  1. Apply change to local state immediately
 *  2. Call service (async)
 *  3. On success: replace optimistic item with server-confirmed item
 *  4. On error: revert local state and re-throw for UI error handling
 */

import { create } from 'zustand';
import type { Todo, CreateTodoInput, TodoFilter, ContentType } from '@/types';
import {
  getTodos,
  createTodo,
  updateTodo as updateTodoService,
  deleteTodo as deleteTodoService,
  toggleTodoComplete,
  getNotes,
  updateNote,
  deleteNote,
} from '@/services/todoService';
import type { CreateNoteInput, UpdateNoteInput } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { buildGuestDemoTodos } from '@/lib/guestDemoData';

// ─── Store interface ──────────────────────────────────────────────────────────

interface TodoState {
  /** Regular todo items (contentType='todo'). */
  todos: Todo[];
  /** Note items (contentType='note'). */
  notes: Todo[];
  /** Current active filter for the Todo tab. */
  filter: TodoFilter;
  /** True while fetching from the server. */
  isLoading: boolean;
  /** Last error message, if any. */
  error: string | null;

  // ── Data actions ───────────────────────────────────────────────────────────

  /**
   * Fetch todos from the server and populate the todos list.
   * Merges the provided filter with { contentType: 'todo' }.
   */
  fetchTodos: (filter?: TodoFilter) => Promise<void>;

  /**
   * Fetch notes from the server and populate the notes list.
   */
  fetchNotes: () => Promise<void>;

  /**
   * Create a todo or note with optimistic update.
   * Adds a temporary item immediately, then replaces with server response.
   */
  /** Returns the created Todo on success, or null on failure (error is set in store). */
  addTodo: (input: CreateTodoInput) => Promise<Todo | null>;

  /**
   * Add a note with optimistic update.
   */
  addNote: (input: CreateNoteInput) => Promise<Todo | null>;

  /**
   * Apply partial updates to a todo/note optimistically.
   */
  editTodo: (id: string, updates: Partial<Todo>) => Promise<void>;

  /**
   * Update a note's title or content optimistically.
   */
  editNote: (id: string, updates: UpdateNoteInput) => Promise<void>;

  /**
   * Remove a todo/note optimistically.
   */
  removeTodo: (id: string) => Promise<void>;

  /**
   * Remove a note optimistically.
   */
  removeNote: (id: string) => Promise<void>;

  /**
   * Toggle a todo's completion state optimistically.
   * Updates isCompleted and completedAt in local state immediately.
   */
  toggleTodo: (id: string) => Promise<void>;

  // ── UI state actions ───────────────────────────────────────────────────────

  /** Update the active filter (triggers re-fetch in the Planner tab). */
  setFilter: (filter: TodoFilter) => void;

  /** Clear any error state. */
  clearError: () => void;
}

// ─── Helper: temporary ID for optimistic items ───────────────────────────────

let _tempIdCounter = 0;
function tempId(): string {
  return `__optimistic_${++_tempIdCounter}`;
}

// ─── Helper: content type list selector ──────────────────────────────────────

function listKey(contentType: ContentType): 'todos' | 'notes' {
  return contentType === 'note' ? 'notes' : 'todos';
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  notes: [],
  filter: { contentType: 'todo' },
  isLoading: false,
  error: null,

  // ── fetchTodos ─────────────────────────────────────────────────────────────
  fetchTodos: async (filter?: TodoFilter) => {
    set({ isLoading: true, error: null });
    try {
      // A browsing guest has no rows under RLS, so the server would return []
      // and Home's "오늘 할일" would render empty. Swap in demo todos instead —
      // same short-circuit eventStore.fetchEvents uses for demo events.
      if (!useAuthStore.getState().isAuthenticated) {
        set({ todos: buildGuestDemoTodos(), isLoading: false });
        return;
      }

      const merged: TodoFilter = { ...filter, contentType: 'todo' };

      // getTodos returns TodoSummary[], but we need Todo[] for the store.
      // Fetch as full Todo objects via a filter that includes content_type.
      // Note: getTodos returns TodoSummary; we convert via a second fetch.
      // For performance, we fetch all in one pass using the raw service.
      const summaries = await getTodos(merged);

      // Convert TodoSummary → Todo by filling in defaults for missing fields.
      // Full Todo data is loaded lazily when a user taps a specific item.
      const serverTodos: Todo[] = summaries.map(s => ({
        id:          s.id,
        userId:      '',        // not in summary — populated on getTodoById
        spaceId:     null,
        title:       s.title,
        content:     null,
        contentType: s.contentType,
        dueDate:     s.dueDate,
        dueAt:       s.dueAt,
        priority:    s.priority,
        isCompleted: s.isCompleted,
        completedAt: null,
        categoryId:  s.categoryId,
        sortOrder:   0,
        eventId:     null,
        createdAt:   new Date(),
        updatedAt:   new Date(),
      }));

      // Merge server results while preserving any in-flight optimistic state.
      //
      // Problem: toggleTodo() applies an optimistic flip immediately, then
      // awaits the server. If fetchTodos() completes during that window it
      // would replace the store with stale server data, reverting the visual
      // toggle. (#fix-reactivity)
      //
      // Solution: for each server item, keep the current in-memory version
      // when it already exists in the store — its isCompleted/completedAt may
      // already reflect an in-flight toggle. Items that don't exist locally
      // are added as-is from the server.
      set(state => {
        const localById = new Map(state.todos.map(t => [t.id, t]));
        const merged = serverTodos.map(serverItem => {
          const local = localById.get(serverItem.id);
          // If the item is already in the store (possibly with an optimistic
          // toggle applied), keep the local version; the toggleTodo callback
          // will sync with the confirmed server value once the PATCH completes.
          return local ?? serverItem;
        });
        return { todos: merged, isLoading: false };
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '할일을 불러오지 못했습니다.',
      });
    }
  },

  // ── fetchNotes ─────────────────────────────────────────────────────────────
  fetchNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const notes = await getNotes();
      set({ notes, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : '노트를 불러오지 못했습니다.',
      });
    }
  },

  // ── addTodo ────────────────────────────────────────────────────────────────
  addTodo: async (input: CreateTodoInput) => {
    const now = new Date();
    const key = listKey(input.contentType ?? 'todo');

    // Optimistic: add a placeholder immediately
    const placeholder: Todo = {
      id:          tempId(),
      userId:      '',
      spaceId:     input.spaceId ?? null,
      title:       input.title,
      content:     input.content ?? null,
      contentType: input.contentType ?? 'todo',
      dueDate:     input.dueAt ?? input.dueDate ?? null,
      dueAt:       input.dueAt ?? null,
      priority:    input.priority ?? 'medium',
      isCompleted: false,
      completedAt: null,
      categoryId:  input.categoryId ?? null,
      sortOrder:   0,
      eventId:     input.eventId ?? null,
      createdAt:   now,
      updatedAt:   now,
    };

    set(state => ({ [key]: [placeholder, ...state[key]] }));

    try {
      const created = await createTodo(input);
      // Replace placeholder with real item from server
      set(state => ({
        [key]: state[key].map(t => t.id === placeholder.id ? created : t),
      }));
      return created;
    } catch (err) {
      // Revert optimistic change
      set(state => ({
        [key]: state[key].filter(t => t.id !== placeholder.id),
        error: err instanceof Error ? err.message : '할일 생성에 실패했습니다.',
      }));
      return null;
    }
  },

  // ── addNote ────────────────────────────────────────────────────────────────
  addNote: async (input: CreateNoteInput) => {
    return get().addTodo({
      title:       input.title,
      content:     input.content,
      contentType: 'note',
    });
  },

  // ── editTodo ───────────────────────────────────────────────────────────────
  editTodo: async (id: string, updates: Partial<Todo>) => {
    // Capture original state for rollback
    const prevTodos = get().todos;
    const prevNotes = get().notes;

    // Apply optimistic update across both lists
    const applyUpdate = (list: Todo[]) =>
      list.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date() } : t);

    set({ todos: applyUpdate(prevTodos), notes: applyUpdate(prevNotes) });

    try {
      // Build patch omitting undefined fields (required by exactOptionalPropertyTypes)
      const updated = await updateTodoService(id, {
        ...(updates.title       !== undefined ? { title:       updates.title       } : {}),
        // content is string | null in Todo; UpdateTodoInput expects string — skip null
        ...(updates.content != null ? { content: updates.content } : {}),
        ...(updates.dueDate     !== undefined ? { dueDate:     updates.dueDate     } : {}),
        ...(updates.dueAt       !== undefined ? { dueAt:       updates.dueAt       } : {}),
        ...(updates.priority    !== undefined ? { priority:    updates.priority    } : {}),
        ...(updates.categoryId  !== undefined ? { categoryId:  updates.categoryId  } : {}),
        ...(updates.isCompleted !== undefined ? { isCompleted: updates.isCompleted } : {}),
        ...(updates.eventId     !== undefined ? { eventId:     updates.eventId     } : {}),
      });
      // Sync with server response
      const syncUpdate = (list: Todo[]) =>
        list.map(t => t.id === id ? updated : t);
      set({ todos: syncUpdate(get().todos), notes: syncUpdate(get().notes) });
    } catch (err) {
      // Revert to original
      set({
        todos: prevTodos,
        notes: prevNotes,
        error: err instanceof Error ? err.message : '수정에 실패했습니다.',
      });
    }
  },

  // ── editNote ───────────────────────────────────────────────────────────────
  editNote: async (id: string, updates: UpdateNoteInput) => {
    const prevNotes = get().notes;
    set({
      notes: prevNotes.map(n =>
        n.id === id
          ? { ...n, title: updates.title ?? n.title, content: updates.content ?? n.content, updatedAt: new Date() }
          : n,
      ),
    });

    try {
      const updated = await updateNote(id, updates);
      set({ notes: get().notes.map(n => n.id === id ? updated : n) });
    } catch (err) {
      set({
        notes: prevNotes,
        error: err instanceof Error ? err.message : '노트 수정에 실패했습니다.',
      });
    }
  },

  // ── removeTodo ─────────────────────────────────────────────────────────────
  removeTodo: async (id: string) => {
    const prevTodos = get().todos;
    set({ todos: prevTodos.filter(t => t.id !== id) });

    try {
      await deleteTodoService(id);
    } catch (err) {
      set({
        todos: prevTodos,
        error: err instanceof Error ? err.message : '삭제에 실패했습니다.',
      });
    }
  },

  // ── removeNote ─────────────────────────────────────────────────────────────
  removeNote: async (id: string) => {
    const prevNotes = get().notes;
    set({ notes: prevNotes.filter(n => n.id !== id) });

    try {
      await deleteNote(id);
    } catch (err) {
      set({
        notes: prevNotes,
        error: err instanceof Error ? err.message : '노트 삭제에 실패했습니다.',
      });
    }
  },

  // ── toggleTodo ─────────────────────────────────────────────────────────────
  toggleTodo: async (id: string) => {
    const todo = get().todos.find(t => t.id === id);
    if (!todo) return;

    const newCompleted = !todo.isCompleted;
    const prevTodos = get().todos;

    // Optimistic: flip the toggle immediately
    set({
      todos: prevTodos.map(t =>
        t.id === id
          ? { ...t, isCompleted: newCompleted, completedAt: newCompleted ? new Date() : null }
          : t,
      ),
    });

    try {
      const updated = await toggleTodoComplete(id, newCompleted);
      set({ todos: get().todos.map(t => t.id === id ? updated : t) });
    } catch (err) {
      // Revert
      set({
        todos: prevTodos,
        error: err instanceof Error ? err.message : '상태 변경에 실패했습니다.',
      });
    }
  },

  // ── setFilter ──────────────────────────────────────────────────────────────
  /**
   * Update the active filter and immediately re-fetch todos with the new filter.
   * ISSUE-006 fix: previously only updated state without triggering a re-fetch,
   * causing the Planner tab list to remain stale after filter changes.
   */
  setFilter: (filter: TodoFilter) => {
    set({ filter });
    // Trigger a re-fetch so the UI reflects the new filter immediately.
    // fetchTodos merges { contentType: 'todo' } internally.
    get().fetchTodos(filter);
  },

  // ── clearError ─────────────────────────────────────────────────────────────
  clearError: () => set({ error: null }),
}));
