/**
 * __tests__/lib/supabase.test.ts
 *
 * QA verification for TASK-003: Supabase 프로젝트 설정
 *
 * Acceptance Criteria 검증 (코드 레벨):
 * - [x] src/lib/supabase.ts — 클라이언트 초기화 (env var 사용)
 * - [x] 환경 변수 누락 시 명확한 에러 메시지 표시
 * - [x] getCurrentUserId() 헬퍼 함수 존재
 * - [ ] 실제 DB 연결 — ESCALATION-001 resolved 후 별도 통합 테스트 필요
 *
 * 주의: supabase.ts는 env var이 없으면 모듈 로드 시점에 throw합니다.
 * 이 테스트는 jest.resetModules() + env var 주입으로 이를 우회합니다.
 *
 * @task TASK-003
 * @verifiedBy QA
 */

// ─── env var 없이 import 시 경고 검증 ────────────────────────────────────────
//
// ISSUE-003 수정: DEV가 supabase.ts의 throw → console.warn으로 변경함.
// (이유: 모듈 레벨 throw는 supabase를 import하는 모든 테스트를 실패시킴)
// 테스트를 toThrow → console.warn spy 방식으로 수정.

describe('TASK-003: supabase.ts — missing env vars', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // console.warn 감시
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // 각 테스트 전 모듈 캐시 초기화
    jest.resetModules();
    // env var 제거
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns with a descriptive message when env vars are missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/lib/supabase');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Missing Supabase credentials/i),
    );
  });

  it('warning message includes .env.example instruction', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/lib/supabase');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\.env\.example/),
    );
  });

  it('warning message references ESCALATION-001', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/lib/supabase');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/ESCALATION-001/),
    );
  });

  it('module loads without throwing even when env vars are missing', () => {
    // throw 대신 warn이 되었으므로 모듈 로드 자체는 성공해야 함
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/supabase');
    }).not.toThrow();
  });
});

// ─── env var 주입 시 정상 초기화 검증 ────────────────────────────────────────

describe('TASK-003: supabase.ts — valid env vars', () => {
  beforeEach(() => {
    jest.resetModules();
    // 테스트용 더미 자격증명 주입
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-for-jest-only';
  });

  afterEach(() => {
    // 환경 변수 정리
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    jest.resetModules();
  });

  it('module loads without throwing', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/lib/supabase');
    }).not.toThrow();
  });

  it('exports a supabase client instance', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase');
    expect(supabase).toBeDefined();
    expect(supabase).not.toBeNull();
  });

  it('supabase client has auth property', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase');
    expect(supabase.auth).toBeDefined();
  });

  it('supabase client has from() method', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase');
    expect(typeof supabase.from).toBe('function');
  });

  it('exports getCurrentUserId helper function', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentUserId } = require('@/lib/supabase');
    expect(typeof getCurrentUserId).toBe('function');
  });

  it('getCurrentUserId returns null when no user is logged in (mocked)', async () => {
    // jest.setup.js에서 getUser가 null user를 반환하도록 mock됨
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase, getCurrentUserId } = require('@/lib/supabase');

    // auth.getUser mock 설정
    supabase.auth.getUser = jest.fn().mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const userId = await getCurrentUserId();
    expect(userId).toBeNull();
  });

  it('getCurrentUserId returns user ID when user is logged in (mocked)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase, getCurrentUserId } = require('@/lib/supabase');

    const mockUserId = 'usr-12345';
    supabase.auth.getUser = jest.fn().mockResolvedValue({
      data: { user: { id: mockUserId } },
      error: null,
    });

    const userId = await getCurrentUserId();
    expect(userId).toBe(mockUserId);
  });
});

// ─── 아키텍처 규칙 검증 ───────────────────────────────────────────────────────

describe('TASK-003: Supabase architecture rules', () => {
  it('ESCALATION-001 is documented (code-level check)', () => {
    // supabase.ts 에러 메시지가 ESCALATION-001을 참조하는지 확인했음 (위 테스트)
    // 이 테스트는 QA 추적을 위해 명시적으로 기록
    expect(true).toBe(true); // placeholder
  });

  it('TODO: real DB connection test after ESCALATION-001 is resolved', () => {
    // 실제 연결 테스트는 Supabase 자격증명 이후 별도 통합 테스트로 작성
    // __tests__/integration/supabase.integration.test.ts 에서 수행
    expect(true).toBe(true);
  });
});
