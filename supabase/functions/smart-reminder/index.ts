/**
 * smart-reminder Edge Function
 *
 * Runs every day at 08:00 KST (23:00 UTC previous day) via pg_cron.
 * Sends AI-generated personalized push notifications to users who have
 * events today.
 *
 * Algorithm:
 *  1. Fetch today's events from the DB (grouped by user)
 *  2. Call Claude Haiku once to generate all reminder messages (batch prompt)
 *  3. Send push notifications via Expo Push API
 *
 * Security:
 *  - Called by pg_cron with service_role JWT (bypasses RLS)
 *  - ANTHROPIC_API_KEY in Supabase Secrets — never on client
 *
 * Environment variables required (Supabase Dashboard → Functions → Secrets):
 *  - ANTHROPIC_API_KEY   — Claude API key
 *  - SUPABASE_URL        — auto-injected
 *  - SUPABASE_SERVICE_ROLE_KEY — auto-injected (used for DB access)
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  location: string | null;
}

interface UserEventGroup {
  userId: string;
  pushToken: string;
  events: EventRow[];
}

interface ReminderMessage {
  userId: string;
  pushToken: string;
  title: string;
  body: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format HH:MM from an ISO-8601 datetime string (UTC+9 KST offset). */
function toKSTTimeString(isoString: string): string {
  const d = new Date(isoString);
  // KST = UTC + 9
  const kstHours = (d.getUTCHours() + 9) % 24;
  const kstMin   = d.getUTCMinutes();
  const period   = kstHours < 12 ? '오전' : '오후';
  const h        = kstHours === 0 ? 12 : kstHours > 12 ? kstHours - 12 : kstHours;
  return `${period} ${h}시${kstMin > 0 ? ` ${kstMin}분` : ''}`;
}

// ─── AI message generation ────────────────────────────────────────────────────

/**
 * Generates reminder messages for all users in a single Claude Haiku call.
 * Returns an array of { userId, body } objects.
 *
 * Format sent to Claude:
 *   user_id: events[{title, time, location}]
 * Expected response (one line per user):
 *   user_id|message body
 */
async function generateReminderMessages(
  client: Anthropic,
  groups: UserEventGroup[],
): Promise<Map<string, string>> {
  const eventSummaries = groups.map(g => {
    const eventList = g.events.map(e => {
      const time = toKSTTimeString(e.start_at);
      const loc  = e.location ? ` (${e.location})` : '';
      return `${e.title} - ${time}${loc}`;
    }).join(', ');
    return `${g.userId}: ${eventList}`;
  }).join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: `당신은 오늘 일정을 친근하게 알려주는 알림 문구 생성기입니다.
각 줄 형식: user_id|알림 문구 (한 줄, 40자 이내, 이모지 1개 포함)
예: abc123|오늘 오후 3시에 강남역 카페에서 미팅이 있어요 ☕
반드시 제공된 user_id를 그대로 사용하세요.`,
    messages: [{
      role: 'user',
      content: `다음 사용자들의 오늘 일정에 맞는 알림 문구를 생성해주세요:\n${eventSummaries}`,
    }],
  });

  const rawText = message.content[0].type === 'text' ? message.content[0].text : '';

  // Log aggregate usage metrics (non-blocking) — smart-reminder is a batch job
  // so we log once per invocation, not per user
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const INPUT_COST = 0.80 / 1_000_000;
    const OUTPUT_COST = 4.00 / 1_000_000;
    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    // Use first group's userId as representative (batch job covers multiple users)
    const firstUserId = groups[0]?.userId;
    if (firstUserId) {
      await supabaseAdmin.from('usage_metrics').insert({
        user_id: firstUserId,
        function_name: 'smart-reminder',
        model: 'claude-haiku-4-5',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: inputTokens * INPUT_COST + outputTokens * OUTPUT_COST,
      });
    }
  } catch (metricsErr) {
    console.error('[smart-reminder] usage_metrics insert failed:', metricsErr);
  }

  const messageMap = new Map<string, string>();

  for (const line of rawText.split('\n')) {
    const separatorIdx = line.indexOf('|');
    if (separatorIdx === -1) continue;
    const userId  = line.slice(0, separatorIdx).trim();
    const body    = line.slice(separatorIdx + 1).trim();
    if (userId && body) {
      messageMap.set(userId, body);
    }
  }

  return messageMap;
}

// ─── Push notification sender ─────────────────────────────────────────────────

/**
 * Sends push notifications via the Expo Push API.
 * Uses the simple HTTP API (no SDK dependency needed in Deno).
 */
async function sendPushNotifications(messages: ReminderMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const payload = messages.map(msg => ({
    to:    msg.pushToken,
    title: msg.title,
    body:  msg.body,
    sound: 'default',
    data:  { type: 'smart_reminder' },
  }));

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error('[smart-reminder] Expo push failed:', await response.text());
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (): Promise<Response> => {
  try {
    const supabaseUrl        = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Use service role to bypass RLS for cross-user queries
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Fetch today's events with push tokens (KST date)
    // today in KST = UTC + 9 hours
    const now    = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today  = kstNow.toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: eventRows, error: eventsError } = await supabase
      .from('events')
      .select('id, title, start_at, location, user_id')
      .gte('start_at', `${today}T00:00:00+09:00`)
      .lt('start_at',  `${today}T23:59:59+09:00`)
      .eq('all_day', false)
      .order('start_at');

    if (eventsError) throw eventsError;
    if (!eventRows || eventRows.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no events today' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch push tokens for the users who have events today
    const userIds = [...new Set(eventRows.map((e: { user_id: string }) => e.user_id))];
    const { data: userRows, error: usersError } = await supabase
      .from('users')
      .select('id, push_token')
      .in('id', userIds)
      .not('push_token', 'is', null);

    if (usersError) throw usersError;

    // 3. Group events by user (only for users with push tokens)
    const tokenMap = new Map<string, string>(
      (userRows ?? []).map((u: { id: string; push_token: string }) => [u.id, u.push_token])
    );

    const groups: UserEventGroup[] = [];
    for (const userId of userIds) {
      const token = tokenMap.get(userId);
      if (!token) continue;
      const userEvents = eventRows.filter((e: { user_id: string }) => e.user_id === userId);
      groups.push({ userId, pushToken: token, events: userEvents });
    }

    if (groups.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no push tokens registered' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Generate AI reminder messages (one Haiku call for all users)
    const client   = new Anthropic();
    const msgMap   = await generateReminderMessages(client, groups);

    // 5. Build and send push notifications
    const messages: ReminderMessage[] = groups.map(g => ({
      userId:    g.userId,
      pushToken: g.pushToken,
      title:     '오늘의 일정 알림',
      body:      msgMap.get(g.userId) ?? `오늘 일정이 ${g.events.length}개 있어요 📅`,
    }));

    await sendPushNotifications(messages);

    console.log(`[smart-reminder] Sent ${messages.length} notifications for ${today}`);

    return new Response(JSON.stringify({ sent: messages.length, date: today }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[smart-reminder] Fatal error:', message);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
