/**
 * account-merge-execute Edge Function (Phase C / ADR-010)
 *
 * 두 계정(primary, secondary)을 병합한다.
 *  1) merge_account RPC (security definer) 로 secondary 의 모든 데이터를 primary 로
 *     이전 + secondary 의 public.users 행 삭제. (마이그레이션 056)
 *  2) 그 후 service_role 로 secondary 의 auth.users 를 삭제 (RPC 가 못 하는 부분).
 *
 * 보안:
 *  - 호출자 JWT 검증. RPC 가 "호출자가 두 계정 중 하나 소유 + 이메일 동일" 을
 *    재검증하므로 이중 안전.
 *  - secondary 가 Pro 인데 primary 가 free 면 RPC 가 거부 (구독 유실 방지).
 *
 * Called by: src/services/authService.ts → mergeAccount()
 *
 * Env (Supabase Dashboard → Functions → Secrets):
 *  - SUPABASE_URL              (auto)
 *  - SUPABASE_SERVICE_ROLE_KEY (manual)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-expect-error: Deno 상대 경로 import — tsc 는 해석 못하지만 배포 시 정상
import { logToDb } from '../_shared/logger.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // ── 1. JWT 검증 ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: '인증 토큰이 필요합니다.' }, 401);
    }
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      await logToDb('account-merge.auth', authError ?? new Error('no user'));
      return json({ error: '유효하지 않은 인증 토큰입니다.' }, 401);
    }

    // ── 2. 입력 파싱 ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const primary = body?.primary as string | undefined;
    const secondary = body?.secondary as string | undefined;
    // 겹치는 일정 처리 정책 — 'keep_both'(기본) | 'dedupe'.
    const conflictPolicy = (body?.conflictPolicy as string | undefined) ?? 'keep_both';
    if (!primary || !secondary) {
      return json({ error: 'primary 와 secondary 가 필요합니다.' }, 400);
    }
    if (conflictPolicy !== 'keep_both' && conflictPolicy !== 'dedupe') {
      return json({ error: '잘못된 충돌 정책입니다.' }, 400);
    }
    // 호출자는 둘 중 하나여야 함 (Edge 1차 방어 — RPC 가 재검증).
    if (user.id !== primary && user.id !== secondary) {
      return json({ error: '본인 계정만 병합할 수 있습니다.' }, 403);
    }

    // ── 3. 데이터 병합 (RPC) — 호출자 컨텍스트로 실행해 auth.uid() 보장 ───────
    //   RPC 는 security definer 지만 auth.uid() 로 호출자를 확인하므로,
    //   사용자 토큰을 가진 클라이언트로 호출해야 한다.
    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: mergeResult, error: mergeError } = await userClient.rpc('merge_account', {
      p_primary: primary,
      p_secondary: secondary,
      p_conflict_policy: conflictPolicy,
    });
    if (mergeError) {
      await logToDb('account-merge.rpc', mergeError, { primary, secondary, policy: conflictPolicy, caller: user.id });
      return json({ error: mergeError.message ?? '병합에 실패했습니다.' }, 400);
    }

    // ── 4. secondary auth.users 삭제 (RPC 가 못 하는 부분) ────────────────────
    const { error: delError } = await admin.auth.admin.deleteUser(secondary);
    if (delError) {
      // 데이터는 이미 이전됨. auth 행만 남은 상태 → 운영자 정리 가능하게 로깅.
      await logToDb('account-merge.delete-secondary-auth', delError, { secondary });
      // 사용자에겐 성공으로 처리 (데이터 병합은 완료됨).
    }

    console.log(`account-merge: ${secondary} → ${primary} merged (caller ${user.id})`);
    return json({ success: true, ...(mergeResult as object) }, 200);

  } catch (err) {
    await logToDb('account-merge.unexpected', err);
    return json({ error: '서버 오류가 발생했습니다.' }, 500);
  }
});
