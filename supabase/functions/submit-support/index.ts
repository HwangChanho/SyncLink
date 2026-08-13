/**
 * submit-support Edge Function — 앱 내 버그 제보 / 문의 접수.
 *
 * 흐름:
 *   1. 입력 검증(종류·본문 길이·회신 메일 형식)
 *   2. 레이트리밋 — 같은 사용자/IP 가 짧은 시간에 도배하는 걸 막는다
 *   3. `support_requests` 행 삽입
 *
 * 관리자에게는 메일을 보내지 않는다 — 관리자 페이지(/admin)에서 조회한다.
 * 종전엔 Resend 로 메일을 보냈으나, 무료 티어 한도·스팸 유입 문제가 있고
 * 어차피 관리자 페이지가 있어 한 곳에서 보는 편이 낫다는 판단(2026-08-13).
 *
 * 비로그인 허용: 종전 mailto 경로가 로그아웃 상태에서도 동작했으므로 막으면 후퇴다.
 * 대신 익명은 레이트리밋을 더 좁게 건다.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-expect-error: Deno remote import — tsc cannot resolve but runtime can.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(key: string): string | undefined } };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** 본문 길이 한계 — DB CHECK 와 같은 값. 클라이언트에서도 같은 값을 쓴다. */
const MSG_MIN = 5;
const MSG_MAX = 4000;

/** 레이트리밋 창(분)과 창당 허용 건수. 익명은 더 좁다. */
const WINDOW_MIN = 10;
const LIMIT_USER = 5;
const LIMIT_ANON = 2;

const KINDS = ['bug', 'inquiry'] as const;
type Kind = (typeof KINDS)[number];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const kind = String(body.kind ?? '');
  const message = String(body.message ?? '').trim();
  const replyEmail = body.replyEmail ? String(body.replyEmail).trim() : null;
  const diagnostics = (body.diagnostics ?? {}) as Record<string, unknown>;

  if (!KINDS.includes(kind as Kind)) return json({ error: 'invalid_kind' }, 400);
  if (message.length < MSG_MIN) return json({ error: 'message_too_short' }, 400);
  if (message.length > MSG_MAX) return json({ error: 'message_too_long' }, 400);
  if (replyEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyEmail)) {
    return json({ error: 'invalid_email' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 호출자 식별 — Authorization 헤더가 있으면 사용자, 없으면 익명.
  let userId: string | null = null;
  let userEmail: string | null = null;
  let nickname: string | null = null;
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const { data } = await admin.auth.getUser(auth.slice(7));
    if (data?.user) {
      userId = data.user.id;
      userEmail = data.user.email ?? null;
      const { data: row } = await admin
        .from('users').select('nickname').eq('id', userId).maybeSingle();
      nickname = row?.nickname ?? null;
    }
  }

  // ── 레이트리밋 ─────────────────────────────────────────────────────────────
  // 익명은 user_id 가 null 이라 사용자별로 못 센다 → IP 로 센다.
  // IP 는 진단 정보에 남기지 않고 여기서만 쓴다(개인정보 최소 수집).
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateQuery = admin
    .from('support_requests')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  const { count } = userId
    ? await rateQuery.eq('user_id', userId)
    : await rateQuery.is('user_id', null).eq('diagnostics->>ipHash', ip);

  if ((count ?? 0) >= (userId ? LIMIT_USER : LIMIT_ANON)) {
    return json({ error: 'rate_limited', retryAfterMinutes: WINDOW_MIN }, 429);
  }

  // ── 1) 저장 ────────────────────────────────────────────────────────────────
  const diag = {
    ...diagnostics,
    // 익명 레이트리밋 키. 원문 IP 를 오래 들고 있지 않도록 익명 제보에만 남긴다.
    ...(userId ? {} : { ipHash: ip }),
    userEmail,
    nickname,
  };

  const { data: inserted, error: insertErr } = await admin
    .from('support_requests')
    .insert({
      user_id: userId,
      kind,
      message,
      reply_email: replyEmail ?? userEmail,
      diagnostics: diag,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[submit-support] insert failed:', insertErr.message);
    return json({ error: 'save_failed' }, 500);
  }

  // 메일은 보내지 않는다(LEAD 결정 2026-08-13). 관리자 페이지에서 조회한다.
  //   · Resend 무료 티어는 일일 한도가 있고 스팸함으로 새기도 한다
  //   · 어차피 관리자 페이지가 있으니 한 곳에서 보는 편이 낫다
  // ⚠️ 대신 새 제보를 알려주는 푸시가 없다 — 관리자가 주기적으로 확인해야 한다.

  return json({ ok: true, id: inserted.id });
});
