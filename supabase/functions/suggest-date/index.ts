/**
 * suggest-date Edge Function
 *
 * Finds free time slots shared across all members of a Space and uses
 * Claude Haiku to generate a natural-language date suggestion
 * (e.g. "이번 주 토요일 오후 3시 카페 데이트 어때요?").
 *
 * Security model:
 *  - ANTHROPIC_API_KEY lives ONLY here (Supabase Secrets), never on the client.
 *  - Requests must carry a valid Supabase JWT (user session token).
 *  - Only members of the requested Space can call this function.
 *
 * Request body:
 *  { spaceId: string, weekStart: string }  // weekStart: ISO-8601 date string
 *
 * Response body:
 *  { suggestion: string, slots: Array<{ start: string, end: string }> }
 *
 * Environment variables required:
 *  - ANTHROPIC_API_KEY — Claude API key
 *  - SUPABASE_URL      — auto-injected by Supabase runtime
 *  - SUPABASE_ANON_KEY — auto-injected by Supabase runtime
 *
 * TASK-904 (Sprint 9)
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestDateRequest {
  /** UUID of the Space to find shared free time for. */
  spaceId: string;
  /** ISO-8601 date string for the start of the week (Monday 00:00 local time). */
  weekStart: string;
}

interface TimeSlot {
  /** ISO-8601 start of the free window. */
  start: string;
  /** ISO-8601 end of the free window. */
  end: string;
}

interface SuggestDateResponse {
  /** Natural-language suggestion text from Claude. */
  suggestion: string;
  /** Top shared free-time slots (max 3). */
  slots: TimeSlot[];
}

// ─── CORS headers ─────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Free-time finder ─────────────────────────────────────────────────────────

/**
 * Build a list of 2-hour free windows in the week, weekend afternoon preferred.
 * For each member, subtract their existing events from the week.
 * Return only windows where ALL members are free.
 *
 * This is a simplified implementation — a production version would use
 * proper interval arithmetic on the full event schedule.
 *
 * @param supabaseClient - Authenticated Supabase client
 * @param spaceId        - Space UUID
 * @param weekStart      - Monday of the target week (local midnight)
 * @returns Array of shared free TimeSlots (up to 3)
 */
async function findSharedFreeSlots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any,
  spaceId: string,
  weekStart: Date,
): Promise<TimeSlot[]> {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Fetch all events for Space members in the target week
  const { data: events } = await supabaseClient
    .from('events')
    .select('start_at, end_at, user_id')
    .gte('start_at', weekStart.toISOString())
    .lt('start_at', weekEnd.toISOString())
    .eq('space_id', spaceId);

  // Candidate windows: Saturday and Sunday afternoons (14:00–20:00)
  // Plus Friday evening (17:00–21:00) as a bonus slot
  const candidateWindows: TimeSlot[] = [];

  for (let dayOffset = 5; dayOffset <= 7; dayOffset++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + dayOffset - 1); // 0=Mon … 6=Sun

    const startHours = dayOffset === 5 ? 17 : 14; // Friday evening, Sat/Sun afternoon
    const endHours   = dayOffset === 5 ? 21 : 20;

    const start = new Date(day);
    start.setHours(startHours, 0, 0, 0);
    const end = new Date(day);
    end.setHours(endHours, 0, 0, 0);

    // Split into 2-hour blocks
    let blockStart = new Date(start);
    while (blockStart.getTime() + 2 * 60 * 60 * 1000 <= end.getTime()) {
      const blockEnd = new Date(blockStart.getTime() + 2 * 60 * 60 * 1000);

      // Check no event overlaps this block
      const hasConflict = (events ?? []).some((ev: { start_at: string; end_at: string }) => {
        const evStart = new Date(ev.start_at).getTime();
        const evEnd   = new Date(ev.end_at).getTime();
        return evStart < blockEnd.getTime() && evEnd > blockStart.getTime();
      });

      if (!hasConflict) {
        candidateWindows.push({
          start: blockStart.toISOString(),
          end:   blockEnd.toISOString(),
        });
      }

      blockStart = blockEnd;
    }
  }

  // Return up to 3 candidates (earliest first)
  return candidateWindows.slice(0, 3);
}

// ─── Claude prompt builder ────────────────────────────────────────────────────

/**
 * Build the user message for Claude Haiku.
 *
 * @param slots - Array of shared free slots
 * @returns Prompt string
 */
function buildPrompt(slots: TimeSlot[]): string {
  if (slots.length === 0) {
    return '공유된 빈 시간이 없어요. 다음 주를 추천해드릴게요!';
  }

  const slotDescriptions = slots.map((slot) => {
    const start = new Date(slot.start);
    const days  = ['일', '월', '화', '수', '목', '금', '토'];
    const dayName = days[start.getDay()];
    const hour    = start.getHours();
    const period  = hour < 12 ? '오전' : '오후';
    const displayHour = hour <= 12 ? hour : hour - 12;
    return `${dayName}요일 ${period} ${displayHour}시`;
  });

  return (
    `다음 시간들 중 하나를 골라 커플/그룹에게 자연스러운 데이트 또는 모임 일정을 추천해주세요. ` +
    `반드시 한국어로, 한 문장으로, 친근하고 따뜻한 톤으로 답해주세요.\n\n` +
    `가능한 시간:\n${slotDescriptions.join('\n')}`
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Create a user-scoped Supabase client (respects RLS)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    // ── Quota gate ────────────────────────────────────────────────────────────
    // Free: 3/day, Pro: 30/hour. Must run before Claude is invoked.
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — Deno path resolves at deploy time.
    const { enforceQuota } = await import('../_shared/quota.ts');
    const quota = await enforceQuota({
      adminClient, userId: user.id, functionName: 'suggest-date',
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

    // ── Parse request ─────────────────────────────────────────────────────────
    const body = (await req.json()) as SuggestDateRequest;
    const { spaceId, weekStart: weekStartStr } = body;

    if (!spaceId || !weekStartStr) {
      return new Response(
        JSON.stringify({ error: 'spaceId and weekStart are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const weekStart = new Date(weekStartStr);
    if (isNaN(weekStart.getTime())) {
      return new Response(
        JSON.stringify({ error: 'Invalid weekStart date' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Find shared free slots ────────────────────────────────────────────────
    const slots = await findSharedFreeSlots(supabaseClient, spaceId, weekStart);

    // If no slots, return early without calling Claude
    if (slots.length === 0) {
      const response: SuggestDateResponse = {
        suggestion: '이번 주는 모든 멤버가 바쁜 것 같아요. 다음 주를 노려보세요! 📅',
        slots:      [],
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Call Claude Haiku ─────────────────────────────────────────────────────
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
    });

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [
        {
          role:    'user',
          content: buildPrompt(slots),
        },
      ],
    });

    // Extract text from the response
    const firstBlock = message.content[0];
    const suggestionText =
      firstBlock?.type === 'text'
        ? firstBlock.text.trim()
        : '이번 주 좋은 시간을 찾았어요!';

    // Record cost so the quota counter and the budget dashboard see it.
    try {
      const inputTokens = message.usage?.input_tokens ?? 0;
      const outputTokens = message.usage?.output_tokens ?? 0;
      const INPUT_COST = 0.80 / 1_000_000;
      const OUTPUT_COST = 4.00 / 1_000_000;
      await adminClient.from('usage_metrics').insert({
        user_id: user.id,
        function_name: 'suggest-date',
        model: 'claude-haiku-4-5',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: inputTokens * INPUT_COST + outputTokens * OUTPUT_COST,
      });
    } catch (metricsErr) {
      // eslint-disable-next-line no-console
      console.error('[suggest-date] usage_metrics insert failed:', metricsErr);
    }

    const response: SuggestDateResponse = {
      suggestion: suggestionText,
      slots,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
