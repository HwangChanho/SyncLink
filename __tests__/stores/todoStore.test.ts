/**
 * __tests__/stores/todoStore.test.ts
 *
 * TASK-410: Todo 스토어 테스트 스위트
 *
 * 전략:
 *  - @/services/todoService 전체 mock → 서비스 레이어 호출 검증
 *  - 각 테스트 전 useTodoStore.setState()로 상태 초기화
 *  - 낙관적 업데이트 패턴 검증:
 *    addTodo  → 플레이스홀더 즉시 추가 → 서비스 성공 시 실제 항목으로 교체
 *    addTodo  → 서비스 실패 시 플레이스홀더 제거 + state.error 설정
 *    toggleTodo → 즉시 isCompleted 반전 → 서비스 성공 시 서버 응답으로 교체
 *
 * 커버리지:
 *  fetchTodos     — 서비스 호출 후 todos 배열 저장, 로딩 상태
 *  fetchNotes     — 서비스 호출 후 notes 배열 저장
 *  addTodo        — 낙관적 추가 → 성공 시 교체, 실패 시 롤백
 *  toggleTodo     — 낙관적 토글 → 성공 시 서버 응답 반영, 실패 시 롤백
 *  removeTodo     — 낙관적 삭제 → 실패 시 롤백
 *  setFilter      — filter 상태 업데이트
 *
 * @task TASK-410
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
  getTodos,
  createTodo,
  deleteTodo,
  toggleTodoComplete,
  getNotes,
} from '@/services/todoService';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo, TodoSummary } from '@/types';

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-20T09:00:00.000Z');

/** fetchTodos가 반환하는 TodoSummary 픽스처 */
const mockSummary: TodoSummary = {
  id:          'todo-1',
  title:       '기존 할일',
  dueDate:     null,
  priority:    'medium',
  isCompleted: false,
  contentType: 'todo',
  categoryId:  null,
};

/** createTodo / toggleTodoComplete가 반환하는 Todo 픽스처 */
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

/** getNotes가 반환하는 Note Todo 픽스처 */
const mockNoteTodo: Todo = {
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

describe('useTodoStore', () => {
  beforeEach(() => {
    // 각 테스트 전 스토어 상태 초기화 (테스트 간 상태 격리)
    useTodoStore.setState(INITIAL_STATE);
    jest.clearAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchTodos
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchTodos', () => {
    it('서비스 호출 후 todos 배열에 저장', async () => {
      (getTodos as jest.Mock).mockResolvedValue([mockSummary]);

      await useTodoStore.getState().fetchTodos();

      const { todos, isLoading, error } = useTodoStore.getState();
      expect(todos).toHaveLength(1);
      expect(todos[0].id).toBe('todo-1');
      expect(todos[0].title).toBe('기존 할일');
      expect(isLoading).toBe(false);
      expect(error).toBeNull();
    });

    it('fetchTodos는 contentType=todo 를 병합하여 서비스 호출', async () => {
      (getTodos as jest.Mock).mockResolvedValue([]);

      await useTodoStore.getState().fetchTodos({ categoryId: 'cat-1' });

      expect(getTodos).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'todo', categoryId: 'cat-1' })
      );
    });

    it('서비스 실패 시 error 상태 설정', async () => {
      (getTodos as jest.Mock).mockRejectedValue(new Error('불러오기 실패'));

      await useTodoStore.getState().fetchTodos();

      const { todos, isLoading, error } = useTodoStore.getState();
      expect(todos).toHaveLength(0);
      expect(isLoading).toBe(false);
      expect(error).toBe('불러오기 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // fetchNotes
  // ══════════════════════════════════════════════════════════════════════════

  describe('fetchNotes', () => {
    it('서비스 호출 후 notes 배열에 저장 (todos와 분리)', async () => {
      (getNotes as jest.Mock).mockResolvedValue([mockNoteTodo]);

      await useTodoStore.getState().fetchNotes();

      const { todos, notes } = useTodoStore.getState();
      // notes 배열에만 저장, todos 배열은 비어 있음
      expect(notes).toHaveLength(1);
      expect(notes[0].contentType).toBe('note');
      expect(todos).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // addTodo — 낙관적 업데이트
  // ══════════════════════════════════════════════════════════════════════════

  describe('addTodo', () => {
    it('서비스 호출 전 플레이스홀더 즉시 추가 (낙관적 업데이트)', async () => {
      // 비동기 해결을 직접 제어하기 위해 Promise를 수동 제어
      let resolveCreate!: (value: Todo) => void;
      const createPromise = new Promise<Todo>(res => { resolveCreate = res; });
      (createTodo as jest.Mock).mockReturnValue(createPromise);

      // addTodo 호출 (await 하지 않음 — 진행 중 상태 확인)
      const addPromise = useTodoStore.getState().addTodo({
        title:       '새 할일',
        contentType: 'todo',
      });

      // 서비스 응답 전: 플레이스홀더가 이미 todos에 추가되어 있어야 함
      expect(useTodoStore.getState().todos).toHaveLength(1);
      expect(useTodoStore.getState().todos[0].title).toBe('새 할일');
      // 플레이스홀더 ID는 '__optimistic_' 접두어
      expect(useTodoStore.getState().todos[0].id).toMatch(/^__optimistic_/);

      // 서비스 응답 완료
      resolveCreate(mockTodo);
      await addPromise;

      // 서비스 응답 후: 플레이스홀더가 실제 항목으로 교체됨
      expect(useTodoStore.getState().todos).toHaveLength(1);
      expect(useTodoStore.getState().todos[0].id).toBe('todo-1');
    });

    it('서비스 실패 시 플레이스홀더 롤백 + error 상태 설정', async () => {
      (createTodo as jest.Mock).mockRejectedValue(new Error('생성 실패'));

      await useTodoStore.getState().addTodo({ title: '새 할일', contentType: 'todo' });

      // 플레이스홀더가 제거되어 todos가 비어 있어야 함
      expect(useTodoStore.getState().todos).toHaveLength(0);
      expect(useTodoStore.getState().error).toBe('생성 실패');
    });

    it('기존 todos 가 있을 때 실패 시 기존 항목 유지', async () => {
      // 초기 상태에 기존 할일 1개 설정
      useTodoStore.setState({ todos: [mockTodo] });
      (createTodo as jest.Mock).mockRejectedValue(new Error('실패'));

      await useTodoStore.getState().addTodo({ title: '실패 할일', contentType: 'todo' });

      // 기존 항목은 유지되어야 함
      expect(useTodoStore.getState().todos).toHaveLength(1);
      expect(useTodoStore.getState().todos[0].title).toBe('기존 할일');
    });

    it('contentType=note 인 경우 notes 배열에 낙관적 추가', async () => {
      (createTodo as jest.Mock).mockResolvedValue(mockNoteTodo);

      await useTodoStore.getState().addTodo({
        title:       '새 노트',
        contentType: 'note',
        content:     '내용',
      });

      // notes 배열에 저장, todos 배열은 영향 없음
      expect(useTodoStore.getState().notes).toHaveLength(1);
      expect(useTodoStore.getState().todos).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // toggleTodo — 낙관적 업데이트
  // ══════════════════════════════════════════════════════════════════════════

  describe('toggleTodo', () => {
    beforeEach(() => {
      // 초기 상태: 미완료 할일 1개
      useTodoStore.setState({ todos: [mockTodo] });
    });

    it('서비스 호출 전 isCompleted 즉시 반전 (낙관적 업데이트)', async () => {
      let resolveToggle!: (value: Todo) => void;
      const togglePromise = new Promise<Todo>(res => { resolveToggle = res; });
      (toggleTodoComplete as jest.Mock).mockReturnValue(togglePromise);

      const storePromise = useTodoStore.getState().toggleTodo('todo-1');

      // 서비스 응답 전: isCompleted가 즉시 true로 반전되어야 함
      expect(useTodoStore.getState().todos[0].isCompleted).toBe(true);
      expect(useTodoStore.getState().todos[0].completedAt).not.toBeNull();

      const completedTodo: Todo = { ...mockTodo, isCompleted: true, completedAt: NOW };
      resolveToggle(completedTodo);
      await storePromise;

      // 서버 응답으로 최종 업데이트
      expect(useTodoStore.getState().todos[0].isCompleted).toBe(true);
    });

    it('서비스 실패 시 원래 상태로 롤백', async () => {
      (toggleTodoComplete as jest.Mock).mockRejectedValue(new Error('토글 실패'));

      await useTodoStore.getState().toggleTodo('todo-1');

      // 롤백: isCompleted가 원래 false로 돌아와야 함
      expect(useTodoStore.getState().todos[0].isCompleted).toBe(false);
      expect(useTodoStore.getState().error).toBe('토글 실패');
    });

    it('존재하지 않는 id → 서비스 호출 없이 early return', async () => {
      await useTodoStore.getState().toggleTodo('nonexistent-id');

      expect(toggleTodoComplete).not.toHaveBeenCalled();
    });

    it('toggleTodoComplete 호출 시 현재 완료 상태의 반전값을 전달', async () => {
      const completedTodo: Todo = { ...mockTodo, isCompleted: true, completedAt: NOW };
      (toggleTodoComplete as jest.Mock).mockResolvedValue(completedTodo);

      await useTodoStore.getState().toggleTodo('todo-1');

      // false → true 로 토글
      expect(toggleTodoComplete).toHaveBeenCalledWith('todo-1', true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // removeTodo
  // ══════════════════════════════════════════════════════════════════════════

  describe('removeTodo', () => {
    beforeEach(() => {
      useTodoStore.setState({ todos: [mockTodo] });
    });

    it('서비스 호출 전 즉시 todos 배열에서 제거 (낙관적 삭제)', async () => {
      let resolveDelete!: () => void;
      const deletePromise = new Promise<void>(res => { resolveDelete = res; });
      (deleteTodo as jest.Mock).mockReturnValue(deletePromise);

      const storePromise = useTodoStore.getState().removeTodo('todo-1');

      // 서비스 응답 전: todos에서 이미 제거됨
      expect(useTodoStore.getState().todos).toHaveLength(0);

      resolveDelete();
      await storePromise;
    });

    it('서비스 실패 시 원래 todos 복원', async () => {
      (deleteTodo as jest.Mock).mockRejectedValue(new Error('삭제 실패'));

      await useTodoStore.getState().removeTodo('todo-1');

      // 롤백: 원래 항목 복원
      expect(useTodoStore.getState().todos).toHaveLength(1);
      expect(useTodoStore.getState().todos[0].id).toBe('todo-1');
      expect(useTodoStore.getState().error).toBe('삭제 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // setFilter
  // ══════════════════════════════════════════════════════════════════════════

  describe('setFilter', () => {
    it('setFilter 호출 시 filter 상태 업데이트', () => {
      useTodoStore.getState().setFilter({ contentType: 'note', categoryId: 'cat-1' });

      const { filter } = useTodoStore.getState();
      expect(filter.contentType).toBe('note');
      expect(filter.categoryId).toBe('cat-1');
    });

    it('isCompleted 필터 설정', () => {
      useTodoStore.getState().setFilter({ isCompleted: true });

      expect(useTodoStore.getState().filter.isCompleted).toBe(true);
    });

    // ── ISSUE-006 회귀 테스트 ────────────────────────────────────────────────
    // Before(Sprint 4): setFilter가 filter 상태만 변경하고 fetchTodos를 재호출하지 않아
    //                   Planner 탭 목록이 필터 변경 후에도 갱신되지 않는 버그.
    // After(Sprint 5):  setFilter 내부에서 get().fetchTodos(filter) 를 즉시 호출함.

    it('[ISSUE-006] setFilter 호출 시 fetchTodos가 자동 재호출됨', async () => {
      (getTodos as jest.Mock).mockResolvedValue([mockSummary]);

      // categoryId 필터 설정
      await useTodoStore.getState().setFilter({ categoryId: 'cat-2' });

      // fetchTodos(getTodos)가 새 필터로 호출되었는지 검증
      expect(getTodos).toHaveBeenCalledTimes(1);
      expect(getTodos).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'cat-2', contentType: 'todo' }),
      );
    });

    it('[ISSUE-006] setFilter 후 todos 목록이 새 필터 결과로 갱신됨', async () => {
      // 필터 변경 후 다른 todo 반환
      const filteredSummary = { ...mockSummary, id: 'todo-filtered', title: '필터된 할일' };
      (getTodos as jest.Mock).mockResolvedValue([filteredSummary]);

      await useTodoStore.getState().setFilter({ categoryId: 'cat-filtered' });

      const { todos } = useTodoStore.getState();
      expect(todos).toHaveLength(1);
      expect(todos[0].id).toBe('todo-filtered');
    });

    it('[ISSUE-006] setFilter: isCompleted=true 필터 변경 시 fetchTodos 재호출', async () => {
      (getTodos as jest.Mock).mockResolvedValue([]);

      await useTodoStore.getState().setFilter({ isCompleted: true });

      expect(getTodos).toHaveBeenCalledWith(
        expect.objectContaining({ isCompleted: true, contentType: 'todo' }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // clearError
  // ══════════════════════════════════════════════════════════════════════════

  describe('clearError', () => {
    it('error 상태를 null로 초기화', () => {
      useTodoStore.setState({ error: '오류 메시지' });

      useTodoStore.getState().clearError();

      expect(useTodoStore.getState().error).toBeNull();
    });
  });
});
