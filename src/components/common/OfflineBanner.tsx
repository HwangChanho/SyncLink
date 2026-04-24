/**
 * OfflineBanner — a tiny strip shown at the top of the screen when the
 * device is offline. Driven by `useNetworkStatus` and rendered at the root
 * layout so it overlays every tab consistently.
 *
 * Design notes:
 *   - Hidden by default on initial render (`online === null`) so users
 *     don't see a flash of "You are offline" during the very first probe.
 *   - Positioned with `zIndex` above the navigation stack but below the
 *     lock overlay, which already claims z=9999.
 *
 * Sprint 15 TASK-1520.
 */

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export function OfflineBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const { online } = useNetworkStatus();

  // Only render when we have a definitive "offline" reading.
  if (online !== false) return null;

  const styles = makeStyles(colors);

  return (
    // SafeAreaView with `edges=['top']` ensures the banner sits below the
    // status bar on iOS. We avoid `absoluteFillObject` because the banner
    // should reserve layout space (pushing navigation content down).
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View
        style={styles.container}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Ionicons name="cloud-offline-outline" size={16} color={colors.textInverse} />
        <Text style={styles.text}>{t('offline.banner')}</Text>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safeArea: {
      backgroundColor: colors.error,
      // Sit above the Stack navigator but below the lock overlay (9999).
      zIndex: 100,
    },
    container: {
      flexDirection: 'row',
      alignItems:    'center',
      justifyContent: 'center',
      gap: spacing[2],
      paddingVertical:   spacing[2],
      paddingHorizontal: spacing[3],
    },
    text: {
      ...textStyles.labelSm,
      color: colors.textInverse,
    },
  });
}
