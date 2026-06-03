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
  /**
   * v1.1.5 — 모델이 끝내 텍스트를 못 만들어 fallback 으로 응답한 경우 true.
   * 자동 회귀(run.mjs) 가 fallback 을 "PASS 처럼 보이는 FAIL" 로 잘못 잡지
   * 않도록 명시적 신호. 클라이언트 UI 는 무시해도 OK.
   */
  noResponse?: boolean;
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
      '',
      '⚠ 반복 일정 등록 규칙 (LEAD: "데드라인 + 공휴일 통념"):',
      '- 매주/평일/매일 반복 일정을 createEvent 할 때 사용자가 종료일 안 알려주면',
      '  반드시 한 번 짧게 "언제까지 반복할까요? (예: 6개월 / 1년 / 무기한)" 묻기.',
      '- 회사 / 출근 / 업무 / 직장 / 일 / 미팅 같은 평일성 일정 + 반복 패턴이면',
      '  추가로 "공휴일에는 쉬시죠? 공휴일 제외할까요?" 한 번 묻기. 사용자가',
      '  "네/응/예/쉬어" 같이 답하면 createEvent input 에 description 으로',
      '  "공휴일 제외" 메모 또는 향후 excludeHolidays 플래그 사용.',
      '- 위 두 질문은 한 turn 에 묶어 한 번에 묻기 (사용자 피로 최소화).',
      '',
      '⚠ deleteEvent / updateEvent 안전 규칙:',
      '- 삭제는 **반드시 한 번 더 확인**. 사용자가 "삭제해", "취소해" 라고만',
      '  하면 listEventsInRange 로 후보 찾은 뒤 "{title} ({날짜 시각}) 일정을',
      '  정말 삭제할까요? [예] 라고 답해주시면 진행할게요" 같이 물어본다.',
      '- 사용자가 명확히 "예/응/네/yes/삭제 진행" 같이 응답해야만 deleteEvent 호출.',
      '- 후보가 여러 개면 번호 매겨 보여주고 어느 것 삭제할지 다시 묻기.',
      '- updateEvent 도 시간/날짜 변경처럼 큰 변경은 짧게 확인 후 진행.',
      '',
      '⚠ createEvent 호출 규칙 (회귀 방지 — 반드시 준수):',
      '- title 은 **핵심 명사**만. 사용자 문장을 그대로 넣지 말 것.',
      '  · "9시부터 6시까지 회사" → title="회사"',
      '  · "주말에 운동 갈래" → title="운동"',
      '  · "내일 오후 3시 카페에서 미팅" → title="카페 미팅"',
      '  · 핵심 명사가 모호하면 createEvent 호출 전 1번 짧게 되묻기.',
      '- startAt/endAt 은 반드시 **UTC offset 포함** ISO 8601.',
      '  · clientNowIso 의 offset (예: +09:00) 을 그대로 사용.',
      '  · 예: "2026-05-28T09:00:00+09:00" (O), "2026-05-28T09:00:00" (X)',
      '- 한 번의 사용자 발화에는 **createEvent 를 1회만** 호출. 같은 일정을',
      '  반복 호출 금지 — 첫 호출 결과 (ok=true) 가 오면 즉시 보고 단계로 이동.',
      '- "9~6시" / "9시-6시" 같은 표현은 **같은 날** 오전 9시 ~ 오후 6시 (퇴근).',
      '  endAt < startAt 이면 endAt 에 +12시간 (PM 보정).',
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
    description: '일정 생성. 한 사용자 발화에 1회만 호출 (중복 금지). startAt/endAt 은 반드시 offset 포함 ISO 8601.',
    input_schema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: '활동/주체 핵심 명사만 (예: "회사", "운동", "카페 미팅"). 사용자 발화 raw 금지.' },
        startAt:     { type: 'string', description: 'ISO 8601 with offset (예: 2026-05-20T19:00:00+09:00)' },
        endAt:       { type: 'string', description: 'ISO 8601 with offset. 미지정이면 startAt + 1시간' },
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

// v1.2.9 — 모델이 offset 없는 ISO (e.g. "2026-05-28T09:00:00") 를 줄 때
// clientNowIso 의 offset 으로 보강. 그래도 ambiguous (Z, +/-HH:MM 없음) 면
// "+09:00" (KST) 로 fallback — SyncLink 사용자 대부분 KST.
// "9~6시" 같은 입력에서 모델이 잘못 18:00-03:00 으로 해석한 경우도 endAt 이
// startAt 보다 빠르면 +12h 보정 (PM 의미로 해석).
function normalizeIsoWithOffset(iso: string, nowIso: string): string {
  if (!iso) return iso;
  // 이미 offset 포함 (Z 또는 ±HH:MM)
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return iso;
  // clientNow 에서 offset 추출
  const m = nowIso.match(/(Z|[+-]\d{2}:?\d{2})$/);
  const off = m ? m[1] : '+09:00';
  return iso + (off === 'Z' ? 'Z' : off);
}

function correctEndIfBeforeStart(startIso: string, endIso: string): string {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return endIso;
  if (e <= s) {
    // +12h (사용자가 "9시-6시" 같은 표현에서 6시 = 오후 6시 의도)
    return new Date(e + 12 * 60 * 60 * 1000).toISOString();
  }
  return endIso;
}

async function runTool(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
  dryRun: boolean,
  nowIso: string,
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
      // v1.2.9 — title raw 발화 가드: 25자 초과면 잘라서 안전한 기본 title 로.
      // (모델 prompt 위반 fallback. 사용자가 "나는 직장인이고…" 전체를 title 로
      // 받았던 버그 회귀 방지.)
      const titleRaw = String(input.title ?? '').trim();
      const safeTitle = titleRaw.length === 0
        ? '새 일정'
        : titleRaw.length > 25
          ? titleRaw.slice(0, 25) + '…'
          : titleRaw;

      const startAtRaw = String(input.startAt ?? '');
      const endAtRaw   = (input.endAt as string | undefined) ?? '';
      const startAt    = normalizeIsoWithOffset(startAtRaw, nowIso);
      let endAt = endAtRaw
        ? normalizeIsoWithOffset(endAtRaw, nowIso)
        : new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
      endAt = correctEndIfBeforeStart(startAt, endAt);

      const { data, error } = await userClient.from('events').insert({
        user_id:     userId,
        title:       safeTitle,
        start_at:    startAt,
        end_at:      endAt,
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

  // v1.2.9 — 중복 mutation dedup map.
  // 모델이 같은 step 또는 다음 step 에서 같은 createEvent 를 또 부르는 케이스
  // (DB 에 2개씩 INSERT 됐던 회귀) 차단. 키 = tool + canonical(input).
  // listEventsInRange 같은 read-only 는 dedup 대상 아님.
  const MUTATING_TOOLS = new Set(['createEvent', 'createTodo', 'updateEvent', 'deleteEvent']);
  const dedupCache = new Map<string, { ok: boolean; summary: string; data?: unknown }>();
  function dedupKey(name: string, input: Record<string, unknown>): string {
    // ISO 초 단위 절삭 + trim 으로 noise 제거.
    const trim = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\.\d{3}/, '').replace(/:\d{2}\+/, '+').replace(/:\d{2}Z/, 'Z') : v);
    const canon = Object.keys(input).sort().reduce<Record<string, unknown>>((acc, k) => {
      if (input[k] !== undefined && input[k] !== null && input[k] !== '') acc[k] = trim(input[k]);
      return acc;
    }, {});
    return `${name}|${JSON.stringify(canon)}`;
  }

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
  // AI 호출 전체를 감싸 크레딧 소진(결제) 에러를 잡는다. 잡으면 LEAD 이메일 알림 +
  // 사용자에게 명확한 'ai_unavailable' 응답(503). 그 외 에러는 재던짐.
  try {
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
      const tbInput = tb.input ?? {};
      let result: { ok: boolean; summary: string; data?: unknown };
      const key = dedupKey(tb.name, tbInput);
      if (MUTATING_TOOLS.has(tb.name) && dedupCache.has(key)) {
        // 같은 mutation 두 번째 호출 — 첫 결과 재사용 + 보고에 표시.
        const prev = dedupCache.get(key)!;
        result = { ...prev, summary: `[중복 차단] ${prev.summary}` };
      } else {
        result = await runTool(userClient, user.id, tb.name, tbInput, dryRun, nowIso);
        if (MUTATING_TOOLS.has(tb.name) && result.ok) dedupCache.set(key, result);
      }
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
  } catch (err) {
    // 크레딧 소진 등 결제 문제 → LEAD 알림 + 사용자에게 명확 안내.
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      await alertCreditExhausted(adminClient, { fn: 'assistant-chat' });
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw err;  // 그 외 에러는 기존 동작(상위 핸들러/500).
  }

  const responseBody: ChatResponse = {
    text: finalText || '응답을 받지 못했어요. 다시 시도해 주세요.',
    executed,
    tokensUsed,
    ...(finalText ? {} : { noResponse: true }),
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
