// supabase/functions/google-calendar-connect/index.ts
//
// Sprint 1 — 외부 캘린더 sync. Google OAuth serverAuthCode → refresh_token
// 교환 후 google_oauth_tokens 테이블에 저장.
//
// 흐름:
//   1. 클라이언트 (RN) 가 GoogleSignin.signIn({ scopes: [calendar.readonly] })
//      로 serverAuthCode 획득.
//   2. user JWT + serverAuthCode 를 본 함수 POST 로 전송.
//   3. oauth2.googleapis.com/token 으로 교환 → refresh_token + access_token.
//   4. google_oauth_tokens upsert (user_id PK).
//   5. 응답: { connected: true, email }.
//
// disconnect 도 같은 함수 — DELETE / { action: 'disconnect' }.
//
// 환경 변수 (Edge Function secrets):
//   - SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//   - GOOGLE_OAUTH_CLIENT_ID    — Google Cloud Console OAuth client (web)
//   - GOOGLE_OAUTH_CLIENT_SECRET — 동일 client 의 secret

// @ts-ignore — Deno import map resolves at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

interface ConnectBody {
  action?:         'connect' | 'disconnect';
  serverAuthCode?: string;
  redirectUri?:    string;
}

interface GoogleTokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_in:    number;
  scope:         string;
  token_type:    string;
  id_token?:     string;
}

// JWT id_token 을 parse 해 email 추출 (signature 검증은 google-auth-library
// 까지 import 하면 무거우니 생략 — id_token 은 Google 이 만든 것 신뢰).
function parseIdTokenEmail(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.email ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1) user JWT 인증
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
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
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: ConnectBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2) disconnect — 단순 DB 삭제 + Google revoke
  if (body.action === 'disconnect') {
    const { data: existing } = await adminClient
      .from('google_oauth_tokens')
      .select('refresh_token')
      .eq('user_id', user.id)
      .single();
    if (existing?.refresh_token) {
      // Best-effort revoke (실패해도 DB 는 삭제)
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(existing.refresh_token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch { /* ignore */ }
    }
    await adminClient.from('google_oauth_tokens').delete().eq('user_id', user.id);
    return new Response(JSON.stringify({ connected: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3) connect — serverAuthCode → token 교환
  const code = body.serverAuthCode;
  if (!code) {
    return new Response(JSON.stringify({ error: 'serverAuthCode required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const clientId     = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'oauth_config_missing' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      // RN GoogleSignin offlineAccess 흐름은 redirect_uri 공란 또는
      // postmessage 사용. 클라이언트가 명시한 redirectUri 가 있으면 우선.
      redirect_uri:  body.redirectUri ?? '',
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: 'google_token_exchange_failed', detail: errText.slice(0, 300) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const tokens = await tokenRes.json() as GoogleTokenResponse;
  if (!tokens.refresh_token) {
    // 보통 사용자가 이전에 이미 동의 → refresh_token 누락. prompt=consent 로
    // 강제 재발급 필요. 클라이언트가 forceRefreshToken 으로 재시도하게 안내.
    return new Response(
      JSON.stringify({ error: 'no_refresh_token', hint: 'prompt=consent 로 재인증 필요' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const email = tokens.id_token ? parseIdTokenEmail(tokens.id_token) : null;
  const accessExpiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();

  // upsert — 동일 user 가 재연결 가능 (단 user 당 1 row Sprint 1).
  const { error: upsertErr } = await adminClient
    .from('google_oauth_tokens')
    .upsert({
      user_id:                 user.id,
      refresh_token:           tokens.refresh_token,
      access_token:            tokens.access_token,
      access_token_expires_at: accessExpiresAt,
      scope:                   tokens.scope,
      email,
      connected_at:            new Date().toISOString(),
      last_sync_error:         null,
    });
  if (upsertErr) {
    return new Response(
      JSON.stringify({ error: 'db_upsert_failed', detail: upsertErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify({ connected: true, email }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
