/**
 * haptics — 가벼운 진동 피드백(1.5.0 「우리하루」 귀엽게 개편).
 *
 * expo-haptics 를 직접 부르지 않고 이 파일을 거치는 이유:
 *   - 웹에는 진동 API 가 없다(expo-haptics 가 UnavailabilityError 를 던질 수 있다).
 *   - 진동은 "있으면 좋은" 장식이라 **실패가 기능을 막으면 안 된다** — 한 곳에서 삼킨다.
 *   - 나중에 "진동 끄기" 설정을 넣게 되면 여기 한 곳만 고치면 된다.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * 할 일 완료처럼 "해냈다" 는 순간의 톡 하는 가벼운 진동.
 * 반환값을 기다릴 필요가 없다(fire-and-forget).
 */
export function hapticSuccessTap(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
    // 진동 모터가 없거나 시스템에서 꺼진 기기 — 조용히 무시한다
  });
}
