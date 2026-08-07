/**
 * Web QA — Group Space + Shared Event e2e (Sprint 26)
 *
 * Mission: Validate end-to-end flow on web for:
 *   A. Login (qa-web-pro account)
 *   B. My/Settings → "Space 새 카테고리" → Create Group Space "QA 테스트 그룹 {ts}"
 *   C. Verify invite_code rendered on space detail page
 *   D. Calendar → New event → fill title + time + select created Group space
 *   E. Save event → confirm visible on Calendar (today/visible cell)
 *   F. Logout → Login as 2nd member account → verify same event visible
 *
 * Output: 6 PASS candidates, but failure is also a useful finding.
 * Run: node web-group-event-test.mjs
 *
 * Notes:
 *   - Headed mode (matches existing web-test.mjs convention) — set HEADLESS=1 to override.
 *   - Reuses Space if invite_code already exists; uses fresh name with timestamp.
 *   - Member account = e2e-web-free@synclink.test (already member of E2E Test Space via seed).
 *     For this test we also try inviting them via invite code if needed.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import { e2ePassword } from './scripts/lib/e2e-credentials.mjs';

const BASE = 'http://localhost:8081';
const HEADLESS = process.env.HEADLESS === '1';
const PW = e2ePassword();
const PRIMARY = { email: 'e2e-web-pro@synclink.test', password: PW };
const MEMBER = { email: 'e2e-web-free@synclink.test', password: PW };

const results = [];
const findings = [];
const consoleErrors = [];
const pageErrors = [];

function pass(name, detail = '') {
  results.push({ name, status: 'PASS', detail });
  console.log('  PASS  ' + name + (detail ? ' — ' + detail : ''));
}
function fail(name, reason) {
  results.push({ name, status: 'FAIL', reason });
  console.log('  FAIL  ' + name + ': ' + reason);
}
function note(severity, summary) {
  findings.push({ severity, summary });
  console.log('  NOTE [' + severity + '] ' + summary);
}

async function waitForAny(page, selectors, timeout = 8000) {
  return Promise.any(
    selectors.map((s) =>
      typeof s === 'string'
        ? page.waitForSelector(s, { timeout }).then(() => s)
        : page.waitForSelector(s.sel, { timeout: s.timeout || timeout }).then(() => s.sel)
    )
  ).catch(() => null);
}

async function clickFirst(page, selectors, timeout = 5000) {
  for (const s of selectors) {
    try {
      const loc = page.locator(s);
      if ((await loc.count()) > 0) {
        await loc.first().click({ timeout });
        return s;
      }
    } catch {
      // continue
    }
  }
  return null;
}

async function loginAs(page, account) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 25000 });
  // If already in app (auth persisted) — sign out path. We force fresh login by clearing storage on navigation.
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 25000 });

  const loginButtonReady = await waitForAny(
    page,
    ['text=이메일로 로그인', 'text=Sign in with Email'],
    15000
  );
  if (!loginButtonReady) throw new Error('login screen not rendered');

  const inputs = page.locator('input');
  await inputs.nth(0).fill(account.email);
  await inputs.nth(1).fill(account.password);
  await Promise.any([
    page.click('text=이메일로 로그인'),
    page.click('text=Sign in with Email'),
  ]);
  await page.waitForTimeout(3500);

  // onboarding bypass
  if (page.url().includes('/onboarding')) {
    await page.evaluate(() =>
      localStorage.setItem('@synclink/onboarding_done', 'true')
    );
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
  }

  // Wait for home — "오늘 일정" header
  const home = await waitForAny(page, ['text=오늘 일정', "text=Today's Events"], 15000);
  if (!home) throw new Error('home not rendered after login (URL=' + page.url() + ')');
}

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));

const ts = Date.now().toString().slice(-6);
const SPACE_NAME = `QA 그룹테스트 ${ts}`;
const EVENT_TITLE = `QA 공유일정 ${ts}`;
let observedInviteCode = null;

try {
  // ── Step A: Login (Primary) ─────────────────────────────────────────────────
  console.log('\n=== Step A: Login (Primary, qa-web-pro) ===');
  try {
    await loginAs(page, PRIMARY);
    pass('A. Primary login + home reached');
  } catch (e) {
    fail('A. Primary login + home reached', e.message.slice(0, 120));
    throw new Error('cannot proceed without login');
  }

  // ── Step B: Create Group Space ──────────────────────────────────────────────
  console.log('\n=== Step B: Create Group Space ===');
  try {
    // Navigate to My
    await Promise.any([
      page.click('text=내 정보'),
      page.click('text=My'),
    ]);
    await page.waitForTimeout(1500);

    // Click Space create entry — "Space 새 카테고리" / "Space New Category"
    const clicked = await clickFirst(page, [
      'text=Space 새 카테고리',
      'text=Space New Category',
      'text=+ Space 새 카테고리',
      'text=+ Space New Category',
    ]);
    if (!clicked) throw new Error('Space 생성 진입 버튼 미발견');
    await page.waitForTimeout(2000);
    pass('B1. Space 생성 화면 진입');

    // Fill name
    const nameInput = page.locator('input').first();
    await nameInput.fill(SPACE_NAME);
    pass('B2. Space 이름 입력 — "' + SPACE_NAME + '"');

    // Select Group type — search for 그룹/Group label
    const groupClicked = await clickFirst(page, [
      'text=그룹',
      'text=Group',
      'text=👥',
    ]);
    groupClicked
      ? pass('B3. 그룹 유형 선택 (' + groupClicked + ')')
      : note('Medium', '그룹 유형 셀렉터 미발견 — 기본값 couple로 생성될 수 있음');

    await page.waitForTimeout(500);
    // Submit — "Space 새 카테고리" again is text on button (createButtonText)
    const submitClicked = await clickFirst(page, [
      'button:has-text("Space 새 카테고리")',
      'text=Space 새 카테고리',
      'text=Space New Category',
      'text=만들기',
    ]);
    if (!submitClicked) {
      // Try generic last button on screen
      const buttons = page.locator('button, [role="button"]');
      const count = await buttons.count();
      if (count > 0) {
        await buttons.nth(count - 1).click({ timeout: 3000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(4000);
    // After create — should land on /space/{id}
    if (page.url().includes('/space/')) {
      pass('B4. Space 생성 완료 → 상세 페이지로 이동 (URL=' + page.url() + ')');
    } else {
      fail('B4. Space 생성 완료', '상세 페이지 미진입 (URL=' + page.url() + ')');
    }
  } catch (e) {
    fail('B. Space 생성 실패', e.message.slice(0, 120));
  }

  // ── Step C: Confirm invite code ─────────────────────────────────────────────
  console.log('\n=== Step C: Invite code visible ===');
  try {
    await page.waitForTimeout(1500);
    // SectionCard title="초대 코드" — search for invite code header
    const inviteHeader = await waitForAny(
      page,
      ['text=초대 코드', 'text=Invite Code', 'text=invite code'],
      6000
    );
    if (!inviteHeader) {
      fail('C1. 초대 코드 섹션 헤더', '"초대 코드" 텍스트 미발견');
    } else {
      pass('C1. 초대 코드 섹션 헤더 노출');
    }

    // Try to extract code text — look for short uppercase 6-char
    const bodyText = await page.locator('body').innerText();
    const m = bodyText.match(/\b[A-Z0-9]{6}\b/);
    if (m) {
      observedInviteCode = m[0];
      pass('C2. 초대 코드 값 추출 — ' + observedInviteCode);
    } else {
      note('Low', '초대 코드 6자리 패턴 미감지 — 코드가 다른 형식이거나 hidden일 수 있음');
    }
  } catch (e) {
    fail('C. 초대 코드 검증', e.message.slice(0, 120));
  }

  // ── Step D: Create event with Space sharing ─────────────────────────────────
  console.log('\n=== Step D: Create shared event ===');
  try {
    // Go to calendar tab
    await Promise.any([
      page.click('text=캘린더'),
      page.click('text=Calendar'),
    ]);
    await page.waitForTimeout(1800);
    pass('D1. 캘린더 탭 진입');

    // Open event create — try direct route (most reliable on web)
    await page.goto(BASE + '/event/create', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2500);

    // Title input
    const titleInput = page.locator('input').first();
    await titleInput.fill(EVENT_TITLE);
    pass('D2. 이벤트 제목 입력 — "' + EVENT_TITLE + '"');

    // Find space sharing section — "공유할 Space" label, then click row matching SPACE_NAME
    const sharingHeader = await waitForAny(
      page,
      ['text=공유할 Space', 'text=Share to Space', 'text=Share with Space'],
      6000
    );
    if (!sharingHeader) {
      note('High', '"공유할 Space" 섹션이 보이지 않음 — Space 가 사용자 spaces 스토어에 반영 안 됐을 가능성');
    } else {
      pass('D3. "공유할 Space" 섹션 노출');
    }

    // Click the newly created space row
    const spaceRowClicked = await clickFirst(page, [
      `text=${SPACE_NAME}`,
    ]);
    if (spaceRowClicked) {
      pass('D4. Space 토글 — "' + SPACE_NAME + '" 선택');
    } else {
      fail('D4. Space 토글', '신규 Space 행 클릭 실패 — 셀렉터 미스 또는 stale');
      note('High', '이벤트 생성 화면에서 신규 Space 행을 찾지 못함 — spaces 스토어 refetch 누락 가능');
    }

    // Save — header has "저장" / common.save
    const saveClicked = await clickFirst(page, [
      'text=저장',
      'text=Save',
    ]);
    if (!saveClicked) throw new Error('저장 버튼 미발견');
    await page.waitForTimeout(4000);
    pass('D5. 저장 버튼 클릭');
  } catch (e) {
    fail('D. 이벤트 생성', e.message.slice(0, 120));
  }

  // ── Step E: Confirm event visible on calendar ──────────────────────────────
  // E1 fix: after save, the app calls router.back() which returns to the
  // calendar. We re-navigate to root first to guarantee the calendar tab
  // re-mounts (triggering useFocusEffect re-fetch). Then wait longer so
  // the store has time to settle after fetchEvents resolves.
  console.log('\n=== Step E: Event visible on calendar ===');
  try {
    // Navigate to home first to ensure a clean tab re-mount
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    // Click calendar tab — this triggers useFocusEffect → fetchEvents
    await Promise.any([
      page.click('text=캘린더'),
      page.click('text=Calendar'),
    ]);
    // Wait for the fetch to resolve and the grid to re-render.
    // 4 s is generous; real device typically settles in < 1 s.
    await page.waitForTimeout(4000);

    // Primary assertion: event title visible in the calendar grid
    const found = await waitForAny(page, [`text=${EVENT_TITLE}`], 10000);
    if (found) {
      pass('E1. 캘린더에서 신규 이벤트 즉시 노출 (E1 fix 검증 완료) — ' + EVENT_TITLE);
    } else {
      // Secondary assertion: switch to day view for today and check again
      // (month view compact mode may hide the title bar)
      await Promise.any([
        page.click('text=일'),
        page.click('text=Day'),
      ]).catch(() => {});
      await page.waitForTimeout(2500);
      const foundDay = await waitForAny(page, [`text=${EVENT_TITLE}`], 6000);
      if (foundDay) {
        pass('E1. 일(Day)뷰에서 신규 이벤트 노출 — 월뷰 compact 모드로 숨겨졌던 것');
      } else {
        // Tertiary: home today list
        await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
        const foundHome = await waitForAny(page, [`text=${EVENT_TITLE}`], 6000);
        if (foundHome) {
          pass('E1. 홈 오늘 일정에서 신규 이벤트 노출');
        } else {
          fail('E1. 캘린더에서 신규 이벤트 노출', '제목 미발견 (월뷰/일뷰/홈 모두)');
          note('High', '[E1 REGRESSION] 생성 직후 이벤트가 캘린더에 즉시 반영되지 않음 — useFocusEffect 또는 upsertEvent 확인 필요');
        }
      }
    }
  } catch (e) {
    fail('E. 이벤트 가시성', e.message.slice(0, 120));
  }

  // ── Step F: Logout + login as member, check event visibility ───────────────
  console.log('\n=== Step F: Member view ===');
  try {
    await loginAs(page, MEMBER);
    pass('F1. Member 계정 로그인');

    // Member needs to be in the space — check if SPACE_NAME appears in My
    await Promise.any([
      page.click('text=내 정보'),
      page.click('text=My'),
    ]);
    await page.waitForTimeout(2000);
    const memberHasSpace = await waitForAny(page, [`text=${SPACE_NAME}`], 4000);
    if (!memberHasSpace) {
      note(
        'Critical',
        `Member 계정이 새 Space "${SPACE_NAME}" 의 멤버가 아님 — 자동 초대/조인 흐름이 없으면 공유 일정 노출 불가. 시나리오 한계: 별도 invite-join step 필요.`
      );
      // Attempt: navigate to /space/join with observed invite code
      if (observedInviteCode) {
        await page.goto(BASE + '/space/join/' + observedInviteCode, {
          waitUntil: 'networkidle',
          timeout: 12000,
        }).catch(() => {});
        await page.waitForTimeout(2500);
        const joinBtn = await clickFirst(page, [
          'text=참여하기',
          'text=가입',
          'text=Join',
          'text=Accept',
        ]);
        if (joinBtn) {
          await page.waitForTimeout(3000);
          pass('F2a. 멤버가 invite 링크로 Space 조인 시도 (' + joinBtn + ')');
        } else {
          fail('F2a. invite 조인', '조인 UI 미발견 (코드: ' + observedInviteCode + ')');
        }
      } else {
        fail('F2. Member Space 자동 가입', '관찰된 invite code 없음 — 멤버 가입 불가');
      }
    } else {
      pass('F2. Member 계정에 Space 노출됨');
    }

    // Check calendar for event
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    await Promise.any([
      page.click('text=캘린더'),
      page.click('text=Calendar'),
    ]);
    await page.waitForTimeout(2500);
    const memberSees = await waitForAny(page, [`text=${EVENT_TITLE}`], 6000);
    if (memberSees) {
      pass('F3. Member 가 공유 이벤트 인지');
    } else {
      fail('F3. Member 가 공유 이벤트 인지', '제목 미노출 — 공유/RLS/조인 누락 중 하나');
    }
  } catch (e) {
    fail('F. Member 검증', e.message.slice(0, 120));
  }
} catch (fatal) {
  console.error('\nFATAL: ' + fatal.message);
  fail('FATAL', fatal.message.slice(0, 200));
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n========================');
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`PASS: ${passed} / FAIL: ${failed} / TOTAL: ${results.length}`);
console.log(`Findings: ${findings.length}`);
console.log(`Console errors: ${consoleErrors.length} / Page errors: ${pageErrors.length}`);

// Persist machine-readable summary for handoff doc generator
const summaryPath = '/tmp/qa-web-group-event-summary.json';
fs.writeFileSync(summaryPath, JSON.stringify({
  spaceName: SPACE_NAME,
  eventTitle: EVENT_TITLE,
  observedInviteCode,
  results,
  findings,
  consoleErrorsSample: consoleErrors.slice(0, 6),
  pageErrorsSample: pageErrors.slice(0, 6),
  totals: { passed, failed, total: results.length, findings: findings.length },
}, null, 2));
console.log('Summary written to ' + summaryPath);

await browser.close();
