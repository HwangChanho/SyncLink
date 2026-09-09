/**
 * appstore-release-type — 심사 대기 중인 버전의 **출시 방식만** 바꾼다.
 *
 *   node scripts/appstore-release-type.mjs                        # 현재 값 출력(dry-run)
 *   node scripts/appstore-release-type.mjs <version> <type>        # 변경
 *
 *   <type> = AFTER_APPROVAL  심사 통과 즉시 자동 출시
 *          | MANUAL          통과해도 안 나감 → appstore-release.mjs 로 수동 출시
 *
 * 왜 별도 스크립트인가 — `appstore-submit.mjs` 에도 releaseType 을 맞추는 코드가 있지만
 * 그건 **제출 흐름 전체**의 일부다. 이미 제출된 버전에 그걸 다시 돌리면
 * `reviewSubmission` 을 **새로 만들어** 중복 제출이 된다. 출시 방식만 바꾸고 싶을 때
 * 쓸 안전한 경로가 따로 필요하다(2026-09-10 에 1.4.14 로 실제 필요해졌다).
 *
 * 🔴 ASC JWT: 서명은 raw R||S(`dsaEncoding: 'ieee-p1363'`). DER 로 서명하면 401 이다.
 * 🔑 ASC 흐름을 스크래치패드에 두면 잃는다 — 한 세션에서 두 번 날렸다. 리포에 둔다.
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

const VALID_TYPES = ['AFTER_APPROVAL', 'MANUAL', 'SCHEDULED'];

const b64u = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned =
  `${b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
const signer = createSign('SHA256');
signer.update(unsigned);
signer.end();
const TOKEN = `${unsigned}.${b64u(
  signer.sign({ key: readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }),
)}`;

/** ASC 호출. 실패는 상태코드와 본문 앞부분을 함께 던진다(원인 파악이 빨라진다). */
const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(json).slice(0, 400)}`);
  return json;
};

const [versionArg, typeArg] = process.argv.slice(2);

const { data: versions } = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=10`);

// 인자가 없으면 현재 상태만 보여준다 — 실수로 바꾸는 일이 없게 dry-run 이 기본이다.
if (!versionArg || !typeArg) {
  console.log('앱 버전 현황');
  for (const v of versions) {
    console.log(
      `  ${v.attributes.versionString.padEnd(8)} ${v.attributes.appStoreState.padEnd(24)} releaseType=${v.attributes.releaseType}`,
    );
  }
  console.log('\n(변경하려면 `<version> <AFTER_APPROVAL|MANUAL>`)');
  process.exit(0);
}

if (!VALID_TYPES.includes(typeArg)) {
  throw new Error(`type 은 ${VALID_TYPES.join(' | ')} 중 하나여야 합니다 — 받은 값: ${typeArg}`);
}

const version = versions.find((v) => v.attributes.versionString === versionArg);
if (!version) throw new Error(`버전 ${versionArg} 을 ASC 에서 찾지 못했습니다`);

console.log(
  `대상 ${version.id}  상태=${version.attributes.appStoreState}  현재 releaseType=${version.attributes.releaseType}`,
);

if (version.attributes.releaseType === typeArg) {
  console.log(`이미 ${typeArg} — 변경 없음`);
  process.exit(0);
}

await api(`/v1/appStoreVersions/${version.id}`, {
  method: 'PATCH',
  body: {
    data: { type: 'appStoreVersions', id: version.id, attributes: { releaseType: typeArg } },
  },
});

// 🔑 PATCH 응답을 믿지 말고 **되읽어** 확인한다. 상태(appStoreState)도 같이 보는 이유는
//    출시 방식만 바꾸려다 제출이 풀리지 않았는지 확인하기 위해서다.
const after = await api(`/v1/appStoreVersions/${version.id}`);
console.log(
  `변경 후: releaseType=${after.data.attributes.releaseType}  상태=${after.data.attributes.appStoreState}`,
);
