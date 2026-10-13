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
 * ## v=2 — 1회용 로그인 토큰 (2026-10-13, 보안 3-B5)
 *   새 앱은 신호를 보낸다: POST 본문 `v: 2` / GET 은 복귀 주소(state)의 쿼리 `v=2`.
 *   그러면 비밀번호를 건드리지 않고 1회용 로그인 토큰(magiclink token_hash — 1회 사용·만료 있음)을 돌려준다
 *   → 앱은 verifyOtp({ token_hash, type: 'email' }) 로 세션을 만든다.
 *   효과: 카카오 로그인이 그 사용자의 다른 기기 세션을 끊지 않는다(관리자 API 로 비밀번호를 바꾸면 전 세션이 끊긴다)
 *         · 브라우저 기록에 남는 값이 1회용이다 · 거의 동시 로그인 두 번이 서로를 무효로 만들지 않는다.
 *   GET 은 복귀 주소의 기존 쿼리(웹의 1회용 확인값 n 등)를 보존하고 token_hash 를 덧붙인다.
 *   신호가 없는 옛 앱은 위 1~5 그대로(응답 형식 변경 없음).
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

    // v=2(새 앱) 이면 1회용 토큰으로 응답하고, 복귀 주소의 기존 쿼리를 보존하며 파라미터를 덧붙인다.
    // 옛 앱(신호 없음)은 예전 문자열 그대로 만든다(응답 형식을 한 글자도 바꾸지 않기 위해).
    const wantsOtp = returnToWantsOtp(returnTo);
    const back = (params: Record<string, string>): Response => htmlRedirect(
      wantsOtp
        ? withQueryParams(returnTo, params)
        : `${returnTo}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`,
    );

    // Kakao may redirect with ?error= if user denies the consent prompt.
    if (errorParam) {
      return back({ error: errorParam });
    }
    if (!code) {
      return back({ error: 'no_code' });
    }

    try {
      // Hardcode the Edge Function URL to match what the client sent at
      // authorize time. `url.origin` may be rewritten by Supabase's edge
      // proxy to an internal host, causing Kakao to reject with KOE303
      // (redirect_uri mismatch). Using the public canonical URL avoids this.
      const selfUrl = 'https://uhubhqcymxajdonmkthm.supabase.co/functions/v1/kakao-auth';
      console.log('[kakao-auth] token exchange redirect_uri:', selfUrl, 'incoming origin:', url.origin);
      const cred = await exchangeCode(code, selfUrl, wantsOtp ? 'otp' : 'password');
      // v=2 는 email 을 싣지 않는다(verifyOtp 에 필요 없음 — 브라우저 기록에 남는 값을 줄인다).
      return back('tokenHash' in cred
        ? { token_hash: cred.tokenHash }
        : { email: cred.email, password: cred.password });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // GET 플로우 최상위 catch — exchangeCode 안에서 세분화된 context로 이미 기록됐을 수 있지만
      // 그렇지 않은 예외(JSON 파싱 오류 등)도 모두 잡기 위해 한 번 더 기록
      await logToDb('kakao-auth.unexpected', err, { flow: 'GET', code: !!code });
      return back({ error: message });
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
        | { accessToken?: string; code?: string; redirect_uri?: string; v?: number }
        | null;
      // v=2(새 앱) → { tokenHash } / 옛 앱 → { email, password } (머리 주석 참고)
      const issue: CredentialKind = body?.v === 2 ? 'otp' : 'password';

      if (body?.accessToken) {
        return jsonResponse(toJsonCredential(await provisionFromAccessToken(body.accessToken, issue)), 200);
      }

      if (!body?.code || !body?.redirect_uri) {
        return jsonResponse({ error: 'accessToken or (code and redirect_uri) required' }, 400);
      }
      return jsonResponse(toJsonCredential(await exchangeCode(body.code, body.redirect_uri, issue)), 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      await logToDb('kakao-auth.unexpected', err, { flow: 'POST' });
      return jsonResponse({ error: message }, 500);
    }
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});

// ─── Core exchange logic (shared by GET and POST) ─────────────────────────────

/**
 * 카카오 인가 코드 → access token 교환 후 provisionFromAccessToken 으로 넘긴다.
 *
 * @param code        - 카카오 인가 코드
 * @param redirectUri - 인가 요청 때 쓴 redirect_uri(같아야 교환된다)
 * @param issue       - 돌려줄 자격 종류('password' = 옛 앱 · 'otp' = 1회용 토큰)
 * @returns 로그인 자격
 */
async function exchangeCode(
  code: string,
  redirectUri: string,
  issue: CredentialKind,
): Promise<KakaoCredential> {
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
  return provisionFromAccessToken(tokens.access_token, issue);
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
 * ## 돌려주는 자격 (issue)
 *   - 'otp'(v=2 새 앱): 비밀번호를 건드리지 않고 1회용 로그인 토큰(magiclink token_hash)을 만든다.
 *     새 계정도 비밀번호 없이 만든다(카카오 계정은 비밀번호 로그인을 쓰지 않는다).
 *   - 'password'(옛 앱): 아래 «비밀번호» 그대로.
 *
 * ## 비밀번호 (issue = 'password')
 *   로그인마다 새로 만드는 무작위 값이다. 호출부(authService.ts)는 받은 즉시 signInWithPassword 로
 *   세션을 만들고 버린다. 로그인마다 바뀌므로 한 번 새어 나간 값이 오래 유효하지 않다.
 *   ⚠️ 같은 사용자가 거의 동시에 두 번 로그인하면 먼저 받은 비밀번호가 무효가 될 수 있다(재시도로 해결).
 *
 * @param accessToken 카카오 access token. 서버가 카카오에 직접 물어 검증한다.
 * @param issue       돌려줄 자격 종류(위 «돌려주는 자격»)
 * @returns 'password' → { email, password } (signInWithPassword 용) / 'otp' → { email, tokenHash } (verifyOtp 용)
 * @throws 다른 앱 토큰 · 프로필 조회 실패 · 이메일 충돌 · 계정 생성/갱신 실패 · 1회용 토큰 발급 실패
 */
async function provisionFromAccessToken(
  accessToken: string,
  issue: CredentialKind,
): Promise<KakaoCredential> {
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

  // 옛 앱 경로에서만 비밀번호를 만든다(v=2 는 비밀번호를 건드리지 않는다).
  const password = issue === 'password' ? randomPassword() : null;
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
    // 기존 카카오 계정 — kakao_id 를 서버 전용 칸에도 적고, 옛 앱 경로면 이번 로그인용 비밀번호로 바꾼다.
    const { error } = await admin.auth.admin.updateUserById(account.id, {
      ...(password ? { password } : {}),
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
    return issueCredential(admin, account.email, password);
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
    ...(password ? { password } : {}),
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

  return issueCredential(admin, email, password);
}

/** 돌려줄 자격 종류 — 'password' = 옛 앱(무작위 비밀번호) · 'otp' = 새 앱(1회용 로그인 토큰). */
type CredentialKind = 'password' | 'otp';

/** 로그인 자격. tokenHash 가 있으면 verifyOtp, 아니면 signInWithPassword 용. */
type KakaoCredential = { email: string; password: string } | { email: string; tokenHash: string };

/**
 * 계정 준비가 끝난 뒤 앱에 돌려줄 자격을 만든다.
 *
 * @param admin    - service_role 클라이언트
 * @param email    - 로그인할 계정의 이메일
 * @param password - 옛 앱 경로에서 방금 설정한 비밀번호. null 이면 1회용 토큰을 발급한다.
 * @returns 자격
 * @throws 1회용 토큰 발급 실패 (메일은 보내지 않는다 — generateLink 는 링크 값만 만든다)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function issueCredential(admin: any, email: string, password: string | null): Promise<KakaoCredential> {
  if (password) return { email, password };

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token as string | undefined;
  if (error || !tokenHash) {
    const err = new Error(`generateLink: ${error?.message ?? 'no hashed_token'}`);
    await logToDb('kakao-auth.generate-link', err, {});
    throw err;
  }
  return { email, tokenHash };
}

/**
 * POST 응답 본문. 1회용 토큰이면 tokenHash 만 싣는다(email 은 verifyOtp 에 필요 없다).
 *
 * @param cred - issueCredential 결과
 * @returns JSON 으로 보낼 객체
 */
function toJsonCredential(cred: KakaoCredential): Record<string, string> {
  return 'tokenHash' in cred ? { tokenHash: cred.tokenHash } : { email: cred.email, password: cred.password };
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
 * 복귀 주소에 새 앱 신호(쿼리 v=2)가 있는지.
 *
 * @param returnTo - 허용 목록 검사를 통과한 복귀 주소
 * @returns v=2 면 true
 */
function returnToWantsOtp(returnTo: string): boolean {
  try {
    return new URL(returnTo).searchParams.get('v') === '2';
  } catch {
    return false;
  }
}

/**
 * 복귀 주소의 기존 쿼리를 보존한 채 파라미터를 덧붙인다(`?` 가 두 번 붙지 않게).
 *
 * @param returnTo - 복귀 주소(쿼리가 있을 수 있다)
 * @param params   - 덧붙일 키·값
 * @returns 완성된 주소
 */
function withQueryParams(returnTo: string, params: Record<string, string>): string {
  const u = new URL(returnTo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
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
