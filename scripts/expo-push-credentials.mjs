#!/usr/bin/env node
/**
 * Expo 푸시 자격증명 조회·등록 — Android FCM V1 키 누락을 잡고 고치는 도구.
 *
 * ▸ 왜 필요한가 (2026-09-09, 실제 장애)
 *   reactivation-push cron 이 처음으로 정상 동작한 날, 발송 16건 중 6건이 전부
 *   똑같은 오류로 실패했다:
 *     "Unable to retrieve the FCM server key for the recipient's app."
 *   EAS 자격증명을 실측하니 이 앱의 Android 항목이 셋 다 null 이었다
 *   (androidFcm · googleServiceAccountKeyForFcmV1 · ...ForSubmissions).
 *   반면 iOS 는 pushKey(K653C39XRD, 2026-04-22 등록)가 멀쩡했다.
 *   → 실패 6건은 일부 표본이 아니라 **Android 사용자 전원**이고, 이 앱의
 *     Android 푸시는 종류를 불문하고 한 번도 나간 적이 없다.
 *   🔑 형제 프로젝트(hairpin-a9639 · syncfortune-push)는 키가 등록돼 있다 —
 *      SyncLink 만 빠진 것이다. 절차를 몰라서가 아니라 이 앱에서만 누락됐다.
 *
 * ▸ 무엇을 하나
 *   --status (기본)   : iOS pushKey / Android FCM V1 등록 상태를 조회해 출력.
 *                       계정에 이미 있는 서비스 계정 키 목록도 함께 보여준다.
 *   --set-fcm-v1 <경로>: Google 서비스 계정 JSON 키를 Expo 계정에 등록하고
 *                       이 앱의 FCM V1 자격증명으로 연결한 뒤, **되읽어** 확인한다.
 *
 * ▸ 키는 어디서 받나 (LEAD 만 가능 — Firebase 콘솔 접근 권한이 필요하다)
 *   https://console.firebase.google.com/project/synclink-8c42a/settings/serviceaccounts/adminsdk
 *   → "새 비공개 키 생성" → 내려받은 JSON 의 경로를 --set-fcm-v1 에 넘긴다.
 *   ⚠️ 그 JSON 은 비밀이다. 이 스크립트는 파일에서 읽어 API 로만 보내고
 *      내용을 화면에 찍지 않는다. **저장소 안에 두지 말 것**(~/Downloads 등에서 바로 지정).
 *
 * ▸ 왜 `eas credentials` 대신 GraphQL 인가
 *   `eas credentials` 는 대화형 메뉴 전용이라(플래그가 -p 뿐) 스크립트로 못 쓴다.
 *   같은 일을 하는 공개 API 를 직접 부르면 등록 → 되읽기 검증까지 한 번에 끝난다.
 *
 * ▸ 인증
 *   ~/.expo/state.json 의 sessionSecret(= `eas login` 결과)을 재사용한다.
 *   없으면 `npx eas login` 후 다시 실행.
 *
 * ▸ 종료 코드
 *   0 = 조회 성공 / 등록·되읽기 검증 성공
 *   1 = 인증 없음 · API 오류 · 키 파일이 이 앱의 Firebase 프로젝트와 불일치 ·
 *       등록했는데 되읽기에서 안 보임
 *
 * 사용:
 *   node scripts/expo-push-credentials.mjs
 *   node scripts/expo-push-credentials.mjs --set-fcm-v1 ~/Downloads/synclink-xxxx.json
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_FULL_NAME = '@danielhwang/synclink';
const GRAPHQL_ENDPOINT = 'https://api.expo.dev/graphql';

/* ─────────────────────────── 인증 ─────────────────────────── */

/**
 * 로컬 EAS 로그인 세션을 읽는다.
 * @returns {string} sessionSecret — expo-session 헤더 값
 * @throws 로그인 정보가 없으면 안내 후 종료
 */
function readSessionSecret() {
  const statePath = join(homedir(), '.expo', 'state.json');
  try {
    const secret = JSON.parse(readFileSync(statePath, 'utf8'))?.auth?.sessionSecret;
    if (secret) return secret;
  } catch {
    /* 파일 없음/깨짐 — 아래 공통 안내로 떨어진다 */
  }
  fail(`Expo 로그인 정보가 없습니다(${statePath}).\n  → npx eas login 후 다시 실행하세요.`);
}

/* ─────────────────────────── GraphQL ─────────────────────────── */

const session = readSessionSecret();

/**
 * EAS GraphQL 호출. errors 가 있으면 즉시 실패시킨다
 * ("HTTP 200 인데 data 가 null" 을 성공으로 오독하지 않기 위해).
 * @param {string} query GraphQL 문서
 * @param {object} variables 변수
 * @returns {Promise<object>} data
 */
async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'expo-session': session },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    fail(`EAS API 오류 (HTTP ${res.status})\n  ${json.errors?.map((e) => e.message).join('\n  ') ?? '(본문 없음)'}`);
  }
  return json.data;
}

/* ─────────────────────────── 조회 ─────────────────────────── */

const APP_CREDENTIALS_QUERY = `
query($fullName: String!) {
  app {
    byFullName(fullName: $fullName) {
      id
      androidAppCredentials {
        id
        applicationIdentifier
        androidFcm { id version updatedAt }
        googleServiceAccountKeyForFcmV1 { id clientEmail projectIdentifier updatedAt }
      }
      iosAppCredentials {
        appleAppIdentifier { bundleIdentifier }
        pushKey { keyIdentifier updatedAt }
      }
    }
  }
}`;

const ACCOUNT_KEYS_QUERY = `
query {
  meActor {
    ... on User {
      accounts { id name googleServiceAccountKeys { id clientEmail projectIdentifier createdAt } }
    }
  }
}`;

/**
 * 이 앱의 Android/iOS 푸시 자격증명 현황을 조회한다.
 * @returns {Promise<{appId:string, android:object|undefined, ios:object[]}>}
 */
async function fetchCredentials() {
  const app = (await gql(APP_CREDENTIALS_QUERY, { fullName: APP_FULL_NAME })).app.byFullName;
  return {
    appId: app.id,
    // 이 앱은 Android 패키지가 하나(io.synclink.app)라 첫 항목이 곧 대상이다
    android: app.androidAppCredentials[0],
    ios: app.iosAppCredentials,
  };
}

/**
 * app.json 이 가리키는 google-services.json 에서 Firebase 프로젝트 id 를 읽는다.
 * 서비스 계정 키가 **같은 Firebase 프로젝트**의 것인지 대조하는 데 쓴다.
 * 🔴 이 대조가 없으면 형제 프로젝트 키를 잘못 넣어도 등록은 성공하고,
 *    푸시만 조용히 안 나간다(발신자 불일치). 값을 하드코딩하지 않고 앱이
 *    실제로 번들하는 파일에서 읽는 이유다.
 * @returns {string|null} 예: "synclink-8c42a"
 */
function readAppFirebaseProjectId() {
  for (const p of ['android/app/google-services.json', 'google-services.json']) {
    try {
      return JSON.parse(readFileSync(join(REPO_ROOT, p), 'utf8')).project_info.project_id;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

/** 조회 결과를 사람이 읽을 형태로 출력한다. */
async function printStatus() {
  const { android, ios } = await fetchCredentials();
  const appProjectId = readAppFirebaseProjectId();

  console.log('■ 앱:', APP_FULL_NAME, '/ Firebase 프로젝트:', appProjectId ?? '(읽기 실패)');

  console.log('\n■ Android 푸시');
  console.log('  패키지         :', android?.applicationIdentifier ?? '(자격증명 없음)');
  console.log('  FCM V1 서비스키:', android?.googleServiceAccountKeyForFcmV1
    ? `✅ ${android.googleServiceAccountKeyForFcmV1.clientEmail} (${android.googleServiceAccountKeyForFcmV1.projectIdentifier})`
    : '❌ 없음 — Android 푸시가 전부 실패한다');
  console.log('  구 FCM 서버키  :', android?.androidFcm ? `(v${android.androidFcm.version})` : '없음(FCM V1 을 쓰므로 정상)');

  console.log('\n■ iOS 푸시(대조군)');
  for (const c of ios ?? []) {
    console.log(`  ${c.appleAppIdentifier.bundleIdentifier}: ${c.pushKey ? `✅ ${c.pushKey.keyIdentifier}` : '없음'}`);
  }

  const accounts = (await gql(ACCOUNT_KEYS_QUERY)).meActor.accounts;
  console.log('\n■ 계정에 등록된 서비스 계정 키');
  for (const acc of accounts) {
    for (const k of acc.googleServiceAccountKeys) {
      const mine = k.projectIdentifier === appProjectId ? ' ← 이 앱의 프로젝트' : '';
      console.log(`  ${k.projectIdentifier.padEnd(20)} ${k.clientEmail}${mine}`);
    }
  }

  if (!android?.googleServiceAccountKeyForFcmV1) {
    console.log(
      '\n🔴 조치 필요 — Firebase 콘솔에서 서비스 계정 키를 받아 등록해야 한다(LEAD 권한):',
      `\n   1) https://console.firebase.google.com/project/${appProjectId}/settings/serviceaccounts/adminsdk`,
      '\n   2) "새 비공개 키 생성" → JSON 내려받기',
      '\n   3) node scripts/expo-push-credentials.mjs --set-fcm-v1 <내려받은 경로>',
    );
  }
}

/* ─────────────────────────── 등록 ─────────────────────────── */

const CREATE_KEY_MUTATION = `
mutation($input: GoogleServiceAccountKeyInput!, $accountId: ID!) {
  googleServiceAccountKey {
    createGoogleServiceAccountKey(googleServiceAccountKeyInput: $input, accountId: $accountId) {
      id clientEmail projectIdentifier
    }
  }
}`;

const SET_FCM_V1_MUTATION = `
mutation($id: ID!, $keyId: ID!) {
  androidAppCredentials {
    setGoogleServiceAccountKeyForFcmV1(id: $id, googleServiceAccountKeyId: $keyId) {
      id
      googleServiceAccountKeyForFcmV1 { id clientEmail projectIdentifier }
    }
  }
}`;

/**
 * 서비스 계정 JSON 키를 Expo 계정에 등록하고 이 앱의 FCM V1 자격증명으로 연결한다.
 * 마지막에 **별도 조회로 되읽어** 실제로 붙었는지 확인한다(뮤테이션 응답만 믿지 않는다).
 * @param {string} keyPath 내려받은 서비스 계정 JSON 경로
 */
async function setFcmV1(keyPath) {
  // 1) 키 파일 파싱 + 형식 검증 — 내용은 절대 출력하지 않는다
  let jsonKey;
  try {
    jsonKey = JSON.parse(readFileSync(resolve(keyPath), 'utf8'));
  } catch (e) {
    fail(`키 파일을 읽지 못했습니다: ${keyPath}\n  ${e.message}`);
  }
  if (jsonKey.type !== 'service_account' || !jsonKey.private_key || !jsonKey.client_email) {
    fail('서비스 계정 키 JSON 이 아닙니다(type/private_key/client_email 확인).\n'
      + '  Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" 으로 받은 파일이어야 합니다.');
  }

  // 2) 🔴 Firebase 프로젝트 대조 — 형제 프로젝트 키를 넣으면 등록은 되고 푸시만 조용히 안 간다
  const appProjectId = readAppFirebaseProjectId();
  if (appProjectId && jsonKey.project_id !== appProjectId) {
    fail(`키의 Firebase 프로젝트가 앱과 다릅니다.\n`
      + `  앱(google-services.json): ${appProjectId}\n`
      + `  키(JSON project_id)     : ${jsonKey.project_id}\n`
      + '  → 같은 프로젝트에서 받은 키여야 푸시가 나갑니다.');
  }

  // 3) 대상 앱 자격증명 + 계정 id 확보
  const { android } = await fetchCredentials();
  if (!android) fail('이 앱의 Android 자격증명 레코드가 없습니다 — 먼저 Android 빌드를 한 번 만들어야 합니다.');
  const accountId = (await gql(ACCOUNT_KEYS_QUERY)).meActor.accounts[0].id;

  // 4) 계정에 키 등록
  console.log('▸ 서비스 계정 키를 Expo 계정에 등록합니다…');
  const created = (await gql(CREATE_KEY_MUTATION, { input: { jsonKey }, accountId }))
    .googleServiceAccountKey.createGoogleServiceAccountKey;
  console.log(`  등록됨: ${created.clientEmail} (${created.projectIdentifier})`);

  // 5) 이 앱의 FCM V1 자격증명으로 연결
  console.log('▸ 앱의 FCM V1 자격증명으로 연결합니다…');
  await gql(SET_FCM_V1_MUTATION, { id: android.id, keyId: created.id });

  // 6) 되읽기 검증 — 뮤테이션 응답이 아니라 새 조회로 확인한다
  const after = (await fetchCredentials()).android?.googleServiceAccountKeyForFcmV1;
  if (after?.id !== created.id) {
    fail('연결 후 되읽었는데 값이 보이지 않습니다. Expo 대시보드에서 직접 확인하세요.');
  }
  console.log(`\n✅ 완료 — FCM V1 = ${after.clientEmail} (${after.projectIdentifier})`);
  console.log('   다음 발송부터 Android 푸시가 나갑니다(앱 재빌드 불필요 — 서버 측 자격증명).');
  console.log('   검증: 내일 reactivation-push 실행 뒤 reactivation_pushes 의 error 행이 사라지는지 볼 것.');
}

/* ─────────────────────────── 진입점 ─────────────────────────── */

/** 오류 메시지를 찍고 종료코드 1 로 끝낸다. @param {string} msg */
function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const setIndex = args.indexOf('--set-fcm-v1');

if (setIndex !== -1) {
  const keyPath = args[setIndex + 1];
  if (!keyPath) fail('--set-fcm-v1 뒤에 서비스 계정 JSON 경로를 지정하세요.');
  await setFcmV1(keyPath);
} else {
  await printStatus();
}
