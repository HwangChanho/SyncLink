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
// v1.2.7 — DAILY_CAP 제거 (_shared/quota.ts 의 'analyze-image' 한도 사용).
/** 받아 올 이미지 최대 크기(바이트). Anthropic 이미지 한 장 상한(5MB)과 같게 둔다. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * image_url 이 «우리 Supabase Storage 객체 주소»인지 확인한다.
 *
 * 왜: image_url 은 메시지 작성자가 넣는 값이라, 검사 없이 서버가 fetch 하면 임의 주소로
 *     요청을 보내게 된다. 앱은 space-images 버킷의 getPublicUrl 값만 넣는다
 *     (src/services/spaceMessageService.ts) — 공개(/object/public/)·서명(/object/sign/) 주소 모두
 *     /storage/v1/object/ 아래이므로 그 경로만 허용한다.
 *
 * @param raw        - 메시지에 저장된 image_url
 * @param supabaseUrl - 이 프로젝트의 SUPABASE_URL
 * @returns 허용되는 주소면 정규화된 URL 문자열, 아니면 null
 * 주의: URL 생성자가 `..` 경로를 정규화한 **뒤에** 비교하므로 경로 우회가 통하지 않는다.
 *       호스트는 문자열 접두사가 아니라 origin 전체 일치로 본다(`…supabase.co.evil.com` 차단).
 */
function toAllowedStorageUrl(raw: string, supabaseUrl: string): string | null {
  try {
    const u = new URL(raw);
    const base = new URL(supabaseUrl);
    if (u.origin !== base.origin) return null;
    if (!u.pathname.startsWith('/storage/v1/object/')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * 응답 본문을 최대 maxBytes 까지만 읽는다. 넘으면 null(읽기 중단).
 *
 * @param resp     - fetch 응답
 * @param maxBytes - 허용 최대 바이트
 * @returns 본문 바이트 또는 null(상한 초과)
 * 주의: Content-Length 는 없거나 거짓일 수 있어 실제로 읽은 양으로 판단한다.
 */
async function readBodyCapped(resp: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(resp.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await resp.body?.cancel();
    return null;
  }
  if (!resp.body) return new Uint8Array(0);
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  // 조각들을 한 버퍼로 합친다.
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

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

  // v1.2.7 — 통일된 _shared/quota.ts 게이트로 전환. 이전엔 자체 카운트
  // (DAILY_CAP) 만 있어 Pro 시간당 cap 없음 → 1시간에 수십회 호출 시
  // Haiku Vision 비용 폭증 가능했음. 이제 quota.ts 의 LIMITS 등록값
  // (free 5/일, pro 15/시간) 강제.
  // @ts-ignore — Deno path resolves at deploy time.
  const { enforceQuota } = await import('../_shared/quota.ts');
  const quota = await enforceQuota({
    adminClient: admin, userId, functionName: 'analyze-image',
  });
  if (!quota.allowed) {
    return json({ error: 'quota_exceeded', reason: quota.reason }, 429);
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
  // 2026-10-13: 우리 Storage 주소만 받고, 리다이렉트는 따라가지 않으며, 크기 상한을 둔다.
  const imageUrl = toAllowedStorageUrl(msg.image_url, supabaseUrl);
  if (!imageUrl) return json({ error: 'unsupported image url' }, 400);
  const imgResp = await fetch(imageUrl, { redirect: 'error' });
  if (!imgResp.ok) return json({ error: 'image fetch failed' }, 502);
  const imgBuf = await readBodyCapped(imgResp, MAX_IMAGE_BYTES);
  if (!imgBuf) return json({ error: 'image too large' }, 413);
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
    // 크레딧 소진(결제) → LEAD 이메일 알림 + 사용자에게 명확 안내(503).
    // raw fetch 라 SDK throw 가 아님 — 응답 본문 텍스트로 판별.
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(txt)) {
      await alertCreditExhausted(admin, { fn: 'analyze-image' });
      return json({ error: 'ai_unavailable' }, 503);
    }
    return json({ error: `anthropic ${anthropicResp.status}`, detail: txt }, 502);
  }
  const aiData = await anthropicResp.json();

  // usage_metrics 기록 — 🔴 2026-10-13: AI 호출 **직후**로 옮겼다.
  //   예전엔 function_name(NOT NULL·한도 계산 키)이 빠져 매번 실패했고, 태그 0개면 기록 전에 반환했다
  //   → enforceQuota(행 수로 셈)가 늘 0 을 봤다. supabase-js 는 throw 하지 않으므로 { error } 를 직접 본다.
  {
    const inputTokens  = aiData?.usage?.input_tokens  ?? 0;
    const outputTokens = aiData?.usage?.output_tokens ?? 0;
    const costUsd = (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
    const { error: metricsError } = await admin.from('usage_metrics').insert({
      user_id:       userId,
      function_name: 'analyze-image',
      model:         MODEL,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      cost_usd:      costUsd,
      feature_area:  'image_tag',
    });
    if (metricsError) console.error('[analyze-image] usage_metrics insert failed:', metricsError.message);
  }

  const text = (aiData?.content?.[0]?.text as string ?? '').trim();
  const tags = text
    .split(/[,，、]/)
    .map((s) => s.trim().replace(/[#'"]/g, ''))
    .filter((s) => s.length > 0 && s.length < 12)
    .slice(0, 3);

  if (tags.length === 0) return json({ tags: [] });

  await admin.from('space_messages').update({ tags }).eq('id', body.messageId);

  return json({ tags });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
