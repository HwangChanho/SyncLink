/**
 * Service info section of the My tab — open-source licenses link, contact
 * developer mailto, app version display.
 *
 * Sprint 19 TASK-1903 — extracted from src/app/(tabs)/my.tsx.
 */

import { Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { makeMenuStyles } from './menuStyles';

const APP_VERSION = '1.0.0';
const CONTACT_EMAIL = 'cksgh0316@gmail.com';

export function ServiceInfoSection() {
  const colors = useColors();
  const menu = makeMenuStyles(colors);

  const handleContactDeveloper = () => {
    const subject = encodeURIComponent('[SyncLink] 개발자 문의');
    const body = encodeURIComponent(
      `\n\n---\n앱 버전: ${APP_VERSION}\n플랫폼: ${Platform.OS}\n`,
    );
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
          <Text style={menu.menuItemValue}>{APP_VERSION}</Text>
        </View>
      </View>
    </View>
  );
}
