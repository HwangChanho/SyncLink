/**
 * kakao-auth Edge Function (GET-callback architecture)
 *
 * Kakao requires HTTPS for OAuth redirect_uri, so this function IS the
 * redirect target. Flow:
 *
 *   1. Client opens Kakao authorize URL with:
 *        redirect_uri = https://.../functions/v1/kakao-auth
 *        state        = <app-provided final redirect URL, e.g. synclink://auth/callback>
 *   2. User authenticates on Kakao.
 *   3. Kakao redirects (GET) to this function with ?code=...&state=...
 *   4. This function exchanges the code for Kakao tokens, fetches the profile,
 *      upserts a Supabase auth user, derives a deterministic password, and
 *      returns an HTML page that redirects the user-agent to:
 *        <state>?email=<email>&password=<password>
 *   5. The app's WebBrowser.openAuthSessionAsync catches that custom-scheme
 *      redirect and returns control to the app. The app then calls
 *      signInWithPassword(email, password) to mint a real Supabase session.
 *
 * Deployment: `supabase functions deploy kakao-auth`
 */

// @ts-expect-error: Deno Edge Function remote imports are not understood by tsc.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-expect-error: Deno remote import — resolved at deploy time, not by tsc.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// 공통 로거 — 모든 실패 지점에서 error_logs 테이블에 기록
// @ts-expect-error: Deno 상대 경로 import — tsc는 해석 못하지만 배포 시 정상 동작
import { logToDb } from '../_shared/logger.ts';

declare const Deno: { env: { get(key: string): string | undefined } };

// ─── Constants ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const PLACEHOLDER_EMAIL_DOMAIN = 'kakao.synclink.app';

/** Fallback return URL if client didn't provide one via ?state=. */
const DEFAULT_APP_RETURN = 'synclink://auth/callback';

// ─── Kakao types ──────────────────────────────────────────────────────────────

interface KakaoTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
}

interface KakaoUser {
  id: number;
  kakao_account?: {
    email?: string;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
  properties?: {
    nickname?: string;
    profile_image?: string;
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  // ── GET: Kakao redirected here after user consent ──────────────────────────
  if (req.method === 'GET') {
    const code = url.searchParams.get('code');
    const errorParam = url.searchParams.get('error');
    const stateParam = url.searchParams.get('state');
    const returnTo = decodeReturnTo(stateParam) ?? DEFAULT_APP_RETURN;

    // Kakao may redirect with ?error= if user denies the consent prompt.
    if (errorParam) {
      return htmlRedirect(`${returnTo}?error=${encodeURIComponent(errorParam)}`);
    }
    if (!code) {
      return htmlRedirect(`${returnTo}?error=no_code`);
    }

    try {
      const selfUrl = `${url.origin}${url.pathname}`;
      const { email, password } = await exchangeCode(code, selfUrl);
      return htmlRedirect(
        `${returnTo}?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // GET 플로우 최상위 catch — exchangeCode 안에서 세분화된 context로 이미 기록됐을 수 있지만
      // 그렇지 않은 예외(JSON 파싱 오류 등)도 모두 잡기 위해 한 번 더 기록
      await logToDb('kakao-auth.unexpected', err, { flow: 'GET', code: !!code });
      return htmlRedirect(`${returnTo}?error=${encodeURIComponent(message)}`);
    }
  }

  // ── POST: kept for backward-compat testing, not used by production client ──
  if (req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => null)) as
        | { code?: string; redirect_uri?: string }
        | null;
      if (!body?.code || !body?.redirect_uri) {
        return jsonResponse({ error: 'code and redirect_uri required' }, 400);
      }
      const { email, password } = await exchangeCode(body.code, body.redirect_uri);
      return jsonResponse({ email, password }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await logToDb('kakao-auth.unexpected', err, { flow: 'POST' });
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});

// ─── Core exchange logic (shared by GET and POST) ─────────────────────────────

async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ email: string; password: string }> {
  const kakaoRestApiKey = Deno.env.get('KAKAO_REST_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!kakaoRestApiKey || !supabaseUrl || !serviceRoleKey) {
    throw new Error('server misconfigured: missing env');
  }

  // 1. Exchange code with Kakao (no client_secret)
  const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: kakaoRestApiKey,
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    const err = new Error(`kakao token exchange failed: ${errText}`);
    // Kakao 응답 전체를 details로 남김 → invalid_grant / redirect_uri mismatch 등 원인 즉시 파악
    await logToDb('kakao-auth.token-exchange', err, {
      status:      tokenRes.status,
      kakaoBody:   errText,
      redirectUri: redirectUri,
    });
    throw err;
  }

  const tokens = (await tokenRes.json()) as KakaoTokenResponse;

  // 2. Fetch Kakao profile
  const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    const errText = await userRes.text().catch(() => '<unreadable>');
    const err = new Error('kakao user fetch failed');
    await logToDb('kakao-auth.user-fetch', err, {
      status:    userRes.status,
      kakaoBody: errText,
    });
    throw err;
  }

  const kakaoUser = (await userRes.json()) as KakaoUser;
  const kakaoId = String(kakaoUser.id);

  const email =
    kakaoUser.kakao_account?.email ?? `kakao_${kakaoId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  const nickname =
    kakaoUser.kakao_account?.profile?.nickname ??
    kakaoUser.properties?.nickname ??
    `Kakao ${kakaoId}`;
  const avatarUrl =
    kakaoUser.kakao_account?.profile?.profile_image_url ??
    kakaoUser.properties?.profile_image ??
    null;

  const password = await derivePassword(kakaoId, kakaoRestApiKey);

  // 3. Upsert Supabase auth user
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existingUser = await findUserByEmail(admin, email);

  if (!existingUser) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        provider: 'kakao',
        kakao_id: kakaoId,
        display_name: nickname,
        avatar_url: avatarUrl,
      },
    });
    if (error) {
      const wrapped = new Error(`createUser: ${error.message}`);
      await logToDb('kakao-auth.upsert-user', wrapped, {
        op: 'createUser', email, kakaoId,
      });
      throw wrapped;
    }
  } else {
    const { error } = await admin.auth.admin.updateUserById(existingUser.id, {
      password,
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        provider: 'kakao',
        kakao_id: kakaoId,
        display_name: nickname,
        avatar_url: avatarUrl,
      },
    });
    if (error) {
      const wrapped = new Error(`updateUser: ${error.message}`);
      await logToDb('kakao-auth.upsert-user', wrapped, {
        op: 'updateUser', userId: existingUser.id, email, kakaoId,
      });
      throw wrapped;
    }
  }

  return { email, password };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Return an HTML page that bounces the user-agent to `target` (custom scheme
 * or https). The in-app WebBrowser on iOS/Android watches for the app's
 * return scheme and closes automatically on match.
 */
function htmlRedirect(target: string): Response {
  const safe = target.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = `<!DOCTYPE html>
<html><head>
<meta http-equiv="refresh" content="0; url=${safe}">
<script>window.location.replace(${JSON.stringify(target)});</script>
</head><body>Redirecting…</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Decode the client-provided state param (base64url of the final redirect URL).
 * Returns null if the value is missing or malformed so we can fall back to the
 * default app scheme.
 */
function decodeReturnTo(stateParam: string | null): string | null {
  if (!stateParam) return null;
  try {
    // Accept either plain URL or base64url-encoded URL.
    // Base64 fallback lets us avoid URL-encoding surprises in OAuth state.
    const s = stateParam.trim();
    if (/^https?:\/\/|^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return bin;
  } catch {
    return null;
  }
}

async function derivePassword(kakaoId: string, restApiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`kakao:${kakaoId}:${restApiKey}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findUserByEmail(admin: any, email: string): Promise<any | null> {
  for (let page = 1; page <= 2; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error('[kakao-auth] listUsers failed:', error.message);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = data?.users?.find((u: any) => u.email === email);
    if (match) return match;
    if (!data?.users || data.users.length < 1000) break;
  }
  return null;
}
