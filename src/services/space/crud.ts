/**
 * space/crud — Space 자체 CRUD: 목록/상세 조회, 생성, 수정, 커버 업로드.
 * Phase 2.3 분할 — spaceService.ts 의 하위 모듈.
 */

import { getCurrentUserId } from '@/lib/supabase';
import { readImageBinary } from '../authService';
import { logError } from '@/lib/errorLogger';
import { getMemberColor } from '@/constants/colors';
import type {
  Space, SpaceSummary, SpaceMember,
  CreateSpaceInput, UpdateSpaceInput,
  SpaceRow, SpaceMemberRow, UserRow,
} from '@/types';
import {
  supa, generateCode, assertOwner, serializeSupabaseError,
  toSpaceMember, toSpaceSummary, toSpace,
} from './_internals';

/** Get all spaces the current user belongs to. Sorted by createdAt DESC. */
export async function getMySpaces(): Promise<SpaceSummary[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: myMemberships, error: membershipError } = await supa
    .from('space_members')
    .select('space_id')
    .eq('user_id', userId) as { data: { space_id: string }[] | null; error: Error | null };

  if (membershipError) throw membershipError;
  if (!myMemberships || myMemberships.length === 0) return [];

  const spaceIds = myMemberships.map((m: { space_id: string }) => m.space_id);

  const { data: spaceRows, error: spaceError } = await supa
    .from('spaces')
    .select('*')
    .in('id', spaceIds)
    .order('created_at', { ascending: false }) as { data: SpaceRow[] | null; error: Error | null };

  if (spaceError) throw spaceError;
  if (!spaceRows || spaceRows.length === 0) return [];

  const { data: allMembers, error: countError } = await supa
    .from('space_members')
    .select('space_id')
    .in('space_id', spaceIds) as { data: { space_id: string }[] | null; error: Error | null };

  if (countError) throw countError;

  const memberCountMap = new Map<string, number>();
  for (const m of allMembers ?? []) {
    memberCountMap.set(m.space_id, (memberCountMap.get(m.space_id) ?? 0) + 1);
  }
  return spaceRows.map((row: SpaceRow) => toSpaceSummary(row, memberCountMap.get(row.id) ?? 0));
}

/** Get full Space by id, including member list (joined_at ASC). */
export async function getSpaceById(spaceId: string): Promise<Space> {
  const { data: spaceRow, error: spaceError } = await supa
    .from('spaces').select('*').eq('id', spaceId).single() as { data: SpaceRow | null; error: Error | null };

  if (spaceError || !spaceRow) throw spaceError ?? new Error('Space를 찾을 수 없습니다.');

  const { data: memberRows, error: memberError } = await supa
    .from('space_members')
    .select('*')
    .eq('space_id', spaceId)
    .order('joined_at', { ascending: true }) as { data: SpaceMemberRow[] | null; error: Error | null };

  if (memberError) throw memberError;

  const userIds = (memberRows ?? []).map((m: SpaceMemberRow) => m.user_id);
  const { data: userRows, error: userError } = await supa
    .from('users').select('*').in('id', userIds) as { data: UserRow[] | null; error: Error | null };

  if (userError) throw userError;

  const userMap = new Map<string, UserRow>();
  for (const u of userRows ?? []) userMap.set(u.id, u);

  const members: SpaceMember[] = (memberRows ?? []).map((row: SpaceMemberRow) => {
    const user = userMap.get(row.user_id);
    if (!user) throw new Error(`사용자 정보를 찾을 수 없습니다: ${row.user_id}`);
    return toSpaceMember(row, user);
  });

  return toSpace(spaceRow, members);
}

/** Create new Space — owner 자동 가입 (golden-angle color index 0). */
export async function createSpace(input: CreateSpaceInput): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const inviteCode = generateCode();

  const { data: spaceRow, error: spaceError } = await supa
    .from('spaces')
    .insert({
      name: input.name,
      type: input.type,
      invite_code: inviteCode,
      cover_image_url: input.coverImageUrl ?? null,
      created_by: userId,
    })
    .select()
    .single() as { data: SpaceRow | null; error: Error | null };

  if (spaceError || !spaceRow) {
    void logError({
      context: 'space.create.insert',
      error:   spaceError ?? new Error('Space INSERT returned no row'),
      userId,
      details: {
        step:           'spaces.insert',
        input,
        // Build-87 진단 — 실제 보낸 invite_code 값과 길이 (CHECK 위반 시 어떤
        // 값이 거부됐는지). 클라/번들 캐시 추적용.
        inviteCode,
        inviteCodeLength: inviteCode.length,
        supabaseError:  serializeSupabaseError(spaceError),
      },
    });
    throw spaceError ?? new Error('Space 생성에 실패했습니다.');
  }

  const ownerColor = getMemberColor(0);
  const { data: memberRow, error: memberError } = await supa
    .from('space_members')
    .insert({ space_id: spaceRow.id, user_id: userId, role: 'owner', color: ownerColor })
    .select()
    .single() as { data: SpaceMemberRow | null; error: Error | null };

  if (memberError || !memberRow) {
    void logError({
      context: 'space.create.member',
      error:   memberError ?? new Error('space_members INSERT returned no row'),
      userId,
      details: { step: 'space_members.insert', spaceId: spaceRow.id, supabaseError: serializeSupabaseError(memberError) },
    });
    throw memberError ?? new Error('멤버 추가에 실패했습니다.');
  }

  const { data: userRow, error: userError } = await supa
    .from('users').select('*').eq('id', userId).single() as { data: UserRow | null; error: Error | null };

  if (userError || !userRow) {
    void logError({
      context: 'space.create.user-fetch',
      error:   userError ?? new Error('users SELECT returned no row'),
      userId,
      details: { step: 'users.select', supabaseError: serializeSupabaseError(userError) },
    });
    throw userError ?? new Error('사용자 정보를 가져오지 못했습니다.');
  }

  return toSpace(spaceRow, [toSpaceMember(memberRow, userRow)]);
}

/**
 * Upload a Space cover image (owner only). Bucket `avatars`,
 * path `space-covers/{spaceId}/cover.{ext}`. Cache-bust suffix on URL.
 */
export async function uploadSpaceCover(
  spaceId: string,
  localUri: string,
  base64?: string | null,
): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  await assertOwner(spaceId, userId);

  const { ext, mimeType, body } = await readImageBinary(localUri, base64);
  const filePath = `space-covers/${spaceId}/cover.${ext}`;

  const { error: uploadError } = await supa.storage
    .from('avatars')
    .upload(filePath, body, { contentType: mimeType, upsert: true });
  if (uploadError) {
    throw new Error(`Space 커버 업로드에 실패했습니다: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supa.storage.from('avatars').getPublicUrl(filePath);
  return `${publicUrl}?t=${Date.now()}`;
}

/** Update Space (owner only). undefined 필드 제외 patch. */
export async function updateSpace(spaceId: string, updates: UpdateSpaceInput): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  await assertOwner(spaceId, userId);

  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.coverImageUrl !== undefined) patch.cover_image_url = updates.coverImageUrl;

  const { error: updateError } = await supa
    .from('spaces').update(patch).eq('id', spaceId) as { error: Error | null };

  if (updateError) throw updateError;

  return getSpaceById(spaceId);
}
