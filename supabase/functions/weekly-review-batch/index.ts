/**
 * weekly-review-batch — 자동 주간 회고 배치 Edge Fn (v1.2 Phase 4).
 *
 * 매주 일요일 21:00 KST 에 pg_cron 트리거 → 활성 사용자 전체 순회 → 각자의
 * 지난 1주 일정/할 일을 요약 + weekly_reviews 테이블에 저장 + Expo push.
 *
 * 인증: pg_cron 이 보낸 service_role secret (Authorization Bearer). 외부에서
 * 호출하면 401.
 *
 * 비용 안전망:
 *   - Free 사용자는 매주 1회만 (정상 cadence).
 *   - Pro 사용자도 매주 1회 (Pro 는 즉시 회고 UI 별도 지원).
 *   - 배치 한 번에 모든 사용자 → Haiku 사용 (Sonnet 아님). 사용자 200명
 *     × 평균 500 tokens ≈ $0.02 / 주.
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

interface WeeklyReviewRow {
  user_id: string;
  week_start: string;
  week_end: string;
  summary: string;
  highlights: unknown[];
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // 인증: pg_cron 시크릿 검증.
  const authHeader = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${Deno.env.get('WEEKLY_REVIEW_SECRET') ?? ''}`;
  if (!authHeader || authHeader !== expected) {
    return new Response(JSON.stringify({ error: 'auth' }), { status: 401 });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return new Response(JSON.stringify({ error: 'no_api_key' }), { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  // 1주 윈도우.
  const now = new Date();
  const weekEnd   = new Date(now);
  weekEnd.setHours(23, 59, 59, 999);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  // 활성 사용자 — 최근 7일 내 일정/할 일이 있는 사용자만.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeUsers, error: usersErr } = await (adminClient as any).rpc(
    'list_weekly_review_candidates',
    { since: weekStart.toISOString() },
  );
  if (usersErr) {
    // RPC 없으면 fallback: 모든 events.user_id distinct.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallback = await (adminClient as any)
      .from('events')
      .select('user_id')
      .gte('start_at', weekStart.toISOString())
      .lte('end_at', weekEnd.toISOString());
    if (fallback.error) return new Response(JSON.stringify({ error: 'no_users' }), { status: 500 });
    const ids = [...new Set((fallback.data ?? []).map((r: { user_id: string }) => r.user_id))];
    return await runBatch(ids as string[], adminClient, anthropic, weekStart, weekEnd);
  }

  const ids = (activeUsers as Array<{ user_id: string }>).map((u) => u.user_id);
  return await runBatch(ids, adminClient, anthropic, weekStart, weekEnd);
});

async function runBatch(
  userIds: string[],
  adminClient: ReturnType<typeof createClient>,
  anthropic: Anthropic,
  weekStart: Date,
  weekEnd: Date,
): Promise<Response> {
  let processed = 0;
  const pushMessages: Array<{ to: string; title: string; body: string; data: Record<string, unknown> }> = [];

  for (const userId of userIds) {
    try {
      const summary = await reviewOneUser(adminClient, anthropic, userId, weekStart, weekEnd);
      if (summary) {
        const row: WeeklyReviewRow = {
          user_id: userId,
          week_start: weekStart.toISOString().slice(0, 10),
          week_end:   weekEnd.toISOString().slice(0, 10),
          summary,
          highlights: [],
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (adminClient as any).from('weekly_reviews').upsert(row, {
          onConflict: 'user_id,week_start',
        });
        processed++;

        // v1.2 마무리 — Expo push notification 발송용 메시지 수집.
        // push_tokens 테이블에서 사용자의 token 조회.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: tokens } = await (adminClient as any)
          .from('push_tokens')
          .select('token')
          .eq('user_id', userId);
        if (tokens && tokens.length > 0) {
          for (const t of tokens as Array<{ token: string }>) {
            pushMessages.push({
              to: t.token,
              title: '주간 회고가 도착했어요',
              body: summary.slice(0, 80),
              data: { type: 'weekly_review', userId },
            });
          }
        }
      }
    } catch (e) {
      console.error('[weekly-review-batch] user error', userId, e);
    }
  }

  // Expo push 100개 단위 chunk 전송 (Expo push API 제한).
  if (pushMessages.length > 0) {
    try {
      const chunks: typeof pushMessages[] = [];
      for (let i = 0; i < pushMessages.length; i += 100) {
        chunks.push(pushMessages.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
      }
    } catch (e) {
      console.error('[weekly-review-batch] push send error', e);
    }
  }

  return new Response(JSON.stringify({ processed, total: userIds.length, pushed: pushMessages.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function reviewOneUser(
  adminClient: ReturnType<typeof createClient>,
  anthropic: Anthropic,
  userId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: events } = await (adminClient as any)
    .from('events')
    .select('title, start_at, end_at')
    .eq('user_id', userId)
    .gte('start_at', weekStart.toISOString())
    .lte('end_at', weekEnd.toISOString())
    .limit(40);

  if (!events || events.length === 0) return null;

  const prompt = [
    '아래는 한 사용자의 지난 1주일 일정입니다. 친근한 톤으로 2-3문장 한국어 회고를 작성하세요.',
    JSON.stringify(events),
  ].join('\n');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  return text.trim() || null;
}
