/**
 * space/polls — Space 투표 (모임 날짜 조율 + 일반 투표).
 *
 * DB: public.space_polls / space_poll_options / space_poll_votes (migration 066).
 * Realtime: 3개 테이블 모두 publication 등록됨 → channel 'space-polls:{spaceId}'.
 * 계획: docs/plans/2026-08-08-space-poll.md
 *
 * 흐름:
 *  - listPolls(spaceId)              투표 + 후보 + 집계(내 표 포함)
 *  - createPoll(spaceId, input)      투표 + 후보 일괄 생성
 *  - castVote(poll, optionId)        단일 선택이면 기존 표 교체, 복수면 토글
 *  - closePoll / reopenPoll          마감 · 재개
 *  - decidePoll(poll, optionId)      확정 (+ 날짜 후보면 Space 공유 일정 생성)
 *  - subscribeToPolls(spaceId, cb)   Realtime 구독
 *
 * 집계는 클라이언트에서 한다. 멤버가 많아야 수십 명이라 RPC/뷰는 과설계다.
 *
 * ⚠️ anonymous 는 **표시 정책**이다. RLS 로 투표자를 가리면 "내 표"까지 못 읽어
 *    UI 가 깨지므로, 서버에는 투표자가 남고 여기서 voterIds 를 비워 내려준다.
 *    비밀투표가 아니라는 점은 UI 문구로 알린다.
 */

import { getCurrentUserId } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';
import type {
  Poll, PollOption, CreatePollInput,
} from '@/types';
import { supa, serializeSupabaseError } from './_internals';

// ─── Row 타입 (DB 스키마 그대로) ─────────────────────────────────────────────
interface PollRow {
  id: string;
  space_id: string;
  created_by: string;
  title: string;
  description: string | null;
  allow_multiple: boolean;
  anonymous: boolean;
  closes_at: string | null;
  status: 'open' | 'closed';
  decided_option_id: string | null;
  created_event_id: string | null;
  created_at: string;
}

interface PollOptionRow {
  id: string;
  poll_id: string;
  label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  position: number;
}

interface PollVoteRow {
  id: string;
  poll_id: string;
  option_id: string;
  user_id: string;
}

// ─── 매핑 ────────────────────────────────────────────────────────────────────
/**
 * 투표가 실질적으로 닫혔는지. status 뿐 아니라 마감 시각도 본다 —
 * 마감은 cron 없이 클라이언트가 판정하고, 서버 측 차단은 RLS 가 담당한다.
 */
function isPollClosed(row: PollRow): boolean {
  if (row.status === 'closed') return true;
  return row.closes_at !== null && new Date(row.closes_at).getTime() <= Date.now();
}

/**
 * row 3종을 도메인 Poll 로 합친다.
 * @param anonymize 익명 투표면 voterIds 를 비워 내보낸다 (votedByMe 는 유지 —
 *                  내 표는 내가 알아야 UI 가 성립한다).
 */
function toPoll(
  row: PollRow,
  optionRows: PollOptionRow[],
  voteRows: PollVoteRow[],
  myUserId: string | null,
): Poll {
  const anonymize = row.anonymous;
  const options: PollOption[] = optionRows
    .filter((o) => o.poll_id === row.id)
    .sort((a, b) => a.position - b.position)
    .map((o) => {
      const votes = voteRows.filter((v) => v.option_id === o.id);
      return {
        id: o.id,
        pollId: o.poll_id,
        label: o.label,
        startsAt: o.starts_at ? new Date(o.starts_at) : null,
        endsAt: o.ends_at ? new Date(o.ends_at) : null,
        position: o.position,
        voteCount: votes.length,
        voterIds: anonymize ? [] : votes.map((v) => v.user_id),
        votedByMe: myUserId !== null && votes.some((v) => v.user_id === myUserId),
      };
    });

  const pollVotes = voteRows.filter((v) => v.poll_id === row.id);
  return {
    id: row.id,
    spaceId: row.space_id,
    createdBy: row.created_by,
    title: row.title,
    description: row.description,
    allowMultiple: row.allow_multiple,
    anonymous: row.anonymous,
    closesAt: row.closes_at ? new Date(row.closes_at) : null,
    status: row.status,
    decidedOptionId: row.decided_option_id,
    createdEventId: row.created_event_id,
    createdAt: new Date(row.created_at),
    options,
    isClosed: isPollClosed(row),
    // 같은 사람이 여러 후보를 골라도 1명으로 센다.
    voterCount: new Set(pollVotes.map((v) => v.user_id)).size,
  };
}

// ─── 조회 ────────────────────────────────────────────────────────────────────
/**
 * Space 의 투표를 최신순으로 반환한다 (후보 + 집계 포함).
 * RLS 가 멤버가 아닌 Space 를 걸러내므로 별도 권한 검사는 하지 않는다.
 */
export async function listPolls(spaceId: string): Promise<Poll[]> {
  const { data: pollRows, error } = await supa
    .from('space_polls').select('*').eq('space_id', spaceId)
    .order('created_at', { ascending: false }) as {
      data: PollRow[] | null; error: Error | null;
    };
  if (error) {
    void logError({ context: 'poll.list', error, details: { spaceId, supabaseError: serializeSupabaseError(error) } });
    throw error;
  }
  const polls = pollRows ?? [];
  if (polls.length === 0) return [];

  const pollIds = polls.map((p) => p.id);
  // 후보·표를 한 번에 가져와 N+1 왕복을 피한다.
  const [{ data: optionRows }, { data: voteRows }] = await Promise.all([
    supa.from('space_poll_options').select('*').in('poll_id', pollIds),
    supa.from('space_poll_votes').select('*').in('poll_id', pollIds),
  ]) as [{ data: PollOptionRow[] | null }, { data: PollVoteRow[] | null }];

  const myUserId = await getCurrentUserId();
  return polls.map((p) => toPoll(p, optionRows ?? [], voteRows ?? [], myUserId));
}

/** 단일 투표 재조회 — 투표 후 최신 집계를 받을 때 쓴다. */
export async function getPoll(pollId: string): Promise<Poll | null> {
  const { data: row, error } = await supa
    .from('space_polls').select('*').eq('id', pollId).maybeSingle() as {
      data: PollRow | null; error: Error | null;
    };
  if (error || !row) return null;
  const [{ data: optionRows }, { data: voteRows }] = await Promise.all([
    supa.from('space_poll_options').select('*').eq('poll_id', pollId),
    supa.from('space_poll_votes').select('*').eq('poll_id', pollId),
  ]) as [{ data: PollOptionRow[] | null }, { data: PollVoteRow[] | null }];
  const myUserId = await getCurrentUserId();
  return toPoll(row, optionRows ?? [], voteRows ?? [], myUserId);
}

// ─── 생성 ────────────────────────────────────────────────────────────────────
/**
 * 투표 + 후보를 함께 만든다.
 *
 * 후보 INSERT 가 실패하면 후보 없는 유령 투표가 남으므로 투표를 되돌린다
 * (트랜잭션이 없는 PostgREST 환경의 차선책).
 *
 * @throws 후보가 2개 미만이면 — 후보 1개짜리 투표는 의미가 없다.
 */
export async function createPoll(spaceId: string, input: CreatePollInput): Promise<Poll> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  const options = input.options.filter((o) => o.label?.trim() || o.startsAt);
  if (options.length < 2) throw new Error('후보를 2개 이상 추가해 주세요.');

  const { data: poll, error } = await supa.from('space_polls').insert({
    space_id: spaceId,
    created_by: userId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    allow_multiple: input.allowMultiple ?? true,
    anonymous: input.anonymous ?? false,
    closes_at: input.closesAt?.toISOString() ?? null,
  }).select().single() as { data: PollRow | null; error: Error | null };

  if (error || !poll) {
    void logError({ context: 'poll.create', error, details: { spaceId, supabaseError: serializeSupabaseError(error) } });
    throw error ?? new Error('투표를 만들지 못했습니다.');
  }

  const { error: optErr } = await supa.from('space_poll_options').insert(
    options.map((o, i) => ({
      poll_id: poll.id,
      label: o.label?.trim() || null,
      starts_at: o.startsAt?.toISOString() ?? null,
      ends_at: o.endsAt?.toISOString() ?? null,
      position: i,
    })),
  );
  if (optErr) {
    // 후보 없는 투표가 남지 않도록 되돌린다.
    await supa.from('space_polls').delete().eq('id', poll.id);
    void logError({ context: 'poll.createOptions', error: optErr, details: { pollId: poll.id, supabaseError: serializeSupabaseError(optErr) } });
    throw optErr;
  }

  const created = await getPoll(poll.id);
  if (!created) throw new Error('투표를 만들지 못했습니다.');
  return created;
}

// ─── 투표 ────────────────────────────────────────────────────────────────────
/**
 * 후보 하나를 토글한다.
 *  - 이미 고른 후보면 표를 뺀다.
 *  - 단일 선택 투표면 기존 표를 먼저 지우고 새로 넣는다.
 *
 * 마감된 투표는 RLS 가 서버에서 막지만, 불필요한 왕복과 모호한 에러를 피하려
 * 여기서 먼저 차단한다.
 *
 * @returns 갱신된 Poll
 */
export async function castVote(poll: Poll, optionId: string): Promise<Poll> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  if (poll.isClosed) throw new Error('마감된 투표입니다.');

  const target = poll.options.find((o) => o.id === optionId);
  if (!target) throw new Error('없는 후보입니다.');

  if (target.votedByMe) {
    const { error } = await supa.from('space_poll_votes')
      .delete().eq('option_id', optionId).eq('user_id', userId);
    if (error) {
      void logError({ context: 'poll.unvote', error, details: { pollId: poll.id, optionId, supabaseError: serializeSupabaseError(error) } });
      throw error;
    }
  } else {
    // 단일 선택이면 이 투표에 남아 있는 내 표를 모두 회수한 뒤 넣는다.
    if (!poll.allowMultiple) {
      await supa.from('space_poll_votes').delete().eq('poll_id', poll.id).eq('user_id', userId);
    }
    const { error } = await supa.from('space_poll_votes')
      .insert({ poll_id: poll.id, option_id: optionId, user_id: userId });
    if (error) {
      void logError({ context: 'poll.vote', error, details: { pollId: poll.id, optionId, supabaseError: serializeSupabaseError(error) } });
      throw error;
    }
  }

  const updated = await getPoll(poll.id);
  if (!updated) throw new Error('투표 상태를 불러오지 못했습니다.');
  return updated;
}

// ─── 마감 / 재개 / 삭제 ──────────────────────────────────────────────────────
/** 투표를 마감한다. RLS 상 작성자 또는 Space owner 만 성공한다. */
export async function closePoll(pollId: string): Promise<void> {
  const { error } = await supa.from('space_polls').update({ status: 'closed' }).eq('id', pollId);
  if (error) {
    void logError({ context: 'poll.close', error, details: { pollId, supabaseError: serializeSupabaseError(error) } });
    throw error;
  }
}

/** 마감을 되돌린다. closes_at 이 이미 지났다면 그것도 지운다. */
export async function reopenPoll(pollId: string): Promise<void> {
  const { error } = await supa.from('space_polls')
    .update({ status: 'open', closes_at: null }).eq('id', pollId);
  if (error) {
    void logError({ context: 'poll.reopen', error, details: { pollId, supabaseError: serializeSupabaseError(error) } });
    throw error;
  }
}

/** 투표 삭제. 후보·표는 FK CASCADE 로 함께 지워진다. */
export async function deletePoll(pollId: string): Promise<void> {
  const { error } = await supa.from('space_polls').delete().eq('id', pollId);
  if (error) {
    void logError({ context: 'poll.delete', error, details: { pollId, supabaseError: serializeSupabaseError(error) } });
    throw error;
  }
}

// ─── 확정 (+ 일정 자동생성) ──────────────────────────────────────────────────
/**
 * 후보 하나를 결과로 확정한다. 날짜 후보(starts_at 있음)면 Space 공유 일정까지
 * 만든다. 자유항목 후보는 확정만 하고 일정은 만들지 않는다.
 *
 * **멱등성**: 이미 `createdEventId` 가 있으면 일정을 다시 만들지 않는다.
 * 확정 후보를 바꾸는 경우에도 기존 일정을 지우지는 않는다 — 이미 멤버 캘린더에
 * 보이는 일정을 말없이 없애는 편이 더 위험하다. 정리는 사용자가 캘린더에서 한다.
 *
 * 일정 생성이 실패해도 확정 자체는 되돌리지 않는다. 확정은 투표의 결론이고
 * 일정은 편의 기능이라, 하나 때문에 다른 하나를 막을 이유가 없다.
 *
 * @returns 갱신된 Poll
 */
export async function decidePoll(poll: Poll, optionId: string): Promise<Poll> {
  const option = poll.options.find((o) => o.id === optionId);
  if (!option) throw new Error('없는 후보입니다.');

  const patch: Record<string, unknown> = { decided_option_id: optionId, status: 'closed' };

  // 날짜 후보 + 아직 일정을 안 만든 경우에만 생성한다.
  if (option.startsAt && !poll.createdEventId) {
    try {
      // 순환 import 를 피하려 지연 로드한다 (eventService → space 서비스 참조 가능성).
      const { createEvent } = await import('@/services/eventService');
      const event = await createEvent({
        title: poll.title,
        startAt: option.startsAt,
        // 종료 시각이 없으면 1시간짜리로 둔다 (캘린더가 0분 일정을 잘 못 보여준다).
        endAt: option.endsAt ?? new Date(option.startsAt.getTime() + 60 * 60 * 1000),
        shareToSpaceIds: [poll.spaceId],
      });
      patch.created_event_id = event.id;
    } catch (error) {
      void logError({
        context: 'poll.decide.createEvent',
        error,
        details: { pollId: poll.id, optionId, spaceId: poll.spaceId },
      });
      // 확정은 그대로 진행한다.
    }
  }

  const { error } = await supa.from('space_polls').update(patch).eq('id', poll.id);
  if (error) {
    void logError({ context: 'poll.decide', error, details: { pollId: poll.id, optionId, supabaseError: serializeSupabaseError(error) } });
    throw error;
  }

  const updated = await getPoll(poll.id);
  if (!updated) throw new Error('투표 상태를 불러오지 못했습니다.');
  return updated;
}

// ─── 실시간 ──────────────────────────────────────────────────────────────────
/**
 * 이 Space 의 투표/후보/표 변경을 구독한다. 어떤 변경이든 onChange 를 호출하므로
 * 호출부는 listPolls 로 다시 읽으면 된다 (payload 를 부분 병합하지 않는다 —
 * 집계가 걸려 있어 재조회가 단순하고 안전하다).
 *
 * 채널명에 난수 suffix 를 붙인다 — 같은 채널을 재구독하면
 * "cannot add postgres_changes callbacks for re-subscribed channel" 로 죽는다
 * (spaceMessageService 에서 겪은 Sentry 크래시와 동일 패턴).
 *
 * @returns 구독 해제 함수
 */
export function subscribeToPolls(spaceId: string, onChange: () => void): () => void {
  const suffix = Math.random().toString(36).slice(2, 8);
  const channel = supa.channel(`space-polls:${spaceId}:${suffix}`);
  for (const table of ['space_polls', 'space_poll_options', 'space_poll_votes']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange());
  }
  channel.subscribe();
  return () => { void supa.removeChannel(channel); };
}
