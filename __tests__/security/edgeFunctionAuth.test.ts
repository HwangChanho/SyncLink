/**
 * Edge Function 호출자 인증 정합성 회귀 방지 (2026-09-12).
 *
 * ## 왜 이 스위트가 필요한가
 *
 * Edge Function 의 인증은 **두 곳이 맞물려야** 성립하는데, 한쪽만 바뀌어도
 * 런타임에 에러가 안 나서 조용히 새어나간다. 실제로 세 번 당했다:
 *
 *  1. `dispatch-notifications` — config.toml 항목이 없어 게이트웨이가 핸들러 앞에서
 *     401 을 냈다. **알림 발송이 통째로 멈춰 있었다**(6시간에 401 360건).
 *  2. `reactivation-push` — 대시보드에서 `verify_jwt=false` 로 돌던 함수를 CLI 로
 *     재배포하자 **기본값(true)으로 되돌아갔다.** config.toml 에 항목이 없어서다.
 *  3. `sync-google-calendar` — cron 브랜치에 **호출자 검증이 한 줄도 없었다.**
 *     "verify_jwt 가 막아 준다"고 주석에 적혀 있었지만, 그 게이트는 **anon 키를
 *     통과시킨다**(anon 키는 앱 번들·웹 번들에 박혀 있어 누구나 꺼낸다).
 *
 * 🔑 세 번 다 **배포 전에는 아무 신호가 없었다.** 그래서 소스 대조로 잠근다.
 *    상세 배경 → `supabase/functions/_shared/serviceAuth.ts`
 *
 * ## 무엇을 검사하나
 *
 *  A. 공유 시크릿(`requireSharedSecret`)을 쓰는 함수는 config.toml 에
 *     `verify_jwt = false` 가 **반드시** 있어야 한다 (고정 시크릿은 JWT 가 아니라
 *     게이트웨이가 핸들러 앞에서 막는다 → 위 사고 1·2)
 *  B. `verify_jwt = false` 인 함수는 **자체 가드가 반드시 있어야 한다.**
 *     게이트웨이를 껐는데 가드가 없으면 그 함수는 완전 공개다 (위 사고 3)
 *  C. cron 이 부르는 함수가 응답에 **사용자 식별자를 싣지 않는다**
 *  D. cron 마이그레이션이 **존재하는 Vault 시크릿**을 참조하고, 없으면 실패한다
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const FUNCTIONS_DIR = path.join(ROOT, 'supabase', 'functions');

const read = (abs: string) => readFileSync(abs, 'utf8');

/** `supabase/functions/<name>/index.ts` 가 있는 함수 이름 전부. */
function functionNames(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((name) => existsSync(path.join(FUNCTIONS_DIR, name, 'index.ts')))
    .sort();
}

const source = (name: string) => read(path.join(FUNCTIONS_DIR, name, 'index.ts'));

/**
 * config.toml 에서 `verify_jwt = false` 로 선언된 함수 이름 집합.
 *
 * 주석(`#`)은 제거하고 파싱한다 — 주석 안의 `verify_jwt = false` 를 설정으로
 * 오인하면 "항목이 있다"는 잘못된 통과가 난다.
 */
function verifyJwtDisabled(): Set<string> {
  const toml = read(path.join(ROOT, 'supabase', 'config.toml'))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  const out = new Set<string>();
  // 🔑 섹션은 **정규식 lookahead 가 아니라 split 으로** 자른다. 처음엔
  //    `(?=^\[|\Z)` 로 썼는데 `\Z` 는 JS 에 없는 문법(Python 것)이라 리터럴 'Z' 로
  //    해석됐고, **파일의 마지막 섹션이 통째로 안 잡혔다.** 그 버그가 있는 채로는
  //    "가장 최근에 추가한 함수"가 늘 검사에서 빠진다 — 정확히 잡고 싶은 대상이다.
  for (const chunk of toml.split(/^\[/m).slice(1)) {
    const m = chunk.match(/^functions\.([a-z0-9-]+)\]/);
    if (!m) continue;
    if (/verify_jwt\s*=\s*false/.test(chunk)) out.add(m[1]);
  }
  return out;
}

/**
 * 함수가 **자체 호출자 검증**을 하고 있는지 — 수단별로 나눠서 본다.
 *
 * ⚠️ "시크릿 문자열이 파일에 있다"는 근거가 못 된다. `dispatch-notifications` 는
 *    `if (secret) { ...검사... }` 형태라 **환경변수가 비면 검사를 통째로 건너뛴다**
 *    (fail-open). 그래서 호출 형태를 본다.
 */
function guardsOf(name: string): string[] {
  const src = source(name);
  const found: string[] = [];
  if (src.includes('requireSharedSecret(')) found.push('requireSharedSecret');
  if (src.includes('requireServiceRole('))  found.push('requireServiceRole');
  if (src.includes('auth.getUser('))        found.push('auth.getUser');
  return found;
}

/**
 * 공용 헬퍼를 쓰지 않고 **자체 방식**으로 호출자를 검증하는 함수들.
 *
 * 🔑 여기에 이름을 올리는 것은 "검증이 없어도 된다"는 뜻이 아니라 **"공용 헬퍼가
 *    아닌 다른 수단으로 검증한다"**는 선언이다. 새 함수에 `verify_jwt = false` 를
 *    달면 이 목록에 넣거나 공용 가드를 쓰거나 둘 중 하나를 **의식적으로** 고르게 된다.
 */
const CUSTOM_GUARD: Record<string, string> = {
  'kakao-auth':          'Kakao OAuth 콜백 — KAKAO_REST_API_KEY 로 키를 건 SHA-256 password derivation',
  'reward-credit':       'AdMob SSV — Google 공개키로 쿼리스트링 ECDSA 서명 검증',
  'revenuecat-webhook':  'RevenueCat 대시보드에 설정된 고정 시크릿 헤더 대조',
};

/**
 * 호출자 인증용 시크릿을 **공용 헬퍼 없이 환경변수에서 직접 읽어도 되는** 함수.
 * 값은 "fail-closed 임을 소스에서 확인할 수 있는 코드 조각"이다.
 *
 * ## 왜 이 목록이 필요한가 (2026-09-13)
 *
 * `dispatch-notifications`·`weekly-review-batch` 가 시크릿을 직접 읽다가 둘 다
 * **fail-open** 이었다 — 환경변수가 비면 검사를 건너뛰거나(`if (secret) {...}`),
 * 기대값이 `"Bearer "` 로 쪼그라들어 빈 토큰이 통과했다. 둘 다 verify_jwt=false 라
 * 게이트웨이 방어선도 없었다. `requireSharedSecret`(fail-closed)으로 옮겨 고쳤다.
 *
 * 🔑 같은 모양이 **새 함수에서 다시 생기는 것**을 막으려고, 직접 읽기를 기본 금지로
 *    뒤집었다. 여기에 올리려면 "비었을 때 막는 코드"를 증거로 같이 적어야 한다.
 */
const DIRECT_SECRET_FAIL_CLOSED: Record<string, string> = {
  // 미설정이면 logToDb 후 500 'server misconfigured'
  'revenuecat-webhook': 'if (!expected)',
};

/**
 * 이름에 SECRET 이 들어가지만 **호출자 인증에 쓰지 않는** 환경변수.
 * (OAuth 클라이언트 자격증명처럼 우리가 외부에 내미는 값)
 */
const NON_CALLER_AUTH_SECRETS = new Set(['GOOGLE_OAUTH_CLIENT_SECRET']);

/** 함수 소스에서 `Deno.env.get('..SECRET..')` 로 직접 읽는 환경변수 이름들. */
function directSecretReads(name: string): string[] {
  const names = [...source(name).matchAll(/Deno\.env\.get\(\s*'([A-Z0-9_]*SECRET[A-Z0-9_]*)'\s*\)/g)]
    .map((m) => m[1]);
  return names.filter((n) => !NON_CALLER_AUTH_SECRETS.has(n));
}

describe('Edge Function 호출자 인증', () => {
  const disabled = verifyJwtDisabled();

  // ── A. 공유 시크릿을 쓰면 게이트웨이 검증은 반드시 꺼져 있어야 한다 ──────
  it('A. requireSharedSecret 을 쓰는 함수는 config.toml 에 verify_jwt = false 가 있다', () => {
    const missing = functionNames()
      .filter((name) => guardsOf(name).includes('requireSharedSecret'))
      .filter((name) => !disabled.has(name));

    // 고정 시크릿은 JWT 가 아니라 게이트웨이가 UNAUTHORIZED_INVALID_JWT_FORMAT 으로
    // 핸들러 앞에서 막는다 — 항목이 빠지면 그 cron 은 **통째로 멈춘다**.
    expect(missing).toEqual([]);
  });

  // ── B. 게이트웨이를 껐으면 자체 가드가 반드시 있어야 한다 ────────────────
  it('B. verify_jwt = false 인 함수는 전부 자체 호출자 검증이 있다', () => {
    const unguarded = [...disabled]
      .filter((name) => existsSync(path.join(FUNCTIONS_DIR, name, 'index.ts')))
      .filter((name) => guardsOf(name).length === 0 && !(name in CUSTOM_GUARD));

    // 여기에 이름이 뜨면 그 함수는 **누구나 부를 수 있는 상태**다.
    expect(unguarded).toEqual([]);
  });

  it('B-2. config.toml 의 verify_jwt 항목은 실재하는 함수를 가리킨다', () => {
    const ghosts = [...disabled].filter(
      (name) => !existsSync(path.join(FUNCTIONS_DIR, name, 'index.ts')),
    );
    // 함수를 지우고 config 항목만 남으면, 이름이 비슷한 새 함수가 의도치 않게
    // 검증 없이 배포될 수 있다.
    expect(ghosts).toEqual([]);
  });

  it('B-3. 호출자 시크릿을 직접 읽는 함수는 fail-closed 가 확인된 것뿐이다', () => {
    // 🔴 직접 읽으면 "비었을 때"를 각자 처리해야 하고, 실제로 두 번 빠뜨렸다
    //    (dispatch-notifications·weekly-review-batch → 09-13 에 requireSharedSecret 으로 이전).
    //    새 함수는 공용 가드를 쓰거나, 목록에 fail-closed 증거와 함께 올려야 한다.
    const offenders = functionNames()
      .filter((name) => directSecretReads(name).length > 0)
      .filter((name) => !(name in DIRECT_SECRET_FAIL_CLOSED))
      .map((name) => `${name}: ${directSecretReads(name).join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('B-4. 직접 읽기 허용 목록의 fail-closed 증거가 소스에 실제로 있다', () => {
    // 증거 코드가 지워졌는데 목록만 남으면 "안전하다"는 선언이 거짓이 된다.
    // 목록에 올라 있는데 더 이상 직접 읽지 않는 함수도 잡는다(유령 항목).
    for (const [name, evidence] of Object.entries(DIRECT_SECRET_FAIL_CLOSED)) {
      expect({ name, readsDirectly: directSecretReads(name).length > 0 })
        .toEqual({ name, readsDirectly: true });
      expect({ name, hasEvidence: source(name).includes(evidence) })
        .toEqual({ name, hasEvidence: true });
    }
  });

  // ── B-5. 09-13 에 fail-open 을 고친 두 cron 함수 ─────────────────────────
  describe.each([
    // [함수, 환경변수, 가드보다 뒤에 와야 하는 부작용 코드 조각들]
    ['dispatch-notifications', 'DISPATCH_SECRET',      ['createClient(', "from('notifications_queue')"]],
    ['weekly-review-batch',    'WEEKLY_REVIEW_SECRET', ['createClient(', "Deno.env.get('ANTHROPIC_API_KEY')"]],
  ] as const)('B-5. %s', (name, envName, sideEffects) => {
    const src = source(name);
    const guardCall = `requireSharedSecret(req, '${envName}')`;

    it('fail-closed 공용 가드로 호출자를 검증하고 결과를 조기 반환한다', () => {
      // 🔴 반환값을 버리면 검증이 없는 것과 같다 — serviceAuth.ts 의 유일한 오용 경로.
      const pattern = new RegExp(
        `const denied = requireSharedSecret\\(req, '${envName}'\\);\\s*\\n\\s*if \\(denied\\) return denied;`,
      );
      expect(src).toMatch(pattern);
    });

    it('공유 시크릿을 쓰므로 config.toml 에 verify_jwt = false 가 있다', () => {
      // 없으면 게이트웨이가 비JWT 시크릿을 핸들러 앞에서 401 로 막아 cron 이 멈춘다.
      expect(disabled.has(name)).toBe(true);
    });

    it('가드가 DB 접근·외부 호출보다 먼저 온다', () => {
      const guardAt = src.indexOf(guardCall);
      expect(guardAt).toBeGreaterThan(-1);
      for (const marker of sideEffects) {
        const at = src.indexOf(marker);
        // 표식이 사라지면 이 검사가 조용히 무의미해지므로 존재부터 확인한다.
        expect({ marker, found: at > -1 }).toEqual({ marker, found: true });
        expect({ marker, guardFirst: guardAt < at }).toEqual({ marker, guardFirst: true });
      }
    });
  });

  // ── C. sync-google-calendar — 이번에 고친 것 ────────────────────────────
  describe('C. sync-google-calendar', () => {
    const src = source('sync-google-calendar');

    it('cron 브랜치가 공유 시크릿으로 호출자를 검증한다', () => {
      expect(src).toContain("requireSharedSecret(req, 'GCAL_SYNC_SECRET')");
      // 🔴 반환값을 조기 반환하지 않으면 검증이 없는 것과 같다 —
      //    serviceAuth.ts 가 경고하는 유일한 오용 경로다.
      expect(src).toMatch(/const denied = requireSharedSecret\(req, 'GCAL_SYNC_SECRET'\);\s*\n\s*if \(denied\) return denied;/);
    });

    it('가드가 cron 처리보다 먼저 온다', () => {
      const guardAt = src.indexOf("requireSharedSecret(req, 'GCAL_SYNC_SECRET')");
      const queryAt = src.indexOf("from('google_oauth_tokens').select('user_id')");
      expect(guardAt).toBeGreaterThan(-1);
      expect(queryAt).toBeGreaterThan(-1);
      // 가드 뒤에서 연결 목록을 읽어야 한다. 순서가 뒤집히면 검증 전에 조회한다.
      expect(guardAt).toBeLessThan(queryAt);
    });

    it('cron 응답에 사용자 식별자를 싣지 않는다', () => {
      // 예전엔 `results.push({ user_id: c.user_id, ...r })` 로 **전체 연결 사용자의
      // UUID** 가 응답에 실려 나갔다. 그 본문은 net._http_response 에도 남는다.
      expect(src).not.toContain('user_id: c.user_id');
      const cronResponse = src.slice(
        src.indexOf("if (mode === 'cron')"),
        src.indexOf('// manual mode'),
      );
      expect(cronResponse).toContain('connections: connections?.length ?? 0');
      expect(cronResponse).not.toMatch(/results\s*[,:}]/);
    });
  });

  // ── D. cron 마이그레이션 ────────────────────────────────────────────────
  describe('D. 074 cron 마이그레이션', () => {
    const sqlRaw = read(path.join(ROOT, 'supabase', 'migrations', '074_sync_google_calendar_cron_auth.sql'));
    // 🔑 **실행되는 SQL 만** 본다. 주석에는 옛 시크릿 이름이 설명으로 등장하므로
    //    원문 그대로 검사하면 "아직 service_role_jwt 를 쓴다"는 오탐이 난다.
    const sql = sqlRaw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

    it('존재하는 Vault 시크릿을 참조한다', () => {
      // 045 는 **등록된 적 없는** `service_role_jwt` 를 읽었고, 없는 이름은 NULL 을
      // 반환해 `'Bearer ' || NULL` = NULL → Authorization 헤더가 통째로 빠졌다.
      expect(sql).toContain("name = 'gcal_sync_secret'");
      expect(sql).not.toContain('service_role_jwt');
    });

    it('시크릿이 없으면 조용히 넘어가지 않고 실패한다', () => {
      // 🔴 045 의 진짜 결함은 인증 방식이 아니라 "없어도 돌아간다"였다.
      expect(sql).toMatch(/raise exception/i);
      expect(sql).toContain("where name = 'gcal_sync_secret'");
    });

    it('함수를 cron mode 로 부른다', () => {
      expect(sql).toContain("jsonb_build_object('mode', 'cron')");
      expect(sql).toContain('/functions/v1/sync-google-calendar');
    });
  });
});
