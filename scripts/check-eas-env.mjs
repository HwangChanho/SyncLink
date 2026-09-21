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
import { collectReferencedVars, INTENTIONALLY_UNSET } from './lib/expo-public-vars.mjs';

const ENVIRONMENT = process.argv[2] ?? 'production';

// 🔑 INTENTIONALLY_UNSET 과 collectReferencedVars 는 scripts/lib/expo-public-vars.mjs 로
// 옮겼다(2026-09-20). verify-bundle-env.mjs 가 같은 규칙을 읽어야 해서, 복사본이
// 갈라지지 않게 한 곳에 뒀다.
const SRC_DIR = 'src';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

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
