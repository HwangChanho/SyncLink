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
  'dispatch-notifications': 'DISPATCH_SECRET 직접 대조 (⚠️ fail-open — 아래 KNOWN_FAIL_OPEN 참고)',
  'weekly-review-batch':    'WEEKLY_REVIEW_SECRET 직접 대조 (⚠️ fail-open — 아래 KNOWN_FAIL_OPEN 참고)',
};

/**
 * 🔴 **이미 알고 있는 fail-open 결함** (2026-09-12 발견, LEAD 판단 대기).
 *
 * 두 함수 모두 시크릿 환경변수가 **비어 있으면 통과**한다:
 *   - `dispatch-notifications`: `if (dispatchSecret) { ...검사... }` — 비면 검사 자체를 건너뛴다
 *   - `weekly-review-batch`:    `expected = 'Bearer ' + (secret ?? '')` — 비면
 *                               `Authorization: Bearer ` 로 통과한다
 * 둘 다 `verify_jwt = false` 라 게이트웨이 방어선도 없다.
 *
 * `_shared/serviceAuth.ts` 의 `requireSharedSecret` 은 이 문제를 고치려고 만든
 * fail-closed 구현이다(시크릿이 없으면 500). 두 함수를 그리로 옮기면 이 목록을
 * 비울 수 있다 — 그때 아래 테스트가 "목록을 갱신하라"고 알려 준다.
 */
const KNOWN_FAIL_OPEN = ['dispatch-notifications', 'weekly-review-batch'];

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

  it('B-3. 알려진 fail-open 목록이 실제와 일치한다', () => {
    // 고쳐서 requireSharedSecret 으로 옮겼는데 목록에 그대로 남아 있으면,
    // 다음 사람이 "아직 결함"이라고 잘못 읽는다. 양방향으로 잠근다.
    const stillFailOpen = KNOWN_FAIL_OPEN.filter(
      (name) => !guardsOf(name).includes('requireSharedSecret'),
    );
    expect(stillFailOpen).toEqual(KNOWN_FAIL_OPEN);
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
