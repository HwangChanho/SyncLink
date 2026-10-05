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
 *  - 정리 범위(2026-10-05 원격 FK 실측 기준):
 *    · 대부분의 사용자 연결 테이블은 ON DELETE CASCADE 라 users 삭제 시 함께 지워진다.
 *    · CASCADE 가 아닌 것은 아래 cleanupTables 에서 직접 지운다 —
 *      RESTRICT/NO ACTION(spaces·anniversaries·todo_attachments)은 남아 있으면 탈퇴 자체가 실패하고,
 *      SET NULL(support_requests·error_logs)은 문의 내용·회신 이메일이 탈퇴 후에도 남는다.
 *    · Storage 파일은 FK 가 없어 DB 삭제로 지워지지 않는다 → removeStoragePrefix 로 직접 지운다.
 *    개인정보처리방침 제3조 «탈퇴 시 지체 없이 파기» 를 지키기 위한 목록이다 — 테이블을 추가하면 여기도 확인할 것.
 *
 * Called by: src/services/authService.ts → deleteAccount()
 *
 * Environment variables required (Supabase Dashboard → Functions → Secrets):
 *  - SUPABASE_URL              — auto-injected by Supabase runtime
 *  - SUPABASE_SERVICE_ROLE_KEY — must be manually set (never expose to client)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

// ─── Storage 정리 ─────────────────────────────────────────────────────────────

/**
 * 버킷 안에서 prefix(폴더) 아래의 파일을 하위 폴더까지 전부 지운다.
 *
 * Storage 객체는 auth.users 와 FK 로 묶여 있지 않아 계정을 지워도 남는다(2026-10-05 실측:
 * 탈퇴한 사용자의 프로필 사진 5장·일정 사진 1장이 그대로 남아 있었다).
 *
 * @param client  service role 클라이언트(RLS 를 넘어 남의 폴더도 지울 수 있어야 한다)
 * @param bucket  버킷 이름 (예: 'avatars')
 * @param prefix  지울 폴더 경로 (예: '{userId}') — 끝에 '/' 없이
 * @returns       지운 파일 수
 * 주의: list() 는 폴더를 id=null 항목으로 돌려준다 → 그 경우 재귀로 내려간다.
 *       실패해도 throw 하지 않고 호출부가 로그만 남기게 한다(파일 정리 실패로 탈퇴를 막지 않는다).
 */
async function removeStoragePrefix(
  // deno-lint-ignore no-explicit-any -- Database 제네릭 없이 만든 클라이언트를 그대로 받는다
  client: SupabaseClient<any, any, any>,
  bucket: string,
  prefix: string,
): Promise<number> {
  // 1) 하위 폴더까지 내려가며 파일 경로를 모은다.
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const { data, error } = await client.storage.from(bucket).list(dir, { limit: 1000 });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = `${dir}/${item.name}`;
      if (item.id === null) await walk(path); // 폴더
      else files.push(path);                  // 파일
    }
  };
  await walk(prefix);
  if (files.length === 0) return 0;

  // 2) 한 번에 지운다(파일 수가 적어 배치 분할은 필요 없다 — 사진은 사용자당 수 장).
  const { error } = await client.storage.from(bucket).remove(files);
  if (error) throw error;
  return files.length;
}

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
    // 지우기 전에 이 사용자가 만든 Space id 를 받아 둔다 — Space 커버 사진(avatars/space-covers/{spaceId}/)
    // 정리에 필요한데, spaces 행을 지우고 나면 더는 알 수 없다.
    const { data: ownedSpaces } = await adminClient
      .from('spaces')
      .select('id')
      .eq('created_by', userId);
    const ownedSpaceIds: string[] = (ownedSpaces ?? []).map((s: { id: string }) => s.id);

    const cleanupTables: { table: string; column: string }[] = [
      // user_id 컬럼 가진 테이블
      // todo_attachments.user_id 는 NO ACTION — 남의 할 일에 단 첨부가 있으면 users 삭제가 막힌다.
      { table: 'todo_attachments', column: 'user_id' },
      // support_requests 는 SET NULL — 안 지우면 문의 내용·회신 이메일이 탈퇴 후에도 남는다(방침 제3조 위반).
      { table: 'support_requests', column: 'user_id' },
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
      // anniversaries.created_by 는 RESTRICT — 남의 Space 에 만든 기념일이 있으면 users 삭제가 막힌다.
      // (내 Space 의 기념일은 spaces 삭제 때 space_id CASCADE 로 함께 지워진다.)
      { table: 'anniversaries', column: 'created_by' },
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

    // ── 2-b. Storage 파일 정리 ────────────────────────────────────────────────
    // 경로 규칙: 프로필 사진 avatars/{userId}/ · 일정 사진 event-images/{userId}/{eventId}/ ·
    // Space 커버 avatars/space-covers/{spaceId}/ (authService·eventImageService·space/crud 참고).
    // 실패해도 탈퇴는 계속한다 — 로그로 남겨 수동 정리할 수 있게 한다.
    const storageTargets: { bucket: string; prefix: string }[] = [
      { bucket: 'avatars',      prefix: userId },
      { bucket: 'event-images', prefix: userId },
      ...ownedSpaceIds.map((id) => ({ bucket: 'avatars', prefix: `space-covers/${id}` })),
    ];
    for (const { bucket, prefix } of storageTargets) {
      try {
        await removeStoragePrefix(adminClient, bucket, prefix);
      } catch (storageErr) {
        await logToDb('delete-account.storage', storageErr, { userId, bucket, prefix });
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
