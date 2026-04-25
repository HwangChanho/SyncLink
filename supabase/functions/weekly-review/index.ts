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

    const completedTodos = (pastTodos ?? []).filter((t: { is_completed: boolean }) => t.is_completed);
    const totalTodos     = (pastTodos ?? []).length;
    const totalEvents    = (pastEvents ?? []).length;
    const upcomingCount  = (upcomingEvents ?? []).length;

    // Find the busiest day of the past week
    const dayCounts: Record<string, number> = {};
    for (const ev of pastEvents ?? []) {
      const day = new Date((ev as { start_at: string }).start_at)
        .toLocaleDateString('ko-KR', { weekday: 'long' });
      dayCounts[day] = (dayCounts[day] ?? 0) + 1;
    }
    const busiestDay = Object.entries(dayCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

    const contextSummary = [
      `지난 주 일정: ${totalEvents}개`,
      totalTodos > 0
        ? `할일: ${totalTodos}개 중 ${completedTodos.length}개 완료`
        : '할일 없음',
      busiestDay ? `가장 바쁜 날: ${busiestDay}` : null,
      `이번 주 예정 일정: ${upcomingCount}개`,
    ].filter(Boolean).join('. ');

    // ── Claude Haiku call ─────────────────────────────────────────────────────

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.');
    }

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `다음 정보를 바탕으로 간략하고 친근한 주간 리뷰를 한국어로 2-3문장 작성해 주세요. 격려하는 톤으로, 이모지 없이 작성해 주세요.\n\n${contextSummary}`,
        },
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
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
