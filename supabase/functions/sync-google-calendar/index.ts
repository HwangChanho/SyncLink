// supabase/functions/sync-google-calendar/index.ts
//
// Sprint 1 — Google Calendar 일정을 SyncDay events 테이블로 단방향 import.
//
// 두 가지 호출 mode:
//   - manual: user JWT (Bearer) + POST → 본인 일정만 sync
//   - cron:   service_role JWT + POST { mode: 'cron' } → 모든 active
//             connection 순회 (pg_cron 에서 별도 등록 필요. 본 commit 은
//             manual mode 위주, cron 활성화는 dev 검증 후)
//
// Pro 게이트 (manual):
//   - Free: 마지막 7일 + 다음 30일 window, day 당 cap 50 events
//   - Pro:  -90일 ~ +365일 window, cap 1000 events
//
// 충돌 정책: external_etag 변경 시만 update. 외부 우선 (read-only mirror).
// 외부에서 삭제된 이벤트 (etag 응답에 없음) 는 우리 DB 도 delete.

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

interface SyncBody {
  mode?: 'manual' | 'cron';
}

interface GoogleEvent {
  id:           string;
  status?:      string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?:     string;
  description?: string;
  location?:    string;
  start?:       { dateTime?: string; date?: string; timeZone?: string };
  end?:         { dateTime?: string; date?: string; timeZone?: string };
  etag?:        string;
}

const FREE_WINDOW_PAST_DAYS    = 7;
const FREE_WINDOW_FUTURE_DAYS  = 30;
const FREE_CAP                 = 50;
const PRO_WINDOW_PAST_DAYS     = 90;
const PRO_WINDOW_FUTURE_DAYS   = 365;
const PRO_CAP                  = 1000;

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt:   Date;
} | null> {
  const clientId     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return {
    accessToken: json.access_token,
    expiresAt:   new Date(Date.now() + (json.expires_in - 60) * 1000),
  };
}

/**
 * Google event → events 테이블 row 변환. all-day 는 date, 시간 있는 건 dateTime.
 */
function toEventRow(g: GoogleEvent, userId: string): Record<string, unknown> | null {
  if (!g.start || !g.end) return null;
  const allDay   = Boolean(g.start.date && !g.start.dateTime);
  const startIso = g.start.dateTime ?? (g.start.date ? `${g.start.date}T00:00:00.000Z` : null);
  const endIso   = g.end.dateTime   ?? (g.end.date   ? `${g.end.date}T00:00:00.000Z`   : null);
  if (!startIso || !endIso) return null;
  return {
    user_id:                 userId,
    title:                   g.summary?.slice(0, 255) ?? '(제목 없음)',
    description:             g.description ?? null,
    location:                g.location ?? null,
    start_at:                startIso,
    end_at:                  endIso,
    all_day:                 allDay,
    origin:                  'google',
    external_source:         'google:primary',
    external_id:             g.id,
    external_etag:           g.etag ?? null,
    external_last_synced_at: new Date().toISOString(),
  };
}

/**
 * 단일 user 의 calendar.readonly 호출 + events 테이블 upsert.
 */
async function syncOneUser(adminClient: any, userId: string, triggeredBy: 'manual' | 'cron'): Promise<{
  ok: boolean; imported: number; updated: number; deleted: number; error?: string;
}> {
  // 1) plan 조회 — quota 결정용
  const { data: subRow } = await adminClient
    .from('users').select('id').eq('id', userId).single();
  if (!subRow) return { ok: false, imported: 0, updated: 0, deleted: 0, error: 'user_not_found' };

  // Subscription 은 별도 테이블 또는 컬럼. 간단히 — 본 Sprint 1 은 Free 기본.
  // (다음 단계에서 subscriptionStore 와 동기 — 본 commit 은 Free fallback).
  const isPro = false; // TODO: 실제 plan 조회
  const winPast    = isPro ? PRO_WINDOW_PAST_DAYS    : FREE_WINDOW_PAST_DAYS;
  const winFuture  = isPro ? PRO_WINDOW_FUTURE_DAYS  : FREE_WINDOW_FUTURE_DAYS;
  const cap        = isPro ? PRO_CAP                 : FREE_CAP;

  // 2) refresh_token 으로 access_token 갱신
  const { data: tokenRow } = await adminClient
    .from('google_oauth_tokens')
    .select('refresh_token, access_token, access_token_expires_at')
    .eq('user_id', userId).single();
  if (!tokenRow?.refresh_token) {
    return { ok: false, imported: 0, updated: 0, deleted: 0, error: 'not_connected' };
  }

  let accessToken = tokenRow.access_token as string | null;
  const expiresAt = tokenRow.access_token_expires_at ? new Date(tokenRow.access_token_expires_at) : null;
  if (!accessToken || !expiresAt || expiresAt < new Date()) {
    const fresh = await refreshAccessToken(tokenRow.refresh_token as string);
    if (!fresh) {
      await adminClient.from('google_oauth_tokens').update({
        last_sync_error: 'refresh_token_invalid',
      }).eq('user_id', userId);
      return { ok: false, imported: 0, updated: 0, deleted: 0, error: 'refresh_failed' };
    }
    accessToken = fresh.accessToken;
    await adminClient.from('google_oauth_tokens').update({
      access_token:            fresh.accessToken,
      access_token_expires_at: fresh.expiresAt.toISOString(),
    }).eq('user_id', userId);
  }

  // 3) Google Calendar events.list 호출
  const timeMin = new Date(Date.now() - winPast    * 86400000).toISOString();
  const timeMax = new Date(Date.now() + winFuture  * 86400000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` + new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   String(Math.min(cap, 250)), // Google max per page = 2500
  }).toString();

  const calRes = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!calRes.ok) {
    const errText = await calRes.text().catch(() => '');
    await adminClient.from('google_oauth_tokens').update({
      last_sync_error: `events.list ${calRes.status}: ${errText.slice(0, 200)}`,
    }).eq('user_id', userId);
    return { ok: false, imported: 0, updated: 0, deleted: 0, error: `google_${calRes.status}` };
  }
  const calJson = await calRes.json() as { items?: GoogleEvent[] };
  const items = (calJson.items ?? []).slice(0, cap);

  // 4) 이번 sync 시작 시각의 기존 row 들 조회 (delete detection)
  const { data: existing } = await adminClient
    .from('events')
    .select('id, external_id, external_etag')
    .eq('user_id', userId)
    .eq('origin', 'google')
    .gte('start_at', timeMin)
    .lte('end_at', timeMax);
  const existingByExtId = new Map((existing ?? []).map((e: any) => [e.external_id, e]));

  // 5) upsert / update / delete
  let imported = 0;
  let updated  = 0;
  const seenExtIds = new Set<string>();

  for (const g of items) {
    if (g.status === 'cancelled') continue;
    const row = toEventRow(g, userId);
    if (!row) continue;
    seenExtIds.add(g.id);
    const exist = existingByExtId.get(g.id);
    if (!exist) {
      const { error } = await adminClient.from('events').insert(row);
      if (!error) imported++;
    } else if (exist.external_etag !== g.etag) {
      const { error } = await adminClient.from('events').update(row).eq('id', exist.id);
      if (!error) updated++;
    }
  }

  // 6) 사라진 외부 이벤트 — 우리 DB row 삭제
  const toDelete = (existing ?? [])
    .filter((e: any) => !seenExtIds.has(e.external_id))
    .map((e: any) => e.id);
  let deleted = 0;
  if (toDelete.length > 0) {
    const { error, count } = await adminClient
      .from('events').delete({ count: 'exact' })
      .in('id', toDelete);
    if (!error) deleted = count ?? toDelete.length;
  }

  // 7) last_sync_at + log
  await adminClient.from('google_oauth_tokens').update({
    last_sync_at:    new Date().toISOString(),
    last_sync_error: null,
  }).eq('user_id', userId);

  await adminClient.from('external_sync_log').insert({
    user_id:         userId,
    source:          'google:primary',
    triggered_by:    triggeredBy,
    finished_at:     new Date().toISOString(),
    events_imported: imported,
    events_updated:  updated,
    events_deleted:  deleted,
    status:          'success',
  });

  return { ok: true, imported, updated, deleted };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: SyncBody = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const mode = body.mode ?? 'manual';

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (mode === 'cron') {
    // cron mode — service_role 만. (Authorization 검증은 Supabase Edge Function
    // 의 verify_jwt 옵션 X — pg_cron 이 호출 시 service_role JWT 사용.)
    const { data: connections } = await adminClient
      .from('google_oauth_tokens').select('user_id');
    const results: Array<{ user_id: string } & Awaited<ReturnType<typeof syncOneUser>>> = [];
    for (const c of (connections ?? [])) {
      const r = await syncOneUser(adminClient, c.user_id, 'cron');
      results.push({ user_id: c.user_id, ...r });
    }
    return new Response(JSON.stringify({ count: results.length, results }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // manual mode — user JWT 인증
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await syncOneUser(adminClient, user.id, 'manual');
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
