// scripts/ai-eval/lib/auth.mjs
//
// QA dev 계정으로 Supabase auth sign-in 해 user JWT 를 받음. assistant-chat
// Edge Function 이 user JWT 를 요구하므로 (Authorization: Bearer <jwt>),
// 자동 테스트 환경 진입점.
//
// 사용 계정: docs/qa/test-accounts.md 의 e2e-ios-sim-pro@synclink.test
// (공통 비밀번호는 E2E_PASSWORD 환경변수/.env, QA seed 스크립트로 idempotent).

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { e2ePassword } from '../../lib/e2e-credentials.mjs';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing in .env');
}

const DEFAULT_EMAIL    = process.env.AI_EVAL_EMAIL    ?? 'e2e-ios-sim-pro@synclink.test';
// AI_EVAL_PASSWORD wins, otherwise the shared E2E password (env or .env).
const DEFAULT_PASSWORD = e2ePassword('AI_EVAL_PASSWORD');

/**
 * dev 계정 sign-in → access_token 반환. 캐시 X — 매 호출마다 fresh JWT.
 *
 * @param {{ email?: string, password?: string }} [opts]
 * @returns {Promise<{ jwt: string, userId: string, email: string }>}
 */
export async function signInDev(opts = {}) {
  const email    = opts.email    ?? DEFAULT_EMAIL;
  const password = opts.password ?? DEFAULT_PASSWORD;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`signIn failed (${email}): ${error?.message ?? 'no session'}`);
  }
  return {
    jwt:    data.session.access_token,
    userId: data.user.id,
    email,
  };
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
