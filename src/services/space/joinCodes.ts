/**
 * space/joinCodes — 초대 코드 발급/검증/소비 + 코드 기반 join.
 * Phase 2.3 분할 — spaceService.ts 의 하위 모듈.
 *
 * 2026-10-13: 미리보기·가입을 서버 RPC(migration 077)로 옮겼다.
 *   - preview_space_by_invite_code: 비멤버도 코드로 미리보기를 받는다.
 *     (예전엔 spaces 를 직접 읽어 비멤버는 RLS 로 늘 0행 → 초대 링크로 들어오면 «유효하지 않은 초대 코드»)
 *   - join_space_by_invite_code: 만료·사용 한도·커플 2명·이미 멤버 검사 + 가입 + 사용 횟수 +1 을 서버가 한 번에.
 *     (예전엔 검사가 클라이언트에만 있었고, 멤버는 spaces 를 못 고쳐 사용 횟수가 오르지 않았다)
 */

import { getCurrentUserId } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import { getMemberColor } from '@/constants/colors';
import type { Space, SpaceSummary, SpaceType } from '@/types';
import {
  supa, generateCode, assertOwner, serializeSupabaseError,
} from './_internals';
import { getSpaceById } from './crud';

/** preview_space_by_invite_code RPC 가 돌려주는 한 행. */
interface InvitePreviewRow {
  id:              string;
  name:            string;
  type:            string;
  member_count:    number;
  cover_image_url: string | null;
}

/**
 * join_space_by_invite_code 의 오류 키 → 사용자 문구.
 * 키는 서버(077)의 `raise exception '<키>'` 메시지와 1:1 이다. 문구는 예전 클라이언트 검사 문구 그대로.
 */
const JOIN_ERROR_MESSAGES: Record<string, string> = {
  invite_invalid:    '유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.',
  invite_expired:    '초대 코드가 만료되었습니다. Space 관리자에게 새 코드를 요청하세요.',
  invite_max_uses:   '초대 코드 사용 한도에 도달했습니다. Space 관리자에게 새 코드를 요청하세요.',
  already_member:    '이미 참여 중인 Space입니다.',
  couple_space_full: '커플 Space는 최대 2명까지 참여할 수 있습니다.',
};

/**
 * 초대 코드로 미리보기 행을 받는다.
 *
 * @param inviteCode - 사용자가 입력했거나 링크에 담긴 코드(대소문자 무관 — 서버가 대문자로 맞춘다)
 * @returns 미리보기 행
 * @throws 없는 코드·조회 실패 → «유효하지 않은 초대 코드» (예전 동작과 같은 문구)
 */
async function fetchInvitePreview(inviteCode: string): Promise<InvitePreviewRow> {
  const { data, error } = await supa
    .rpc('preview_space_by_invite_code', { p_code: inviteCode }) as {
      data: InvitePreviewRow[] | null; error: { message?: string } | null;
    };
  const row = data?.[0] ?? null;
  if (error || !row) {
    throw new Error(JOIN_ERROR_MESSAGES.invite_invalid);
  }
  return row;
}

/**
 * 서버 RPC 로 가입한다. 내 멤버 색은 미리보기 인원수로 계산해 넘긴다(팔레트는 앱 한 곳에만 둔다).
 *
 * @param inviteCode - 초대 코드
 * @param preview    - fetchInvitePreview 결과(인원수·Space id)
 * @returns 가입한(또는 이미 멤버인) Space id 와 이미 멤버였는지 여부
 * @throws 만료·한도·커플 정원 등 → 사용자 문구로 바꾼 Error. 모르는 오류는 원래 메시지 그대로.
 */
async function joinByCode(
  inviteCode: string,
  preview: InvitePreviewRow,
): Promise<{ spaceId: string; alreadyMember: boolean }> {
  const { data, error } = await supa
    .rpc('join_space_by_invite_code', {
      p_code:  inviteCode,
      p_color: getMemberColor(preview.member_count),
    }) as { data: string | null; error: { message?: string } | null };

  if (error) {
    const key = error.message ?? '';
    // 이미 멤버 — 호출부가 «성공으로 볼지»를 고르게 따로 돌려준다.
    if (key === 'already_member') return { spaceId: preview.id, alreadyMember: true };
    throw new Error(JOIN_ERROR_MESSAGES[key] ?? (key || '참여에 실패했습니다.'));
  }
  return { spaceId: data ?? preview.id, alreadyMember: false };
}

/**
 * 초대 코드로 Space 에 참여한다(코드 직접 입력 화면).
 *
 * @param inviteCode - 초대 코드
 * @returns 참여한 Space
 * @throws 미로그인 · 없는/만료/한도 초과 코드 · 이미 멤버 · 커플 정원 초과
 */
export async function joinSpaceByInviteCode(inviteCode: string): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const preview = await fetchInvitePreview(inviteCode);
  const { spaceId, alreadyMember } = await joinByCode(inviteCode, preview);
  if (alreadyMember) throw new Error(JOIN_ERROR_MESSAGES.already_member);

  return getSpaceById(spaceId);
}

/**
 * 초대 링크 화면의 «참여하기» — 이미 멤버면 오류 없이 그 Space id 를 돌려준다(예전 joinSpace 와 같은 멱등 동작).
 *
 * @param inviteCode - 링크에 담긴 초대 코드
 * @returns Space id
 * @throws 미로그인 · 없는/만료/한도 초과 코드 · 커플 정원 초과
 */
export async function joinSpaceByInviteLink(inviteCode: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const preview = await fetchInvitePreview(inviteCode);
  const { spaceId } = await joinByCode(inviteCode, preview);
  return spaceId;
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

/**
 * Space 미리보기 — 초대 링크 화면·코드 입력 후 정보 표시용.
 *
 * @param code - 초대 코드
 * @returns 이름·종류·인원·표지
 * @throws 없는 코드 → «유효하지 않은 초대 코드»
 */
export async function getSpaceByInviteCode(code: string): Promise<SpaceSummary> {
  const row = await fetchInvitePreview(code);
  return {
    id:            row.id,
    name:          row.name,
    type:          row.type as SpaceType,
    memberCount:   row.member_count,
    coverImageUrl: row.cover_image_url,
  };
}
