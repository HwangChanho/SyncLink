#!/usr/bin/env node
/**
 * play-listing-image — Play 스토어 **등록정보 이미지**를 교체한다.
 *
 *   node scripts/play-listing-image.mjs                          # 현재 등록된 이미지 목록 (dry-run)
 *   node scripts/play-listing-image.mjs icon <파일> --upload
 *
 * 🔴 왜 별도인가: **앱 아이콘(AAB 안 mipmap)과 스토어 아이콘은 서로 다른 것**이다.
 *    앱을 리브랜딩해도 Play Console 에 따로 올린 512×512 아이콘은 그대로 남는다
 *    (App Store 는 IPA 안 아이콘을 그대로 쓰므로 이런 불일치가 없다).
 *    2026-08-14 에 실제로 이 불일치가 발견됐다 — 기기 아이콘은 새것, 스토어는 구 SyncLink.
 *
 * imageType: icon | featureGraphic | phoneScreenshots | sevenInchScreenshots |
 *            tenInchScreenshots | tvBanner | tvScreenshots | wearScreenshots
 *
 * ⚠️ 등록정보 변경은 검토 대상이다. 자동 검토전송이 거부되면(400) `changesNotSentForReview`
 *    로 커밋한 뒤 Play Console 에서 "검토를 위해 변경사항 제출"을 눌러야 한다.
 * 🔴 앱당 활성 edit 은 하나 — `eas submit` 과 동시에 실행하지 말 것.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'io.synclink.app';
const LANG = 'ko-KR';
const SA_PATH = path.join(REPO, 'credentials/google-play-service-account.json');

async function playToken() {
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const b64u = (i) =>
    Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    `${b64u(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64u(signer.sign(sa.private_key))}`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const [imageType, filePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const doUpload = process.argv.includes('--upload');

const token = await playToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const H = { Authorization: `Bearer ${token}` };
const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
};

const edit = await api(`${base}/edits`, { method: 'POST' });
const editUrl = `${base}/edits/${edit.id}`;

try {
  if (!doUpload) {
    console.log(`등록정보 이미지 현황 (${LANG})`);
    for (const t of ['icon', 'featureGraphic', 'phoneScreenshots', 'tenInchScreenshots']) {
      const r = await api(`${editUrl}/listings/${LANG}/${t}`).catch(() => ({ images: [] }));
      const imgs = r.images ?? [];
      console.log(`  ${t.padEnd(20)} ${imgs.length}개`);
      imgs.slice(0, 2).forEach((i) => console.log(`      ${i.url}`));
    }
    console.log('\n(dry-run — 교체하려면 `<imageType> <파일> --upload`)');
    await fetch(editUrl, { method: 'DELETE', headers: H });
    process.exit(0);
  }

  if (!imageType || !filePath) throw new Error('usage: play-listing-image.mjs <imageType> <파일> --upload');
  const bytes = readFileSync(path.resolve(filePath));
  console.log(`업로드: ${imageType} ← ${filePath} (${(bytes.length / 1024).toFixed(0)}KB)`);

  // icon 처럼 1장만 허용되는 타입은 먼저 비워야 중복 없이 교체된다.
  if (imageType === 'icon' || imageType === 'featureGraphic') {
    await fetch(`${editUrl}/listings/${LANG}/${imageType}`, { method: 'DELETE', headers: H });
    console.log('  기존 이미지 삭제');
  }

  const up = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}` +
      `/edits/${edit.id}/listings/${LANG}/${imageType}?uploadType=media`,
    { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: bytes },
  );
  const upJson = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`업로드 실패 ${up.status} ${JSON.stringify(upJson).slice(0, 300)}`);
  console.log(`  업로드 완료: ${upJson.image?.url ?? '(url 없음)'}`);

  // 자동 검토전송을 먼저 시도하고, 거부되면 보류 커밋으로 폴백한다.
  // (등록정보를 바꾼 edit 은 400 INVALID_ARGUMENT 로 거부될 수 있다.)
  let committed;
  try {
    committed = await api(`${editUrl}:commit`, { method: 'POST' });
    console.log(`  커밋 완료(검토 전송): edit ${committed.id}`);
  } catch (e) {
    console.log(`  자동 검토전송 거부 → 보류 커밋으로 재시도 (${e.message.slice(0, 80)})`);
    committed = await api(`${editUrl}:commit?changesNotSentForReview=true`, { method: 'POST' });
    console.log(`  커밋 완료(검토 미전송): edit ${committed.id}`);
    console.log('  🔴 Play Console 에서 "검토를 위해 변경사항 제출"을 눌러야 반영됩니다.');
  }

  // 되읽어 검증 — 확인용 edit 도 반드시 정리한다.
  const v = await api(`${base}/edits`, { method: 'POST' });
  try {
    const after = await api(`${base}/edits/${v.id}/listings/${LANG}/${imageType}`);
    console.log(`\n교체 후 ${imageType}: ${(after.images ?? []).length}개`);
    (after.images ?? []).forEach((i) => console.log(`  ${i.url}`));
  } finally {
    await fetch(`${base}/edits/${v.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
} catch (err) {
  await fetch(editUrl, { method: 'DELETE', headers: H }).catch(() => {});
  console.error('실패:', err.message);
  process.exit(1);
}
