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
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { componentHeight } from '@/constants/spacing';
import { LanguageButton } from '@/components/common/LanguageButton';
import {
  useAppearanceStore,
  HEADER_TITLE_COLOR_HEX,
} from '@/stores/appearanceStore';
import { contrastingTextColor } from '@/lib/colorContrast';

export default function TabLayout() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const { t } = useTranslation();
  const headerTitleColor = useAppearanceStore((s) => s.headerTitleColor);
  // Use the actual home-indicator inset so the tab bar always clears it.
  // The previous hardcoded `+ 20` on iOS was an approximation that left
  // child screens (NLInputBar, FAB) sitting too close to the home bar on
  // newer devices — sprint-32 user feedback "홈바에 딱 붙어있음".
  const insets = useSafeAreaInsets();

  // The colour the user picked in /settings/appearance is now applied as
  // the **header background** (the strip surrounding the title). When the
  // option is "default" we fall back to the theme background so dark mode
  // still looks native. The title + back-chevron + LanguageButton tint use
  // an automatically computed contrasting colour so any swatch stays legible.
  const accentHex = HEADER_TITLE_COLOR_HEX[headerTitleColor];
  const headerBg     = accentHex ?? colors.background;
  const headerFg     = accentHex
    ? contrastingTextColor(accentHex)
    : colors.textPrimary;

  return (
    <Tabs
      screenOptions={{
        // Show the header so the LanguageButton is always accessible.
        headerShown: true,
        // Default header height — forcing a smaller `height` was clipping
        // the calendar's view-mode tabs (월/주/일) below the status bar
        // on iOS. Spacing between the title and content is now handled
        // by SafeAreaView edges + headerTitleContainerStyle padding.
        headerStyle: {
          backgroundColor: headerBg,
        },
        // Bias the title to the leading edge so it reads as a section
        // anchor rather than a centered nav-bar title — visually similar
        // to Apple's own "Inbox" / "Today" patterns.
        headerTitleAlign: 'left',
        // headerTintColor drives back chevron + headerRight icon colour;
        // matching it to the title keeps the bar visually unified.
        headerTintColor: headerFg,
        headerShadowVisible: false,
        // Larger, bolder top title with auto-contrast against the header bg.
        headerTitleStyle: {
          fontSize: 22,
          fontWeight: '700',
          color: headerFg,
        },
        // Pull the title block up against the top edge so we don't get
        // any baked-in vertical padding from the navigation header.
        headerTitleContainerStyle: {
          paddingVertical: 0,
          marginVertical: 0,
        },
        // Pass headerFg so the button color matches the header title/tint
        // when a custom accent background is active (Appearance settings).
        // Falls back to colors.textPrimary inside LanguageButton when no accentHex.
        headerRight: () => <LanguageButton tintColor={headerFg} />,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        // Build-79 LEAD: NL input 탭 시 키보드 위에 tab bar 가 끼어있어
        // input 과 키보드 사이 ~83px 갭. 키보드 등장 시 tab bar hide.
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height:        componentHeight.tabBar + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          // ADR-011 corrigendum (Sprint 29): React Navigation v7 정식 API
          // tabBarButtonTestID 사용. 기존 tabBarButton+Pressable 우회는 Android에서
          // ripple wrapper와 충돌해 testID 매핑 실패 (Maestro 01_login_dev FAIL).
          tabBarButtonTestID: 'tab-button-home',
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
          tabBarButtonTestID: 'tab-button-calendar',
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
          tabBarButtonTestID: 'tab-button-planner',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'list' : 'list-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="spaces"
        options={{
          title: t('tabs.spaces', { defaultValue: 'Space' }),
          tabBarButtonTestID: 'tab-button-spaces',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
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
          tabBarButtonTestID: 'tab-button-my',
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
