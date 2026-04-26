/**
 * Settings section of the My tab — notification settings, category management,
 * App Lock (native-only), appearance settings, and the inline theme segmented
 * control.
 *
 * Pure-render component: routes via expo-router.push, theme state lives in
 * appearanceStore. The parent passes nothing — the section reads everything
 * it needs from hooks/store directly so my.tsx isn't responsible for plumbing.
 *
 * Sprint 19 TASK-1903 — extracted from src/app/(tabs)/my.tsx.
 */

import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAppearanceStore, type ColorSchemePreference } from '@/stores/appearanceStore';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { makeMenuStyles } from './menuStyles';

export function SettingsSection() {
  const { t } = useTranslation();
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const local = makeLocal(colors);
  const { colorScheme, setColorScheme } = useAppearanceStore();

  // Theme segmented control labels — built every render so locale changes
  // propagate without an extra useEffect.
  const themeOptions: { value: ColorSchemePreference; label: string }[] = [
    { value: 'light',  label: t('profile.theme.light')  },
    { value: 'dark',   label: t('profile.theme.dark')   },
    { value: 'system', label: t('profile.theme.system') },
  ];

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>{t('common.system')}</Text>
      <View style={menu.menuCard}>
        <TouchableOpacity
          style={menu.menuItem}
          onPress={() => router.push('/settings/notifications')}
          activeOpacity={0.7}
        >
          <Text style={menu.menuItemText}>{t('notification.event_reminder')}</Text>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>

        <View style={menu.menuDivider} />

        <TouchableOpacity
          style={menu.menuItem}
          onPress={() => router.push('/settings/categories')}
          activeOpacity={0.7}
        >
          <Text style={menu.menuItemText}>{t('category.edit')}</Text>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>

        <View style={menu.menuDivider} />

        {/* App Lock (Face ID / Touch ID) — native-only. Browsers don't expose
            biometric APIs so the row is hidden on web. */}
        {Platform.OS !== 'web' && (
          <>
            <TouchableOpacity
              style={menu.menuItem}
              onPress={() => router.push('/settings/app-lock')}
              activeOpacity={0.7}
            >
              <Text style={menu.menuItemText}>{t('settings.app_lock')}</Text>
              <Text style={menu.menuItemChevron}>›</Text>
            </TouchableOpacity>
            <View style={menu.menuDivider} />
          </>
        )}

        <TouchableOpacity
          style={menu.menuItem}
          onPress={() => router.push('/settings/appearance')}
          activeOpacity={0.7}
        >
          <Text style={menu.menuItemText}>화면 설정</Text>
          <Text style={menu.menuItemChevron}>›</Text>
        </TouchableOpacity>
        <View style={menu.menuDivider} />

        {/* Inline theme segmented control. Changes apply immediately via
            appearanceStore so the next render reflects the chosen mode. */}
        <View style={local.menuItemTheme}>
          <Text style={menu.menuItemText}>{t('profile.theme.label')}</Text>
          <View style={local.themeSegmented}>
            {themeOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  local.themeSegmentItem,
                  colorScheme === opt.value && local.themeSegmentItemActive,
                ]}
                onPress={() => setColorScheme(opt.value)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    local.themeSegmentLabel,
                    colorScheme === opt.value && local.themeSegmentLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/** Local-only styles: the theme segmented control. */
function makeLocal(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    menuItemTheme: {
      paddingHorizontal: spacing[4],
      paddingVertical:   spacing[3],
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
    },
    themeSegmented: {
      flexDirection: 'row',
      borderWidth:   1,
      borderColor:   colors.border,
      borderRadius:  radius.lg,
      overflow:      'hidden',
    },
    themeSegmentItem: {
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1.5],
      backgroundColor:   colors.surface,
    },
    themeSegmentItemActive: {
      backgroundColor: colors.primary,
    },
    themeSegmentLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    themeSegmentLabelActive: {
      color: colors.textInverse,
      fontWeight: '600',
    },
  });
}
