/**
 * App Lock settings screen.
 *
 * Allows the user to enable / disable biometric app lock (Face ID / Touch ID).
 * When enabled, the app shows a lock overlay whenever it returns from background.
 *
 * Route: /settings/app-lock
 * TASK-900 (Sprint 9)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useAppLockStore } from '@/stores/appLockStore';
import { isBiometricAvailable, authenticate } from '@/services/appLockService';

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppLockScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const { isEnabled, setEnabled } = useAppLockStore();

  /** True while checking biometric availability on mount. */
  const [isChecking, setIsChecking] = useState(true);
  /** True if the device supports biometrics. */
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  /** True during the toggle save operation. */
  const [isSaving, setIsSaving] = useState(false);

  // Check biometric availability once on mount
  useEffect(() => {
    isBiometricAvailable()
      .then(setBiometricAvailable)
      .catch(() => setBiometricAvailable(false))
      .finally(() => setIsChecking(false));
  }, []);

  /**
   * Handle toggle change:
   *  - Enabling: prompt for auth first to confirm biometrics work.
   *  - Disabling: require auth before allowing the user to turn it off.
   */
  const handleToggle = useCallback(async (value: boolean) => {
    if (!biometricAvailable) {
      Alert.alert(t('common.error'), 'Biometric authentication is not available on this device.');
      return;
    }

    setIsSaving(true);
    try {
      // Always require authentication before changing the lock state
      const result = await authenticate(t('settings.authenticate'));
      if (!result.success) {
        Alert.alert(t('common.error'), result.error ?? 'Authentication failed.');
        return;
      }

      await setEnabled(value);
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.unknown_error'));
    } finally {
      setIsSaving(false);
    }
  }, [biometricAvailable, setEnabled, t]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.app_lock')}</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Content */}
      {isChecking ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={styles.content}>
          {/* Lock icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name={isEnabled ? 'lock-closed' : 'lock-open-outline'}
              size={48}
              color={isEnabled ? colors.primary : colors.textTertiary}
            />
          </View>

          {/* Description */}
          <Text style={styles.description}>{t('settings.app_lock_desc')}</Text>

          {/* Toggle row */}
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleLabel}>{t('settings.app_lock')}</Text>
                {!biometricAvailable && (
                  <Text style={styles.unavailableText}>
                    Biometric authentication is not available on this device.
                  </Text>
                )}
              </View>
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={isEnabled}
                  onValueChange={(val) => void handleToggle(val)}
                  disabled={!biometricAvailable || isSaving}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={isEnabled ? colors.primary : colors.surface}
                />
              )}
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundAlt,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 56,
      paddingHorizontal: spacing[4],
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      width: 40,
      alignItems: 'flex-start',
    },
    headerTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      flex: 1,
      textAlign: 'center',
    },
    headerRight: {
      width: 40,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      flex: 1,
      paddingHorizontal: spacing[4],
      paddingTop: spacing[8],
      gap: spacing[6],
      alignItems: 'center',
    },
    iconContainer: {
      width: 96,
      height: 96,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    description: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing[4],
    },
    card: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[4],
    },
    toggleInfo: {
      flex: 1,
      marginRight: spacing[3],
    },
    toggleLabel: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    unavailableText: {
      ...textStyles.caption,
      color: colors.textTertiary,
      marginTop: spacing[0.5],
    },
  });
}
