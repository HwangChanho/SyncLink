/**
 * aiHealth — Anthropic(Claude) API 헬스/크레딧 감지 + LEAD 알림.
 *
 * 목적: 크레딧 소진/결제 문제로 AI 기능이 막히면 LEAD 에게 이메일로 즉시 알린다.
 *       AI 호출마다 실패하므로 같은 이슈로 메일 폭주하지 않게 dedup(claim_ops_alert).
 *
 * 사용 (Edge, service_role adminClient 필요):
 *   import { isCreditError, alertCreditExhausted } from '../_shared/aiHealth.ts';
 *   try { ... anthropic.messages.create(...) ... }
 *   catch (err) {
 *     if (isCreditError(err)) {
 *       await alertCreditExhausted(adminClient, { fn: 'assistant-chat' });
 *       return new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 503 });
 *     }
 *     throw err;
 *   }
 */

// @ts-expect-error: Deno 상대 경로 import — tsc 는 해석 못하지만 배포 시 정상.
import { sendAdminEmail } from './email.ts';

/**
 * 에러가 "크레딧 소진/결제" 류인지 판별.
 * Anthropic 은 잔액 부족 시 400 invalid_request_error +
 * "credit balance is too low" 메시지를 준다. SDK 는 이를 throw.
 */
export function isCreditError(err: unknown): boolean {
  const msg = (() => {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    try { return JSON.stringify(err); } catch { return String(err); }
  })().toLowerCase();

  return (
    msg.includes('credit balance is too low') ||
    msg.includes('insufficient') && msg.includes('credit') ||
    msg.includes('billing') && msg.includes('low') ||
    msg.includes('plans & billing')
  );
}

/**
 * AI 크레딧 소진 LEAD 알림 (이메일). dedup: 기본 24h 1통.
 *
 * @param adminClient service_role supabase 클라이언트 (claim_ops_alert 호출용)
 * @param ctx 어디서 감지됐는지 (fn 이름 등) — 메일 본문에 포함
 */
export async function alertCreditExhausted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  ctx: { fn: string; detail?: string } = { fn: 'unknown' },
): Promise<boolean> {
  try {
    // dedup — 24h 안에 이미 보냈으면 skip.
    const { data: shouldSend } = await adminClient.rpc('claim_ops_alert', {
      p_key: 'ai_credit_exhausted',
      p_cooldown_hours: 24,
    });
    if (!shouldSend) return false;

    const when = new Date().toISOString();
    await sendAdminEmail({
      subject: '🚨 SyncLink — Claude API 크레딧 소진 (AI 기능 중단)',
      html: [
        '<h2>Claude API 크레딧이 소진되어 AI 기능이 중단됐어요.</h2>',
        '<p>사용자에게 AI 비서·일정 파싱·주간 리뷰 등이 작동하지 않습니다.</p>',
        `<p><b>감지 위치</b>: ${ctx.fn}${ctx.detail ? ` (${ctx.detail})` : ''}</p>`,
        `<p><b>감지 시각</b>: ${when}</p>`,
        '<p><b>조치</b>: <a href="https://console.anthropic.com/settings/billing">Anthropic Console → Plans &amp; Billing</a> 에서 크레딧 충전.</p>',
        '<hr><p style="color:#888;font-size:12px">이 알림은 24시간에 1회만 발송됩니다 (dedup).</p>',
      ].join('\n'),
    });
    console.log(`[aiHealth] credit-exhausted alert sent (ctx=${ctx.fn})`);
    return true;
  } catch (e) {
    // 알림 실패가 main path 를 막지 않게 swallow.
    console.error('[aiHealth] alert failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}
