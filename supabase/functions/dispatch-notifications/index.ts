/**
 * dispatch-notifications Edge Function
 *
 * Drains `notifications_queue` and delivers pending push notifications via
 * the Expo Push API. Triggered every minute by pg_cron job
 * `space-activity-dispatch` (see migration 021).
 *
 * Flow:
 *   1. Fetch up to BATCH_SIZE rows where sent_at IS NULL AND retry_count < MAX_RETRY
 *   2. Re-resolve recipient push_token (may have changed since enqueue)
 *   3. Build per-row Expo Push messages (localized title + body)
 *   4. POST to Expo Push API in chunks of 100
 *   5. Parse response → mark sent_at on success, increment retry_count on
 *      transient failure, NULL the user's push_token on DeviceNotRegistered
 *
 * Security:
 *   - Called by pg_cron with service_role JWT (bypasses RLS)
 *   - SUPABASE_SERVICE_ROLE_KEY is auto-injected by Supabase runtime
 *
 * Cost:
 *   - Expo Push: free, unlimited
 *   - Edge Function invocations: 1/min = ~43k/month (~8% of free tier)
 */

import { createClient } from 'npm:@supabase/supabase-js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many queue rows to process per invocation (Expo recommends max 100/req). */
const BATCH_SIZE = 100;

/** After this many failed attempts, give up (row stays sent_at=NULL but ignored). */
const MAX_RETRY = 5;

/** Expo Push API endpoint. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ─── Types ────────────────────────────────────────────────────────────────────

type NotificationType = 'event_added' | 'event_updated' | 'event_deleted' | 'message_received';

interface QueueRow {
  id: string;
  space_id: string;
  recipient_user_id: string;
  actor_user_id: string | null;
  event_id: string | null;
  type: NotificationType;
  payload: {
    title?: string;
    start_at?: string;
    actor_nickname?: string;
  };
  retry_count: number;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: {
    type: NotificationType;
    space_id: string;
    event_id: string | null;
    queue_id: string;
  };
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface ExpoPushResponse {
  data: ExpoPushTicket[];
}

// ─── Message builders ────────────────────────────────────────────────────────

/**
 * Build a localized push title + body for one queue row.
 *
 * NOTE: Server-side i18n is hard-coded to Korean here because the user's
 * preferred locale is not stored in the DB (only auto-detected on the client).
 * If/when we add `users.locale`, switch on that here. For now, ko default
 * matches the app's primary market and the existing string in
 * src/locales/ko.ts (`notification.space_activity`).
 */
function buildMessage(row: QueueRow): { title: string; body: string } {
  const actor = row.payload.actor_nickname?.trim() || '멤버';
  const eventTitle = row.payload.title?.trim();
  // v1.2.0 메신저용 payload 키.
  const spaceName = (row.payload as { space_name?: string }).space_name?.trim();
  const preview   = (row.payload as { preview?: string }).preview?.trim();

  switch (row.type) {
    case 'event_added':
      return {
        title: 'Space 활동',
        body: eventTitle
          ? `${actor}님이 새 일정 "${eventTitle}"을(를) 공유했어요`
          : `${actor}님이 새 일정을 공유했어요`,
      };
    case 'event_updated':
      return {
        title: 'Space 활동',
        body: eventTitle
          ? `${actor}님이 일정 "${eventTitle}"을(를) 수정했어요`
          : `${actor}님이 일정을 수정했어요`,
      };
    case 'event_deleted':
      return {
        title: 'Space 활동',
        body: eventTitle
          ? `${actor}님이 일정 "${eventTitle}"을(를) 삭제했어요`
          : `${actor}님이 일정을 삭제했어요`,
      };
    case 'message_received':
      return {
        title: spaceName ? `${spaceName} · ${actor}` : actor,
        body:  preview && preview.length > 0 ? preview : '새 메시지',
      };
  }
}

// ─── Expo Push delivery ─────────────────────────────────────────────────────

/**
 * Send a chunk of messages to Expo Push API.
 * Returns the per-message ticket array (same order as input).
 * Throws on network failure — caller treats whole chunk as transient failure.
 */
async function sendExpoChunk(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Expo HTTP ${response.status}: ${text}`);
  }

  const json = (await response.json()) as ExpoPushResponse;
  return json.data ?? [];
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // v1.1.4 — pg_cron 이 service_role JWT 대신 DISPATCH_SECRET 헤더로 호출.
  // (vault 에 service_role_key 를 박지 않기 위함 — weekly-review-batch 와
  // 동일 패턴.) Authorization: Bearer <DISPATCH_SECRET> 형식.
  const dispatchSecret = Deno.env.get('DISPATCH_SECRET') ?? '';
  if (dispatchSecret) {
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== dispatchSecret) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ─── 1. Fetch pending queue rows ──────────────────────────────────────
    const { data: rows, error: fetchError } = await supabase
      .from('notifications_queue')
      .select('id, space_id, recipient_user_id, actor_user_id, event_id, type, payload, retry_count')
      .is('sent_at', null)
      .lt('retry_count', MAX_RETRY)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const queueRows = rows as QueueRow[];

    // ─── 2. Resolve push tokens (re-fetch to handle stale tokens) ─────────
    const recipientIds = [...new Set(queueRows.map((r) => r.recipient_user_id))];
    const { data: userRows, error: userError } = await supabase
      .from('users')
      .select('id, push_token, push_enabled, notification_preferences')
      .in('id', recipientIds);

    if (userError) throw userError;

    type UserRow = {
      id: string;
      push_token: string | null;
      push_enabled: boolean | null;
      notification_preferences: Record<string, unknown> | null;
    };

    const userMap = new Map<string, UserRow>(
      ((userRows ?? []) as UserRow[]).map((u) => [u.id, u]),
    );

    // ─── 3. Build messages, separating skip / send buckets ────────────────
    const messages: ExpoPushMessage[] = [];
    const messageRowIds: string[] = []; // parallel array — index ↔ queue row id
    const skipRowIds: string[] = []; // mark as sent to drop from queue (no retry)

    for (const row of queueRows) {
      const user = userMap.get(row.recipient_user_id);

      // Recipient gone, push disabled, no token, or per-category toggle off → drop
      if (
        !user ||
        !user.push_token ||
        user.push_enabled === false ||
        (user.notification_preferences &&
          user.notification_preferences['space_activity'] === false)
      ) {
        skipRowIds.push(row.id);
        continue;
      }

      const { title, body } = buildMessage(row);
      messages.push({
        to: user.push_token,
        title,
        body,
        sound: 'default',
        data: {
          type: row.type,
          space_id: row.space_id,
          event_id: row.event_id,
          queue_id: row.id,
        },
      });
      messageRowIds.push(row.id);
    }

    // Mark skip rows as "sent" so they're removed from the pending pool.
    // Using sent_at=now() with a marker in last_error so the audit trail is clear.
    if (skipRowIds.length > 0) {
      await supabase
        .from('notifications_queue')
        .update({ sent_at: new Date().toISOString(), last_error: 'skipped:no-eligible-recipient' })
        .in('id', skipRowIds);
    }

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ processed: queueRows.length, sent: 0, skipped: skipRowIds.length }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ─── 4. Deliver via Expo Push ─────────────────────────────────────────
    let tickets: ExpoPushTicket[] = [];
    try {
      tickets = await sendExpoChunk(messages);
    } catch (err) {
      // Transient failure — bump retry_count for everything in this batch
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[dispatch-notifications] Expo chunk failed:', errMsg);

      // Increment retry_count for all attempted rows
      for (const rowId of messageRowIds) {
        const original = queueRows.find((r) => r.id === rowId);
        if (!original) continue;
        await supabase
          .from('notifications_queue')
          .update({ retry_count: original.retry_count + 1, last_error: errMsg.slice(0, 500) })
          .eq('id', rowId);
      }

      return new Response(
        JSON.stringify({ processed: queueRows.length, sent: 0, transient_error: errMsg }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ─── 5. Process per-message tickets ───────────────────────────────────
    let okCount = 0;
    let errCount = 0;
    const tokensToRevoke: string[] = []; // userIds whose tokens are dead

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const rowId = messageRowIds[i];
      const row = queueRows.find((r) => r.id === rowId);
      if (!row) continue;

      if (ticket.status === 'ok') {
        await supabase
          .from('notifications_queue')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', rowId);
        okCount++;
      } else {
        const detailErr = ticket.details?.error ?? '';
        const errMsg = ticket.message ?? 'Expo error';

        // DeviceNotRegistered → token is dead, revoke it
        if (detailErr === 'DeviceNotRegistered') {
          tokensToRevoke.push(row.recipient_user_id);
          // Mark this row as sent so we don't keep retrying
          await supabase
            .from('notifications_queue')
            .update({
              sent_at: new Date().toISOString(),
              last_error: 'DeviceNotRegistered',
            })
            .eq('id', rowId);
        } else {
          // Other errors → retry next minute
          await supabase
            .from('notifications_queue')
            .update({
              retry_count: row.retry_count + 1,
              last_error: `${errMsg}${detailErr ? ` (${detailErr})` : ''}`.slice(0, 500),
            })
            .eq('id', rowId);
        }
        errCount++;
      }
    }

    // Revoke dead tokens (set push_token to NULL)
    if (tokensToRevoke.length > 0) {
      const uniq = [...new Set(tokensToRevoke)];
      await supabase.from('users').update({ push_token: null }).in('id', uniq);
    }

    console.log(
      `[dispatch-notifications] processed=${queueRows.length} sent=${okCount} err=${errCount} skipped=${skipRowIds.length} revoked=${tokensToRevoke.length}`,
    );

    return new Response(
      JSON.stringify({
        processed: queueRows.length,
        sent: okCount,
        errors: errCount,
        skipped: skipRowIds.length,
        revoked_tokens: tokensToRevoke.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[dispatch-notifications] Fatal error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
