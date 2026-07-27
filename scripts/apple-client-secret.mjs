#!/usr/bin/env node
/**
 * apple-client-secret.mjs — Sign in with Apple 용 client secret(JWT) 생성기.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * Supabase Auth 의 Apple provider 는 웹/Android 의 OAuth 리다이렉트 흐름에서
 * "client secret" 을 요구한다. Apple 은 고정 문자열 시크릿을 주지 않고,
 * 개발자가 Sign in with Apple 키(.p8)로 직접 서명한 **ES256 JWT** 를 시크릿으로
 * 쓰게 한다. 이 스크립트가 그 JWT 를 만든다.
 *
 * (iOS 네이티브 로그인은 signInWithIdToken 경로라 이 시크릿이 필요 없다 —
 *  그래서 시크릿이 비어 있어도 iOS 만 멀쩡했던 것.)
 *
 * ── 사용법 ────────────────────────────────────────────────────────────────
 *   node scripts/apple-client-secret.mjs \
 *     --key credentials/AuthKey_XXXXXXXXXX.p8 \
 *     --key-id XXXXXXXXXX \
 *     --team-id QUVU2PY6PG \
 *     --services-id io.synclink.app.signin
 *
 * 선택 인자:
 *   --days N   유효기간(기본 180). Apple 상한은 6개월(=180일)이라 초과 시 거부된다.
 *   --out PATH 파일로 저장(기본: stdout 출력만).
 *
 * ── 주의 ──────────────────────────────────────────────────────────────────
 *  - 출력되는 JWT 자체가 **시크릿**이다. 커밋 금지, 공유 금지.
 *  - Apple 정책상 최대 6개월 → **만료 전 재발급 필요**. 만료되면 웹/Android
 *    Apple 로그인이 조용히 실패한다(iOS 는 영향 없어 발견이 늦어지기 쉬움).
 *  - --key 로 주는 .p8 은 해당 Services ID 의 **Primary App ID 와 같은 앱 그룹**에
 *    속한 키여야 한다. 다른 앱(예: 형제앱)의 키로 서명하면 Apple 이
 *    invalid_client 를 반환한다.
 */
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/** base64url 인코딩 — JWT 세그먼트는 표준 base64 가 아니라 base64url 이다. */
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * `--flag value` 형태의 argv 를 객체로 파싱한다.
 * @returns {Record<string,string>} 플래그명(앞의 -- 제거) → 값
 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        console.error(`❌ --${key} 에 값이 없습니다.`);
        process.exit(1);
      }
      out[key] = val;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const required = ['key', 'key-id', 'team-id', 'services-id'];
const missing = required.filter((k) => !args[k]);
if (missing.length) {
  console.error(`❌ 필수 인자 누락: ${missing.map((m) => `--${m}`).join(', ')}`);
  console.error('   사용법은 이 파일 상단 주석 참조.');
  process.exit(1);
}

const days = Number(args.days ?? 180);
if (!Number.isFinite(days) || days <= 0 || days > 180) {
  console.error('❌ --days 는 1~180 사이여야 합니다 (Apple 상한 6개월).');
  process.exit(1);
}

let privateKey;
try {
  privateKey = readFileSync(args.key, 'utf8');
} catch (e) {
  console.error(`❌ 키 파일을 읽을 수 없습니다: ${args.key}\n   ${e.message}`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + days * 24 * 60 * 60;

// header.kid = Sign in with Apple 키의 Key ID
const header = { alg: 'ES256', kid: args['key-id'], typ: 'JWT' };
// iss = Team ID, sub = Services ID(웹/Android 용 client_id), aud 는 Apple 고정값
const payload = {
  iss: args['team-id'],
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: args['services-id'],
};

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

const jwt = `${unsigned}.${b64url(signature)}`;

console.log('\n=== Apple client secret (JWT) ===');
console.log(jwt);
console.log('\n--- 메타 ---');
console.log(`  Team ID     : ${args['team-id']}`);
console.log(`  Key ID      : ${args['key-id']}`);
console.log(`  Services ID : ${args['services-id']}  (= Supabase 의 client_id 중 하나여야 함)`);
console.log(`  만료        : ${new Date(exp * 1000).toISOString()} (${days}일 뒤)`);
console.log('\n⚠️  이 JWT 는 시크릿입니다 — 커밋/공유 금지.');
console.log('⚠️  만료 전 이 스크립트로 재발급해 Supabase 에 다시 넣어야 합니다.\n');

if (args.out) {
  writeFileSync(args.out, jwt, { mode: 0o600 });
  console.log(`💾 저장됨: ${args.out} (권한 600)\n`);
}
