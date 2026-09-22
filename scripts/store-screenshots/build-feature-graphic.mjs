/**
 * Google Play feature graphic — 1024×500.
 *
 * This is the banner at the top of the Play listing, so it carries the brand
 * harder than any screenshot. It is NOT produced by compose.mjs (that one only
 * makes phone/tablet screenshots), which is exactly why the 2026-08 rebrand
 * nearly shipped with the old SyncLink banner still in place.
 *
 * Usage:  node scripts/store-screenshots/build-feature-graphic.mjs
 * Output: images/store/feature-graphic.png
 * Upload: node play.mjs images ko-KR featureGraphic=<dir containing only this file>
 */

import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const require = createRequire(`${REPO}/`);
const { chromium } = require('playwright');

/** Same tokens as the screenshot frames so the listing reads as one set. */
const BRAND = {
  name: '우리하루',
  tagline: '할 일도 일정도\n말하듯 한 줄로',
  bullets: ['말하듯 한 줄 입력', '함께 쓰는 캘린더', '모임 날짜 투표'],
  /** 1.5.0 「우리하루」: 짙은 민트(앱 라이트 primary) — 스크린샷 프레임(compose.mjs)과 같은 값 */
  accent: '#2A8466',
  logo: path.join(REPO, 'images/UriharuLogo.png'),
};

const OUT_DIR = path.join(REPO, 'images/store');
mkdirSync(OUT_DIR, { recursive: true });

const logo = `data:image/png;base64,${readFileSync(BRAND.logo).toString('base64')}`;
const A = BRAND.accent;
/** 앱과 같은 글꼴을 data URI 로 심는다(compose.mjs 와 같은 방식) */
const fontFace = (family, file) =>
  `@font-face{font-family:${family};src:url(data:font/ttf;base64,${readFileSync(path.join(REPO, 'assets/fonts', file)).toString('base64')}) format('truetype');}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });

await page.setContent(`<style>
${fontFace('UriTitle', 'Jua-Regular.ttf')}${fontFace('UriBody', 'NanumSquareRoundB.ttf')}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1024px;height:500px;display:flex;align-items:center;gap:52px;padding:0 76px;
 font-family:UriBody,"Apple SD Gothic Neo",-apple-system,sans-serif;color:#23413A;
 background:
   radial-gradient(ellipse 700px 420px at 14% -12%, #FFFFFFcc 0%, transparent 62%),
   radial-gradient(ellipse 560px 340px at 106% 112%, #6CCFAE40 0%, transparent 60%),
   linear-gradient(158deg,#E4F8EF 0%,#CDEFE1 50%,#B3E8D4 100%)}
.tile{width:196px;height:196px;border-radius:46px;overflow:hidden;flex:none;
 box-shadow:0 16px 40px rgba(47,94,80,.25),0 0 90px #6CCFAE66}
.tile img{width:100%;height:100%;object-fit:cover}
h1{font-family:UriTitle,sans-serif;font-size:68px;font-weight:normal;letter-spacing:-.01em;line-height:1.12;color:${A}}
p{margin-top:14px;font-size:29px;font-weight:600;line-height:1.32;white-space:pre-line;
  color:rgba(35,65,58,.78);letter-spacing:-.015em}
.pills{display:flex;gap:11px;margin-top:24px}
.pills span{font-size:18px;font-weight:600;padding:10px 18px;border-radius:999px;
 background:rgba(255,255,255,.75);box-shadow:inset 0 0 0 2px #6CCFAE}
</style>
<div class="tile"><img src="${logo}"></div>
<div>
  <h1>${BRAND.name}</h1>
  <p>${BRAND.tagline}</p>
  <div class="pills">${BRAND.bullets.map((b) => `<span>${b}</span>`).join('')}</div>
</div>`);

// Korean glyphs render as boxes if the shot fires before fonts settle.
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(OUT_DIR, 'feature-graphic.png') });
await browser.close();
console.log('✅ images/store/feature-graphic.png (1024×500)');
