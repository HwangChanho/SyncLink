// scripts/ai-eval/lib/client.mjs
//
// assistant-chat Edge Function 호출 래퍼. user JWT 와 prompt 받아 응답
// {text, executed[], tokensUsed} 반환.

import { SUPABASE_URL } from './auth.mjs';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/assistant-chat`;

/**
 * @typedef {{ tool: string, ok: boolean, summary: string }} Executed
 * @typedef {{ text: string, executed: Executed[], tokensUsed?: number }} ChatResponse
 */

/**
 * 단일 user prompt 로 assistant-chat 호출.
 *
 * @param {{
 *   jwt:    string,
 *   prompt: string,
 *   locale?: string,
 *   history?: Array<{ role: 'user' | 'assistant', content: string }>,
 * }} opts
 * @returns {Promise<ChatResponse>}
 */
export async function callAssistant({ jwt, prompt, locale = 'ko', history = [] }) {
  const body = {
    messages: [
      ...history,
      { role: 'user', content: prompt },
    ],
    locale,
    clientNowIso: new Date().toISOString(),
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`assistant-chat HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
