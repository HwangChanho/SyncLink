/**
 * appReloadService — 앱을 처음부터 다시 불러온다(«다시 시도» 버튼용). (2026-11-27)
 *
 * 왜 «요청만 다시» 가 아니라 앱 전체 리로드인가:
 *   부팅이 멈추는 자리는 프로필 조회만이 아니다. 인증 초기화(만료된 토큰 갱신)에서 멈추면
 *   supabase.auth 의 초기화 약속 자체가 안 끝나 getSession() 도 같이 멈춘다. 리로드는
 *   어느 자리에서 멈췄든 깨끗하게 다시 시작한다. 부팅 중(로딩 화면)에만 쓰므로 잃을 입력도 없다.
 *
 * 플랫폼별:
 *   - 웹: window.location.reload()
 *   - 네이티브 dev: DevSettings.reload() — expo-updates 의 reloadAsync 는 dev 에서
 *     ERR_UPDATES_DISABLED 를 던진다(expo-updates 29.0.19 Updates.js reloadAsync)
 *   - 네이티브 출시본: Updates.reloadAsync() — 받아 둔 OTA 가 있으면 함께 적용된다
 */

import { DevSettings, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { logError } from '@/lib/errorLogger';

/**
 * 앱을 다시 불러온다. 실패해도 던지지 않는다(버튼 핸들러에서 부르므로).
 */
export async function reloadApp(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      window.location.reload();
      return;
    }
    if (__DEV__) {
      DevSettings.reload();
      return;
    }
    await Updates.reloadAsync();
  } catch (error) {
    // 리로드 실패는 드물다 — 기록만 남기고 화면은 그대로 둔다(사용자가 앱을 껐다 켜면 된다).
    logError({ context: 'appReload.reload', error }).catch(() => { /* 기록 실패는 무시 */ });
  }
}
