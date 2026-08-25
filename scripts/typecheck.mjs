#!/usr/bin/env node
/**
 * typecheck — `tsc --noEmit` 을 돌리되, 우리가 고칠 수 없는 **라이브러리 내부**
 * 에러는 실패로 치지 않는다.
 *
 *   node scripts/typecheck.mjs           우리 코드에 에러가 있으면 exit 1
 *   node scripts/typecheck.mjs --strict  라이브러리 내부 에러도 실패로 친다
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * tsconfig 는 이미 `skipLibCheck: true` 라 라이브러리의 `.d.ts` 는 검사하지 않는다.
 * 그런데 expo-file-system 은 패키지 루트에 `legacy.ts`(원시 소스)를 두고 있어
 * `import ... from 'expo-file-system/legacy'` 가 라이브러리 `.ts` 를 **그대로
 * 컴파일**시킨다. `skipLibCheck` 은 `.d.ts` 에만 적용되므로 이 경로에는 효력이 없고,
 * 우리 프로젝트가 `exactOptionalPropertyTypes` 를 켜 둔 탓에 업스트림 코드
 * (`DownloadResumable.savable()` — 우리가 호출하지도 않는다)에서 에러가 난다.
 * 이 스크립트는 `skipLibCheck` 이 이미 표명한 의도를 "원시 .ts 를 배포하는
 * 패키지"에도 똑같이 적용할 뿐이다.
 *
 * ── 이 필터가 진짜 문제를 가리지 않는 이유 ───────────────────────────────────
 * 우리가 라이브러리를 **잘못 쓴** 경우의 에러는 우리 파일 위치로 보고된다.
 * `node_modules/` 위치로 보고되는 건 라이브러리 자체의 내부 타입 문제뿐이다.
 *
 * ── 하지 말아야 할 우회 (2026-08-26 실측) ────────────────────────────────────
 * 🔴 tsconfig `paths` 로 선언 파일을 가리키면 안 된다. **jest-expo 가 tsconfig
 *    paths 를 그대로 가져다 쓰기 때문에** 런타임에 `.d.ts` 를 로드하려다
 *    테스트 11개 suite 가 깨진다.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

/** `경로(줄,열): error TSxxxx: 메시지` 로 시작하는 줄 = 새 에러의 첫 줄. */
const ERROR_HEAD = /^(\S.*?)\((\d+),(\d+)\): error TS\d+:/;

const run = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
  cwd: REPO,
  encoding: 'utf8',
  // tsc 는 진단을 stdout 으로 낸다. stderr 는 실행 자체가 실패했을 때만 쓰인다.
  maxBuffer: 32 * 1024 * 1024,
});

if (run.error) {
  console.error('tsc 실행 실패:', run.error.message);
  process.exit(2);
}

const raw = `${run.stdout ?? ''}${run.stderr ?? ''}`;

// 에러를 블록 단위로 묶는다 — 첫 줄 뒤의 들여쓴 줄들은 같은 에러의 상세 설명이다.
const blocks = [];
for (const line of raw.split('\n')) {
  if (ERROR_HEAD.test(line)) blocks.push({ file: ERROR_HEAD.exec(line)[1], lines: [line] });
  else if (blocks.length && line.startsWith(' ')) blocks[blocks.length - 1].lines.push(line);
}

const isVendor = (f) => f.startsWith('node_modules/') || f.includes('/node_modules/');
const ours   = blocks.filter((b) => !isVendor(b.file));
const vendor = blocks.filter((b) => isVendor(b.file));

for (const b of ours) console.log(b.lines.join('\n'));

if (vendor.length) {
  if (STRICT) {
    // --strict: 라이브러리 에러도 실패로 치므로 내용을 그대로 보여 준다.
    for (const b of vendor) console.log(b.lines.join('\n'));
    console.log(`\nℹ️  위 ${vendor.length}건은 라이브러리 내부 에러입니다(--strict 라 실패로 셉니다).`);
  } else {
    const files = [...new Set(vendor.map((b) => b.file))];
    console.log(
      `\nℹ️  라이브러리 내부 에러 ${vendor.length}건은 건너뜁니다 (고칠 수 없는 코드):\n` +
      files.map((f) => `   · ${f}`).join('\n') +
      '\n   전부 보려면: node scripts/typecheck.mjs --strict',
    );
  }
}

const failed = ours.length + (STRICT ? vendor.length : 0);
if (failed) {
  console.error(`\n❌ 타입 에러 ${failed}건`);
  process.exit(1);
}
console.log(`✅ 타입 에러 없음${vendor.length ? ` (라이브러리 ${vendor.length}건 제외)` : ''}`);
