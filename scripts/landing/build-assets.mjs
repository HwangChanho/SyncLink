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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'public/get');

const require = createRequire(`${REPO}/`);
const { chromium } = require('playwright');

/** Brand tokens — single source for both assets. */
const BRAND = {
  name: '투투리스트',
  tagline: '할 일도 일정도, 말하듯 한 줄로',
  /** Accent kept from the previous identity; only the mark and name changed. */
  accent: '#6C63FF',
  /** Full-bleed 1024 icon. NOT the adaptive variant — that one is cropped. */
  logo: path.join(REPO, 'images/TwotwoLogo.png'),
};

mkdirSync(OUT, { recursive: true });

/**
 * Cut the app-icon tile away and keep only the mark, on transparency.
 *
 * Why: the source is the **app icon** — a near-black rounded tile with the purple
 * outline + white check inside it. Stores require that opaque tile, but on the web it
 * reads as a dark box pasted onto the page. LEAD asked for the mark alone (누끼).
 *
 * 🔴 A plain luma key is not enough. The area *inside* the purple outline is the same
 * near-black as the tile, so keying by brightness punches it out too — and then the
 * white check vanishes on any light background (verified: on #fff only an empty purple
 * square remains). The favicon shows up on light browser tabs, so that breaks the mark.
 *
 * So the cut is by **shape, not brightness**: flood-fill the dark region inward from the
 * borders. Dark pixels reachable from outside are the tile → transparent. Dark pixels
 * enclosed by the purple stroke are the mark's own fill → kept. Edge pixels get partial
 * alpha from the brightness ramp, with colour un-premultiplied so they keep their hue.
 *
 * sharp is deliberately not used — it compiles from source on this project's CI image.
 * Playwright is already a dependency here for og.png, so the canvas does the work.
 *
 * @param {string} outPath  where to write the PNG
 * @param {number} size     output width/height in px
 */
async function writeCutoutLogo(browser, outPath, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const dataUri = await page.evaluate(
    async ([src, size]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const image = ctx.getImageData(0, 0, size, size);
      const d = image.data;
      const n = size * size;
      const level = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        level[i] = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255;
      }
      // 0.5 is a deliberately loose "dark" test so anti-aliased tile→stroke pixels are
      // swept into the flood too; their final alpha comes from the ramp below.
      const DARK = 0.5;
      const outside = new Uint8Array(n);
      const stack = [];
      for (let x = 0; x < size; x++) {
        stack.push(x, (size - 1) * size + x);
      }
      for (let y = 0; y < size; y++) {
        stack.push(y * size, y * size + size - 1);
      }
      while (stack.length) {
        const i = stack.pop();
        if (outside[i] || level[i] >= DARK) continue;
        outside[i] = 1;
        const x = i % size;
        const y = (i / size) | 0;
        if (x > 0) stack.push(i - 1);
        if (x < size - 1) stack.push(i + 1);
        if (y > 0) stack.push(i - size);
        if (y < size - 1) stack.push(i + size);
      }
      // Tile brightness tops out at 63/255 ≈ 0.247; 0.28 clears it with margin.
      const LO = 0.28;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (!outside[i]) continue; // enclosed → the mark itself, leave untouched
        const a = (level[i] - LO) / (1 - LO);
        if (a <= 0) {
          d[o + 3] = 0;
          continue;
        }
        d[o + 3] = Math.round(Math.min(1, a) * 255);
        d[o] = Math.min(255, Math.round(d[o] / level[i]));
        d[o + 1] = Math.min(255, Math.round(d[o + 1] / level[i]));
        d[o + 2] = Math.min(255, Math.round(d[o + 2] / level[i]));
      }
      ctx.putImageData(image, 0, 0);
      return c.toDataURL('image/png');
    },
    [`data:image/png;base64,${readFileSync(BRAND.logo).toString('base64')}`, size],
  );
  writeFileSync(outPath, Buffer.from(dataUri.split(',')[1], 'base64'));
  await page.close();
}

// ── og.png ──────────────────────────────────────────────────────────────────
const logoDataUri = `data:image/png;base64,${readFileSync(BRAND.logo).toString('base64')}`;
const A = BRAND.accent;

const browser = await chromium.launch();

// 웹에 나가는 로고 두 장은 타일을 벗긴 누끼로 만든다. 앱 아이콘(images/TwotwoLogo.png)
// 자체는 그대로 둔다 — 스토어는 불투명 아이콘을 요구한다.
await writeCutoutLogo(browser, path.join(OUT, 'logo.png'), 512);
console.log('✅ logo.png (512×512, 투명)');
await writeCutoutLogo(browser, path.join(REPO, 'assets/favicon.png'), 64);
console.log('✅ assets/favicon.png (64×64, 투명)');

const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

await page.setContent(`<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 96px;
 font-family:"Apple SD Gothic Neo",-apple-system,sans-serif;color:#fff;
 background:radial-gradient(ellipse 900px 500px at 18% -10%, ${A}55 0%, transparent 62%),
            radial-gradient(ellipse 700px 400px at 105% 110%, ${A}33 0%, transparent 60%),
            linear-gradient(160deg,#14121f 0%,#0a0a12 50%,#050509 100%)}
.tile{width:224px;height:224px;border-radius:52px;overflow:hidden;background:#000;flex:none;
 box-shadow:0 22px 54px rgba(0,0,0,.6),0 0 110px ${A}55,inset 0 0 0 2px rgba(255,255,255,.14)}
.tile img{width:100%;height:100%;object-fit:cover}
h1{font-size:88px;font-weight:800;letter-spacing:-.035em}
p{margin-top:20px;font-size:38px;font-weight:500;color:rgba(255,255,255,.72);letter-spacing:-.015em}
.pills{display:flex;gap:14px;margin-top:34px}
.pills span{font-size:25px;font-weight:600;padding:13px 26px;border-radius:999px;
 background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
</style>
<div class="tile"><img src="${logoDataUri}"></div>
<div><h1>${BRAND.name}</h1><p>${BRAND.tagline}</p>
<div class="pills"><span>App Store</span><span>Google Play</span><span>웹</span></div></div>`);

// Korean glyphs render as boxes if the screenshot fires before fonts settle.
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(OUT, 'og.png') });
await browser.close();
console.log('✅ og.png (1200×630)');
