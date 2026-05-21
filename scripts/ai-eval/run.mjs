#!/usr/bin/env node
// scripts/ai-eval/run.mjs
//
// scenarios.json 의 시나리오를 순회하며 assistant-chat 호출 + 검증.
// 결과: PASS / FAIL 표 + 실패 시나리오의 상세 (응답 텍스트 + 도구 호출).
//
// 사용:
//   node scripts/ai-eval/run.mjs                # 전체
//   node scripts/ai-eval/run.mjs --only "분석"   # 이름에 "분석" 포함
//   node scripts/ai-eval/run.mjs --skipMutate   # createEvent 등 mutate skip
//
// 검증 규칙:
//   - tools          : 응답 executed[].tool 에 모두 포함되어야 함
//   - toolsExclude   : 응답에 포함되면 안 됨
//   - containsAny    : text 에 키워드 중 하나 이상 포함
//   - maxTextLength  : text 글자 수 <= 값

import { readFile } from 'node:fs/promises';
import { signInDev } from './lib/auth.mjs';
import { callAssistant } from './lib/client.mjs';

const args = process.argv.slice(2);
const ONLY_FLAG       = args.includes('--only')        ? args[args.indexOf('--only') + 1] : null;
const SKIP_MUTATE     = args.includes('--skipMutate');
const VERBOSE         = args.includes('--verbose');

/**
 * 한 시나리오 검증.
 * @returns {{ pass: boolean, reasons: string[] }}
 */
function verify(scenario, response) {
  const reasons = [];
  const tools = (response.executed ?? []).map((e) => e.tool);
  const expect = scenario.expect ?? {};

  // v1.1.5 — fallback 응답 강제 FAIL. 이전엔 fallback 텍스트에 키워드가
  // 우연히 들어가면 PASS 로 통과될 위험이 있었음. 명시적 noResponse flag
  // 또는 fallback 문구 매치로 잡음.
  if (response.noResponse === true) {
    reasons.push('noResponse=true (model produced no final text)');
  }
  if ((response.text ?? '').startsWith('응답을 받지 못했어요')) {
    reasons.push('fallback text detected — model produced no usable answer');
  }

  if (expect.tools) {
    for (const t of expect.tools) {
      if (!tools.includes(t)) reasons.push(`expected tool "${t}" missing (got [${tools.join(',') || 'none'}])`);
    }
  }
  if (expect.toolsExclude) {
    for (const t of expect.toolsExclude) {
      if (tools.includes(t)) reasons.push(`tool "${t}" should NOT be called`);
    }
  }
  if (expect.containsAny) {
    const text = response.text ?? '';
    const hit = expect.containsAny.some((kw) => text.includes(kw));
    if (!hit) reasons.push(`text missing all of [${expect.containsAny.join(',')}] — got "${text.slice(0, 80)}…"`);
  }
  if (typeof expect.maxTextLength === 'number') {
    const len = (response.text ?? '').length;
    if (len > expect.maxTextLength) reasons.push(`text too long ${len} > ${expect.maxTextLength}`);
  }
  return { pass: reasons.length === 0, reasons };
}

async function main() {
  console.log('🔐 dev 계정 sign-in...');
  const { jwt, email } = await signInDev();
  console.log(`   ✓ ${email}`);

  const raw = await readFile(new URL('./scenarios.json', import.meta.url), 'utf8');
  const scenarios = JSON.parse(raw)
    .filter((s) => !ONLY_FLAG || s.name.includes(ONLY_FLAG))
    .filter((s) => !(SKIP_MUTATE && s.skipMutate));

  console.log(`\n📋 ${scenarios.length} 시나리오 실행\n`);
  const results = [];
  for (const [i, s] of scenarios.entries()) {
    const idx = String(i + 1).padStart(2, '0');
    process.stdout.write(`[${idx}] ${s.name} ... `);
    try {
      const t0 = Date.now();
      const res = await callAssistant({ jwt, prompt: s.user });
      const dur = Date.now() - t0;
      const v = verify(s, res);
      results.push({ scenario: s, response: res, verdict: v, ms: dur });
      process.stdout.write(`${v.pass ? '✅' : '❌'} (${dur}ms, ${res.executed?.length ?? 0} tools)\n`);
      if (VERBOSE || !v.pass) {
        console.log(`     prompt:  ${s.user}`);
        console.log(`     tools:   [${(res.executed ?? []).map((e) => e.tool).join(', ') || 'none'}]`);
        console.log(`     text:    ${(res.text ?? '').slice(0, 200).replace(/\n/g, ' ')}`);
        if (!v.pass) v.reasons.forEach((r) => console.log(`     ❗ ${r}`));
        console.log('');
      }
    } catch (err) {
      results.push({ scenario: s, error: err, verdict: { pass: false, reasons: [String(err.message)] }, ms: 0 });
      process.stdout.write(`💥 ${err.message}\n`);
    }
  }

  const pass = results.filter((r) => r.verdict.pass).length;
  const fail = results.length - pass;
  console.log(`\n📊 결과: ${pass}/${results.length} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(2);
});
