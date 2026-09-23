/**
 * otaUpdateService — OTA(EAS Update) 새 업데이트를 확인·내려받고, 적용(리로드)한다.
 *
 * 1.5.0 LEAD 지시(2026-09-23): "OTA 가 오면 앱 업데이트가 있습니다 문구를 띄우고 바로 리로드".
 *   예전에는 app.json 의 checkAutomatically: ON_LOAD 로 **실행할 때 뒤에서 받고 다음 실행에
 *   적용**만 됐다. 사용자는 앱을 두 번 껐다 켜야 새 화면을 봤다.
 *
 * 왜 서비스로 뺐나: expo-updates 호출과 "안전하게 건너뛸 조건" 판단을 한 곳에 모아
 *   테스트할 수 있게 하고, 화면(배너)은 결과만 보게 한다(CLAUDE.md 서비스 레이어 규칙).
 *
 * 🔴 OTA 는 **JS·에셋만** 바꾼다. 네이티브 모듈이 필요한 변경은 여기로 오면 안 된다
 *    (runtimeVersion 정책 appVersion 이 옛 바이너리를 막아 준다 — 메모리 reference_native_build_release).
 */
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * OTA 를 확인할 수 있는 환경인가.
 *   - 웹: EAS Update 대상이 아니다.
 *   - 개발 빌드(__DEV__): Metro 에서 JS 를 받으므로 OTA 가 의미 없다.
 *   - Updates.isEnabled=false: 업데이트가 꺼진 바이너리.
 * @returns 확인해도 되면 true
 */
export function canCheckOtaUpdate(): boolean {
  if (Platform.OS === 'web') return false;
  if (__DEV__) return false;
  return Updates.isEnabled === true;
}

/**
 * 서버에 새 업데이트가 있으면 내려받는다.
 *
 * @returns 새 업데이트를 **내려받아 적용할 준비가 됐으면** true.
 *          없거나, 확인할 수 없는 환경이거나, 네트워크 등으로 실패하면 false
 *          (업데이트 확인 실패가 앱 사용을 막으면 안 되므로 예외를 밖으로 던지지 않는다).
 */
export async function fetchOtaUpdateIfAvailable(): Promise<boolean> {
  if (!canCheckOtaUpdate()) return false;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew === true;
  } catch {
    // 오프라인·서버 오류 — 조용히 넘어가고 다음 확인 때 다시 시도한다
    return false;
  }
}

/**
 * 내려받은 업데이트를 바로 적용한다(앱 JS 를 다시 불러온다 — 화면이 처음부터 다시 그려진다).
 * 🔴 저장 안 된 입력이 있으면 사라지므로, 사용자가 **직접 눌렀을 때만** 부른다.
 */
export async function applyOtaUpdate(): Promise<void> {
  await Updates.reloadAsync();
}
