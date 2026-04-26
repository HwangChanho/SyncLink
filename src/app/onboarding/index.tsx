/**
 * First-launch onboarding screen — shown once before the user logs in.
 *
 * Displays 3 swipeable pages that introduce SyncLink's core value propositions:
 *  1. "함께 일정을 공유하세요" — Space-based sharing with anyone
 *  2. "자연어로 일정 등록"    — Natural language event creation
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

import { useState, useRef, useCallback } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * AsyncStorage key for the onboarding completion flag.
 * If this key exists, the onboarding is skipped on startup.
 * Exported so _layout.tsx can read it without re-declaring the key.
 */
export const ONBOARDING_STORAGE_KEY = '@synclink/onboarding_done';

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
   * Mark onboarding as complete in AsyncStorage and navigate to login.
   * Called from both "시작하기" (last page CTA) and "건너뛰기" (skip button).
   */
  const handleFinish = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    } catch {
      // AsyncStorage failure is non-critical — proceed to login regardless
    }
    router.replace('/auth/login');
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
          accessibilityLabel="온보딩 건너뛰기"
          accessibilityRole="button"
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
        accessibilityLabel="온보딩 페이지"
      >
        {pages.map((page, index) => (
          <OnboardingPage
            key={index}
            page={{ ...page, icon: PAGE_ICONS[index] ?? 'help-circle' }}
            colors={colors}
            styles={styles}
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
}

/**
 * Single onboarding page — icon, title, subtitle.
 * Width is fixed to SCREEN_WIDTH so ScrollView pagingEnabled works correctly.
 *
 * @param page   - Content data for this page
 * @param colors - Active theme color tokens
 * @param styles - Pre-built StyleSheet from makeStyles(colors)
 */
function OnboardingPage({ page, colors, styles }: OnboardingPageProps) {
  return (
    <View style={styles.page}>
      {/* Feature icon in a circular primary-tinted container */}
      <View style={styles.iconContainer}>
        <Ionicons
          name={page.icon}
          size={64}
          color={colors.primary}
          accessibilityLabel=""
        />
      </View>

      {/* Page text */}
      <Text style={styles.pageTitle}>{page.title}</Text>
      <Text style={styles.pageSubtitle}>{page.subtitle}</Text>
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
