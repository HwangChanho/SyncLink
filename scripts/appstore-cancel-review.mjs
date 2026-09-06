#!/usr/bin/env node
/**
 * appstore-cancel-review — 심사 대기/진행 중인 App Store 제출을 취소한다.
 *
 *   node scripts/appstore-cancel-review.mjs            # 무엇을 취소할지 보여주기만 함(dry-run)
 *   node scripts/appstore-cancel-review.mjs --cancel   # 실제 취소
 *
 * 왜 필요한가: **앱에 편집 가능한 버전은 하나뿐**이다. 이전 버전이
 * WAITING_FOR_REVIEW 로 잡혀 있으면 다음 버전을 만들 수 없어
 * `appstore-submit.mjs` 가 실패한다. 취소하면 그 버전이
 * **DEVELOPER_REJECTED**(= 편집 가능)로 바뀌어 새 버전을 만들 수 있다.
 *
 * 🔴 대가는 **심사 대기열 재시작**이다. 이미 IN_REVIEW(심사관이 보는 중)면
 *    특히 손해가 크니, 취소 전에 상태를 확인하고 LEAD 승인을 받을 것.
 * ⚠️ 취소해도 업로드된 빌드(TestFlight)는 그대로 남는다 — 버전만 풀린다.
 *
 * 🔴 ASC JWT: 서명은 raw R||S(`dsaEncoding:'ieee-p1363'`, DER 이면 401), 만료 최대 20분.
 *
 * 이 스크립트는 scratchpad 에 두면 세션이 끝날 때 사라진다(전례 있음) → 리포에 둔다.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_ID = '2GBSCKXQJ4';
const ISSUER = '5f89581a-d0c6-46c2-9461-78d5c08448fa';
const APP_ID = '6763083903';
const KEY_PATH = path.join(REPO, 'credentials/AuthKey_2GBSCKXQJ4.p8');

const b64u = (i) => Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const unsigned =
  `${b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
const signer = createSign('SHA256');
signer.update(unsigned); signer.end();
const TOKEN = `${unsigned}.${b64u(signer.sign({ key: readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }))}`;

const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(`${r.status} ${JSON.stringify(j.errors).slice(0, 400)}`);
  return j;
};

const doCancel = process.argv.includes('--cancel');

// 1. 현재 버전 상태 — 무엇이 걸려 있는지 사람이 눈으로 확인할 수 있게 먼저 찍는다.
const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=5`);
console.log('App Store 버전 (최근 5)');
for (const v of versions.data) {
  console.log(`  ${v.attributes.versionString.padEnd(9)} ${v.attributes.appStoreState}`);
}

// 2. 열려 있는 심사 제출 찾기. 취소 가능한 상태만 고른다.
//    (COMPLETED/CANCELING 등은 손댈 것이 없다)
const CANCELABLE = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES', 'READY_FOR_REVIEW']);
const subs = await api(`/v1/reviewSubmissions?filter[app]=${APP_ID}&limit=10`);
const open = subs.data.filter((s) => CANCELABLE.has(s.attributes.state));

console.log('\n열린 심사 제출');
if (open.length === 0) {
  console.log('  (없음 — 취소할 것이 없습니다)');
  process.exit(0);
}
for (const s of open) {
  console.log(`  ${s.id}  state=${s.attributes.state}  submitted=${s.attributes.submittedDate ?? '-'}`);
}

if (!doCancel) {
  console.log('\n(dry-run — 실제로 취소하려면 `--cancel`)');
  console.log('🔴 취소하면 심사 대기열을 처음부터 다시 섭니다.');
  process.exit(0);
}

// 3. 취소. canceled=true 를 PATCH 하면 버전이 DEVELOPER_REJECTED 로 풀린다.
for (const s of open) {
  await api(`/v1/reviewSubmissions/${s.id}`, {
    method: 'PATCH',
    body: { data: { type: 'reviewSubmissions', id: s.id, attributes: { canceled: true } } },
  });
  console.log(`\n취소 요청: ${s.id}`);
}

// 4. 되읽어 검증 — "요청했다"가 아니라 "실제로 바뀌었다"를 확인한다.
//    Apple 쪽 반영이 즉시가 아닐 수 있어 몇 초 간격으로 재조회한다.
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const after = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=3`);
  const states = after.data.map((v) => `${v.attributes.versionString}=${v.attributes.appStoreState}`);
  console.log(`  확인 ${i + 1}: ${states.join(' · ')}`);
  if (after.data.some((v) => ['DEVELOPER_REJECTED', 'PREPARE_FOR_SUBMISSION'].includes(v.attributes.appStoreState))) {
    console.log('\n✅ 편집 가능한 상태로 풀렸습니다. 이제 새 버전을 만들 수 있습니다.');
    process.exit(0);
  }
}
console.log('\n⚠️ 아직 반영이 안 보입니다. 잠시 뒤 이 스크립트를 다시 돌려 상태를 확인하세요.');
