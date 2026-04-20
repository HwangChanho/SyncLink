/**
 * Space service — adapter over Supabase spaces + space_members + anniversaries.
 *
 * Handles:
 *  - Space CRUD (create, read, update, delete/leave)
 *  - Invite code generation and redemption
 *  - Member management
 *  - Anniversary / D-day management
 *
 * Business rules enforced here:
 *  - couple Space: max 2 members (validated server-side by DB trigger and here)
 *  - Invite code: 6-char alphanumeric, O/0/I/1 excluded, regenerated on request
 *
 * NOTE: supabase-js v2 requires a `Relationships` field in the Database type for
 * full type inference. Until database.ts is updated (needs PROPOSAL), we cast
 * supabase to `any` to prevent TS2769 errors — same pattern as authService.ts.
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { memberEventColors } from '@/constants/colors';
import type {
  Space, SpaceSummary, SpaceMember,
  CreateSpaceInput, UpdateSpaceInput,
  Anniversary, CreateAnniversaryInput,
  SpaceRow, SpaceMemberRow, UserRow, AnniversaryRow,
} from '@/types';

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// All Supabase mutations use this cast — same approach as authService.ts.
// TODO: Remove once database.ts adds Relationships to each table definition.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all spaces the current user belongs to.
 *
 * @returns Array of SpaceSummary sorted by createdAt DESC
 */
export async function getMySpaces(): Promise<SpaceSummary[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Step 1: 내가 속한 space_id 목록 조회
  const { data: myMemberships, error: membershipError } = await supa
    .from('space_members')
    .select('space_id')
    .eq('user_id', userId) as { data: Array<{ space_id: string }> | null; error: Error | null };

  if (membershipError) throw membershipError;
  if (!myMemberships || myMemberships.length === 0) return [];

  const spaceIds = myMemberships.map(m => m.space_id);

  // Step 2: 해당 spaces 조회 (최신순)
  const { data: spaceRows, error: spaceError } = await supa
    .from('spaces')
    .select('*')
    .in('id', spaceIds)
    .order('created_at', { ascending: false }) as { data: SpaceRow[] | null; error: Error | null };

  if (spaceError) throw spaceError;
  if (!spaceRows || spaceRows.length === 0) return [];

  // Step 3: 각 space의 멤버 수 계산 (한 번의 쿼리로)
  const { data: allMembers, error: countError } = await supa
    .from('space_members')
    .select('space_id')
    .in('space_id', spaceIds) as { data: Array<{ space_id: string }> | null; error: Error | null };

  if (countError) throw countError;

  // space_id → memberCount 맵 생성
  const memberCountMap = new Map<string, number>();
  for (const m of allMembers ?? []) {
    memberCountMap.set(m.space_id, (memberCountMap.get(m.space_id) ?? 0) + 1);
  }

  return spaceRows.map(row => toSpaceSummary(row, memberCountMap.get(row.id) ?? 0));
}

/**
 * Get full details of a space, including member list.
 *
 * @param spaceId - UUID of the space
 * @returns Full Space object
 * @throws Error if space not found or user is not a member
 */
export async function getSpaceById(spaceId: string): Promise<Space> {
  // Space 기본 정보 조회
  const { data: spaceRow, error: spaceError } = await supa
    .from('spaces')
    .select('*')
    .eq('id', spaceId)
    .single() as { data: SpaceRow | null; error: Error | null };

  if (spaceError || !spaceRow) throw spaceError ?? new Error('Space를 찾을 수 없습니다.');

  // 멤버 목록 조회 (가입 순)
  const { data: memberRows, error: memberError } = await supa
    .from('space_members')
    .select('*')
    .eq('space_id', spaceId)
    .order('joined_at', { ascending: true }) as { data: SpaceMemberRow[] | null; error: Error | null };

  if (memberError) throw memberError;

  // 멤버 유저 프로필 조회
  const userIds = (memberRows ?? []).map(m => m.user_id);
  const { data: userRows, error: userError } = await supa
    .from('users')
    .select('*')
    .in('id', userIds) as { data: UserRow[] | null; error: Error | null };

  if (userError) throw userError;

  // userId → UserRow 맵 생성
  const userMap = new Map<string, UserRow>();
  for (const u of userRows ?? []) userMap.set(u.id, u);

  // SpaceMember 도메인 객체 생성
  const members: SpaceMember[] = (memberRows ?? []).map(row => {
    const user = userMap.get(row.user_id);
    if (!user) throw new Error(`사용자 정보를 찾을 수 없습니다: ${row.user_id}`);
    return toSpaceMember(row, user);
  });

  return toSpace(spaceRow, members);
}

/**
 * Create a new space owned by the current user.
 *
 * @param input - Space creation payload
 * @returns Newly created Space (owner is automatically added as a member)
 */
export async function createSpace(input: CreateSpaceInput): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // 고유한 invite code 생성
  const inviteCode = generateCode();

  // spaces 테이블 INSERT
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

  if (spaceError || !spaceRow) throw spaceError ?? new Error('Space 생성에 실패했습니다.');

  // 생성자를 owner 역할로 멤버 추가 (첫 번째 색상 할당)
  const ownerColor = memberEventColors[0] as string;
  const { data: memberRow, error: memberError } = await supa
    .from('space_members')
    .insert({
      space_id: spaceRow.id,
      user_id: userId,
      role: 'owner',
      color: ownerColor,
    })
    .select()
    .single() as { data: SpaceMemberRow | null; error: Error | null };

  if (memberError || !memberRow) throw memberError ?? new Error('멤버 추가에 실패했습니다.');

  // 생성자의 유저 프로필 조회
  const { data: userRow, error: userError } = await supa
    .from('users')
    .select('*')
    .eq('id', userId)
    .single() as { data: UserRow | null; error: Error | null };

  if (userError || !userRow) throw userError ?? new Error('사용자 정보를 가져오지 못했습니다.');

  const members = [toSpaceMember(memberRow, userRow)];
  return toSpace(spaceRow, members);
}

/**
 * Update space details (name, cover image).
 * Only the owner can update space details.
 *
 * @param spaceId - UUID of the space
 * @param updates - Fields to update
 * @returns Updated Space
 */
export async function updateSpace(spaceId: string, updates: UpdateSpaceInput): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // owner 권한 확인
  await assertOwner(spaceId, userId);

  // undefined 값 제거 (Supabase가 undefined 필드를 null로 처리하는 것 방지)
  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.coverImageUrl !== undefined) patch.cover_image_url = updates.coverImageUrl;

  const { error: updateError } = await supa
    .from('spaces')
    .update(patch)
    .eq('id', spaceId) as { error: Error | null };

  if (updateError) throw updateError;

  return getSpaceById(spaceId);
}

/**
 * Join a space using an invite code.
 *
 * @param inviteCode - 6-char alphanumeric code (case-insensitive)
 * @returns The joined Space
 * @throws Error if code is invalid, expired, or space is full (couple type)
 */
export async function joinSpaceByInviteCode(inviteCode: string): Promise<Space> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // invite_code로 space 조회 (대소문자 무관 처리)
  const { data: spaceRow, error: spaceError } = await supa
    .from('spaces')
    .select('*')
    .eq('invite_code', inviteCode.toUpperCase())
    .single() as { data: SpaceRow | null; error: Error | null };

  if (spaceError || !spaceRow) {
    throw new Error('유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.');
  }

  // 현재 멤버 목록 조회
  const { data: currentMembers, error: memberFetchError } = await supa
    .from('space_members')
    .select('*')
    .eq('space_id', spaceRow.id) as { data: SpaceMemberRow[] | null; error: Error | null };

  if (memberFetchError) throw memberFetchError;

  const memberList = currentMembers ?? [];

  // 이미 멤버인지 확인
  if (memberList.some(m => m.user_id === userId)) {
    throw new Error('이미 참여 중인 Space입니다.');
  }

  // Couple Space 2인 제한 확인 (서비스 레벨 검증 — DB 트리거와 이중 검증)
  if (spaceRow.type === 'couple' && memberList.length >= 2) {
    throw new Error('커플 Space는 최대 2명까지 참여할 수 있습니다.');
  }

  // 기존 멤버 수 기반으로 색상 할당
  const colorIndex = memberList.length % memberEventColors.length;
  const memberColor = memberEventColors[colorIndex] as string;

  const { error: insertError } = await supa
    .from('space_members')
    .insert({
      space_id: spaceRow.id,
      user_id: userId,
      role: 'member',
      color: memberColor,
    }) as { error: Error | null };

  if (insertError) throw insertError;

  return getSpaceById(spaceRow.id);
}

/**
 * Regenerate the invite code for a space.
 * Only the owner can do this. Invalidates the old code immediately.
 *
 * @param spaceId - UUID of the space
 * @returns New invite code (6-char string)
 */
export async function regenerateInviteCode(spaceId: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // owner 권한 확인
  await assertOwner(spaceId, userId);

  const newCode = generateCode();

  const { error: updateError } = await supa
    .from('spaces')
    .update({ invite_code: newCode })
    .eq('id', spaceId) as { error: Error | null };

  if (updateError) throw updateError;

  return newCode;
}

/**
 * Leave a space (removes the current user from space_members).
 * If the user is the owner and there are other members, ownership is transferred
 * to the next oldest member (earliest joined_at).
 * If the user is the last member, the space is deleted.
 *
 * @param spaceId - UUID of the space
 */
export async function leaveSpace(spaceId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // 현재 멤버 전체 조회 (가입 순 정렬 → 소유권 이전 시 활용)
  const { data: allMembers, error: fetchError } = await supa
    .from('space_members')
    .select('*')
    .eq('space_id', spaceId)
    .order('joined_at', { ascending: true }) as { data: SpaceMemberRow[] | null; error: Error | null };

  if (fetchError) throw fetchError;

  const myMembership = (allMembers ?? []).find(m => m.user_id === userId);
  if (!myMembership) throw new Error('해당 Space의 멤버가 아닙니다.');

  const otherMembers = (allMembers ?? []).filter(m => m.user_id !== userId);

  // owner이고 다른 멤버가 있으면 소유권을 가장 오래된 멤버에게 이전
  if (myMembership.role === 'owner' && otherMembers.length > 0) {
    // joined_at ASC 정렬의 첫 번째 = 가장 오래된 멤버
    const nextOwner = otherMembers[0];
    if (nextOwner) {
      const { error: transferError } = await supa
        .from('space_members')
        .update({ role: 'owner' })
        .eq('id', nextOwner.id) as { error: Error | null };

      if (transferError) throw transferError;
    }
  }

  // 내 멤버십 삭제
  const { error: deleteError } = await supa
    .from('space_members')
    .delete()
    .eq('id', myMembership.id) as { error: Error | null };

  if (deleteError) throw deleteError;

  // 마지막 멤버였으면 Space 삭제 (빈 Space 방지)
  if (otherMembers.length === 0) {
    const { error: spaceDeleteError } = await supa
      .from('spaces')
      .delete()
      .eq('id', spaceId) as { error: Error | null };

    if (spaceDeleteError) throw spaceDeleteError;
  }
}

/**
 * Remove a member from a space.
 * Only the owner can remove other members.
 *
 * @param spaceId - UUID of the space
 * @param userId - UUID of the user to remove
 */
export async function removeMember(spaceId: string, targetUserId: string): Promise<void> {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) throw new Error('로그인이 필요합니다.');

  // owner 권한 확인
  await assertOwner(spaceId, currentUserId);

  // 자기 자신 추방 방지
  if (targetUserId === currentUserId) {
    throw new Error('자신을 추방할 수 없습니다. Space 탈퇴 기능을 사용하세요.');
  }

  const { error } = await supa
    .from('space_members')
    .delete()
    .eq('space_id', spaceId)
    .eq('user_id', targetUserId) as { error: Error | null };

  if (error) throw error;
}

/**
 * Update a member's display color in the shared calendar.
 * Any member can update their own color; owner can update others'.
 *
 * @param spaceId - UUID of the space
 * @param targetUserId - UUID of the member
 * @param color - Hex color string (e.g. '#FF6B6B')
 */
export async function updateMemberColor(spaceId: string, targetUserId: string, color: string): Promise<SpaceMember> {
  const currentUserId = await getCurrentUserId();
  if (!currentUserId) throw new Error('로그인이 필요합니다.');

  // 타인의 색상 변경 시 owner 권한 필요
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

  // user profile 조회
  const { data: userRow, error: userError } = await supa
    .from('users')
    .select('*')
    .eq('id', targetUserId)
    .single() as { data: UserRow | null; error: Error | null };

  if (userError || !userRow) throw userError ?? new Error('사용자 정보를 가져오지 못했습니다.');

  return toSpaceMember(updatedMember, userRow);
}

// ─── Anniversary / D-day ─────────────────────────────────────────────────────

/**
 * Get all anniversaries for a space.
 *
 * @param spaceId - UUID of the space
 * @returns Array of Anniversary sorted by daysFromToday (ascending)
 */
export async function getAnniversaries(spaceId: string): Promise<Anniversary[]> {
  const { data: rows, error } = await supa
    .from('anniversaries')
    .select('*')
    .eq('space_id', spaceId) as { data: AnniversaryRow[] | null; error: Error | null };

  if (error) throw error;

  return (rows ?? [])
    .map(toAnniversary)
    .sort((a, b) => a.daysFromToday - b.daysFromToday);
}

/**
 * Add a new anniversary to a space.
 *
 * @param spaceId - UUID of the space
 * @param input - Anniversary creation payload
 * @returns Newly created Anniversary
 */
export async function createAnniversary(spaceId: string, input: CreateAnniversaryInput): Promise<Anniversary> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: row, error } = await supa
    .from('anniversaries')
    .insert({
      space_id: spaceId,
      title: input.title,
      // Date → 'YYYY-MM-DD' 형식 변환 (DB는 날짜만 저장)
      date: input.date.toISOString().split('T')[0],
      repeat_yearly: input.repeatYearly ?? false,
      created_by: userId,
    })
    .select()
    .single() as { data: AnniversaryRow | null; error: Error | null };

  if (error || !row) throw error ?? new Error('기념일 생성에 실패했습니다.');

  return toAnniversary(row);
}

/**
 * Delete an anniversary.
 *
 * @param anniversaryId - UUID of the anniversary
 */
export async function deleteAnniversary(anniversaryId: string): Promise<void> {
  const { error } = await supa
    .from('anniversaries')
    .delete()
    .eq('id', anniversaryId) as { error: Error | null };

  if (error) throw error;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Generate a random 6-character invite code.
 * Excludes ambiguous characters: O, 0, I, 1 to avoid confusion.
 * Result is always uppercase.
 */
function generateCode(): string {
  // O(오), 0(영), I(아이), 1(일) 제외한 영숫자
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Calculate days from today to the anniversary date.
 * - Positive: future (days remaining)
 * - Negative: past (days since)
 *
 * For repeatYearly=true: returns days to the NEXT upcoming occurrence.
 * If this year's date already passed, returns days to next year's date.
 */
function calculateDaysFromToday(date: Date, repeatYearly: boolean): number {
  const today = new Date();
  // 시간 부분 제거 (날짜 기준 비교)
  today.setHours(0, 0, 0, 0);

  if (!repeatYearly) {
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diffMs = target.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  // 매년 반복: 올해의 기념일 날짜 계산
  const thisYear = today.getFullYear();
  const thisYearDate = new Date(date);
  thisYearDate.setFullYear(thisYear);
  thisYearDate.setHours(0, 0, 0, 0);

  const daysThisYear = Math.round(
    (thisYearDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  // 올해 기념일이 이미 지났으면 내년으로 계산
  if (daysThisYear < 0) {
    const nextYearDate = new Date(date);
    nextYearDate.setFullYear(thisYear + 1);
    nextYearDate.setHours(0, 0, 0, 0);
    return Math.round(
      (nextYearDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  return daysThisYear;
}

/**
 * Asserts the given userId is an owner of the space.
 * Throws a descriptive error if not.
 */
async function assertOwner(spaceId: string, userId: string): Promise<void> {
  const { data: membership, error } = await supa
    .from('space_members')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .single() as { data: { role: string } | null; error: Error | null };

  if (error || !membership) throw new Error('해당 Space의 멤버가 아닙니다.');
  if (membership.role !== 'owner') throw new Error('Space 관리자만 이 작업을 수행할 수 있습니다.');
}

/**
 * Maps a DB SpaceMemberRow + UserRow to the domain SpaceMember type.
 */
function toSpaceMember(memberRow: SpaceMemberRow, userRow: UserRow): SpaceMember {
  return {
    userId: memberRow.user_id,
    nickname: userRow.nickname,
    avatarUrl: userRow.avatar_url,
    role: memberRow.role,
    color: memberRow.color,
    joinedAt: new Date(memberRow.joined_at),
  };
}

/**
 * Maps a DB SpaceRow + member count to the domain SpaceSummary type.
 */
function toSpaceSummary(spaceRow: SpaceRow, memberCount: number): SpaceSummary {
  return {
    id: spaceRow.id,
    name: spaceRow.name,
    type: spaceRow.type,
    memberCount,
    coverImageUrl: spaceRow.cover_image_url,
  };
}

/**
 * Maps a DB SpaceRow + domain SpaceMember[] to the full Space domain type.
 * dDayCount is left null; callers can enrich with anniversary data if needed.
 */
function toSpace(spaceRow: SpaceRow, members: SpaceMember[]): Space {
  return {
    id: spaceRow.id,
    name: spaceRow.name,
    type: spaceRow.type,
    inviteCode: spaceRow.invite_code,
    coverImageUrl: spaceRow.cover_image_url,
    createdBy: spaceRow.created_by,
    members,
    dDayCount: null,
    createdAt: new Date(spaceRow.created_at),
    updatedAt: new Date(spaceRow.updated_at),
  };
}

/**
 * Maps a DB AnniversaryRow to the domain Anniversary type.
 * Automatically calculates daysFromToday based on repeatYearly flag.
 */
function toAnniversary(row: AnniversaryRow): Anniversary {
  const date = new Date(row.date);
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    date,
    repeatYearly: row.repeat_yearly,
    daysFromToday: calculateDaysFromToday(date, row.repeat_yearly),
    createdBy: row.created_by,
  };
}
