#!/usr/bin/env node
// scripts/ai-eval/playground.mjs
//
// AI 비서 REPL — 사용자가 직접 prompt 입력하면 즉시 응답 + 도구 호출
// 출력. 같은 세션 안에서 대화 history 유지 (multi-turn).
//
// 사용:
//   node scripts/ai-eval/playground.mjs
//   > 이번 주 일정 알려줘
//   > 그 중에 가장 긴 거 하나만
//   > /clear        ← history 초기화
//   > /quit         ← 종료

import readline from 'node:readline';
import { signInDev } from './lib/auth.mjs';
import { callAssistant } from './lib/client.mjs';

async function main() {
  console.log('🔐 dev 계정 sign-in...');
  const { jwt, email } = await signInDev();
  console.log(`   ✓ ${email}\n`);
  console.log('💬 AI 비서 playground — 명령: /clear, /quit\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  /** @type {Array<{role:'user'|'assistant', content:string}>} */
  const history = [];

  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    if (input === '/quit') return rl.close();
    if (input === '/clear') {
      history.length = 0;
      console.log('   (history cleared)\n');
      return rl.prompt();
    }
    try {
      const t0 = Date.now();
      const res = await callAssistant({ jwt, prompt: input, history });
      const dur = Date.now() - t0;
      const tools = (res.executed ?? []).map((e) => `${e.tool}${e.ok ? '' : '✗'}`).join(', ') || 'none';
      console.log(`\n🤖 (${dur}ms, tools: ${tools})\n${res.text}\n`);
      history.push({ role: 'user',      content: input });
      history.push({ role: 'assistant', content: res.text });
    } catch (err) {
      console.log(`💥 ${err.message}\n`);
    }
    rl.prompt();
  });
  rl.on('close', () => { console.log('\n👋'); process.exit(0); });
}

main().catch((err) => { console.error('💥', err); process.exit(2); });
