/**
 * HomeHeader — greeting and today's date display for the Home tab.
 *
 * Shows:
 *  - Personalized greeting with user nickname
 *  - Today's date in Korean format
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { View, Text, StyleSheet } from 'react-native';
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

/** Returns a time-of-day greeting in Korean. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return '좋은 아침이에요';
  if (hour < 18) return '안녕하세요';
  return '좋은 저녁이에요';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HomeHeader() {
  const colors    = useColors();
  const styles    = makeStyles(colors);
  const user      = useAuthStore(s => s.user);
  const nickname  = user?.nickname ?? '사용자';
  const greeting  = getGreeting();
  const dateLabel = formatTodayKo(new Date());

  return (
    <View style={styles.container}>
      <Text style={styles.greeting}>
        {greeting}, <Text style={styles.name}>{nickname}</Text>님
      </Text>
      <Text style={styles.date}>{dateLabel}</Text>
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
