// supabase/functions/sync-google-calendar/index.ts
//
// Sprint 1 — Google Calendar 일정을 SyncDay events 테이블로 단방향 import.
//
// 두 가지 호출 mode:
//   - manual: user JWT (Bearer) + POST → 본인 일정만 sync
//             (게이트웨이 verify_jwt 가 아니라 핸들러의 auth.getUser() 로 검증한다)
//   - cron:   POST { mode: 'cron' } + Bearer <GCAL_SYNC_SECRET> → 모든 active
//             connection 순회. pg_cron(마이그레이션 074)이 15분마다 호출한다.
//
// 🔴 2026-09-12 — cron mode 에 호출자 검증이 **한 줄도 없었다.** 주석만
//    "service_role JWT" 라고 적혀 있었고 코드는 아무것도 확인하지 않았다.
//    게이트웨이 verify_jwt=true 가 앞을 막아 주는 줄 알았지만, 그 게이트는
//    anon 키를 통과시킨다(anon 키는 앱 번들·웹 번들에 박혀 있어 누구나 꺼낸다).
//    즉 누구나 전체 사용자 동기화를 트리거하고, 응답에 실려 나가던
//    user_id 목록까지 받아갈 수 있는 상태였다. 아래 두 곳에서 막는다.
//    상세 배경 → _shared/serviceAuth.ts
//
// Pro 게이트 (manual):
//   - Free: 마지막 7일 + 다음 30일 window, day 당 cap 50 events
//   - Pro:  -90일 ~ +365일 window, cap 1000 events
//
// 충돌 정책: external_etag 변경 시만 update. 외부 우선 (read-only mirror).
// 외부에서 삭제된 이벤트 (etag 응답에 없음) 는 우리 DB 도 delete.

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { requireSharedSecret } from '../_shared/serviceAuth.ts';

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
    // 🔴 cron mode 는 **모든 사용자**의 연결을 건드리므로 호출자를 반드시 검증한다.
    //    mode 는 body 에서 오니까 아무나 { "mode": "cron" } 을 보낼 수 있다 —
    //    이 가드가 유일한 방어선이다. requireSharedSecret 은 fail-closed 라
    //    GCAL_SYNC_SECRET 이 주입되지 않았으면 통과가 아니라 500 을 낸다.
    //    (dispatch-notifications·smart-reminder·reactivation-push 와 같은 방식)
    const denied = requireSharedSecret(req, 'GCAL_SYNC_SECRET');
    if (denied) return denied;

    const { data: connections } = await adminClient
      .from('google_oauth_tokens').select('user_id');

    // 🔴 응답에는 **집계만** 싣는다. 예전엔 user_id 배열을 그대로 반환했는데,
    //    그건 호출자에게 전체 연결 사용자의 UUID 를 넘겨주는 것과 같다.
    //    이 본문은 pg_net 의 net._http_response 에도 남으므로 더더욱 그렇다.
    //    운영에 필요한 건 "몇 건이 되고 몇 건이 왜 실패했나"이지 누구인지가 아니다.
    let synced = 0, failed = 0, imported = 0, updated = 0, deleted = 0;
    const errors: Record<string, number> = {};
    for (const c of (connections ?? [])) {
      const r = await syncOneUser(adminClient, c.user_id, 'cron');
      if (r.ok) {
        synced++;
        imported += r.imported;
        updated  += r.updated;
        deleted  += r.deleted;
      } else {
        failed++;
        // 사유별 건수 — 'not_connected' 와 'refresh_failed' 는 고칠 곳이 다르다.
        const key = r.error ?? 'unknown';
        errors[key] = (errors[key] ?? 0) + 1;
      }
    }

    // ⚠️ 순차 루프다. pg_net 기본 타임아웃은 5초라, 연결 사용자가 늘면 cron 쪽
    //    HTTP 기록이 timed_out 으로 남는다(함수는 끝까지 돈다 —
    //    reference_edge_function_auth_cron 참고). 판정은 external_sync_log 로 할 것.
    return new Response(JSON.stringify({
      ok: true,
      connections: connections?.length ?? 0,
      synced, failed, imported, updated, deleted,
      ...(failed > 0 ? { errors } : {}),
    }), {
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
