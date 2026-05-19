/**
 * analyze-image — v1.2.1 메신저 이미지 자동 태그.
 *
 * 입력: { messageId: string }
 *   서버가 직접 DB 에서 image_url 을 읽고 Claude Vision 으로 1–3개 한국어
 *   태그 생성 후 space_messages.tags 에 저장.
 *
 * Cost guard:
 *   - 모델: Claude Haiku 4.5 (가장 저렴)
 *   - max_tokens: 80 (한두 단어 × 3개면 충분)
 *   - usage_metrics 에 feature_area='image_tag' 기록
 *   - 사용자당 일 10건 한도 (quota.ts 사용)
 *
 * Auth: 호출자가 메시지의 sender 본인이어야. service_role JWT 로 RLS 우회.
 */

import { createClient } from 'npm:@supabase/supabase-js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 80;
const DAILY_CAP = 10;

interface Body {
  messageId?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl     = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey) {
    return json({ error: 'missing env' }, 500);
  }

  // 호출자 인증 — Authorization Bearer <user JWT> 검증.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userJwt    = authHeader.replace(/^Bearer\s+/i, '');
  if (!userJwt) return json({ error: 'unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.messageId) return json({ error: 'messageId required' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // 일 한도 — feature_area='image_tag' 카운트.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: usedToday } = await admin
    .from('usage_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('feature_area', 'image_tag')
    .gte('called_at', since);
  if ((usedToday ?? 0) >= DAILY_CAP) {
    return json({ error: 'daily limit', limit: DAILY_CAP }, 429);
  }

  // 메시지 fetch + 소유권 검증.
  const { data: msg, error: msgErr } = await admin
    .from('space_messages')
    .select('id, sender_id, image_url, tags')
    .eq('id', body.messageId)
    .single();
  if (msgErr || !msg) return json({ error: 'not found' }, 404);
  if (msg.sender_id !== userId) return json({ error: 'forbidden' }, 403);
  if (!msg.image_url) return json({ error: 'no image' }, 400);
  if (msg.tags && msg.tags.length > 0) return json({ tags: msg.tags, cached: true });

  // Claude Vision 호출. URL 직접 입력은 Anthropic API 가 지원하지 않으므로
  // image 를 base64 로 변환 후 inline.
  const imgResp = await fetch(msg.image_url);
  if (!imgResp.ok) return json({ error: 'image fetch failed' }, 502);
  const imgBuf = new Uint8Array(await imgResp.arrayBuffer());
  // base64 인코딩 — Deno 표준 라이브러리.
  let bin = '';
  for (let i = 0; i < imgBuf.byteLength; i += 1) bin += String.fromCharCode(imgBuf[i]);
  const base64 = btoa(bin);
  const mediaType = imgResp.headers.get('Content-Type') ?? 'image/jpeg';

  const anthropicResp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':       anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type':    'application/json',
    },
    body: JSON.stringify({
      model:     MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: '이 사진에 어울리는 한국어 태그 1~3개를 콤마로 구분해서 답해줘. 단어만 출력하고 다른 설명은 빼.',
            },
          ],
        },
      ],
    }),
  });

  if (!anthropicResp.ok) {
    const txt = await anthropicResp.text();
    return json({ error: `anthropic ${anthropicResp.status}`, detail: txt }, 502);
  }
  const aiData = await anthropicResp.json();
  const text = (aiData?.content?.[0]?.text as string ?? '').trim();
  const tags = text
    .split(/[,，、]/)
    .map((s) => s.trim().replace(/[#'"]/g, ''))
    .filter((s) => s.length > 0 && s.length < 12)
    .slice(0, 3);

  if (tags.length === 0) return json({ tags: [] });

  await admin.from('space_messages').update({ tags }).eq('id', body.messageId);

  // usage_metrics 기록.
  const inputTokens  = aiData?.usage?.input_tokens  ?? 0;
  const outputTokens = aiData?.usage?.output_tokens ?? 0;
  const costUsd = (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
  await admin.from('usage_metrics').insert({
    user_id:       userId,
    model:         MODEL,
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
    cost_usd:      costUsd,
    feature_area:  'image_tag',
  });

  return json({ tags });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
