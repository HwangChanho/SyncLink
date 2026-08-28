/**
 * Tab bar layout — defines the 3 main app tabs.
 *
 * Tab order: Home → Calendar → My
 * (No AI tab — AI is embedded in Home and Calendar)
 *
 * 2026-08-28 UX 단순화 (docs/plans/2026-08-28-ux-simplification.md):
 * 탭이 6개까지 늘어나 있었다(홈/캘린더/플래너/분석/스페이스/마이).
 * 원격 DB 실측 결과 실사용자 25명 중 할 일 1명·노트 0명·Space 2명이었고,
 * iOS HIG 권장 상한도 5개다. **화면은 하나도 지우지 않고** 탭바에서만 내렸다.
 *  - planner / spaces → `href: null` + "나" 탭의 ShortcutsSection 에서 진입
 *  - analytics        → LEAD 결정으로 제거(진입 경로 없음). 라우트 파일은 보존
 * 되돌리려면 각 Screen 의 `href: null` 한 줄만 지우면 된다 —
 * 2026-06-07 에 분석 탭을 같은 방식으로 숨겼다가 06-08 에 되살린 전례가 있다.
 * ResponsiveTabBar 는 href===null 라우트를 웹 사이드 네비에서도 제외하므로
 * 데스크탑 웹은 별도 처리가 필요 없다.
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
import { useResponsive } from '@/hooks/useResponsive';
import { ResponsiveTabBar, SIDE_NAV_WIDTH } from '@/components/common/ResponsiveTabBar';
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
  // 웹 데스크탑(>=1024): 하단 탭바 → 좌측 사이드 네비 + 콘텐츠 우측 패딩. (2026-06-08 S1)
  const { isDesktop } = useResponsive();

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
      tabBar={(props) => <ResponsiveTabBar {...props} />}
      screenOptions={{
        // 데스크탑 사이드 네비(absolute) 폭만큼 콘텐츠를 우측으로 밀어 가리지 않게.
        // 모바일/태블릿은 undefined → 기존 풀폭 콘텐츠 그대로(회귀 0).
        sceneStyle: isDesktop ? { paddingLeft: SIDE_NAV_WIDTH } : undefined,
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
      {/* 할 일 / 노트 — 탭바에서 내리고 "나" 탭 바로가기로 진입한다.
          화면(`planner.tsx`)과 기능은 그대로다. */}
      <Tabs.Screen
        name="planner"
        options={{
          href: null,
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
      {/* 분석 탭 — 2026-08-28 LEAD 결정으로 제거. 코드 주석이 스스로 "Phase 2 스켈레톤"
          이라고 밝히던 미완성 화면이었다. 탭·바로가기 어디에도 진입점을 두지 않는다.
          라우트 파일(`analytics.tsx`)은 되살릴 수 있게 남겨 둔다 — 되살리려면
          아래 `href: null` 을 지우면 된다(2026-06-08 에 같은 방식으로 복구한 적 있다). */}
      <Tabs.Screen
        name="analytics"
        options={{
          href: null,
          title: t('tabs.analytics', { defaultValue: '분석' }),
          tabBarButtonTestID: 'tab-button-analytics',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'analytics' : 'analytics-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      {/* Space — 실사용 가입자 2명. 탭바에서 내리고 "나" 탭 바로가기 + 홈의
          Space 활동 피드로 진입한다. 화면·초대·채팅은 전부 그대로다. */}
      <Tabs.Screen
        name="spaces"
        options={{
          href: null,
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
