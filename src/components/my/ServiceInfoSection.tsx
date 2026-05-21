/**
 * Service info section of the My tab — open-source licenses link, contact
 * developer mailto, app version display.
 *
 * Sprint 19 TASK-1903 — extracted from src/app/(tabs)/my.tsx.
 */

import { Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuthStore } from '@/stores/authStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { makeMenuStyles } from './menuStyles';

// v1.1.5 — app.json 의 version/buildNumber 자동 추출. 매 release 마다 수동
// 갱신할 필요 X. native 빌드 시점의 값이 박힘 (OTA 후엔 OTA 시점 코드는
// 같지만 native version 은 빌드 시점 그대로).
const APP_VERSION  = Constants.expoConfig?.version ?? '?';
const BUILD_NUMBER =
  (Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode?.toString())
  ?? '?';
const CONTACT_EMAIL = 'cksgh0316@gmail.com';

export function ServiceInfoSection() {
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const user = useAuthStore((s) => s.user);
  const plan = useSubscriptionStore((s) => s.plan);

  const handleContactDeveloper = () => {
    const subject = encodeURIComponent('[SyncLink] 개발자 문의');
    // Auto-prepend diagnostic block so support can correlate the report
    // with server logs without a back-and-forth. Kept below the writing
    // area so the user types their message above the divider.
    const diagnostic = [
      '',
      '',
      '여기에 문의 내용을 작성해주세요.',
      '',
      '──────────────────',
      '※ 아래 정보는 문제 확인을 위해 자동 첨부됩니다.',
      `User ID: ${user?.id ?? '(로그아웃 상태)'}`,
      `Nickname: ${user?.nickname ?? '-'}`,
      `Email: ${user?.email ?? '-'}`,
      `Plan: ${plan}`,
      `Push: ${user?.push_enabled ? 'on' : 'off'} (token: ${user?.push_token ? 'registered' : 'none'})`,
      `Platform: ${Platform.OS} ${Platform.Version}`,
      `App Version: ${APP_VERSION} (build ${BUILD_NUMBER})`,
      '──────────────────',
    ].join('\n');
    const body = encodeURIComponent(diagnostic);
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`)
      // mailto unsupported on web in some browsers — silently ignore.
      .catch(() => { /* no-op */ });
  };

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>서비스 정보</Text>
      <View style={menu.menuCard}>
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
          onPress={handleContactDeveloper}
          activeOpacity={0.7}
        >
          <Text style={menu.menuItemText}>개발자에게 문의</Text>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>
        <View style={menu.menuDivider} />
        <View style={menu.menuItem}>
          <Text style={menu.menuItemText}>앱 버전</Text>
          <Text style={menu.menuItemValue}>{APP_VERSION} ({BUILD_NUMBER})</Text>
        </View>
      </View>
    </View>
  );
}
