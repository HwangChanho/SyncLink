#!/usr/bin/env node
/**
 * aso-rank — 검색어별로 양 스토어에서 **우리 앱이 몇 위에 나오는지** 실측한다.
 *
 *   node scripts/aso-rank.mjs                        # 기본 세트 전체(현재 키워드 + 브랜드 + 롱테일 후보)
 *   node scripts/aso-rank.mjs --group keywords       # 그룹만 (keywords | brand | longtail)
 *   node scripts/aso-rank.mjs --terms terms.txt      # 파일에서 읽기(한 줄에 검색어 하나, # 는 주석)
 *   node scripts/aso-rank.mjs --store ios            # 한쪽만 (ios | play | both)
 *   node scripts/aso-rank.mjs --compare build/aso-rank-2026-09-16.json   # 이전 측정과 비교
 *
 * 왜 필요한가:
 *   App Store 는 **이름 + 부제 + 키워드(100자)만** 검색 색인 대상이다. 즉 키워드 한 자 한 자가
 *   자리싸움이다. 그런데 "넣었으니 걸리겠지"는 추론일 뿐이라, 실제로 순위가 안 나오는 단어는
 *   100자를 낭비하고 있다는 사실을 **측정으로만** 알 수 있다. 이 스크립트가 그 판정을 만든다.
 *
 * 판정 기준(경험칙):
 *   · 1~10위   = 그 검색어로 실제 유입이 가능한 위치
 *   · 11~50위  = 노출은 되지만 클릭은 거의 안 나온다
 *   · 51위~    = 사실상 없는 것과 같다 → 키워드에서 뺄 후보
 *   · 미노출   = 그 단어로는 아예 안 걸린다 → 최우선 제거 후보
 *
 * 🔴 Play 순위는 HTML 파싱이라 정밀도가 낮다(1~2계단은 노이즈). 추세로만 볼 것.
 * ⚠️ 결과는 `build/aso-rank-<날짜>.json` 에 남는다 — 문구를 바꾼 뒤 다시 돌려 **전후 비교**하는 게
 *    이 도구의 본래 용도다(ASO 는 한 번 재고 끝내면 의미가 없다).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rankOf, searchAppStore, searchPlay } from './lib/store-search.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 우리 앱 식별자 — App Store 는 trackId, Play 는 패키지명. */
const IOS_APP_ID = '6763083903';
const PLAY_PKG = 'io.synclink.app';

/**
 * 기본 검색어 세트.
 *
 * · keywords — **현재 ASC 키워드 필드에 실제로 들어 있는 25개**. 여기서 죽은 단어를 골라낸다.
 * · brand    — 이름·부제에 들어간 말. 브랜드 검색이 회복됐는지 보는 대조군이다.
 * · longtail — 교체 후보. 일반명사는 대형 앱을 못 이기므로 **구문(2~3단어)** 위주로 뽑았다.
 *              실제로 사람이 칠 법한 말만 넣을 것(검색량 0인 단어를 1위 해봐야 유입은 0이다).
 */
const TERM_GROUPS = {
  keywords: [
    '할일', '투두', '체크리스트', '위젯', '디데이', '운동', '러닝', '헬스', '기념일',
    '생일', '약속', '모임', '데이트', '회의', '여행', '마감', '스케줄', '플래너',
    '다이어리', '메모', '음성', '자연어', '리마인더', '알림', 'AI',
  ],
  brand: [
    '투투리스트', '투두리스트', '할 일', '공유 캘린더', '일정 관리', '캘린더', '일정',
  ],
  longtail: [
    '커플 캘린더', '커플 일정 공유', '가족 캘린더', '팀 일정 공유', '일정 공유',
    '할일 위젯', '투두 위젯', '캘린더 위젯', '디데이 위젯', '기념일 디데이',
    '100일 계산기', '운동 기록', '러닝 기록', '음성 일정 등록', 'AI 캘린더',
    '할일 관리', '일정 관리 앱', '스케줄 관리',
  ],
};

/** 인자 파싱 — 의존성 없이 필요한 만큼만. */
function parseArgs(argv) {
  const opt = { store: 'both', delay: 2000, group: null, terms: null, compare: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--store') opt.store = argv[++i];
    else if (a === '--delay') opt.delay = Number(argv[++i]);
    else if (a === '--group') opt.group = argv[++i];
    else if (a === '--terms') opt.terms = argv[++i];
    else if (a === '--compare') opt.compare = argv[++i];
  }
  return opt;
}

/** 측정할 검색어 목록을 정한다(파일 > 그룹 > 전체 순으로 우선). */
function resolveTerms(opt) {
  if (opt.terms) {
    return readFileSync(path.resolve(REPO, opt.terms), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  if (opt.group) {
    const g = TERM_GROUPS[opt.group];
    if (!g) {
      console.error(`알 수 없는 그룹: ${opt.group} (가능: ${Object.keys(TERM_GROUPS).join(', ')})`);
      process.exit(1);
    }
    return g;
  }
  return Object.values(TERM_GROUPS).flat();
}

/** 순위를 사람이 읽는 문자열로. null 은 "목록 밖"이라는 뜻이라 총 결과 수를 같이 보여 준다. */
function fmtRank(rank, total, ok) {
  if (!ok) return '조회실패';
  if (rank == null) return `—(${total}개 중 없음)`;
  return `${rank}위`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const terms = resolveTerms(opt);
  const doIos = opt.store === 'both' || opt.store === 'ios';
  const doPlay = opt.store === 'both' || opt.store === 'play';

  console.log(
    `검색어 ${terms.length}개 · 스토어 ${opt.store} · 간격 ${opt.delay}ms ` +
    `(예상 ${Math.ceil((terms.length * (doIos + doPlay) * opt.delay) / 1000)}초)\n`
  );

  const rows = [];
  for (const term of terms) {
    const row = { term };

    if (doIos) {
      const r = await searchAppStore(term, { country: 'kr', limit: 200 });
      row.ios = { ok: r.ok, rank: r.ok ? rankOf(r.apps, IOS_APP_ID) : null, total: r.apps.length };
      await sleep(opt.delay);
    }
    if (doPlay) {
      const r = await searchPlay(term);
      row.play = { ok: r.ok, rank: r.ok ? rankOf(r.apps, PLAY_PKG) : null, total: r.apps.length };
      await sleep(opt.delay);
    }

    rows.push(row);
    // 한 줄씩 즉시 출력한다 — 전체가 몇 분 걸리므로 중간에 끊겨도 결과가 남아야 한다.
    const ios = row.ios ? fmtRank(row.ios.rank, row.ios.total, row.ios.ok) : '-';
    const play = row.play ? fmtRank(row.play.rank, row.play.total, row.play.ok) : '-';
    console.log(`${term.padEnd(16)} iOS ${ios.padEnd(18)} Play ${play}`);
  }

  // ── 저장 ────────────────────────────────────────────────────────────────
  // 같은 날 **전체 측정**을 여러 번 돌리면 덮어쓴다(하루 안의 재측정은 마지막 것이 맞다).
  //
  // 🔴 그러나 **부분 측정은 절대 전체 파일을 덮어쓰지 않는다.** 09-16 에 실제로 당했다 —
  //    `--group brand --store play` 로 7개만 재보고는 25개×양 스토어 기준선을 날렸다.
  //    비교(--compare)의 상대가 되는 파일이라, 부분 데이터로 덮이면 전후 비교가 불가능해진다.
  //    ⇒ 부분 측정은 파일명에 조건을 붙여 따로 남긴다.
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join(REPO, 'build');
  mkdirSync(outDir, { recursive: true });
  const isPartial = opt.store !== 'both' || Boolean(opt.group) || Boolean(opt.terms);
  const suffix = isPartial
    ? '-' + [opt.group || (opt.terms ? 'custom' : null), opt.store !== 'both' ? opt.store : null]
        .filter(Boolean).join('-')
    : '';
  const outPath = path.join(outDir, `aso-rank-${date}${suffix}.json`);
  writeFileSync(outPath, JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2));
  console.log(`\n저장: ${path.relative(REPO, outPath)}`);

  // ── 요약: 손볼 곳을 바로 보이게 한다
  const dead = rows.filter((r) => r.ios?.ok && r.ios.rank == null).map((r) => r.term);
  const weak = rows.filter((r) => r.ios?.ok && r.ios.rank != null && r.ios.rank > 50).map((r) => r.term);
  const good = rows.filter((r) => r.ios?.ok && r.ios.rank != null && r.ios.rank <= 10).map((r) => r.term);
  if (doIos) {
    console.log(`\n[iOS] 1~10위 ${good.length}개: ${good.join(', ') || '없음'}`);
    console.log(`[iOS] 51위~ ${weak.length}개: ${weak.join(', ') || '없음'}`);
    console.log(`[iOS] 미노출 ${dead.length}개: ${dead.join(', ') || '없음'}`);
  }

  // ── 비교 모드: 이전 측정 파일과 순위 변화를 보여 준다
  if (opt.compare) {
    const prev = JSON.parse(readFileSync(path.resolve(REPO, opt.compare), 'utf8'));
    const prevMap = new Map(prev.rows.map((r) => [r.term, r]));
    console.log(`\n=== 변화 (${prev.measuredAt} 대비) ===`);
    for (const row of rows) {
      const p = prevMap.get(row.term);
      if (!p) continue;
      for (const store of ['ios', 'play']) {
        const a = p[store]?.rank ?? null;
        const b = row[store]?.rank ?? null;
        if (a === b) continue;
        const arrow = b == null ? '→ 이탈' : a == null ? '→ 진입' : a > b ? '↑' : '↓';
        console.log(`${row.term.padEnd(16)} ${store} ${a ?? '없음'} → ${b ?? '없음'} ${arrow}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('측정 실패:', e);
  process.exit(1);
});
