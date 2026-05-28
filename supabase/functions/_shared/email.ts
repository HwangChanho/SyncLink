/**
 * Resend API wrapper — 관리자 알림 등 트랜잭션 메일 전용.
 *
 * Env:
 *   RESEND_API_KEY      — Resend 의 API 키
 *   ADMIN_NOTIFY_EMAIL  — 관리자 알림 수신 주소 (예: cksgh0316@gmail.com)
 *
 * Resend Free tier 주의:
 *   - 본인 가입 email + 인증된 도메인만 send 가능
 *   - 미인증 도메인은 `onboarding@resend.dev` 발신만 허용
 *
 * 사용:
 *   import { sendAdminEmail } from '../_shared/email.ts';
 *   await sendAdminEmail({ subject: '...', html: '...' });
 */

interface SendArgs {
  subject: string;
  /** HTML 본문. 간단 텍스트라도 <p> 로 감싸기. */
  html: string;
  /** 기본 = ADMIN_NOTIFY_EMAIL. 다른 수신자 명시 시 override. */
  to?: string | string[];
  /** 기본 = 'SyncLink <onboarding@resend.dev>'. 도메인 인증 후 변경. */
  from?: string;
}

/** 본인 admin 에게 알림 메일 1통 발송. 실패해도 caller 에 throw — caller 가 swallow. */
export async function sendAdminEmail(args: SendArgs): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY missing — skip send');
    return;
  }
  const to = args.to ?? Deno.env.get('ADMIN_NOTIFY_EMAIL') ?? '';
  if (!to) {
    console.warn('[email] no recipient — skip send');
    return;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    args.from ?? 'SyncLink <onboarding@resend.dev>',
      to:      Array.isArray(to) ? to : [to],
      subject: args.subject,
      html:    args.html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[email] Resend error ${resp.status}: ${body.slice(0, 300)}`);
    // throw 하지 않음 — webhook 의 main path 가 email 실패로 막히지 않게.
  }
}
