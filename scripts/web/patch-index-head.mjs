#!/usr/bin/env node
/**
 * patch-index-head — 웹 빌드 산출물(dist/index.html)의 <head> 에 제목·설명·OG 를 심는다.
 *
 * 왜 후처리인가:
 *   `app.json` 의 `expo.web.output` 이 `single`(SPA) 이라 Expo 가 index.html 을 자체
 *   템플릿으로 찍는다. 이때 <title> 은 `expo.name` 에서 오는데 그 값은 **"SyncLink"**
 *   에 묶여 있다 — 한글로 바꾸면 prebuild 가 Xcode 프로젝트를 개명해 fastlane 경로와
 *   AppGroupBridge 가 깨진다(리브랜딩 때 확인된 제약). 그래서 웹만 1.4.0 리브랜딩에서
 *   빠진 채 옛 이름을 계속 내보내고 있었고, 설명·OG 태그는 아예 없었다.
 *   구글·네이버에서 "투투리스트" 로는 잡히지 않고, 카카오톡에 링크를 붙여도 카드가
 *   "SyncLink" 로 떴다.
 *
 *   Expo Router 의 `+html.tsx` 는 이 경우 답이 아니다 — **static 렌더링 전용**이라
 *   `output: single` 에서는 무시된다(2026-08-24 실측: 파일을 넣고 `--clear` 로 재빌드해도
 *   제목이 그대로였다). web:build 가 이미 dist 를 후처리(vendor 리네임)하므로 같은 자리에서
 *   head 를 고치는 편이 확실하다.
 *
 * 사용: node scripts/web/patch-index-head.mjs [dist 경로]   (기본 ./dist)
 * 멱등하다 — 이미 심어져 있으면 값만 갱신한다.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.argv[2] ?? 'dist');
const FILE = path.join(DIST, 'index.html');

const SITE = 'https://synclink.pages.dev';
const TITLE = '투투리스트 — 할 일도 일정도, 말하듯 한 줄로';
const DESCRIPTION =
  '할 일과 일정을 말하듯 한 줄로. 커플·가족·팀과 함께 쓰는 공유 캘린더로 모임 날짜까지 정해요. iOS·Android·웹 어디서나.';
/** 랜딩(/get/)과 같은 카드를 써서 어디서 공유되든 같은 그림이 뜨게 한다. */
const OG_IMAGE = `${SITE}/get/og.png`;

/** HTML 속성값에 그대로 넣기 위한 최소 이스케이프. */
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const META = [
  `<meta name="description" content="${attr(DESCRIPTION)}" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:site_name" content="투투리스트" />`,
  `<meta property="og:title" content="${attr(TITLE)}" />`,
  `<meta property="og:description" content="${attr(DESCRIPTION)}" />`,
  `<meta property="og:image" content="${attr(OG_IMAGE)}" />`,
  `<meta property="og:url" content="${attr(SITE)}" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
].join('\n    ');

const MARK_OPEN = '<!-- brand-head:start -->';
const MARK_CLOSE = '<!-- brand-head:end -->';

if (!existsSync(FILE)) {
  console.error(`${FILE} 가 없습니다 — expo export 를 먼저 실행하세요.`);
  process.exit(1);
}

let html = readFileSync(FILE, 'utf8');
const before = html;

// 1) <title> 교체. Expo 템플릿은 항상 하나만 찍는다.
if (!/<title>[\s\S]*?<\/title>/.test(html)) {
  console.error('index.html 에 <title> 이 없습니다 — Expo 템플릿이 바뀌었는지 확인하세요.');
  process.exit(1);
}
html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`);

// 2) meta 블록 주입/갱신 (마커로 감싸 멱등하게).
const block = `${MARK_OPEN}\n    ${META}\n    ${MARK_CLOSE}`;
if (html.includes(MARK_OPEN)) {
  html = html.replace(new RegExp(`${MARK_OPEN}[\\s\\S]*?${MARK_CLOSE}`), block);
} else {
  html = html.replace(/<\/title>/, `</title>\n    ${block}`);
}

// 3) lang 속성 — 검색엔진이 한국어 페이지로 인식하게.
//    Expo 템플릿은 `<html lang="en">` 으로 찍으므로 값 교체가 필요하다(추가만 해서는 안 된다).
html = /<html[^>]*\blang=/.test(html)
  ? html.replace(/(<html[^>]*\blang=")[^"]*(")/, '$1ko$2')
  : html.replace(/<html/, '<html lang="ko"');

writeFileSync(FILE, html);

// 되읽어 검증 — 조용히 실패하면 옛 브랜드가 그대로 배포된다.
const after = readFileSync(FILE, 'utf8');
const ok =
  after.includes(`<title>${TITLE}</title>`) &&
  after.includes('og:image') &&
  after.includes('lang="ko"');
console.log(`patch-index-head: ${FILE}`);
console.log(`  title/description/OG/lang 주입 ${ok ? '✅' : '❌'} (${before.length} → ${after.length}바이트)`);
if (!ok) process.exit(1);
