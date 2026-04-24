/**
 * delete-account Edge Function
 *
 * Permanently deletes the authenticated user's account.
 *
 * Security model:
 *  - The client's anon key cannot call supabase.auth.admin.deleteUser().
 *    This Edge Function runs with the service role key and performs
 *    deletion on behalf of the caller.
 *  - JWT is validated first; the user can only delete their OWN account.
 *  - Cascades: DB schema uses ON DELETE CASCADE on all user-linked tables,
 *    so all associated events, todos, space memberships, etc. are removed.
 *
 * Called by: src/services/authService.ts → deleteAccount()
 *
 * Environment variables required (Supabase Dashboard → Functions → Secrets):
 *  - SUPABASE_URL              — auto-injected by Supabase runtime
 *  - SUPABASE_SERVICE_ROLE_KEY — must be manually set (never expose to client)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// ─── CORS headers ─────────────────────────────────────────────────────────────

/**
 * CORS response headers.
 * Allow requests from the app (native requests don't need CORS, but web does).
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Only POST is supported
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // ── 1. Extract and verify the caller's JWT ───────────────────────────────

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: '인증 토큰이 필요합니다.' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service role client — used both for token verification and deletion.
    // Previous bug: createClient(supabaseUrl, token) passed the user's JWT
    // as the anon key, which GoTrue always rejects. Using the service role
    // client and handing the token to getUser() is the documented pattern.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);

    if (authError || !user) {
      console.error('delete-account: getUser failed:', authError?.message ?? 'no user');
      return new Response(
        JSON.stringify({ error: '유효하지 않은 인증 토큰입니다.' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const userId = user.id;

    // ── 2. Delete the user using the service role client ─────────────────────

    // deleteUser removes the auth.users row.
    // All dependent rows (users, events, todos, space_members, etc.) are
    // removed via ON DELETE CASCADE in the DB schema.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error(`delete-account: failed to delete user ${userId}:`, deleteError.message);
      return new Response(
        JSON.stringify({ error: '계정 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`delete-account: successfully deleted user ${userId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('delete-account: unexpected error:', message);
    return new Response(
      JSON.stringify({ error: '서버 오류가 발생했습니다.' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
