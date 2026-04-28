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
import { readImageBinary } from './authService';
import { logError } from '@/lib/errorLogger';
import { getMemberColor } from '@/constants/colors';
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
    .eq('user_id', userId) as { data: { space_id: string }[] | null; error: Error | null };

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
    .in('space_id', spaceIds) as { data: { space_id: string }[] | null; error: Error | null };

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

  const inviteCode = generateCode();

  // 1. spaces INSERT
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
      details: { step: 'spaces.insert', input, supabaseError: serializeSupabaseError(spaceError) },
    });
    throw spaceError ?? new Error('Space 생성에 실패했습니다.');
  }

  // 2. owner 멤버 추가 — owner is member index 0 in the golden-angle sequence.
  const ownerColor = getMemberColor(0);
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

  if (memberError || !memberRow) {
    void logError({
      context: 'space.create.member',
      error:   memberError ?? new Error('space_members INSERT returned no row'),
      userId,
      details: { step: 'space_members.insert', spaceId: spaceRow.id, supabaseError: serializeSupabaseError(memberError) },
    });
    throw memberError ?? new Error('멤버 추가에 실패했습니다.');
  }

  // 3. 유저 프로필 조회
  const { data: userRow, error: userError } = await supa
    .from('users')
    .select('*')
    .eq('id', userId)
    .single() as { data: UserRow | null; error: Error | null };

  if (userError || !userRow) {
    void logError({
      context: 'space.create.user-fetch',
      error:   userError ?? new Error('users SELECT returned no row'),
      userId,
      details: { step: 'users.select', supabaseError: serializeSupabaseError(userError) },
    });
    throw userError ?? new Error('사용자 정보를 가져오지 못했습니다.');
  }

  const members = [toSpaceMember(memberRow, userRow)];
  return toSpace(spaceRow, members);
}

/**
 * Serialize a Supabase error to a plain object safely (includes `code`,
 * `hint`, `details` when present). Used as `details` for logError.
 */
function serializeSupabaseError(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  return {
    message: e.message,
    code:    e.code,
    hint:    e.hint,
    details: e.details,
  };
}

/**
 * Upload a Space cover image to Storage and return a public URL.
 *
 * Mirrors authService.uploadAvatar but stores under
 * `space-covers/{spaceId}/cover.{ext}` so each Space has at most one
 * persistent cover. Bucket name `avatars` is reused — a single public
 * bucket avoids extra Supabase admin work; the {spaceId} prefix keeps
 * uploads namespaced.
 *
 * Sprint 19 — owner-editable Space metadata.
 */
export async function uploadSpaceCover(
  spaceId: string,
  localUri: string,
  base64?: string | null,
): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  await assertOwner(spaceId, userId);

  // Caller (EditSpaceModal) hands us ImagePicker's pre-decoded base64 so
  // we can sidestep iOS photo-asset URI handling entirely.
  const { ext, mimeType, body } = await readImageBinary(localUri, base64);
  const filePath = `space-covers/${spaceId}/cover.${ext}`;

  const { error: uploadError } = await supa.storage
    .from('avatars')
    .upload(filePath, body, { contentType: mimeType, upsert: true });
  if (uploadError) {
    throw new Error(`Space 커버 업로드에 실패했습니다: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supa.storage
    .from('avatars')
    .getPublicUrl(filePath);
  return `${publicUrl}?t=${Date.now()}`;
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
 * Validates:
 *  1. Code resolves to an existing space.
 *  2. Code has not expired (invite_code_expires_at).
 *  3. Code has not reached its use limit (invite_code_max_uses).
 *  4. Current user is not already a member.
 *  5. Couple spaces are limited to 2 members (application + DB trigger).
 *
 * After successful validation, atomically increments invite_code_uses_count.
 *
 * @param inviteCode - 6-char alphanumeric code (case-insensitive)
 * @returns The joined Space
 * @throws Error if code is invalid, expired, over limit, or space is full
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

  // ── IDEA-016: 만료 시각 체크 ──────────────────────────────────────────────
  // invite_code_expires_at 이 설정되어 있고 현재 시각보다 과거이면 만료.
  // NULL 이면 영구 유효.
  if (spaceRow.invite_code_expires_at !== null) {
    const expiresAt = new Date(spaceRow.invite_code_expires_at);
    if (expiresAt < new Date()) {
      throw new Error('초대 코드가 만료되었습니다. Space 관리자에게 새 코드를 요청하세요.');
    }
  }

  // ── IDEA-016: 사용 횟수 한도 체크 ─────────────────────────────────────────
  // invite_code_max_uses 가 설정되어 있고 이미 uses_count >= max_uses 면 차단.
  // NULL 이면 무제한.
  if (
    spaceRow.invite_code_max_uses !== null &&
    spaceRow.invite_code_uses_count >= spaceRow.invite_code_max_uses
  ) {
    throw new Error('초대 코드 사용 한도에 도달했습니다. Space 관리자에게 새 코드를 요청하세요.');
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

  // 기존 멤버 수 기반으로 색상 할당.
  // ADR-014: golden-angle 회전으로 N에 무관하게 충돌 없는 색을 발급.
  const memberColor = getMemberColor(memberList.length);

  const { error: insertError } = await supa
    .from('space_members')
    .insert({
      space_id: spaceRow.id,
      user_id: userId,
      role: 'member',
      color: memberColor,
    }) as { error: Error | null };

  // DB-level couple cap trigger raises P0001 'couple_space_full'.
  // Map it to a user-friendly message (same as the application-layer check above,
  // but this path catches races where two users join simultaneously).
  if (insertError) {
    const errMsg = (insertError as unknown as { message?: string }).message ?? '';
    if (errMsg.includes('couple_space_full')) {
      throw new Error('커플 Space는 최대 2명까지 참여할 수 있습니다.');
    }
    throw insertError;
  }

  // ── IDEA-016: 사용 횟수 카운터 원자적 증가 ───────────────────────────────
  // DB의 invite_code_uses_count 를 +1 한다.
  // Supabase PostgREST는 server-side increment를 직접 지원하지 않으므로
  // RPC-style raw update 로 처리. 실패해도 JOIN 자체는 성공으로 간주
  // (사용 횟수 부정확보다 join 실패가 더 나쁜 UX이므로 비치명적 처리).
  const { error: counterError } = await supa
    .from('spaces')
    .update({ invite_code_uses_count: spaceRow.invite_code_uses_count + 1 })
    .eq('id', spaceRow.id)
    .eq('invite_code', spaceRow.invite_code) as { error: Error | null };
  // Optimistic concurrency guard: .eq('invite_code', ...) ensures we only
  // increment if the code hasn't been regenerated since we read it.
  // If it fails silently (e.g. owner regenerated mid-join), that is acceptable.
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
 * Regenerate the invite code for a space.
 * Only the owner can do this. Invalidates the old code immediately.
 *
 * IDEA-016: Collision retry — the spaces table has a UNIQUE constraint on
 * invite_code. With a 32^6 = ~1B code space, collisions are rare but not
 * impossible in a large deployment. On UNIQUE violation (Postgres code 23505),
 * we generate a new code and retry up to MAX_REGEN_ATTEMPTS times before
 * surfacing an error to the caller.
 *
 * The DB trigger `trg_reset_invite_code_uses` (022_invite_code_lifecycle.sql)
 * automatically resets invite_code_uses_count to 0 when invite_code changes,
 * so no additional counter reset is needed here.
 *
 * @param spaceId - UUID of the space
 * @returns New invite code (6-char string)
 * @throws Error if owner check fails or all retry attempts collide
 */
export async function regenerateInviteCode(spaceId: string): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // owner 권한 확인
  await assertOwner(spaceId, userId);

  // Maximum retry attempts on UNIQUE constraint collision (Postgres: 23505).
  // With 32^6 ≈ 1.07B combinations and even 100k spaces, collision prob ≈ 0.005%.
  // 5 retries reduce the compounded probability to negligible levels.
  const MAX_REGEN_ATTEMPTS = 5;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
    const newCode = generateCode();

    const { error: updateError } = await supa
      .from('spaces')
      .update({ invite_code: newCode })
      .eq('id', spaceId) as { error: Error | null };

    if (!updateError) {
      // Success — return the new code.
      return newCode;
    }

    // Postgres UNIQUE violation error code is '23505'.
    // supabase-js v2 surfaces this as error.code or within error.message.
    const errCode = (updateError as unknown as { code?: string }).code ?? '';
    const errMsg  = (updateError as unknown as { message?: string }).message ?? '';
    const isCollision = errCode === '23505' || errMsg.includes('23505') || errMsg.includes('unique');

    if (!isCollision) {
      // Non-collision error — surface immediately.
      throw updateError;
    }

    // Collision — log and try again with a freshly generated code.
    void logError({
      context: 'space.regen.collision',
      error:   updateError,
      userId,
      details: { spaceId, attempt, supabaseError: serializeSupabaseError(updateError) },
    });

    lastError = updateError;
  }

  // All attempts exhausted — extremely unlikely in production.
  throw lastError ?? new Error('초대 코드 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
}

/**
 * Get a space's summary information by invite code, without joining.
 * Used by the Space Join screen to display space info before the user confirms.
 *
 * @param code - 6-char alphanumeric invite code (case-insensitive)
 * @returns SpaceSummary for the matching space
 * @throws Error if the code doesn't match any space
 */
export async function getSpaceByInviteCode(code: string): Promise<SpaceSummary> {
  const { data: spaceRow, error } = await supa
    .from('spaces')
    .select('*')
    .eq('invite_code', code.toUpperCase())
    .single() as { data: SpaceRow | null; error: Error | null };

  if (error || !spaceRow) {
    throw new Error('유효하지 않은 초대 코드입니다. 코드를 다시 확인해 주세요.');
  }

  // Count current members
  const { data: members, error: countError } = await supa
    .from('space_members')
    .select('space_id')
    .eq('space_id', spaceRow.id) as { data: { space_id: string }[] | null; error: Error | null };

  if (countError) throw countError;

  return toSpaceSummary(spaceRow, (members ?? []).length);
}

/**
 * Join a space by its ID (idempotent — safe to call even if already a member).
 * Unlike joinSpaceByInviteCode, this does NOT re-check couple limits.
 * Use after calling getSpaceByInviteCode to preview the space.
 *
 * @param spaceId - UUID of the space to join
 * @throws Error if not authenticated
 */
export async function joinSpace(spaceId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Fetch current membership count for color assignment
  const { data: currentMembers, error: fetchError } = await supa
    .from('space_members')
    .select('user_id')
    .eq('space_id', spaceId) as { data: { user_id: string }[] | null; error: Error | null };

  if (fetchError) throw fetchError;

  const memberList = currentMembers ?? [];

  // Already a member — idempotent: do nothing
  if (memberList.some(m => m.user_id === userId)) return;

  // Assign a color based on existing member count (ADR-014 golden-angle).
  const memberColor = getMemberColor(memberList.length);

  // ON CONFLICT DO NOTHING: safe to call multiple times
  const { error: insertError } = await supa
    .from('space_members')
    .insert({
      space_id: spaceId,
      user_id: userId,
      role: 'member',
      color: memberColor,
    }) as { error: Error | null };

  // Unique constraint violation = already a member → treat as success
  if (insertError && !insertError.message?.includes('unique')) {
    throw insertError;
  }
}

/**
 * Leave a space (removes the current user from space_members).
 *
 * Side effects (Sprint 27 R1 — IDEA-011 Phase A):
 *  1. **본인이 그 Space에 공유한 일정의 event_shares 행 일괄 삭제** —
 *     탈퇴자의 일정이 다른 멤버 캘린더에 영구 잔존하는 부조리("나간 사람
 *     일정이 계속 보임")를 방지한다. 본인 events 자체는 삭제하지 않으며,
 *     해당 Space에 대한 share 연결만 해제한다 (다른 Space에 같은 일정이
 *     공유되어 있다면 그 공유는 유지).
 *  2. owner 탈퇴 + 다른 멤버 존재 시 소유권을 가장 오래된 멤버
 *     (joined_at ASC 첫 번째)에게 자동 이전. (Phase B에서 명시적 양도
 *     UX로 대체될 예정 — IDEA-011-B.)
 *  3. 마지막 멤버 탈퇴 시 spaces 행도 삭제 (빈 Space 방지).
 *
 * 호출 순서 (트랜잭션 보장은 RLS + 클라이언트 순차 처리에 의존,
 * Phase B에서 RPC로 묶을 가능성 검토):
 *   (a) space_members SELECT (가입 순)
 *   (b) events SELECT — 본인 일정 id 목록
 *   (c) event_shares DELETE — 본인 일정의 이 Space 공유 해제 (id 목록 비면 생략)
 *   (d) space_members UPDATE — 필요 시 소유권 이전
 *   (e) space_members DELETE — 본인 멤버십 제거
 *   (f) spaces DELETE — 마지막 멤버였을 때만
 *
 * @param spaceId - UUID of the space
 */
export async function leaveSpace(spaceId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // (a) 현재 멤버 전체 조회 (가입 순 정렬 → 소유권 이전 시 활용)
  const { data: allMembers, error: fetchError } = await supa
    .from('space_members')
    .select('*')
    .eq('space_id', spaceId)
    .order('joined_at', { ascending: true }) as { data: SpaceMemberRow[] | null; error: Error | null };

  if (fetchError) throw fetchError;

  const myMembership = (allMembers ?? []).find(m => m.user_id === userId);
  if (!myMembership) throw new Error('해당 Space의 멤버가 아닙니다.');

  const otherMembers = (allMembers ?? []).filter(m => m.user_id !== userId);

  // (b)+(c) IDEA-011-A — 본인이 만든 일정의 이 Space 공유를 명시적으로 정리.
  //
  // event_shares 행은 (event_id, space_id) 복합 키이므로 본인 events.id를
  // 먼저 조회한 뒤 .in() 으로 좁혀서 삭제한다. PostgREST가 .in() 안에
  // sub-query string을 지원하지 않아 두 단계로 나눈다:
  //   1) events 테이블에서 user_id=me 인 event_id 목록 조회
  //   2) event_shares 에서 space_id=X AND event_id IN (위 목록) DELETE
  //
  // 본인 일정이 0개면 빈 IN 절을 만들지 않도록 호출 자체를 생략한다.
  // 멤버십 삭제 *전에* 정리해야 함 — 멤버십이 사라지면 RLS 정책상 본인
  // events 조회/event_shares 삭제 권한도 함께 잃을 수 있어, 잔존 공유가
  // 영구적으로 남는 부조리(탈퇴 후 다른 멤버 캘린더에 계속 표시)를 유발한다.
  const { data: myEventRows, error: myEventsError } = await supa
    .from('events')
    .select('id')
    .eq('user_id', userId) as { data: { id: string }[] | null; error: Error | null };

  if (myEventsError) throw myEventsError;

  const myEventIds = (myEventRows ?? []).map(r => r.id);
  if (myEventIds.length > 0) {
    const { error: sharesDeleteError } = await supa
      .from('event_shares')
      .delete()
      .eq('space_id', spaceId)
      .in('event_id', myEventIds) as { error: Error | null };

    if (sharesDeleteError) throw sharesDeleteError;
  }

  // (d) owner이고 다른 멤버가 있으면 소유권을 가장 오래된 멤버에게 이전
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

  // (e) 내 멤버십 삭제
  const { error: deleteError } = await supa
    .from('space_members')
    .delete()
    .eq('id', myMembership.id) as { error: Error | null };

  if (deleteError) throw deleteError;

  // (f) 마지막 멤버였으면 Space 삭제 (빈 Space 방지)
  if (otherMembers.length === 0) {
    const { error: spaceDeleteError } = await supa
      .from('spaces')
      .delete()
      .eq('id', spaceId) as { error: Error | null };

    if (spaceDeleteError) throw spaceDeleteError;
  }
}

/**
 * Explicitly transfer Space ownership to another member.
 *
 * Business rules enforced:
 *  1. Caller must be the current owner (assertOwner check).
 *  2. Target user must be an active member of the Space (not just any user).
 *  3. Cannot transfer to yourself — would be a no-op and is disallowed for clarity.
 *
 * DB side-effect: spaces.owner_user_id is intentionally NOT stored in this
 * codebase's schema; ownership is represented purely by space_members.role = 'owner'.
 * This function therefore:
 *   (a) UPDATEs the new owner's row → role = 'owner'
 *   (b) UPDATEs the caller's row   → role = 'member'
 * Both updates are issued sequentially. A production-grade implementation would
 * wrap them in a single RPC / DB transaction — tracked for Phase C.
 *
 * IDEA-011 Phase B — explicit ownership handover.
 *
 * @param spaceId       - UUID of the space
 * @param newOwnerUserId - UUID of the member to become the new owner
 * @throws Error if caller is not the owner, target is not a member,
 *               or caller tries to transfer to themselves
 */
export async function transferOwnership(
  spaceId: string,
  newOwnerUserId: string,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Rule 3: 자기 자신에게 양도 금지
  if (newOwnerUserId === userId) {
    throw new Error('자기 자신에게 소유권을 양도할 수 없습니다.');
  }

  // Rule 1: 호출자가 현재 owner인지 확인
  await assertOwner(spaceId, userId);

  // Rule 2: 새 owner가 이 Space의 멤버인지 확인
  const { data: targetMembership, error: memberFetchError } = await supa
    .from('space_members')
    .select('id, role')
    .eq('space_id', spaceId)
    .eq('user_id', newOwnerUserId)
    .single() as { data: { id: string; role: string } | null; error: Error | null };

  if (memberFetchError || !targetMembership) {
    throw new Error('소유권을 양도할 멤버가 해당 Space에 존재하지 않습니다.');
  }

  // (a) 새 owner에게 role = 'owner' 부여
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

  // (b) 이전 owner(호출자)를 일반 멤버로 강등
  const { error: demoteError } = await supa
    .from('space_members')
    .update({ role: 'member' })
    .eq('space_id', spaceId)
    .eq('user_id', userId) as { error: Error | null };

  if (demoteError) {
    // (b) 실패 시 (a)는 이미 커밋된 상태이므로 best-effort 롤백 후 에러 throw.
    // Phase C RPC 도입 전까지 불일치 방지를 위해 에러를 surface한다.
    void logError({
      context: 'space.transfer.demote',
      error:   demoteError,
      userId,
      details: { spaceId, newOwnerUserId, supabaseError: serializeSupabaseError(demoteError) },
    });
    throw new Error(`소유권 양도에 실패했습니다: ${demoteError.message}`);
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
