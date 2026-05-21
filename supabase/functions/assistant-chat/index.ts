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
      '당신은 SyncLink 사용자의 **일정 분석 비서**입니다.',
      todayPart,
      '',
      '핵심 역할 (1순위) — 분석과 인사이트:',
      '- 사용자의 일정 데이터를 listEventsInRange 로 모은 뒤, 패턴·빈도·요약',
      '  같은 통계적 인사이트를 자연어로 제공.',
      '- 답변 예시:',
      '  · "이번 주 김철수와 3회로 가장 많이 만났어요. 화·금이 비어있어 다음',
      '     약속 잡기 좋겠어요."',
      '  · "이번 달 헬스 8회 · 러닝 4회로 운동 빈도가 작년 대비 +30% 증가했어요.',
      '     상체(가슴/등) 집중도가 높네요."',
      '  · "다음 주 화요일이 4건으로 가장 바쁘고, 금요일 오후가 비어있어요."',
      '- 도구 결과를 그대로 나열하지 말고 의미 있게 해석. 숫자는 정확히 (3번, 주 2회).',
      '- 분석 답변은 2~4문장으로 압축. 표/리스트 자제, 자연스러운 한국어.',
      '- 데이터가 부족하면 솔직히 "아직 분석에 충분한 데이터가 없어요" 라고.',
      '',
      '일정 등록·수정 (보조 역할 — 사용자가 명시적으로 요청한 경우에만):',
      '- 단순 자연어 일정 등록은 홈 화면 NLInputBar 의 주 기능. 챗봇에서는',
      '  사용자가 명시적으로 "추가해줘"/"등록해줘" 라고 한 경우에만 createEvent.',
      '- "그 약속 한 시간 미뤄줘" 같은 후속 의도 = listEventsInRange → updateEvent.',
      '- deleteEvent 는 매우 신중. 확실하지 않으면 한 번 더 확인.',
      '- 도구 실행 후 1~2문장으로 자연스럽게 보고.',
      '',
      '잡담 / 모호한 의도:',
      '- 모호하면 1번만 짧게 되묻기. 두 번 이상 되묻지 말 것.',
      '- 단순 인사·잡담은 1문장으로 짧게.',
      '',
      '캘린더 이미지 가져오기 (v1.2.2 기존 기능 유지):',
      '- 사용자가 다른 캘린더 앱의 월간/주간 스크린샷을 첨부하면, 보이는 모든 일정을',
      '  추출해 createEvent 도구로 순서대로 등록.',
      '- 각 일정의 날짜는 캡처에 보이는 월/일 + 현재 연도 기준. 종료 시간이 명시 안',
      '  되면 시작 시간 + 1시간으로.',
      '- 시간 없이 종일만 적힌 일정은 allDay=true.',
      '- 너무 많으면 상위 5개 등록 후 "더 가져올까요?" 확인. 같은 제목+시작시각 중복 방지.',
      '- 등록 완료 후 "X개 일정을 가져왔어요." 요약.',
    ].join('\n');
  }
  return [
    'You are SyncLink\'s **schedule analysis assistant**.',
    todayPart,
    '',
    'Primary role — analysis & insights:',
    '- Use listEventsInRange to gather data, then deliver patterns, frequencies,',
    '  and summaries in natural language. Don\'t just dump tool results —',
    '  interpret them meaningfully with concrete numbers.',
    '- Keep analytical answers to 2-4 sentences. Avoid tables; prose only.',
    '- If data is insufficient, say so honestly.',
    '',
    'Secondary role — create/modify only when explicitly requested:',
    '- The home screen NLInputBar handles simple natural-language event entry.',
    '  Use createEvent in chat only when the user explicitly says "add" / "schedule".',
    '- Use updateEvent / deleteEvent after listEventsInRange to find the id.',
    '- Be very careful with deletion; confirm once if uncertain.',
    '',
    'Ambiguity: ask at most one clarifying question. After tool use, summarise',
    'in 1-2 sentences.',
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
  dryRun: boolean,
): Promise<{ ok: boolean; summary: string; data?: unknown }> {
  // v1.2.x — dry-run 모드: actual mutation 건너뛰고 의도만 회신.
  // 환경변수 ASSISTANT_DRY_RUN=true 또는 요청 dryRun:true 일 때 활성.
  // 배포 직후 1주 안전망 (잘못된 createEvent / deleteEvent 차단).
  if (dryRun && (toolName === 'createEvent' || toolName === 'updateEvent' || toolName === 'deleteEvent' || toolName === 'createTodo')) {
    const intent = toolName === 'createEvent' ? `일정 추가 예정: ${input.title} (${input.startAt})`
      : toolName === 'updateEvent' ? `일정 수정 예정: ${input.eventId}`
      : toolName === 'deleteEvent' ? `일정 삭제 예정: ${input.eventId}`
      : `할 일 추가 예정: ${input.title}`;
    return { ok: true, summary: `[확인 모드] ${intent}`, data: { dryRun: true } };
  }

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
      // v1.1.5 — 분석 비서 컨셉 대응. event_kind/all_day/category/location/
      // description/운동 데이터까지 노출해 모델이 패턴/빈도/추세를 더 정확
      // 하게 추출할 수 있게. limit 20 → 80 (한 달 데이터 분석 시 부족).
      const { data, error } = await userClient
        .from('events')
        .select(
          'id, title, start_at, end_at, all_day, event_kind, ' +
          'distance_km, avg_pace_seconds, location, description, ' +
          'category:categories(name)',
        )
        .gte('start_at', input.startAt as string)
        .lte('end_at',   input.endAt as string)
        .order('start_at', { ascending: true })
        .limit(80);
      if (error) return { ok: false, summary: `조회 실패: ${error.message}` };

      // event_workout_parts join 별도 (PostgREST nested resource).
      const ids = (data ?? []).filter((e) => e.event_kind === 'workout').map((e) => e.id);
      let partsByEvent: Record<string, string[]> = {};
      if (ids.length > 0) {
        const { data: parts } = await userClient
          .from('event_workout_parts')
          .select('event_id, part')
          .in('event_id', ids);
        partsByEvent = (parts ?? []).reduce<Record<string, string[]>>((acc, p) => {
          (acc[p.event_id as string] ??= []).push(p.part as string);
          return acc;
        }, {});
      }

      // 모델이 읽기 쉽게 정리. category 는 객체 → 이름만, workout_parts 는 join.
      const compact = (data ?? []).map((e) => ({
        id:       e.id,
        title:    e.title,
        start_at: e.start_at,
        end_at:   e.end_at,
        all_day:  e.all_day,
        kind:     e.event_kind,
        ...(e.event_kind === 'running' && {
          distance_km:      e.distance_km,
          avg_pace_seconds: e.avg_pace_seconds,
        }),
        ...(e.event_kind === 'workout' && partsByEvent[e.id] && {
          workout_parts: partsByEvent[e.id],
        }),
        ...(e.location    && { location:    e.location }),
        ...(e.description && { description: e.description }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((e as any).category?.name && { category: (e as any).category.name }),
      }));
      return { ok: true, summary: `${compact.length}개 일정 조회`, data: compact };
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

  // v1.2.x — dry-run 모드. 환경변수 또는 요청에서 활성 가능.
  const dryRun = Deno.env.get('ASSISTANT_DRY_RUN') === 'true';

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

  // Multi-step tool loop — v1.1.5 개선:
  //  - 최대 4 → 6 step (다중 분석 시나리오는 listEventsInRange 를 범위별로
  //    분할 호출하는 경우가 흔함).
  //  - text block 매 step 누적 — Claude 가 tool_use 와 text 를 같이 반환하면
  //    이전엔 text 무시됐음.
  //  - loop 끝나도 finalText 비어있으면 도구 결과 정리하라는 "force-finalize"
  //    한 번 더 호출 (도구 비활성화).
  //  - max_tokens 800 → 1200 — 분석 응답이 잘리던 케이스.
  const MAX_STEPS = 6;
  let finalText = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: system as never,
      tools: TOOLS as never,
      messages,
    });
    tokensUsed += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    const toolUseBlocks = (response.content as Array<{ type: string }>).filter(
      (b) => b.type === 'tool_use',
    );
    const textBlocks = (response.content as Array<{ type: string; text?: string }>).filter(
      (b) => b.type === 'text',
    );
    // 매 step text 누적 (다음 turn 도 text 가 또 올 수 있으니 마지막 비어있어도 보존).
    const stepText = textBlocks.map((b) => b.text ?? '').join('\n').trim();
    if (stepText) finalText = stepText;

    if (toolUseBlocks.length === 0) break;

    messages.push({ role: 'assistant', content: response.content as never });

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const tb of toolUseBlocks as Array<{ id: string; name: string; input: Record<string, unknown> }>) {
      const result = await runTool(userClient, user.id, tb.name, tb.input ?? {}, dryRun);
      executed.push({ tool: tb.name, ok: result.ok, summary: result.summary });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: JSON.stringify(result.ok ? (result.data ?? { ok: true }) : { error: result.summary }),
      });
    }
    messages.push({ role: 'user', content: toolResults as never });
  }

  // Force-finalize: loop 횟수 초과로 빠져나왔는데 마지막 step 이 tool_use 였다면
  // finalText 가 누적된 이전 텍스트일 뿐 "정리된 응답" 이 아닐 수 있음. 도구
  // 없이 한 번 더 호출해 모은 데이터로 결론 작성하게 강제.
  if (!finalText) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapUp: any = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: system as never,
        // tools 생략 → 모델이 새 도구 호출 못 함.
        messages,
      });
      tokensUsed += (wrapUp.usage?.input_tokens ?? 0) + (wrapUp.usage?.output_tokens ?? 0);
      const wrapText = (wrapUp.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '').join('\n').trim();
      if (wrapText) finalText = wrapText;
    } catch {
      // wrapUp 실패는 무시 — 아래 fallback 메시지로.
    }
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
