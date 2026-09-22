#!/usr/bin/env node
/**
 * compose.mjs — Turn raw app captures into App Store / Play marketing screenshots.
 *
 * Why: the store listings currently show bare screen captures. This wraps each capture in a
 * branded frame (gradient backdrop, Korean headline, device bezel) and prepends a logo hero
 * card, which is what LEAD asked for.
 *
 * Design system (derived from the app itself, so the store matches the product):
 *   1.5.0 「우리하루」: 어두운 캔버스 → **민트 파스텔**(아이콘 배경과 같은 계열).
 *   accent  #2A8466  = themePalette 라이트 primary(민트 hue 160, 대비 보정 L34)
 *   soft    #6CCFAE  = 아이콘 달력 띠(scripts/brand/icon-svg.mjs ICON_COLORS.band)
 *   글꼴    제목·워드마크 = 주아, 부제 = 나눔스퀘어라운드(앱과 같은 파일, assets/fonts)
 *
 * Usage:
 *   node compose.mjs <profile> [frameIndex]     e.g. `node compose.mjs iphone65` or `... iphone65 0`
 *   node compose.mjs --list
 *
 * Input : shots/<profile>/<source>.png     (raw app captures)
 * Output: out/<profile>/NN_<slug>.png      (store-ready, exact store pixel size)
 */

import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = '/Users/danielhwang/Desktop/Projects/syncday/syncday';
const require = createRequire(`${REPO}/`);
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO = `${REPO}/images/UriharuLogo.png`;

// --- Brand tokens ------------------------------------------------------------
const ACCENT = '#2A8466';
const ACCENT_SOFT = '#6CCFAE';
/** 본문 먹색 — 순수 검정보다 민트 배경과 어울리는 짙은 녹회색 */
const INK = '#23413A';

/** 앱과 같은 글꼴을 페이지에 심는다(setContent 페이지는 file:// 을 못 읽을 수 있어 data URI). */
const fontFace = (family, file) =>
  `@font-face{font-family:${family};src:url(data:font/ttf;base64,${readFileSync(`${REPO}/assets/fonts/${file}`).toString('base64')}) format('truetype');}`;
const FONT_CSS = fontFace('UriTitle', 'Jua-Regular.ttf') + fontFace('UriBody', 'NanumSquareRoundB.ttf');

/**
 * Device profiles.
 * `w`/`h` are the exact pixel dimensions the store requires.
 * The other numbers are laid out in CSS px at scale 1 (we render at deviceScaleFactor 1),
 * so they are literally the output pixels.
 */
const PROFILES = {
  // App Store — iPhone 6.5" display (also accepted for 6.7"/6.9" slots).
  iphone65: {
    w: 1284,
    h: 2778,
    pad: 96,
    titleTop: 150,
    titleSize: 95,
    subSize: 45,
    deviceW: 1030,
    deviceTop: 690,
    bezel: 15,
    radius: 78,
    logoTile: 470,
    logoRadius: 108,
  },
  // App Store — iPad Pro 12.9" (3rd gen) slot. Required because supportsTablet is on.
  ipad129: {
    w: 2048,
    h: 2732,
    pad: 150,
    titleTop: 170,
    titleSize: 112,
    subSize: 54,
    deviceW: 1560,
    deviceTop: 780,
    bezel: 18,
    radius: 60,
    logoTile: 520,
    logoRadius: 118,
  },
  // Google Play — phone screenshots (9:16, comfortably inside Play's limits).
  playphone: {
    w: 1080,
    h: 1920,
    pad: 78,
    titleTop: 118,
    titleSize: 76,
    subSize: 36,
    deviceW: 740,
    deviceTop: 530,
    bezel: 11,
    radius: 58,
    logoTile: 300,
    logoRadius: 70,
  },
  // Google Play — 10" tablet slot (currently empty; also feeds the 7" slot).
  playtablet: {
    w: 1600,
    h: 2560,
    pad: 120,
    titleTop: 150,
    titleSize: 96,
    subSize: 46,
    deviceW: 1210,
    deviceTop: 700,
    bezel: 14,
    radius: 48,
    logoTile: 420,
    logoRadius: 96,
  },
};

/**
 * Frame copy. `source` names a capture in shots/<profile>/.
 * Frame 0 is the logo hero LEAD asked to lead with, so it has no source capture.
 */
const PHONE_FRAMES = [
  { kind: 'hero', slug: 'hero', title: '우리하루', sub: '할 일도 일정도, 말하듯 한 줄로' },
  {
    slug: 'nl-input',
    source: 'home',
    title: '말하듯 입력하면\n일정이 완성돼요',
    sub: '오늘 일정도, 다가오는 약속도 홈에서 한 번에',
  },
  {
    slug: 'try-it',
    source: 'onboarding',
    title: '“내일 오후 3시 팀 회의”\n한 줄이면 끝',
    sub: '시작할 때 직접 입력해 보며 바로 익숙해져요',
  },
  {
    slug: 'calendar',
    source: 'calendar',
    title: '한눈에 들어오는\n캘린더',
    sub: '월·주·일 보기와 공휴일까지 한 번에',
  },
  {
    slug: 'space',
    source: 'spaceDetail',
    title: '가족·연인·팀과\n일정을 공유',
    sub: '모두가 되는 빈 시간까지 자동으로',
  },
  {
    slug: 'poll',
    source: 'poll',
    title: '모임 날짜는\n투표로 정해요',
    sub: '후보를 올리고 다 같이 고르면 일정으로 바로 확정',
  },
  {
    slug: 'planner',
    source: 'planner',
    title: '할 일과 노트를\n한 곳에',
    sub: '일정과 함께 관리하는 플래너',
  },
  // 1.3.2 부터 있던 상대일 일정인데 어느 스토어 컷에도 없었다(2026-08-23 추가).
  {
    slug: 'dday',
    source: 'dday',
    title: '“3일 뒤 도착”을\n날짜 계산 없이',
    sub: '기준일에 N일만 더하면 목표일과 D-day가 자동으로',
  },
  // 1.4.0 위젯 3종. 앱 화면이 아니라 실제 iOS 홈 화면 캡처다 — 웹 캡처로는 못 만든다.
  // 만드는 법은 seed-widget-sim.mjs / inject-widgets.py 주석 참고.
  {
    slug: 'widgets',
    source: 'widgets',
    title: '앱을 열지 않고\n홈 화면에서 바로',
    sub: '달력·할 일 위젯으로 확인하고 체크박스로 그 자리에서 완료',
  },
];

/** Tablet listings get a shorter, wider-format story. */
const TABLET_FRAMES = [
  { kind: 'hero', slug: 'hero', title: '우리하루', sub: '할 일도 일정도, 말하듯 한 줄로' },
  {
    slug: 'home',
    source: 'home',
    title: '넓은 화면에서\n더 편한 일정 관리',
    sub: '자연어 입력으로 바로 등록하세요',
  },
  {
    slug: 'calendar',
    source: 'calendar',
    title: '한눈에 들어오는\n캘린더',
    sub: '월·주·일 보기와 공휴일까지 한 번에',
  },
  {
    slug: 'space',
    source: 'spaceDetail',
    title: '가족·연인·팀과\n일정을 공유',
    sub: '모두가 되는 빈 시간까지 자동으로',
  },
];

const FRAMES_FOR = (profile) =>
  profile === 'ipad129' || profile === 'playtablet' ? TABLET_FRAMES : PHONE_FRAMES;

// --- Rendering ---------------------------------------------------------------
/** Inline a PNG as a data URI so the page needs no file:// permissions. */
const dataUri = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;

/**
 * Build the HTML for one marketing frame.
 * @param {object} p  profile geometry
 * @param {object} f  frame copy (+ kind)
 * @param {string|null} shot  data URI of the app capture, or null for the hero card
 */
function html(p, f, shot) {
  const isHero = f.kind === 'hero';
  return `<!doctype html><meta charset="utf-8"><style>
  ${FONT_CSS}
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${p.w}px; height:${p.h}px; overflow:hidden; }
  body {
    background:
      radial-gradient(ellipse ${p.w * 1.1}px ${p.h * 0.5}px at 50% -6%, #FFFFFFcc 0%, transparent 62%),
      radial-gradient(ellipse ${p.w * 0.9}px ${p.h * 0.4}px at 108% 74%, ${ACCENT_SOFT}40 0%, transparent 60%),
      linear-gradient(176deg, #E4F8EF 0%, #CDEFE1 50%, #B3E8D4 100%);
    font-family: UriBody, "Apple SD Gothic Neo", -apple-system, sans-serif;
    color:${INK}; -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column; align-items:center;
    position:relative;
  }
  .copy { width:100%; padding:${p.titleTop}px ${p.pad}px 0; text-align:center; }
  h1 {
    font-family: UriTitle, sans-serif; font-weight:normal;
    font-size:${p.titleSize}px; line-height:1.25; letter-spacing:-.01em;
    white-space:pre-line; text-wrap:balance;
  }
  .sub {
    margin-top:${Math.round(p.subSize * 0.72)}px; font-size:${p.subSize}px; font-weight:500;
    line-height:1.45; letter-spacing:-.012em; color:rgba(35,65,58,.72); white-space:pre-line;
  }
  /* Device mock: bezel + screen. It deliberately runs past the bottom edge. */
  .device {
    position:absolute; top:${p.deviceTop}px; left:50%; transform:translateX(-50%);
    width:${p.deviceW}px; padding:${p.bezel}px; border-radius:${p.radius}px;
    /* 귀여운 톤: 검은 베젤 대신 흰 베젤 + 민트빛 그림자 */
    background:#FFFFFF;
    box-shadow:
      0 ${Math.round(p.deviceW * 0.04)}px ${Math.round(p.deviceW * 0.1)}px rgba(47,94,80,.22),
      inset 0 0 0 1px rgba(47,94,80,.08);
  }
  .device img { display:block; width:100%; border-radius:${p.radius - p.bezel}px; }
  /* ---- hero card ---- */
  .hero { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
          gap:${Math.round(p.logoTile * 0.14)}px; padding:0 ${p.pad}px; }
  /* Concentric halo: keeps the tall canvas from reading as empty around the mark. */
  .halo { position:relative; display:flex; align-items:center; justify-content:center;
          width:${Math.round(p.logoTile * 2.5)}px; height:${Math.round(p.logoTile * 2.5)}px;
          margin-bottom:${Math.round(p.logoTile * -0.5)}px; margin-top:${Math.round(p.logoTile * -0.42)}px; }
  .halo::before, .halo::after {
    content:''; position:absolute; border-radius:50%;
    border:1px solid ${ACCENT}; opacity:.16;
  }
  .halo::before { width:${Math.round(p.logoTile * 1.62)}px; height:${Math.round(p.logoTile * 1.62)}px; }
  .halo::after  { width:${Math.round(p.logoTile * 2.34)}px; height:${Math.round(p.logoTile * 2.34)}px; opacity:.09; }
  .tile {
    width:${p.logoTile}px; height:${p.logoTile}px; border-radius:${p.logoRadius}px; overflow:hidden;
    position:relative;
    box-shadow:
      0 ${Math.round(p.logoTile * 0.08)}px ${Math.round(p.logoTile * 0.2)}px rgba(47,94,80,.25),
      0 0 ${Math.round(p.logoTile * 0.5)}px ${ACCENT_SOFT}66;
  }
  .tile img { width:100%; height:100%; object-fit:cover; }
  .wordmark { font-family: UriTitle, sans-serif; font-size:${Math.round(p.titleSize * 1.3)}px; font-weight:normal; letter-spacing:-.01em; color:${ACCENT}; }
  .tagline { font-size:${Math.round(p.subSize * 1.12)}px; font-weight:500; color:rgba(35,65,58,.75);
             letter-spacing:-.012em; text-align:center; }
  .bullets { display:flex; gap:${Math.round(p.subSize * 0.7)}px; margin-top:${Math.round(p.subSize * 0.9)}px;
             flex-wrap:wrap; justify-content:center; }
  .bullets span {
    font-size:${Math.round(p.subSize * 0.86)}px; font-weight:600; color:${INK};
    padding:${Math.round(p.subSize * 0.42)}px ${Math.round(p.subSize * 0.85)}px;
    border-radius:999px; background:rgba(255,255,255,.75);
    box-shadow:inset 0 0 0 2px ${ACCENT_SOFT};
  }
</style>
${
  isHero
    ? `<div class="hero">
         <div class="halo"><div class="tile"><img src="${dataUri(LOGO)}"></div></div>
         <!-- 워드마크는 프레임 정의의 title 을 그대로 쓴다. 하드코딩해 두면
              브랜드가 바뀔 때 여기만 남아 스크린샷에 옛 이름이 실린다. -->
         <div class="wordmark">${f.title}</div>
         <div class="tagline">${f.sub}</div>
         <!-- Play 짧은 설명("할 일도 일정도 말하듯 한 줄로. 함께 쓰는 캘린더로
              모임 날짜까지 정해요.")과 결을 맞춘 세 축. -->
         <div class="bullets"><span>말하듯 한 줄</span><span>함께 쓰는 캘린더</span><span>모임 날짜 투표</span></div>
       </div>`
    : `<div class="copy"><h1>${f.title}</h1><div class="sub">${f.sub}</div></div>
       <div class="device"><img src="${shot}"></div>`
}`;
}

// --- Main --------------------------------------------------------------------
const [profileName, only] = process.argv.slice(2);

if (!profileName || profileName === '--list') {
  console.log('profiles:', Object.keys(PROFILES).join(', '));
  process.exit(profileName ? 0 : 1);
}
const p = PROFILES[profileName];
if (!p) throw new Error(`unknown profile ${profileName}`);

const frames = FRAMES_FOR(profileName);
const outDir = resolve(HERE, 'out', profileName);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: p.w, height: p.h },
  deviceScaleFactor: 1,
});

let n = 0;
for (const [i, f] of frames.entries()) {
  if (only !== undefined && String(i) !== only) continue;
  const shotPath = f.source ? resolve(HERE, 'shots', profileName, `${f.source}.png`) : null;
  if (shotPath && !existsSync(shotPath)) {
    console.log(`skip ${f.slug}: missing capture ${shotPath}`);
    continue;
  }
  await page.setContent(html(p, f, shotPath ? dataUri(shotPath) : null), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = `${outDir}/${String(i + 1).padStart(2, '0')}_${f.slug}.png`;
  await page.screenshot({ path: out });
  console.log(`✓ ${out}`);
  n++;
}
await browser.close();
console.log(`${n} frame(s) → ${outDir}`);
