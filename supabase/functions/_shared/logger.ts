/**
 * Edge Function 공통 에러 로거.
 *
 * 모든 Edge Function의 실패 지점에서 호출해 `error_logs` 테이블에
 * 기록한다. 클라이언트의 logError와 동일한 테이블을 공유하므로
 * LEAD가 한 번의 SQL로 서버/클라이언트 에러를 모두 확인 가능.
 *
 * 사용 예:
 *   try { ... }
 *   catch (err) {
 *     await logToDb('kakao-auth.token-exchange', err, { kakaoResponse });
 *     throw err;
 *   }
 *
 * 설계 원칙:
 *  - service_role 키로 INSERT하므로 RLS와 무관하게 항상 성공해야 함
 *  - 로깅 실패 자체는 삼켜 Edge Function의 본래 응답에는 영향 없도록
 *  - Edge Function 런타임은 Deno이므로 클라이언트 로거와 파일 분리
 */

// @ts-expect-error: Deno 원격 import — tsc는 이해하지 못하지만 배포 시 해석됨
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(key: string): string | undefined } };

/**
 * 에러를 DB에 기록한다. 절대 throw하지 않음.
 *
 * @param context 발생 위치 (예: 'kakao-auth.user-fetch')
 * @param error   Error 객체 또는 임의의 값
 * @param details stack 외에 남기고 싶은 정보 (request/response 스냅샷 등)
 */
export async function logToDb(
  context: string,
  error: unknown,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabaseUrl    = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    // 환경변수 누락 시에도 함수 로직은 계속 동작해야 하므로 조용히 return
    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${context}] logToDb: SUPABASE env 미설정`, error);
      return;
    }

    // service_role 클라이언트 — RLS를 우회해 확실히 INSERT 되도록
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Build-92 — PostgrestError / supabase-js 의 plain object error 도
    // message/code 추출 (instanceof Error 못 잡음). 이전엔 "[object Object]"
    // 만 저장돼 root cause 추적 불가했음.
    let message: string;
    let stack: string | undefined;
    if (error instanceof Error) {
      message = error.message;
      stack   = error.stack;
    } else if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      const msg  = typeof e.message === 'string' ? e.message : '';
      const code = e.code ? ` [${e.code}]` : '';
      message = msg ? `${msg}${code}` : JSON.stringify(error).slice(0, 500);
      // PostgrestError 의 부가 정보를 details 에 보존
      if (!details) details = {};
      details = {
        ...details,
        pgCode:    e.code    ?? null,
        pgDetails: e.details ?? null,
        pgHint:    e.hint    ?? null,
      };
    } else {
      message = String(error);
    }

    await admin.from('error_logs').insert({
      context,
      severity:    'error',
      // 길이 제한: 극단적으로 긴 응답 본문이 들어와도 안전
      message:     message.slice(0, 2000),
      details:     { ...(details ?? {}), stack },
      platform:    'edge-function',
    });
  } catch (logErr) {
    // 로깅 자체가 실패해도 원 요청 처리에는 영향 없도록 흡수
    console.error('[logger] DB 기록 실패:', logErr);
  }

  // 콘솔에도 항상 출력 → supabase functions logs 로 확인 가능
  console.error(`[${context}]`, error);
}
