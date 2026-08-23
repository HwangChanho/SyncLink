#!/usr/bin/env node
/**
 * seed-widget-sim.mjs — Put demo data in front of the iOS widgets on a simulator.
 *
 * Why: the widget shots for the store have to show a populated widget, but a fresh
 * simulator install has never signed in, so every widget renders its empty state.
 * The extension reads a JSON snapshot out of the App Group, so writing that snapshot
 * directly is enough — the widget UI itself stays 100% real, only the data is seeded.
 * Same idea as the guest/demo data the web captures rely on.
 *
 * The shape mirrors WidgetSnapshot in src/services/widgetDataService.ts:
 *   events — the whole 6-week grid window (the 달력 widget groups them by dateKey)
 *   todos  — pending only, due today or earlier (overdue ones render red)
 *   totals — counts of TODAY's events / all pending todos, before truncation
 *
 * Usage: node seed-widget-sim.mjs <UDID> [YYYY-MM-DD]
 *        (date defaults to today; pass one to keep a shot reproducible)
 *
 * Note: cfprefsd caches preferences, so the simulator must be rebooted (or SpringBoard
 * restarted) after this runs for the widgets to pick the new snapshot up.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APP = 'io.synclink.app';
const SUITE = 'group.io.synclink.app.widget';
const KEY_V1 = 'synclink.widgetSnapshot.v1';
const KEY_V2 = 'synclink.widgetSnapshot.v2';

const udid = process.argv[2];
if (!udid) {
  console.error('usage: seed-widget-sim.mjs <UDID> [YYYY-MM-DD]');
  process.exit(1);
}
const today = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const [Y, M, D] = today.split('-').map(Number);

/** YYYY-MM-DD for a day in the same month as `today`. */
const day = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Demo month. Spread across the grid so the 달력 widget has something to draw,
 * with two events on the captured day for the 오늘 list.
 * 8/26 도착예상 is deliberate — it is the same example the D-day shot uses.
 */
const ev = (id, d, startTime, title, color, ownerNickname = '') =>
  ({ id, title, startTime, color, dateKey: day(d), ownerNickname });

const events = [
  ev('e1', 4, '14:00', '치과 예약', '#0284C7'),
  ev('e2', 6, '10:00', '팀 회의', '#8963E3'),
  ev('e3', 9, '18:30', '부모님 저녁', '#DB2777', '지민'),
  ev('e4', 12, '', '프로젝트 마감', '#E11D48'),
  ev('e5', 14, '20:00', '영화', '#EA580C'),
  ev('e6', 18, '07:00', '헬스 PT', '#16A34A'),
  ev('e7', 20, '11:00', '정기 검진', '#0D9488'),
  ev('e8', 22, '19:00', '동네 모임', '#D97706', '서준'),
  ev('e9', D, '07:30', '아침 러닝', '#16A34A'),
  ev('e10', D, '11:00', '가족 브런치', '#DB2777', '지민'),
  ev('e11', 26, '', '택배 도착예상', '#8963E3'),
  ev('e12', 28, '', '캠핑', '#0284C7'),
  ev('e13', 30, '', '엄마 생신', '#E11D48'),
];

const todos = [
  { id: 't1', title: '우유·계란 사기', done: false, dueDate: day(D), overdue: false },
  { id: 't2', title: '주간 보고서 정리', done: false, dueDate: day(D - 1), overdue: true },
  { id: 't3', title: '엄마 생신 선물 준비', done: false, dueDate: day(D), overdue: false },
  { id: 't4', title: '세탁소 맡기기', done: false, dueDate: day(D), overdue: false },
];

const snapshot = {
  generatedAt: new Date(Y, M - 1, D, 9, 0, 0).toISOString(),
  events,
  todos,
  totals: {
    events: events.filter((e) => e.dateKey === day(D)).length,
    todos: todos.length,
  },
};

/**
 * Locate the App Group container.
 *
 * `simctl get_app_container <udid> <bundle> <group>` just prints its usage text on
 * Xcode 16, so resolve it from the container metadata instead: every shared container
 * carries its group id in .com.apple.mobile_container_manager.metadata.plist.
 *
 * The container only exists once an app carrying the app-group entitlement has been
 * installed. A simulator build made with CODE_SIGNING_ALLOWED=NO has no entitlements
 * at all, so nothing is created — ad-hoc sign it with the .entitlements first:
 *   codesign --force --sign - --entitlements targets/widget/SyncLinkWidget.entitlements <app>/PlugIns/SyncLinkWidget.appex
 *   codesign --force --sign - --entitlements ios/SyncLink/SyncLink.entitlements <app>
 */
function findGroupContainer() {
  const root = `${process.env.HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Shared/AppGroup`;
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const meta = `${root}/${name}/.com.apple.mobile_container_manager.metadata.plist`;
    if (!existsSync(meta)) continue;
    try {
      const id = execFileSync('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', '-o', '-', meta], {
        encoding: 'utf8',
      }).trim();
      if (id === SUITE) return `${root}/${name}`;
    } catch { /* not a group container we can read — skip */ }
  }
  return null;
}

const container = findGroupContainer();
if (!container) {
  console.error(`App Group 컨테이너를 못 찾았습니다 — ${APP} 가 entitlements 를 갖고 설치돼 있나요?`);
  process.exit(1);
}

const plistPath = `${container}/Library/Preferences/${SUITE}.plist`;
mkdirSync(dirname(plistPath), { recursive: true });

/**
 * plutil reads dots in a key as key-path separators, so "synclink.widgetSnapshot.v2"
 * would be looked up as three nested keys. Escape them to address the flat key.
 */
const keyPath = (k) => k.replace(/\./g, '\\.');

// Merge rather than overwrite: the pending-toggle queue lives in the same domain.
const json = JSON.stringify(snapshot);
if (existsSync(plistPath)) {
  // plutil edits in place and keeps the binary format the simulator expects.
  for (const key of [KEY_V1, KEY_V2]) {
    execFileSync('plutil', ['-replace', keyPath(key), '-string', json, plistPath]);
  }
} else {
  const escaped = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>${KEY_V1}</key><string>${escaped(json)}</string>
  <key>${KEY_V2}</key><string>${escaped(json)}</string>
</dict></plist>
`,
  );
  execFileSync('plutil', ['-convert', 'binary1', plistPath]);
}

// Read back — a silent plutil failure would otherwise show up as an empty widget.
const back = execFileSync('plutil', ['-extract', keyPath(KEY_V2), 'raw', '-o', '-', plistPath], {
  encoding: 'utf8',
}).trim();
const ok = JSON.parse(back);
console.log(`시드 완료: ${plistPath}`);
console.log(`  이벤트 ${ok.events.length}건(오늘 ${ok.totals.events}건) · 할 일 ${ok.todos.length}건`);
console.log('  ⚠️ 반영하려면 시뮬 재부팅 필요(cfprefsd 캐시)');
