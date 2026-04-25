/**
 * AppSplash — full-screen placeholder shown while RootLayout is still
 * resolving auth + onboarding state.
 *
 * Why we need this:
 *   On web, Expo Router renders the default route (typically `/(tabs)`)
 *   on first paint. By the time useAuthGuard's effect runs and dispatches
 *   `router.replace('/auth/login')`, the user has already seen one frame
 *   of the Home tab. The splash sits in front of the Stack until routing
 *   is committed to the correct screen, killing that flash.
 *
 * Visual:
 *   Themed background + a few skeleton bars roughly matching the Home /
 *   login layout. Cheap to render — no images, no network calls.
 *
 * Sprint 19.
 */

import { StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Skeleton } from './Skeleton';
import { spacing } from '@/constants/spacing';

export function AppSplash() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.block}>
        <Skeleton width="40%" height={28} radius={6} />
        <Skeleton width="65%" height={18} radius={6} style={{ marginTop: spacing[3] }} />
        <Skeleton width="30%" height={14} radius={6} style={{ marginTop: spacing[2] }} />
      </View>
      <View style={styles.block}>
        <Skeleton width="100%" height={72} radius={12} />
      </View>
      <View style={styles.block}>
        <Skeleton width="100%" height={120} radius={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute fill so the splash overlays the Stack rather than pushing it
  // down. zIndex/elevation ensures the Stack frame underneath is hidden
  // even when the platform doesn't honour absolute stacking by paint order.
  container: {
    position: 'absolute',
    top:    0,
    left:   0,
    right:  0,
    bottom: 0,
    paddingTop: spacing[12],
    paddingHorizontal: spacing[5],
    gap: spacing[5],
    zIndex: 100,
    elevation: 10,
  },
  block: {
    gap: 0,
  },
});
