#!/usr/bin/env node
/**
 * store-reviews — 양 스토어의 별점·리뷰를 한 번에 보고, 승인된 답글을 게시한다.
 *
 *   node scripts/store-reviews.mjs                       # 요약 + 새 리뷰 + 답글 안 단 리뷰 (상태 저장)
 *   node scripts/store-reviews.mjs --no-save             # 조회만, 상태 파일을 갱신하지 않음
 *   node scripts/store-reviews.mjs --json                # 기계용 출력
 *   node scripts/store-reviews.mjs --reply ios <reviewId> <textFile>          # 게시 미리보기(dry-run)
 *   node scripts/store-reviews.mjs --reply android <reviewId> <textFile> --yes # 실제 게시
 *
 * ## 왜 필요한가 (2026-09-13 LEAD "양 스토어 모두 별점 관리해")
 * 두 스토어 콘솔을 따로 열어야 리뷰를 볼 수 있었고, Play 는 리뷰 이메일 알림도 꺼져 있었다.
 * 리뷰가 달려도 **알 방법이 없었다.** 이 스크립트가 두 스토어를 한 번에 대조하고,
 * 지난 실행 이후 **새로 생긴 것**만 골라 준다.
 *
 * ## 🔴 답글은 공개 글이다 — 반드시 LEAD 확인 후 `--yes`
 * 스토어 답글은 모든 사용자에게 보이고, 되돌려도 캐시·알림으로 이미 나갔을 수 있다.
 * 그래서 `--yes` 없이는 **절대 게시하지 않고** 미리보기만 한다. 초안은 Claude 가 쓰되
 * 게시 결정은 건별로 LEAD 가 한다.
 *
 * ## 답글 작성 원칙
 *  - 존댓말 · 감사 먼저 · 구체적인 불편에는 **구체적으로** 답한다(고친 버전·우회 방법)
 *  - 개인정보(이메일·계정)를 답글에 쓰지 않는다. 문의는 앱 안 "버그 제보"로 안내
 *  - 약속할 수 없는 일정("다음 주 수정")을 쓰지 않는다
 *  - 🔴 Play 답글은 **350자** 한도(API 가 거부한다). App Store 는 5,970자
 *
 * ## ⚠️ 알아둘 한계 (실측)
 *  - **App Store 의 글 없는 별점은 API 에 안 나온다.** customerReviews 는 글 리뷰만 준다 →
 *    별점 수·평균은 iTunes lookup(국가별)으로 따로 본다. 글 없는 별점에는 답글을 달 수 없다.
 *  - **Play Reviews API 는 최근 7일의 글 리뷰만** 돌려준다. 그보다 오래된 리뷰는 콘솔에서 봐야 한다
 *    → 이 스크립트를 **일주일에 한 번 이상** 돌려야 놓치지 않는다.
 *  - Play 는 앱 전체 평점(평균·개수)을 API 로 주지 않는다(콘솔 "평점" 화면만).
 *
 * 인증: credentials/AuthKey_2GBSCKXQJ4.p8 (ASC, ES256) · credentials/google-play-service-account.json (Play, RS256)
 * 상태: build/store-reviews-state.json (gitignore) — 본 리뷰 ID · 국가별 별점 수
 */

import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 설정 ─────────────────────────────────────────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASC = {
  keyId: '2GBSCKXQJ4',
  issuer: '5f89581a-d0c6-46c2-9461-78d5c08448fa',
  appId: '6763083903',
  keyPath: path.join(REPO, 'credentials/AuthKey_2GBSCKXQJ4.p8'),
};
const PLAY = {
  pkg: 'io.synclink.app',
  saPath: path.join(REPO, 'credentials/google-play-service-account.json'),
};
const STATE_PATH = path.join(REPO, 'build/store-reviews-state.json');

/**
 * iOS 별점을 볼 스토어(국가). 앱이 지원하는 언어권 + 주요 영어권.
 * 09-13 실측: 평점은 kr 에만 있었다(2개 · 3.0). 새 국가에서 평점이 생기면 여기 추가할 것.
 */
const IOS_STOREFRONTS = ['kr', 'us', 'jp', 'tw', 'hk', 'cn', 'sg', 'gb', 'ca', 'au'];

/** 스토어별 답글 길이 한도(API 가 넘으면 거부한다). */
const REPLY_LIMIT = { ios: 5970, android: 350 };

// ─── 인증 ─────────────────────────────────────────────────────────────────────

const b64u = (s) => Buffer.from(s).toString('base64url');

/** App Store Connect JWT (ES256, 15분). 🔴 만료는 최대 20분 — 더 길면 401. */
function ascToken() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    `${b64u(JSON.stringify({ alg: 'ES256', kid: ASC.keyId, typ: 'JWT' }))}.` +
    `${b64u(JSON.stringify({ iss: ASC.issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
  const s = createSign('SHA256');
  s.update(unsigned);
  s.end();
  return `${unsigned}.${b64u(s.sign({ key: readFileSync(ASC.keyPath, 'utf8'), dsaEncoding: 'ieee-p1363' }))}`;
}

/** Google Play OAuth 액세스 토큰 (서비스 계정 RS256). */
async function playToken() {
  const sa = JSON.parse(readFileSync(PLAY.saPath, 'utf8'));
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
  const s = createSign('RSA-SHA256');
  s.update(unsigned);
  s.end();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64u(s.sign(sa.private_key))}`,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Play 토큰 발급 실패: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

/**
 * JSON API 호출. 실패는 **값 없음으로 삼키지 않고** 던진다 —
 * "조회 실패"를 "리뷰 0건"으로 보고하면 감시가 거짓말을 한다(09-03 감시 루프 사고와 같은 모양).
 */
async function getJson(url, headers, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(/\?.*$/, '')} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

/**
 * iOS 국가별 별점 — iTunes lookup(공개 API, 인증 불필요).
 * @returns {{ country: string, count: number, average: number }[]} 평점이 있는 국가만
 */
async function iosRatings() {
  const out = [];
  for (const country of IOS_STOREFRONTS) {
    const j = await getJson(`https://itunes.apple.com/lookup?id=${ASC.appId}&country=${country}`, {});
    const r = j.results?.[0];
    if (r && r.userRatingCount > 0) {
      out.push({ country, count: r.userRatingCount, average: r.averageUserRating });
    }
  }
  return out;
}

/**
 * iOS 글 리뷰 전체(페이지네이션) + 개발자 답글 여부.
 * @returns {Review[]}
 */
async function iosReviews() {
  const headers = { Authorization: `Bearer ${ascToken()}` };
  let url = `https://api.appstoreconnect.apple.com/v1/apps/${ASC.appId}/customerReviews?sort=-createdDate&limit=200&include=response`;
  const reviews = [];
  while (url) {
    const j = await getJson(url, headers);
    for (const d of j.data ?? []) {
      const a = d.attributes;
      reviews.push({
        store: 'ios',
        id: d.id,
        rating: a.rating,
        title: a.title ?? '',
        body: a.body ?? '',
        date: a.createdDate,
        where: a.territory,
        version: null,
        replied: Boolean(d.relationships?.response?.data),
      });
    }
    url = j.links?.next ?? null;
  }
  return reviews;
}

/**
 * Play 글 리뷰(최근 7일 — API 한계) + 개발자 답글 여부.
 * @returns {Review[]}
 */
async function androidReviews() {
  const headers = { Authorization: `Bearer ${await playToken()}` };
  let url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY.pkg}/reviews?maxResults=100`;
  const reviews = [];
  while (url) {
    const j = await getJson(url, headers);
    for (const rv of j.reviews ?? []) {
      const user = rv.comments?.find((c) => c.userComment)?.userComment;
      const dev = rv.comments?.find((c) => c.developerComment)?.developerComment;
      reviews.push({
        store: 'android',
        id: rv.reviewId,
        rating: user?.starRating ?? null,
        title: '',
        body: (user?.text ?? '').trim(),
        date: user?.lastModified?.seconds ? new Date(Number(user.lastModified.seconds) * 1000).toISOString() : null,
        where: user?.reviewerLanguage ?? null,
        version: user?.appVersionName ?? null,
        replied: Boolean(dev),
      });
    }
    const token = j.tokenPagination?.nextPageToken;
    url = token
      ? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY.pkg}/reviews?maxResults=100&token=${encodeURIComponent(token)}`
      : null;
  }
  return reviews;
}

// ─── 상태 ─────────────────────────────────────────────────────────────────────

/** 지난 실행 상태. 없으면 첫 실행 — 이때는 전부 "새것"으로 보이지 않게 비교를 건너뛴다. */
function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null; // 깨졌으면 첫 실행처럼 다룬다(다음 저장에서 복구된다)
  }
}

function saveState(state) {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// ─── 답글 게시 ────────────────────────────────────────────────────────────────

/**
 * 답글을 게시한다. `yes` 가 false 면 미리보기만 한다.
 * @param {'ios'|'android'} store
 * @param {string} reviewId
 * @param {string} text 답글 본문
 * @param {boolean} yes 실제 게시 여부
 */
async function postReply(store, reviewId, text, yes) {
  if (!['ios', 'android'].includes(store)) throw new Error(`store 는 ios|android: ${store}`);
  const body = text.trim();
  if (!body) throw new Error('답글 본문이 비었습니다');
  // 글자 수는 코드포인트 기준(한글 1자 = 1). 한도를 넘기면 API 가 거부하므로 미리 막는다.
  const length = [...body].length;
  if (length > REPLY_LIMIT[store]) {
    throw new Error(`${store} 답글 한도 ${REPLY_LIMIT[store]}자 초과 (${length}자)`);
  }

  console.log(`\n[${yes ? '게시' : '미리보기'}] ${store} review=${reviewId} (${length}자)\n---\n${body}\n---`);
  if (!yes) {
    console.log('🔒 --yes 가 없어 게시하지 않았습니다. LEAD 확인 후 --yes 를 붙이세요.');
    return;
  }

  if (store === 'ios') {
    const headers = { Authorization: `Bearer ${ascToken()}`, 'Content-Type': 'application/json' };
    const created = await getJson('https://api.appstoreconnect.apple.com/v1/customerReviewResponses', headers, {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'customerReviewResponses',
          attributes: { responseBody: body },
          relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
        },
      }),
    });
    // 되읽기 — 게시 요청이 성공해도 상태가 PENDING_PUBLISH 일 수 있다(스토어 노출은 지연된다).
    console.log(`✅ App Store 답글 생성: id=${created.data?.id} state=${created.data?.attributes?.state}`);
  } else {
    const headers = { Authorization: `Bearer ${await playToken()}`, 'Content-Type': 'application/json' };
    const res = await getJson(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY.pkg}/reviews/${encodeURIComponent(reviewId)}:reply`,
      headers,
      { method: 'POST', body: JSON.stringify({ replyText: body }) },
    );
    console.log(`✅ Play 답글 게시: lastEdited=${res.result?.lastEdited?.seconds ?? '?'}`);
  }
}

// ─── 출력 ─────────────────────────────────────────────────────────────────────

const stars = (n) => (n == null ? '?' : '★'.repeat(n) + '☆'.repeat(5 - n));

function printReview(r) {
  const head = `${r.store === 'ios' ? 'App Store' : 'Play'} ${stars(r.rating)} ${r.date?.slice(0, 10) ?? '?'}`
    + `${r.where ? ` [${r.where}]` : ''}${r.version ? ` v${r.version}` : ''} ${r.replied ? '💬답글있음' : '⏳답글없음'}`;
  console.log(`  - ${head}\n    id=${r.id}${r.title ? `\n    제목: ${r.title}` : ''}\n    본문: ${r.body || '(없음)'}`);
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === '--reply') {
  const [, store, reviewId, textFile] = args;
  if (!store || !reviewId || !textFile) {
    console.error('usage: store-reviews.mjs --reply <ios|android> <reviewId> <textFile> [--yes]');
    process.exit(2);
  }
  try {
    await postReply(store, reviewId, readFileSync(textFile, 'utf8'), args.includes('--yes'));
  } catch (e) {
    // 스택 대신 원인 한 줄 — 한도 초과·권한·잘못된 ID 를 바로 구분할 수 있게.
    console.error(`🔴 답글 게시 안 됨: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const asJson = args.includes('--json');
const noSave = args.includes('--no-save');

// 한 스토어 조회가 실패해도 다른 스토어 결과는 보여 준다. 대신 실패는 **실패로** 표시한다.
const errors = [];
const settle = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${e.message}`);
    return null;
  }
};

const [ratings, ios, android] = await Promise.all([
  settle('iOS 별점', iosRatings),
  settle('iOS 리뷰', iosReviews),
  settle('Play 리뷰', androidReviews),
]);

const reviews = [...(ios ?? []), ...(android ?? [])];
const prev = loadState();
const seen = new Set(prev?.seenReviewIds ?? []);
const newReviews = prev ? reviews.filter((r) => !seen.has(`${r.store}:${r.id}`)) : [];
const unanswered = reviews.filter((r) => !r.replied && r.body);

// iOS 별점 변화 — 글 없는 별점은 리뷰 목록에 안 나오므로 개수 변화로만 감지한다.
const ratingChanges = [];
for (const r of ratings ?? []) {
  const before = prev?.iosRatings?.[r.country];
  if (prev && (!before || before.count !== r.count)) {
    ratingChanges.push({ country: r.country, from: before?.count ?? 0, to: r.count, average: r.average });
  }
}

const result = {
  checkedAt: new Date().toISOString(),
  firstRun: !prev,
  iosRatings: ratings,
  counts: { ios: ios?.length ?? null, android: android?.length ?? null },
  newReviews,
  unanswered,
  ratingChanges,
  errors,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`별점·리뷰 점검 ${result.checkedAt}${result.firstRun ? ' (첫 실행 — 기준선 저장)' : ` (지난 점검 ${prev.checkedAt})`}`);
  console.log(`\n■ App Store 별점: ${ratings === null ? '조회 실패' : ratings.length ? ratings.map((r) => `${r.country} ${r.count}개·${r.average}`).join(' / ') : '없음'}`);
  console.log(`■ 글 리뷰: App Store ${ios === null ? '조회 실패' : `${ios.length}건`} · Play(최근 7일) ${android === null ? '조회 실패' : `${android.length}건`}`);
  if (ratingChanges.length) {
    console.log('\n🆕 별점 수 변화');
    for (const c of ratingChanges) console.log(`  - ${c.country}: ${c.from} → ${c.to} (평균 ${c.average})`);
  }
  if (newReviews.length) {
    console.log(`\n🆕 새 리뷰 ${newReviews.length}건`);
    newReviews.forEach(printReview);
  }
  if (unanswered.length) {
    console.log(`\n⏳ 답글 안 단 글 리뷰 ${unanswered.length}건`);
    unanswered.forEach(printReview);
  }
  if (!ratingChanges.length && !newReviews.length && !unanswered.length) {
    console.log('\n변화 없음 · 답글 달 리뷰 없음');
  }
  if (errors.length) {
    console.log('\n🔴 조회 실패 — 아래 스토어는 "0건"이 아니라 "모름"입니다');
    errors.forEach((e) => console.log(`  - ${e}`));
  }
}

// 조회에 실패한 스토어가 있으면 상태를 덮어쓰지 않는다 — 다음 실행에서 그 사이 리뷰를 "새것"으로 다시 보여야 한다.
if (!noSave && errors.length === 0) {
  saveState({
    checkedAt: result.checkedAt,
    seenReviewIds: [...new Set([...seen, ...reviews.map((r) => `${r.store}:${r.id}`)])],
    iosRatings: Object.fromEntries((ratings ?? []).map((r) => [r.country, { count: r.count, average: r.average }])),
  });
}

process.exit(errors.length ? 1 : 0);
