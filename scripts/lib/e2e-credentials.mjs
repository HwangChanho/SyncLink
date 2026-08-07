/**
 * e2e-credentials — resolve the shared QA/E2E account password without hardcoding it.
 *
 * The password used to be a literal in a dozen files. This repo is public, so it now
 * lives only in `.env` (gitignored) and in each runner's environment.
 *
 * Resolution order:
 *   1. process.env.E2E_PASSWORD          — CI, or an explicit `E2E_PASSWORD=… npm run …`
 *   2. E2E_PASSWORD in the repo's .env   — the normal local path; Node does not load
 *                                          .env on its own and we have no dotenv dep
 *
 * Throws a instructive error when neither is set, so a missing value fails loudly at
 * startup instead of surfacing as a confusing "invalid credentials" from Supabase.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, derived from this file's location (scripts/lib/…). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Read a single key out of the repo `.env`, without pulling in a dotenv dependency.
 * @param {string} key
 * @returns {string | undefined} the value, or undefined if the file or key is absent
 */
function readFromDotEnv(key) {
  let text;
  try {
    text = readFileSync(resolve(REPO_ROOT, '.env'), 'utf8');
  } catch {
    return undefined; // no .env — fine, the caller reports the combined failure
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1 || trimmed.slice(0, eq).trim() !== key) continue;
    // Strip an inline `# comment` and any surrounding quotes.
    let value = trimmed.slice(eq + 1).replace(/\s+#.*$/, '').trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    return value || undefined;
  }
  return undefined;
}

/**
 * The shared password for the `@synclink.test` QA accounts.
 * @param {string} [envVar] alternative variable to check first (e.g. AI_EVAL_PASSWORD)
 * @returns {string}
 * @throws {Error} when no source provides a value
 */
export function e2ePassword(envVar) {
  const value =
    (envVar && process.env[envVar]) || process.env.E2E_PASSWORD || readFromDotEnv('E2E_PASSWORD');
  if (!value) {
    throw new Error(
      'E2E 계정 비밀번호를 찾을 수 없습니다.\n' +
        `  · 환경변수로 지정: E2E_PASSWORD=… ${process.argv[1] ?? ''}\n` +
        '  · 또는 .env 에 E2E_PASSWORD=… 를 추가하세요 (.env 는 gitignore 대상).' +
        (envVar ? `\n  · ${envVar} 로도 지정할 수 있습니다.` : ''),
    );
  }
  return value;
}
