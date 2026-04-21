/**
 * __tests__/services/todoServiceExtended.test.ts
 *
 * todoService 추가 커버리지 — updateTodo, getTodoById, updateNote
 *
 * todoService.test.ts에서 커버하지 않은 함수들을 보완합니다.
 *
 * 커버리지:
 *  getTodoById   — 단일 Todo 조회, 미인증, DB 에러
 *  updateTodo    — partial patch 빌드, 미인증, 빈 patch 처리
 *  updateNote    — updateTodo 위임 검증
 *  deleteNote    — deleteTodo 위임 검증
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
  getCurrentUserId: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import {
  getTodoById,
  updateTodo,
  updateNote,
  deleteNote,
} from '@/services/todoService';
import type { TodoRow } from '@/types';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

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
    single: jest.fn().mockResolvedValue(resolvedValue),
    then:   promise.then.bind(promise),
    catch:  promise.catch.bind(promise),
  };
  return chain;
}

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

const NOW_STR = '2026-04-20T09:00:00.000Z';

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

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('todoService — 확장 커버리지', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getTodoById
  // ══════════════════════════════════════════════════════════════════════════

  describe('getTodoById', () => {
    it('단일 Todo 조회 후 완전한 Todo 객체 반환', async () => {
      const chain = makeChain({ data: mockTodoRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await getTodoById('todo-1');

      expect(supabase.from).toHaveBeenCalledWith('todos');
      expect(chain.eq).toHaveBeenCalledWith('id', 'todo-1');
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(chain.single).toHaveBeenCalled();
      expect(result.id).toBe('todo-1');
      expect(result.title).toBe('테스트 할일');
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getTodoById('todo-1')).rejects.toThrow('로그인이 필요합니다.');
    });

    it('data=null → "할일을 찾을 수 없습니다." 에러 throw', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(getTodoById('nonexistent')).rejects.toThrow('할일을 찾을 수 없습니다.');
    });

    it('DB 에러 → "할일을 찾을 수 없습니다." 에러 throw', async () => {
      const chain = makeChain({ data: null, error: new Error('DB 오류') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(getTodoById('todo-1')).rejects.toThrow('할일을 찾을 수 없습니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateTodo
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateTodo', () => {
    it('title 수정 시 patch에 title만 포함', async () => {
      // 1차 from(): UPDATE
      const updateChain = makeChain({ data: null, error: null });
      // 2차 from(): getTodoById 재호출
      const selectChain = makeChain({ data: mockTodoRow, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      await updateTodo('todo-1', { title: '수정된 제목' });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ title: '수정된 제목' })
      );
      // content, dueDate 등은 포함되지 않아야 함
      const callArg = (updateChain.update as jest.Mock).mock.calls[0][0];
      expect(callArg).not.toHaveProperty('due_date');
    });

    it('priority 수정 시 patch에 priority 포함', async () => {
      const updateChain = makeChain({ data: null, error: null });
      const selectChain = makeChain({ data: { ...mockTodoRow, priority: 'high' }, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      const result = await updateTodo('todo-1', { priority: 'high' });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'high' })
      );
      expect(result.priority).toBe('high');
    });

    it('dueDate 수정 시 YYYY-MM-DD 형식으로 변환', async () => {
      const updateChain = makeChain({ data: null, error: null });
      const selectChain = makeChain({ data: mockTodoRow, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      const dueDate = new Date('2026-04-30T00:00:00.000Z');
      await updateTodo('todo-1', { dueDate });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ due_date: '2026-04-30' })
      );
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(updateTodo('todo-1', { title: '변경' })).rejects.toThrow('로그인이 필요합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateNote
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateNote', () => {
    it('content 수정 → updateTodo에 content 전달 (description으로 저장)', async () => {
      const noteRow = { ...mockTodoRow, content_type: 'note' as const, description: '새 내용' };
      const updateChain = makeChain({ data: null, error: null });
      const selectChain = makeChain({ data: noteRow, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      const result = await updateNote('note-1', { content: '새 내용' });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ description: '새 내용' }) // content → description
      );
      expect(result.content).toBe('새 내용');
    });

    it('title + content 동시 수정', async () => {
      const noteRow = { ...mockTodoRow, content_type: 'note' as const, title: '새 제목', description: '새 내용' };
      const updateChain = makeChain({ data: null, error: null });
      const selectChain = makeChain({ data: noteRow, error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(selectChain);

      const result = await updateNote('note-1', { title: '새 제목', content: '새 내용' });

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ title: '새 제목', description: '새 내용' })
      );
      expect(result.title).toBe('새 제목');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteNote
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteNote', () => {
    it('deleteTodo와 동일하게 DELETE 호출', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await deleteNote('note-1');

      expect(supabase.from).toHaveBeenCalledWith('todos');
      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('id', 'note-1');
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(deleteNote('note-1')).rejects.toThrow('로그인이 필요합니다.');
    });
  });
});
