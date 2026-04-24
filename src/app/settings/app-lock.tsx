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

          {/*
            Large tap-target toggle card — replaces the small iOS Switch
            that felt awkward. Tapping anywhere on the card flips state;
            colour / label reflects the current value so it reads as a
            button rather than a fiddly slider.
          */}
          <Pressable
            style={({ pressed }) => [
              styles.lockToggleCard,
              isEnabled
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: colors.surface, borderColor: colors.border },
              (!biometricAvailable || isSaving || pressed) && { opacity: 0.75 },
            ]}
            disabled={!biometricAvailable || isSaving}
            onPress={() => void handleToggle(!isEnabled)}
            accessibilityLabel={t('settings.app_lock')}
            accessibilityRole="button"
          >
            <View style={styles.lockToggleRow}>
              <Ionicons
                name={isEnabled ? 'lock-closed' : 'lock-open-outline'}
                size={26}
                color={isEnabled ? colors.textInverse : colors.textSecondary}
              />
              <View style={styles.lockToggleText}>
                <Text
                  style={[
                    styles.lockToggleTitle,
                    { color: isEnabled ? colors.textInverse : colors.textPrimary },
                  ]}
                >
                  {t('settings.app_lock')}
                </Text>
                <Text
                  style={[
                    styles.lockToggleState,
                    { color: isEnabled ? colors.textInverse : colors.textSecondary },
                  ]}
                >
                  {isEnabled ? t('common.enabled', '사용 중') : t('common.disabled', '사용 안 함')}
                </Text>
              </View>
              {isSaving ? (
                <ActivityIndicator
                  size="small"
                  color={isEnabled ? colors.textInverse : colors.primary}
                />
              ) : null}
            </View>
            {!biometricAvailable && (
              <Text style={styles.unavailableText}>
                Biometric authentication is not available on this device.
              </Text>
            )}
          </Pressable>

          {/* Sprint 15 TASK-1510 — PIN fallback entry point. */}
          <Pressable
            style={styles.pinLink}
            onPress={() => router.push('/settings/pin')}
          >
            <Ionicons name="keypad-outline" size={22} color={colors.primary} />
            <View style={styles.pinLinkText}>
              <Text style={styles.pinLinkTitle}>{t('pin_lock.title')}</Text>
              <Text style={styles.pinLinkState}>{t('pin_lock.description')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
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
    // Big tap-target card replacing the Switch.
    lockToggleCard: {
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: spacing[4],
      marginTop: spacing[3],
    },
    lockToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
    lockToggleText: {
      flex: 1,
    },
    lockToggleTitle: {
      ...textStyles.labelLg,
    },
    lockToggleState: {
      ...textStyles.caption,
      marginTop: 2,
    },

    // Sprint 15 TASK-1510 — PIN entry row below the biometric card.
    pinLink: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[3],
      paddingHorizontal: spacing[4],
      paddingVertical:   spacing[4],
      borderRadius:  radius.xl,
      borderWidth:   1,
      borderColor:   colors.border,
      backgroundColor: colors.surface,
      marginTop: spacing[4],
      width: '100%',
    },
    pinLinkText: {
      flex: 1,
    },
    pinLinkTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    pinLinkState: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
}
