#!/usr/bin/env node
/**
 * appstore-watch-review — App Store 심사 상태가 바뀔 때까지 폴링하다가, 바뀌면 끝난다.
 *
 *   node scripts/appstore-watch-review.mjs                 # 심사 중인 버전 자동 선택
 *   node scripts/appstore-watch-review.mjs 1.4.4           # 버전 지정
 *   node scripts/appstore-watch-review.mjs 1.4.4 300       # 폴링 간격(초) 지정
 *
 * `store-status.mjs` 는 한 번 찍고 끝이라 "결과 나오면 알려줘" 에는 안 맞는다.
 * 이건 상태가 **변할 때까지** 기다렸다가 종료하므로, 백그라운드로 띄워 두면
 * 종료 알림이 곧 심사 결과 통보가 된다.
 *
 * 종료 코드: 0 = 상태 변화(정상), 2 = 마감시간 초과, 1 = 오류.
 *
 * 🔴 ASC JWT 는 최대 20분짜리라 **폴링마다 새로 만든다**(한 번 만들어 재사용하면 401).
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_ID = '2GBSCKXQJ4';
const ISSUER = '5f89581a-d0c6-46c2-9461-78d5c08448fa';
const APP_ID = '6763083903';
const KEY = readFileSync(path.join(REPO, `credentials/AuthKey_${KEY_ID}.p8`), 'utf8');

const wantVersion = process.argv[2];
const intervalSec = Number(process.argv[3] ?? 600);
const DEADLINE = Date.now() + 48 * 60 * 60 * 1000; // 48시간이면 사람이 들여다볼 때다

const b64u = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 폴링마다 새 토큰. 만료 20분 제한 때문에 캐시하면 안 된다. */
function token() {
  const iat = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))}.` +
    `${b64u(JSON.stringify({ iss: ISSUER, iat, exp: iat + 900, aud: 'appstoreconnect-v1' }))}`;
  const s = createSign('SHA256');
  s.update(unsigned);
  s.end();
  return `${unsigned}.${b64u(s.sign({ key: KEY, dsaEncoding: 'ieee-p1363' }))}`;
}

/** ASC 는 상태 attribute 이름이 과도기라 둘 다 본다. */
const stateOf = (a) => a.appStoreState ?? a.appVersionState ?? a.state;

/** 지금 지켜볼 버전 하나를 고른다. 지정이 없으면 출시 안 된 iOS 버전. */
async function fetchVersion() {
  const r = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}/appStoreVersions?limit=20`,
    { headers: { Authorization: `Bearer ${token()}` } },
  );
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(`${r.status} ${JSON.stringify(j.errors).slice(0, 200)}`);
  const ios = (j.data ?? []).filter((v) => v.attributes.platform === 'IOS');
  const v = wantVersion
    ? ios.find((x) => x.attributes.versionString === wantVersion)
    : ios.find((x) => stateOf(x.attributes) !== 'READY_FOR_SALE');
  if (!v) throw new Error(wantVersion ? `버전 ${wantVersion} 없음` : '심사 중인 버전이 없습니다');
  return { version: v.attributes.versionString, state: stateOf(v.attributes) };
}

const stamp = () => new Date().toTimeString().slice(0, 8);

let first;
try {
  first = await fetchVersion();
} catch (e) {
  console.error('시작 실패:', e.message);
  process.exit(1);
}
console.log(`${stamp()} 감시 시작 — ${first.version}: ${first.state} (${intervalSec}초 간격)`);

while (Date.now() < DEADLINE) {
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
  let now;
  try {
    now = await fetchVersion();
  } catch (e) {
    // 일시적인 네트워크/5xx 로 감시가 죽으면 안 된다 — 다음 주기에 다시 본다.
    console.log(`${stamp()} 조회 실패(계속 대기): ${e.message.slice(0, 90)}`);
    continue;
  }
  if (now.state !== first.state) {
    console.log(`${stamp()} 🔔 상태 변화: ${first.version} ${first.state} → ${now.state}`);
    // 사람이 바로 판단할 수 있게 의미까지 적어 준다.
    const meaning = {
      READY_FOR_SALE: '심사 통과 + 출시 완료',
      PENDING_DEVELOPER_RELEASE: '심사 통과 — 수동 출시 대기(appstore-release.mjs --release)',
      REJECTED: '거부 — Resolution Center 확인 필요',
      METADATA_REJECTED: '메타데이터 거부 — Resolution Center 확인 필요',
      DEVELOPER_REJECTED: '개발자가 내림',
      IN_REVIEW: '심사 시작됨',
      PENDING_APPLE_RELEASE: '심사 통과 — 애플 출시 대기',
    }[now.state];
    if (meaning) console.log(`   → ${meaning}`);
    process.exit(0);
  }
  console.log(`${stamp()} ${now.version}: ${now.state} (변화 없음)`);
}

console.error('48시간 안에 상태가 바뀌지 않았습니다 — 직접 확인하세요.');
process.exit(2);
