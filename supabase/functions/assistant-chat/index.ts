/**
 * assistant-chat Edge Function — v1.2 Phase 2
 *
 * AI 비서 멀티턴 채팅. Claude Sonnet 4.6 + tool use 로 사용자 발화를 받아
 * 일정/할 일을 직접 생성/조회/수정. 클라이언트는 messages array 와 lastTurn
 * 만 들고 다니고, mutation 은 모두 Edge Fn 안에서 RLS 통과한 user JWT
 * client 로 수행 → 모델이 도구를 잘못 호출해도 RLS 가 1차 방어선.
 *
 * 처음 1주 hard cap 보호:
 *   - quota.ts `assistant-chat` 키: free 10턴/일, pro 시간당 40턴
 *   - 환경변수 ASSISTANT_HARD_CAP 으로 free 추가 제한 (배포 직후 5턴 권장)
 *
 * 사용 모델: claude-sonnet-4-6 (tool use 지원, 1M context 안 씀)
 * 도구 셋: createEvent / listEventsInRange / createTodo  — v1.2.0 첫 출시
 *   (updateEvent / deleteEvent / suggestSlot 는 안전 검증 후 v1.2.1 활성)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any — Deno module resolution
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** 클라이언트가 보낸 단일 메시지. Anthropic SDK 형식과 호환. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  /** 멀티턴 히스토리 (마지막 N턴). 클라이언트가 윈도우 관리. */
  messages: ChatMessage[];
  /** 두 글자 locale (ko/en/zh/ja). 시스템 프롬프트 분기. */
  locale?: string;
  /** 클라이언트의 "지금 시각" — UTC offset 으로 시간 의도 해석에 사용. */
  clientNowIso?: string;
}

interface ChatResponse {
  /** 모델의 최종 텍스트 응답 (사용자에게 표시). */
  text: string;
  /** 실행된 도구 + 결과 요약 (UI 에서 "일정이 생성되었습니다" 카드 표시용). */
  executed: Array<{ tool: string; ok: boolean; summary: string }>;
  tokensUsed: number;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const buildSystemPrompt = (locale: string, nowIso: string): string => {
  const lang = (locale ?? '').slice(0, 2).toLowerCase();
  const todayPart = `오늘은 ${nowIso} (사용자 로컬 시각).`;
  if (lang === 'ko') {
    return [
      '당신은 SyncLink 사용자의 일정/할 일 비서입니다.',
      todayPart,
      '',
      '원칙:',
      '- 사용자가 "내일 7시 카페 약속" 같이 말하면 createEvent 도구로 등록.',
      '- "이번 주 일정 보여줘" 같이 조회 의도면 listEventsInRange 호출.',
      '- "그 약속 한 시간 미뤄줘" / "취소해줘" 같은 후속 의도면 먼저 listEventsInRange 로 id를 찾고 updateEvent / deleteEvent.',
      '- 할 일은 createTodo. 일정과 할 일을 헷갈리지 마세요.',
      '- deleteEvent 는 매우 신중하게. 확실하지 않으면 사용자에게 한 번 더 확인.',
      '- 모호하면 사용자에게 1번만 짧게 되묻기. 두 번 이상 되묻지 마세요.',
      '- 도구 실행 후 결과는 1-2문장으로 자연스럽게 보고 (예: "5월 20일 오후 7시 카페 약속을 추가했어요.").',
      '- 사용자가 명시적으로 요청하지 않으면 도구를 호출하지 마세요. 단순 잡담은 짧게 답.',
    ].join('\n');
  }
  return [
    'You are SyncLink\'s scheduling assistant.',
    todayPart,
    'Use createEvent for events, createTodo for tasks, listEventsInRange for queries.',
    'Ask at most one clarifying question. After tool use, summarise in 1-2 sentences.',
  ].join('\n');
};

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'createEvent',
    description: '일정 생성. 시작/종료 시간은 ISO 8601 (사용자 로컬 시각 기준).',
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: '일정 제목' },
        startAt:     { type: 'string', description: 'ISO 8601 (예: 2026-05-20T19:00)' },
        endAt:       { type: 'string', description: 'ISO 8601. 미지정이면 startAt + 1시간' },
        allDay:      { type: 'boolean' },
        location:    { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'startAt'],
    },
  },
  {
    name: 'listEventsInRange',
    description: '특정 날짜 범위의 일정 조회. ISO 8601 두 개.',
    input_schema: {
      type: 'object',
      properties: {
        startAt: { type: 'string' },
        endAt:   { type: 'string' },
      },
      required: ['startAt', 'endAt'],
    },
  },
  {
    name: 'updateEvent',
    description: '기존 일정 수정. eventId 는 listEventsInRange 결과에서 얻은 id.',
    input_schema: {
      type: 'object',
      properties: {
        eventId:  { type: 'string', description: '수정할 일정 ID' },
        title:    { type: 'string' },
        startAt:  { type: 'string', description: 'ISO 8601' },
        endAt:    { type: 'string', description: 'ISO 8601' },
        location: { type: 'string' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'deleteEvent',
    description: '일정 삭제. eventId 는 listEventsInRange 결과에서 얻은 id. 신중히.',
    input_schema: {
      type: 'object',
      properties: { eventId: { type: 'string' } },
      required: ['eventId'],
    },
  },
  {
    name: 'createTodo',
    description: '할 일 생성. 마감일은 ISO date (YYYY-MM-DD) 또는 ISO datetime.',
    input_schema: {
      type: 'object',
      properties: {
        title:    { type: 'string' },
        dueDate:  { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['title'],
    },
  },
];

// ─── Tool execution (server-side, JWT-scoped) ─────────────────────────────────

async function runTool(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  try {
    if (toolName === 'createEvent') {
      // RLS fix — events 테이블의 INSERT 정책은 user_id = auth.uid() 조건.
      // payload 에 user_id 명시 안 하면 default null → policy 위반.
      const startAt = String(input.startAt ?? '');
      const endAt = (input.endAt as string | undefined) ?? '';
      const finalEnd = endAt || new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
      const { data, error } = await userClient.from('events').insert({
        user_id:     userId,
        title:       input.title,
        start_at:    startAt,
        end_at:      finalEnd,
        all_day:     input.allDay ?? false,
        location:    input.location ?? null,
        description: input.description ?? null,
      }).select('id, title, start_at').single();
      if (error) return { ok: false, summary: `일정 생성 실패: ${error.message}` };
      return { ok: true, summary: `"${data.title}" 일정 생성됨`, data };
    }

    if (toolName === 'listEventsInRange') {
      const { data, error } = await userClient
        .from('events')
        .select('id, title, start_at, end_at')
        .gte('start_at', input.startAt as string)
        .lte('end_at',   input.endAt as string)
        .order('start_at', { ascending: true })
        .limit(20);
      if (error) return { ok: false, summary: `조회 실패: ${error.message}` };
      return { ok: true, summary: `${data?.length ?? 0}개 일정 조회`, data };
    }

    if (toolName === 'createTodo') {
      const { data, error } = await userClient.from('todos').insert({
        user_id:      userId,
        title:        input.title,
        due_date:     input.dueDate ?? null,
        priority:     input.priority ?? 'medium',
        is_completed: false,
      }).select('id, title').single();
      if (error) return { ok: false, summary: `할 일 생성 실패: ${error.message}` };
      return { ok: true, summary: `"${data.title}" 할 일 추가됨`, data };
    }

    if (toolName === 'updateEvent') {
      const patch: Record<string, unknown> = {};
      if (input.title    !== undefined) patch.title    = input.title;
      if (input.startAt  !== undefined) patch.start_at = input.startAt;
      if (input.endAt    !== undefined) patch.end_at   = input.endAt;
      if (input.location !== undefined) patch.location = input.location;
      if (Object.keys(patch).length === 0) {
        return { ok: false, summary: '수정할 내용이 없어요' };
      }
      const { data, error } = await userClient
        .from('events')
        .update(patch)
        .eq('id', input.eventId as string)
        .select('id, title')
        .single();
      if (error) return { ok: false, summary: `일정 수정 실패: ${error.message}` };
      return { ok: true, summary: `"${data.title}" 일정 수정됨`, data };
    }

    if (toolName === 'deleteEvent') {
      const { error } = await userClient
        .from('events')
        .delete()
        .eq('id', input.eventId as string);
      if (error) return { ok: false, summary: `일정 삭제 실패: ${error.message}` };
      return { ok: true, summary: '일정이 삭제됐어요' };
    }

    return { ok: false, summary: `unknown tool: ${toolName}` };
  } catch (e) {
    return { ok: false, summary: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: 'no_messages' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (body.messages.length > 40) {
    return new Response(JSON.stringify({ error: 'too_many_messages' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — Deno import map resolves at deploy time.
  const { enforceQuota } = await import('../_shared/quota.ts');
  const quota = await enforceQuota({
    adminClient,
    userId: user.id,
    functionName: 'assistant-chat',
  });
  if (!quota.allowed) {
    return new Response(JSON.stringify({ error: quota.reason ?? 'quota' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 추가 hard cap (배포 직후 모니터링 기간용)
  const hardCap = Number(Deno.env.get('ASSISTANT_HARD_CAP') ?? '');
  if (Number.isFinite(hardCap) && hardCap > 0 && quota.plan === 'free') {
    // remaining 은 enforceQuota 가 이미 차감 후 반환. 보수적 cut.
    if (quota.remaining < (10 - hardCap)) {
      return new Response(JSON.stringify({ error: 'quota_free_daily' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'no_api_key' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const anthropic = new Anthropic({ apiKey });

  const nowIso = body.clientNowIso ?? new Date().toISOString();
  const systemText = buildSystemPrompt(body.locale ?? 'ko', nowIso);

  // v1.2 Phase 5 — prompt caching. 시스템 프롬프트와 도구 정의를 ephemeral
  // 캐시로 표시해 멀티턴 안에서 같은 prefix 를 재사용. Claude 가 cache hit
  // 시 input token 가격이 대폭 절감 (Sonnet 4.6 기준 약 1/10).
  const system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];

  // Anthropic SDK 메시지 형식으로 변환 (간단 케이스: text only).
  const messages = body.messages.map((m) => ({ role: m.role, content: m.content }));

  const executed: ChatResponse['executed'] = [];
  let tokensUsed = 0;

  // Multi-step tool loop — 최대 4 스텝.
  let finalText = '';
  for (let step = 0; step < 4; step++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: system as never,
      tools: TOOLS as never,
      messages,
    });
    tokensUsed += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    // tool_use 블록 추출.
    const toolUseBlocks = (response.content as Array<{ type: string }>).filter(
      (b) => b.type === 'tool_use',
    );
    const textBlocks = (response.content as Array<{ type: string; text?: string }>).filter(
      (b) => b.type === 'text',
    );

    if (toolUseBlocks.length === 0) {
      // 최종 답.
      finalText = textBlocks.map((b) => b.text ?? '').join('\n').trim();
      break;
    }

    // assistant 메시지를 히스토리에 추가 (tool_use 포함).
    messages.push({ role: 'assistant', content: response.content as never });

    // 각 도구 실행 후 tool_result 로 한 번에 묶어서 next user 메시지.
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const tb of toolUseBlocks as Array<{ id: string; name: string; input: Record<string, unknown> }>) {
      const result = await runTool(userClient, user.id, tb.name, tb.input ?? {});
      executed.push({ tool: tb.name, ok: result.ok, summary: result.summary });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: JSON.stringify(result.ok ? (result.data ?? { ok: true }) : { error: result.summary }),
      });
    }
    messages.push({ role: 'user', content: toolResults as never });
  }

  const responseBody: ChatResponse = {
    text: finalText || '응답을 받지 못했어요. 다시 시도해 주세요.',
    executed,
    tokensUsed,
  };

  // usage_metrics 기록 (cost 추적, Phase 5 feature_area 포함).
  try {
    await adminClient.from('usage_metrics').insert({
      user_id: user.id,
      function_name: 'assistant-chat',
      tokens: tokensUsed,
      feature_area: 'chat',
    });
  } catch {
    // 기록 실패는 사용자 응답에 영향 안 줌.
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
