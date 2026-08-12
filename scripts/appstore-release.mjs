#!/usr/bin/env node
/**
 * appstore-release — 심사를 통과한 App Store 버전을 실제로 출시한다.
 *
 *   node scripts/appstore-release.mjs            무엇을 출시할지 보여주기만 함(dry-run)
 *   node scripts/appstore-release.mjs --release  실제 출시
 *
 * 이 앱은 `releaseType=MANUAL` 이라 **심사를 통과해도 자동으로 스토어에 올라가지 않는다**.
 * 상태가 `PENDING_DEVELOPER_RELEASE` 에서 멈춰 있고, 여기서 출시 요청을 넣어야 한다.
 *
 * 🔴 되돌릴 수 없다. 출시하면 즉시 사용자에게 배포가 시작된다(Apple CDN 전파는 수 시간).
 *    되돌리려면 새 빌드로 다시 심사를 받아야 한다.
 *
 * ASC JWT 함정: 서명은 raw R||S(`dsaEncoding:'ieee-p1363'`, DER 이면 401),
 *               만료는 최대 20분.
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

/** 출시 가능한 상태. 이 외에는 손대지 않는다. */
const RELEASABLE = 'PENDING_DEVELOPER_RELEASE';

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

const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=10`);
const target = versions.data.find((v) => v.attributes.appStoreState === RELEASABLE);

if (!target) {
  console.log(`출시 대기(${RELEASABLE}) 상태인 버전이 없습니다. 현재:`);
  versions.data.forEach((v) =>
    console.log(`  ${v.attributes.versionString.padEnd(8)} ${v.attributes.appStoreState}`));
  process.exit(1);
}

const { versionString, appStoreState, releaseType } = target.attributes;
console.log('출시 대상');
console.log(`  버전   : ${versionString}`);
console.log(`  상태   : ${appStoreState}`);
console.log(`  릴리스 : ${releaseType}`);
console.log(`  id     : ${target.id}`);

// 연결된 빌드도 함께 보여준다 — 엉뚱한 빌드를 내보내는 사고를 막는다.
try {
  const build = await api(`/v1/appStoreVersions/${target.id}/build`);
  console.log(`  빌드   : ${build.data?.attributes?.version ?? '(없음)'}`);
} catch { /* 빌드 조회 실패는 출시를 막을 이유가 아니다 */ }

if (!process.argv.includes('--release')) {
  console.log('\n(dry-run — 실제 출시하려면 `--release`)');
  process.exit(0);
}

await api('/v1/appStoreVersionReleaseRequests', {
  method: 'POST',
  body: {
    data: {
      type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: target.id } } },
    },
  },
});

// 되읽어 검증
const after = await api(`/v1/appStoreVersions/${target.id}`);
const state = after.data.attributes.appStoreState;
console.log(`\n출시 요청 완료 → 상태: ${state}`);
console.log(state === 'READY_FOR_SALE'
  ? '  ✅ 라이브 (스토어 노출은 Apple CDN 전파로 수 시간 걸릴 수 있음)'
  : `  ⏳ ${state} — 잠시 후 다시 확인하세요`);
