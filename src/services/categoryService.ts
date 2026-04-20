/**
 * Category service — CRUD operations on the `categories` table.
 *
 * Responsibilities:
 *  - Fetch system default categories (user_id = NULL) + user-defined categories
 *  - Create, update, delete user-defined categories
 *  - Protect system categories from modification
 *
 * System categories (개인/업무/기타) have user_id = NULL and are read-only.
 * They are seeded in migration 004_todos_enhancement.sql.
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import type {
  Category, CreateCategoryInput, UpdateCategoryInput,
  CategoryRow,
} from '@/types';

// supabase-js v2 workaround for missing Relationships types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Maps a raw CategoryRow (snake_case) to a Category domain object (camelCase).
 */
function toCategory(row: CategoryRow): Category {
  return {
    id:        row.id,
    userId:    row.user_id,
    name:      row.name,
    color:     row.color,
    icon:      row.icon,
    createdAt: new Date(row.created_at),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all categories visible to the current user.
 * Returns system default categories (user_id = NULL) first,
 * followed by the user's own categories sorted by name.
 *
 * @returns Array of Category (system first, then user-defined alphabetically)
 */
export async function getCategories(): Promise<Category[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Fetch system categories (user_id IS NULL)
  const { data: systemRows, error: systemError } = await supa
    .from('categories')
    .select('*')
    .is('user_id', null)
    .order('name', { ascending: true }) as {
      data: CategoryRow[] | null;
      error: Error | null;
    };

  if (systemError) throw systemError;

  // Fetch user-defined categories
  const { data: userRows, error: userError } = await supa
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true }) as {
      data: CategoryRow[] | null;
      error: Error | null;
    };

  if (userError) throw userError;

  // System categories first, then user-defined
  return [...(systemRows ?? []), ...(userRows ?? [])].map(toCategory);
}

/**
 * Create a new user-defined category.
 *
 * @param input - Category creation payload (name, color, optional icon)
 * @returns Newly created Category
 */
export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supa
    .from('categories')
    .insert({
      user_id: userId,
      name:    input.name,
      color:   input.color,
      icon:    input.icon ?? null,
    })
    .select()
    .single() as { data: CategoryRow | null; error: Error | null };

  if (error || !data) throw error ?? new Error('카테고리 생성에 실패했습니다.');
  return toCategory(data);
}

/**
 * Update a user-defined category.
 * System categories (user_id = NULL) cannot be updated.
 *
 * @param categoryId - UUID of the category
 * @param updates    - Fields to change
 * @returns Updated Category
 * @throws If category is a system category or not owned by the current user
 */
export async function updateCategory(
  categoryId: string,
  updates: UpdateCategoryInput,
): Promise<Category> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Build partial patch
  const patch: Record<string, unknown> = {};
  if (updates.name  !== undefined) patch.name  = updates.name;
  if (updates.color !== undefined) patch.color = updates.color;
  if (updates.icon  !== undefined) patch.icon  = updates.icon ?? null;

  if (Object.keys(patch).length === 0) {
    // No changes — fetch and return current state
    const { data } = await supa
      .from('categories')
      .select('*')
      .eq('id', categoryId)
      .single() as { data: CategoryRow | null; error: Error | null };
    if (!data) throw new Error('카테고리를 찾을 수 없습니다.');
    return toCategory(data);
  }

  // RLS enforces user_id = auth.uid(), so system categories (user_id=NULL)
  // will fail naturally. We also explicitly require user_id match.
  const { data, error } = await supa
    .from('categories')
    .update(patch)
    .eq('id', categoryId)
    .eq('user_id', userId)
    .select()
    .single() as { data: CategoryRow | null; error: Error | null };

  if (error || !data) throw new Error('카테고리를 수정할 수 없습니다. 기본 카테고리는 수정 불가합니다.');
  return toCategory(data);
}

/**
 * Delete a user-defined category.
 * Todos referencing this category will have their category_id set to NULL (DB cascade).
 * System categories (user_id = NULL) cannot be deleted.
 *
 * @param categoryId - UUID of the category
 * @throws If category is a system category or not owned by the current user
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // RLS enforces user_id = auth.uid() — system categories (NULL) will be blocked
  const { error } = await supa
    .from('categories')
    .delete()
    .eq('id', categoryId)
    .eq('user_id', userId) as { error: Error | null };

  if (error) throw new Error('카테고리를 삭제할 수 없습니다. 기본 카테고리는 삭제 불가합니다.');
}
