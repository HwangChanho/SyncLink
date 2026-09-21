#!/usr/bin/env node
/**
 * EXPO_PUBLIC_* 값이 **산출물 번들에 실제로 박혔는지** 검사한다. (2026-09-20)
 *
 * 📥 발상 출처: 형제 프로젝트 헤어핀(syncbarber). 그쪽은 `.env` 에만 넣은 네이버
 *    자격증명이 빌드에서 통째로 빠진 걸 **5주 뒤에야** 찾았다. 웹 폴백이 잘 되어 있어
 *    앱이 안 죽었고, 그래서 아무도 몰랐다.
 *    🔑 **폴백이 좋을수록 침묵이 감쪽같다** — 크래시가 차라리 친절한 경우가 있다.
 *
 * ▶ 왜 `check-eas-env.mjs` 로는 부족한가 — **「선언」과 「박혔다」는 다른 사건이다**
 *   그 스크립트는 빌드 **시작 전**에 "이름이 EAS 환경에 등록돼 있나"를 본다.
 *   이 스크립트는 빌드 **끝난 뒤**에 "그 값이 번들 안에서 실제로 보이나"를 본다.
 *   선언이 돼 있어도 인라인이 안 될 수 있다(프로필을 잘못 골랐다, 치환이 안 먹는
 *   동적 접근이었다, 산출물이 옛것이다 등). 우리도 같은 부류로 데인 적이 있다 —
 *   로컬 모듈 `modules/*` 가 무시파일 양쪽에서 빠져 빌드에 안 들어갔고, **aab 의 dex 를
 *   뒤져서야** 찾았다.
 *
 * ▶ 사용법
 *     node scripts/verify-bundle-env.mjs build/synclink-ios-1.4.17-189.ipa
 *     node scripts/verify-bundle-env.mjs build/app.aab --environment production
 *   종료코드: 정상 0 · 값 누락 1 · 검사 자체 실패 2
 *
 * 🔒 **값은 절대 출력하지 않는다.** 키 이름과 등장 횟수만 찍는다.
 *
 * 📝 Hermes 번들은 한글을 UTF-16 으로 저장해 바이트 검색에 안 잡힌다. 다만 여기서
 *    찾는 값은 전부 ASCII(키·URL·ID)라 그대로 검색된다.
 *    🔴 그래서 **대조군을 같이 센다** — 늘 있어야 할 문자열까지 0 으로 나오면 값이
 *    빠진 게 아니라 **내 검사 방법이 틀린 것**이다. 2026-09-11 에 이 규칙으로 오판을 막았다.
 */
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReferencedVars, INTENTIONALLY_UNSET } from './lib/expo-public-vars.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 인자 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const ARTIFACT = argv.find((a) => !a.startsWith('--'));
const ENVIRONMENT = (() => {
  const i = argv.indexOf('--environment');
  return i !== -1 ? argv[i + 1] : 'production';
})();

if (!ARTIFACT || !fs.existsSync(ARTIFACT)) {
  console.error('사용법: node scripts/verify-bundle-env.mjs <ipa|aab 경로> [--environment production]');
  process.exit(2);
}

/**
 * EAS 환경에서 이름과 **값**을 함께 가져온다.
 *
 * 🔑 `--include-sensitive` 가 없으면 값이 `*****` 로 마스킹돼 검색이 전부 0 회가 된다
 *    (붙이지 않으면 이 스크립트는 조용히 무의미해진다).
 * @returns {Map<string,string>|null} 이름→값, 조회 실패 시 null
 */
function fetchEasValues() {
  try {
    const out = execFileSync(
      'npx',
      ['--no-install', 'eas', 'env:list', ENVIRONMENT, '--format=short', '--include-sensitive'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 180_000 },
    );
    const map = new Map();
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[2] && m[2] !== '*****') map.set(m[1], m[2]);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

/** IPA/AAB 에서 가장 큰 JS 번들을 꺼낸다(임시 디렉터리는 호출자가 지운다). */
function extractBundle(artifact, workDir) {
  execFileSync('unzip', ['-o', '-q', artifact, '-d', workDir], { stdio: 'pipe' });
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'main.jsbundle' || e.name === 'index.android.bundle') hits.push(p);
    }
  };
  walk(workDir);
  if (!hits.length) return null;
  // 여러 개면 가장 큰 것이 진짜 앱 번들이다
  return hits.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

/** 버퍼에서 needle 등장 횟수. 값 자체는 돌려주지 않는다. */
function countOccurrences(buf, needle) {
  const n = Buffer.from(needle, 'utf8');
  let count = 0;
  let i = 0;
  while ((i = buf.indexOf(n, i)) !== -1) { count++; i += n.length; }
  return count;
}

// ── 검사 대상 확정 ────────────────────────────────────────────────────────
const easValues = fetchEasValues();
if (!easValues) {
  console.error(`🔴 EAS 환경(${ENVIRONMENT}) 값을 읽지 못했습니다 — 네트워크·인증을 확인하세요.`);
  console.error('   값을 모르면 번들에서 찾을 수 없으므로 이 검사는 수행할 수 없습니다.');
  console.error('   (여기서 멈춥니다. "검사 못 했다"를 "이상 없다"로 넘기면 검사가 있으나 마나입니다.)');
  process.exit(2);
}

const referenced = collectReferencedVars('src');
// 코드가 읽고 + EAS 에 값이 있고 + 의도적 미설정이 아닌 것만 본다.
// 🔑 코드가 안 읽는 변수는 Expo 가 애초에 인라인하지 않으므로 대상이 아니다.
const targets = [...referenced]
  .filter((k) => easValues.has(k) && !(k in INTENTIONALLY_UNSET))
  .sort();

if (targets.length === 0) {
  console.error('🔴 검사할 대상이 없습니다 — 수집 규칙이나 EAS 조회가 깨진 것으로 봅니다.');
  process.exit(2);
}

// ── 번들 추출 ─────────────────────────────────────────────────────────────
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bundle-'));
let failed = 0;
try {
  const bundle = extractBundle(ARTIFACT, work);
  if (!bundle) {
    console.error(`🔴 산출물 안에서 JS 번들을 찾지 못했습니다: ${path.basename(ARTIFACT)}`);
    process.exit(2);
  }
  const buf = fs.readFileSync(bundle);
  console.log(`\n▶ 산출물 번들 검사 — ${path.basename(ARTIFACT)} → ${path.basename(bundle)} (${buf.length.toLocaleString()} bytes)\n`);

  // 🔴 대조군 먼저. 이게 0 이면 아래 결과는 전부 믿을 수 없다.
  const CONTROLS = ['supabase', 'https://'];
  const controlHits = CONTROLS.map((c) => [c, countOccurrences(buf, c)]);
  const controlsOk = controlHits.some(([, n]) => n > 0);
  console.log('   [대조군] ' + controlHits.map(([c, n]) => `${c}=${n}회`).join(' · '));
  if (!controlsOk) {
    console.error('\n🔴 대조군까지 0 회입니다 — 값이 빠진 게 아니라 **검사 방법이 틀렸습니다.**');
    console.error('   (번들이 압축돼 있거나, 문자열 인코딩이 예상과 다릅니다. 결과를 신뢰하지 마세요.)');
    process.exit(2);
  }
  console.log('');

  for (const k of targets) {
    const n = countOccurrences(buf, easValues.get(k));
    if (n === 0) failed++;
    console.log(`   ${k.padEnd(36)} ${n > 0 ? `✅ ${n}회` : '🔴 0회 — 번들에 없다'}`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n🔴 ${failed}개 값이 번들에 인라인되지 않았습니다. 이 산출물은 올리면 안 됩니다.`);
  console.error(`   EAS 환경(${ENVIRONMENT})에는 선언돼 있는데 번들에 없다면, 빌드가 그 환경을`);
  console.error('   안 썼거나(프로필 확인) 산출물이 그 빌드의 것이 아닙니다.');
  process.exit(1);
}
console.log(`\n✅ 선언된 값 ${targets.length}개가 모두 번들에 들어갔습니다.\n`);
