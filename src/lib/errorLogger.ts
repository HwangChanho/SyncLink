/**
 * 클라이언트 중앙 에러 로거.
 *
 * 서비스 레이어에서 catch한 에러를 `error_logs` 테이블에 기록한다.
 * LEAD는 `scripts/tail-errors.sh` 로 최근 에러를 즉시 확인할 수 있다.
 *
 * 사용 예:
 *   try { ... } catch (err) {
 *     await logError({ context: 'event.create', error: err, details: { input } });
 *     throw err;
 *   }
 *
 * 설계 원칙:
 *  - 로깅 실패는 절대 throw하지 않는다 (무한 루프 방지)
 *  - 콘솔에도 항상 동시에 출력해 개발자 도구에서 바로 보이도록
 *  - message는 2000자로 자름 → 비정상적으로 긴 에러로 테이블이 폭발하지 않도록
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

/** 로그 심각도 단계. 운영 쿼리에서 필터링 기준으로 사용. */
export type ErrorSeverity = 'error' | 'warn' | 'info';

/**
 * logError 호출 시 전달하는 옵션.
 *
 * @property context  발생 위치 식별자. dot-separated 권장 (예: 'auth.kakao', 'event.create')
 * @property error    Error 객체 또는 임의의 throw 값
 * @property severity 기본값 'error'
 * @property details  stack trace 외에 보존하고 싶은 정보 (request body, 응답 등)
 * @property userId   에러 발생 시점의 user ID (알 수 있으면 전달)
 */
export interface LogErrorOptions {
  context: string;
  error: unknown;
  severity?: ErrorSeverity;
  details?: Record<string, unknown>;
  userId?: string | null;
}

/**
 * PostgrestError / supabase-js error 직렬화. instanceof Error 못 잡는 plain
 * object 도 message/code/details/hint 추출. 모든 service 공용 — 중복 헬퍼
 * 제거 (Build-92 todoService 의 serializePgError 가 origin).
 */
export function serializePgError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { raw: String(err) };
  const e = err as Record<string, unknown>;
  return {
    message: e.message ?? null,
    code:    e.code    ?? null,
    details: e.details ?? null,
    hint:    e.hint    ?? null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 에러를 `error_logs` 테이블에 기록한다.
 *
 * 네트워크 오류나 RLS 차단 등으로 로깅 자체가 실패할 수 있지만,
 * 호출자가 catch 하지 않아도 되도록 내부에서 모든 예외를 흡수한다.
 *
 * @param opts 로그 옵션 (LogErrorOptions 참고)
 */
/**
 * Build-92 LEAD: "로그는 디밸로퍼 모드에서만 활성화시켜야해 실제 배포버전은
 * 제외야". 일반 사용자 device 의 production 빌드는 error_logs 에 INSERT
 * 안 함 — 사용자 활동 비공개 + DB 비용 절감. 콘솔 출력 (Sentry / Xcode /
 * Android Studio 에서 LEAD 진단용) 은 모든 환경에서 유지.
 *
 * 활성 조건:
 *  - `__DEV__` (Metro debug bundle, App Store/TestFlight 의 release 번들은 false)
 *  - 또는 EXPO_PUBLIC_APP_ENV !== 'production' (preview/staging 은 logging)
 */
const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV;
const SHOULD_PERSIST_LOGS =
  // Metro debug bundle (개발 모드)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof __DEV__ !== 'undefined' && (__DEV__ as boolean))
  || APP_ENV !== 'production';

export async function logError(opts: LogErrorOptions): Promise<void> {
  if (SHOULD_PERSIST_LOGS) {
    try {
      const errorObj = opts.error;
      // Error 객체면 .message/.stack 추출, 아니면 문자열로 강제 변환
      const message = errorObj instanceof Error ? errorObj.message : String(errorObj);
      const stack   = errorObj instanceof Error ? errorObj.stack   : undefined;

      // supabase-js v2 Database 제네릭 한계 우회 (다른 서비스와 동일한 패턴)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('error_logs') as any).insert({
        context:     opts.context,
        severity:    opts.severity ?? 'error',
        // 길이 제한: 극단적으로 긴 message로 인덱스/스토리지가 터지지 않게
        message:     message.slice(0, 2000),
        details:     { ...(opts.details ?? {}), stack },
        user_id:     opts.userId ?? null,
        platform:    Platform.OS,
        app_version: Constants.expoConfig?.version ?? '1.0.0',
      });
    } catch {
      // 로깅 실패는 무시 — 재귀 호출로 인한 무한 루프 방지
    }
  }

  // 콘솔에는 항상 출력 (개발자 도구/Sentry에서도 보이도록).
  // production 사용자 device 도 console.error 까지는 띄움 — Sentry 가
  // capture 하면 거기서 진단.
  console.error(`[${opts.context}]`, opts.error);
}
