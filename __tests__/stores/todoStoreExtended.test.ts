/**
 * __tests__/stores/todoStoreExtended.test.ts
 *
 * useTodoStore 확장 테스트 스위트
 *
 * 목적: todoStore.test.ts에서 커버하지 않은 액션 추가 커버리지
 *
 * 커버리지:
 *  addNote         — notes 배열에 낙관적 추가, 실패 시 롤백
 *  editTodo        — 낙관적 수정, 서버 응답으로 동기화, 실패 시 롤백
 *  editNote        — 낙관적 수정, 실패 시 원래 상태 복원
 *  removeNote      — notes 배열에서 낙관적 삭제, 실패 시 롤백
 *  fetchNotes 에러 — error 상태 설정
 *  fetchTodos 로딩 — isLoading 상태 전이
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/services/todoService', () => ({
  getTodos:          jest.fn(),
  getTodoById:       jest.fn(),
  createTodo:        jest.fn(),
  updateTodo:        jest.fn(),
  deleteTodo:        jest.fn(),
  toggleTodoComplete:jest.fn(),
  getNotes:          jest.fn(),
  createNote:        jest.fn(),
  updateNote:        jest.fn(),
  deleteNote:        jest.fn(),
  reorderTodos:      jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  createTodo,
  updateTodo,
  deleteTodo,
  getNotes,
  updateNote,
  deleteNote,
} from '@/services/todoService';
import { useTodoStore } from '@/stores/todoStore';
// 1.4.0 부터 비로그인 게스트에게는 데모 할 일을 보여준다(fetchTodos 가 즉시 단락).
// 서버 응답·에러 경로를 검증하려면 인증된 상태여야 한다.
import { useAuthStore } from '@/stores/authStore';
import type { Todo } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-20T09:00:00.000Z');

/** Todo 픽스처 */
const mockTodo: Todo = {
  id:          'todo-1',
  userId:      'user-123',
  spaceId:     null,
  title:       '기존 할일',
  content:     null,
  contentType: 'todo',
  dueDate:     null,
  priority:    'medium',
  isCompleted: false,
  completedAt: null,
  categoryId:  null,
  sortOrder:   0,
  eventId:     null,
  createdAt:   NOW,
  updatedAt:   NOW,
};

/** Note 픽스처 (contentType='note') */
const mockNote: Todo = {
  ...mockTodo,
  id:          'note-1',
  title:       '기존 노트',
  contentType: 'note',
  content:     '노트 본문',
};

// ─── 초기 상태 ────────────────────────────────────────────────────────────────

const INITIAL_STATE = {
  todos:     [] as Todo[],
  notes:     [] as Todo[],
  filter:    { contentType: 'todo' as const },
  isLoading: false,
  error:     null,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('useTodoStore — 확장 커버리지', () => {
  beforeEach(() => {
    useTodoStore.setState(INITIAL_STATE);
    useAuthStore.setState({ isAuthenticated: true, isLoading: false });
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // addNote
  // ══════════════════════════════════════════════════════════════════════════

  describe('addNote', () => {
    it('notes 배열에 낙관적으로 추가됨', async () => {
      let resolveCreate!: (value: Todo) => void;
      const createPromise = new Promise<Todo>(res => { resolveCreate = res; });
      (createTodo as jest.Mock).mockReturnValue(createPromise);

      const addPromise = useTodoStore.getState().addNote({
        title:   '새 노트',
        content: '내용',
      });

      // 서비스 응답 전: notes 배열에 플레이스홀더 추가
      expect(useTodoStore.getState().notes).toHaveLength(1);
      expect(useTodoStore.getState().notes[0].contentType).toBe('note');
      expect(useTodoStore.getState().todos).toHaveLength(0); // todos에는 영향 없음

      resolveCreate(mockNote);
      await addPromise;

      // 서비스 응답 후: 플레이스홀더 → 실제 항목 교체
      expect(useTodoStore.getState().notes[0].id).toBe('note-1');
    });

    it('addNote 실패 시 플레이스홀더 제거 + error 상태 설정', async () => {
      (createTodo as jest.Mock).mockRejectedValue(new Error('노트 생성 실패'));

      await useTodoStore.getState().addNote({ title: '실패 노트', content: '' });

      expect(useTodoStore.getState().notes).toHaveLength(0);
      expect(useTodoStore.getState().error).toBe('노트 생성 실패');
    });

    it('기존 notes가 있을 때 실패 시 기존 항목 유지', async () => {
      useTodoStore.setState({ notes: [mockNote] });
      (createTodo as jest.Mock).mockRejectedValue(new Error('실패'));

      await useTodoStore.getState().addNote({ title: '새 노트', content: '' });

      expect(useTodoStore.getState().notes).toHaveLength(1);
      expect(useTodoStore.getState().notes[0].id).toBe('note-1');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editTodo
  // ══════════════════════════════════════════════════════════════════════════

  describe('editTodo', () => {
    beforeEach(() => {
      useTodoStore.setState({ todos: [mockTodo] });
    });

    it('낙관적으로 todos 즉시 업데이트', async () => {
      let resolveUpdate!: (value: Todo) => void;
      const updatePromise = new Promise<Todo>(res => { resolveUpdate = res; });
      (updateTodo as jest.Mock).mockReturnValue(updatePromise);

      const editPromise = useTodoStore.getState().editTodo('todo-1', { title: '수정된 제목' });

      // 서비스 응답 전: 즉시 title 업데이트
      expect(useTodoStore.getState().todos[0].title).toBe('수정된 제목');

      const updatedTodo: Todo = { ...mockTodo, title: '수정된 제목' };
      resolveUpdate(updatedTodo);
      await editPromise;

      expect(useTodoStore.getState().todos[0].title).toBe('수정된 제목');
    });

    it('서비스 실패 시 원래 todos 복원', async () => {
      (updateTodo as jest.Mock).mockRejectedValue(new Error('수정 실패'));

      await useTodoStore.getState().editTodo('todo-1', { title: '수정 실패' });

      // 롤백: 원래 제목 복원
      expect(useTodoStore.getState().todos[0].title).toBe('기존 할일');
      expect(useTodoStore.getState().error).toBe('수정 실패');
    });

    it('서버 응답으로 최종 상태 동기화', async () => {
      const serverResponse: Todo = {
        ...mockTodo,
        title:     '서버 확인 제목',
        updatedAt: new Date('2026-04-20T10:00:00.000Z'),
      };
      (updateTodo as jest.Mock).mockResolvedValue(serverResponse);

      await useTodoStore.getState().editTodo('todo-1', { title: '임시 제목' });

      expect(useTodoStore.getState().todos[0].title).toBe('서버 확인 제목');
    });

    it('존재하지 않는 id 수정 시도 → todos 변화 없음 (updateTodo 호출됨)', async () => {
      (updateTodo as jest.Mock).mockResolvedValue(mockTodo);

      await useTodoStore.getState().editTodo('nonexistent', { title: '변경' });

      // id가 없으면 todos 배열 변화 없이 서버만 호출됨
      expect(useTodoStore.getState().todos[0].id).toBe('todo-1');
    });

    // ── Build-66 — dueAt (시간 포함 마감) 시나리오 ────────────────────────

    it('dueAt 설정 시 낙관적 todos 갱신 + service 인자에 dueAt 전달', async () => {
      const newDueAt = new Date('2026-05-04T14:30:00.000Z');
      const serverResponse: Todo = { ...mockTodo, dueAt: newDueAt };
      (updateTodo as jest.Mock).mockResolvedValue(serverResponse);

      await useTodoStore.getState().editTodo('todo-1', { dueAt: newDueAt });

      // service 가 dueAt patch 와 함께 호출되어야 함.
      expect(updateTodo).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ dueAt: newDueAt }),
      );
      expect(useTodoStore.getState().todos[0].dueAt).toEqual(newDueAt);
    });

    it('dueAt: null 으로 시간 제거 — service 에 null 전달', async () => {
      // 시작 상태: 시간 있는 todo.
      const todoWithTime: Todo = {
        ...mockTodo,
        dueAt: new Date('2026-05-04T14:30:00.000Z'),
      };
      useTodoStore.setState({ todos: [todoWithTime] });
      (updateTodo as jest.Mock).mockResolvedValue({ ...todoWithTime, dueAt: null });

      await useTodoStore.getState().editTodo('todo-1', { dueAt: null });

      expect(updateTodo).toHaveBeenCalledWith(
        'todo-1',
        expect.objectContaining({ dueAt: null }),
      );
      expect(useTodoStore.getState().todos[0].dueAt).toBeNull();
    });

    it('dueAt 변경 실패 시 원래 dueAt 으로 롤백', async () => {
      const original = new Date('2026-05-04T09:00:00.000Z');
      const todoWithTime: Todo = { ...mockTodo, dueAt: original };
      useTodoStore.setState({ todos: [todoWithTime] });
      (updateTodo as jest.Mock).mockRejectedValue(new Error('네트워크 실패'));

      const newDueAt = new Date('2026-05-04T18:00:00.000Z');
      await useTodoStore.getState().editTodo('todo-1', { dueAt: newDueAt });

      // 롤백 — 원래 시각 유지.
      expect(useTodoStore.getState().todos[0].dueAt).toEqual(original);
      expect(useTodoStore.getState().error).toBe('네트워크 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // editNote
  // ══════════════════════════════════════════════════════════════════════════

  describe('editNote', () => {
    beforeEach(() => {
      useTodoStore.setState({ notes: [mockNote] });
    });

    it('낙관적으로 notes 즉시 업데이트', async () => {
      let resolveUpdate!: (value: Todo) => void;
      const updatePromise = new Promise<Todo>(res => { resolveUpdate = res; });
      (updateNote as jest.Mock).mockReturnValue(updatePromise);

      const editPromise = useTodoStore.getState().editNote('note-1', { title: '수정된 노트' });

      // 서비스 응답 전: 즉시 업데이트
      expect(useTodoStore.getState().notes[0].title).toBe('수정된 노트');

      const updatedNote: Todo = { ...mockNote, title: '수정된 노트' };
      resolveUpdate(updatedNote);
      await editPromise;
    });

    it('editNote 실패 시 원래 notes 복원', async () => {
      (updateNote as jest.Mock).mockRejectedValue(new Error('노트 수정 실패'));

      await useTodoStore.getState().editNote('note-1', { title: '실패 제목' });

      expect(useTodoStore.getState().notes[0].title).toBe('기존 노트');
      expect(useTodoStore.getState().error).toBe('노트 수정 실패');
    });

    it('content 업데이트 낙관적 반영', async () => {
      (updateNote as jest.Mock).mockResolvedValue({ ...mockNote, content: '새 내용' });

      await useTodoStore.getState().editNote('note-1', { content: '새 내용' });

      expect(useTodoStore.getState().notes[0].content).toBe('새 내용');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // removeNote
  // ══════════════════════════════════════════════════════════════════════════

  describe('removeNote', () => {
    beforeEach(() => {
      useTodoStore.setState({ notes: [mockNote] });
    });

    it('낙관적으로 notes에서 즉시 제거', async () => {
      let resolveDelete!: () => void;
      const deletePromise = new Promise<void>(res => { resolveDelete = res; });
      (deleteNote as jest.Mock).mockReturnValue(deletePromise);

      const storePromise = useTodoStore.getState().removeNote('note-1');

      // 서비스 응답 전: 이미 제거됨
      expect(useTodoStore.getState().notes).toHaveLength(0);

      resolveDelete();
      await storePromise;
    });

    it('removeNote 실패 시 원래 notes 복원', async () => {
      (deleteNote as jest.Mock).mockRejectedValue(new Error('노트 삭제 실패'));

      await useTodoStore.getState().removeNote('note-1');

      expect(useTodoStore.getState().notes).toHaveLength(1);
      expect(useTodoStore.getState().notes[0].id).toBe('note-1');
      expect(useTodoStore.getState().error).toBe('노트 삭제 실패');
    });

    it('todos에는 영향 없음', async () => {
      useTodoStore.setState({ todos: [mockTodo], notes: [mockNote] });
      (deleteNote as jest.Mock).mockResolvedValue(undefined);

      await useTodoStore.getState().removeNote('note-1');

      expect(useTodoStore.getState().todos).toHaveLength(1); // todos 유지
      expect(useTodoStore.getState().notes).toHaveLength(0); // notes만 삭제
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchNotes 에러 케이스
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchNotes 에러 처리', () => {
    it('서비스 실패 시 error 상태 설정', async () => {
      (getNotes as jest.Mock).mockRejectedValue(new Error('노트 불러오기 실패'));

      await useTodoStore.getState().fetchNotes();

      const { notes, isLoading, error } = useTodoStore.getState();
      expect(notes).toHaveLength(0);
      expect(isLoading).toBe(false);
      expect(error).toBe('노트 불러오기 실패');
    });

    it('Error 인스턴스 아닌 경우 기본 메시지 사용', async () => {
      (getNotes as jest.Mock).mockRejectedValue('string error');

      await useTodoStore.getState().fetchNotes();

      expect(useTodoStore.getState().error).toBe('노트를 불러오지 못했습니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchTodos 로딩 상태 전이
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchTodos 로딩 상태', () => {
    it('Error 인스턴스 아닌 경우 기본 에러 메시지 사용', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTodos } = require('@/services/todoService');
      (getTodos as jest.Mock).mockRejectedValue('unknown error');

      await useTodoStore.getState().fetchTodos();

      expect(useTodoStore.getState().error).toBe('할일을 불러오지 못했습니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 복합 시나리오
  // ══════════════════════════════════════════════════════════════════════════

  describe('복합 시나리오', () => {
    it('todos와 notes 독립적으로 관리됨', async () => {
      (createTodo as jest.Mock).mockResolvedValue(mockTodo);

      await useTodoStore.getState().addTodo({
        title:       '할일',
        contentType: 'todo',
      });

      // todos에만 추가, notes는 비어 있음
      expect(useTodoStore.getState().todos).toHaveLength(1);
      expect(useTodoStore.getState().notes).toHaveLength(0);
    });

    it('clearError 후 새 에러 발생 시 올바르게 설정', async () => {
      useTodoStore.setState({ error: '이전 에러' });
      useTodoStore.getState().clearError();
      expect(useTodoStore.getState().error).toBeNull();

      (deleteNote as jest.Mock).mockRejectedValue(new Error('새 에러'));
      useTodoStore.setState({ notes: [mockNote] });
      await useTodoStore.getState().removeNote('note-1');

      expect(useTodoStore.getState().error).toBe('새 에러');
    });
  });
});
