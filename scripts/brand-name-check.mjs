#!/usr/bin/env node
/**
 * 브랜드명 후보 검증 — 이름 충돌 + **자동교정 위험도 추정**. (2026-09-21)
 *
 * ▶ 왜 만들었나
 *   「투투리스트」가 App Store 앱 UI 에서 **「투두리스트」로 자동교정**되어,
 *   브랜드명을 정확히 쳐도 앱이 검색 결과에 안 나온다(2026-09-21 LEAD 실측).
 *   원인은 수치로 드러난다 — **흔한 단어와 편집거리 1**.
 *   다음 이름을 고를 때 같은 실수를 반복하지 않으려고 만들었다.
 *
 * 🔴 **이 도구는 자동교정을 «판정» 하지 못한다.** 교정은 iOS App Store 앱 안에서만
 *    일어나고 밖에서 관측할 API 가 없다(09-21 에 네 경로 전부 막힌 것을 확인했다 →
 *    메모리 project_store_aso). 여기서 주는 건 **위험도 추정**뿐이다.
 *    ⇒ **최종 확인은 사람이 아이폰 App Store 에서 그 단어를 직접 쳐서** 한다.
 *       그 이름의 앱이 아직 없어도 «교정되는지» 는 보인다.
 *
 * ▶ 사용
 *     node scripts/brand-name-check.mjs 우리하루 같이하루 데이싱크
 *     node scripts/brand-name-check.mjs            # 기본 후보 목록
 */

import { setTimeout as sleep } from 'node:timers/promises';

/** 앱스토어에서 흔한 한국어 말 — 교정의 «목적지» 가 될 수 있는 단어들. */
const COMMON = [
  '투두리스트', '체크리스트', '캘린더', '다이어리', '플래너', '스케줄', '리마인더',
  '메모장', '노트', '일정관리', '할일관리', '가계부', '달력', '타이머', '알람',
  '하루일기', '투두', '위젯', '디데이', '하루하루', '하루기록',
];

/** 레벤슈타인 거리. 한 글자 차이면 1 — 「투투리스트」가 그 경우였다. */
function editDistance(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return m[a.length][b.length];
}

/** 가장 가까운 흔한 단어와의 거리. 작을수록 교정 위험이 크다. */
function risk(name) {
  let best = { word: null, d: Infinity };
  for (const w of COMMON) {
    const d = editDistance(name, w);
    if (d < best.d) best = { word: w, d };
  }
  return best;
}

/**
 * iTunes 검색으로 «완전일치 이름» 이 이미 있는지 본다.
 * 🔑 Apple 은 이름 가용성 API 를 주지 않는다 — 확증은 **ASC 에 실제로 넣어 200 을 받고
 *    즉시 원복**하는 것뿐이다(2026-08-10 에 그렇게 확인했다). 여기서는 1차 거르기만 한다.
 */
async function itunesExact(term) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=kr&entity=software&limit=50`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { ok: false };
    const json = await res.json();
    const names = (json.results ?? []).map((a) => a.trackName ?? '');
    // 스토어 이름은 "브랜드 - 부제" 꼴이라 구분자 앞부분만 본다
    const exact = names.filter((n) => n.split(/[-–—:|]/)[0].trim().replace(/\s/g, '') === term);
    return { ok: true, total: names.length, exact };
  } catch {
    return { ok: false };
  }
}

const DEFAULT_CANDIDATES = ['우리하루', '같이하루', '데이싱크', '하루함께'];
const candidates = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CANDIDATES;

console.log('후보'.padEnd(14), '교정위험(추정)'.padEnd(26), 'App Store 완전일치');
console.log('─'.repeat(74));

for (const c of candidates) {
  const r = risk(c);
  const level = r.d <= 1 ? '🔴 매우높음' : r.d === 2 ? '⚠️ 높음' : r.d === 3 ? '· 보통' : '✅ 낮음';
  const res = await itunesExact(c);
  const collide = !res.ok
    ? '조회실패'
    : res.exact.length
      ? `🔴 ${res.exact.length}건: ${res.exact.slice(0, 2).join(' / ')}`
      : `✅ 없음 (${res.total}개 중)`;
  console.log(c.padEnd(14), `${level} (${r.word} 와 ${r.d})`.padEnd(28), collide);
  await sleep(1500);
}

console.log(
  '\n🔴 «교정위험» 은 편집거리 기반 **추정**이다. 실제 교정은 iOS App Store 앱에서만 확인된다 —\n' +
  '   후보를 아이폰에서 직접 쳐 보고, 교정되지 않는 것만 남길 것.',
);
