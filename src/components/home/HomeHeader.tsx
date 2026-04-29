/**
 * HomeHeader — greeting and today's date display for the Home tab.
 *
 * Shows:
 *  - Personalized greeting with user nickname
 *  - Today's date in Korean format
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { textStyles, fontSize } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LOCALE_MAP: Record<string, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

/** Formats today's date in locale-aware form using Intl.DateTimeFormat. */
function formatTodayLocale(date: Date, i18nLang: string): string {
  const locale = LOCALE_MAP[i18nLang] ?? 'en-US';
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day:   'numeric',
    weekday: 'short',
  }).format(date);
}

// getGreeting is now inside the component using i18n.

// ─── Component ────────────────────────────────────────────────────────────────

export function HomeHeader() {
  const { t, i18n } = useTranslation();
  const colors    = useColors();
  const styles    = makeStyles(colors);
  const user      = useAuthStore(s => s.user);
  const nickname  = user?.nickname ?? t('common.user');
  const plan      = useSubscriptionStore(s => s.plan);

  /** Returns a time-of-day greeting using i18n. */
  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return t('greeting.morning');
    if (hour < 18) return t('greeting.hello');
    return t('greeting.evening');
  }

  const greeting  = getGreeting();
  const dateLabel = formatTodayLocale(new Date(), i18n.language);

  return (
    <View style={styles.container}>
      <View style={styles.greetingRow}>
        <Text style={styles.greeting}>
          {greeting},{' '}
          <Text
            style={styles.name}
            onPress={() => router.push('/(tabs)/my')}
            suppressHighlighting
          >
            {nickname}
          </Text>
          님
        </Text>
        {plan === 'pro' && (
          <View style={styles.proBadge}>
            <Ionicons name="star" size={10} color={colors.textInverse} />
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
        )}
      </View>
      <TouchableOpacity
        activeOpacity={0.6}
        onPress={() => router.push('/(tabs)')}
        accessibilityLabel="오늘로 이동"
      >
        <Text style={styles.date}>{dateLabel}</Text>
      </TouchableOpacity>
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
    container: {
      paddingHorizontal: spacing[4],
      paddingTop:        spacing[4],
      paddingBottom:     spacing[2],
    },
    greetingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      flexWrap: 'wrap',
    },
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    proBadgeText: {
      color: colors.textInverse,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    greeting: {
      fontSize:   fontSize.xl,
      fontWeight: '400',
      color:      colors.textPrimary,
    },
    name: {
      fontWeight: '700',
      color:      colors.primary,
    },
    date: {
      ...textStyles.bodySm,
      color:     colors.textSecondary,
      marginTop: spacing[0.5],
    },
  });
}
