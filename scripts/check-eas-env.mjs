#!/usr/bin/env node
/**
 * EAS 환경변수 누락 점검 — "코드는 읽는데 빌드에는 없는" EXPO_PUBLIC_* 를 찾는다.
 *
 * ▸ 왜 필요한가 (2026-08-19, 실제 사고)
 *   eas.json 의 production 프로파일에 `"environment": "production"` 이 있으면
 *   EAS 는 **로컬 .env 를 무시하고** EAS 서버에 등록된 환경변수만 쓴다.
 *   2026-08-15 카카오 네이티브 SDK 전환 때 EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY 를
 *   .env 에만 넣고 EAS 환경에 등록하지 않았다 → Android 스토어 빌드(vc22)에서
 *   값이 undefined 라 SDK 초기화가 통째로 스킵됐고, 카카오 로그인 시 네이티브
 *   예외로 **앱이 강제종료**됐다(Sentry SYNKLINK-19).
 *   iOS 는 fastlane 이 .env 를 읽으므로 멀쩡해서, 한쪽만 깨진 걸 알아채기 어려웠다.
 *
 * ▸ 무엇을 검사하나
 *   src/ 가 실제로 참조하는 process.env.EXPO_PUBLIC_* 이름을 모아
 *   `eas env:list production` 에 있는지 대조한다. 코드가 안 읽는 변수는
 *   빠져 있어도 무해하므로 보지 않는다(예: E2E 전용 값).
 *
 * ▸ 종료 코드
 *   0 = 이상 없음 / 조회 불가(네트워크·인증). 조회에 실패했다고 빌드를 막지는
 *       않는다 — 점검 실패로 릴리스가 멈추는 편이 더 해롭다. 대신 크게 경고한다.
 *   1 = 코드가 읽는 변수가 EAS 환경에 없음. 그대로 빌드하면 조용히 깨진다.
 *
 * 사용: node scripts/check-eas-env.mjs [환경이름=production]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENVIRONMENT = process.argv[2] ?? 'production';

/**
 * EAS 환경에 **일부러** 두지 않는 변수들 — 값이 없을 때의 동작이 코드에 명시돼
 * 있고, 그 동작이 프로덕션에서 옳은 것만 넣는다.
 *
 * 🔴 여기에 새 이름을 추가하기 전에 반드시 "없으면 무슨 일이 일어나는가"를 코드로
 *    확인할 것. 확인 없이 추가하면 이 점검은 그저 경고를 지우는 장치가 된다 —
 *    2026-08-15 카카오 키처럼 조용히 깨지는 걸 잡으라고 만든 스크립트다.
 */
const INTENTIONALLY_UNSET = {
  EXPO_PUBLIC_E2E_PASSWORD:
    '개발용 로그인 단축키. 미설정이면 버튼 자체가 사라진다(auth/login.tsx) — 프로덕션에 있으면 오히려 문제',
  EXPO_PUBLIC_INVITE_LINK_BASE:
    '초대링크를 커스텀 스킴으로 되돌리는 비상 스위치. 미설정이 기본이고 space/[id].tsx 가 ?? 로 정상값을 쓴다',
  EXPO_PUBLIC_RC_API_KEY_ANDROID:
    'Android 인앱결제 미도입이라 키를 발급하지 않았다. 빈 값이면 initializePurchases 가 초기화를 건너뛰고 plan 을 DB 로만 판단한다(purchaseService.ts)',
};
const SRC_DIR = 'src';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * src/ 를 재귀 순회하며 코드가 참조하는 EXPO_PUBLIC_* 이름을 수집한다.
 * @param {string} dir 순회 시작 디렉토리
 * @param {Set<string>} found 누적 집합
 * @returns {Set<string>} 참조된 환경변수 이름 집합
 */
function collectReferencedVars(dir, found = new Set()) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { collectReferencedVars(path, found); continue; }
    if (!EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    const text = readFileSync(path, 'utf8');
    // process.env.EXPO_PUBLIC_X 형태만 센다. 문자열 조합으로 만드는 동적 접근은
    // 정적으로 알 수 없으므로 애초에 쓰지 않는 것이 전제다.
    for (const m of text.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)) found.add(m[1]);
  }
  return found;
}

/**
 * EAS 에 등록된 환경변수 이름을 가져온다.
 * @returns {Set<string>|null} 이름 집합, 조회 실패 시 null
 */
function fetchEasVars() {
  try {
    const out = execFileSync(
      'npx', ['--no-install', 'eas', 'env:list', ENVIRONMENT, '--format=short'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000 },
    );
    const names = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=/);
      if (m) names.add(m[1]);
    }
    // 한 건도 못 읽었으면 파싱이 깨진 것으로 보고 "조회 실패"로 다룬다.
    return names.size > 0 ? names : null;
  } catch {
    return null;
  }
}

const referenced = collectReferencedVars(SRC_DIR);
const easVars = fetchEasVars();

if (!easVars) {
  console.log('[WARN] EAS 환경변수를 조회하지 못했습니다 (네트워크·인증 확인 필요).');
  console.log('       EXPO_PUBLIC_* 누락 점검을 건너뜁니다 — 빌드는 계속합니다.');
  process.exit(0);
}

const absent = [...referenced].filter((name) => !easVars.has(name)).sort();
// 의도적으로 비워 둔 것과 진짜 누락을 가른다. 허용된 것도 숨기지 않고 함께 보여줘야
// "왜 안 걸렸지" 를 나중에 되짚을 수 있다.
const allowed = absent.filter((name) => name in INTENTIONALLY_UNSET);
const missing = absent.filter((name) => !(name in INTENTIONALLY_UNSET));

if (allowed.length > 0) {
  console.log(`── 의도적으로 EAS 에 두지 않은 변수 ${allowed.length}건(정상) ──`);
  for (const name of allowed) console.log(`     - ${name}: ${INTENTIONALLY_UNSET[name]}`);
}

if (missing.length === 0) {
  console.log(`── EAS 환경변수(${ENVIRONMENT}) 이상 없음 — 코드가 읽는 ${referenced.size}개 모두 등록됨 ──`);
  process.exit(0);
}

console.error('');
console.error('🔴 코드가 읽는 EXPO_PUBLIC_* 가 EAS 환경에 없습니다:');
for (const name of missing) console.error(`     - ${name}`);
console.error('');
console.error(`   eas build 는 로컬 .env 가 아니라 EAS 환경(${ENVIRONMENT})을 씁니다.`);
console.error('   이대로 빌드하면 값이 undefined 인 채 나가고, 기능이 조용히 죽습니다.');
console.error('   (2026-08-15 카카오 네이티브 앱키가 이렇게 빠져 Android 앱이 크래시했습니다.)');
console.error('');
console.error('   등록: npx eas env:create --environment ' + ENVIRONMENT + ' --name <이름> --value <값> --visibility plaintext');
console.error('');
process.exit(1);
