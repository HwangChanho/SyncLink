#!/usr/bin/env node
/**
 * capture.mjs — Grab clean app screens off the local dev web build for store screenshots.
 *
 * Why the dev web and not a simulator: there is no iPhone/iPad hardware or iOS simulator on this
 * machine, and the app is fully responsive, so the web build at an exact device viewport is the
 * only way to hit App Store pixel specs. (Same approach used for the 1.3.4 iPad shots.)
 *
 * Guest mode is deliberate: guests see seeded demo data, while the e2e accounts are empty and
 * render "없어요" empty states everywhere — bad for a store listing.
 *
 * Usage: node capture.mjs <profile>        profile = phone | tablet
 * Output: shots/<outDir>/<name>.png at exactly the store's pixel size.
 */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2ePassword } from '../lib/e2e-credentials.mjs';

const require = createRequire('/Users/danielhwang/Desktop/Projects/syncday/syncday/');
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = 'http://localhost:8088';

/**
 * Viewports are CSS px; deviceScaleFactor multiplies to the store's required pixel size.
 * phone : 642x1389 @2 = 1284x2778 (App Store 6.5")
 * tablet: 1024x1366 @2 = 2048x2732 (App Store iPad Pro 12.9")
 */
const PROFILES = {
  phone: { width: 642, height: 1389, dsf: 2, outDirs: ['iphone65', 'playphone'] },
  tablet: { width: 1024, height: 1366, dsf: 2, outDirs: ['ipad129', 'playtablet'] },
};

/**
 * Screens to capture. `wait` gives async data (holidays, spaces) time to land.
 * Guest mode covers home/calendar (seeded demo data); the rest gate behind auth
 * ("로그인이 필요해요"), so they are captured in a second, signed-in pass.
 */
const SCREENS_GUEST = [
  { name: 'home', path: '/', wait: 4000 },
  { name: 'calendar', path: '/calendar', wait: 4500 },
];

const SCREENS_AUTH = [
  { name: 'planner', path: '/planner', wait: 4000 },
  { name: 'spaces', path: '/spaces', wait: 4500 },
  { name: 'analytics', path: '/analytics', wait: 5000 },
  // The demo Space carries 9 members, so the detail view actually looks populated.
  { name: 'spaceDetail', path: '/space/f494c953-bcf0-4b96-89bc-ce9ca859fb43', wait: 5000, patch: 'space' },
  // 투표(모임 날짜 정하기)는 스페이스 상세 하단에 있어 그냥 찍으면 화면 밖이다.
  // Play 짧은 설명이 "모임 날짜까지 정해요" 라고 약속하는 기능이라 전용 컷이 필요하다.
  {
    name: 'poll',
    path: '/space/f494c953-bcf0-4b96-89bc-ce9ca859fb43',
    wait: 5000,
    patch: 'space',
    scrollToText: '투표',
  },
];

/**
 * Cosmetic, screenshot-only relabeling of the QA space.
 * The members are real e2e rigs named "iOS Sim Pro" / "AND Dev Free" / "e2e", which look like
 * test scaffolding in a public store listing. This rewrites the rendered text in the page only —
 * nothing is written back to Supabase, so QA data stays exactly as it is.
 */
const SPACE_LABELS = {
  'E2E Test Space': '우리 가족',
  'iOS Sim Pro': '지민',
  'iOS Sim Free': '서준',
  'AND Sim Pro': '하윤',
  'AND Sim Free': '도윤',
  'AND Dev Pro': '예은',
  'AND Dev Free': '시우',
  'Web Pro': '수아',
  'Web Free': '준서',
  e2e: '유나',
};

/**
 * Swap the demo labels in, including the single-letter avatar initials so they stay consistent.
 * @param {import('playwright').Page} page
 */
async function patchSpaceLabels(page) {
  const changed = await page.evaluate((map) => {
    /** Collect every text node once; editing nodeValue leaves the element tree intact. */
    const textNodes = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const out = [];
      while (w.nextNode()) out.push(w.currentNode);
      return out;
    };

    // Pass 1 — swap the labels themselves. Works even when the name shares a parent
    // with a suffix element such as the "(나)" you-marker.
    let n = 0;
    for (const node of textNodes()) {
      const t = node.nodeValue.trim();
      if (map[t]) {
        node.nodeValue = node.nodeValue.replace(t, map[t]);
        n++;
      }
    }

    // Pass 2 — avatars render a single Latin initial of the old name, which now mismatches.
    // Re-derive each from the Korean name found in the same row.
    const newNames = Object.values(map);
    for (const node of textNodes()) {
      const initial = node.nodeValue.trim();
      if (!/^[A-Za-z]$/.test(initial)) continue;
      // Climb until a row whose text reads "<initial><name>…" — matching on the text that
      // directly follows the initial keeps rows with a "(나)" suffix from borrowing the
      // name of an earlier row.
      let el = node.parentElement;
      for (let up = 0; up < 5 && el; up++, el = el.parentElement) {
        const rest = el.textContent.trim().replace(initial, '').trim();
        const name = newNames.find((v) => rest.startsWith(v));
        if (name) {
          node.nodeValue = name.charAt(0);
          break;
        }
      }
    }
    return n;
  }, SPACE_LABELS);
  console.log(`· relabeled ${changed} space labels (render-only)`);
}

/** Dev-only login form, present because the bundle is built with APP_ENV=development. */
const DEV_ACCOUNT = { email: 'e2e-web-pro@synclink.test', password: e2ePassword() };

/**
 * Sign in through the dev login form.
 * @param {import('playwright').Page} page
 */
async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(12000);
  await page.locator('[data-testid="login-dev-email"]').fill(DEV_ACCOUNT.email);
  await page.locator('[data-testid="login-dev-password"]').fill(DEV_ACCOUNT.password);
  await page.locator('[data-testid="login-dev-submit"]').click();
  await page.waitForTimeout(9000);
  console.log(`· signed in as ${DEV_ACCOUNT.email} (url=${page.url()})`);
}

/**
 * Post-login the router parks on /onboarding and its guard bounces every other route back
 * here, so it has to be dismissed before anything else can be captured.
 * @param {import('playwright').Page} page
 */
async function dismissOnboarding(page) {
  for (let i = 0; i < 6 && page.url().includes('onboarding'); i++) {
    const skip = page.getByText('건너뛰기', { exact: true }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      const next = page.getByText(/^(다음|시작하기)$/).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.waitForTimeout(2500);
  }
  console.log(`· onboarding dismissed (url=${page.url()})`);
}

/**
 * Give the planner real rows. The e2e account is empty, and an empty-state screenshot
 * ("할일 없음") is exactly what we're trying to get away from.
 * Idempotency is not a concern: duplicates would only make the list longer, and we
 * capture immediately after.
 */
async function seedTodos(page) {
  const titles = ['장보기 — 우유, 계란', '운동 30분', '주간 보고서 정리', '엄마 생신 선물 준비'];
  await page.goto(`${BASE}/planner`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(12000);
  for (const title of titles) {
    await page.locator('[data-testid="planner-fab-todo"]').click();
    await page.waitForTimeout(1400);
    await page.locator('[data-testid="todo-create-title-input"]').fill(title);
    await page.locator('[data-testid="todo-create-save"]').click();
    await page.waitForTimeout(2000);
  }
  console.log(`· seeded ${titles.length} todos`);
}

/**
 * Capture the 1.3.5 interactive onboarding (the release's headline feature) with the
 * natural-language preview already populated, which is the moment worth showing.
 * Must run before the onboarding is dismissed.
 */
async function captureOnboarding(page, outDirs) {
  // Page 1 → page 2, where NLTryItDemo lives.
  const next = page.getByText(/^(다음|시작하기)$/).first();
  if (await next.isVisible().catch(() => false)) {
    await next.click();
    await page.waitForTimeout(2500);
  }
  const chip = page.locator('[data-testid="onboarding-try-chip"]').first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    // Let the local parser render its preview card.
    await page.waitForTimeout(2500);
  } else {
    console.log('! onboarding chip not visible — capturing page as-is');
  }
  for (const dir of outDirs) {
    await page.screenshot({ path: resolve(HERE, 'shots', dir, 'onboarding.png') });
    console.log(`✓ ${dir}/onboarding.png`);
  }
}

/**
 * Capture the D-day(상대일 일정) editor with a filled-in example.
 *
 * 1.4.4 store refresh: this is a real feature since 1.3.2 that no store shot ever showed.
 * It cannot be a plain SCREENS entry — the fields only exist once the toggle is on, so the
 * shot has to be driven: title → toggle → +N days → preset label, then scroll it into view.
 *
 * The example mirrors the in-app hint ("발급일·주문일에서 며칠 뒤"): 택배 3일 뒤 도착예상.
 * @param {import('playwright').Page} page
 * @param {string[]} outDirs
 */
async function captureDday(page, outDirs) {
  await page.goto(`${BASE}/event/create`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(14000);

  await page.locator('[data-testid="event-create-title-input"]').fill('택배 도착');
  await page.waitForTimeout(600);

  // RN-web renders <Switch> as a checkbox input, and the section carries no testID.
  // Walking up the DOM picks up an unrelated switch (the first one in that subtree is
  // 종일, not this one), so match on geometry: the checkbox sharing the heading's row.
  const toggled = await page.evaluate(() => {
    const head = [...document.querySelectorAll('div,span')].find((e) =>
      e.textContent?.trim().startsWith('상대일 일정') && e.getBoundingClientRect().height > 0);
    if (!head) return false;
    const hr = head.getBoundingClientRect();
    const mid = hr.top + hr.height / 2;
    const [nearest] = [...document.querySelectorAll('input[type="checkbox"]')]
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { b, d: Math.abs(r.top + r.height / 2 - mid) };
      })
      .sort((a, z) => a.d - z.d);
    if (!nearest || nearest.d > 60) return false;
    nearest.b.click();
    return true;
  });
  if (!toggled) throw new Error('상대일 일정 토글을 찾지 못했습니다');
  await page.waitForTimeout(1800);

  // Stepper: bump the default 1일 up to 3일 to match the hint's 택배 example.
  // The buttons render as plain text nodes, so pick the "+" on the "N일 뒤" row.
  for (let i = 0; i < 2; i++) {
    const bumped = await page.evaluate(() => {
      const label = [...document.querySelectorAll('div,span')].find((e) =>
        e.textContent?.trim() === 'N일 뒤' && e.getBoundingClientRect().height > 0);
      if (!label) return false;
      const lr = label.getBoundingClientRect();
      const mid = lr.top + lr.height / 2;
      const plus = [...document.querySelectorAll('div,span')]
        .filter((e) => e.textContent?.trim() === '+' && e.getBoundingClientRect().height > 0)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { e, d: Math.abs(r.top + r.height / 2 - mid) };
        })
        .sort((a, z) => a.d - z.d)[0];
      if (!plus || plus.d > 60) return false;
      plus.e.click();
      return true;
    });
    if (!bumped) throw new Error('N일 뒤 스테퍼를 찾지 못했습니다');
    await page.waitForTimeout(500);
  }
  await page.getByText('도착예상', { exact: true }).first().click();
  await page.waitForTimeout(1200);

  // The web build renders 기준일 as a native <input type="date">, which Chromium paints
  // in US order (08/23/2026) regardless of the ko-KR locale. The app on a phone shows
  // `toLocaleDateString('ko', …)` instead, so repaint it to match — render-only, the
  // stored value is untouched. Same spirit as patchSpaceLabels.
  await page.evaluate(() => {
    const input = document.querySelector('input[type="date"]');
    if (!input) return;
    const [y, m, d] = input.value.split('-').map(Number);
    if (!y) return;
    const label = document.createElement('div');
    label.textContent = new Date(y, m - 1, d).toLocaleDateString('ko', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const cs = getComputedStyle(input);
    label.style.cssText = `font-size:16px;color:${cs.color};font-family:${cs.fontFamily};`;
    input.replaceWith(label);
  });

  // The QA space is literally named "E2E Test Space" — test scaffolding has no place
  // in a public listing, so reuse the same render-only relabeling as the other shots.
  await patchSpaceLabels(page);

  // The section sits below the fold on the create form; bring it up so the live
  // "목표일: … (D-3)" preview is what the frame shows.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div,span')].find((e) =>
      e.textContent?.trim().startsWith('상대일 일정') && e.getBoundingClientRect().height > 0);
    if (!el) return;
    const scrollable = (node) => {
      for (let n = node.parentElement; n; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
      }
      return document.scrollingElement || document.documentElement;
    };
    const sc = scrollable(el);
    sc.scrollTop = Math.max(0, sc.scrollTop + el.getBoundingClientRect().top - 220);
  });
  await page.waitForTimeout(1200);

  for (const dir of outDirs) {
    await page.screenshot({ path: resolve(HERE, 'shots', dir, 'dday.png') });
    console.log(`✓ ${dir}/dday.png`);
  }
}

const profileName = process.argv[2] || 'phone';
const authMode = process.argv.includes('--auth');
const seedMode = process.argv.includes('--seed');
const onboardingMode = process.argv.includes('--onboarding');
const ddayMode = process.argv.includes('--dday');
const SCREENS = onboardingMode || ddayMode ? [] : authMode ? SCREENS_AUTH : SCREENS_GUEST;
const p = PROFILES[profileName];
if (!p) throw new Error(`usage: capture.mjs <${Object.keys(PROFILES).join('|')}>`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: p.width, height: p.height },
  deviceScaleFactor: p.dsf,
  // The app follows the system theme; the store frames are dark, so pin dark for consistency.
  colorScheme: 'dark',
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
});

for (const dir of p.outDirs) mkdirSync(resolve(HERE, 'shots', dir), { recursive: true });

if (authMode || onboardingMode || ddayMode) await login(page);
// The onboarding shot has to be taken while the flow is still on screen.
if (onboardingMode) await captureOnboarding(page, p.outDirs);
if (ddayMode) {
  await dismissOnboarding(page);
  await captureDday(page, p.outDirs);
}
if (authMode) {
  await dismissOnboarding(page);
  if (seedMode) await seedTodos(page);
}

for (const s of SCREENS) {
  await page.goto(`${BASE}${s.path}`, { waitUntil: 'load', timeout: 60000 });
  // Metro-served bundles finish rendering well after `load`; fixed waits are what worked before.
  await page.waitForTimeout(12000 + s.wait);
  if (s.patch === 'space') await patchSpaceLabels(page);
  // Scroll a named section to the top of the viewport. RN-web renders headings as
  // plain elements, so match on the visible text rather than a testID that does not exist.
  if (s.scrollToText) {
    const moved = await page.evaluate((needle) => {
      const el = [...document.querySelectorAll('div,span')]
        .find((e) => e.textContent?.trim() === needle && e.getBoundingClientRect().height > 0);
      if (!el) return false;
      el.scrollIntoView({ block: 'start' });
      // scrollIntoView alone leaves the section partway down: RN-web scrolls an
      // inner container, not the document, and the sticky header offsets it.
      // Measure where it landed and scroll the real scrollable ancestor the rest.
      //
      // Note: a section near the end of the page cannot reach the top — the
      // container runs out of scroll first. 투표 is one of those (only 빈 시간 찾기
      // and the leave button sit below it), so it lands mid-screen by necessity.
      const scrollableAncestor = (node) => {
        for (let n = node.parentElement; n; n = n.parentElement) {
          const oy = getComputedStyle(n).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
        }
        return document.scrollingElement || document.documentElement;
      };
      const sc = scrollableAncestor(el);
      // 64px keeps the sticky header from covering the section title.
      const delta = el.getBoundingClientRect().top - 64;
      sc.scrollTop = Math.max(0, sc.scrollTop + delta);
      return true;
    }, s.scrollToText);
    if (!moved) console.log(`! scrollToText "${s.scrollToText}" not found — capturing unscrolled`);
    await page.waitForTimeout(1200);
  }
  for (const dir of p.outDirs) {
    const out = resolve(HERE, 'shots', dir, `${s.name}.png`);
    await page.screenshot({ path: out });
    console.log(`✓ ${dir}/${s.name}.png`);
  }
}

await browser.close();
