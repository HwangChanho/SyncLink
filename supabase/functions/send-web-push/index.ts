/**
 * send-web-push Edge Function
 *
 * Fan-out a single notification payload to every web PushSubscription
 * registered for a given user. Called server-side from the smart-reminder
 * cron pipeline (and ad-hoc by other Edge Functions when something needs
 * to nudge an open browser tab).
 *
 * Security: requireServiceRole() 로 service_role 키를 강제한다.
 * ⚠️ verify_jwt 설정만으로는 부족하다 — anon 키가 그 게이트를 통과한다.
 *    상세와 실측 근거는 _shared/serviceAuth.ts 헤더 참고.
 *
 * Request body:
 *   { user_id: uuid, title: string, body: string, url?: string }
 *
 * Environment variables (Supabase Dashboard → Functions → Secrets):
 *   - VAPID_PUBLIC_KEY      — Base64URL VAPID public key (matches client EXPO_PUBLIC_VAPID_PUBLIC_KEY)
 *   - VAPID_PRIVATE_KEY     — Base64URL VAPID private key
 *   - VAPID_SUBJECT         — `mailto:contact@synclink.io` (RFC8292 sub)
 *   - SUPABASE_URL          — auto-injected
 *   - SUPABASE_SERVICE_ROLE_KEY — auto-injected
 *
 * Implementation note: we lean on the `web-push` npm package via Deno's
 * npm: imports — it handles VAPID JWT signing, payload encryption (RFC8291),
 * and the RFC8030 POST. Re-implementing those primitives by hand would be
 * fragile and security-sensitive.
 */

import webPush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js';
// @ts-ignore — Deno 는 배포 시점에 상대 경로를 해석한다.
import { requireServiceRole } from '../_shared/serviceAuth.ts';

interface SubscriptionRow {
  id:       string;
  endpoint: string;
  p256dh:   string;
  auth:     string;
}

interface SendBody {
  user_id: string;
  title:   string;
  body:    string;
  url?:    string;
}

// ─── VAPID setup ──────────────────────────────────────────────────────────────

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:contact@synclink.io';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  // 🔴 2026-09-09: 위 주석은 "service-role 키가 필요하다"고 적고 있었지만
  //    **코드엔 그 검증이 없었다.** anon 키만으로 임의의 user_id 에 웹 푸시를
  //    보낼 수 있는 상태였다(실측: anon 키로 405 = 함수 본문 도달).
  const denied = requireServiceRole(req);
  if (denied) return denied;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: 'vapid_not_configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: SendBody;
  try {
    payload = await req.json() as SendBody;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  if (!payload.user_id || !payload.title) {
    return new Response('user_id and title required', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Pull all live subscriptions for the target user. Stale rows (browser
  // unsubscribed) get deleted lazily on 404/410 below.
  const { data: subs, error } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', payload.user_id)
    .returns<SubscriptionRow[]>();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const messageJSON = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    url:   payload.url ?? '/',
  });

  // Push in parallel; collect endpoints that came back 404/410 so we can
  // garbage-collect them after the fan-out.
  const results = await Promise.all(subs.map(async (s) => {
    try {
      await webPush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        messageJSON,
      );
      return { id: s.id, ok: true as const };
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode;
      // 404/410 means the browser removed the subscription — drop it.
      const gone = status === 404 || status === 410;
      return { id: s.id, ok: false as const, gone };
    }
  }));

  const goneIds = results.filter((r) => !r.ok && r.gone).map((r) => r.id);
  if (goneIds.length > 0) {
    await supabase.from('web_push_subscriptions').delete().in('id', goneIds);
  }

  const sent = results.filter((r) => r.ok).length;
  return new Response(JSON.stringify({ ok: true, sent, dropped: goneIds.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
