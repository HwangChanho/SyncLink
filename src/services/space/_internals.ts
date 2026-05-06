/**
 * space/_internals — supa client wrapper + private helpers shared by all
 * space domain modules. Phase 2.3 분할 (spaceService.ts 1,039줄 → 도메인별
 * 모듈화). _ 접두어로 internal-only 임을 표시 — 모듈 외부 import 금지.
 *
 * Database 의 `Relationships` 필드 누락 (TS2769 회피) 도 한 곳에서 cast.
 */

import { supabase } from '@/lib/supabase';
import type {
  Space, SpaceSummary, SpaceMember, Anniversary,
  SpaceRow, SpaceMemberRow, UserRow, AnniversaryRow,
} from '@/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supa = supabase as any;

/** Supabase error 를 logError 에 넘기기 좋은 형태로 직렬화. */
export function serializeSupabaseError(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  return { message: e.message, code: e.code, hint: e.hint, details: e.details };
}

/**
 * Generate a random 6-character invite code.
 *
 * 길이 6 은 DB CHECK 제약 (`invite_code ~ '^[A-Z0-9]{6}$'`, migration 001)
 * 와 동기화 — 8 자였을 때 23514 위반으로 Space 생성이 전부 실패. char set
 * 은 모호 문자 (O/0/I/1) 제외 시 32 종 → 32^6 ≈ 10.7억 코드 공간으로 충분.
 *
 * char set 이 [A-Z0-9] 의 부분집합이라 CHECK 제약과 호환 (O/0/I/1 도
 * regex 통과지만 사용자 가독성 위해 의도적으로 제외).
 */
export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Calculate days from today to the anniversary date (signed).
 * repeatYearly=true 면 다음 occurrence 까지의 일수.
 */
export function calculateDaysFromToday(date: Date, repeatYearly: boolean): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!repeatYearly) {
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
  }

  const thisYear = today.getFullYear();
  const thisYearDate = new Date(date);
  thisYearDate.setFullYear(thisYear);
  thisYearDate.setHours(0, 0, 0, 0);

  const daysThisYear = Math.round(
    (thisYearDate.getTime() - today.getTime()) / 86_400_000,
  );
  if (daysThisYear < 0) {
    const nextYearDate = new Date(date);
    nextYearDate.setFullYear(thisYear + 1);
    nextYearDate.setHours(0, 0, 0, 0);
    return Math.round((nextYearDate.getTime() - today.getTime()) / 86_400_000);
  }
  return daysThisYear;
}

/** owner 권한 검증 — 아니면 throw. */
export async function assertOwner(spaceId: string, userId: string): Promise<void> {
  const { data: membership, error } = await supa
    .from('space_members')
    .select('role')
    .eq('space_id', spaceId)
    .eq('user_id', userId)
    .single() as { data: { role: string } | null; error: Error | null };

  if (error || !membership) throw new Error('해당 Space의 멤버가 아닙니다.');
  if (membership.role !== 'owner') throw new Error('Space 관리자만 이 작업을 수행할 수 있습니다.');
}

/** DB row → 도메인 타입 매핑들. */
export function toSpaceMember(memberRow: SpaceMemberRow, userRow: UserRow): SpaceMember {
  return {
    userId: memberRow.user_id,
    nickname: userRow.nickname,
    avatarUrl: userRow.avatar_url,
    role: memberRow.role,
    color: memberRow.color,
    joinedAt: new Date(memberRow.joined_at),
  };
}

export function toSpaceSummary(spaceRow: SpaceRow, memberCount: number): SpaceSummary {
  return {
    id: spaceRow.id,
    name: spaceRow.name,
    type: spaceRow.type,
    memberCount,
    coverImageUrl: spaceRow.cover_image_url,
  };
}

export function toSpace(spaceRow: SpaceRow, members: SpaceMember[]): Space {
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

export function toAnniversary(row: AnniversaryRow): Anniversary {
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
