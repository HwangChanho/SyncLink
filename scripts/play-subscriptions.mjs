#!/usr/bin/env node
/**
 * play-subscriptions — Play 구독 상품 현황 조회.
 *
 *   node scripts/play-subscriptions.mjs
 *
 * 왜 필요한가: 2026-08-24 에 "Android 결제가 안 된다"를 파 보니 원인이 SDK 키가 아니라
 * **Play 에 구독 상품이 0개**인 것이었다. 결제 문제를 볼 때 제일 먼저 확인할 값이다.
 *
 * ── Android 결제가 되기까지 필요한 4단계 (하나라도 빠지면 "결제 불가" 알림만 뜬다)
 *  1. Play 구독 상품 + 기본 요금제가 **ACTIVE**            ← 이 스크립트로 확인
 *  2. RevenueCat 대시보드에 Play 앱 연결 + 상품을 `pro` entitlement 에 매핑,
 *     그리고 **Offering 의 `$rc_monthly` 슬롯**에 넣기 (대시보드 작업)
 *     🔴 paywall.tsx 가 `p.identifier === '$rc_monthly'` 로 필터한다 — 다른 슬롯에 넣으면
 *        키가 맞아도 화면에 아무 상품도 안 뜬다.
 *  3. `EXPO_PUBLIC_RC_API_KEY_ANDROID`(goog_…) 를 .env + EAS 환경변수에
 *     🔴 비어 있으면 _layout.tsx 가 initializePurchases 를 통째로 건너뛴다.
 *  4. 새 Android 빌드 출시 (EXPO_PUBLIC_* 는 번들에 인라인된다)
 *     ⚠️ OTA 로도 가능하지만 runtimeVersion=appVersion 이라 **라이브와 같은 버전**으로만 간다.
 *
 * ── 2026-08-24 에 이 스크립트와 같은 인증으로 만든 상품 (참고용 레시피)
 *   POST /androidpublisher/v3/applications/{pkg}/subscriptions
 *        ?productId=io.synclink.app.promonthly&regionsVersion.version=2022%2F02
 *   body: { listings:[{languageCode:'ko-KR', title, description}],
 *           basePlans:[{ basePlanId:'monthly',
 *                        autoRenewingBasePlanType:{billingPeriodDuration:'P1M'},
 *                        regionalConfigs:[{regionCode:'KR', newSubscriberAvailability:true,
 *                                          price:{currencyCode:'KRW',units:'3900'}}] }] }
 *   → 생성 직후 기본 요금제는 **DRAFT** 다. 활성화해야 구매 가능:
 *   POST .../subscriptions/{productId}/basePlans/{basePlanId}:activate
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'io.synclink.app';
const SA_PATH = path.join(REPO, 'credentials/google-play-service-account.json');

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
const tokenRes = await (
  await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64u(signer.sign(sa.private_key))}`,
    }),
  })
).json();
if (!tokenRes.access_token) {
  console.error('토큰 발급 실패:', JSON.stringify(tokenRes).slice(0, 200));
  process.exit(1);
}

const r = await fetch(
  `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/subscriptions?pageSize=50`,
  { headers: { Authorization: `Bearer ${tokenRes.access_token}` } },
);
const j = await r.json().catch(() => ({}));
if (!r.ok) {
  console.error(`HTTP ${r.status}`, JSON.stringify(j.error?.message ?? j).slice(0, 200));
  process.exit(1);
}

const subs = j.subscriptions ?? [];
console.log(`구독 상품 ${subs.length}개 (${PKG})`);
for (const s of subs) {
  console.log(`\n  ${s.productId}`);
  console.log(`    이름: ${s.listings?.[0]?.title ?? '(없음)'}`);
  for (const b of s.basePlans ?? []) {
    const rc = b.regionalConfigs?.[0];
    const period = b.autoRenewingBasePlanType?.billingPeriodDuration ?? '-';
    const price = rc ? `${Number(rc.price?.units ?? 0).toLocaleString()} ${rc.price?.currencyCode}` : '가격 없음';
    // DRAFT 면 스토어에서 구매가 안 된다 — 결제 장애 조사 때 제일 먼저 볼 값.
    console.log(`    요금제 ${b.basePlanId}: ${b.state}${b.state !== 'ACTIVE' ? ' ⚠️ 활성화 필요' : ''} · ${period} · ${price}`);
  }
}
if (!subs.length) {
  console.log('\n⚠️ 상품이 없으면 Android 에서 구독을 팔 수 없다 — 파일 상단 레시피 참고.');
}
