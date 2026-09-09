/**
 * serviceAuth — pg_cron·서버 전용 Edge Function 의 호출자 검증.
 *
 * ## 왜 필요한가 (2026-09-09 실측)
 *
 * `verify_jwt = true` 는 **호출자가 우리 사용자임을 보장하지 않는다.**
 * anon(publishable) 키도 그 게이트를 통과한다 — 프로젝트가 서명한 정상 JWT 이고,
 * 다만 `sub`(사용자 id)가 없을 뿐이다. 그리고 그 키는 **앱 바이너리와 웹 번들에
 * 박혀 있어 누구나 꺼낼 수 있다.**
 *
 * 실측으로 확인한 것:
 * ```
 * GET /functions/v1/send-web-push                      → 401 UNAUTHORIZED_NO_AUTH_HEADER (플랫폼이 막음)
 * GET /functions/v1/send-web-push  + anon 키           → 405 method not allowed          (함수 코드까지 도달)
 * ```
 * 즉 **anon 키만 있으면 함수 본문이 실행된다.** 서버 전용 함수가 여기에 기대고
 * 있으면 누구나 부를 수 있다는 뜻이다.
 *
 * ⚠️ 그래서 "verify_jwt 가 켜져 있으니 안전하다"는 주석을 믿지 말 것.
 *    `send-web-push` 에 실제로 그런 주석이 있었고, 코드엔 검증이 없었다.
 *
 * ## 언제 쓰나
 *
 * **사용자가 직접 부르지 않는 함수** — pg_cron 배치, 서버 간 호출 — 에만 쓴다.
 * 사용자용 함수는 이게 아니라 `auth.getUser()` 로 사용자를 특정해야 한다
 * (그래야 quota 도 사람 단위로 걸린다).
 *
 * pg_cron 은 `Authorization: Bearer <service_role key>` 로 호출하므로
 * 이 검증을 통과한다 — `reactivation-push` 가 같은 방식으로 이미 돌고 있다.
 */

/**
 * 두 문자열을 **길이·내용 노출 없이** 비교한다.
 *
 * 왜 단순 `===` 가 아닌가: 문자열 비교는 첫 불일치에서 즉시 끝나므로, 응답
 * 시간을 재면 앞에서 몇 글자가 맞았는지 새어 나간다(타이밍 공격). 키를 한
 * 글자씩 알아내는 데 쓰일 수 있어 상수 시간으로 비교한다.
 *
 * @param a 비교 대상 1
 * @param b 비교 대상 2
 * @returns 완전히 같으면 true
 */
function timingSafeEqual(a: string, b: string): boolean {
  // 길이가 다르면 어차피 불일치지만, 여기서 바로 반환해도 새는 정보는
  // "길이가 다르다"뿐이라 안전하다. 길이가 같을 때만 상수 시간이 의미가 있다.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // XOR 누적 — 중간에 빠져나가지 않으므로 항상 같은 시간이 걸린다.
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 요청이 service_role 키를 들고 왔는지 검증한다.
 *
 * @param req 들어온 요청
 * @returns 통과하면 `null`, 아니면 **그대로 반환해야 할** 401 Response
 *
 * @example
 * ```ts
 * Deno.serve(async (req) => {
 *   const denied = requireServiceRole(req);
 *   if (denied) return denied;      // 🔴 반드시 조기 반환할 것
 *   // ... 여기부터 서버 전용 로직
 * });
 * ```
 *
 * ⚠️ 반환값을 무시하면 검증이 없는 것과 같다. `if (denied) return denied;`
 *    한 줄을 빠뜨리는 게 이 함수의 유일한 오용 경로다.
 */
export function requireServiceRole(req: Request): Response | null {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // 키가 주입되지 않은 상태에서 통과시키면 **검증이 통째로 무력화된다**.
  // 빈 문자열끼리 비교해 우연히 참이 되는 사고를 막으려고 먼저 끊는다.
  if (serviceKey.length === 0) {
    return new Response(
      JSON.stringify({ error: 'service_key_not_configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  // `Bearer ` 접두사를 떼고 정확히 비교한다. 기존 코드처럼 `includes()` 로
  // 부분 일치를 보면 키가 다른 문자열에 섞여 들어와도 통과한다.
  const presented = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : authHeader.trim();

  if (!timingSafeEqual(presented, serviceKey)) {
    return new Response(
      JSON.stringify({ error: 'service_role_required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return null;
}
