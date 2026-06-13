/**
 * Event service — CRUD operations on the `events` table.
 *
 * Responsibilities:
 *  - Fetch events in a date range (own + shared via event_shares)
 *  - Fetch a single event by ID
 *  - Create, update, and delete events
 *
 * RLS guarantees:
 *  - Users can only INSERT/UPDATE/DELETE their own events
 *  - Users can SELECT events shared to their spaces via event_shares
 *
 * Related services:
 *  - eventShareService.ts  — share/unshare an event to a space
 *  - eventRealtimeService.ts — Supabase Realtime subscription
 *  - freeTimeService.ts    — free-time slot finder
 *
 * NOTE: Uses `supabase as any` workaround for supabase-js v2 Relationships
 * type limitation — same pattern as spaceService.ts.
 */

import { supabase, getCurrentUserId } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import { getMemberColor } from '@/constants/colors';
import { shareEventToSpace, unshareEventFromSpace } from '@/services/eventShareService';
import { saveParts as saveWorkoutParts, listParts as listWorkoutParts } from '@/services/workoutPartService';
import { WORKOUT_RESERVED_COLOR, RUNNING_RESERVED_COLOR } from '@/components/event/ColorPicker';
import { cancelEventReminders } from '@/services/notificationService';
import type {
  Event, EventSummary, CreateEventInput, UpdateEventInput,
  EventRow, DateRange,
} from '@/types';

// Re-export for backward compatibility (canonical source: @/types)
export type { DateRange };

// Workaround: Database type lacks `Relationships` required by supabase-js v2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supa = supabase as any;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Format a Date as a 'YYYY-MM-DD' string for a Postgres `date` column, using
 * the local calendar day (not UTC) so the stored base date matches what the
 * user picked regardless of timezone. v1.3 (relative-date events).
 */
function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a Postgres `date` ('YYYY-MM-DD') into a local-midnight Date. Appending
 * 'T00:00:00' (no Z) keeps it in local time, avoiding the UTC-midnight
 * off-by-one-day shift that `new Date('2026-06-13')` would cause. v1.3.
 */
function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

/** Converts an EventRow to an EventSummary for calendar rendering. */
function toEventSummary(
  row: EventRow,
  isOwn: boolean,
  color: string,
  ownerNickname?: string,
): EventSummary {
  return {
    id:     row.id,
    title:  row.title,
    startAt: new Date(row.start_at),
    endAt:   new Date(row.end_at),
    allDay:  row.all_day,
    color:   row.color ?? color,
    isOwn,
    categoryId: row.category_id,
    // Build-94 — 공유 받은 이벤트만 nickname. own 이면 undefined → 캘린더가
    // prefix 표시 안 함.
    ...(ownerNickname && !isOwn ? { ownerNickname } : {}),
    // Build-96 — drag 가드 우회 조건. true 면 멤버도 reschedule 가능.
    ...(row.editable_by_members ? { editableByMembers: true } : {}),
    // v1.1 — 운동 일정 prefix(💪) 표시용. general 은 undefined 로 두면
    // 기존 분기와 호환.
    ...(row.event_kind === 'workout' ? { eventKind: 'workout' as const } : {}),
    ...(row.event_kind === 'running' ? { eventKind: 'running' as const } : {}),
    // v1.2.9 — recurrence expansion 메타데이터. eventStore.fetchEvents 가
    // expandRecurrence 호출 시 사용. row 가 repeat 정보 없으면 undefined.
    ...(row.repeat_type && row.repeat_type !== 'none' ? { repeatType: row.repeat_type } : {}),
    ...(Array.isArray(row.repeat_weekdays) && row.repeat_weekdays.length > 0
      ? { repeatWeekdays: row.repeat_weekdays }
      : {}),
    ...(row.repeat_until ? { repeatUntil: new Date(row.repeat_until) } : {}),
    // v1.3 — 상대일 일정이면 D-day 배지/라벨 표시용 메타 전달. 일반 일정은 미포함.
    ...(row.base_date ? { baseDate: parseDateOnly(row.base_date) } : {}),
    ...(row.offset_label ? { offsetLabel: row.offset_label } : {}),
  };
}

/** Converts an EventRow + enriched data to a full Event domain object. */
function toEvent(
  row: EventRow,
  sharedSpaceIds: string[],
  ownerNickname: string,
  isOwn: boolean,
  workoutParts: Event['workoutParts'] = [],
): Event {
  return {
    id:           row.id,
    userId:       row.user_id,
    title:        row.title,
    description:  row.description,
    location:     row.location,
    startAt:      new Date(row.start_at),
    endAt:        new Date(row.end_at),
    allDay:       row.all_day,
    repeatType:   row.repeat_type,
    repeatWeekdays: row.repeat_weekdays ?? null,
    repeatUntil:  row.repeat_until ? new Date(row.repeat_until) : null,
    categoryId:   row.category_id,
    color:        row.color,
    sharedSpaceIds,
    ownerNickname,
    isOwn,
    editableByMembers: row.editable_by_members ?? false,
    eventKind:    row.event_kind ?? 'general',
    workoutParts,
    // v1.1.2 — running 일 때만 의미. 그 외 null.
    distanceKm:    row.distance_km ?? null,
    avgPaceSeconds: row.avg_pace_seconds ?? null,
    // v1.3 — 상대일 일정 메타. base_date 가 null 이면 일반 일정.
    baseDate:     row.base_date ? parseDateOnly(row.base_date) : null,
    offsetDays:   row.offset_days ?? null,
    offsetLabel:  row.offset_label ?? null,
    createdAt:    new Date(row.created_at),
    updatedAt:    new Date(row.updated_at),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all events visible to the current user within a date range.
 *
 * Strategy:
 *  1. Fetch the user's own events in range.
 *  2. Get the user's space memberships (to know which shared events to include).
 *  3. Fetch event_shares for those spaces, then fetch the actual events.
 *  4. Merge own + shared, sort by startAt.
 *
 * Color assignment (ADR-014 / IDEA-012):
 *  - Own events: event.color or getMemberColor(0) (golden-angle hue 0)
 *  - Shared events: event owner's space_members.color, fallback getMemberColor(1)
 *
 * @param range - Inclusive start and end dates
 * @returns EventSummary[] sorted by startAt
 */
export async function getEventsInRange(range: DateRange): Promise<EventSummary[]> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const startIso = range.start.toISOString();
  const endIso   = range.end.toISOString();

  // ─── 1. Own events in range ─────────────────────────────────────────────
  // v1.2.9 — 반복 일정은 start_at 이 range 이전이라도 occurrence 가 range
  // 안에 떨어질 수 있어 별도 OR 절로 포함. 단 repeat_until 가 range.start
  // 이전이면 제외 (이미 끝난 반복).
  const { data: ownRows, error: ownError } = await supa
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .or(
      `and(start_at.lte.${endIso},end_at.gte.${startIso}),` +
      `and(repeat_type.neq.none,start_at.lte.${endIso},or(repeat_until.is.null,repeat_until.gte.${startIso}))`,
    )
    .order('start_at') as { data: EventRow[] | null; error: Error | null };

  if (ownError) throw ownError;

  const ownSummaries: EventSummary[] = (ownRows ?? []).map(row =>
    toEventSummary(row, true, getMemberColor(0)),
  );
  const ownEventIds = new Set(ownSummaries.map(e => e.id));

  // ─── 2. Space memberships ──────────────────────────────────────────────
  const { data: myMemberships, error: memberError } = await supa
    .from('space_members')
    .select('space_id, color')
    .eq('user_id', userId) as {
      data: { space_id: string; color: string }[] | null;
      error: Error | null;
    };

  if (memberError) throw memberError;

  const mySpaceIds = (myMemberships ?? []).map(m => m.space_id);
  if (mySpaceIds.length === 0) return ownSummaries;

  // ─── 3. Event IDs shared to my spaces ─────────────────────────────────
  const { data: sharedRefs, error: shareError } = await supa
    .from('event_shares')
    .select('event_id')
    .in('space_id', mySpaceIds) as {
      data: { event_id: string }[] | null;
      error: Error | null;
    };

  if (shareError) throw shareError;

  // Deduplicate and exclude own events
  const sharedEventIds = [
    ...new Set((sharedRefs ?? []).map(r => r.event_id).filter(id => !ownEventIds.has(id))),
  ];

  if (sharedEventIds.length === 0) return ownSummaries;

  // ─── 4. Fetch shared events within range ──────────────────────────────
  const { data: sharedRows, error: sharedError } = await supa
    .from('events')
    .select('*')
    .in('id', sharedEventIds)
    .lte('start_at', endIso)
    .gte('end_at', startIso)
    .order('start_at') as { data: EventRow[] | null; error: Error | null };

  if (sharedError) throw sharedError;

  if (!sharedRows || sharedRows.length === 0) return ownSummaries;

  // ─── 5. Resolve member colors for event owners ─────────────────────────
  const ownerIds = [...new Set(sharedRows.map(r => r.user_id))];
  const { data: ownerMemberships } = await supa
    .from('space_members')
    .select('user_id, color')
    .in('user_id', ownerIds)
    .in('space_id', mySpaceIds) as {
      data: { user_id: string; color: string }[] | null;
      error: Error | null;
    };

  // user_id → color map (first found membership wins)
  const ownerColorMap = new Map<string, string>();
  for (const m of ownerMemberships ?? []) {
    if (!ownerColorMap.has(m.user_id)) {
      ownerColorMap.set(m.user_id, m.color);
    }
  }

  // Build-94 — owner nickname 도 함께 — 캘린더 셀에 "누가 등록" 표시.
  const { data: ownerProfiles } = await supa
    .from('users')
    .select('id, nickname')
    .in('id', ownerIds) as {
      data: { id: string; nickname: string | null }[] | null;
      error: Error | null;
    };
  const ownerNicknameMap = new Map<string, string>();
  for (const u of ownerProfiles ?? []) {
    if (u.nickname) ownerNicknameMap.set(u.id, u.nickname);
  }

  const sharedSummaries: EventSummary[] = sharedRows.map(row =>
    toEventSummary(
      row,
      false,
      ownerColorMap.get(row.user_id) ?? getMemberColor(1),
      ownerNicknameMap.get(row.user_id),
    ),
  );

  // ─── 6. Merge and sort ─────────────────────────────────────────────────
  return [...ownSummaries, ...sharedSummaries].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
}

// ─── Title autocomplete (reuse prior events as templates) ────────────────────

/**
 * Lightweight shape returned by `searchEventsByTitle`. Only the fields that
 * the create-form pre-fills from are included — the raw row can be converted
 * via toEvent() later if the caller needs the full object.
 */
export interface EventAutocompleteSuggestion {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  categoryId: string | null;
  color: string | null;
  allDay: boolean;
  /** The most recent start_at so the UI can show "지난 주 화 14:00" hints. */
  lastStartAt: Date;
}

/**
 * Search the user's own past events by title (case-insensitive prefix/substring
 * match). Returns at most `limit` suggestions, deduplicated by title —
 * only the latest occurrence per title survives, so that reusing "주간 회의"
 * brings up the most recent instance rather than dozens of duplicates.
 *
 * Only the owner's events are searched: shared events would leak other
 * users' private metadata into autocomplete and conflict with the "저장
 * 기준은 달력에 등록되어있는기준" behaviour the user asked for.
 */
export async function searchEventsByTitle(
  query: string,
  limit = 8,
): Promise<EventAutocompleteSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const userId = await getCurrentUserId();
  if (!userId) return [];

  // Oversample so the post-dedup list still fills up to `limit`.
  const { data, error } = await supa
    .from('events')
    .select('id, title, description, location, category_id, color, all_day, start_at')
    .eq('user_id', userId)
    .ilike('title', `%${trimmed}%`)
    .order('start_at', { ascending: false })
    .limit(limit * 4) as {
      data: {
        id: string;
        title: string;
        description: string | null;
        location: string | null;
        category_id: string | null;
        color: string | null;
        all_day: boolean;
        start_at: string;
      }[] | null;
      error: Error | null;
    };

  if (error || !data) return [];

  // Deduplicate by title (case-insensitive), keeping the first occurrence
  // which is the most recent due to the DESC ordering above.
  const seen = new Set<string>();
  const out: EventAutocompleteSuggestion[] = [];
  for (const row of data) {
    const key = row.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      categoryId: row.category_id,
      color: row.color,
      allDay: row.all_day,
      lastStartAt: new Date(row.start_at),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Fetch full event details by ID.
 * Populates sharedSpaceIds and ownerNickname via supplementary queries.
 *
 * @param eventId - UUID of the event
 * @returns Full Event object
 * @throws If event not found or user has no access
 */
export async function getEventById(eventId: string): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // Fetch event row
  const { data: row, error } = await supa
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single() as { data: EventRow | null; error: Error | null };

  if (error || !row) throw new Error('일정을 찾을 수 없습니다.');

  // Fetch space IDs this event is shared to
  const { data: shares } = await supa
    .from('event_shares')
    .select('space_id')
    .eq('event_id', eventId) as {
      data: { space_id: string }[] | null;
      error: Error | null;
    };

  // Fetch owner's nickname
  const { data: ownerRow } = await supa
    .from('users')
    .select('nickname')
    .eq('id', row.user_id)
    .single() as { data: { nickname: string } | null; error: Error | null };

  // v1.1 — workout 모드면 부위 기록도 함께 hydrate. general 모드는 빈 배열.
  const workoutParts = row.event_kind === 'workout'
    ? await listWorkoutParts(eventId)
    : [];

  return toEvent(
    row,
    (shares ?? []).map(s => s.space_id),
    ownerRow?.nickname ?? '알 수 없음',
    row.user_id === userId,
    workoutParts,
  );
}

/**
 * Create a new event. Optionally share it to one or more spaces immediately.
 *
 * After INSERT, fetches the full Event (with sharedSpaceIds and ownerNickname)
 * via getEventById to guarantee a consistent return type.
 *
 * @param input - Event creation payload
 * @returns Newly created Event
 */
export async function createEvent(input: CreateEventInput): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  try {
    // Build-57 — repeat_weekdays 는 migration 024 가 적용된 환경에서만
    // 컬럼이 존재. 적용 안 된 환경에서 항상 INSERT payload 에 포함하면
    // PG 가 unknown column 으로 거부 → "일정을 저장하지 못했습니다"
    // 회귀가 발생한다 (LEAD 보고). custom_weekly 일 때만 키를 추가.
    // v1.1.1 — workout 일정은 카테고리/사용자 색상 선택을 무시하고
    // 예약 색상으로 강제. 캘린더에서 색만 보고도 운동 일정 식별 가능하게
    // (이모지 prefix 제거와 한 쌍).
    const resolvedColor =
      input.eventKind === 'workout' ? WORKOUT_RESERVED_COLOR
        : input.eventKind === 'running' ? RUNNING_RESERVED_COLOR
        : (input.color ?? null);

    const insertPayload: Record<string, unknown> = {
      user_id:      userId,
      title:        input.title,
      description:  input.description ?? null,
      location:     input.location ?? null,
      start_at:     input.startAt.toISOString(),
      end_at:       input.endAt.toISOString(),
      all_day:      input.allDay ?? false,
      repeat_type:  input.repeatType ?? 'none',
      repeat_until: input.repeatUntil?.toISOString() ?? null,
      category_id:  input.categoryId ?? null,
      color:        resolvedColor,
      editable_by_members: input.editableByMembers ?? false,
      event_kind:   input.eventKind ?? 'general',
      // v1.1.2 — running 일 때만 기록. 그 외는 명시적으로 null.
      distance_km:      input.eventKind === 'running' ? (input.distanceKm ?? null) : null,
      avg_pace_seconds: input.eventKind === 'running' ? (input.avgPaceSeconds ?? null) : null,
    };
    if (input.repeatType === 'custom_weekly') {
      insertPayload.repeat_weekdays = input.repeatWeekdays ?? [];
    }
    // v1.3 — 상대일 일정 메타는 사용 시(baseDate 지정)에만 payload 에 추가한다.
    // migration 063 미적용 환경에서 일반 일정 저장이 깨지지 않도록 — Build-57 의
    // repeat_weekdays 와 동일한 "옵션 컬럼은 필요할 때만 포함" 가드.
    if (input.baseDate) {
      insertPayload.base_date    = toDateOnly(input.baseDate);
      insertPayload.offset_days  = input.offsetDays ?? 0;
      insertPayload.offset_label = input.offsetLabel ?? null;
    }
    const { data: row, error } = await supa
      .from('events')
      .insert(insertPayload)
      .select()
      .single() as { data: EventRow | null; error: Error | null };

    if (error || !row) throw error ?? new Error('일정 생성에 실패했습니다.');

    // Build-60 fix — LEAD 보고: "일정 등록하면 실패했다고 뜨는데 등록은 돼".
    // INSERT 가 성공한 시점에서 사용자 입장에선 "일정이 만들어졌다". 후속
    // share / getEventById 가 RLS / 네트워크 등으로 throw 해도 INSERT 결과
    // 자체는 살아 있으므로 caller 에 에러를 surface 하면 사용자가 "실패"
    // 알림을 본 뒤 캘린더에는 일정이 떠 있는 모순이 생긴다. share + 재조회
    // 는 모두 best-effort 로 격리하고, 둘 다 fail 해도 INSERT row 로 합성한
    // Event 를 반환한다.

    if (input.shareToSpaceIds && input.shareToSpaceIds.length > 0) {
      try {
        await Promise.all(
          input.shareToSpaceIds.map(spaceId => shareEventToSpace(row.id, spaceId)),
        );
      } catch (shareErr) {
        void logError({
          context: 'event.create.share',
          error:   shareErr,
          userId,
          details: { eventId: row.id, spaceIds: input.shareToSpaceIds },
        });
        // share 실패해도 caller 에 throw 하지 않음 — 일정은 이미 저장.
      }
    }

    // v1.1 — workout 모드면 부위 기록을 함께 저장. saveParts 는 멱등이라
    // 빈 배열을 보내도 안전. 실패는 best-effort (이미 INSERT 는 성공).
    if (input.eventKind === 'workout' && input.workoutParts && input.workoutParts.length > 0) {
      try {
        await saveWorkoutParts(row.id, input.workoutParts);
      } catch (wpErr) {
        void logError({
          context: 'event.create.workoutParts',
          error:   wpErr,
          userId,
          details: { eventId: row.id, partCount: input.workoutParts.length },
        });
      }
    }

    // NOTE: Reminder scheduling 은 reminderService (TASK-1304) 가 caller 에서
    // 호출. 여기는 events 행만 책임.

    try {
      return await getEventById(row.id);
    } catch (refetchErr) {
      void logError({
        context: 'event.create.refetch',
        error:   refetchErr,
        userId,
        details: { eventId: row.id },
      });
      // 재조회 실패 시 INSERT row 로 partial Event 합성 — 캘린더 화면이
      // upsertEvent 로 쓰는 필드 (id/title/start/end/allDay/color/isOwn) 만
      // 있으면 충분.
      return {
        id:            row.id,
        userId:        userId,
        title:         row.title,
        description:   row.description,
        location:      row.location,
        startAt:       new Date(row.start_at),
        endAt:         new Date(row.end_at),
        allDay:        row.all_day,
        repeatType:    row.repeat_type,
        repeatWeekdays: row.repeat_weekdays ?? null,
        repeatUntil:   row.repeat_until ? new Date(row.repeat_until) : null,
        categoryId:    row.category_id,
        color:         row.color,
        sharedSpaceIds: input.shareToSpaceIds ?? [],
        ownerNickname: '',
        isOwn:         true,
        editableByMembers: input.editableByMembers ?? false,
        eventKind:     input.eventKind ?? 'general',
        workoutParts:  input.workoutParts ?? [],
        // v1.1.2 — running 외엔 null (refetch 실패 합성본에도 명시 — 기존 누락 보완).
        distanceKm:     row.distance_km ?? null,
        avgPaceSeconds: row.avg_pace_seconds ?? null,
        // v1.3 — 상대일 일정 메타.
        baseDate:      row.base_date ? parseDateOnly(row.base_date) : null,
        offsetDays:    row.offset_days ?? null,
        offsetLabel:   row.offset_label ?? null,
        createdAt:     new Date(row.created_at),
        updatedAt:     new Date(row.updated_at),
      };
    }
  } catch (err) {
    // 생성 실패를 중앙 로그로 보내 LEAD가 어떤 필드/RLS 위반인지 즉시 파악 가능
    const pgErr = err as { code?: string; hint?: string; details?: string; message?: string };
    await logError({
      context: 'event.create',
      error:   err,
      userId,
      details: {
        hasTitle:       !!input.title,
        hasDescription: !!input.description,
        allDay:         input.allDay ?? false,
        shareToCount:   input.shareToSpaceIds?.length ?? 0,
        // Supabase/Postgrest 에러 필드 명시적 추출 (RLS 위반·FK 등 즉시 식별 가능)
        supabaseCode:    pgErr.code,
        supabaseHint:    pgErr.hint,
        supabaseDetails: pgErr.details,
      },
    });
    throw err;
  }
}

/**
 * Update an existing event (owner only — enforced by RLS).
 *
 * Builds a partial patch object from non-undefined fields only to avoid
 * accidentally overwriting fields that weren't included in the update payload.
 *
 * @param eventId - UUID of the event to update
 * @param updates - Fields to change
 * @returns Updated Event
 */
export async function updateEvent(eventId: string, updates: UpdateEventInput): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  try {
    // Build patch with only the provided fields
    const patch: Record<string, unknown> = {};
    if (updates.title       !== undefined) patch.title        = updates.title;
    if (updates.description !== undefined) patch.description  = updates.description || null;
    if (updates.location    !== undefined) patch.location     = updates.location || null;
    if (updates.startAt     !== undefined) patch.start_at     = updates.startAt.toISOString();
    if (updates.endAt       !== undefined) patch.end_at       = updates.endAt.toISOString();
    if (updates.allDay      !== undefined) patch.all_day      = updates.allDay;
    if (updates.repeatType  !== undefined) patch.repeat_type  = updates.repeatType;
    // Build-57 — repeat_weekdays 는 migration 024 적용 환경에서만 컬럼이
    // 존재한다. 'custom_weekly' 로 바뀌거나 weekdays 자체가 들어왔을
    // 때만 patch 에 포함 — 컬럼 없는 환경에서도 다른 update 흐름은 깨지지
    // 않게 한다 (LEAD 보고: "일정을 저장하지 못했다" 회귀).
    const targetType = updates.repeatType ?? null;
    if (targetType === 'custom_weekly') {
      patch.repeat_weekdays = updates.repeatWeekdays ?? [];
    } else if (updates.repeatWeekdays !== undefined) {
      // 명시적으로 빈 배열/특정 값 들어온 경우만 set. 그 외엔 컬럼 미언급.
      patch.repeat_weekdays = updates.repeatWeekdays;
    }
    if (updates.repeatUntil !== undefined) patch.repeat_until = updates.repeatUntil?.toISOString() ?? null;
    if (updates.categoryId  !== undefined) patch.category_id  = updates.categoryId ?? null;
    if (updates.color       !== undefined) patch.color        = updates.color ?? null;
    if (updates.editableByMembers !== undefined) patch.editable_by_members = updates.editableByMembers;
    if (updates.eventKind   !== undefined) patch.event_kind   = updates.eventKind;
    // v1.1.2 — running 일 때만 distance/pace 세팅, 그 외 kind 전환 시 null.
    if (updates.distanceKm     !== undefined) patch.distance_km      = updates.distanceKm;
    if (updates.avgPaceSeconds !== undefined) patch.avg_pace_seconds = updates.avgPaceSeconds;
    if (updates.eventKind !== undefined && updates.eventKind !== 'running') {
      patch.distance_km      = null;
      patch.avg_pace_seconds = null;
    }
    // v1.3 — 상대일 일정 메타. 명시적으로 들어온 필드만 patch 한다 (migration 063
    // 미적용 환경에서 일반 update 가 깨지지 않게 — 일반 일정 흐름은 이 키를 안 보냄).
    if (updates.baseDate    !== undefined) patch.base_date    = updates.baseDate ? toDateOnly(updates.baseDate) : null;
    if (updates.offsetDays  !== undefined) patch.offset_days  = updates.offsetDays;
    if (updates.offsetLabel !== undefined) patch.offset_label = updates.offsetLabel ?? null;

    // v1.1.1 — eventKind 별 예약 색상 강제. 사용자가 다른 색을 보내도 무시.
    // workout → 빨강, running → 파랑, general 전환 시 사용자가 color 명시
    // 안 했으면 null 로 되돌려 카테고리 색상 fallback.
    if (updates.eventKind === 'workout') {
      patch.color = WORKOUT_RESERVED_COLOR;
    } else if (updates.eventKind === 'running') {
      patch.color = RUNNING_RESERVED_COLOR;
    } else if (updates.eventKind === 'general' && updates.color === undefined) {
      patch.color = null;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supa
        .from('events')
        .update(patch)
        .eq('id', eventId)
        .eq('user_id', userId) as { error: Error | null };

      if (error) throw error;
    }

    // Apply space sharing changes if specified
    if (updates.shareToSpaceIds !== undefined) {
      const current = await getEventById(eventId);
      const toAdd    = updates.shareToSpaceIds.filter(id => !current.sharedSpaceIds.includes(id));
      const toRemove = current.sharedSpaceIds.filter(id => !updates.shareToSpaceIds!.includes(id));
      await Promise.all([
        ...toAdd.map(id    => shareEventToSpace(eventId, id)),
        ...toRemove.map(id => unshareEventFromSpace(eventId, id)),
      ]);
    }

    // v1.1 — workout 부위 갱신. updates.workoutParts 가 undefined 면 손대지
    // 않고, 명시적으로 빈 배열을 보내면 전체 삭제. saveParts 가 멱등.
    if (updates.workoutParts !== undefined) {
      try {
        await saveWorkoutParts(eventId, updates.workoutParts);
      } catch (wpErr) {
        void logError({
          context: 'event.update.workoutParts',
          error:   wpErr,
          userId,
          details: { eventId, partCount: updates.workoutParts.length },
        });
      }
    }

    const updatedEvent = await getEventById(eventId);

    // NOTE: Reminder rescheduling is now handled by reminderService (TASK-1304).
    // The edit screen calls reminderService.updateReminders() on save.
    // cancelEventReminders is still called here only if startAt changed, to
    // prevent stale local notifications from a previous state.
    if (updates.startAt !== undefined) {
      void cancelEventReminders(eventId);
    }

    return updatedEvent;
  } catch (err) {
    await logError({
      context: 'event.update',
      error:   err,
      userId,
      details: {
        eventId,
        // 어떤 필드를 수정하려 했는지만 남기고 값은 생략 (개인정보 최소화)
        changedKeys: Object.keys(updates),
      },
    });
    throw err;
  }
}

/**
 * Lightweight shape returned by `findConflictingEvents`. Only the fields
 * needed to render the conflict warning Alert are included — no Date
 * conversion is necessary at the call site beyond what's already provided.
 */
export interface ConflictingEvent {
  /** UUID of the conflicting event. */
  id: string;
  /** Event title for display in the warning Alert. */
  title: string;
  /** Owner's nickname (falls back to `'알 수 없음'` if the lookup fails). */
  ownerNickname: string;
  /** Start of the conflicting event (UTC). */
  startAt: Date;
  /** End of the conflicting event (UTC). */
  endAt: Date;
}

/**
 * Find events in the given space whose time range overlaps with the proposed
 * window. Used by the create/edit screens to warn the user before saving a
 * shared event that collides with an existing space-mate's calendar.
 *
 * Overlap definition (half-open interval semantics):
 *   existing.start_at < proposed.endAt
 *   AND existing.end_at > proposed.startAt
 *
 * Scope:
 *  - Returns conflicts only for events shared to `spaceId` (RLS makes other
 *    spaces invisible to the current user anyway).
 *  - Excludes the caller's own pending edit when `excludeEventId` is passed,
 *    so re-saving an existing event without changes doesn't self-conflict.
 *
 * Failure mode:
 *  - This function is best-effort: if the supplementary nickname lookup
 *    fails the offending events still get returned with `'알 수 없음'`.
 *  - On a fatal Supabase error (e.g. network) it returns an empty array
 *    rather than throwing, because blocking the save flow on a conflict
 *    check that itself failed would be a worse UX than silently skipping
 *    the warning. The actual save call will surface any persistent error.
 *
 * @param spaceId         - Space the event is being shared to
 * @param startAt         - Proposed event start
 * @param endAt           - Proposed event end
 * @param excludeEventId  - Optional: event to exclude (own edit case)
 * @returns Array of conflicting events; empty when there are no conflicts.
 */
export async function findConflictingEvents(
  spaceId: string,
  startAt: Date,
  endAt: Date,
  excludeEventId?: string,
): Promise<ConflictingEvent[]> {
  if (!spaceId) return [];

  try {
    // ─── 1. event_ids shared to this space ────────────────────────────────
    const { data: shareRefs, error: shareError } = await supa
      .from('event_shares')
      .select('event_id')
      .eq('space_id', spaceId) as {
        data: { event_id: string }[] | null;
        error: Error | null;
      };

    if (shareError) throw shareError;

    // De-duplicate (same event can be in multiple share rows, defensively),
    // and remove the caller's own pending event id.
    const candidateIds = [
      ...new Set(
        (shareRefs ?? [])
          .map(r => r.event_id)
          .filter(id => id !== excludeEventId),
      ),
    ];
    if (candidateIds.length === 0) return [];

    // ─── 2. Events in time range from the candidate set ───────────────────
    // Half-open overlap: start_at < endAt AND end_at > startAt
    const startIso = startAt.toISOString();
    const endIso   = endAt.toISOString();

    const { data: rows, error } = await supa
      .from('events')
      .select('id, user_id, title, start_at, end_at')
      .in('id', candidateIds)
      .lt('start_at', endIso)
      .gt('end_at', startIso) as {
        data: {
          id: string;
          user_id: string;
          title: string;
          start_at: string;
          end_at: string;
        }[] | null;
        error: Error | null;
      };

    if (error) throw error;
    if (!rows || rows.length === 0) return [];

    // ─── 3. Resolve owner nicknames in one batch ──────────────────────────
    const ownerIds = [...new Set(rows.map(r => r.user_id))];
    const { data: ownerRows } = await supa
      .from('users')
      .select('id, nickname')
      .in('id', ownerIds) as {
        data: { id: string; nickname: string }[] | null;
        error: Error | null;
      };

    const nicknameById = new Map<string, string>(
      (ownerRows ?? []).map(o => [o.id, o.nickname ?? '알 수 없음']),
    );

    return rows.map(row => ({
      id:            row.id,
      title:         row.title,
      ownerNickname: nicknameById.get(row.user_id) ?? '알 수 없음',
      startAt:       new Date(row.start_at),
      endAt:         new Date(row.end_at),
    }));
  } catch (err) {
    // Soft-fail: log for diagnosability, but don't block the save flow on
    // an advisory pre-check failure (see JSDoc above).
    void logError({
      context: 'event.findConflicts',
      error:   err,
      details: { spaceId, hasExcludeId: !!excludeEventId },
    });
    return [];
  }
}

// ─── Fork (IDEA-018) ──────────────────────────────────────────────────────────

/**
 * Fork a shared event into the current user's personal calendar.
 *
 * Creates a brand-new events row owned by the caller (current user_id),
 * copying all metadata fields from the original event. The new row has:
 *  - space_id: null  — not linked to any Space (private copy)
 *  - No event_shares — the fork is fully independent from the original
 *
 * This function throws if:
 *  - The caller is not authenticated
 *  - The original event cannot be read (not shared to any of the user's spaces)
 *  - The caller already owns the original event (would be a no-op / confusing)
 *
 * RLS note: The INSERT is on the caller's own user_id, so standard RLS applies.
 * The SELECT on the source event succeeds if the event is shared to a space the
 * caller belongs to (existing RLS SELECT policy).
 *
 * @param eventId - UUID of the shared event to fork
 * @returns The newly created fork as a full Event domain object
 */
export async function forkSharedEvent(eventId: string): Promise<Event> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  // ─── 1. Read the source event ─────────────────────────────────────────────
  // getEventById uses existing RLS — succeeds if the event is readable by this user.
  const source = await getEventById(eventId);

  // Guard: caller must not be the owner of the source event
  if (source.isOwn) {
    throw new Error('자신의 일정은 복사할 수 없습니다.');
  }

  // ─── 2. INSERT the forked event row for the current user ─────────────────
  const { data: newRow, error } = await supa
    .from('events')
    .insert((() => {
      // Build-57 — fork payload 도 migration 024 미적용 환경 호환을 위해
      // repeat_weekdays 는 'custom_weekly' 일 때만 포함.
      const payload: Record<string, unknown> = {
        user_id:      userId,
        title:        source.title,
        description:  source.description ?? null,
        location:     source.location ?? null,
        start_at:     source.startAt.toISOString(),
        end_at:       source.endAt.toISOString(),
        all_day:      source.allDay,
        repeat_type:  source.repeatType,
        repeat_until: source.repeatUntil?.toISOString() ?? null,
        category_id:  source.categoryId ?? null,
        color:        source.color ?? null,
        // space_id: null → not shared to any Space; fully private copy
      };
      if (source.repeatType === 'custom_weekly' && source.repeatWeekdays) {
        payload.repeat_weekdays = source.repeatWeekdays;
      }
      return payload;
    })())
    .select()
    .single() as { data: EventRow | null; error: Error | null };

  if (error || !newRow) {
    await logError({
      context: 'event.fork',
      error:   error ?? new Error('fork INSERT returned null'),
      userId,
      details: { sourceEventId: eventId },
    });
    throw error ?? new Error('일정 복사에 실패했습니다.');
  }

  // ─── 3. Return the full domain object (consistent return type) ────────────
  // The forked event has no shares, owned by the caller.
  return toEvent(newRow, [], '나', true);
}

/**
 * Delete an event permanently (owner only — enforced by RLS).
 * Cascade-deletes all event_shares rows in the DB.
 *
 * @param eventId - UUID of the event to delete
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { error } = await supa
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('user_id', userId) as { error: Error | null };

  if (error) throw error;
}
