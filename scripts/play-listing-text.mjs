#!/usr/bin/env node
/**
 * play-listing-text — Play 스토어 등록정보의 **텍스트**(제목/짧은설명/전체설명)를 읽고 바꾼다.
 *
 *   node scripts/play-listing-text.mjs                              # 현재 값 + 글자수 (dry-run)
 *   node scripts/play-listing-text.mjs title "새 제목" --write
 *   node scripts/play-listing-text.mjs shortDescription "..." --write
 *
 * 한도(Play): title 30자 · shortDescription 80자 · fullDescription 4000자.
 * 한글도 1자로 센다(UTF-16 코드포인트 기준이므로 `[...str].length` 로 검사).
 *
 * 🔴 제목의 **브랜드명 부분은 함부로 빼지 말 것.** 계정 삭제 페이지에 등록정보의 앱 이름이
 *    언급돼 있어야 한다는 정책이 있고, 2026-08-11 에 이것 때문에 실제로 거부된 적이 있다.
 * ⚠️ 등록정보 변경은 검토 대상 — 자동 검토전송이 거부되면 changesNotSentForReview 로 폴백한다.
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

/** 필드별 글자수 한도. 넘기면 API 가 400 을 주기 전에 여기서 막는다. */
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

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

const [field, value] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const doWrite = process.argv.includes('--write');

const token = await playToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
};

const edit = await api(`${base}/edits`, { method: 'POST' });
const editUrl = `${base}/edits/${edit.id}`;

try {
  const listing = await api(`${editUrl}/listings/${LANG}`);

  if (!doWrite) {
    console.log(`등록정보 (${LANG})`);
    for (const [k, limit] of Object.entries(LIMITS)) {
      const v = listing[k] ?? '';
      console.log(`  ${k} (${[...v].length}/${limit}자)`);
      console.log(`    ${v.slice(0, 120)}${v.length > 120 ? '…' : ''}`);
    }
    console.log('\n(dry-run — 바꾸려면 `<field> "<값>" --write`)');
    await fetch(editUrl, { method: 'DELETE', headers: H });
    process.exit(0);
  }

  if (!field || value == null) throw new Error('usage: play-listing-text.mjs <field> "<값>" --write');
  if (!(field in LIMITS)) throw new Error(`알 수 없는 필드: ${field} (${Object.keys(LIMITS).join('/')})`);
  const len = [...value].length;
  if (len > LIMITS[field]) throw new Error(`${field} 가 ${len}자로 한도 ${LIMITS[field]}자를 넘습니다`);

  console.log(`${field}: ${len}/${LIMITS[field]}자`);
  console.log(`  이전: ${listing[field]}`);
  console.log(`  이후: ${value}`);

  // 전체 listing 을 PUT 한다 — PATCH 로 일부만 보내면 나머지 필드가 비워질 수 있다.
  await api(`${editUrl}/listings/${LANG}`, {
    method: 'PUT',
    body: JSON.stringify({ ...listing, language: LANG, [field]: value }),
  });

  let committed;
  try {
    committed = await api(`${editUrl}:commit`, { method: 'POST' });
    console.log(`  커밋 완료(검토 전송): edit ${committed.id}`);
  } catch (e) {
    console.log(`  자동 검토전송 거부 → 보류 커밋 (${e.message.slice(0, 80)})`);
    committed = await api(`${editUrl}:commit?changesNotSentForReview=true`, { method: 'POST' });
    console.log(`  커밋 완료(검토 미전송): edit ${committed.id}`);
    console.log('  🔴 Play Console 에서 "검토를 위해 변경사항 제출"을 눌러야 반영됩니다.');
  }

  // 되읽어 검증 — 확인용 edit 도 반드시 정리한다.
  const v = await api(`${base}/edits`, { method: 'POST' });
  try {
    const after = await api(`${base}/edits/${v.id}/listings/${LANG}`);
    console.log(`\n반영 확인 ${field}: ${after[field]}`);
    console.log(`  일치: ${after[field] === value ? '✅' : '❌'}`);
  } finally {
    await fetch(`${base}/edits/${v.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
} catch (err) {
  await fetch(editUrl, { method: 'DELETE', headers: H }).catch(() => {});
  console.error('실패:', err.message);
  process.exit(1);
}
