/**
 * Home tab — Today summary, D-day cards, Upcoming events, NL input bar.
 *
 * This is a PLACEHOLDER screen.
 * Full implementation: TASK-404 (Sprint 4)
 *
 * AI integration points:
 *  - NL input bar at bottom (TASK-302) ✅
 *  - Weekly review card at top (TASK-303, Pro only)
 */

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { light as colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.content}>
        <Text style={styles.title}>홈</Text>
        <Text style={styles.subtitle}>TASK-404에서 구현 예정</Text>
      </View>
      {/* NLInputBar: TASK-302 — natural language event creation */}
      <NLInputBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  title: {
    ...textStyles.h2,
    color: colors.textPrimary,
  },
  subtitle: {
    ...textStyles.body,
    color: colors.textSecondary,
    marginTop: spacing[2],
  },
});
