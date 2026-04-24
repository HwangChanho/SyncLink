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
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import { textStyles, fontSize } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Formats today's date as "4월 20일 (일)" */
function formatTodayKo(date: Date): string {
  const month   = date.getMonth() + 1;
  const day     = date.getDate();
  const weekday = WEEKDAY_KO[date.getDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

// getGreeting is now inside the component using i18n.

// ─── Component ────────────────────────────────────────────────────────────────

export function HomeHeader() {
  const { t } = useTranslation();
  const colors    = useColors();
  const styles    = makeStyles(colors);
  const user      = useAuthStore(s => s.user);
  const nickname  = user?.nickname ?? t('common.user');

  /** Returns a time-of-day greeting using i18n. */
  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return t('greeting.morning');
    if (hour < 18) return t('greeting.hello');
    return t('greeting.evening');
  }

  const greeting  = getGreeting();
  const dateLabel = formatTodayKo(new Date());

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>
        {greeting},{' '}
        {/* Tapping the nickname jumps to the My tab so the user can edit
            it or manage their profile without hunting through menus. */}
        <Text
          style={styles.name}
          onPress={() => router.push('/(tabs)/my')}
          suppressHighlighting
        >
          {nickname}
        </Text>
        님
      </Text>
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
