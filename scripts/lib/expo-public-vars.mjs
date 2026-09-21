/**
 * EXPO_PUBLIC_* 환경변수 점검의 **공통 규칙**.
 *
 * 왜 따로 뺐나 (2026-09-20):
 *   이 규칙을 읽는 곳이 둘이 됐다 —
 *     · `check-eas-env.mjs`      빌드 **시작 전**: 이름이 EAS 환경에 선언돼 있나
 *     · `verify-bundle-env.mjs`  빌드 **끝난 뒤**: 그 값이 번들에 실제로 박혔나
 *   양쪽에 같은 정규식·같은 예외 목록을 복사해 두면 **한쪽만 고쳐져 조용히 어긋난다.**
 *   이 프로젝트가 데인 사고가 정확히 그 부류라(선언과 실재가 갈리는 것) 한 곳에 둔다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 코드에서 환경변수를 읽는 형태. 여기가 두 검사기의 유일한 기준이다. */
const ENV_REF_PATTERN = /process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g;

/** 훑을 소스 확장자. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * EAS 환경에 **일부러** 두지 않는 변수들 — 값이 없을 때의 동작이 코드에 명시돼
 * 있고, 그 동작이 프로덕션에서 옳은 것만 넣는다.
 *
 * 🔴 새 이름을 추가하기 전에 반드시 "없으면 무슨 일이 일어나는가"를 **코드로** 확인할 것.
 *    확인 없이 추가하면 이 점검은 그저 경고를 지우는 장치가 된다 —
 *    2026-08-15 카카오 키처럼 조용히 깨지는 걸 잡으라고 만든 것이다.
 */
export const INTENTIONALLY_UNSET = {
  EXPO_PUBLIC_E2E_PASSWORD:
    '개발용 로그인 단축키. 미설정이면 버튼 자체가 사라진다(auth/login.tsx) — 프로덕션에 있으면 오히려 문제',
  EXPO_PUBLIC_INVITE_LINK_BASE:
    '초대링크를 커스텀 스킴으로 되돌리는 비상 스위치. 미설정이 기본이고 space/[id].tsx 가 ?? 로 정상값을 쓴다',
  EXPO_PUBLIC_RC_API_KEY_ANDROID:
    'Android 인앱결제 미도입이라 키를 발급하지 않았다. 빈 값이면 initializePurchases 가 초기화를 건너뛰고 plan 을 DB 로만 판단한다(purchaseService.ts)',
};

/**
 * 소스를 재귀 순회하며 코드가 참조하는 EXPO_PUBLIC_* 이름을 모은다.
 *
 * 🔑 정적으로 읽을 수 있는 `process.env.EXPO_PUBLIC_X` 형태만 센다. 문자열을 조합해
 *    동적으로 접근하는 코드는 애초에 쓰지 않는 것이 전제다 — Expo 의 인라인 치환도
 *    같은 전제 위에서 동작하므로, 동적 접근은 **번들에서도 값이 안 박힌다.**
 *
 * @param {string} dir 순회 시작 디렉토리
 * @param {Set<string>} found 누적 집합(재귀용)
 * @returns {Set<string>} 참조된 환경변수 이름 집합
 */
export function collectReferencedVars(dir, found = new Set()) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { collectReferencedVars(path, found); continue; }
    if (!EXTENSIONS.some((ext) => path.endsWith(ext))) continue;
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(ENV_REF_PATTERN)) found.add(m[1]);
  }
  return found;
}
