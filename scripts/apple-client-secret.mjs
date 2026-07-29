#!/usr/bin/env node
/**
 * apple-client-secret.mjs — Sign in with Apple 용 client secret(JWT) 생성·점검·갱신.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * Supabase Auth 의 Apple provider 는 웹/Android 의 OAuth 리다이렉트 흐름에서
 * "client secret" 을 요구한다. Apple 은 고정 문자열 시크릿을 주지 않고,
 * 개발자가 Sign in with Apple 키(.p8)로 직접 서명한 **ES256 JWT** 를 시크릿으로
 * 쓰게 한다. 이 스크립트가 그 JWT 를 만들고, 만료를 점검하고, 재발급한다.
 *
 * (iOS 네이티브 로그인은 signInWithIdToken 경로라 이 시크릿이 필요 없다 —
 *  그래서 시크릿이 없거나 만료돼도 iOS 만 멀쩡해 발견이 늦어진다.)
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────
 *   # 1) 남은 유효기간 확인 (가장 자주 쓸 명령)
 *   node scripts/apple-client-secret.mjs --check
 *
 *   # 2) 재발급 — 기존 JWT 에서 Key ID/Team/Services ID 를 자동 복원하고
 *   #    새 JWT 생성 → 파일 갱신 → 클립보드 복사까지 한 번에
 *   node scripts/apple-client-secret.mjs --renew
 *
 *   # 3) 최초 발급 (인자 직접 지정)
 *   node scripts/apple-client-secret.mjs \
 *     --key credentials/AuthKey_XXXXXXXXXX.p8 \
 *     --key-id XXXXXXXXXX \
 *     --team-id QUVU2PY6PG \
 *     --services-id io.synclink.app.signin
 *
 * 공통 선택 인자:
 *   --days N   유효기간(기본 180). Apple 상한이 6개월이라 초과하면 거부된다.
 *   --out PATH 저장 경로(기본 credentials/apple-client-secret.jwt).
 *   --no-copy  클립보드 복사를 건너뛴다.
 *
 * ── 주의 ──────────────────────────────────────────────────────────────────
 *  - 출력되는 JWT 자체가 **시크릿**이다. 커밋 금지, 공유 금지.
 *    (기본 저장 경로 credentials/ 는 .gitignore 에 있다.)
 *  - **미리 갱신해 쟁여둘 수 없다**: Apple 은 exp 를 "검증 시점 기준 6개월 이내"로
 *    제한하므로, 지금 만들든 나중에 만들든 만료일은 '만든 날 + 180일'이다.
 *    따라서 갱신은 만료가 임박했을 때 해야 의미가 있다.
 *  - 키(.p8) 자체는 만료가 없다 — 같은 키로 JWT 만 다시 서명하면 된다.
 *  - 갱신 후에는 **Supabase Dashboard → Auth → Providers → Apple → Secret Key**
 *    에 새 JWT 를 붙여넣고 Save 해야 실제로 반영된다.
 */
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DEFAULT_OUT = 'credentials/apple-client-secret.jwt';
/** 이 일수 이하로 남으면 갱신을 권고한다. */
const WARN_DAYS = 30;

/** base64url 인코딩 — JWT 세그먼트는 표준 base64 가 아니라 base64url 이다. */
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** base64url 로 인코딩된 JWT 세그먼트를 객체로 되돌린다. */
const b64urlDecode = (seg) =>
  JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

/**
 * `--flag value` / `--flag`(불리언) 형태의 argv 를 객체로 파싱한다.
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true; // 값 없는 플래그
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 기존 JWT 파일을 읽어 발급에 필요한 파라미터를 복원한다.
 *
 * JWT 안에 이미 kid(Key ID) / iss(Team ID) / sub(Services ID) 가 들어 있으므로,
 * 갱신할 때 사용자가 인자를 다시 기억해 입력할 필요가 없다.
 *
 * @param {string} path JWT 파일 경로
 * @returns {{kid:string, iss:string, sub:string, exp:number, iat:number}}
 */
function readExisting(path) {
  if (!existsSync(path)) {
    console.error(`❌ 기존 JWT 를 찾을 수 없습니다: ${path}`);
    console.error('   최초 발급이라면 --key/--key-id/--team-id/--services-id 를 직접 지정하세요.');
    process.exit(1);
  }
  const jwt = readFileSync(path, 'utf8').trim();
  const [h, p] = jwt.split('.');
  if (!h || !p) {
    console.error(`❌ JWT 형식이 아닙니다: ${path}`);
    process.exit(1);
  }
  const header = b64urlDecode(h);
  const payload = b64urlDecode(p);
  return { kid: header.kid, iss: payload.iss, sub: payload.sub, exp: payload.exp, iat: payload.iat };
}

/** 남은 일수를 정수로 (음수면 이미 만료). */
const daysLeft = (exp) => Math.floor((exp * 1000 - Date.now()) / 86400000);

/**
 * ES256 으로 서명한 Apple client secret JWT 를 만든다.
 *
 * @param {{keyPath:string, keyId:string, teamId:string, servicesId:string, days:number}} o
 * @returns {{jwt:string, exp:number}}
 */
function mint({ keyPath, keyId, teamId, servicesId, days }) {
  let privateKey;
  try {
    privateKey = readFileSync(keyPath, 'utf8');
  } catch (e) {
    console.error(`❌ 키 파일을 읽을 수 없습니다: ${keyPath}\n   ${e.message}`);
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + days * 24 * 60 * 60;

  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  // iss = Team ID, sub = Services ID(웹/Android 용 client_id), aud 는 Apple 고정값
  const payload = { iss: teamId, iat: now, exp, aud: 'https://appleid.apple.com', sub: servicesId };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  let signature;
  try {
    // dsaEncoding 'ieee-p1363' = raw r||s. JWT(JOSE)가 요구하는 형식으로,
    // 기본값인 DER 로 서명하면 Apple 이 토큰을 거부한다.
    signature = createSign('SHA256')
      .update(unsigned)
      .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  } catch (e) {
    console.error(`❌ 서명 실패 — .p8 이 Sign in with Apple 키가 맞는지 확인하세요.\n   ${e.message}`);
    process.exit(1);
  }

  return { jwt: `${unsigned}.${b64url(signature)}`, exp };
}

/** 클립보드 복사(맥 전용 pbcopy). 실패해도 치명적이지 않으므로 경고만 남긴다. */
function copyToClipboard(text) {
  try {
    execFileSync('pbcopy', { input: text });
    return true;
  } catch {
    return false;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const outPath = typeof args.out === 'string' ? args.out : DEFAULT_OUT;

// ── 모드 1: --check — 남은 유효기간만 확인 (시크릿은 출력하지 않는다) ──────────
if (args.check) {
  const { kid, iss, sub, exp } = readExisting(outPath);
  const left = daysLeft(exp);
  const when = new Date(exp * 1000).toISOString().slice(0, 10);

  console.log('\n=== Apple client secret 상태 ===');
  console.log(`  파일        : ${outPath}`);
  console.log(`  Key ID      : ${kid}`);
  console.log(`  Team ID     : ${iss}`);
  console.log(`  Services ID : ${sub}`);
  console.log(`  만료        : ${when}`);

  if (left < 0) {
    console.log(`\n🔴 ${-left}일 전에 만료됨 — 웹/Android Apple 로그인이 이미 실패 중일 수 있습니다.`);
    console.log('   → node scripts/apple-client-secret.mjs --renew');
    process.exit(2);
  }
  if (left <= WARN_DAYS) {
    console.log(`\n🟡 ${left}일 남음 — 갱신을 권장합니다.`);
    console.log('   → node scripts/apple-client-secret.mjs --renew');
    process.exit(1);
  }
  console.log(`\n🟢 ${left}일 남음 — 조치 불필요.`);
  console.log('   (Apple 은 exp 를 "현재 시각 기준 6개월 이내"로 제한하므로,');
  console.log('    미리 갱신해 두어도 만료일은 앞당겨질 뿐 늘어나지 않습니다.)\n');
  process.exit(0);
}

// ── 모드 2: --renew — 기존 JWT 에서 파라미터 복원 후 재발급 ────────────────────
let keyPath, keyId, teamId, servicesId;

if (args.renew) {
  const prev = readExisting(outPath);
  keyId = prev.kid;
  teamId = prev.iss;
  servicesId = prev.sub;
  // 키 파일명 규칙: credentials/AuthKey_<KEYID>.p8 (Apple 다운로드 기본 이름)
  keyPath = typeof args.key === 'string' ? args.key : `credentials/AuthKey_${keyId}.p8`;
  console.log('\n♻️  기존 JWT 에서 설정을 복원했습니다:');
  console.log(`     Key ID ${keyId} / Team ${teamId} / Services ID ${servicesId}`);
  console.log(`     남은 기간: ${daysLeft(prev.exp)}일`);
} else {
  // ── 모드 3: 최초 발급 — 인자 필수 ──────────────────────────────────────────
  const required = ['key', 'key-id', 'team-id', 'services-id'];
  const missing = required.filter((k) => typeof args[k] !== 'string');
  if (missing.length) {
    console.error(`❌ 필수 인자 누락: ${missing.map((m) => `--${m}`).join(', ')}`);
    console.error('   갱신이라면 --renew 만으로 충분합니다. 사용법은 파일 상단 주석 참조.');
    process.exit(1);
  }
  keyPath = args.key;
  keyId = args['key-id'];
  teamId = args['team-id'];
  servicesId = args['services-id'];
}

const days = Number(args.days ?? 180);
if (!Number.isFinite(days) || days <= 0 || days > 180) {
  console.error('❌ --days 는 1~180 사이여야 합니다 (Apple 상한 6개월).');
  process.exit(1);
}

const { jwt, exp } = mint({ keyPath, keyId, teamId, servicesId, days });

writeFileSync(outPath, jwt, { mode: 0o600 });

console.log('\n=== 발급 완료 ===');
console.log(`  Team ID     : ${teamId}`);
console.log(`  Key ID      : ${keyId}`);
console.log(`  Services ID : ${servicesId}`);
console.log(`  만료        : ${new Date(exp * 1000).toISOString().slice(0, 10)} (${days}일 뒤)`);
console.log(`  저장        : ${outPath} (권한 600)`);

if (!args['no-copy']) {
  console.log(copyToClipboard(jwt) ? '  클립보드    : 복사됨 📋' : '  클립보드    : 복사 실패(pbcopy 없음)');
}

console.log('\n👉 다음 단계: Supabase Dashboard → Authentication → Sign In / Providers → Apple');
console.log('   → "Secret Key (for OAuth)" 에 붙여넣고 Save');
console.log('   ⚠️ Client IDs 는 건드리지 말 것 — 맨 앞이 Services ID 여야 웹 OAuth 가 동작합니다.');
console.log('   ⚠️ JWT 는 시크릿입니다. 커밋/공유 금지.\n');
