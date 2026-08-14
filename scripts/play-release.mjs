#!/usr/bin/env node
/**
 * play-release — Play 프로덕션 트랙의 draft 릴리스를 게시(검토 전송)한다.
 *
 *   node scripts/play-release.mjs                      # 현재 트랙 상태만 출력 (dry-run)
 *   node scripts/play-release.mjs <vc> <notesFile> --release
 *
 * 왜 필요한가: `eas submit` 은 `releaseStatus: draft` 로 올려두기만 한다.
 * 실제 사용자에게 나가려면 릴리스를 `completed` 로 바꾸고 커밋해야 하는데,
 * 그 과정을 Play Console UI 대신 API 로 처리한다.
 *
 * 🔴 앱당 활성 edit 은 하나뿐이다. `eas submit` 이 끝난 뒤에 실행할 것.
 *    (제출 중에 Play API 를 건드리면 `This Edit has been deleted` 로 업로드가 깨진다.)
 *
 * ⚠️ 등록정보(제목·스크린샷 등)를 함께 바꾼 edit 은 자동 검토전송이 400 으로 거부된다.
 *    이 스크립트는 **트랙만** 건드리므로 자동 전송이 정상 동작한다. 등록정보를 같이
 *    바꿔야 한다면 `changesNotSentForReview: true` 로 커밋한 뒤 콘솔에서 수동 전송할 것.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'io.synclink.app';
const SA_PATH = path.join(REPO, 'credentials/google-play-service-account.json');
const TRACK = 'production';

/** 서비스 계정 JWT → OAuth 액세스 토큰 (RS256). */
async function playToken() {
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const b64u = (i) =>
    Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    `${b64u(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    )}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const jwt = `${unsigned}.${b64u(signer.sign(sa.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const [vcArg, notesFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const doRelease = process.argv.includes('--release');

const token = await playToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const api = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
};

// edit 은 만들면 반드시 커밋하거나 버려야 한다 — 실패 시 delete 로 정리한다.
const edit = await api(`${base}/edits`, { method: 'POST' });
const editUrl = `${base}/edits/${edit.id}`;

try {
  const track = await api(`${editUrl}/tracks/${TRACK}`);
  console.log(`트랙 ${TRACK} 현재 상태`);
  for (const rel of track.releases ?? []) {
    console.log(
      `  · vc=${(rel.versionCodes ?? []).join(',')} status=${rel.status} name=${rel.name ?? '-'}`,
    );
  }

  if (!doRelease) {
    console.log('\n(dry-run — 게시하려면 `<vc> <notesFile> --release`)');
    await fetch(editUrl, { method: 'DELETE', headers: H });
    process.exit(0);
  }

  if (!vcArg || !notesFile) throw new Error('usage: play-release.mjs <vc> <notesFile> --release');

  // 대상 릴리스는 반드시 이미 트랙에 올라와 있어야 한다(= eas submit 이 draft 로 올린 것).
  // 여기서 versionCodes 를 새로 만들지 않는 이유: 없는 vc 를 넣으면 커밋 때 실패하는데,
  // 그 실패가 "업로드 안 됨"인지 "상태 전환 실패"인지 구분되지 않아 진단이 어려워진다.
  const target = (track.releases ?? []).find((r) => (r.versionCodes ?? []).includes(String(vcArg)));
  if (!target) throw new Error(`vc ${vcArg} 가 ${TRACK} 트랙에 없습니다 — 먼저 eas submit 하세요`);
  if (target.status === 'completed') {
    console.log(`\nvc ${vcArg} 는 이미 completed 입니다. 변경 없이 종료합니다.`);
    await fetch(editUrl, { method: 'DELETE', headers: H });
    process.exit(0);
  }

  const notes = readFileSync(path.resolve(notesFile), 'utf8').trimEnd();
  // 🔴 트랙에 `completed` 릴리스는 **하나만** 허용된다(둘이면 400 INVALID_ARGUMENT).
  //    과거 릴리스를 남긴 채 새 릴리스를 completed 로 만들 수 없으므로 대상만 남긴다.
  //    이는 Play Console 에서 새 릴리스를 만드는 것과 같은 동작이다 — 이전 릴리스는
  //    출시 히스토리로 넘어갈 뿐이고, 구버전 사용자는 새 vc 로 업데이트된다.
  const dropped = (track.releases ?? [])
    .filter((r) => r !== target)
    .map((r) => `vc=${(r.versionCodes ?? []).join(',')}(${r.status})`);
  if (dropped.length) console.log(`  대체되는 기존 릴리스: ${dropped.join(', ')}`);

  const releases = [
    {
      versionCodes: [String(vcArg)],
      status: 'completed',
      releaseNotes: [{ language: 'ko-KR', text: notes }],
    },
  ];

  await api(`${editUrl}/tracks/${TRACK}`, {
    method: 'PUT',
    body: JSON.stringify({ track: TRACK, releases }),
  });
  console.log(`\nvc ${vcArg} → completed (노트 ${notes.length}자)`);

  const committed = await api(`${editUrl}:commit`, { method: 'POST' });
  console.log(`커밋 완료: edit ${committed.id}`);

  // 되읽어 검증 — 확인용 edit 도 반드시 지운다. 커밋되지 않은 edit 이 남으면
  // 다음 `eas submit` 이 "This Edit has been deleted" 로 깨진다.
  const verifyEdit = await api(`${base}/edits`, { method: 'POST' });
  try {
    const after = await api(`${base}/edits/${verifyEdit.id}/tracks/${TRACK}`);
    console.log('\n게시 후 트랙 상태');
    for (const rel of after.releases ?? []) {
      console.log(`  · vc=${(rel.versionCodes ?? []).join(',')} status=${rel.status}`);
    }
  } finally {
    await fetch(`${base}/edits/${verifyEdit.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
} catch (err) {
  // 커밋되지 않은 edit 을 남기면 다음 제출이 막힌다.
  await fetch(editUrl, { method: 'DELETE', headers: H }).catch(() => {});
  console.error('실패:', err.message);
  process.exit(1);
}
