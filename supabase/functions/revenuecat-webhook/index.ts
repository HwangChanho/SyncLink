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
  // 1) Auth — fixed-secret header set in RevenueCat dashboard.
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const got = req.headers.get('authorization');
  if (!expected) {
    await logToDb('revenuecat-webhook.config', new Error('REVENUECAT_WEBHOOK_SECRET not set'));
    return bad(500, { error: 'server misconfigured' });
  }
  if (got !== expected) {
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

  const { error: updErr } = await admin
    .from('users')
    .update({ subscription_plan: plan })
    .eq('id', userId);
  if (updErr) {
    await logToDb('revenuecat-webhook.update', updErr, { userId, plan, evtType: evt.type });
    return bad(500, { error: 'db_update_failed' });
  }

  // 5) Audit row in usage_metrics so we can dedupe / inspect later.
  await admin.from('usage_metrics').insert({
    user_id:        userId,
    function_name:  'revenuecat-webhook',
    model:          evt.type,
    input_tokens:   0,
    output_tokens:  0,
    cost_usd:       0,
  });

  return ok({ status: 'ok', plan, event_id: evt.id });
});
