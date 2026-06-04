/**
 * GuestGate — full-screen "sign in to use this" placeholder shown in place
 * of a login-required tab's real content while the user is browsing as a
 * guest (Part A of the 2026-06-04 guest-entry plan). Built on EmptyState so
 * it matches the app's other empty states. The CTA opens the login screen.
 *
 * Used by the My / Spaces / Analytics tabs, which are inherently tied to a
 * signed-in account.
 */

import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { EmptyState } from '@/components/common/EmptyState';

interface GuestGateProps {
  /** Context-specific subtitle, e.g. t('auth.guest.gate_my'). */
  description: string;
  /** Glyph for the badge (defaults to a lock). */
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}

export function GuestGate({ description, icon = 'lock-closed-outline', testID }: GuestGateProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]} edges={['bottom']}>
      <EmptyState
        icon={icon}
        title={t('auth.guest.gate_title')}
        description={description}
        actionLabel={t('auth.guest.gate_cta')}
        onAction={() => router.push('/auth/login')}
        {...(testID ? { testID } : {})}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
