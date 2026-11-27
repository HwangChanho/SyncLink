/**
 * bootConnection — 앱 부팅 때 «서버에 닿지 않음» 을 가려내는 규칙과 시간 상수. (2026-11-27)
 *
 * 배경:
 *   앱은 시작할 때 프로필 1건(public.users)을 받아야 로딩 화면(AppSplash)을 걷는다.
 *   예전에는 조회 오류를 전부 «프로필 없음» 으로 취급해, 서버 장애(11-25) 때 로그인한
 *   사용자가 게스트로 떨어졌다. 또 서버가 대답하지 않으면(Android OkHttp 는 시간 제한 0 =
 *   무제한) 로딩 화면이 끝나지 않았다. LEAD 결정(11-27): «연결 안내 + 다시 시도».
 *
 * 이 파일은 순수 함수·상수만 둔다(네트워크·React 없음) — 테스트로 규칙을 고정하기 위해서다.
 */

/** 부팅이 이 시간(ms)을 넘기면 로딩 화면 위에 연결 안내를 띄운다. */
export const BOOT_CONNECTION_NOTICE_MS = 10_000;

/** 부팅 프로필 조회의 시간 제한(ms). 넘기면 요청을 중단하고 'unreachable' 로 본다. */
export const PROFILE_FETCH_TIMEOUT_MS = 10_000;

/**
 * 부팅 프로필 조회 결과.
 *  - found       : 프로필을 받았다 → 로그인 상태로 진입
 *  - missing     : 서버는 대답했지만 행이 없거나(406) 요청이 거절됐다(4xx) → 기존처럼 로딩만 끝낸다
 *  - unreachable : 서버에 닿지 않았다(연결 실패·시간 초과 = 상태 0, 또는 5xx) → 연결 안내
 */
export type ProfileLookup<T> =
  | { kind: 'found'; row: T }
  | { kind: 'missing' }
  | { kind: 'unreachable' };

/**
 * PostgREST 응답 하나를 ProfileLookup 으로 바꾼다.
 *
 * @param res - supabase-js 쿼리 결과. postgrest-js 는 fetch 실패·중단(abort)을 던지지 않고
 *              `status: 0` + error 객체로 돌려준다(postgrest-js 2.103 PostgrestBuilder.then).
 * @returns 판정 결과
 *
 * ⚠️ 4xx 를 'unreachable' 로 올리지 말 것 — 탈퇴·권한 문제처럼 다시 시도해도 안 풀리는
 *    경우가 «다시 시도» 화면에 영원히 갇힌다. 서버에 닿지 못한 경우만 'unreachable' 이다.
 */
export function classifyProfileResponse<T>(res: {
  data: T | null;
  error: unknown;
  status: number;
}): ProfileLookup<T> {
  // 1) 정상 — 데이터가 있고 오류가 없다
  if (!res.error && res.data) return { kind: 'found', row: res.data };
  // 2) 서버에 닿지 못함 — 연결 실패·시간 초과(상태 0) 또는 서버 쪽 오류(5xx)
  if (res.status === 0 || res.status >= 500) return { kind: 'unreachable' };
  // 3) 그 밖(0행 406·4xx·빈 응답) — 서버는 대답했다
  return { kind: 'missing' };
}
