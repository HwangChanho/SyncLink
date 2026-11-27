/**
 * __tests__/lib/bootConnection.test.ts
 *
 * 앱 부팅 때 프로필 조회 결과를 «찾음 / 없음 / 서버에 닿지 않음» 으로 가르는 규칙 테스트. (2026-11-27)
 *
 * 왜 이 테스트가 필요한가:
 *  ① 🔴 **연결 실패를 «프로필 없음» 으로 취급하면 로그인한 사람이 게스트로 떨어진다.**
 *     예전 getUserProfile 은 모든 오류를 null 로 돌려줘, 서버 장애(11-25) 때
 *     로그인한 사용자도 로그아웃된 것처럼 보였다. 상태 0(연결 실패·시간 초과)과
 *     5xx 는 반드시 'unreachable' 이어야 한다.
 *  ② 🔴 **4xx 를 'unreachable' 로 올리면 안 된다.** 탈퇴·권한 문제처럼 다시 시도해도
 *     안 풀리는 경우가 «연결 안내 + 다시 시도» 화면에 영원히 갇힌다. 그래서 4xx 는
 *     지금까지처럼 'missing'(로딩만 끝냄)으로 둔다.
 */

import { classifyProfileResponse } from '@/lib/bootConnection';

/** 테스트용 프로필 행 — 내용은 판정과 무관하고 그대로 돌려받는지만 본다. */
const row = { id: 'user-123', nickname: '테스트' };

describe('classifyProfileResponse — 부팅 프로필 조회 판정', () => {
  it('데이터가 있고 오류가 없으면 found + 행 그대로', () => {
    expect(classifyProfileResponse({ data: row, error: null, status: 200 }))
      .toEqual({ kind: 'found', row });
  });

  it('상태 0(연결 실패·시간 초과로 중단) → unreachable', () => {
    expect(classifyProfileResponse({ data: null, error: { message: 'TypeError: Network request failed' }, status: 0 }))
      .toEqual({ kind: 'unreachable' });
  });

  it.each([500, 502, 503, 504, 520, 544])('서버 오류 %i → unreachable', (status) => {
    expect(classifyProfileResponse({ data: null, error: { message: 'server' }, status }))
      .toEqual({ kind: 'unreachable' });
  });

  it('406(.single() 결과 0행 — PGRST116) → missing (기존 동작 유지)', () => {
    expect(classifyProfileResponse({ data: null, error: { code: 'PGRST116' }, status: 406 }))
      .toEqual({ kind: 'missing' });
  });

  it.each([400, 401, 403, 404])('클라이언트 오류 %i → missing (다시 시도해도 안 풀리는 경우를 가두지 않는다)', (status) => {
    expect(classifyProfileResponse({ data: null, error: { message: 'client' }, status }))
      .toEqual({ kind: 'missing' });
  });

  it('오류도 데이터도 없으면 missing', () => {
    expect(classifyProfileResponse({ data: null, error: null, status: 200 }))
      .toEqual({ kind: 'missing' });
  });
});
