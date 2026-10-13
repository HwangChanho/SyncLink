/**
 * Expo 푸시 발송 인증 헤더 (2026-10-13).
 *
 * Expo 프로젝트의 «Enhanced Security for Push Notifications» 를 켜면, 액세스 토큰 없이 보낸
 * 푸시는 거절된다 → 푸시 토큰(ExponentPushToken[…])만 가진 제3자가 우리 사용자에게 푸시를 보낼 수 없게 된다.
 * 그 준비로 모든 서버 발송에 `Authorization: Bearer <EXPO_ACCESS_TOKEN>` 을 붙인다.
 *
 * 순서(바꾸면 전체 푸시 중단):
 *   1) 이 헤더를 쓰는 함수들 배포 (시크릿이 없으면 헤더를 안 붙이므로 지금과 동일하게 동작)
 *   2) `supabase secrets set EXPO_ACCESS_TOKEN=…` (LEAD 가 expo.dev 에서 발급)
 *   3) 발송 성공 확인 → 그다음에만 Expo 콘솔에서 강화 보안 켜기
 */

/**
 * Expo 푸시 API 호출에 붙일 인증 헤더를 만든다.
 *
 * @returns 시크릿 `EXPO_ACCESS_TOKEN` 이 있으면 `{ Authorization: 'Bearer …' }`, 없으면 빈 객체
 * 주의: 토큰 값은 로그에 찍지 말 것. 빈 객체를 돌려주는 경우는 «아직 등록 전»뿐이어야 한다.
 */
export function expoAuthHeader(): Record<string, string> {
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
