/**
 * webLayout — 데스크탑 웹 레이아웃 공통 상수/스타일.
 *
 * 일반 사용자 웹앱(synclink.pages.dev)을 데스크탑에서 볼 때, 콘텐츠가 화면
 * 전체 폭(1440+)으로 늘어지면 한 줄이 너무 길어 가독성이 떨어진다. 본문을
 * 적정 폭으로 클램프하고 중앙 정렬해 "읽기 좋은 칼럼"을 만든다. (웹 반응형 S2)
 *
 * 적용 지점: 각 (tabs) 화면의 ScrollView contentContainerStyle 또는 화면
 * 래퍼에 `isDesktop && desktopContentCentered` 형태로 얹는다(useResponsive
 * 의 isDesktop 과 함께 사용). 모바일/태블릿/네이티브에는 영향이 없다.
 *
 * ⚠️ 매직넘버 단일화: 본문 최대 폭을 바꾸려면 이 파일 한 곳만 수정하면 전
 *    화면에 반영된다(홈/스페이스/내정보/분석/플래너 공통 참조). 화면마다
 *    인라인으로 880 을 박지 말 것.
 */
import type { ViewStyle } from 'react-native';

/** 데스크탑 웹 본문 콘텐츠 최대 폭(px). 이 폭을 기준으로 중앙 정렬한다. */
export const DESKTOP_CONTENT_MAX_WIDTH = 880;

/**
 * 데스크탑에서 콘텐츠 컨테이너에 얹는 중앙 정렬 스타일.
 * - maxWidth     : 본문 폭 상한 (한 줄이 너무 길어지는 것 방지 = 가독성).
 * - width '100%' : 상한 이하 폭의 데스크탑 창에서는 부모 폭을 꽉 채움.
 * - alignSelf    : 남는 좌우 여백을 균등 분배해 중앙 배치.
 *
 * flex:1 컨테이너(SafeAreaView 등) 위에 얹어도 flex 동작을 깨지 않는다
 * (maxWidth 는 교차축 폭만 제한).
 */
export const desktopContentCentered: ViewStyle = {
  maxWidth: DESKTOP_CONTENT_MAX_WIDTH,
  width: '100%',
  alignSelf: 'center',
};
