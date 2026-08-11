#!/usr/bin/env node
/**
 * store-status — App Store / Google Play 의 현재 심사·게시 상태를 한 번에 조회한다.
 *
 *   node scripts/store-status.mjs            사람이 읽는 표
 *   node scripts/store-status.mjs --plain    "ios=<state> play=<status>:<vc>" 한 줄 (감시 스크립트용)
 *
 * 왜 저장소에 두는가: 이 조회 로직을 스크래치패드(`/private/tmp`)에만 두었더니
 * 2026-08 한 세션에서만 **두 번** 사라졌다(asc-screenshots.mjs, asc.mjs). 릴리스마다
 * 필요한 도구라 리포에 둔다.
 *
 * 자격증명(둘 다 gitignore, 저장소엔 없음):
 *   credentials/AuthKey_2GBSCKXQJ4.p8            App Store Connect (ES256)
 *   credentials/google-play-service-account.json Google Play (RS256)
 *
 * 🔴 ASC JWT 두 가지 함정:
 *   - 서명은 raw R||S 여야 한다(`dsaEncoding: 'ieee-p1363'`). DER 이면 401.
 *   - 만료는 **최대 20분**. 그보다 길게 주면 401 NOT_AUTHORIZED.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ASC = {
  keyId: '2GBSCKXQJ4',
  issuer: '5f89581a-d0c6-46c2-9461-78d5c08448fa',
  appId: '6763083903',
  keyPath: path.join(REPO, 'credentials/AuthKey_2GBSCKXQJ4.p8'),
};
const PLAY_PKG = 'io.synclink.app';
const PLAY_SA = path.join(REPO, 'credentials/google-play-service-account.json');

const b64u = (i) => Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ── App Store Connect ────────────────────────────────────────────────────────
function ascToken() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'ES256', kid: ASC.keyId, typ: 'JWT' }))}.` +
    `${b64u(JSON.stringify({ iss: ASC.issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
  const s = createSign('SHA256');
  s.update(unsigned); s.end();
  return `${unsigned}.${b64u(s.sign({ key: readFileSync(ASC.keyPath, 'utf8'), dsaEncoding: 'ieee-p1363' }))}`;
}

async function appStoreVersions() {
  const token = ascToken();
  const r = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${ASC.appId}/appStoreVersions?limit=5`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  return (j.data || []).map((v) => ({
    version: v.attributes.versionString,
    state: v.attributes.appStoreState,
    release: v.attributes.releaseType,
    id: v.id,
  }));
}

// ── Google Play ──────────────────────────────────────────────────────────────
async function playToken() {
  const sa = JSON.parse(readFileSync(PLAY_SA, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    `${b64u(JSON.stringify({
      iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    }))}`;
  const s = createSign('RSA-SHA256');
  s.update(unsigned); s.end();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64u(s.sign(sa.private_key))}`,
    }),
  });
  return (await res.json()).access_token;
}

async function playProduction() {
  const token = await playToken();
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PKG}`;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // ⚠️ Play 는 앱당 활성 edit 이 하나뿐이다. 업로드(eas submit)가 도는 중에 이걸 부르면
  //    그쪽 edit 이 무효화돼 업로드가 실패한다. 제출 중에는 호출하지 말 것.
  const edit = await (await fetch(`${base}/edits`, { method: 'POST', headers: H })).json();
  if (edit.error) throw new Error(JSON.stringify(edit.error).slice(0, 200));
  const track = await (await fetch(`${base}/edits/${edit.id}/tracks/production`, { headers: H })).json();
  await fetch(`${base}/edits/${edit.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  return (track.releases || []).map((r) => ({
    status: r.status,
    versionCodes: (r.versionCodes || []).join(','),
    name: r.name || '-',
  }));
}

// ── main ─────────────────────────────────────────────────────────────────────
const plain = process.argv.includes('--plain');

const [ios, play] = await Promise.all([
  appStoreVersions().catch((e) => ({ error: e.message })),
  playProduction().catch((e) => ({ error: e.message })),
]);

/** "1.4.0" → [1,4,0] 로 비교. 문자열 정렬은 1.10 < 1.9 가 되어 못 쓴다. */
const semver = (v) => (v || '0').split('.').map((n) => parseInt(n, 10) || 0);
const cmpDesc = (a, b) => {
  const [A, B] = [semver(a.version), semver(b.version)];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if ((B[i] || 0) !== (A[i] || 0)) return (B[i] || 0) - (A[i] || 0);
  }
  return 0;
};

if (plain) {
  // 감시 스크립트가 문자열 비교로 변화를 감지하는 용도. 실패는 error 로 구분되게 둔다.
  //
  // ⚠️ "READY_FOR_SALE 이 아닌 첫 번째"로 고르면 안 된다 — 앱에 옛 `1.0`
  //    PREPARE_FOR_SUBMISSION 자리표시자가 남아 있어 그게 잡힌다.
  //    **버전 번호가 가장 높은 것**이 항상 관심 대상이다.
  const top = ios.error ? null : [...ios].sort(cmpDesc)[0];
  const iosStr = ios.error ? `error(${ios.error.slice(0, 40)})`
    : top ? `${top.version}=${top.state}` : 'none';

  // ⚠️ Play 트랙 API 는 **심사 중과 게시 완료를 구분하지 못한다**(둘 다 completed).
  //    실제 게시 여부는 Play Console 게시개요의 "최근 게시일"로만 확인 가능하다.
  //    여기서는 versionCode 변화 감지 용도로만 쓸 것.
  const playStr = play.error ? `error(${play.error.slice(0, 40)})`
    : play.map((r) => `${r.status}:${r.versionCodes}`).join(' ');
  console.log(`ios=${iosStr} play=${playStr}`);
} else {
  console.log('══ App Store ══');
  if (ios.error) console.log('  ❌ ' + ios.error);
  else ios.forEach((v) => console.log(`  ${v.version.padEnd(8)} ${v.state.padEnd(26)} ${v.release.padEnd(16)} ${v.id}`));
  console.log('\n══ Google Play (production) ══');
  if (play.error) console.log('  ❌ ' + play.error);
  else play.forEach((r) => console.log(`  ${r.status.padEnd(12)} vc=${r.versionCodes.padEnd(6)} name=${r.name}`));
}
