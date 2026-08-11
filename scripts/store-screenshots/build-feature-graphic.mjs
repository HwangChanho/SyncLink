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
  name: '투투리스트',
  tagline: '할 일도 일정도\n말하듯 한 줄로',
  bullets: ['말하듯 한 줄 입력', '함께 쓰는 캘린더', '모임 날짜 투표'],
  accent: '#6C63FF',
  logo: path.join(REPO, 'images/TwotwoLogo.png'),
};

const OUT_DIR = path.join(REPO, 'images/store');
mkdirSync(OUT_DIR, { recursive: true });

const logo = `data:image/png;base64,${readFileSync(BRAND.logo).toString('base64')}`;
const A = BRAND.accent;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });

await page.setContent(`<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1024px;height:500px;display:flex;align-items:center;gap:52px;padding:0 76px;
 font-family:"Apple SD Gothic Neo","Pretendard",-apple-system,sans-serif;color:#fff;
 background:
   radial-gradient(ellipse 700px 420px at 14% -12%, ${A}55 0%, transparent 62%),
   radial-gradient(ellipse 560px 340px at 106% 112%, ${A}30 0%, transparent 60%),
   linear-gradient(158deg,#14121f 0%,#0a0a12 48%,#050509 100%)}
.tile{width:196px;height:196px;border-radius:46px;overflow:hidden;background:#000;flex:none;
 box-shadow:0 18px 44px rgba(0,0,0,.6),0 0 92px ${A}4d,inset 0 0 0 2px rgba(255,255,255,.13)}
.tile img{width:100%;height:100%;object-fit:cover}
h1{font-size:60px;font-weight:800;letter-spacing:-.035em;line-height:1.12}
p{margin-top:14px;font-size:29px;font-weight:600;line-height:1.32;white-space:pre-line;
  color:rgba(255,255,255,.74);letter-spacing:-.015em}
.pills{display:flex;gap:11px;margin-top:24px}
.pills span{font-size:18px;font-weight:600;padding:10px 18px;border-radius:999px;
 background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
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
