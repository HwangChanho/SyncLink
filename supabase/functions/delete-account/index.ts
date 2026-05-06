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
// 공통 로거 — 모든 실패 지점에서 error_logs 테이블에 기록
// @ts-expect-error: Deno 상대 경로 import — tsc는 해석 못하지만 배포 시 정상 동작
import { logToDb } from '../_shared/logger.ts';

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
      // JWT 검증 실패 — 만료된 토큰/잘못된 서명 등. LEAD가 즉시 원인 확인할 수 있게 기록
      await logToDb('delete-account.auth', authError ?? new Error('no user from token'));
      return new Response(
        JSON.stringify({ error: '유효하지 않은 인증 토큰입니다.' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const userId = user.id;

    // ── 2. Delete dependent rows first ────────────────────────────────────────
    //
    // 일부 테이블의 FK 가 ON DELETE CASCADE 가 누락되어 auth.users 직접 삭제 시
    // "Database error deleting user" 발생. service_role 로 명시적으로 모든
    // user-linked rows 를 먼저 정리한 뒤 auth.users 를 삭제한다. 누락이 발견되면
    // 이 목록에 추가하면 됨 (정확한 FK 그래프 확인 후 schema CASCADE 추가가
    // 장기적 해결책).
    //
    // 삭제 순서: 자식 → 부모. 실제 존재하는 테이블만. 진단 결과 (2026-05-06):
    //  - spaces.created_by → public.users.id 가 ON DELETE NO ACTION 이라 막음.
    //    spaces 부터 정리해야 public.users 삭제 가능.
    //  - linked_accounts / user_categories / user_settings / user_lock_settings
    //    / user_devices / ai_usage 는 schema 에 미존재 (PGRST205). 목록 제거.
    const cleanupTables: { table: string; column: string }[] = [
      // user_id 컬럼 가진 테이블
      { table: 'event_shares',  column: 'user_id'    },
      { table: 'notifications', column: 'user_id'    },
      { table: 'categories',    column: 'user_id'    },
      { table: 'space_members', column: 'user_id'    },
      { table: 'todos',         column: 'user_id'    },
      { table: 'events',        column: 'user_id'    },
      { table: 'error_logs',    column: 'user_id'    },
      // user 가 owner/creator 인 spaces — 삭제 시 space_members/events 등이
      // CASCADE 로 함께 정리되어야 (DB schema 가정). 현재 user 가 만든 모든
      // space 가 사라지는 영향이 있어 운영 정책으로 의식적인 결정.
      { table: 'spaces',        column: 'created_by' },
      // 마지막에 public.users (id 컬럼)
      { table: 'users',         column: 'id'         },
    ];

    for (const { table, column } of cleanupTables) {
      const { error: cleanupErr } = await adminClient
        .from(table)
        .delete()
        .eq(column, userId);
      // 정상 처리할 에러 코드:
      //  - 42P01 : 테이블 미존재 (Postgres)
      //  - PGRST205 : PostgREST schema cache 에 없음 (테이블 미존재의 다른 표현)
      const skip = !cleanupErr
        || cleanupErr.code === '42P01'
        || cleanupErr.code === 'PGRST205';
      if (!skip) {
        await logToDb(
          'delete-account.cleanup',
          new Error(cleanupErr.message ?? 'unknown cleanup error'),
          {
            userId,
            table,
            pgCode:    cleanupErr.code,
            pgDetails: cleanupErr.details,
            pgHint:    cleanupErr.hint,
          },
        );
        // 치명 에러가 아니면 계속 진행 — 다른 테이블이라도 정리.
      }
    }

    // ── 3. Delete the auth.users row ──────────────────────────────────────────
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError) {
      // deleteUser 실패 — FK 제약, 네트워크 등. user_id 명시해 추적 가능하게
      await logToDb('delete-account.delete-user', deleteError, { userId });
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
    // try 블록 최상위 — 예측하지 못한 예외 (JSON 파싱, env 누락 등)
    await logToDb('delete-account.unexpected', err);
    return new Response(
      JSON.stringify({ error: '서버 오류가 발생했습니다.' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
