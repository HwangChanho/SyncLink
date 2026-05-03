/**
 * space/members — 멤버 라이프사이클: 탈퇴, 소유권 이전, 강퇴, 색상 변경.
 * Phase 2.3 분할 — spaceService.ts 의 하위 모듈.
 */

import { getCurrentUserId } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import type { SpaceMember, SpaceMemberRow, UserRow } from '@/types';
import {
  supa, assertOwner, serializeSupabaseError, toSpaceMember,
} from './_internals';

/**
 * Leave a space — IDEA-011-A:
 *   (a) 본인이 만든 일정의 이 Space 공유 해제 (event_shares DELETE)
 *   (b) owner 탈퇴 + 다른 멤버 존재 시 가장 오래된 멤버에게 소유권 이전
 *   (c) 본인 멤버십 DELETE
 *   (d) 마지막 멤버였으면 spaces 행도 삭제
 */
export async function leaveSpace(spaceId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: allMembers, error: fetchError } = await supa
    .from('space_members')
    .select('*')
    .eq('space_id', spaceId)
    .order('joined_at', { ascending: true }) as {
      data: SpaceMemberRow[] | null; error: Error | null;
    };

  if (fetchError) throw fetchError;

  const myMembership = (allMembers ?? []).find((m: SpaceMemberRow) => m.user_id === userId);
  if (!myMembership) throw new Error('해당 Space의 멤버가 아닙니다.');

  const otherMembers = (allMembers ?? []).filter((m: SpaceMemberRow) => m.user_id !== userId);

  // 본인 events.id 목록 조회 후 event_shares 정리. 멤버십 삭제 *전에*
  // 처리해야 RLS 권한 잃기 전에 정리 가능.
  const { data: myEventRows, error: myEventsError } = await supa
    .from('events').select('id').eq('user_id', userId) as {
      data: { id: string }[] | null; error: Error | null;
    };

  if (myEventsError) throw myEventsError;

  const myEventIds = (myEventRows ?? []).map((r: { id: string }) => r.id);
  if (myEventIds.length > 0) {
    const { error: sharesDeleteError } = await supa
      .from('event_shares')
      .delete()
      .eq('space_id', spaceId)
      .in('event_id', myEventIds) as { error: Error | null };

    if (sharesDeleteError) throw sharesDeleteError;
  }

  // owner 탈퇴 + 다른 멤버 존재 → 가장 오래된 멤버 (joined_at ASC[0]) 에게 이전
  if (myMembership.role === 'owner' && otherMembers.length > 0) {
    const nextOwner = otherMembers[0];
    if (nextOwner) {
      const { error: transferError } = await supa
        .from('space_members').update({ role: 'owner' }).eq('id', nextOwner.id) as {
          error: Error | null;
        };
      if (transferError) throw transferError;
    }
  }

  const { error: deleteError } = await supa
    .from('space_members').delete().eq('id', myMembership.id) as { error: Error | null };
  if (deleteError) throw deleteError;

  if (otherMembers.length === 0) {
    const { error: spaceDeleteError } = await supa
      .from('spaces').delete().eq('id', spaceId) as { error: Error | null };
    if (spaceDeleteError) throw spaceDeleteError;
  }
}

/**
 * Explicit ownership transfer (IDEA-011-B):
 *   1. caller = current owner (assertOwner)
 *   2. target ∈ space_members
 *   3. target ≠ caller
 *   (a) target.role → 'owner', (b) caller.role → 'member' (sequential).
 *
 * production-grade implementation 은 RPC / DB transaction (Phase C) 권장.
 */
export async function transferOwnership(
  spaceId: string,
  newOwnerUserId: string,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  if (newOwnerUserId === userId) {
    throw new Error('자기 자신에게 소유권을 양도할 수 없습니다.');
  }

  await assertOwner(spaceId, userId);

  const { data: targetMembership, error: memberFetchError } = await supa
    .from('space_members')
    .select('id, role')
    .eq('space_id', spaceId)
    .eq('user_id', newOwnerUserId)
    .single() as { data: { id: string; role: string } | null; error: Error | null };

  if (memberFetchError || !targetMembership) {
    throw new Error('소유권을 양도할 멤버가 해당 Space에 존재하지 않습니다.');
  }

  const { error: promoteError } = await supa
    .from('space_members')
    .update({ role: 'owner' })
    .eq('space_id', spaceId)
    .eq('user_id', newOwnerUserId) as { error: Error | null };

  if (promoteError) {
    void logError({
      context: 'space.transfer.promote',
      error:   promoteError,
      userId,
      details: { spaceId, newOwnerUserId, supabaseError: serializeSupabaseError(promoteError) },
    });
    throw new Error(`소유권 양도에 실패했습니다: ${promoteError.message}`);
  }

  const { error: demoteError } = await supa
    .from('space_members')
    .update({ role: 'member' })
    .eq('space_id', spaceId)
    .eq('user_id', userId) as { error: Error | null };

  if (demoteError) {
    void logError({
      context: 'space.transfer.demote',
      error:   demoteError,
      userId,
      details: { spaceId, newOwnerUserId, supabaseError: serializeSupabaseError(demoteError) },
    });
    throw new Error(`소유권 양도에 실패했습니다: ${demoteError.message}`);
  }
}

/** 강퇴 (owner only). 자기 자신은 제외 — leaveSpace 사용. */
export async function removeMember(spaceId: string, targetUserId: string): Promise<void> {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) throw new Error('로그인이 필요합니다.');

  await assertOwner(spaceId, currentUserId);

  if (targetUserId === currentUserId) {
    throw new Error('자신을 추방할 수 없습니다. Space 탈퇴 기능을 사용하세요.');
  }

  const { error } = await supa
    .from('space_members').delete().eq('space_id', spaceId).eq('user_id', targetUserId) as {
      error: Error | null;
    };
  if (error) throw error;
}

/**
 * 멤버 색상 변경. 본인 색은 누구나, 타인은 owner 만.
 */
export async function updateMemberColor(
  spaceId: string,
  targetUserId: string,
  color: string,
): Promise<SpaceMember> {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) throw new Error('로그인이 필요합니다.');

  if (targetUserId !== currentUserId) {
    await assertOwner(spaceId, currentUserId);
  }

  const { data: updatedMember, error: updateError } = await supa
    .from('space_members')
    .update({ color })
    .eq('space_id', spaceId)
    .eq('user_id', targetUserId)
    .select()
    .single() as { data: SpaceMemberRow | null; error: Error | null };

  if (updateError || !updatedMember) {
    throw updateError ?? new Error('색상 업데이트에 실패했습니다.');
  }

  const { data: userRow, error: userError } = await supa
    .from('users').select('*').eq('id', targetUserId).single() as {
      data: UserRow | null; error: Error | null;
    };

  if (userError || !userRow) throw userError ?? new Error('사용자 정보를 가져오지 못했습니다.');

  return toSpaceMember(updatedMember, userRow);
}
