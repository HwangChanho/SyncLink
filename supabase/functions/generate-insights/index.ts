/**
 * generate-insights Edge Function — Sprint 1 (AI 분석 대시보드 Phase 3)
 *
 * 사용자 events 통계 → Claude Haiku → 한국어 자연어 인사이트 + 액션 제안.
 * analytics 화면의 "AI 인사이트" 카드에서 호출.
 *
 * Quota: free 일 1회 / pro 시간당 10회. 초과 시 quotaExceeded=true 로 응답.
 *
 * Security:
 *   - Authorization 헤더 (사용자 JWT) 필수
 *   - ANTHROPIC_API_KEY 는 Supabase Secrets 에만 존재
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 클라이언트가 보내는 stats payload. */
interface StatsPayload {
  range:         { start: string; end: string };
  totalCount:    number;
  totalMinutes:  number;
  ownCount:      number;
  busiestDow:    number | null;
  quietestDow:   number | null;
  emptyDayCount: number;
  byCategory:    Array<{ name: string; count: number; minutes: number }>;
  byDayOfWeek:   Array<{ dow: number; count: number }>;
  byHourBucket:  Array<{ bucket: 'morning' | 'afternoon' | 'evening' | 'night'; count: number }>;
}

/** Claude 에 보낼 system prompt 조립. */
function buildSystemPrompt(): string {
  return [
    '당신은 사용자의 일정 데이터를 분석해 친근하고 도움이 되는 인사이트를 제공하는 캘린더 비서입니다.',
    '응답은 반드시 JSON 한 객체만 출력하고 다른 설명은 절대 붙이지 마세요.',
    '응답 schema: { "comment": string, "suggestion": string }',
    '- comment: 한국어 2~3 문장. 지난 기간 데이터에서 눈에 띄는 "패턴" 1가지를 콕 짚어 주세요 (예: 특정 요일이나 시간대에 일정이 몰림, 일정 없는 날이 유난히 많음, 한 카테고리에 편중됨, 개인 일정 대비 공유받은 일정 비중). 그 패턴을 근거로 칭찬 또는 부드러운 조언 1가지를 덧붙이세요.',
    '- suggestion: 한국어 1문장. 다음 주에 바로 실천할 수 있는 "구체적" 행동을 제안하세요 (예: "수요일 저녁에 집중 시간 1개를 미리 예약해 보세요", "주말 중 하루는 일정을 비워 쉬는 날로 두세요"). 막연한 권유 대신 요일·시간대·개수처럼 행동 가능한 형태로 적으세요. 마땅한 제안이 없으면 빈 문자열.',
    '패턴이 뚜렷하지 않으면 억지로 추론하지 말고, 데이터 범위 안에서 자연스럽게 관찰되는 내용만 언급하세요.',
    '말투는 존댓말. 데이터가 부족하면 "더 많은 일정을 등록하면 더 정확한 인사이트를 드릴 수 있어요" 정도로 안내.',
    '숫자는 사용자가 보낸 stats 안의 값만 사용. 임의 값 만들어내지 말 것.',
  ].join('\n');
}

/** stats → user prompt 텍스트 (요약). */
function buildUserPrompt(stats: StatsPayload): string {
  const days = Math.max(
    1,
    Math.round((new Date(stats.range.end).getTime() - new Date(stats.range.start).getTime()) / 86_400_000) + 1,
  );
  const busiest = stats.busiestDow !== null ? DOW_LABELS[stats.busiestDow] + '요일' : '없음';
  const quietest = stats.quietestDow !== null ? DOW_LABELS[stats.quietestDow] + '요일' : '없음';
  const categories = stats.byCategory
    .slice(0, 5)
    .map((c) => `  - ${c.name}: ${c.count}개 (${Math.round(c.minutes / 60)}시간)`)
    .join('\n');
  const buckets = stats.byHourBucket
    .map((b) => `  - ${b.bucket}: ${b.count}개`)
    .join('\n');
  const dow = stats.byDayOfWeek
    .map((d) => `  - ${DOW_LABELS[d.dow]}: ${d.count}개`)
    .join('\n');

  return [
    `분석 기간: 최근 ${days}일`,
    `총 일정: ${stats.totalCount}개 (총 ${Math.round(stats.totalMinutes / 60)}시간)`,
    `개인/공유 비중: 내가 등록 ${stats.ownCount}개 / 공유받음 ${stats.totalCount - stats.ownCount}개`,
    `가장 바쁜 요일: ${busiest}`,
    `가장 한가한 요일: ${quietest}`,
    `일정 없는 날: ${stats.emptyDayCount}일`,
    `\n카테고리 상위 5:`,
    categories,
    `\n요일별 분포:`,
    dow,
    `\n시간대 분포 (아침 5–12시 / 낮 12–17시 / 저녁 17–22시 / 밤 22–5시):`,
    buckets,
    `\n위 데이터를 보고 schema 에 맞춰 JSON 만 출력.`,
  ].join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 인증 ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResp({ error: 'Missing Authorization header' }, 401);
    }
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return jsonResp({ error: 'Invalid JWT' }, 401);

    // ── 요청 파싱 ─────────────────────────────────────────────────────────
    const stats = (await req.json()) as StatsPayload;
    if (typeof stats?.totalCount !== 'number') {
      return jsonResp({ error: 'Invalid stats payload' }, 400);
    }

    // ── Quota 게이트 ──────────────────────────────────────────────────────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    // @ts-ignore — Deno path resolves at deploy time.
    const { enforceQuota } = await import('../_shared/quota.ts');
    const quota = await enforceQuota({
      adminClient, userId: user.id, functionName: 'generate-insights',
    });
    if (!quota.allowed) {
      // graceful — 카드에는 안내 메시지로 노출.
      return jsonResp({
        comment:        '오늘 무료 인사이트 한도를 모두 사용했어요. 내일 다시 만나요!',
        suggestion:     '',
        quotaExceeded:  true,
      }, 200);
    }

    // 데이터 부족 시 AI 호출 없이 graceful 응답.
    if (stats.totalCount === 0) {
      return jsonResp({
        comment:    '이 기간에 등록된 일정이 아직 없어요. 일정을 더 추가하면 패턴 분석을 시작할 수 있어요.',
        suggestion: '오늘 하루의 첫 일정을 등록해 보세요.',
      }, 200);
    }

    // ── Claude Haiku 호출 ────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const t0 = Date.now();
    const resp = await anthropic.messages.create({
      model:       'claude-haiku-4-5-20251001',
      max_tokens:  600,
      system:      buildSystemPrompt(),
      messages:    [{ role: 'user', content: buildUserPrompt(stats) }],
    });
    const elapsedMs = Date.now() - t0;

    // text 블록 추출.
    const textBlock = resp.content.find((b: { type: string }) => b.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    const rawText = textBlock?.text ?? '{}';

    // JSON parse — 모델이 약간 wrap 해도 first { … last } 추출.
    let parsed: { comment?: string; suggestion?: string } = {};
    try {
      const startIdx = rawText.indexOf('{');
      const endIdx   = rawText.lastIndexOf('}');
      const slice    = startIdx >= 0 && endIdx > startIdx
        ? rawText.slice(startIdx, endIdx + 1)
        : rawText;
      parsed = JSON.parse(slice);
    } catch {
      // parse fail → comment 에 raw text 그대로 (사용자 경험 우선).
      parsed = { comment: rawText.trim().slice(0, 240), suggestion: '' };
    }

    // ── usage 기록 ────────────────────────────────────────────────────────
    try {
      await adminClient.from('usage_metrics').insert({
        user_id:       user.id,
        function_name: 'generate-insights',
        latency_ms:    elapsedMs,
        input_tokens:  resp.usage?.input_tokens  ?? 0,
        output_tokens: resp.usage?.output_tokens ?? 0,
      });
    } catch (err) {
      console.error('[generate-insights] usage_metrics insert failed:', err);
    }

    return jsonResp({
      comment:    parsed.comment    ?? '',
      suggestion: parsed.suggestion ?? '',
      model:      'claude-haiku-4-5',
    }, 200);
  } catch (err) {
    console.error('[generate-insights] error:', err);
    // 크레딧 소진(결제) → LEAD 이메일 알림 + 사용자에게 명확 안내(503).
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      const alertClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await alertCreditExhausted(alertClient, { fn: 'generate-insights' });
      return jsonResp({ error: 'ai_unavailable' }, 503);
    }
    return jsonResp({ error: err instanceof Error ? err.message : 'unknown' }, 500);
  }
});

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
