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
