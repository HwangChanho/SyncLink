#!/usr/bin/env node
/**
 * appstore-listing-text — App Store 등록정보의 **텍스트**를 읽고 바꾼다.
 * play-listing-text.mjs 의 iOS 짝. (Play 는 등록정보가 앱 단위, iOS 는 앱/버전 단위로 갈린다)
 *
 *   node scripts/appstore-listing-text.mjs                                  # 전체 현황 + 글자수 (dry-run)
 *   node scripts/appstore-listing-text.mjs promotionalText "..." --write     # 라이브 버전 → 심사 없이 즉시 반영
 *   node scripts/appstore-listing-text.mjs keywords "..." --write            # 편집 가능한 버전
 *   node scripts/appstore-listing-text.mjs name "..." --write                # 앱 단위(appInfo)
 *   node scripts/appstore-listing-text.mjs description "..." --write --version 1.4.4
 *   node scripts/appstore-listing-text.mjs description --file copy.txt --write   # 긴 본문은 파일로
 *
 * 🔑 반영 시점이 필드마다 다르다 — 이걸 헷갈리면 "바꿨는데 왜 그대로냐"가 된다.
 *   · promotionalText : **라이브 버전에 바로** 반영된다. 심사 불필요. 유일한 즉시 수단.
 *   · keywords / description / whatsNew : 편집 가능한 버전에 저장되고 **그 버전이 심사를 통과해
 *     출시될 때** 반영된다.
 *   · name / subtitle : appInfo(앱 단위)에 저장되고 역시 **다음 버전 출시 때** 반영된다.
 *
 * 🔴 ASC JWT: 서명은 raw R||S(`dsaEncoding:'ieee-p1363'`, DER 이면 401), 만료 최대 20분.
 * ⚠️ 한도는 UTF-16 코드포인트가 아니라 사람이 세는 글자 수 기준이라 `[...str].length` 로 검사한다.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_ID = '2GBSCKXQJ4';
const ISSUER = '5f89581a-d0c6-46c2-9461-78d5c08448fa';
const APP_ID = '6763083903';
const KEY_PATH = path.join(REPO, `credentials/AuthKey_${KEY_ID}.p8`);
const LOCALE = 'ko';

/**
 * 필드 정의. scope 가 반영 시점을 결정한다.
 *   appInfo  — 앱 단위. 편집 가능한 appInfo 에 쓴다.
 *   version  — 버전 단위. 기본 대상은 편집 가능한 버전.
 *   live     — 버전 단위지만 **라이브 버전**에 써야 즉시 반영되는 것.
 */
const FIELDS = {
  name:            { scope: 'appInfo', limit: 30 },
  subtitle:        { scope: 'appInfo', limit: 30 },
  keywords:        { scope: 'version', limit: 100 },
  description:     { scope: 'version', limit: 4000 },
  whatsNew:        { scope: 'version', limit: 4000 },
  promotionalText: { scope: 'live',    limit: 170 },
};

// ── ASC JWT ────────────────────────────────────────────────────────────────
const b64u = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const iat = Math.floor(Date.now() / 1000);
const unsigned =
  `${b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISSUER, iat, exp: iat + 900, aud: 'appstoreconnect-v1' }))}`;
const signer = createSign('SHA256');
signer.update(unsigned);
signer.end();
const TOKEN = `${unsigned}.${b64u(
  signer.sign({ key: readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }),
)}`;

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

const cnt = (s) => (s == null ? 0 : [...s].length);
/** ASC 는 상태 attribute 이름이 과도기라 둘 다 본다. */
const stateOf = (a) => a.appStoreState ?? a.appVersionState ?? a.state;
/** "1.4.10" > "1.4.9" 가 되도록 숫자 단위로 비교한다(문자열 정렬이면 뒤집힌다). */
const cmpVersion = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

// ── argv ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const doWrite = argv.includes('--write');
const fileArg = flag('file');
const versionArg = flag('version');
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  // --file/--version 의 값은 위치인자가 아니다.
  const prev = argv[i - 1];
  return prev !== '--file' && prev !== '--version';
});
const [field, inlineValue] = positional;
const value = fileArg
  ? readFileSync(path.resolve(fileArg), 'utf8').replace(/\n$/, '')
  : inlineValue;

// ── 대상 찾기 ──────────────────────────────────────────────────────────────
/** 편집 가능한 appInfo(=아직 출시 안 된 쪽). 없으면 라이브 것을 돌려준다. */
async function pickAppInfo() {
  const { data } = await api(`/v1/apps/${APP_ID}/appInfos`);
  return data.find((i) => stateOf(i.attributes) !== 'READY_FOR_SALE') ?? data[0];
}

/**
 * 대상 버전을 고른다.
 * @param {'live'|'editable'} kind  live=출시 중인 버전, editable=심사 전 편집 가능한 버전
 * @param {string} [pin]            versionString 을 직접 지정
 */
async function pickVersion(kind, pin) {
  const { data } = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=20`);
  const ios = data.filter((v) => v.attributes.platform === 'IOS');
  if (pin) {
    const hit = ios.find((v) => v.attributes.versionString === pin);
    if (!hit) throw new Error(`iOS 버전 ${pin} 을(를) 찾지 못했습니다`);
    return hit;
  }
  if (kind === 'live') {
    // 과거 출시본도 전부 READY_FOR_SALE 로 남아 있다. 응답 순서를 믿지 말고
    // 버전 번호가 가장 큰 것을 "지금 팔리는 버전"으로 본다.
    const live = ios
      .filter((v) => stateOf(v.attributes) === 'READY_FOR_SALE')
      .sort((a, b) => cmpVersion(b.attributes.versionString, a.attributes.versionString))[0];
    if (!live) throw new Error('출시 중인 iOS 버전이 없습니다');
    return live;
  }
  const editable = ios.find((v) => stateOf(v.attributes) !== 'READY_FOR_SALE');
  if (!editable) {
    throw new Error(
      '편집 가능한 iOS 버전이 없습니다 — 새 버전을 먼저 만드세요(appstore-submit.mjs 가 만듭니다)',
    );
  }
  return editable;
}

/** 버전의 ko 로컬라이제이션. ko 가 없으면 첫 번째 것. */
async function versionLoc(versionId) {
  const { data } = await api(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`);
  return data.find((l) => l.attributes.locale.startsWith(LOCALE)) ?? data[0];
}

// ── dry-run: 현황 출력 ─────────────────────────────────────────────────────
if (!doWrite) {
  const info = await pickAppInfo();
  const infoLocs = await api(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  const il = infoLocs.data.find((l) => l.attributes.locale.startsWith(LOCALE)) ?? infoLocs.data[0];
  console.log(`앱 단위 (appInfo ${stateOf(info.attributes)})`);
  console.log(`  name (${cnt(il.attributes.name)}/30)      ${il.attributes.name}`);
  console.log(`  subtitle (${cnt(il.attributes.subtitle)}/30)  ${il.attributes.subtitle ?? '(없음)'}`);

  const { data } = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=20`);
  const iosVersions = data
    .filter((x) => x.attributes.platform === 'IOS')
    .sort((a, b) => cmpVersion(b.attributes.versionString, a.attributes.versionString));
  // 과거 출시본도 READY_FOR_SALE 로 남으므로, "라이브"는 그중 최신 하나뿐이다.
  const liveId = iosVersions.find((v) => stateOf(v.attributes) === 'READY_FOR_SALE')?.id;
  for (const v of iosVersions.slice(0, 3)) {
    const l = await versionLoc(v.id);
    const t = l.attributes;
    const st = stateOf(v.attributes);
    const tag = v.id === liveId ? ' ← 라이브' : st === 'READY_FOR_SALE' ? ' ← 지난 출시본' : ' ← 편집 가능';
    console.log(`\n버전 ${v.attributes.versionString} (${st})${tag}`);
    console.log(`  keywords (${cnt(t.keywords)}/100)         ${t.keywords ?? '(없음)'}`);
    console.log(`  promotionalText (${cnt(t.promotionalText)}/170)  ${t.promotionalText ?? '(없음)'}`);
    console.log(`  description (${cnt(t.description)}/4000)`);
    console.log(`  whatsNew (${cnt(t.whatsNew)}/4000)        ${(t.whatsNew ?? '').slice(0, 60)}`);
  }
  console.log('\n(dry-run — 바꾸려면 `<field> "<값>" --write`)');
  process.exit(0);
}

// ── write ──────────────────────────────────────────────────────────────────
if (!field || value == null) {
  console.error(`usage: appstore-listing-text.mjs <${Object.keys(FIELDS).join('|')}> "<값>" --write`);
  process.exit(1);
}
const spec = FIELDS[field];
if (!spec) throw new Error(`알 수 없는 필드: ${field} (${Object.keys(FIELDS).join('/')})`);
const len = cnt(value);
if (len > spec.limit) throw new Error(`${field} 가 ${len}자로 한도 ${spec.limit}자를 넘습니다`);

let before;
let readBack;

if (spec.scope === 'appInfo') {
  const info = await pickAppInfo();
  const locs = await api(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  const loc = locs.data.find((l) => l.attributes.locale.startsWith(LOCALE)) ?? locs.data[0];
  before = loc.attributes[field];
  await api(`/v1/appInfoLocalizations/${loc.id}`, {
    method: 'PATCH',
    body: { data: { type: 'appInfoLocalizations', id: loc.id, attributes: { [field]: value } } },
  });
  readBack = async () => {
    const l = await api(`/v1/appInfoLocalizations/${loc.id}`);
    return l.data.attributes[field];
  };
  console.log(`대상: appInfo ${info.id} (${stateOf(info.attributes)}) — 다음 버전 출시 때 반영`);
} else {
  const version = await pickVersion(spec.scope === 'live' ? 'live' : 'editable', versionArg);
  const loc = await versionLoc(version.id);
  before = loc.attributes[field];
  await api(`/v1/appStoreVersionLocalizations/${loc.id}`, {
    method: 'PATCH',
    body: { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { [field]: value } } },
  });
  readBack = async () => {
    const l = await api(`/v1/appStoreVersionLocalizations/${loc.id}`);
    return l.data.attributes[field];
  };
  // promotionalText 는 심사 없이 반영되지만, 그건 **라이브 버전에 쓸 때** 얘기다.
  // 아직 출시 전인 버전에 쓰면 그 버전이 출시될 때 함께 나간다.
  const st = stateOf(version.attributes);
  const isLive = st === 'READY_FOR_SALE';
  console.log(
    `대상: 버전 ${version.attributes.versionString} (${st}) — ` +
      (field === 'promotionalText' && isLive ? '즉시 반영 (심사 불필요)' : '이 버전 출시 때 반영'),
  );
}

console.log(`${field}: ${len}/${spec.limit}자`);
console.log(`  이전: ${(before ?? '(없음)').slice(0, 120)}${(before ?? '').length > 120 ? '…' : ''}`);
console.log(`  이후: ${value.slice(0, 120)}${value.length > 120 ? '…' : ''}`);

// 되읽어 검증 — "바꿨으면 되읽어 확인" 원칙.
const after = await readBack();
console.log(`\n반영 확인: ${after === value ? '✅ 일치' : '❌ 불일치'}`);
if (after !== value) {
  console.error(`  서버 값: ${String(after).slice(0, 200)}`);
  process.exit(1);
}
