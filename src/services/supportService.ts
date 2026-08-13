/**
 * supportService — 앱 내 버그 제보 / 문의 전송.
 *
 * 종전에는 `mailto:` 로 사용자의 메일 앱을 열었는데, 웹에서 브라우저가 막으면
 * 아무 일도 일어나지 않고(조용한 실패) 메일 앱이 없는 기기엔 경로가 아예 없었다.
 * 이제 Edge Function `submit-support` 가 받아 저장하고 관리자 메일로 알린다.
 *
 * 진단 정보는 **여기서 모아 붙인다** — 화면이 매번 조립하면 항목이 빠지기 쉽고,
 * 문의마다 담긴 정보가 달라져 원인 추적이 어려워진다.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '@/lib/supabase';

/** 제보 종류. DB CHECK 제약과 같은 값이어야 한다. */
export type SupportKind = 'bug' | 'inquiry';

/** 본문 길이 한계 — DB CHECK · Edge Function 과 같은 값. */
export const SUPPORT_MSG_MIN = 5;
export const SUPPORT_MSG_MAX = 4000;

export interface SubmitSupportInput {
  kind: SupportKind;
  message: string;
  /** 비로그인 사용자가 답장을 원할 때. 로그인 사용자는 계정 메일이 자동으로 쓰인다. */
  replyEmail?: string;
}

export interface SubmitSupportResult {
  id: string;
  /** 관리자 메일까지 나갔는지. false 여도 접수 자체는 성공이다. */
  emailed: boolean;
}

/** 제보에 자동 첨부할 환경 정보. 사용자가 적지 않아도 재현 조건을 좁힐 수 있게. */
function collectDiagnostics(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    appVersion: Constants.expoConfig?.version ?? '?',
    buildNumber:
      (Platform.OS === 'ios'
        ? Constants.expoConfig?.ios?.buildNumber
        : Constants.expoConfig?.android?.versionCode?.toString()) ?? '?',
    platform: Platform.OS,
    osVersion: String(Platform.Version ?? '?'),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...extra,
  };
}

/**
 * 제보를 서버로 보낸다.
 *
 * @throws Error 사용자에게 그대로 보여줄 수 있는 메시지 키(`support.error_*`)를 담는다.
 *         호출부가 i18n 으로 번역해 표시한다.
 */
export async function submitSupport(
  input: SubmitSupportInput,
  extraDiagnostics?: Record<string, unknown>,
): Promise<SubmitSupportResult> {
  const message = input.message.trim();
  if (message.length < SUPPORT_MSG_MIN) throw new Error('support.error_too_short');
  if (message.length > SUPPORT_MSG_MAX) throw new Error('support.error_too_long');

  const { data, error } = await supabase.functions.invoke('submit-support', {
    body: {
      kind: input.kind,
      message,
      replyEmail: input.replyEmail?.trim() || undefined,
      diagnostics: collectDiagnostics(extraDiagnostics),
    },
  });

  if (error) {
    // functions.invoke 는 비-2xx 를 FunctionsHttpError 로 감싸므로 본문을 꺼내
    // 어떤 실패인지 구분한다. 못 꺼내면 일반 실패로 처리한다.
    let code = '';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) code = ((await ctx.json()) as { error?: string })?.error ?? '';
    } catch { /* 본문이 없거나 JSON 이 아니면 일반 실패 */ }

    if (code === 'rate_limited') throw new Error('support.error_rate_limited');
    if (code === 'invalid_email') throw new Error('support.error_invalid_email');
    if (code === 'message_too_short') throw new Error('support.error_too_short');
    if (code === 'message_too_long') throw new Error('support.error_too_long');
    throw new Error('support.error_failed');
  }

  const res = data as { id: string; emailed: boolean };
  return { id: res.id, emailed: res.emailed };
}
