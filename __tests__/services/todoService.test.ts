/**
 * __tests__/services/todoService.test.ts
 *
 * TASK-410: Todo 서비스 테스트 스위트
 *
 * 전략:
 *  - @/lib/supabase 전체를 mock → 실제 DB 호출 차단
 *  - getCurrentUserId mock → 인증 상태 제어
 *  - makeChain() 헬퍼: Supabase 쿼리 체인을 thenable + .single() 양쪽 지원
 *    (eventService.test.ts와 동일한 패턴)
 *  - toggleTodoComplete는 내부에서 getTodoById를 재호출하므로
 *    mockReturnValueOnce 체이닝으로 두 번의 from() 호출을 구분
 *
 * 커버리지:
 *  getTodos          — 기본 동작, contentType/isCompleted/categoryId 필터, 미인증
 *  createTodo        — INSERT 호출 + 반환값 검증, 미인증
 *  toggleTodoComplete— false→true(completedAt 설정), true→false(completedAt null)
 *  deleteTodo        — user_id eq 조건으로 본인 항목만 삭제, 미인증
 *  createNote        — contentType='note' 로 저장 확인
 *  getNotes          — content_type='note' 필터 확인
 *  reorderTodos      — sort_order 일괄 upsert, 미인증
 *
 * @task TASK-410
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
  getCurrentUserId: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import {
  getTodos,
  createTodo,
  deleteTodo,
  toggleTodoComplete,
  getNotes,
  createNote,
  reorderTodos,
} from '@/services/todoService';
import type { TodoRow } from '@/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * Supabase 쿼리 체인 mock 생성.
 *
 * - 모든 builder 메서드는 this 반환 (체이닝 지원)
 * - chain 자체가 thenable → await chain 시 resolvedValue로 resolve
 * - .single()도 resolvedValue로 resolve
 */
function makeChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    neq:    jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    lte:    jest.fn().mockReturnThis(),
    gte:    jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    // .single() → Promise<resolvedValue>
    single: jest.fn().mockResolvedValue(resolvedValue),
    // chain 자체를 await 할 수 있도록 thenable 처리
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const NOW_STR = '2026-04-20T09:00:00.000Z';

/** 기본 TodoRow 픽스처 (todo 타입) */
const mockTodoRow: TodoRow = {
  id:           'todo-1',
  user_id:      'user-123',
  space_id:     null,
  title:        '테스트 할일',
  description:  null,
  content_type: 'todo',
  due_date:     null,
  priority:     'medium',
  is_completed: false,
  completed_at: null,
  category_id:  null,
  sort_order:   0,
  event_id:     null,
  created_at:   NOW_STR,
  updated_at:   NOW_STR,
};

/** 완료된 TodoRow 픽스처 */
const mockCompletedRow: TodoRow = {
  ...mockTodoRow,
  id:           'todo-2',
  is_completed: true,
  completed_at: NOW_STR,
};

/** Note 타입 TodoRow 픽스처 */
const mockNoteRow: TodoRow = {
  ...mockTodoRow,
  id:           'note-1',
  title:        '테스트 노트',
  content_type: 'note',
  description:  '노트 본문 내용',
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('todoService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: 인증된 유저
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getTodos
  // ══════════════════════════════════════════════════════════════════════════

  describe('getTodos', () => {
    it('기본 호출 시 content_type=todo 필터로 TodoSummary 배열 반환', async () => {
      const chain = makeChain({ data: [mockTodoRow], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await getTodos();

      expect(supabase.from).toHaveBeenCalledWith('todos');
      // content_type 기본값 'todo' 확인
      expect(chain.eq).toHaveBeenCalledWith('content_type', 'todo');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('todo-1');
      expect(result[0].title).toBe('테스트 할일');
      expect(result[0].isCompleted).toBe(false);
    });

    it('filter.contentType 명시 시 해당 타입으로 쿼리', async () => {
      const chain = makeChain({ data: [mockNoteRow], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await getTodos({ contentType: 'note' });

      expect(chain.eq).toHaveBeenCalledWith('content_type', 'note');
    });

    it('filter.isCompleted=true 시 is_completed 필터 추가', async () => {
      const chain = makeChain({ data: [mockCompletedRow], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await getTodos({ isCompleted: true });

      expect(chain.eq).toHaveBeenCalledWith('is_completed', true);
      expect(result[0].isCompleted).toBe(true);
    });

    it('filter.categoryId 지정 시 category_id 필터 추가', async () => {
      const chain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await getTodos({ categoryId: 'cat-1' });

      expect(chain.eq).toHaveBeenCalledWith('category_id', 'cat-1');
    });

    it('빈 배열 반환 시 빈 배열 반환 (에러 없음)', async () => {
      const chain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await getTodos();

      expect(result).toEqual([]);
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getTodos()).rejects.toThrow('로그인이 필요합니다.');
    });

    it('DB 에러 → 에러 throw', async () => {
      const chain = makeChain({ data: null, error: new Error('DB 오류') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(getTodos()).rejects.toThrow('DB 오류');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createTodo
  // ══════════════════════════════════════════════════════════════════════════

  describe('createTodo', () => {
    it('INSERT 호출 후 생성된 Todo 반환', async () => {
      const chain = makeChain({ data: mockTodoRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await createTodo({
        title:       '새 할일',
        contentType: 'todo',
      });

      expect(supabase.from).toHaveBeenCalledWith('todos');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id:      'user-123',
          title:        '새 할일',
          content_type: 'todo',
          is_completed: false,
        })
      );
      // .select().single() 체인 호출 확인
      expect(chain.select).toHaveBeenCalled();
      expect(chain.single).toHaveBeenCalled();
      expect(result.id).toBe('todo-1');
      expect(result.title).toBe('테스트 할일');
      expect(result.contentType).toBe('todo');
    });

    it('priority 기본값 medium 으로 INSERT', async () => {
      const chain = makeChain({ data: mockTodoRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await createTodo({ title: '할일', contentType: 'todo' });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'medium' })
      );
    });

    it('dueDate 지정 시 due_date ISO 날짜 문자열로 변환하여 INSERT', async () => {
      const chain = makeChain({ data: mockTodoRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const dueDate = new Date('2026-04-25T00:00:00.000Z');
      await createTodo({ title: '마감 있는 할일', contentType: 'todo', dueDate });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ due_date: '2026-04-25' })
      );
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(
        createTodo({ title: '새 할일', contentType: 'todo' })
      ).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // toggleTodoComplete
  // ══════════════════════════════════════════════════════════════════════════

  describe('toggleTodoComplete', () => {
    it('false → true: is_completed=true, completed_at 설정', async () => {
      // 1차 from(): UPDATE
      const updateChain = makeChain({ data: null, error: null });
      // 2차 from(): getTodoById → SELECT .single()
      const selectChain = makeChain({ data: mockCompletedRow, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      const result = await toggleTodoComplete('todo-2', true);

      // UPDATE 호출 확인
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_completed: true,
          completed_at: expect.any(String), // ISO 문자열
        })
      );
      // user_id, id eq 조건 확인 (RLS)
      expect(updateChain.eq).toHaveBeenCalledWith('id', 'todo-2');
      expect(updateChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      // 반환값 검증
      expect(result.isCompleted).toBe(true);
      expect(result.completedAt).not.toBeNull();
    });

    it('true → false: is_completed=false, completed_at=null', async () => {
      const updateChain = makeChain({ data: null, error: null });
      const incompleteRow: TodoRow = { ...mockTodoRow, is_completed: false, completed_at: null };
      const selectChain = makeChain({ data: incompleteRow, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      const result = await toggleTodoComplete('todo-1', false);

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          is_completed: false,
          completed_at: null,
        })
      );
      expect(result.isCompleted).toBe(false);
      expect(result.completedAt).toBeNull();
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(toggleTodoComplete('todo-1', true)).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteTodo
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteTodo', () => {
    it('DELETE 호출 시 user_id eq 조건 포함 (본인 항목만 삭제)', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await deleteTodo('todo-1');

      expect(supabase.from).toHaveBeenCalledWith('todos');
      expect(chain.delete).toHaveBeenCalled();
      // 본인 항목만 삭제되도록 id + user_id eq 조건 확인
      expect(chain.eq).toHaveBeenCalledWith('id', 'todo-1');
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(deleteTodo('todo-1')).rejects.toThrow('로그인이 필요합니다.');
    });

    it('DB 에러 → 에러 throw', async () => {
      const chain = makeChain({ data: null, error: new Error('삭제 실패') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(deleteTodo('todo-1')).rejects.toThrow('삭제 실패');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createNote
  // ══════════════════════════════════════════════════════════════════════════

  describe('createNote', () => {
    it('contentType="note" 로 저장 확인', async () => {
      const chain = makeChain({ data: mockNoteRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await createNote({ title: '새 노트', content: '내용' });

      // content_type='note' 로 INSERT 확인
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content_type: 'note',
          title:        '새 노트',
          description:  '내용',  // domain 'content' → DB 'description'
        })
      );
      expect(result.contentType).toBe('note');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getNotes
  // ══════════════════════════════════════════════════════════════════════════

  describe('getNotes', () => {
    it('content_type="note" 필터로 Note 목록 반환', async () => {
      const chain = makeChain({ data: [mockNoteRow], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await getNotes();

      expect(supabase.from).toHaveBeenCalledWith('todos');
      // content_type='note' 필터 확인
      expect(chain.eq).toHaveBeenCalledWith('content_type', 'note');
      expect(result).toHaveLength(1);
      expect(result[0].contentType).toBe('note');
      expect(result[0].content).toBe('노트 본문 내용'); // description → content 매핑
    });

    it('updated_at 내림차순 정렬 확인', async () => {
      const chain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await getNotes();

      expect(chain.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getNotes()).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // reorderTodos
  // ══════════════════════════════════════════════════════════════════════════

  describe('reorderTodos', () => {
    it('ids 배열 순서대로 sort_order를 upsert', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await reorderTodos(['todo-1', 'todo-2', 'todo-3']);

      expect(supabase.from).toHaveBeenCalledWith('todos');
      expect(chain.upsert).toHaveBeenCalledWith(
        [
          { id: 'todo-1', sort_order: 0 },
          { id: 'todo-2', sort_order: 1 },
          { id: 'todo-3', sort_order: 2 },
        ],
        { onConflict: 'id', ignoreDuplicates: false }
      );
    });

    it('빈 배열 전달 시 upsert 호출만 하고 에러 없음', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(reorderTodos([])).resolves.toBeUndefined();
      expect(chain.upsert).toHaveBeenCalledWith([], expect.any(Object));
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(reorderTodos(['todo-1'])).rejects.toThrow('로그인이 필요합니다.');
    });
  });
});
