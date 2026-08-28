/**
 * ShortcutsSection — "나" 탭 상단의 바로가기 목록.
 *
 * 2026-08-28 UX 단순화(docs/plans/2026-08-28-ux-simplification.md)로 하단 탭을
 * 6개에서 3개로 줄이면서, 탭바에서 내린 화면들이 **닿을 수 없게 되지 않도록**
 * 만든 진입점이다. 기능을 지운 게 아니라 옮긴 것이므로 이 섹션이 없으면
 * 단순화가 아니라 기능 삭제가 된다.
 *
 * 왜 별도 컴포넌트인가: `my.tsx` 는 이미 762줄이고, my/ 폴더가 섹션 단위로
 * 쪼개져 있다(SettingsSection / ServiceInfoSection / AccountSection).
 * 같은 패턴을 따라 단일 책임으로 둔다.
 *
 * 주의: 여기서 내보내는 진입점을 지우면 해당 화면은 딥링크 말고는 도달 경로가
 * 사라진다. 실제로 `SettingsSection` 의 "외부 캘린더 연결" 이 주석 처리돼 있어
 * 원격 DB 기준 연동 실적이 0건이었다 — 안 쓰인 게 아니라 닿을 수 없었던 것이다.
 */

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { makeMenuStyles } from './menuStyles';

/** 바로가기 한 줄의 정의. 아이콘·라벨·이동 경로만 갖는다. */
type Shortcut = {
  /** Ionicons 이름 (채워진 스타일 사용 — 목록에서 라벨보다 앞서 읽히지 않게 크기는 20) */
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  route: string;
  testID: string;
};

export function ShortcutsSection() {
  const { t } = useTranslation();
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const local = makeLocal(colors);

  // 탭바에서 내려온 두 화면. 순서는 실사용 빈도가 아니라 사용자가 기대하는
  // 묶음 순서(내 콘텐츠 → 공유)를 따른다.
  const shortcuts: Shortcut[] = [
    {
      icon: 'list',
      label: t('tabs.planner'),
      route: '/(tabs)/planner',
      testID: 'shortcut-button-planner',
    },
    {
      icon: 'people',
      label: t('tabs.spaces', { defaultValue: 'Space' }),
      route: '/(tabs)/spaces',
      testID: 'shortcut-button-spaces',
    },
  ];

  return (
    <View style={menu.section}>
      <View style={menu.menuCard}>
        {shortcuts.map((s, i) => (
          <View key={s.route}>
            {/* 첫 항목 위에는 구분선을 넣지 않는다 — 카드 테두리와 겹쳐 두 줄로 보인다. */}
            {i > 0 && <View style={menu.menuDivider} />}
            <TouchableOpacity
              style={menu.menuItem}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onPress={() => router.push(s.route as any)}
              activeOpacity={0.7}
              testID={s.testID}
            >
              <View style={local.labelRow}>
                <Ionicons name={s.icon} size={20} color={colors.textSecondary} />
                <Text style={menu.menuItemText}>{s.label}</Text>
              </View>
              <Text style={menu.menuItemChevron}>›</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

/** 아이콘과 라벨을 한 줄로 묶는 로컬 스타일. */
function makeLocal(_colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
  });
}
