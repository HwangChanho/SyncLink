/**
 * __tests__/lib/nlParser.test.ts
 *
 * TASK-310: NL Parser Test Suite (QA)
 *
 * 62개 테스트 케이스 — 한국어 자연어 파싱 전체 커버리지:
 *  - 날짜 파싱    (19개): 오늘/내일/모레/이번 주/다음 주/월일/N일 후/N주 후/N달 후
 *  - 시간 파싱    (10개): 오전/오후/24시간/정오/자정
 *  - 날짜+시간 복합 (11개): confidence=high 조건, endAt 기본 +1시간
 *  - 장소 추출    (6개): ~에서/~에서 만/괄호 패턴
 *  - 반복 패턴    (7개): 매일/매주/매월/매년
 *  - edge cases   (7개): 빈 문자열, processingMs < 10, source/rawInput 검증
 *  - 제목 추출    (2개): 날짜·시간·장소 제거 후 나머지
 *
 * ── 날짜 단언 전략 ────────────────────────────────────────────────────────────
 * parseLocally()는 로컬 시간 기준 Date를 반환하므로
 * .toISOString() (UTC 변환) 대신 localDateStr() 헬퍼를 사용.
 * 타임존에 무관하게 동일한 YYYY-MM-DD 비교 가능.
 *
 * ── 기준 날짜 ────────────────────────────────────────────────────────────────
 * 모든 테스트: CTX = 2026-04-20 (월요일) 10:00 (로컬 시간)
 *
 * 이번 주 요일 규칙:
 *  - 아직 지나지 않은 요일 → 해당 주 날짜
 *  - 오늘(월) 포함 이미 지난 요일 → 다음 주로 이동
 *  예) 이번 주 월요일 → 2026-04-27 (오늘=이미 지남)
 *      이번 주 화요일 → 2026-04-21 (아직 안 지남)
 *
 * @task TASK-310
 * @depends TASK-300 (nlParser.ts implementation)
 */

import { parseLocally } from '@/lib/nlParser';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * Date → 'YYYY-MM-DD' 로컬 시간 기준 변환.
 * .toISOString()은 UTC 기준이라 시스템 타임존에 따라 날짜가 달라질 수 있음.
 */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 기준 날짜: 2026-04-20 (월요일) 10:00 (로컬 시간)
const CTX = new Date('2026-04-20T10:00:00');

// ─── 인프라 스모크 테스트 ──────────────────────────────────────────────────────

describe('nlParser 모듈 — 인프라 스모크', () => {
  it('nlParser 모듈을 오류 없이 import 가능', () => {
    expect(() => require('@/lib/nlParser')).not.toThrow();
  });

  it('parseLocally가 함수로 export됨', () => {
    expect(typeof parseLocally).toBe('function');
  });

  it('parseLocally는 항상 NLParseResult를 반환함', () => {
    const result = parseLocally('', CTX);
    expect(result).toHaveProperty('parsed');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('source');
    expect(result).toHaveProperty('rawInput');
  });
});

// ─── 1. 날짜 파싱 ──────────────────────────────────────────────────────────────

describe('날짜 파싱', () => {
  /**
   * 이번 주 요일 규칙 (ctx = 2026-04-20 월요일):
   *  - 오늘(월) 포함 이미 지난 요일 → 다음 주 해당 날짜
   *  - 아직 안 지난 요일 → 해당 주 날짜
   */
  test.each([
    // ── 상대적 표현 ──
    ['오늘 미팅',               '2026-04-20'],
    ['내일 점심',               '2026-04-21'],
    ['모레 약속',               '2026-04-22'],
    // ── 이번 주 (오늘=월요일 기준) ──
    ['이번 주 화요일 약속',     '2026-04-21'], // 아직 안 지남
    ['이번 주 수요일',          '2026-04-22'], // 아직 안 지남
    ['이번 주 목요일',          '2026-04-23'], // 아직 안 지남
    ['이번 주 금요일 점심',     '2026-04-24'], // 아직 안 지남
    ['이번 주 토요일',          '2026-04-25'], // 아직 안 지남
    ['이번 주 일요일',          '2026-04-26'], // 아직 안 지남
    ['이번 주 월요일',          '2026-04-27'], // 오늘 = 이미 지남 → 다음 주
    // ── 다음 주 ──
    ['다음 주 월요일',          '2026-04-27'],
    ['다음 주 화요일',          '2026-04-28'],
    ['다음 주 금요일',          '2026-05-01'],
    // ── 월/일 절대 날짜 ──
    ['5월 3일 발표',            '2026-05-03'],
    ['12월 25일 크리스마스',    '2026-12-25'],
    // ── N일/주/달 후 ──
    ['3일 후 모임',             '2026-04-23'],
    ['10일 후',                 '2026-04-30'],
    ['2주 후 여행',             '2026-05-04'],
    ['1달 후 검진',             '2026-05-20'],
  ] as [string, string][])(
    '%s → %s',
    (input, expected) => {
      const result = parseLocally(input, CTX);
      const date = result.parsed.startAt?.value;
      expect(date).toBeDefined();
      expect(localDateStr(date!)).toBe(expected);
      // 날짜를 인식했으므로 confidence는 low가 아님
      expect(result.confidence).not.toBe('low');
    },
  );
});

// ─── 2. 시간 파싱 ──────────────────────────────────────────────────────────────

describe('시간 파싱', () => {
  test.each([
    // [입력, 기대 시(hours), 기대 분(minutes)]
    ['오전 9시 출근',      9,  0],
    ['오전 10시 반',      10, 30],
    ['오후 1시 점심',     13,  0],
    ['오후 3시 회의',     15,  0],
    ['오후 6시 30분',     18, 30],
    ['밤 11시',           23,  0],
    ['14:30 미팅',        14, 30],
    ['9:00 조회',          9,  0],
    ['정오 점심',         12,  0],
    ['자정',               0,  0],
  ] as [string, number, number][])(
    '%s → %d시 %d분',
    (input, hour, minute) => {
      const result = parseLocally(input, CTX);
      const date = result.parsed.startAt?.value;
      expect(date).toBeDefined();
      expect(date!.getHours()).toBe(hour);
      expect(date!.getMinutes()).toBe(minute);
    },
  );
});

// ─── 3. 날짜+시간 복합 ────────────────────────────────────────────────────────

describe('날짜+시간 복합', () => {
  /** 날짜와 시간 모두 파싱되면 confidence = 'high' */
  test.each([
    '내일 오후 3시 카페에서 미팅',
    '이번 주 금요일 저녁 7시 강남역',
    '5월 1일 오전 10시 발표',
    '오늘 오전 9시 조회',
    '내일 14:30 팀 미팅',
    '모레 정오 점심 약속',
    '다음 주 화요일 오전 10시 회의',
    '5월 3일 오후 2시 발표',
  ])('%s → confidence=high', (input) => {
    expect(parseLocally(input, CTX).confidence).toBe('high');
  });

  /** 날짜만 파싱되면 confidence = 'medium' */
  test('날짜만 있을 때 confidence=medium', () => {
    const result = parseLocally('내일 점심 약속', CTX);
    expect(result.confidence).toBe('medium');
  });

  /** 시간만 파싱되면 confidence = 'medium' */
  test('시간만 있을 때 confidence=medium', () => {
    const result = parseLocally('오후 3시 미팅', CTX);
    expect(result.confidence).toBe('medium');
  });

  /** 종료 시간 미지정 시 startAt + 1시간이 endAt 기본값 */
  test('종료 시간 미지정 → endAt = startAt + 1시간', () => {
    const result = parseLocally('내일 오후 3시 미팅', CTX);
    const startAt = result.parsed.startAt?.value;
    const endAt   = result.parsed.endAt?.value;
    expect(startAt).toBeDefined();
    expect(endAt).toBeDefined();
    expect(endAt!.getTime() - startAt!.getTime()).toBe(60 * 60 * 1000);
  });
});

// ─── 4. 장소 추출 ──────────────────────────────────────────────────────────────

describe('장소 추출', () => {
  test.each([
    // [입력, 기대 장소 문자열]
    ['스타벅스에서 미팅',      '스타벅스'],
    ['강남역에서 만나',        '강남역'],
    ['서울역에서 기차 탑승',   '서울역'],
    ['(홍대) 파티',            '홍대'],
    ['(회의실 A) 팀 미팅',     '회의실 A'],
    ['강남역 카페에서 점심',   '강남역 카페'],
  ] as [string, string][])(
    '%s → 장소=%s',
    (input, location) => {
      const result = parseLocally(input, CTX);
      expect(result.parsed.location?.value).toBe(location);
    },
  );
});

// ─── 5. 반복 패턴 ──────────────────────────────────────────────────────────────

describe('반복 패턴', () => {
  test.each([
    // [입력, 기대 repeatType]
    ['매일 아침 운동',         'daily'],
    ['매주 월요일 팀 회의',    'weekly'],
    ['매주 화요일 점심',       'weekly'],
    ['매월 1일 결산',          'monthly'],
    ['매달 마지막 날 정산',    'monthly'], // 매달 = 매월
    ['매년 생일 파티',         'yearly'],
    ['매해 기념일 저녁',       'yearly'],  // 매해 = 매년
  ] as [string, string][])(
    '%s → repeatType=%s',
    (input, repeatType) => {
      const result = parseLocally(input, CTX);
      expect(result.parsed.repeatType?.value).toBe(repeatType);
    },
  );
});

// ─── 6. Edge cases ─────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('빈 문자열 → confidence=low', () => {
    expect(parseLocally('', CTX).confidence).toBe('low');
  });

  test('날짜/시간 없는 텍스트 → confidence=low', () => {
    expect(parseLocally('뭔가 있었는데', CTX).confidence).toBe('low');
  });

  test('한국어 아닌 임의 텍스트 → confidence=low', () => {
    expect(parseLocally('random text abc', CTX).confidence).toBe('low');
  });

  test('processingMs가 10ms 미만 (성능 기준)', () => {
    const result = parseLocally('내일 오후 3시 미팅', CTX);
    expect(result.processingMs).not.toBeNull();
    expect(result.processingMs!).toBeLessThan(10);
  });

  test('source는 항상 "local"', () => {
    expect(parseLocally('내일 오후 3시 미팅', CTX).source).toBe('local');
  });

  test('rawInput은 원본 텍스트 그대로 보존', () => {
    const input = '5월 3일 오후 2시 발표';
    expect(parseLocally(input, CTX).rawInput).toBe(input);
  });

  test('contextDate 생략 시 오류 없음 (기본값=현재)', () => {
    expect(() => parseLocally('내일 오후 3시 미팅')).not.toThrow();
  });
});

// ─── 7. 제목 추출 ──────────────────────────────────────────────────────────────

describe('제목 추출', () => {
  test('날짜·시간·장소 제거 후 나머지를 제목으로 추출', () => {
    const result = parseLocally('내일 오후 3시 카페에서 미팅', CTX);
    expect(result.parsed.title?.value.trim()).not.toBe('');
    expect(result.parsed.title?.value).toBeTruthy();
  });

  test('날짜·시간만 있는 입력에서도 제목이 존재', () => {
    const result = parseLocally('내일 오후 3시 회의', CTX);
    expect(result.parsed.title?.value.trim()).not.toBe('');
  });
});
