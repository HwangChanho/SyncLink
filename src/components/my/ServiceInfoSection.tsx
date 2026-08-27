/**
 * Service info section of the My tab — open-source licenses link, in-app
 * bug report / inquiry form, app version display.
 *
 * Sprint 19 TASK-1903 — extracted from src/app/(tabs)/my.tsx.
 * 2026-08 — "별점 남기기" 추가. 🔴 여기서는 인앱 리뷰 **API 를 쓰지 않는다** — 스토어
 *   할당량을 이미 쓴 사용자에겐 아무 일도 안 일어나 "고장난 버튼"이 되기 때문이다.
 *   Google 문서가 이 경우 스토어로 보내라고 명시한다. 자동 노출만 API 를 쓴다
 *   (`storeReviewService`).
 * 2026-08 — "개발자에게 문의" 가 `mailto:` 를 여는 방식이었는데 앱 내 양식으로 바꿨다.
 *   mailto 의 문제: 웹에서 브라우저가 막으면 아무 일도 안 일어나고(사용자는 보낸 줄 안다),
 *   메일 앱이 없는 기기엔 경로가 아예 없었다. 진단 정보도 사용자가 지울 수 있었다.
 */

import { Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { makeMenuStyles } from './menuStyles';
import { getStoreUrl, openStoreListing } from '@/services/storeReviewService';

// v1.1.5 — app.json 의 version/buildNumber 자동 추출. 매 release 마다 수동
// 갱신할 필요 X. native 빌드 시점의 값이 박힘 (OTA 후엔 OTA 시점 코드는
// 같지만 native version 은 빌드 시점 그대로).
const APP_VERSION = Constants.expoConfig?.version ?? '?';

// 스토어 등록정보 URL. app.json 에서 오는 빌드 시점 상수라 한 번만 구하면 된다.
// 웹에서는 null 이라 아래에서 항목 자체를 그리지 않는다.
const STORE_URL = getStoreUrl();

export function ServiceInfoSection() {
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const { t } = useTranslation();

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>서비스 정보</Text>
      <View style={menu.menuCard}>
        {STORE_URL !== null && (
          <>
            <TouchableOpacity
              style={menu.menuItem}
              onPress={() => void openStoreListing()}
              activeOpacity={0.7}
            >
              <Text style={menu.menuItemText}>별점 남기기</Text>
              <Text style={menu.menuItemChevron}>›</Text>
            </TouchableOpacity>
            <View style={menu.menuDivider} />
          </>
        )}
        <TouchableOpacity
          style={menu.menuItem}
          onPress={() => router.push('/settings/licenses')}
          activeOpacity={0.7}
        >
          <Text style={menu.menuItemText}>오픈소스 라이선스</Text>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>
        <View style={menu.menuDivider} />
        <TouchableOpacity
          style={menu.menuItem}
          onPress={() => router.push('/settings/support')}
          activeOpacity={0.7}
        >
          <Text style={menu.menuItemText}>{t('support.title')}</Text>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>
        <View style={menu.menuDivider} />
        <View style={menu.menuItem}>
          <Text style={menu.menuItemText}>앱 버전</Text>
          <Text style={menu.menuItemValue}>{APP_VERSION}</Text>
        </View>
      </View>
    </View>
  );
}
