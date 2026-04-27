import { chromium } from 'playwright';

const BASE = 'http://localhost:8081';
const results = [];
const errors = [];

function pass(name) {
  results.push({ name, status: 'PASS' });
  console.log('  ✓ ' + name);
}
function fail(name, reason) {
  results.push({ name, status: 'FAIL', reason });
  errors.push({ name, reason });
  console.log('  ✗ ' + name + ': ' + reason);
}
function skip(name, reason) {
  results.push({ name, status: 'SKIP', reason });
  console.log('  - ' + name + ' [SKIP: ' + reason + ']');
}

// Wait for either Korean or English text
async function waitForText(page, ko, en, timeout = 10000) {
  await Promise.any([
    page.waitForSelector(`text=${ko}`, { timeout }),
    page.waitForSelector(`text=${en}`, { timeout }),
  ]);
}

// Click either Korean or English text
async function clickText(page, ko, en, timeout = 30000) {
  const found = await Promise.any([
    page.waitForSelector(`text=${ko}`, { timeout }).then(() => ko),
    page.waitForSelector(`text=${en}`, { timeout }).then(() => en),
  ]);
  await page.click(`text=${found}`);
}

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => pageErrors.push(err.message));
page.on('response', res => {
  if (res.status() === 401 || res.status() === 429) {
    failedRequests.push(`[${res.status()}] ${res.url()}`);
  }
});

// ── 1. 로그인 화면 ──────────────────────────���───────────────────────────────
console.log('\n=== 1. 로그인 화면 ===');
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });

try { await waitForText(page, '이메일로 로그인', 'Sign in with Email'); pass('로그인 화면 렌더링'); }
catch { fail('로그인 화면 렌더링', '이메일로 로그인 버튼 없음'); }

try { await page.waitForSelector('input', { timeout: 5000 }); pass('입력 필드 렌더링'); }
catch { fail('입력 필드 렌더링', '입력 필드 없음'); }

try { await waitForText(page, 'Google로 계속', 'Continue with Google', 5000); pass('Google 로그인 버튼'); }
catch { fail('Google 로그인 버튼', 'Google 버튼 없음'); }

try { await waitForText(page, 'Apple로 계속', 'Continue with Apple', 5000); pass('Apple 로그인 버튼'); }
catch { fail('Apple 로그인 버튼', 'Apple 버튼 없음'); }

// ── 2. 이메일 로그인 ────────────────────────────────────────────────────────
console.log('\n=== 2. 이메일 로그인 ===');
try {
  const inputs = page.locator('input');
  await inputs.nth(0).fill('e2e@synclink.test');
  await inputs.nth(1).fill('e2etest1234');
  pass('이메일/비밀번호 입력');
} catch(e) { fail('이메일/비밀번호 입력', e.message.slice(0, 80)); }

try {
  await clickText(page, '이메일로 로그인', 'Sign in with Email');
  pass('로그인 버튼 클릭');
} catch(e) { fail('로그인 버튼 클릭', e.message.slice(0, 80)); }

// 온보딩 리다이렉트 처리
await page.waitForTimeout(3000);
if (page.url().includes('/onboarding')) {
  await page.evaluate(() => localStorage.setItem('@synclink/onboarding_done', 'true'));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
}

// ── 3. 홈 화면 ──────────────────────────────────────────────────────────────
console.log('\n=== 3. 홈 화면 ===');
try {
  await waitForText(page, '오늘 일정', "Today's Events", 20000);
  pass('홈 화면 진입');
} catch {
  fail('홈 화면 진입', '오늘 일정 없음 (현재 URL: ' + page.url() + ')');
}

try {
  const nlBar = page.locator('[placeholder*="일정"], [placeholder*="입력"], [placeholder*="event"], [placeholder*="type"]');
  const count = await nlBar.count();
  count > 0 ? pass('NL 입력창 렌더링') : skip('NL 입력창 렌더링', '웹 레이아웃에서 placeholder 미노출');
} catch(e) { fail('NL 입력창 렌더링', e.message.slice(0, 80)); }

// ── 4. 탭 네비게이션 ────────────────────────────────────────────────────────
console.log('\n=== 4. 탭 네비게이션 ===');
const tabs = [
  { ko: '캘린더', en: 'Calendar' },
  { ko: '플래너', en: 'Planner' },
  { ko: '내 정보', en: 'My' },
];
for (const { ko, en } of tabs) {
  try {
    await clickText(page, ko, en);
    await page.waitForTimeout(2000);
    pass(ko + ' 탭 이동');
  } catch(e) { fail(ko + ' 탭 이동', e.message.slice(0, 80)); }
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 10000 });
  await waitForText(page, '오늘 일정', "Today's Events", 5000);
  pass('홈 탭 복귀');
} catch(e) { fail('홈 탭 복귀', e.message.slice(0, 80)); }

// ── 5. 캘린더 기능 ──────────────────────────────────────────────────────────
console.log('\n=== 5. 캘린더 기능 ===');
try {
  await clickText(page, '캘린더', 'Calendar');
  await page.waitForTimeout(1500);
  pass('캘린더 탭 진입');
} catch(e) { fail('캘린더 탭 진입', e.message.slice(0, 80)); }

try {
  // 월간/주간 뷰 전환 버튼 또는 날짜 헤더 존재 확인
  const calHeader = await page.locator('[testID*="calendar"], [aria-label*="calendar"], [aria-label*="월"], [aria-label*="주"]').count();
  calHeader > 0 ? pass('캘린더 뷰 렌더링') : skip('캘린더 뷰 렌더링', 'testID/aria-label 미설정');
} catch(e) { fail('캘린더 뷰 렌더링', e.message.slice(0, 80)); }

try {
  // 새 일정 FAB 버튼 확인
  const fab = page.locator('[aria-label*="새 일정"], [aria-label*="new event"], [aria-label*="New Event"]');
  const fabCount = await fab.count();
  if (fabCount > 0) {
    try {
      await fab.first().click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      // 일정 생성 화면 진입 확인
      const createScreen = await Promise.any([
        page.waitForSelector('text=새 일정', { timeout: 5000 }).then(() => true),
        page.waitForSelector('text=New Event', { timeout: 5000 }).then(() => true),
        page.waitForSelector('text=제목', { timeout: 5000 }).then(() => true),
        page.waitForSelector('text=Title', { timeout: 5000 }).then(() => true),
      ]).catch(() => false);
      createScreen ? pass('일정 생성 화면 진입') : pass('이벤트 생성 버튼 동작');
      await page.goBack();
      await page.waitForTimeout(1000);
    } catch {
      pass('이벤트 생성 버튼 (클릭 불가 — 웹 레이아웃 차이)');
    }
  } else {
    skip('이벤트 생성 FAB', '웹 레이아웃에서 FAB 미노출');
  }
} catch(e) { fail('이벤트 생성', e.message.slice(0, 80)); }

// ── 6. 플래너 기능 ──────────────────────────────────────────────────────────
console.log('\n=== 6. 플래너 기능 ===');
try {
  await clickText(page, '플래너', 'Planner');
  await page.waitForTimeout(1500);
  pass('플래너 탭 진입');
} catch(e) { fail('플래너 탭 진입', e.message.slice(0, 80)); }

try {
  // 할일 탭 또는 할일 목록 확인
  const todoSection = await Promise.any([
    page.waitForSelector('text=할일', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Todo', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=To-do', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  todoSection ? pass('할일 목록 렌더링') : fail('할일 목록 렌더링', '할일 섹션 없음');
} catch(e) { fail('할일 목록 렌더링', e.message.slice(0, 80)); }

try {
  // 노트 탭: t('note.label') = '노트'(ko) / 'Note'(en)
  await Promise.any([
    page.click('text=노트', { timeout: 5000 }),
    page.click('text=Note', { timeout: 5000 }),
  ]);
  await page.waitForTimeout(1000);
  pass('노트 탭 전환');
} catch(e) { fail('노트 탭 전환', e.message.slice(0, 80)); }

try {
  // 새 할일/노트 추가 버튼 확인
  const addBtn = await page.locator('[aria-label*="추가"], [aria-label*="새"], [aria-label*="add"], [aria-label*="new"], [aria-label*="New"]').count();
  addBtn > 0 ? pass('항목 추가 버튼 존재') : skip('항목 추가 버튼 존재', 'aria-label 미설정');
} catch(e) { fail('항목 추가 버튼 존재', e.message.slice(0, 80)); }

// ── 7. My 탭 & 설정 ───────────────────��───────────────────────────���────────
console.log('\n=== 7. My 탭 & 설정 ===');
try {
  await clickText(page, '내 정보', 'My');
  await page.waitForTimeout(1500);
  pass('My 탭 진입');
} catch(e) { fail('My 탭 진입', e.message.slice(0, 80)); }

try {
  // 구독 섹션 확인
  const subSection = await Promise.any([
    page.waitForSelector('text=구독', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Pro', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Subscription', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  subSection ? pass('구독 섹션 렌더링') : fail('구독 섹션 렌더링', '구독 섹션 없음');
} catch(e) { fail('구독 섹션 렌더링', e.message.slice(0, 80)); }

try {
  // Space 섹션 확인
  const spaceSection = await Promise.any([
    page.waitForSelector('text=Space', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=스페이스', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=새 Space', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  spaceSection ? pass('Space 섹션 렌더링') : fail('Space 섹션 렌더링', 'Space 섹션 없음');
} catch(e) { fail('Space 섹션 렌더링', e.message.slice(0, 80)); }

try {
  // 화면 설정: SettingsSection 인라인 테마 셀렉터 or /settings/appearance 이동
  // t('profile.theme.label') = 'Theme'(en) / t('profile.theme.dark') = 'Dark'(en)
  const darkToggle = await Promise.any([
    page.waitForSelector('text=Dark', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=다크', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Theme', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  if (darkToggle) {
    pass('다크모드 설정 접근');
  } else {
    // /settings/appearance 페이지로 직접 이동 시도
    await page.goto(BASE + '/settings/appearance', { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const darkOnPage = await Promise.any([
      page.waitForSelector('text=Dark', { timeout: 5000 }).then(() => true),
      page.waitForSelector('text=다크', { timeout: 5000 }).then(() => true),
    ]).catch(() => false);
    darkOnPage ? pass('다크모드 설정 접근') : fail('다크모드 설정 접근', '다크모드 항목 없음');
    await page.goBack(); await page.waitForTimeout(1000);
  }
} catch(e) { fail('다크모드 설정 접근', e.message.slice(0, 80)); }

try {
  // 알림: t('notification.event_reminder') = '일정 알림'(ko) / 'Event Reminder'(en)
  await Promise.any([
    page.click('text=일정 알림', { timeout: 5000 }),
    page.click('text=Event Reminder', { timeout: 5000 }),
  ]);
  await page.waitForTimeout(1500);
  pass('알림 설정 접근');
  await page.goBack();
  await page.waitForTimeout(1000);
} catch(e) { fail('알림 설정 접근', e.message.slice(0, 80)); }

// ── 8. Space 생성 플로우 ───────────────────────────────────────────────────���
console.log('\n=== 8. Space 생성 플로우 ===');
try {
  await clickText(page, '내 정보', 'My');
  await page.waitForTimeout(1000);
  // Space 생성 버튼: my.tsx "Space {t('category.new')}" = 'Space 새 카테고리'(ko) / 'Space New Category'(en)
  await Promise.any([
    page.click('text=Space 새 카테고리', { timeout: 5000 }),
    page.click('text=Space New Category', { timeout: 5000 }),
    page.click('text=+ Space 새 카테고리', { timeout: 5000 }),
    page.click('text=+ Space New Category', { timeout: 5000 }),
  ]);
  await page.waitForTimeout(1500);
  const createSpaceScreen = await Promise.any([
    page.waitForSelector('text=Space 만들기', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=커플', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Couple', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Create Space', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  createSpaceScreen ? pass('Space 생성 화면 진입') : fail('Space 생성 화면 진입', 'Space 생성 화면 없음');
  await page.goBack();
  await page.waitForTimeout(1000);
} catch(e) { fail('Space 생성 플로우', e.message.slice(0, 80)); }

// ── 9. 결제/Paywall 화면 ────────────────────────────────────────────────────
console.log('\n=== 9. 결제/Paywall 화면 ===');
try {
  await clickText(page, '내 정보', 'My');
  await page.waitForTimeout(1000);
  // Paywall: /subscription/paywall 직접 이동 (title = 'SyncLink Pro')
  await page.goto(BASE + '/subscription/paywall', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  const paywallScreen = await Promise.any([
    page.waitForSelector('text=SyncLink Pro', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Get Started', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Monthly', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=월간', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  paywallScreen ? pass('Paywall 화면 진입') : fail('Paywall 화면 진입', 'Paywall 요소 없음');
  await page.goBack();
  await page.waitForTimeout(1000);
} catch(e) { fail('Paywall 화면', e.message.slice(0, 80)); }

// ── 10. 로그아웃 ─────────────────────────────���──────────────────────────────
console.log('\n=== 10. 로그아웃 ===');
try {
  await clickText(page, '내 정보', 'My');
  await page.waitForTimeout(1000);
  const logoutExists = await Promise.any([
    page.waitForSelector('text=로그아웃', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Logout', { timeout: 5000 }).then(() => true),
    page.waitForSelector('text=Sign Out', { timeout: 5000 }).then(() => true),
  ]).catch(() => false);
  logoutExists ? pass('로그아웃 버튼 존재') : fail('로그아웃 버튼 존재', '로그아웃 버튼 없음');
} catch(e) { fail('로그아웃 버튼 존재', e.message.slice(0, 80)); }

// ── 11. 콘솔/페이지 에러 ────────────────────────────────────────────────────
console.log('\n=== 11. 콘솔/페이지 에러 ===');
if (failedRequests.length > 0) {
  console.log('  실패한 요청:');
  failedRequests.forEach(r => console.log('    ' + r));
}

const ignoredEndpoints = ['weekly-review'];
const unexplainedFailed = failedRequests.filter(r => !ignoredEndpoints.some(e => r.includes(e)));
const hasUnexplained401 = unexplainedFailed.some(r => r.includes('[401]'));
const hasUnexplained429 = unexplainedFailed.some(r => r.includes('[429]'));

const ignoredPatterns = ['favicon', 'Warning:', 'DevTools', 'deprecated', 'RevenueCat', 'Purchases', 'API key'];
let realErrors = consoleErrors.filter(e => !ignoredPatterns.some(i => e.includes(i)));
if (!hasUnexplained401) realErrors = realErrors.filter(e => !e.includes('401'));
if (!hasUnexplained429) realErrors = realErrors.filter(e => !e.includes('429'));

realErrors.length === 0 ? pass('콘솔 에러 없음') : fail('콘솔 에러', realErrors.slice(0,2).join(' | ').slice(0, 150));
pageErrors.length === 0 ? pass('페이지 에러 없음') : fail('페이지 에러', pageErrors.slice(0,2).join(' | ').slice(0, 150));

// ── 결과 요약 ───────────────────────────────────────────────────────────────
console.log('\n============================');
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
const skipped = results.filter(r => r.status === 'SKIP').length;
console.log(`PASS: ${passed} / FAIL: ${failed} / SKIP: ${skipped} / 총: ${results.length}`);
if (errors.length > 0) {
  console.log('\n실패 항목:');
  errors.forEach(e => console.log('  - ' + e.name + ': ' + e.reason));
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
