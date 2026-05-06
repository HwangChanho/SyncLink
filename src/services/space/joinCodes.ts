/**
 * space/joinCodes — 초대 코드 발급/검증/소비 + 코드 기반 join.
 * Phase 2.3 분할 — spaceService.ts 의 하위 모듈.
 */

import { getCurrentUserId } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import { getMemberColor } from '@/constants/colors';
import type { Space, SpaceSummary, SpaceRow, SpaceMemberRow } from '@/types';
import {
  supa, generateCode, assertOwner, serializeSupabaseError, toSpaceSummary,
} from './_internals';
import { getSpaceById } from './crud';

/**
 * Join via invite code. 만료/사용 한도/이미 멤버/Couple 2명 cap 검증 후
 * 멤버십 INSERT + uses_count 원자적 +1.
 */
export async function joinSpaceByInviteCode(inviteCode: string): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Build-90 fix: spaces SELECT RLS 가 멤버/owner 만 허용해 외부 참여자가
  // invite_code 로 lookup 하면 0 row → "유효하지 않은 초대 코드". migration
  // 030 의 SECURITY DEFINER RPC `find_space_by_invite_code` 통해 우회.
  const { data: spaceRows, error: spaceError } = await supa
    .rpc('find_space_by_invite_code', { code: inviteCode.toUpperCase() }) as {
      data: SpaceRow[] | null; error: Error | null;
    };

  const spaceRow = spaceRows?.[0] ?? null;
  if (spaceError || !spaceRow) {
    throw new Error('유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.');
  }

  // IDEA-016: 만료 체크
  if (spaceRow.invite_code_expires_at !== null) {
    const expiresAt = new Date(spaceRow.invite_code_expires_at);
    if (expiresAt < new Date()) {
      throw new Error('초대 코드가 만료되었습니다. Space 관리자에게 새 코드를 요청하세요.');
    }
  }

  // IDEA-016: 사용 횟수 한도 (NULL 안전: ?? 0)
  const usesCount = spaceRow.invite_code_uses_count ?? 0;
  if (
    spaceRow.invite_code_max_uses !== null &&
    usesCount >= spaceRow.invite_code_max_uses
  ) {
    throw new Error('초대 코드 사용 한도에 도달했습니다. Space 관리자에게 새 코드를 요청하세요.');
  }

  const { data: currentMembers, error: memberFetchError } = await supa
    .from('space_members').select('*').eq('space_id', spaceRow.id) as {
      data: SpaceMemberRow[] | null; error: Error | null;
    };

  if (memberFetchError) throw memberFetchError;

  const memberList = currentMembers ?? [];

  if (memberList.some((m: SpaceMemberRow) => m.user_id === userId)) {
    throw new Error('이미 참여 중인 Space입니다.');
  }

  if (spaceRow.type === 'couple' && memberList.length >= 2) {
    throw new Error('커플 Space는 최대 2명까지 참여할 수 있습니다.');
  }

  const memberColor = getMemberColor(memberList.length);

  const { error: insertError } = await supa
    .from('space_members')
    .insert({ space_id: spaceRow.id, user_id: userId, role: 'member', color: memberColor }) as {
      error: Error | null;
    };

  if (insertError) {
    const errMsg = (insertError as unknown as { message?: string }).message ?? '';
    if (errMsg.includes('couple_space_full')) {
      throw new Error('커플 Space는 최대 2명까지 참여할 수 있습니다.');
    }
    throw insertError;
  }

  // IDEA-016: 카운터 +1 (optimistic concurrency: invite_code 도 같이 비교)
  const { error: counterError } = await supa
    .from('spaces')
    .update({ invite_code_uses_count: usesCount + 1 })
    .eq('id', spaceRow.id)
    .eq('invite_code', spaceRow.invite_code) as { error: Error | null };

  if (counterError) {
    void logError({
      context: 'space.join.counter',
      error:   counterError,
      userId,
      details: { spaceId: spaceRow.id, supabaseError: serializeSupabaseError(counterError) },
    });
  }

  return getSpaceById(spaceRow.id);
}

/**
 * 초대 코드 재발급 (owner 만). UNIQUE 충돌 시 최대 10회 retry.
 * trg_reset_invite_code_uses 트리거가 invite_code 변경 시 uses_count=0 자동 reset.
 */
export async function regenerateInviteCode(spaceId: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  await assertOwner(spaceId, userId);

  const MAX_REGEN_ATTEMPTS = 10;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
    const newCode = generateCode();

    const { error: updateError } = await supa
      .from('spaces').update({ invite_code: newCode }).eq('id', spaceId) as {
        error: Error | null;
      };

    if (!updateError) return newCode;

    const errCode = (updateError as unknown as { code?: string }).code ?? '';
    const errMsg  = (updateError as unknown as { message?: string }).message ?? '';
    const isCollision = errCode === '23505' || errMsg.includes('23505') || errMsg.includes('unique');

    if (!isCollision) throw updateError;

    void logError({
      context: 'space.regen.collision',
      error:   updateError,
      userId,
      details: { spaceId, attempt, supabaseError: serializeSupabaseError(updateError) },
    });
    lastError = updateError;
  }

  throw lastError ?? new Error('초대 코드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}

/** Space 미리보기 — Join 화면에서 코드 입력 후 정보 표시용. */
export async function getSpaceByInviteCode(code: string): Promise<SpaceSummary> {
  const { data: spaceRow, error } = await supa
    .from('spaces').select('*').eq('invite_code', code.toUpperCase()).single() as {
      data: SpaceRow | null; error: Error | null;
    };

  if (error || !spaceRow) {
    throw new Error('유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.');
  }

  const { data: members, error: countError } = await supa
    .from('space_members').select('space_id').eq('space_id', spaceRow.id) as {
      data: { space_id: string }[] | null; error: Error | null;
    };

  if (countError) throw countError;

  return toSpaceSummary(spaceRow, (members ?? []).length);
}

/** ID 기반 join (idempotent — 이미 멤버면 no-op). */
export async function joinSpace(spaceId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: currentMembers, error: fetchError } = await supa
    .from('space_members').select('user_id').eq('space_id', spaceId) as {
      data: { user_id: string }[] | null; error: Error | null;
    };

  if (fetchError) throw fetchError;

  const memberList = currentMembers ?? [];
  if (memberList.some((m: { user_id: string }) => m.user_id === userId)) return;

  const memberColor = getMemberColor(memberList.length);

  const { error: insertError } = await supa
    .from('space_members')
    .insert({ space_id: spaceId, user_id: userId, role: 'member', color: memberColor }) as {
      error: Error | null;
    };

  if (insertError && !insertError.message?.includes('unique')) {
    throw insertError;
  }
}
