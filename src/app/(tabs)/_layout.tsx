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
import { useColors } from '@/hooks/useColors';
import { componentHeight } from '@/constants/spacing';
import { LanguageButton } from '@/components/common/LanguageButton';

export default function TabLayout() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        // Show the header so the LanguageButton is always accessible.
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        // Larger, bolder top title as requested for clearer section anchoring.
        headerTitleStyle: {
          fontSize: 22,
          fontWeight: '700',
          color: colors.textPrimary,
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
          // tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('tabs.calendar'),
          // tabBarIcon: ({ color }) => <CalendarIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: t('tabs.planner'),
          // tabBarIcon: ({ color }) => <CheckSquareIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="my"
        options={{
          title: t('tabs.my'),
          // tabBarIcon: ({ color }) => <UserIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
