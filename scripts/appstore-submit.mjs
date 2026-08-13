#!/usr/bin/env node
/**
 * appstore-submit — App Store 버전 생성 → 빌드 연결 → 출시노트 → 심사 제출.
 *
 *   node scripts/appstore-submit.mjs <version> <buildNumber> <notesFile> [--auto-release] [--submit]
 *
 * 인자 없이(=--submit 없이) 실행하면 **dry-run** — 무엇을 할지 보여주기만 한다.
 *
 * `--auto-release`  releaseType=AFTER_APPROVAL (심사 통과 시 자동 출시)
 * 생략하면         releaseType=MANUAL         (통과 후 appstore-release.mjs 로 수동 출시)
 *
 * 이 흐름을 스크래치패드에 두었다가 한 세션에서 두 번 잃었다(asc.mjs 등) → 리포에 둔다.
 *
 * 🔴 ASC JWT: 서명은 raw R||S(`dsaEncoding:'ieee-p1363'`, DER 이면 401), 만료 최대 20분.
 * ⚠️ 앱에 편집 가능한 버전은 하나뿐이다. 이미 심사 대기 중인 버전이 있으면 생성이 실패한다.
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

const [versionString, buildNumber, notesFile] = process.argv.slice(2);
const autoRelease = process.argv.includes('--auto-release');
const doSubmit = process.argv.includes('--submit');

if (!versionString || !buildNumber || !notesFile) {
  console.log('usage: appstore-submit.mjs <version> <buildNumber> <notesFile> [--auto-release] [--submit]');
  process.exit(1);
}
const notes = readFileSync(notesFile, 'utf8').trimEnd();
const releaseType = autoRelease ? 'AFTER_APPROVAL' : 'MANUAL';

console.log('제출 계획');
console.log(`  버전     : ${versionString}`);
console.log(`  빌드     : ${buildNumber}`);
console.log(`  출시방식 : ${releaseType}${autoRelease ? ' (심사 통과 시 자동 출시)' : ' (통과 후 수동 출시 필요)'}`);
console.log(`  노트     : ${notes.length}자`);

if (!doSubmit) {
  console.log('\n(dry-run — 실제로 진행하려면 `--submit`)');
  process.exit(0);
}

// 빌드가 VALID 인지 먼저 본다. PROCESSING 상태로 연결하면 심사에 못 올린다.
const builds = await api(`/v1/builds?filter[app]=${APP_ID}&limit=20&sort=-uploadedDate`);
const build = builds.data.find((b) => b.attributes.version === String(buildNumber));
if (!build) throw new Error(`build ${buildNumber} 를 ASC 에서 찾지 못했습니다`);
if (build.attributes.processingState !== 'VALID') {
  throw new Error(`build ${buildNumber} 상태가 ${build.attributes.processingState} — VALID 가 될 때까지 기다리세요`);
}

// 같은 versionString 이 이미 있으면 재사용한다(중복 생성은 409).
const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=10`);
let version = versions.data.find((v) => v.attributes.versionString === versionString);

if (version) {
  console.log(`\n기존 버전 재사용: ${version.id} (${version.attributes.appStoreState})`);
  // 출시 방식이 다르면 맞춘다.
  if (version.attributes.releaseType !== releaseType) {
    await api(`/v1/appStoreVersions/${version.id}`, {
      method: 'PATCH',
      body: { data: { type: 'appStoreVersions', id: version.id, attributes: { releaseType } } },
    });
    console.log(`  releaseType → ${releaseType}`);
  }
} else {
  const created = await api('/v1/appStoreVersions', {
    method: 'POST',
    body: {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString, releaseType },
        relationships: { app: { data: { type: 'apps', id: APP_ID } } },
      },
    },
  });
  version = created.data;
  console.log(`\n버전 생성: ${version.id}`);
}

await api(`/v1/appStoreVersions/${version.id}/relationships/build`, {
  method: 'PATCH',
  body: { data: { type: 'builds', id: build.id } },
});
console.log(`  빌드 ${buildNumber} 연결`);

const locs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
const ko = locs.data.find((l) => l.attributes.locale.startsWith('ko')) ?? locs.data[0];
await api(`/v1/appStoreVersionLocalizations/${ko.id}`, {
  method: 'PATCH',
  body: { data: { type: 'appStoreVersionLocalizations', id: ko.id, attributes: { whatsNew: notes } } },
});
console.log(`  출시노트 설정 (${ko.attributes.locale})`);

// 심사 제출 — reviewSubmission 을 열고 이 버전을 항목으로 붙인 뒤 제출한다.
const sub = await api('/v1/reviewSubmissions', {
  method: 'POST',
  body: {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  },
});
await api('/v1/reviewSubmissionItems', {
  method: 'POST',
  body: {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.data.id } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
      },
    },
  },
});
await api(`/v1/reviewSubmissions/${sub.data.id}`, {
  method: 'PATCH',
  body: { data: { type: 'reviewSubmissions', id: sub.data.id, attributes: { submitted: true } } },
});

const after = await api(`/v1/appStoreVersions/${version.id}`);
console.log(`\n제출 완료 → 상태: ${after.data.attributes.appStoreState}`);
console.log(`  출시방식: ${after.data.attributes.releaseType}`);
