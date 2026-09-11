/**
 * 등록 화면 i18n 회귀 방지 (1.4.15).
 *
 * 왜 필요한가 — 1.4.9 에서 등록을 4개 화면으로 쪼갤 때 **i18n 을 통째로 빠뜨렸다.**
 * `useTranslation` 이 0회였고 한글 리터럴이 22개 하드코딩된 채 스토어에 나갔다.
 * 앱은 ko/en/ja/zh 4개 언어를 내는데 **핵심 동선만 한국어 고정**이었다.
 *
 * 이 스위트가 지키는 것은 셋이다:
 *  ① 네 로케일의 `event.create` 키 집합이 **완전히 같다**
 *     → 한 언어에만 키가 없으면 그 언어에서 `event.create.xxx` 라는 **키 문자열이 화면에 뜬다.**
 *       런타임에 에러가 안 나서 조용히 새어나가는 종류다.
 *  ② 코드가 쓰는 키가 전부 정의돼 있다 (오타 포함)
 *  ③ 등록 화면 소스에 **사용자에게 보이는 한글 리터럴이 남아 있지 않다**
 *     → 새 문구를 추가할 때 다시 하드코딩하면 여기서 걸린다.
 *
 * 🔑 소스를 **문자열로 읽어서** 검사한다. 렌더 테스트로는 "그 언어에 키가 있는지"를
 *    네 언어 × 네 화면만큼 돌려야 하는데, 정작 잡고 싶은 건 키 누락이라 소스 대조가 싸고 정확하다.
 */

import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

/** 검사 대상 화면 — 1.4.9 에서 분리된 등록 4종. */
const SCREENS = [
  'src/components/event/CreateTypeSheet.tsx',
  'src/app/event/create-workout.tsx',
  'src/app/event/create-dday.tsx',
  'src/app/event/create-relative.tsx',
];

const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 로케일 파일에서 `event.create` 블록의 키 이름만 뽑는다. */
function createKeys(lang: string): Set<string> {
  const src = read(`src/locales/${lang}.ts`);
  const block = src.match(/\n {4}create: \{([\s\S]*?)\n {4}\},/);
  if (!block) throw new Error(`${lang}.ts 에 event.create 블록이 없습니다`);
  return new Set([...block[1].matchAll(/^ {6}([a-z0-9_]+):/gm)].map((m) => m[1]));
}

describe('등록 화면 i18n', () => {
  describe('네 로케일의 키 집합이 같다', () => {
    const ko = createKeys('ko');

    it('ko 에 키가 존재한다(기준)', () => {
      expect(ko.size).toBeGreaterThan(30);
    });

    it.each(LANGS.filter((l) => l !== 'ko'))('%s 가 ko 와 정확히 같다', (lang) => {
      const other = createKeys(lang);
      // 누락과 잉여를 나눠 보여준다 — 어느 쪽인지에 따라 고칠 곳이 다르다.
      expect([...ko].filter((k) => !other.has(k))).toEqual([]);
      expect([...other].filter((k) => !ko.has(k))).toEqual([]);
    });
  });

  it('코드가 참조하는 event.create 키가 전부 ko 에 정의돼 있다', () => {
    const ko = createKeys('ko');
    const used = new Set<string>();
    for (const f of SCREENS) {
      for (const m of read(f).matchAll(/event\.create\.([a-z0-9_]+)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((k) => !ko.has(k))).toEqual([]);
  });

  describe('사용자에게 보이는 한글이 소스에 남아 있지 않다', () => {
    /**
     * 주석은 한국어로 쓰는 것이 프로젝트 방침이라 제외한다.
     * 검사 대상은 **JSX 텍스트 · 문자열 리터럴**뿐이다.
     */
    function visibleKorean(src: string): string[] {
      return src
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
          const code = line.split('//')[0];
          // 따옴표 안의 한글, 또는 JSX 텍스트로 놓인 한글
          return /'[^']*[가-힣][^']*'|"[^"]*[가-힣][^"]*"|>[^<>{}]*[가-힣][^<>{}]*</.test(code);
        })
        .map((l) => l.trim());
    }

    it.each(SCREENS)('%s', (file) => {
      expect(visibleKorean(read(file))).toEqual([]);
    });
  });
});
