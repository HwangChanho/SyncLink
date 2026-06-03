/**
 * weekly-review Edge Function
 *
 * Generates a short AI-written weekly review card for the user's home screen.
 * Uses past week's events and todos to produce a personalized 2-3 sentence
 * summary in Korean.
 *
 * Security model:
 *  - ANTHROPIC_API_KEY lives ONLY here (Supabase Secrets), never on the client.
 *  - Requests must carry a valid Supabase JWT (user session token).
 *  - The function reads data only for the authenticated user.
 *
 * Called by: src/services/aiService.ts → getWeeklyReview()
 *
 * Environment variables required:
 *  - ANTHROPIC_API_KEY — Claude API key
 *  - SUPABASE_URL      — auto-injected by Supabase runtime
 *  - SUPABASE_ANON_KEY — auto-injected by Supabase runtime
 *
 * TASK-504 (Sprint 5)
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Request / response types ─────────────────────────────────────────────────

interface WeeklyReviewRequest {
  /** ISO-8601 timestamp of Monday 00:00 for the week to review. */
  weekStart: string;
}

interface WeeklyReviewResponse {
  /** 2-3 sentence Korean review text. */
  review: string;
  /** ISO-8601 timestamp of when this review was generated. */
  generatedAt: string;
}

// ─── CORS headers ─────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: verify JWT ──────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: '인증이 필요합니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse request body ────────────────────────────────────────────────────
    const { weekStart }: WeeklyReviewRequest = await req.json();
    if (!weekStart) {
      return new Response(
        JSON.stringify({ error: 'weekStart 파라미터가 필요합니다.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const weekStartDate = new Date(weekStart);
    // Previous week = weekStart minus 7 days
    const prevWeekStart = new Date(weekStartDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeekEnd   = new Date(weekStartDate.getTime() - 1);

    // ── Supabase client (user context) ────────────────────────────────────────
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey  = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase     = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Resolve authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: '사용자 인증에 실패했습니다.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Quota gate (Free 1/day, Pro 5/hour) ───────────────────────────────────
    const adminClientForQuota = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — Deno path resolves at deploy time.
    const { enforceQuota } = await import('../_shared/quota.ts');
    const quota = await enforceQuota({
      adminClient: adminClientForQuota,
      userId: user.id,
      functionName: 'weekly-review',
    });
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({ error: quota.reason, plan: quota.plan }),
        {
          status: quota.reason === 'pro_required' ? 403 : 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    // ── Query last week's data ────────────────────────────────────────────────

    // Events in the previous week (own events only)
    const { data: pastEvents, error: eventsError } = await supabase
      .from('events')
      .select('title, start_at, end_at, all_day')
      .eq('user_id', user.id)
      .gte('start_at', prevWeekStart.toISOString())
      .lte('start_at', prevWeekEnd.toISOString());

    if (eventsError) throw eventsError;

    // Todos from the previous week (completed + pending)
    const { data: pastTodos, error: todosError } = await supabase
      .from('todos')
      .select('title, is_completed, due_date, content_type')
      .eq('user_id', user.id)
      .eq('content_type', 'todo')
      .gte('created_at', prevWeekStart.toISOString())
      .lte('created_at', prevWeekEnd.toISOString());

    if (todosError) throw todosError;

    // Events in the current week (upcoming)
    const nextWeekEnd = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { data: upcomingEvents } = await supabase
      .from('events')
      .select('title, start_at')
      .eq('user_id', user.id)
      .gte('start_at', weekStartDate.toISOString())
      .lte('start_at', nextWeekEnd.toISOString());

    // ── Build prompt context ──────────────────────────────────────────────────
    // LEAD 2026-04-28: 다국어 적용. 클라이언트가 locale 전달 (default 'ko').
    const locale: string = (body?.locale as string) || 'ko';
    const localeForDate: Record<string, string> = {
      ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP',
    };

    const completedTodos = (pastTodos ?? []).filter((t: { is_completed: boolean }) => t.is_completed);
    const totalTodos     = (pastTodos ?? []).length;
    const totalEvents    = (pastEvents ?? []).length;
    const upcomingCount  = (upcomingEvents ?? []).length;

    // Find the busiest day of the past week
    const dayCounts: Record<string, number> = {};
    for (const ev of pastEvents ?? []) {
      const day = new Date((ev as { start_at: string }).start_at)
        .toLocaleDateString(localeForDate[locale] ?? 'ko-KR', { weekday: 'long' });
      dayCounts[day] = (dayCounts[day] ?? 0) + 1;
    }
    const busiestDay = Object.entries(dayCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

    // Locale-specific context summary + prompt
    type ReviewLabels = {
      pastEvents: (n: number) => string;
      todos: (done: number, total: number) => string;
      noTodos: string;
      busiest: (d: string) => string;
      upcoming: (n: number) => string;
      prompt: (ctx: string) => string;
    };

    const labelsByLocale: Record<string, ReviewLabels> = {
      ko: {
        pastEvents: (n) => `지난 주 일정: ${n}개`,
        todos: (d, t) => `할일: ${t}개 중 ${d}개 완료`,
        noTodos: '할일 없음',
        busiest: (d) => `가장 바쁜 날: ${d}`,
        upcoming: (n) => `이번 주 예정 일정: ${n}개`,
        prompt: (ctx) => `다음 정보를 바탕으로 간략하고 친근한 주간 리뷰를 한국어로 2-3문장 작성해 주세요. 격려하는 톤으로, 이모지 없이 작성해 주세요.\n\n${ctx}`,
      },
      en: {
        pastEvents: (n) => `Past week events: ${n}`,
        todos: (d, t) => `Todos: ${d}/${t} completed`,
        noTodos: 'No todos',
        busiest: (d) => `Busiest day: ${d}`,
        upcoming: (n) => `Upcoming events this week: ${n}`,
        prompt: (ctx) => `Write a short, friendly weekly review in 2-3 sentences in English based on the following data. Use an encouraging tone, no emojis.\n\n${ctx}`,
      },
      zh: {
        pastEvents: (n) => `上周日程: ${n} 个`,
        todos: (d, t) => `待办: ${t} 项中完成 ${d} 项`,
        noTodos: '无待办事项',
        busiest: (d) => `最忙的一天: ${d}`,
        upcoming: (n) => `本周即将到来的日程: ${n} 个`,
        prompt: (ctx) => `请根据以下信息用中文写一段简短友好的周回顾,2-3 句话,鼓励语气,不要使用表情符号。\n\n${ctx}`,
      },
      ja: {
        pastEvents: (n) => `先週の予定: ${n}件`,
        todos: (d, t) => `タスク: ${t}件中 ${d}件完了`,
        noTodos: 'タスクなし',
        busiest: (d) => `一番忙しい日: ${d}`,
        upcoming: (n) => `今週の予定: ${n}件`,
        prompt: (ctx) => `次の情報をもとに、短く親しみのある週間レビューを日本語で2〜3文書いてください。励ます口調で、絵文字は使わないでください。\n\n${ctx}`,
      },
    };

    const L = labelsByLocale[locale] ?? labelsByLocale.ko;

    const contextSummary = [
      L.pastEvents(totalEvents),
      totalTodos > 0 ? L.todos(completedTodos.length, totalTodos) : L.noTodos,
      busiestDay ? L.busiest(busiestDay) : null,
      L.upcoming(upcomingCount),
    ].filter(Boolean).join('. ');

    // ── Claude Haiku call ─────────────────────────────────────────────────────

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY missing');
    }

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        { role: 'user', content: L.prompt(contextSummary) },
      ],
    });

    // Extract text from the response
    const reviewText = message.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text: string }) => block.text)
      .join('')
      .trim();

    if (!reviewText) {
      throw new Error('AI 응답에서 텍스트를 추출할 수 없습니다.');
    }

    // ── Log usage metrics (non-blocking) ─────────────────────────────────────
    try {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      const INPUT_COST = 0.80 / 1_000_000;
      const OUTPUT_COST = 4.00 / 1_000_000;
      const inputTokens = message.usage?.input_tokens ?? 0;
      const outputTokens = message.usage?.output_tokens ?? 0;
      await supabaseAdmin.from('usage_metrics').insert({
        user_id: user.id,
        function_name: 'weekly-review',
        model: 'claude-haiku-4-5',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: inputTokens * INPUT_COST + outputTokens * OUTPUT_COST,
      });
    } catch (metricsErr) {
      console.error('[weekly-review] usage_metrics insert failed:', metricsErr);
    }

    // ── Return response ───────────────────────────────────────────────────────

    const response: WeeklyReviewResponse = {
      review:      reviewText,
      generatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
    // 크레딧 소진(결제) → LEAD 이메일 알림 + 사용자에게 명확 안내(503).
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      const alertClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await alertCreditExhausted(alertClient, { fn: 'weekly-review' });
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
