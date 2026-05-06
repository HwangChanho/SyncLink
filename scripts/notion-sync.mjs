#!/usr/bin/env node
/**
 * notion-sync.mjs — SyncLink Features 작업 진행 추적 (Notion DB).
 *
 * .env 의 NOTION_API_KEY + NOTION_FEATURES_DB_ID 를 사용. 이름이 같은 row
 * 가 있으면 update, 없으면 새로 insert. 따라서 같은 feature 를 In Progress
 * → Done 로 옮길 때 동일 이름으로 호출하면 됨.
 *
 * 사용:
 *   node scripts/notion-sync.mjs --feature "Spaces 탭 분리" --status 진행
 *   node scripts/notion-sync.mjs --feature "Spaces 탭 분리" --status 완료 --build 84
 *   node scripts/notion-sync.mjs --feature "Spaces 탭 분리" --status 완료 --build 84 --memo "5번째 탭"
 *
 * 또는 npm scripts:
 *   npm run feature:start -- "Spaces 탭 분리"
 *   npm run feature:done  -- "Spaces 탭 분리" --build 84
 */

import fs from 'node:fs';
import path from 'node:path';

// .env 직접 파싱 (의존성 추가 회피)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const API_KEY = process.env.NOTION_API_KEY;
const DB_ID   = process.env.NOTION_FEATURES_DB_ID;
if (!API_KEY || !DB_ID) {
  console.error('NOTION_API_KEY 또는 NOTION_FEATURES_DB_ID 미설정 (.env 확인)');
  process.exit(1);
}

// ── argv 파싱 (가벼움) ────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const feature = arg('feature') || args.find(a => !a.startsWith('--'));
const status  = arg('status') ?? '진행';
const build   = arg('build');
const memoArg = arg('memo');

// 현재 git HEAD commit hash (short). LEAD 요청: Notion 에 commit hash 도
// 함께 기록해 코드 변경과 작업 단위 매핑 추적. memo 앞에 [hash] prefix.
import { execSync } from 'node:child_process';
let commitHash = '';
try {
  commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  // git 없거나 repo 밖이면 skip
}
const memo = memoArg;
if (!feature) {
  console.error('Usage: notion-sync.mjs --feature "이름" [--status 진행|완료|계획] [--build 84] [--memo ...]');
  process.exit(1);
}

const headers = {
  'Authorization':  `Bearer ${API_KEY}`,
  'Notion-Version': '2022-06-28',
  'Content-Type':   'application/json',
};

// ── 동일 이름 row 검색 (이름 == title) ────────────────────────────────────
async function findExistingPage(name) {
  const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({
      filter: { property: '이름', title: { equals: name } },
      page_size: 1,
    }),
  });
  const j = await r.json();
  if (j.object === 'error') throw new Error(`query: ${j.message}`);
  return j.results[0] ?? null;
}

// ── property body 빌드 ────────────────────────────────────────────────────
function buildProps({ feature, status, build, memo, commit }) {
  const props = {
    '이름':   { title: [{ text: { content: feature } }] },
    'Status': { multi_select: [{ name: status }] },
    'Update': { date: { start: new Date().toISOString().slice(0, 10) } },
  };
  if (build)  props['Build']  = { rich_text: [{ text: { content: String(build) } }] };
  if (memo)   props['Memo']   = { rich_text: [{ text: { content: memo } }] };
  if (commit) props['Commit'] = { rich_text: [{ text: { content: commit } }] };
  return props;
}

// ── upsert ────────────────────────────────────────────────────────────────
const existing = await findExistingPage(feature);
const properties = buildProps({ feature, status, build, memo, commit: commitHash });

let r, body, action;
if (existing) {
  action = 'update';
  r = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
    method: 'PATCH',
    headers,
    body:   JSON.stringify({ properties }),
  });
} else {
  action = 'create';
  r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body:   JSON.stringify({
      parent:     { database_id: DB_ID },
      properties,
    }),
  });
}
body = await r.json();
if (body.object === 'error') {
  console.error(`[notion-sync ${action} 실패]`, body.code, '-', body.message);
  process.exit(1);
}
console.log(`✓ ${action} "${feature}" → ${status}${build ? ` (Build ${build})` : ''}`);
console.log(`  ${body.url}`);
