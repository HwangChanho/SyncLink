/**
 * Space domain types.
 *
 * A Space is the core sharing unit. Users belong to one or more Spaces.
 * Events are shared to Spaces, not directly to users.
 */

import type { SpaceTypeDb, SpaceMemberRoleDb } from './database';

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Space type — determines max members and UI affordances. */
export type SpaceType = SpaceTypeDb;

/** Role within a space. Owner can manage members; member can only participate. */
export type SpaceMemberRole = SpaceMemberRoleDb;

// ─── Core domain types ────────────────────────────────────────────────────────

/** Member of a space with enriched profile info. */
export interface SpaceMember {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: SpaceMemberRole;
  /** Hex color assigned to this member's events in the shared calendar. */
  color: string;
  joinedAt: Date;
}

/** Full space object used in UI. */
export interface Space {
  id: string;
  name: string;
  type: SpaceType;
  inviteCode: string;
  coverImageUrl: string | null;
  createdBy: string;
  members: SpaceMember[];
  /** Calculated: days since or until anniversary (if applicable). */
  dDayCount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal space info used in lists. */
export interface SpaceSummary {
  id: string;
  name: string;
  type: SpaceType;
  memberCount: number;
  coverImageUrl: string | null;
}

// ─── Input types ─────────────────────────────────────────────────────────────

/** Payload to create a new space. */
export interface CreateSpaceInput {
  name: string;
  type: SpaceType;
  coverImageUrl?: string;
}

/** Payload to update space details. */
export interface UpdateSpaceInput {
  name?: string;
  coverImageUrl?: string;
}

// ─── Anniversary / D-day ─────────────────────────────────────────────────────

/** An anniversary entry linked to a space (e.g. first meeting date). */
export interface Anniversary {
  id: string;
  spaceId: string;
  title: string;
  date: Date;
  repeatYearly: boolean;
  /** Days until next occurrence (negative = days since). */
  daysFromToday: number;
  createdBy: string;
}

export interface CreateAnniversaryInput {
  title: string;
  date: Date;
  repeatYearly?: boolean;
}

// ─── Poll (모임 날짜 조율 / 일반 투표) ────────────────────────────────────────
// 후보(option)에 시각을 선택적으로 붙이는 단일 구조. starts_at 이 있으면 날짜
// 후보, 없으면 label 만 있는 자유항목이다. migration 066_space_polls.sql 참조.

/** 투표 후보 1개 + 집계. */
export interface PollOption {
  id: string;
  pollId: string;
  /** 자유항목 텍스트. 날짜 후보면 null 일 수 있다. */
  label: string | null;
  /** 날짜 후보의 시작 시각. null 이면 자유항목. */
  startsAt: Date | null;
  endsAt: Date | null;
  position: number;
  /** 이 후보를 고른 표 수. */
  voteCount: number;
  /** 이 후보를 고른 멤버들의 user_id. 익명 투표에서는 빈 배열. */
  voterIds: string[];
  /** 내가 이 후보를 골랐는지. */
  votedByMe: boolean;
}

/** Space 투표 1건. */
export interface Poll {
  id: string;
  spaceId: string;
  createdBy: string;
  title: string;
  description: string | null;
  /** 여러 후보를 동시에 고를 수 있는지. */
  allowMultiple: boolean;
  /**
   * 누가 무엇을 골랐는지 숨길지. ⚠️ 표시 정책일 뿐 비밀투표가 아니다 —
   * 서버에는 투표자가 남고, 서비스가 voterIds 를 비워 내려줄 뿐이다.
   */
  anonymous: boolean;
  closesAt: Date | null;
  status: 'open' | 'closed';
  decidedOptionId: string | null;
  /** 확정 시 자동 생성된 Space 공유 일정. 재확정 중복 생성을 막는 멱등성 키. */
  createdEventId: string | null;
  createdAt: Date;
  options: PollOption[];
  /** 마감 시각이 지났거나 status='closed' — 클라이언트 판정. */
  isClosed: boolean;
  /** 한 명이라도 투표한 멤버 수 (중복 제거). */
  voterCount: number;
}

export interface CreatePollOptionInput {
  label?: string;
  startsAt?: Date;
  endsAt?: Date;
}

export interface CreatePollInput {
  title: string;
  description?: string;
  allowMultiple?: boolean;
  anonymous?: boolean;
  closesAt?: Date;
  options: CreatePollOptionInput[];
}
