/**
 * Free time finder domain types (PRD 4.2 Tier 1).
 *
 * - `FreeSlot`     : Lightweight slot used by Tier-1 service callers.
 *                    Field names follow PRD spec: `start` / `end` (Date).
 * - `FreeSlotOptions` : Options bag for the Tier-1 finder.
 *
 * The legacy `FreeTimeSlot` interface (in `@/types/event.ts`) remains the
 * canonical type for the existing `findFreeTimeSlots` API used by
 * `src/app/space/[id].tsx`. Both shapes coexist intentionally — see the
 * adapter at the bottom of this file for converting between them.
 *
 * Why two shapes:
 *  - `FreeSlot` matches the PRD 4.2 Tier-1 contract verbatim, allowing
 *    upstream Tier-2 (UI) and Tier-3 (AI) layers to be written against the
 *    spec without translation.
 *  - `FreeTimeSlot` retains `participantIds` so the existing space screen
 *    can keep rendering "shared by N members" badges without refactor.
 */

import type { FreeTimeSlot } from '@/types/event';

/**
 * A contiguous free window suitable for scheduling, as returned by the
 * Tier-1 free-time finder service. Pure value object — no participant
 * metadata.
 *
 * @property start            Inclusive start of the free window
 * @property end              Exclusive end of the free window
 * @property durationMinutes  Convenience: (end - start) in whole minutes
 */
export interface FreeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

/**
 * Options for `findFreeSlots`.
 *
 * @property minSlotMinutes      Minimum gap length to include (default: 30).
 *                               Slots shorter than this are dropped.
 * @property participantUserIds  When provided, intersect free time across
 *                               only these user IDs instead of every space
 *                               member. Useful for "find time when A and B
 *                               are both free" without involving the full
 *                               space.
 */
export interface FreeSlotOptions {
  minSlotMinutes?: number;
  participantUserIds?: string[];
}

// ─── Adapters ────────────────────────────────────────────────────────────────

/**
 * Convert the legacy `FreeTimeSlot` (with participantIds + startAt/endAt)
 * to the Tier-1 `FreeSlot` shape (start/end only).
 *
 * Useful when bridging the existing service to PRD-spec consumers.
 */
export function toFreeSlot(slot: FreeTimeSlot): FreeSlot {
  return {
    start:           slot.startAt,
    end:             slot.endAt,
    durationMinutes: slot.durationMinutes,
  };
}

// Re-export the legacy type so callers can find both in one place.
export type { FreeTimeSlot } from '@/types/event';
