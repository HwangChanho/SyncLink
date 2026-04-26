/**
 * __tests__/services/categoryService.test.ts
 *
 * TASK-401: Category 서비스 테스트 스위트
 *
 * 전략:
 *  - @/lib/supabase 전체를 mock → 실제 DB 호출 차단
 *  - makeChain() 헬퍼: Supabase 쿼리 체인을 thenable + .single() 양쪽 지원
 *    (todoService.test.ts와 동일한 패턴)
 *  - getCategories는 내부적으로 2번의 from() 호출을 하므로
 *    mockReturnValueOnce 체이닝으로 구분
 *
 * 커버리지:
 *  getCategories    — system + user 카테고리 합산, 미인증, DB 에러
 *  createCategory   — INSERT 호출 + 반환값 검증, 미인증, icon 옵션
 *  updateCategory   — UPDATE 호출 (partial patch), 미인증, 빈 patch 처리
 *  deleteCategory   — DELETE 호출, user_id eq 조건 (시스템 카테고리 보호)
 *
 * @task TASK-401
 */

// ─── Mock 선언 ────────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn() },
  getCurrentUserId: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { supabase, getCurrentUserId } from '@/lib/supabase';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/services/categoryService';
import type { CategoryRow } from '@/types';

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
    is:     jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
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

/** 시스템 기본 카테고리 (user_id = null) */
const mockSystemRow: CategoryRow = {
  id:         'cat-system-1',
  user_id:    null,
  name:       '개인',
  color:      '#4A90E2',
  icon:       'person',
  created_at: NOW_STR,
};

/** 사용자 정의 카테고리 (user_id = 'user-123') */
const mockUserRow: CategoryRow = {
  id:         'cat-user-1',
  user_id:    'user-123',
  name:       '운동',
  color:      '#E24A4A',
  icon:       'fitness',
  created_at: NOW_STR,
};

/** icon 없는 카테고리 픽스처 */
const mockNoIconRow: CategoryRow = {
  id:         'cat-user-2',
  user_id:    'user-123',
  name:       '학습',
  color:      '#4AE29B',
  icon:       null,
  created_at: NOW_STR,
};

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('categoryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 기본: 인증된 유저
    (getCurrentUserId as jest.Mock).mockResolvedValue('user-123');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCategories
  // ══════════════════════════════════════════════════════════════════════════

  describe('getCategories', () => {
    it('시스템 카테고리 + 유저 카테고리 합산 반환 (시스템 먼저)', async () => {
      // 1차 from(): 시스템 카테고리 쿼리 (is('user_id', null))
      const systemChain = makeChain({ data: [mockSystemRow], error: null });
      // 2차 from(): 유저 카테고리 쿼리 (eq('user_id', 'user-123'))
      const userChain = makeChain({ data: [mockUserRow], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      const result = await getCategories();

      // 총 2개 반환 (시스템 1 + 유저 1)
      expect(result).toHaveLength(2);
      // 시스템 카테고리가 먼저
      expect(result[0].id).toBe('cat-system-1');
      expect(result[0].userId).toBeNull();
      expect(result[1].id).toBe('cat-user-1');
      expect(result[1].userId).toBe('user-123');
    });

    it('시스템 카테고리 쿼리 시 is(user_id, null) 조건 사용', async () => {
      const systemChain = makeChain({ data: [], error: null });
      const userChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      await getCategories();

      // is() 호출로 NULL 체크 (= 대신 IS NULL 사용)
      expect(systemChain.is).toHaveBeenCalledWith('user_id', null);
    });

    it('유저 카테고리 쿼리 시 user_id eq 조건 사용', async () => {
      const systemChain = makeChain({ data: [], error: null });
      const userChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      await getCategories();

      expect(userChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('두 쿼리 모두 name 오름차순 정렬', async () => {
      const systemChain = makeChain({ data: [], error: null });
      const userChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      await getCategories();

      expect(systemChain.order).toHaveBeenCalledWith('name', { ascending: true });
      expect(userChain.order).toHaveBeenCalledWith('name', { ascending: true });
    });

    it('시스템 카테고리가 없으면 유저 카테고리만 반환', async () => {
      const systemChain = makeChain({ data: [], error: null });
      const userChain = makeChain({ data: [mockUserRow, mockNoIconRow], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      const result = await getCategories();

      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe('user-123');
    });

    it('두 쿼리 결과가 모두 비어 있으면 빈 배열 반환', async () => {
      const systemChain = makeChain({ data: [], error: null });
      const userChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      const result = await getCategories();

      expect(result).toEqual([]);
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(getCategories()).rejects.toThrow('로그인이 필요합니다.');
    });

    it('시스템 카테고리 쿼리 에러 → 에러 throw', async () => {
      const systemChain = makeChain({ data: null, error: new Error('DB 오류') });
      (supabase.from as jest.Mock).mockReturnValue(systemChain);

      await expect(getCategories()).rejects.toThrow('DB 오류');
    });

    it('Row→Domain 매핑 확인 (snake_case → camelCase)', async () => {
      const systemChain = makeChain({ data: [mockSystemRow], error: null });
      const userChain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock)
        .mockReturnValueOnce(systemChain)
        .mockReturnValueOnce(userChain);

      const result = await getCategories();

      const cat = result[0];
      expect(cat.id).toBe('cat-system-1');
      expect(cat.userId).toBeNull();
      // Sprint 19 — system rows are localised via category.builtin.* keys.
      // The displayed name now depends on the active i18n locale, not the
      // raw DB value. Match against both Korean and English defaults so
      // the test passes regardless of the locale the test runner picks up.
      expect(['개인', 'Personal']).toContain(cat.name);
      expect(cat.color).toBe('#4A90E2');
      expect(cat.icon).toBe('person');
      expect(cat.createdAt).toBeInstanceOf(Date);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createCategory
  // ══════════════════════════════════════════════════════════════════════════

  describe('createCategory', () => {
    it('INSERT 호출 후 생성된 Category 반환', async () => {
      const chain = makeChain({ data: mockUserRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await createCategory({
        name:  '운동',
        color: '#E24A4A',
        icon:  'fitness',
      });

      expect(supabase.from).toHaveBeenCalledWith('categories');
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          name:    '운동',
          color:   '#E24A4A',
          icon:    'fitness',
        })
      );
      expect(chain.select).toHaveBeenCalled();
      expect(chain.single).toHaveBeenCalled();
      expect(result.id).toBe('cat-user-1');
      expect(result.name).toBe('운동');
    });

    it('icon 미제공 시 null로 INSERT', async () => {
      const chain = makeChain({ data: mockNoIconRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await createCategory({ name: '학습', color: '#4AE29B' });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ icon: null })
      );
    });

    it('user_id가 현재 로그인 유저로 설정됨', async () => {
      const chain = makeChain({ data: mockUserRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await createCategory({ name: '테스트', color: '#000000' });

      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-123' })
      );
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(
        createCategory({ name: '테스트', color: '#000000' })
      ).rejects.toThrow('로그인이 필요합니다.');
    });

    it('DB 에러 → 에러 throw', async () => {
      const chain = makeChain({ data: null, error: new Error('생성 실패') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(
        createCategory({ name: '테스트', color: '#000000' })
      ).rejects.toThrow('생성 실패');
    });

    it('data=null + error=null → 기본 에러 메시지 throw', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(
        createCategory({ name: '테스트', color: '#000000' })
      ).rejects.toThrow('카테고리 생성에 실패했습니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateCategory
  // ══════════════════════════════════════════════════════════════════════════

  describe('updateCategory', () => {
    it('name만 업데이트 시 name만 patch에 포함', async () => {
      const updatedRow = { ...mockUserRow, name: '새 이름' };
      const chain = makeChain({ data: updatedRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await updateCategory('cat-user-1', { name: '새 이름' });

      expect(chain.update).toHaveBeenCalledWith({ name: '새 이름' });
      expect(result.name).toBe('새 이름');
    });

    it('color만 업데이트 시 color만 patch에 포함', async () => {
      const updatedRow = { ...mockUserRow, color: '#00FF00' };
      const chain = makeChain({ data: updatedRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await updateCategory('cat-user-1', { color: '#00FF00' });

      expect(chain.update).toHaveBeenCalledWith({ color: '#00FF00' });
    });

    it('user_id eq 조건으로 본인 카테고리만 수정 (시스템 카테고리 보호)', async () => {
      const chain = makeChain({ data: mockUserRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await updateCategory('cat-user-1', { name: '변경' });

      expect(chain.eq).toHaveBeenCalledWith('id', 'cat-user-1');
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('name + color + icon 모두 업데이트 가능', async () => {
      const updatedRow = { ...mockUserRow, name: '새 이름', color: '#FF0000', icon: 'star' };
      const chain = makeChain({ data: updatedRow, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await updateCategory('cat-user-1', { name: '새 이름', color: '#FF0000', icon: 'star' });

      expect(chain.update).toHaveBeenCalledWith({
        name:  '새 이름',
        color: '#FF0000',
        icon:  'star',
      });
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(updateCategory('cat-1', { name: '변경' })).rejects.toThrow('로그인이 필요합니다.');
    });

    it('data=null → 시스템 카테고리 수정 불가 에러 throw', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(
        updateCategory('cat-system-1', { name: '변경' })
      ).rejects.toThrow('카테고리를 수정할 수 없습니다. 기본 카테고리는 수정 불가합니다.');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteCategory
  // ══════════════════════════════════════════════════════════════════════════

  describe('deleteCategory', () => {
    it('DELETE 호출 시 id + user_id eq 조건 포함 (시스템 카테고리 보호)', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await deleteCategory('cat-user-1');

      expect(supabase.from).toHaveBeenCalledWith('categories');
      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('id', 'cat-user-1');
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-123');
    });

    it('미인증 상태 → 에러 throw', async () => {
      (getCurrentUserId as jest.Mock).mockResolvedValue(null);

      await expect(deleteCategory('cat-1')).rejects.toThrow('로그인이 필요합니다.');
    });

    it('DB 에러 → 시스템 카테고리 삭제 불가 에러 메시지 throw', async () => {
      const chain = makeChain({ data: null, error: new Error('삭제 실패') });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await expect(
        deleteCategory('cat-system-1')
      ).rejects.toThrow('카테고리를 삭제할 수 없습니다. 기본 카테고리는 삭제 불가합니다.');
    });

    it('삭제 성공 시 undefined 반환', async () => {
      const chain = makeChain({ data: null, error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await deleteCategory('cat-user-1');

      expect(result).toBeUndefined();
    });
  });
});
