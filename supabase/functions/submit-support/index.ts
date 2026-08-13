/**
 * submit-support Edge Function — 앱 내 버그 제보 / 문의 접수.
 *
 * 흐름:
 *   1. 입력 검증(종류·본문 길이·회신 메일 형식)
 *   2. 레이트리밋 — 같은 사용자/IP 가 짧은 시간에 도배하는 걸 막는다
 *   3. `support_requests` 행 삽입   ← **먼저 저장한다**
 *   4. 관리자 메일 발송(Resend) 후 `emailed_at` 갱신
 *
 * 🔴 순서가 중요하다. 메일을 먼저 보내고 저장하면, 저장이 실패했을 때 제보 내용이
 *    메일에만 남는다. 반대로 하면 메일이 실패해도 행은 남아 나중에 다시 보낼 수 있다.
 *    Resend 무료 티어는 일일 한도가 있어 **발송 실패는 정상 범주의 사건**이다.
 *    그래서 메일 실패는 200 으로 응답한다 — 사용자 입장에선 제보가 접수된 게 맞다.
 *
 * 비로그인 허용: 종전 mailto 경로가 로그아웃 상태에서도 동작했으므로 막으면 후퇴다.
 * 대신 익명은 레이트리밋을 더 좁게 건다.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ADMIN_NOTIFY_EMAIL
 */

// @ts-expect-error: Deno remote import — tsc cannot resolve but runtime can.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendAdminEmail } from '../_shared/email.ts';

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

const KIND_LABEL: Record<Kind, string> = {
  bug: '버그 제보',
  inquiry: '문의',
};

/** HTML 메일에 사용자 입력을 그대로 넣지 않기 위한 이스케이프. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  // ── 2) 관리자 메일 ─────────────────────────────────────────────────────────
  // 실패해도 200 — 사용자에겐 접수가 끝난 게 맞다. emailed_at 이 null 로 남아
  // 나중에 재발송 대상으로 식별된다.
  let emailed = false;
  try {
    const rows = Object.entries(diag)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `<tr><td style="padding:2px 10px 2px 0;color:#666">${esc(k)}</td><td>${esc(String(v))}</td></tr>`)
      .join('');

    await sendAdminEmail({
      subject: `[투투리스트] ${KIND_LABEL[kind as Kind]} — ${message.slice(0, 30).replace(/\n/g, ' ')}`,
      html: `
        <h2 style="margin:0 0 12px">${KIND_LABEL[kind as Kind]}</h2>
        <div style="white-space:pre-wrap;padding:14px;background:#f6f6fa;border-radius:8px;line-height:1.6">${esc(message)}</div>
        <p style="margin:16px 0 4px;color:#666;font-size:13px">회신: ${esc(replyEmail ?? userEmail ?? '(없음)')}</p>
        <table style="font-size:12px;color:#333;border-collapse:collapse">${rows}</table>
        <p style="color:#999;font-size:11px">id: ${inserted.id}</p>
      `,
    });
    await admin
      .from('support_requests')
      .update({ emailed_at: new Date().toISOString() })
      .eq('id', inserted.id);
    emailed = true;
  } catch (e) {
    console.error('[submit-support] email failed:', (e as Error).message);
  }

  return json({ ok: true, id: inserted.id, emailed });
});
