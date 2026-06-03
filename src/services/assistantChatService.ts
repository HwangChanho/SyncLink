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
  /**
   * 'quota' = quota_free_daily / quota_pro_hourly; 'auth' = 인증 실패;
   * 'ai_unavailable' = AI 서비스 일시 중단(크레딧 소진 등 — 사용자 잘못 아님);
   * 'other' = 기타.
   */
  kind: 'quota' | 'auth' | 'ai_unavailable' | 'other';
  message: string;
}

export interface SendTurnPayload {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  locale?: string;
  /** v1.2 마무리 — Pro 전용 사진 첨부. 마지막 user 메시지에 attach. */
  image?: {
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  };
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
          ...(payload.image ? { image: payload.image } : {}),
        },
      },
    );

    if (error) {
      // supabase-js 는 4xx/5xx 도 error 로 surface. 본문(error.context)에서 에러 키를
      // 읽어 정확히 분류 (메시지만으로는 503/ai_unavailable 구분이 안 됨).
      let bodyKey = '';
      try {
        // FunctionsHttpError 는 .context 에 원본 Response 를 담는다.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === 'function') {
          const b = await ctx.json();
          bodyKey = typeof b?.error === 'string' ? b.error : '';
        }
      } catch { /* 본문 파싱 실패 무시 */ }

      const msg = (error as Error).message ?? '';
      const isAiDown = /ai_unavailable|503/i.test(bodyKey) || /503/.test(msg);
      const isQuota  = /quota/i.test(bodyKey) || /429|quota/i.test(msg);
      const isAuth   = /auth/i.test(bodyKey) || /401|auth/i.test(msg);
      const kind: AssistantTurnError['kind'] =
        isAiDown ? 'ai_unavailable' : isQuota ? 'quota' : isAuth ? 'auth' : 'other';
      void logError({
        context: 'assistant-chat.invoke',
        error,
        details: { kind, bodyKey },
      });
      return {
        error: {
          kind,
          message:
            kind === 'ai_unavailable'
              ? 'AI 기능을 일시적으로 사용할 수 없어요. 잠시 후 다시 시도해 주세요. (문제가 계속되면 운영자에게 자동으로 알림이 가요)'
              : kind === 'quota'
                ? '오늘 사용 가능한 횟수를 초과했어요. 내일 다시 시도하거나 Pro 로 업그레이드하세요.'
                : kind === 'auth'
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
