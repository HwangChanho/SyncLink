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
        // Compact header. expo-router defaults to a 96 pt large-title
        // header on iOS which left a noticeable empty band between the
        // title and the first content row. Force a small fixed height
        // and disable large-title mode so the tab body sits flush.
        headerStyle: {
          backgroundColor: colors.background,
          height: Platform.OS === 'ios' ? 44 : 56,
        },
        // Bias the title to the leading edge so it reads as a section
        // anchor rather than a centered nav-bar title — visually similar
        // to Apple's own "Inbox" / "Today" patterns.
        headerTitleAlign: 'left',
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        // Larger, bolder top title as requested for clearer section anchoring.
        // Colour is user-selectable via /settings/appearance.
        headerTitleStyle: {
          fontSize: 22,
          fontWeight: '700',
          color: headerTitleHex,
        },
        // Pull the title block up against the top edge so we don't get
        // any baked-in vertical padding from the navigation header.
        headerTitleContainerStyle: {
          paddingVertical: 0,
          marginVertical: 0,
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
