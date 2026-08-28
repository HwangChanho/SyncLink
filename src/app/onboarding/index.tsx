/**
 * First-launch onboarding screen — shown once before the user logs in.
 *
 * Displays 3 swipeable pages that introduce SyncLink's core value propositions:
 *  1. "함께 일정을 공유하세요" — Space-based sharing with anyone
 *  2. "자연어로 일정 등록"    — Natural language event creation
 *                              + NLTryItDemo: live local-parser sandbox the user
 *                              can actually type into (2026-08-05 interactive plan)
 *  3. "AI 리마인더"           — Smart reminders powered by AI
 *
 * Completion behaviour:
 *  - Marks onboarding done in AsyncStorage (key: ONBOARDING_STORAGE_KEY)
 *  - Navigates to /auth/login
 *
 * Skip behaviour:
 *  - Same as completion (marks done + navigates to /auth/login)
 *
 * Re-show logic:
 *  - Checked in _layout.tsx: if AsyncStorage key is absent, show this screen
 *  - Key is written on "시작하기" tap, never shown again
 *
 * TASK-602 (Sprint 6)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { NLTryItDemo } from '@/components/onboarding/NLTryItDemo';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { trackFunnel } from '@/services/funnelService';

// ─── Constants ────────────────────────────────────────────────────────────────

// 온보딩 완료 플래그(키 + 상태)는 onboardingStore 가 단일 소스.
// 하위호환(테스트 등 기존 import) 위해 동일 경로로 재노출한다.
export { ONBOARDING_STORAGE_KEY } from '@/stores/onboardingStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Page definitions ─────────────────────────────────────────────────────────

/**
 * Data for each onboarding page.
 * Rendered by the generic OnboardingPage sub-component.
 */
interface PageData {
  /** Ionicons icon name shown above the title */
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  /** Large display title */
  title: string;
  /** Subtitle / explanation copy */
  subtitle: string;
}

/** Ionicons icon names for each onboarding page (index-matched to onboarding.pages). */
const PAGE_ICONS: (keyof typeof import('@expo/vector-icons').Ionicons.glyphMap)[] = [
  'people',
  'chatbubble-ellipses',
  'notifications',
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  // 퍼널: 최초 실행 소개에 도달. 퍼널의 첫 관문이다.
  useEffect(() => { void trackFunnel('onboarding_view'); }, []);

  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /** Translated page data (title + subtitle) from i18n. */
  const pages = t('onboarding.pages', { returnObjects: true }) as { title: string; subtitle: string }[];

  /** Zero-based index of the currently visible page */
  const [currentPage, setCurrentPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // ── Handlers ────────────────────────────────────────────────────────────

  /**
   * Mark onboarding complete and go straight to the tabs.
   * Called from both "시작하기" (last page CTA) and "건너뛰기" (skip button).
   *
   * complete() sets the shared `done` flag **synchronously** before we navigate,
   * so the auth guard sees done=true and does NOT bounce back to /onboarding on a
   * stale value. (예전엔 /auth/login 으로 보낸 뒤 가드가 stale false 로 온보딩을 한 번
   * 더 띄우고 로그인 화면이 깜빡였다 — 2026-06-06 수정.)
   */
  const handleFinish = useCallback(async () => {
    // 퍼널: 소개를 끝냈다(건너뛰기 포함). 이 줄이 없으면 "소개에서 떠난 사람"을
    // 셀 수 없다 — onboarding_view 는 있는데 onboarding_done 이 없는 anon_id 가 그들이다.
    void trackFunnel('onboarding_done');
    await useOnboardingStore.getState().complete();
    router.replace('/(tabs)');
  }, []);

  /**
   * Advance to the next page by programmatically scrolling the ScrollView.
   * On the last page, calls handleFinish instead.
   */
  const handleNext = useCallback(() => {
    const isLastPage = currentPage === pages.length - 1;
    if (isLastPage) {
      void handleFinish();
      return;
    }
    const nextPage = currentPage + 1;
    scrollRef.current?.scrollTo({ x: nextPage * SCREEN_WIDTH, animated: true });
    setCurrentPage(nextPage);
  }, [currentPage, handleFinish, pages.length]);

  /**
   * Sync the current page indicator with the user's manual scroll position.
   * Fires on every scroll momentum stop to keep dots in sync with fling gestures.
   */
  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const page = Math.round(offsetX / SCREEN_WIDTH);
      setCurrentPage(page);
    },
    [],
  );

  const isLastPage = currentPage === pages.length - 1;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Skip button — visible on all pages except the last */}
      {!isLastPage && (
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleFinish}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('common.a11y_skip_onboarding')}
          accessibilityRole="button"
          testID="onboarding-button-skip"
        >
          <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
        </TouchableOpacity>
      )}

      {/* Swipeable page area */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={16}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        accessibilityLabel={t('common.a11y_onboarding_page')}
      >
        {pages.map((page, index) => (
          <OnboardingPage
            key={index}
            page={{ ...page, icon: PAGE_ICONS[index] ?? 'help-circle' }}
            colors={colors}
            styles={styles}
            // Page 2 (NL event creation) carries the interactive try-it sandbox.
            showTryIt={index === 1}
          />
        ))}
      </ScrollView>

      {/* Page indicator dots */}
      <View style={styles.dotsContainer} accessibilityLabel={`${currentPage + 1}/${pages.length} 페이지`}>
        {pages.map((_, index) => (
          <View
            key={index}
            style={[
              styles.dot,
              index === currentPage ? styles.dotActive : styles.dotInactive,
            ]}
          />
        ))}
      </View>

      {/* CTA button — "다음" on pages 1–2, "시작하기" on page 3 */}
      <View style={styles.ctaContainer}>
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={handleNext}
          activeOpacity={0.8}
          accessibilityLabel={isLastPage ? '시작하기' : '다음'}
          accessibilityRole="button"
        >
          <Text style={styles.ctaBtnText}>
            {isLastPage ? t('onboarding.start') : t('common.next')}
          </Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

// ─── Sub-component: OnboardingPage ────────────────────────────────────────────

interface OnboardingPageProps {
  page: PageData;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
  /** Render the interactive NL try-it sandbox under the copy (page 2 only). */
  showTryIt?: boolean;
}

/**
 * Single onboarding page — icon, title, subtitle (+ optional try-it demo).
 * Width is fixed to SCREEN_WIDTH so ScrollView pagingEnabled works correctly.
 *
 * @param page      - Content data for this page
 * @param colors    - Active theme color tokens
 * @param styles    - Pre-built StyleSheet from makeStyles(colors)
 * @param showTryIt - true on the NL page: embeds NLTryItDemo so the user can
 *                    actually type a sentence and see it parsed before login
 */
function OnboardingPage({ page, colors, styles, showTryIt = false }: OnboardingPageProps) {
  return (
    <View style={styles.page}>
      {/* Feature icon in a circular primary-tinted container.
          The try-it page shrinks the icon so the demo fits without scrolling. */}
      <View style={[styles.iconContainer, showTryIt && styles.iconContainerCompact]}>
        <Ionicons
          name={page.icon}
          size={showTryIt ? 40 : 64}
          color={colors.primary}
          accessibilityLabel=""
        />
      </View>

      {/* Page text */}
      <Text style={styles.pageTitle}>{page.title}</Text>
      <Text style={styles.pageSubtitle}>{page.subtitle}</Text>

      {/* Interactive sandbox — local parser only, nothing is saved */}
      {showTryIt && <NLTryItDemo />}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({

    // ── Outer container ─────────────────────────────────────────────────────
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    // ── Skip button (top-right) ──────────────────────────────────────────────
    skipBtn: {
      alignSelf: 'flex-end',
      paddingHorizontal: spacing[5],
      paddingTop: spacing[3],
      paddingBottom: spacing[2],
    },
    skipText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },

    // ── Scrollable pages ─────────────────────────────────────────────────────
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      // No explicit height needed — flex:1 on scrollView handles it
    },

    // ── Single page layout ───────────────────────────────────────────────────
    page: {
      width: SCREEN_WIDTH,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing[8],
      gap: spacing[5],
    },

    // ── Feature icon ─────────────────────────────────────────────────────────
    iconContainer: {
      width: 128,
      height: 128,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[2],
    },
    // Try-it page variant — smaller icon leaves room for the interactive demo
    // (chips + input + preview) without pushing the CTA off small screens.
    iconContainerCompact: {
      width: 80,
      height: 80,
      marginBottom: 0,
    },

    // ── Page text ────────────────────────────────────────────────────────────
    pageTitle: {
      ...textStyles.h2,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    pageSubtitle: {
      ...textStyles.bodyLg,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 26,
    },

    // ── Page dots ────────────────────────────────────────────────────────────
    dotsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing[2],
      paddingVertical: spacing[4],
    },
    dot: {
      height: 8,
      borderRadius: radius.full,
    },
    dotActive: {
      width: 24,
      backgroundColor: colors.primary,
    },
    dotInactive: {
      width: 8,
      backgroundColor: colors.border,
    },

    // ── CTA button ───────────────────────────────────────────────────────────
    ctaContainer: {
      paddingHorizontal: spacing[6],
      paddingBottom: spacing[6],
    },
    ctaBtn: {
      height: componentHeight.button,
      backgroundColor: colors.primary,
      borderRadius: radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaBtnText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
  });
}
