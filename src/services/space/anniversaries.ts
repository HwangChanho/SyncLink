/**
 * space/anniversaries — Space 기념일/D-day CRUD.
 * Phase 2.3 분할 — spaceService.ts 의 하위 모듈.
 */

import { getCurrentUserId } from '@/lib/supabase';
import type { Anniversary, CreateAnniversaryInput, AnniversaryRow } from '@/types';
import { supa, toAnniversary } from './_internals';

/** 모든 기념일을 daysFromToday 오름차순으로. */
export async function getAnniversaries(spaceId: string): Promise<Anniversary[]> {
  const { data: rows, error } = await supa
    .from('anniversaries').select('*').eq('space_id', spaceId) as {
      data: AnniversaryRow[] | null; error: Error | null;
    };
  if (error) throw error;
  return (rows ?? [])
    .map((r: AnniversaryRow) => toAnniversary(r))
    .sort((a: Anniversary, b: Anniversary) => a.daysFromToday - b.daysFromToday);
}

/** Add anniversary. date 는 'YYYY-MM-DD' 로 변환 (DB 는 날짜만 저장). */
export async function createAnniversary(
  spaceId: string,
  input: CreateAnniversaryInput,
): Promise<Anniversary> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: row, error } = await supa
    .from('anniversaries')
    .insert({
      space_id: spaceId,
      title: input.title,
      date: input.date.toISOString().split('T')[0],
      repeat_yearly: input.repeatYearly ?? false,
      created_by: userId,
    })
    .select()
    .single() as { data: AnniversaryRow | null; error: Error | null };

  if (error || !row) throw error ?? new Error('기념일 생성에 실패했습니다.');
  return toAnniversary(row);
}

/** Delete anniversary by id. */
export async function deleteAnniversary(anniversaryId: string): Promise<void> {
  const { error } = await supa
    .from('anniversaries').delete().eq('id', anniversaryId) as { error: Error | null };
  if (error) throw error;
}
