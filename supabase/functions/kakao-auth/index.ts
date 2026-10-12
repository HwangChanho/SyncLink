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
 *      upserts a Supabase auth user, sets a one-time random password
 *      (2026-10-13 — 예전의 고정 파생값 대신), and redirects the
 *      user-agent to (state 는 허용 목록 주소만 — isAllowedReturnTo):
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

/**
 * 우리 카카오 앱 ID (카카오 개발자 콘솔 «SyncDay»). 비밀값이 아니다.
 * access token 이 **우리 앱에서 발급된 것인지** 대조하는 데 쓴다(access_token_info.app_id).
 * 다른 카카오 앱이 받은 토큰을 이 함수에 넣어 로그인하는 것을 막는다.
 */
const KAKAO_APP_ID = '1433830';

/**
 * GET 콜백이 자격(email·password)을 붙여 돌려보내도 되는 복귀 주소 목록.
 * 클라이언트가 보내는 state 값(authService.ts buildKakaoAuthUrl 호출부)과 1:1 로 맞춘다:
 *   - 네이티브 폴백: Linking.createURL('/auth/callback') → synclink://auth/callback
 *   - 웹: `${location.origin}/auth/callback` → https://synclink.pages.dev/auth/callback
 *   - 로컬 개발 웹: http://localhost:<port>/auth/callback (isAllowedReturnTo 에서 따로 판정)
 * Supabase Auth 의 redirect 허용 목록(uri_allow_list)과 같은 범위다.
 */
const ALLOWED_RETURN_TO = new Set([
  'synclink://auth/callback',
  'https://synclink.pages.dev/auth/callback',
]);

// ─── Kakao types ──────────────────────────────────────────────────────────────

interface KakaoTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
}

/** GET /v1/user/access_token_info 응답 — 토큰이 어느 앱에서 발급됐는지 확인용. */
interface KakaoTokenInfo {
  id: number;
  app_id: number;
  expires_in: number;
}

interface KakaoUser {
  id: number;
  kakao_account?: {
    email?: string;
    /** 이메일 형식이 유효한지(카카오 판정). */
    is_email_valid?: boolean;
    /** 카카오가 이 이메일의 소유를 인증했는지. false 면 남의 이메일일 수 있다. */
    is_email_verified?: boolean;
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

    // 🔴 2026-10-13: 복귀 주소는 허용 목록만. 목록 밖이면 자격도 오류도 붙이지 않고 여기서 끝낸다
    //    (아래 리다이렉트는 email·password 를 쿼리에 실어 보내므로 주소를 반드시 우리 것으로 제한한다).
    if (!isAllowedReturnTo(returnTo)) {
      await logToDb('kakao-auth.invalid-state', new Error('return_to not allowed'), {
        returnToPrefix: returnTo.slice(0, 40),
      });
      return new Response('invalid state', { status: 400, headers: CORS_HEADERS });
    }

    // Kakao may redirect with ?error= if user denies the consent prompt.
    if (errorParam) {
      return htmlRedirect(`${returnTo}?error=${encodeURIComponent(errorParam)}`);
    }
    if (!code) {
      return htmlRedirect(`${returnTo}?error=no_code`);
    }

    try {
      // Hardcode the Edge Function URL to match what the client sent at
      // authorize time. `url.origin` may be rewritten by Supabase's edge
      // proxy to an internal host, causing Kakao to reject with KOE303
      // (redirect_uri mismatch). Using the public canonical URL avoids this.
      const selfUrl = 'https://uhubhqcymxajdonmkthm.supabase.co/functions/v1/kakao-auth';
      console.log('[kakao-auth] token exchange redirect_uri:', selfUrl, 'incoming origin:', url.origin);
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

  // ── POST ────────────────────────────────────────────────────────────────────
  // 두 가지 입력을 받는다:
  //   { accessToken }            ← **네이티브 SDK 경로**(@react-native-kakao). 앱이 카카오톡으로
  //                                이미 인증을 마쳐 access token 을 들고 있으므로 교환이 불필요하다.
  //   { code, redirect_uri }     ← 기존 경로(웹/테스트 호환). 유지한다.
  //
  // 🔴 클라이언트가 email 을 직접 보내게 하면 안 된다 — 아무 이메일이나 보내 남의 계정을
  //    가져갈 수 있다. **토큰을 서버가 카카오에 물어 검증**하는 이 구조를 지켜야 한다.
  if (req.method === 'POST') {
    try {
      const body = (await req.json().catch(() => null)) as
        | { accessToken?: string; code?: string; redirect_uri?: string }
        | null;

      if (body?.accessToken) {
        const { email, password } = await provisionFromAccessToken(body.accessToken);
        return jsonResponse({ email, password }, 200);
      }

      if (!body?.code || !body?.redirect_uri) {
        return jsonResponse({ error: 'accessToken or (code and redirect_uri) required' }, 400);
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

  // 2~3 단계는 access token 만 있으면 되므로 분리해 네이티브 경로와 공유한다.
  return provisionFromAccessToken(tokens.access_token);
}

/**
 * Kakao access token → (발급 앱 확인) → 프로필 조회 → Supabase 계정 찾기/만들기 → 로그인용 자격 반환.
 *
 * code 교환 경로(웹)와 네이티브 SDK 경로가 **공유**하는 부분이다. 네이티브 SDK 는
 * 카카오톡으로 인증을 마치고 access token 을 직접 주므로 교환 단계가 없다.
 *
 * ## 계정을 고르는 순서 (2026-10-13 보강)
 *   1. app_metadata.kakao_id 가 이 카카오 ID 인 계정 — 서버만 쓸 수 있는 칸이라 가장 확실하다.
 *   2. 예전 방식으로 만들어진 계정 — user_metadata.kakao_id 가 같고, 이메일이 카카오가 준 이메일
 *      (또는 대체 이메일)과 같고, 이메일 인증이 끝난 계정. 찾으면 1번 칸에 옮겨 적는다.
 *      (user_metadata 는 사용자가 직접 바꿀 수 있는 칸이라 이메일 일치·인증을 함께 본다.)
 *   3. 없으면 새 계정. 이메일은 카카오가 **소유를 인증한** 이메일만 쓰고, 아니면 대체 이메일.
 *      그 이메일로 이미 다른 계정이 있으면 **합치지 않고 거절**한다 — 다른 계정의 비밀번호를
 *      카카오 로그인이 덮어쓰지 않게 한다.
 *
 * ## 비밀번호
 *   로그인마다 새로 만드는 무작위 값이다. 호출부(authService.ts)는 받은 즉시 signInWithPassword 로
 *   세션을 만들고 버린다. 로그인마다 바뀌므로 한 번 새어 나간 값이 오래 유효하지 않다.
 *   ⚠️ 같은 사용자가 거의 동시에 두 번 로그인하면 먼저 받은 비밀번호가 무효가 될 수 있다(재시도로 해결).
 *
 * @param accessToken 카카오 access token. 서버가 카카오에 직접 물어 검증한다.
 * @returns Supabase `signInWithPassword` 에 쓸 email/password
 * @throws 다른 앱 토큰 · 프로필 조회 실패 · 이메일 충돌 · 계정 생성/갱신 실패
 */
async function provisionFromAccessToken(
  accessToken: string,
): Promise<{ email: string; password: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('server misconfigured: missing env');
  }

  // 1. 이 토큰이 우리 카카오 앱에서 발급됐는지 확인한다(다른 앱이 받은 토큰 거절).
  const infoRes = await fetch('https://kapi.kakao.com/v1/user/access_token_info', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoRes.ok) {
    const errText = await infoRes.text().catch(() => '<unreadable>');
    const err = new Error('kakao token info failed');
    await logToDb('kakao-auth.token-info', err, { status: infoRes.status, kakaoBody: errText });
    throw err;
  }
  const tokenInfo = (await infoRes.json()) as KakaoTokenInfo;
  if (String(tokenInfo.app_id) !== KAKAO_APP_ID) {
    const err = new Error('kakao token issued for another app');
    // 받은 app_id 는 비밀이 아니다 — KAKAO_APP_ID 설정이 틀렸을 때 바로 고칠 수 있게 남긴다.
    await logToDb('kakao-auth.app-mismatch', err, { appId: tokenInfo.app_id });
    throw err;
  }

  // 2. Fetch Kakao profile
  const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
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

  // 카카오가 준 이메일 원문(기존 계정 대조용)과, 카카오가 소유를 인증했을 때만 쓰는 이메일(새 계정용)을 나눈다.
  const rawKakaoEmail = kakaoUser.kakao_account?.email?.toLowerCase() ?? null;
  const verifiedEmail =
    rawKakaoEmail
      && kakaoUser.kakao_account?.is_email_valid === true
      && kakaoUser.kakao_account?.is_email_verified === true
      ? rawKakaoEmail
      : null;
  const placeholderEmail = `kakao_${kakaoId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  const nickname =
    kakaoUser.kakao_account?.profile?.nickname ??
    kakaoUser.properties?.nickname ??
    `Kakao ${kakaoId}`;
  const avatarUrl =
    kakaoUser.kakao_account?.profile?.profile_image_url ??
    kakaoUser.properties?.profile_image ??
    null;

  const password = randomPassword();
  const userMetadata = {
    provider: 'kakao',
    kakao_id: kakaoId,
    display_name: nickname,
    avatar_url: avatarUrl,
  };

  // 3. 계정 찾기 — 순서는 함수 머리 주석 참고.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users = await listAllUsers(admin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sameEmail = (u: any, e: string | null) => !!e && String(u.email ?? '').toLowerCase() === e;
  const linked = users.find((u) => String(u.app_metadata?.kakao_id ?? '') === kakaoId);
  const legacy = linked ? null : users.find((u) =>
    String(u.user_metadata?.kakao_id ?? '') === kakaoId
    && !!u.email_confirmed_at
    && (sameEmail(u, rawKakaoEmail) || sameEmail(u, placeholderEmail)));
  const account = linked ?? legacy;

  if (account) {
    // 기존 카카오 계정 — 이번 로그인용 비밀번호로 바꾸고, kakao_id 를 서버 전용 칸에도 적는다.
    const { error } = await admin.auth.admin.updateUserById(account.id, {
      password,
      app_metadata: { ...(account.app_metadata ?? {}), kakao_id: kakaoId },
      user_metadata: { ...(account.user_metadata ?? {}), ...userMetadata },
    });
    if (error) {
      const wrapped = new Error(`updateUser: ${error.message}`);
      await logToDb('kakao-auth.upsert-user', wrapped, {
        op: 'updateUser', userId: account.id, kakaoId,
      });
      throw wrapped;
    }
    return { email: account.email, password };
  }

  // 새 계정. 같은 이메일의 다른 계정이 있으면 합치지 않는다.
  const email = verifiedEmail ?? placeholderEmail;
  if (users.some((u) => sameEmail(u, email))) {
    const err = new Error('이미 같은 이메일로 가입된 계정이 있어요. 원래 쓰시던 방법으로 로그인해 주세요.');
    await logToDb('kakao-auth.email-in-use', err, { kakaoId, placeholder: email === placeholderEmail });
    throw err;
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { kakao_id: kakaoId },
    user_metadata: userMetadata,
  });
  if (error) {
    const wrapped = new Error(`createUser: ${error.message}`);
    await logToDb('kakao-auth.upsert-user', wrapped, {
      op: 'createUser', kakaoId,
    });
    throw wrapped;
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
 * Bounce the user-agent to `target` (custom scheme or https).
 *
 * Why HTTP 302 instead of HTML meta refresh:
 *   Supabase's edge gateway rewrites responses to `Content-Type: text/plain`
 *   and applies a `Content-Security-Policy: sandbox` for public functions,
 *   which prevents HTML/JS-based redirects from executing (browser shows the
 *   raw HTML source instead). A server-side 302 with a `Location:` header is
 *   processed by the in-app WebBrowser BEFORE any CSP evaluation, so it works
 *   reliably for both custom schemes and HTTPS return URLs.
 */
function htmlRedirect(target: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...CORS_HEADERS, Location: target },
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

/**
 * GET 콜백의 복귀 주소가 허용 목록에 있는지 판정한다.
 *
 * @param returnTo - state 에서 꺼낸 복귀 주소
 * @returns 허용이면 true
 * 주의: 쿼리·해시는 비교에서 뺀다(클라이언트는 붙이지 않지만, 붙어 와도 주소 자체로 판정).
 *       localhost 는 로컬 개발 웹(expo start --web) 용 — 포트는 무엇이든 허용한다.
 *       URL 파서로 호스트를 뽑아 비교하므로 `https://synclink.pages.dev@evil.example` 같은 우회는 막힌다.
 */
function isAllowedReturnTo(returnTo: string): boolean {
  try {
    const u = new URL(returnTo);
    if (u.username || u.password) return false;
    const bare = `${u.protocol}//${u.host}${u.pathname}`;
    if (ALLOWED_RETURN_TO.has(bare)) return true;
    return u.protocol === 'http:'
      && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
      && u.pathname === '/auth/callback';
  } catch {
    return false;
  }
}

/**
 * 로그인 한 번에 쓰고 버릴 무작위 비밀번호(32바이트 → 16진수 64자).
 *
 * @returns 64자 16진수 문자열
 * 주의: crypto.getRandomValues 는 암호학적으로 안전한 난수다. Math.random 으로 바꾸지 말 것.
 */
function randomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Supabase Auth 사용자 전체를 페이지 단위로 읽는다(최대 10,000명).
 *
 * @param admin - service_role 클라이언트
 * @returns 사용자 배열
 * @throws 목록 조회 실패 — 🔴 실패를 «없음»으로 처리하면 기존 계정을 못 찾고 새 계정을 만들어
 *         버리므로(예전 findUserByEmail 의 동작) 반드시 예외로 끝낸다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listAllUsers(admin: any): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      const err = new Error(`listUsers: ${error.message}`);
      await logToDb('kakao-auth.list-users', err, { page });
      throw err;
    }
    const users = data?.users ?? [];
    all.push(...users);
    if (users.length < 1000) break;
  }
  return all;
}
