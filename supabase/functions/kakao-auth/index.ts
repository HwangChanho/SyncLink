/**
 * kakao-auth Edge Function
 *
 * Custom Kakao OAuth handler — completely bypasses Supabase's built-in Kakao
 * provider (which insists on a Client Secret and keeps failing with
 * `invalid_client`). This function owns the full OAuth exchange:
 *
 *   1. Accepts `{ code, redirect_uri }` from the client (after the user
 *      completes Kakao's OAuth consent UI).
 *   2. Exchanges the authorization code for Kakao access/refresh tokens at
 *      `https://kauth.kakao.com/oauth/token` — WITHOUT a client_secret, which
 *      is the whole point of this detour.
 *   3. Fetches the user's Kakao profile from `https://kapi.kakao.com/v2/user/me`.
 *   4. Upserts a Supabase auth user keyed by the Kakao email (falling back to
 *      a deterministic placeholder email when Kakao withholds it).
 *      Password is derived deterministically from the Kakao user ID so the
 *      same user can sign in repeatedly without us storing a secret.
 *   5. Returns `{ email, password }` to the client, which then calls
 *      `supabase.auth.signInWithPassword(...)` to mint a real session.
 *
 * Security model:
 *  - KAKAO_REST_API_KEY and SUPABASE_SERVICE_ROLE_KEY live only in Supabase
 *    secrets. They are NEVER sent to the client.
 *  - The derived password is a SHA-256 of `kakao:<kakao_id>:<REST_API_KEY>`.
 *    It is not guessable without the REST API key. We hand it back to the
 *    caller only inside this HTTPS response so the client can exchange it for
 *    a real Supabase session immediately.
 *  - The password is deterministic: the same Kakao user always gets the same
 *    hash, so subsequent logins work without any extra state.
 *
 * Environment variables (Supabase Dashboard → Functions → Secrets):
 *  - KAKAO_REST_API_KEY          — Kakao REST API key (must be set manually)
 *  - SUPABASE_URL                — auto-injected by Supabase runtime
 *  - SUPABASE_SERVICE_ROLE_KEY   — auto-injected (but must be available)
 *
 * Deployment: `supabase functions deploy kakao-auth`
 */

// @ts-expect-error: Deno Edge Function remote imports are not understood by tsc.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-expect-error: Deno remote import — resolved at deploy time, not by tsc.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// `Deno` is defined only inside the Edge Runtime. Declare a loose shape so the
// file type-checks in the Node-based client workspace (pre-existing pattern
// used by the other Edge Functions in this repo).
declare const Deno: { env: { get(key: string): string | undefined } };

// ─── Constants ────────────────────────────────────────────────────────────────

/** CORS headers applied to every response (including preflight). */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

/**
 * Placeholder email suffix used when the Kakao account doesn't expose an email
 * (common when the user didn't consent to the email scope). Keeping this as a
 * constant makes the derivation pattern obvious and consistent.
 */
const PLACEHOLDER_EMAIL_DOMAIN = 'kakao.synclink.app';

// ─── Kakao response types ─────────────────────────────────────────────────────

/** Shape of `https://kauth.kakao.com/oauth/token` 200 response. */
interface KakaoTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

/** Shape of `https://kapi.kakao.com/v2/user/me` 200 response. */
interface KakaoUser {
  id: number;
  kakao_account?: {
    email?: string;
    email_needs_agreement?: boolean;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
      thumbnail_image_url?: string;
    };
  };
  properties?: {
    nickname?: string;
    profile_image?: string;
    thumbnail_image?: string;
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // 2. Only POST is supported
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    // ── 3. Validate request body ────────────────────────────────────────────
    const body = (await req.json().catch(() => null)) as
      | { code?: string; redirect_uri?: string }
      | null;

    if (!body?.code || !body?.redirect_uri) {
      return jsonResponse({ error: 'code and redirect_uri required' }, 400);
    }

    const { code, redirect_uri } = body;

    // ── 4. Environment / secrets ────────────────────────────────────────────
    const kakaoRestApiKey = Deno.env.get('KAKAO_REST_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!kakaoRestApiKey || !supabaseUrl || !serviceRoleKey) {
      console.error('[kakao-auth] missing env:', {
        hasKakao: !!kakaoRestApiKey,
        hasSupabaseUrl: !!supabaseUrl,
        hasServiceRole: !!serviceRoleKey,
      });
      return jsonResponse({ error: 'server misconfigured' }, 500);
    }

    // ── 5. Exchange Kakao code for tokens (NO client_secret) ────────────────
    // Kakao allows token exchange without client_secret as long as the app's
    // "Client Secret status" is set to "Disabled" in the Kakao console, which
    // is exactly the condition that makes Supabase's built-in provider fail.
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: kakaoRestApiKey,
        redirect_uri,
        code,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[kakao-auth] token exchange failed:', tokenRes.status, errText);
      return jsonResponse(
        { error: 'kakao token exchange failed', detail: errText },
        502,
      );
    }

    const tokens = (await tokenRes.json()) as KakaoTokenResponse;

    // ── 6. Fetch Kakao profile ──────────────────────────────────────────────
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      console.error('[kakao-auth] user fetch failed:', userRes.status, errText);
      return jsonResponse({ error: 'kakao user fetch failed' }, 502);
    }

    const kakaoUser = (await userRes.json()) as KakaoUser;
    const kakaoId = String(kakaoUser.id);

    // Prefer the real email; fall back to a deterministic placeholder so we
    // always have a unique primary key for the Supabase auth row.
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

    // ── 7. Derive deterministic password from Kakao ID ──────────────────────
    // Using SHA-256(`kakao:<id>:<rest_api_key>`) — the REST API key acts as a
    // server-side pepper so the password can't be predicted from the ID alone.
    const password = await derivePassword(kakaoId, kakaoRestApiKey);

    // ── 8. Upsert the Supabase auth user ────────────────────────────────────
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Find existing user by email. `listUsers` is paginated; for our scale the
    // default page size (50) is fine but we defend against missing users by
    // walking a couple of pages if needed. A future migration could switch to
    // a dedicated `kakao_id` column for O(1) lookup.
    const existingUser = await findUserByEmail(admin, email);

    if (!existingUser) {
      // Brand-new user — create the auth row. `email_confirm: true` skips the
      // verification email loop (Kakao already confirmed the email for us).
      const { error: createError } = await admin.auth.admin.createUser({
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

      if (createError) {
        console.error('[kakao-auth] createUser failed:', createError.message);
        return jsonResponse({ error: 'failed to create user' }, 500);
      }
    } else {
      // Returning user — refresh the deterministic password (idempotent) and
      // keep profile metadata up-to-date in case the nickname/avatar changed.
      const { error: updateError } = await admin.auth.admin.updateUserById(
        existingUser.id,
        {
          password,
          user_metadata: {
            ...(existingUser.user_metadata ?? {}),
            provider: 'kakao',
            kakao_id: kakaoId,
            display_name: nickname,
            avatar_url: avatarUrl,
          },
        },
      );

      if (updateError) {
        console.error('[kakao-auth] updateUserById failed:', updateError.message);
        return jsonResponse({ error: 'failed to update user' }, 500);
      }
    }

    // ── 9. Hand credentials back to the client for signInWithPassword ───────
    // The client must NOT persist `password` — it's used once, then discarded.
    return jsonResponse({ email, password }, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[kakao-auth] unexpected error:', message);
    return jsonResponse({ error: message }, 500);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JSON response with CORS headers pre-applied. */
function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Derive a deterministic password from the Kakao user ID and REST API key.
 *
 * The same `(kakaoId, restApiKey)` pair always yields the same password, which
 * lets us skip persisting a "kakao → password" mapping entirely. If the REST
 * API key ever rotates, every Kakao user's password changes accordingly, and
 * this function will refresh the stored password on their next login.
 *
 * @param kakaoId     - Stringified numeric Kakao user ID
 * @param restApiKey  - Kakao REST API key (acts as a server-side pepper)
 * @returns Lowercase hex SHA-256 string (64 chars)
 */
async function derivePassword(kakaoId: string, restApiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`kakao:${kakaoId}:${restApiKey}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Find an existing Supabase auth user by email, scanning up to two pages.
 *
 * Supabase's `listUsers` returns users in creation order and paginates; 100
 * results per page is plenty for our current scale. If we outgrow this we'll
 * add a `kakao_id` column + lookup instead of scanning.
 *
 * @returns The matching auth user, or null if none found.
 */
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
    // If Supabase returned fewer than a full page, we've seen everything.
    if (!data?.users || data.users.length < 1000) break;
  }
  return null;
}
