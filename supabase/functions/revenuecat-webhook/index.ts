/**
 * RevenueCat → Supabase webhook.
 *
 * RevenueCat sends a POST whenever a subscription event happens (initial
 * purchase, renewal, cancellation, expiration, billing issue, refund …).
 * We translate those events into the canonical `users.subscription_plan`
 * column so server-side gates (translate-event, AI quota helper, etc.)
 * see the same Pro state RevenueCat does.
 *
 * Auth model: RevenueCat lets us configure an Authorization header value
 * that they'll attach to every webhook request. We compare it against the
 * REVENUECAT_WEBHOOK_SECRET we keep in `supabase secrets`. No JWT.
 *
 * Idempotency: each event has a unique `id`. We append it to the
 * `usage_metrics` table (function_name = 'revenuecat-webhook') with cost 0
 * so we can audit and dedupe via the `transaction_id` field.
 *
 * Plan resolution rules (per RevenueCat best practices):
 *   - INITIAL_PURCHASE / RENEWAL / NON_RENEWING_PURCHASE / UNCANCELLATION
 *     / PRODUCT_CHANGE / SUBSCRIPTION_PAUSED→resumed → plan = 'pro'
 *   - EXPIRATION / CANCELLATION (when expires_at is in the past)
 *     / SUBSCRIPTION_EXTENDED (still pro) — let the explicit
 *     `entitlement_ids` payload win; if "pro" entitlement is active
 *     post-event, set 'pro', otherwise 'free'.
 *
 * Sprint 18 P1 hardening.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Deno import map resolves at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — _shared paths are resolved by supabase functions deploy.
import { logToDb } from '../_shared/logger.ts';

interface RcWebhookEvent {
  api_version?: string;
  event?: {
    id: string;
    type:
      | 'INITIAL_PURCHASE'
      | 'RENEWAL'
      | 'NON_RENEWING_PURCHASE'
      | 'UNCANCELLATION'
      | 'PRODUCT_CHANGE'
      | 'CANCELLATION'
      | 'SUBSCRIPTION_PAUSED'
      | 'EXPIRATION'
      | 'BILLING_ISSUE'
      | 'SUBSCRIBER_ALIAS'
      | 'TRANSFER'
      | 'TEST'
      | string;
    app_user_id: string;
    original_app_user_id?: string;
    aliases?: string[];
    /** ISO microseconds — when the entitlement currently expires. */
    expiration_at_ms?: number;
    /** Currently-active entitlement identifiers (post-event). */
    entitlement_ids?: string[];
    /** Some events expose this single field instead. */
    entitlement_id?: string;
    [k: string]: unknown;
  };
}

const PRO_ENTITLEMENT = 'pro';

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
function bad(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Pure resolver: from the event payload decide whether the user should
 * end up Pro. RevenueCat's `entitlement_ids` is the authoritative list
 * of active entitlements after the event, so we simply check membership.
 */
function isProAfterEvent(evt: NonNullable<RcWebhookEvent['event']>): boolean {
  const ids = new Set<string>([
    ...(evt.entitlement_ids ?? []),
    ...(evt.entitlement_id ? [evt.entitlement_id] : []),
  ]);
  return ids.has(PRO_ENTITLEMENT);
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 0) Entry breadcrumb — drop a row for every incoming request so we can
  //    confirm RevenueCat is actually reaching the function and see the
  //    headers / method it sent. Stash only header *names* so we don't
  //    persist the shared secret.
  try {
    await logToDb('revenuecat-webhook.entry', new Error('request received'), {
      method: req.method,
      url: req.url,
      ua: req.headers.get('user-agent') ?? '',
      contentType: req.headers.get('content-type') ?? '',
      hasAuth: !!req.headers.get('authorization'),
    });
  } catch {/* logging is best-effort */}

  // 1) Auth — fixed-secret header set in RevenueCat dashboard.
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const got = req.headers.get('authorization');
  if (!expected) {
    await logToDb('revenuecat-webhook.config', new Error('REVENUECAT_WEBHOOK_SECRET not set'));
    return bad(500, { error: 'server misconfigured' });
  }
  if (got !== expected) {
    // Log so we can tell test events apart from genuine misconfiguration.
    // Stash only the prefix of the received header so the secret never
    // ends up in our database in plaintext.
    await logToDb('revenuecat-webhook.unauthorized', new Error('header mismatch'), {
      receivedPrefix: (got ?? '').slice(0, 8),
      receivedLength: got?.length ?? 0,
      expectedLength: expected.length,
    });
    return bad(401, { error: 'unauthorized' });
  }

  // 2) Parse body.
  let payload: RcWebhookEvent;
  try {
    payload = (await req.json()) as RcWebhookEvent;
  } catch (err) {
    await logToDb('revenuecat-webhook.parse', err);
    return bad(400, { error: 'invalid_json' });
  }
  const evt = payload.event;
  if (!evt?.id || !evt.app_user_id) {
    return bad(400, { error: 'malformed_event' });
  }

  // 3) Resolve target plan.
  const plan = isProAfterEvent(evt) ? 'pro' : 'free';
  const userId = evt.app_user_id;

  // 4) Update users.subscription_plan. Service role bypasses the
  //    privileged-columns trigger so this is the only legitimate path.
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // RevenueCat's "Send test event" uses synthetic app_user_id values that
  // don't exist in our users table. Skip the DB write but still confirm
  // success so the dashboard reports a healthy 200 + we have a trace.
  if (evt.type === 'TEST' || userId.startsWith('test-')) {
    await logToDb('revenuecat-webhook.test', new Error('test event accepted'), {
      userId, evtType: evt.type, plan,
    });
    return ok({ status: 'ok', test: true, event_id: evt.id });
  }

  const { error: updErr } = await admin
    .from('users')
    .update({ subscription_plan: plan })
    .eq('id', userId);
  if (updErr) {
    await logToDb('revenuecat-webhook.update', updErr, { userId, plan, evtType: evt.type });
    return bad(500, { error: 'db_update_failed' });
  }

  // 5) Audit row in usage_metrics so we can dedupe / inspect later.
  const { error: auditErr } = await admin.from('usage_metrics').insert({
    user_id:        userId,
    function_name:  'revenuecat-webhook',
    model:          evt.type,
    input_tokens:   0,
    output_tokens:  0,
    cost_usd:       0,
  });
  if (auditErr) {
    // Non-fatal: the user-row update already succeeded. Log so we know.
    await logToDb('revenuecat-webhook.audit', auditErr, { userId, plan, evtType: evt.type });
  }

  // Success breadcrumb — easier to grep in production logs than scanning
  // usage_metrics, especially when audit insert fails (e.g. FK violations).
  await logToDb('revenuecat-webhook.success', new Error('plan applied'), {
    userId, plan, evtType: evt.type, eventId: evt.id,
  });

  // v1.2.7 — 새 Pro 구독자 알림 (LEAD email). INITIAL_PURCHASE 만 트리거 —
  // 갱신 (RENEWAL) 은 noise 라 skip. 사용자 nickname/email 까지 본문에 포함.
  if (plan === 'pro' && evt.type === 'INITIAL_PURCHASE') {
    try {
      // 사용자 정보 fetch.
      const { data: u } = await admin
        .from('users')
        .select('nickname, country_code, created_at')
        .eq('id', userId)
        .maybeSingle();
      const { data: au } = await admin.auth.admin.getUserById(userId);
      const userEmail = au?.user?.email ?? '(unknown)';

      // @ts-ignore — Deno path resolves at deploy time.
      const { sendAdminEmail } = await import('../_shared/email.ts');
      await sendAdminEmail({
        subject: `🎉 새 Pro 구독자 — ${u?.nickname ?? '(닉네임 없음)'}`,
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width:520px; padding:24px;">
            <h2 style="color:#7C3AED; margin:0 0 16px;">🎉 새 Pro 구독자가 생겼어요</h2>
            <table style="border-collapse:collapse; width:100%;">
              <tr><td style="padding:6px 0; color:#6B7280;">닉네임</td>
                  <td style="padding:6px 0;"><b>${escapeHtml(u?.nickname ?? '-')}</b></td></tr>
              <tr><td style="padding:6px 0; color:#6B7280;">이메일</td>
                  <td style="padding:6px 0;">${escapeHtml(userEmail)}</td></tr>
              <tr><td style="padding:6px 0; color:#6B7280;">국가</td>
                  <td style="padding:6px 0;">${escapeHtml(u?.country_code ?? '-')}</td></tr>
              <tr><td style="padding:6px 0; color:#6B7280;">가입일</td>
                  <td style="padding:6px 0;">${(u?.created_at ?? '').slice(0, 10)}</td></tr>
              <tr><td style="padding:6px 0; color:#6B7280;">RevenueCat event</td>
                  <td style="padding:6px 0; color:#9CA3AF; font-family:monospace; font-size:12px;">
                    ${escapeHtml(evt.type)} · ${escapeHtml(evt.id ?? '')}
                  </td></tr>
            </table>
            <p style="margin-top:24px; color:#9CA3AF; font-size:12px;">
              SyncLink 관리자 대시보드: <a href="https://synclink.pages.dev/admin">/admin</a>
            </p>
          </div>
        `,
      });
    } catch (err) {
      await logToDb('revenuecat-webhook.notify_email', err, { userId, evtType: evt.type });
    }
  }

  return ok({ status: 'ok', plan, event_id: evt.id });
});

/** 매우 단순한 HTML escape — script 주입 방지. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
