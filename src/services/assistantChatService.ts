/**
 * assistantChatService — Edge Fn `assistant-chat` 호출 헬퍼 (v1.2 Phase 2).
 *
 * 클라이언트 메시지 윈도우 + 사용자 로컬 시간 + locale 을 Edge Fn 에 전달.
 * Edge Fn 이 도구 실행 후 최종 텍스트 + executed 목록 반환.
 *
 * 에러 처리:
 *   - 429 quota → 토스트 + paywall CTA (caller 가 분기)
 *   - 401 auth  → 로그인 페이지 redirect (caller 가 분기)
 *   - 그 외 → 일반 에러 메시지
 */

import { supabase } from '@/lib/supabase';
import { logError } from '@/lib/errorLogger';

export interface AssistantTurnExecuted {
  tool: string;
  ok: boolean;
  summary: string;
}

export interface AssistantTurnResult {
  text: string;
  executed: AssistantTurnExecuted[];
  tokensUsed: number;
}

export interface AssistantTurnError {
  /** 'quota' = quota_free_daily / quota_pro_hourly; 'auth' = 인증 실패; 'other' = 기타. */
  kind: 'quota' | 'auth' | 'other';
  message: string;
}

export interface SendTurnPayload {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  locale?: string;
}

/**
 * Edge Fn 호출. 성공 시 result, 실패 시 error 둘 중 하나만 truthy.
 */
export async function sendAssistantTurn(
  payload: SendTurnPayload,
): Promise<{ result?: AssistantTurnResult; error?: AssistantTurnError }> {
  try {
    const { data, error } = await supabase.functions.invoke<AssistantTurnResult>(
      'assistant-chat',
      {
        body: {
          messages:     payload.messages,
          locale:       payload.locale ?? 'ko',
          clientNowIso: new Date().toISOString(),
        },
      },
    );

    if (error) {
      // supabase-js 는 4xx/5xx 도 error 로 surface. 메시지에서 quota 키워드 추출.
      const msg = (error as Error).message ?? '';
      const isQuota = /429|quota/i.test(msg);
      const isAuth  = /401|auth/i.test(msg);
      void logError({
        context: 'assistant-chat.invoke',
        error,
        details: { kind: isQuota ? 'quota' : isAuth ? 'auth' : 'other' },
      });
      return {
        error: {
          kind:    isQuota ? 'quota' : isAuth ? 'auth' : 'other',
          message: isQuota
            ? '오늘 사용 가능한 횟수를 초과했어요. 내일 다시 시도하거나 Pro 로 업그레이드하세요.'
            : isAuth
              ? '인증이 만료되었어요. 다시 로그인해 주세요.'
              : '잠시 후 다시 시도해 주세요.',
        },
      };
    }

    if (!data) {
      return { error: { kind: 'other', message: '응답이 비어있어요.' } };
    }
    return { result: data };
  } catch (e) {
    void logError({ context: 'assistant-chat.exception', error: e });
    return {
      error: {
        kind:    'other',
        message: e instanceof Error ? e.message : '알 수 없는 오류',
      },
    };
  }
}
