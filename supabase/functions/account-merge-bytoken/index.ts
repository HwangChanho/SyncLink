/**
 * account-merge-bytoken Edge Function (통합 로그인 재설계 / 2026-06-05).
 *
 * 사용자가 A 로그인 상태에서 [통합 로그인]으로 다른 내 계정 B 에 재로그인해 얻은
 * 두 access_token(A·B)을 받아 '둘 다 본인 소유'임을 증명한 뒤 단일 계정으로 통합한다.
 *
 *  1) aToken·bToken 을 각각 auth.getUser 로 검증 → userA·userB 확보.
 *     ⚠️ 이 양토큰 검증이 이 기능의 보안 근간이다. 한쪽 토큰만으로 임의 계정을
 *        흡수하는 것을 원천 차단한다. (058 의 same-email 체크를 대체.)
 *  2) primary 선정 = Pro 우선(구독 보존). 둘 다 동일 등급이면 현재 세션(A) 우선.
 *  3) dryRun=true 면 merge_preview_v2 로 건수만 반환(미리보기). 변경 없음.
 *  4) 아니면 merge_account_v2(service_role) 로 secondary 데이터+identity 를 primary 로
 *     이전 + secondary public.users 삭제 → 이어서 admin API 로 secondary auth.users 삭제.
 *
 * 보안:
 *  - 토큰은 검증 용도로만 사용하고 절대 로깅하지 않는다.
 *  - 두 토큰이 같은 user 면(같은 계정) 거부.
 *
 * Called by: src/services/authService.ts → mergeAccountByToken()
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 1. 입력 파싱 ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    // A 토큰은 본문 우선, 없으면 표준 Authorization 헤더(현재 세션)에서.
    const headerToken = req.headers.get('Authorization')?.replace('Bearer ', '');
    const aToken = (body?.aToken as string | undefined) ?? headerToken;
    const bToken = body?.bToken as string | undefined;
    const conflictPolicy = (body?.policy as string | undefined) ?? 'keep_both';
    const dryRun = body?.dryRun === true;

    if (!aToken || !bToken) {
      return json({ error: '두 계정의 인증 토큰이 모두 필요합니다.' }, 400);
    }
    if (conflictPolicy !== 'keep_both' && conflictPolicy !== 'dedupe') {
      return json({ error: '잘못된 충돌 정책입니다.' }, 400);
    }

    // ── 2. 양토큰 검증 — 보안 근간 ───────────────────────────────────────────
    //   두 토큰을 각각 검증해 둘 다 유효한 본인 세션임을 확인한다.
    const [{ data: aData, error: aErr }, { data: bData, error: bErr }] = await Promise.all([
      admin.auth.getUser(aToken),
      admin.auth.getUser(bToken),
    ]);
    if (aErr || !aData?.user) {
      await logToDb('merge-bytoken.auth-a', aErr ?? new Error('no user A'));
      return json({ error: '현재 계정 인증이 만료되었습니다. 다시 시도해주세요.' }, 401);
    }
    if (bErr || !bData?.user) {
      await logToDb('merge-bytoken.auth-b', bErr ?? new Error('no user B'));
      return json({ error: '통합할 계정 로그인이 유효하지 않습니다.' }, 401);
    }
    const userA = aData.user;
    const userB = bData.user;
    if (userA.id === userB.id) {
      return json({ error: '이미 같은 계정입니다.', sameAccount: true }, 409);
    }

    // ── 3. primary 선정 — Pro 우선, 동률이면 현재 세션(A) ────────────────────
    const { data: plans, error: planErr } = await admin
      .from('users')
      .select('id, subscription_plan')
      .in('id', [userA.id, userB.id]);
    if (planErr) {
      await logToDb('merge-bytoken.plans', planErr, { a: userA.id, b: userB.id });
      return json({ error: '계정 정보를 불러오지 못했습니다.' }, 500);
    }
    const planOf = (id: string) =>
      (plans?.find((r) => r.id === id)?.subscription_plan ?? 'free') as string;
    const aPro = planOf(userA.id) === 'pro';
    const bPro = planOf(userB.id) === 'pro';
    // B 가 Pro 이고 A 는 아니면 B 가 primary, 그 외(둘 다 Pro/둘 다 free/A 만 Pro)는 A 가 primary.
    const primary = bPro && !aPro ? userB.id : userA.id;
    const secondary = primary === userA.id ? userB.id : userA.id;

    // ── 4. dryRun: 미리보기만 ────────────────────────────────────────────────
    if (dryRun) {
      const { data: preview, error: pvErr } = await admin.rpc('merge_preview_v2', {
        p_primary: primary,
        p_secondary: secondary,
      });
      if (pvErr) {
        await logToDb('merge-bytoken.preview', pvErr, { primary, secondary });
        return json({ error: pvErr.message ?? '미리보기에 실패했습니다.' }, 400);
      }
      return json({
        success: true,
        dryRun: true,
        primary,
        secondary,
        primaryIsCurrent: primary === userA.id, // A(현재 세션)가 primary 인지
        ...(preview as object),
      }, 200);
    }

    // ── 5. 병합 실행 (service_role) ──────────────────────────────────────────
    const { data: mergeResult, error: mergeError } = await admin.rpc('merge_account_v2', {
      p_primary: primary,
      p_secondary: secondary,
      p_conflict_policy: conflictPolicy,
    });
    if (mergeError) {
      await logToDb('merge-bytoken.rpc', mergeError, { primary, secondary, policy: conflictPolicy });
      return json({ error: mergeError.message ?? '통합에 실패했습니다.' }, 400);
    }

    // ── 6. secondary auth.users 삭제 (RPC 가 못 하는 부분) ────────────────────
    //   identity 는 v2 RPC 가 이미 primary 로 옮겼으므로, 여기선 빈 auth 유저만 정리.
    const { error: delError } = await admin.auth.admin.deleteUser(secondary);
    if (delError) {
      // 데이터/identity 는 이미 이전됨. auth 행만 잔존 → 운영 정리 가능하게 로깅(성공 처리).
      await logToDb('merge-bytoken.delete-secondary-auth', delError, { secondary });
    }

    console.log(`merge-bytoken: ${secondary} → ${primary} merged`);
    return json({
      success: true,
      primary,
      secondary,
      primaryIsCurrent: primary === userA.id,
      ...(mergeResult as object),
    }, 200);

  } catch (err) {
    await logToDb('merge-bytoken.unexpected', err);
    return json({ error: '서버 오류가 발생했습니다.' }, 500);
  }
});
