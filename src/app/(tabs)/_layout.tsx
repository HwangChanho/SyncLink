/**
 * Tab bar layout — defines the 4 main app tabs.
 *
 * Tab order: Home → Calendar → Planner → My
 * (No AI tab — AI is embedded in Home and Calendar)
 *
 * TASK-1301: Each tab exposes a language-picker button in the top-right header.
 * The header is now visible (headerShown: true) for all tab screens so that the
 * LanguageButton is accessible from anywhere in the app.
 */

import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { componentHeight } from '@/constants/spacing';
import { LanguageButton } from '@/components/common/LanguageButton';
import {
  useAppearanceStore,
  HEADER_TITLE_COLOR_HEX,
} from '@/stores/appearanceStore';

export default function TabLayout() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const { t } = useTranslation();
  const headerTitleColor = useAppearanceStore((s) => s.headerTitleColor);
  const headerTitleHex =
    HEADER_TITLE_COLOR_HEX[headerTitleColor] ?? colors.textPrimary;

  return (
    <Tabs
      screenOptions={{
        // Show the header so the LanguageButton is always accessible.
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.background,
          // Tighter header so the bold title sits closer to the content.
          // 42px is the minimum that still looks balanced with our 22pt
          // title; anything lower clips the descender glyphs.
          height: 44,
        },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        // Larger, bolder top title as requested for clearer section anchoring.
        // Colour is user-selectable via /settings/appearance.
        headerTitleStyle: {
          fontSize: 22,
          fontWeight: '700',
          color: headerTitleHex,
        },
        // Language picker button appears on every tab's top-right header.
        headerRight: () => <LanguageButton />,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          height: componentHeight.tabBar + (Platform.OS === 'ios' ? 20 : 0),
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'home' : 'home-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('tabs.calendar'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: t('tabs.planner'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'checkbox' : 'checkbox-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="my"
        options={{
          title: t('tabs.my'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person-circle' : 'person-circle-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
