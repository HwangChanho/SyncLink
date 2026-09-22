/**
 * Landing-page image assets for public/get/.
 *
 * Generates:
 *   - logo.png  512×512  — the hero tile / favicon (HTML renders it at 256, so
 *                          512 keeps it crisp on retina)
 *   - og.png   1200×630  — Open Graph card. This page is shared mostly through
 *                          KakaoTalk, so the card is what most people see first.
 *
 * Why this lives in the repo: it used to be a one-off script in a scratch
 * directory, which meant the only way to re-render the card after a brand
 * change was to rewrite the script from scratch. The 2026-08 rebrand needed
 * exactly that.
 *
 * Usage:  node scripts/landing/build-assets.mjs
 * Then verify the two PNGs and deploy with `npm run release:web`.
 */

import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'public/get');

const require = createRequire(`${REPO}/`);
const { chromium } = require('playwright');

/** Brand tokens — single source for both assets. */
const BRAND = {
  name: '우리하루',
  tagline: '할 일도 일정도, 말하듯 한 줄로',
  /** 브랜드 민트 — 아이콘 달력 띠와 같은 값(scripts/brand/icon-svg.mjs ICON_COLORS.band). */
  accent: '#6CCFAE',
  /** Full-bleed 1024 icon. NOT the adaptive variant — that one is cropped. */
  logo: path.join(REPO, 'images/UriharuLogo.png'),
};

mkdirSync(OUT, { recursive: true });

// ── og.png ──────────────────────────────────────────────────────────────────
const logoDataUri = `data:image/png;base64,${readFileSync(BRAND.logo).toString('base64')}`;
const A = BRAND.accent;

const browser = await chromium.launch();

// 웹 로고(public/get/logo.png)·파비콘은 scripts/brand/build-icons.mjs 가 SVG 원본에서
// 투명 배경으로 바로 렌더한다. 예전의 PNG 누끼(밝기·flood fill) 후처리는 필요 없어져 걷어냈다.

const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

await page.setContent(`<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 96px;
 font-family:"Apple SD Gothic Neo",-apple-system,sans-serif;color:#2F5E50;
 background:radial-gradient(ellipse 900px 500px at 18% -10%, #FFFFFF 0%, transparent 62%),
            linear-gradient(160deg,#D6F5E8 0%,#C4EEDD 55%,#B3E8D4 100%)}
.tile{width:224px;height:224px;border-radius:52px;overflow:hidden;flex:none;
 box-shadow:0 18px 44px rgba(47,94,80,.22)}
.tile img{width:100%;height:100%;object-fit:cover}
h1{font-size:88px;font-weight:800;letter-spacing:-.035em}
p{margin-top:20px;font-size:38px;font-weight:500;color:rgba(47,94,80,.78);letter-spacing:-.015em}
.pills{display:flex;gap:14px;margin-top:34px}
.pills span{font-size:25px;font-weight:600;padding:13px 26px;border-radius:999px;
 background:rgba(255,255,255,.7);box-shadow:inset 0 0 0 1px ${A}}
</style>
<div class="tile"><img src="${logoDataUri}"></div>
<div><h1>${BRAND.name}</h1><p>${BRAND.tagline}</p>
<div class="pills"><span>App Store</span><span>Google Play</span><span>웹</span></div></div>`);

// Korean glyphs render as boxes if the screenshot fires before fonts settle.
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(OUT, 'og.png') });
await browser.close();
console.log('✅ og.png (1200×630)');
