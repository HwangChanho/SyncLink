#!/usr/bin/env node
/**
 * appstore-screenshots — App Store 스크린샷 조회 / 추가 / 순서 변경.
 *
 *   node scripts/appstore-screenshots.mjs                                  # 현황 (dry-run)
 *   node scripts/appstore-screenshots.mjs add <파일...> --write            # 편집 가능한 버전에 추가
 *   node scripts/appstore-screenshots.mjs order <파일명...> --write         # 그 순서대로 재배열
 *   ... [--display APP_IPHONE_65] [--version 1.4.5]
 *
 * 왜 리포에 두는가: 이 업로드 흐름을 스크래치패드에 뒀다가 두 번 잃었다(asc-upload-shots.mjs).
 * 릴리스마다 필요한 작업이라 매번 다시 쓰는 건 낭비다.
 *
 * 🔴 스크린샷은 **버전에 묶인다**. 라이브 버전은 못 바꾸고, 편집 가능한 버전이 심사를
 *    통과해 출시될 때 반영된다. 심사가 시작(IN_REVIEW)되면 그때부터 다시 잠긴다.
 *
 * 🔴 업로드는 3단계다. 하나라도 빠지면 스크린샷이 "처리 중"에서 멈춘다.
 *    1) POST /v1/appScreenshots  → 예약 + uploadOperations 수신
 *    2) uploadOperations 각각에 해당 바이트 구간을 PUT
 *    3) PATCH uploaded:true + sourceFileChecksum(md5)
 *
 * ⚠️ 한 display type 당 최대 10장.
 * ⚠️ ASC JWT: 서명은 raw R||S(`dsaEncoding:'ieee-p1363'`), 만료 최대 20분.
 */

import { createSign, createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_ID = '2GBSCKXQJ4';
const ISSUER = '5f89581a-d0c6-46c2-9461-78d5c08448fa';
const APP_ID = '6763083903';
const LOCALE = 'ko';
const MAX_PER_SET = 10;

const b64u = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 폴링/업로드가 길어질 수 있어 호출마다 새 토큰을 만든다(만료 20분). */
function token() {
  const iat = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))}.` +
    `${b64u(JSON.stringify({ iss: ISSUER, iat, exp: iat + 900, aud: 'appstoreconnect-v1' }))}`;
  const s = createSign('SHA256');
  s.update(unsigned);
  s.end();
  const key = readFileSync(path.join(REPO, `credentials/AuthKey_${KEY_ID}.p8`), 'utf8');
  return `${unsigned}.${b64u(s.sign({ key, dsaEncoding: 'ieee-p1363' }))}`;
}

const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(`${r.status} ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j;
};

const stateOf = (a) => a.appStoreState ?? a.appVersionState ?? a.state;

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const doWrite = argv.includes('--write');
const DISPLAY = flag('display') ?? 'APP_IPHONE_65';
const wantVersion = flag('version');
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  const prev = argv[i - 1];
  return prev !== '--display' && prev !== '--version';
});
const [cmd, ...files] = positional;

/** 편집 가능한(=아직 출시 안 된) iOS 버전. 스크린샷은 거기에만 붙는다. */
async function editableVersion() {
  const { data } = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=20`);
  const ios = data.filter((v) => v.attributes.platform === 'IOS');
  const v = wantVersion
    ? ios.find((x) => x.attributes.versionString === wantVersion)
    : ios.find((x) => stateOf(x.attributes) !== 'READY_FOR_SALE');
  if (!v) throw new Error(wantVersion ? `버전 ${wantVersion} 없음` : '편집 가능한 iOS 버전이 없습니다');
  return v;
}

async function setFor(version) {
  const locs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  const loc = locs.data.find((l) => l.attributes.locale.startsWith(LOCALE)) ?? locs.data[0];
  const sets = await api(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`);
  const set = sets.data.find((s) => s.attributes.screenshotDisplayType === DISPLAY);
  if (!set) throw new Error(`${DISPLAY} 스크린샷 세트가 없습니다`);
  return set;
}

const listShots = async (setId) =>
  (await api(`/v1/appScreenshotSets/${setId}/appScreenshots`)).data;

/** 3단계 업로드. 실패하면 그 자리에서 던져서 반쯤 올라간 상태를 눈치채게 한다. */
async function uploadOne(setId, filePath) {
  const bytes = readFileSync(filePath);
  const fileName = path.basename(filePath);
  const created = await api('/v1/appScreenshots', {
    method: 'POST',
    body: {
      data: {
        type: 'appScreenshots',
        attributes: { fileSize: statSync(filePath).size, fileName },
        relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
      },
    },
  });
  const shot = created.data;
  for (const op of shot.attributes.uploadOperations ?? []) {
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const r = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!r.ok) throw new Error(`${fileName} 청크 업로드 실패 ${r.status}`);
  }
  await api(`/v1/appScreenshots/${shot.id}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'appScreenshots',
        id: shot.id,
        attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') },
      },
    },
  });
  return { id: shot.id, fileName };
}

const version = await editableVersion();
const set = await setFor(version);
console.log(`버전 ${version.attributes.versionString} (${stateOf(version.attributes)}) · ${DISPLAY}`);

if (!doWrite) {
  const shots = await listShots(set.id);
  console.log(`  현재 ${shots.length}장 (최대 ${MAX_PER_SET})`);
  shots.forEach((s, i) =>
    console.log(`   ${String(i + 1).padStart(2)}. ${s.attributes.fileName} ${s.attributes.assetDeliveryState?.state ?? ''}`),
  );
  console.log('\n(dry-run — `add <파일...> --write` 또는 `order <파일명...> --write`)');
  process.exit(0);
}

if (cmd === 'add') {
  const existing = await listShots(set.id);
  if (existing.length + files.length > MAX_PER_SET) {
    throw new Error(`${existing.length} + ${files.length} 장 = 한도 ${MAX_PER_SET} 초과`);
  }
  for (const f of files) {
    const r = await uploadOne(set.id, path.resolve(f));
    console.log(`  ✅ ${r.fileName}`);
  }
} else if (cmd === 'order') {
  const shots = await listShots(set.id);
  const byName = new Map(shots.map((s) => [s.attributes.fileName, s.id]));
  const ordered = files.map((f) => {
    const id = byName.get(path.basename(f));
    if (!id) throw new Error(`${f} 를 현재 세트에서 찾지 못했습니다`);
    return { type: 'appScreenshots', id };
  });
  if (ordered.length !== shots.length) {
    throw new Error(`순서에 ${ordered.length}장을 줬는데 세트에는 ${shots.length}장 있습니다 — 전부 나열해야 합니다`);
  }
  await api(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
    method: 'PATCH',
    body: { data: ordered },
  });
  console.log(`  ✅ ${ordered.length}장 재배열`);
} else {
  throw new Error('usage: appstore-screenshots.mjs (add|order) <파일...> --write');
}

// 되읽어 검증 — 조용히 실패하면 심사에 옛 스크린샷이 그대로 나간다.
const after = await listShots(set.id);
console.log(`\n반영 확인 (${after.length}장)`);
after.forEach((s, i) =>
  console.log(`   ${String(i + 1).padStart(2)}. ${s.attributes.fileName} ${s.attributes.assetDeliveryState?.state ?? ''}`),
);
