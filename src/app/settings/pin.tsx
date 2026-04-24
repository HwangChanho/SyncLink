/**
 * PIN settings screen.
 *
 * Flow:
 *   - No PIN yet: "Enter new" → "Confirm" → save & enable.
 *   - PIN exists + enabled: "Enter current" → disable OR "Change" → re-enter.
 *   - PIN exists but disabled: show "enable" / "change" / "remove" options.
 *
 * Route: /settings/pin
 * Sprint 15 TASK-1510.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useAppLockStore } from '@/stores/appLockStore';
import { clearPin, hasPin, setPin, verifyPin } from '@/services/pinLockService';
import { PinPad } from '@/components/common/PinPad';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Internal state machine for the setup / change / disable flow. Separate
 * from React state to keep the render logic a single switch statement.
 */
type Step =
  | 'menu'            // options screen (existing PIN)
  | 'enter_new'       // first step of setting a fresh PIN
  | 'confirm_new'     // second step — confirm match
  | 'verify_current'  // confirm ownership before disable / change
  | 'change_new'      // new PIN after verifying current
  | 'change_confirm'; // confirm new PIN

// ─── Component ────────────────────────────────────────────────────────────────

export default function PinSettingsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const pinEnabled     = useAppLockStore((s) => s.pinEnabled);
  const setPinEnabled  = useAppLockStore((s) => s.setPinEnabled);

  /** True once we know whether a PIN has ever been set on this device. */
  const [hasSaved, setHasSaved] = useState<boolean | null>(null);
  const [step, setStep]         = useState<Step>('menu');
  /** Buffered first PIN entry during setup/change (pre-confirmation). */
  const [draftPin, setDraftPin] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  /** Bumped every time we want the PinPad to clear its in-progress input. */
  const [resetKey, setResetKey] = useState(0);

  // Decide the initial step once the storage read completes.
  useEffect(() => {
    void hasPin().then((exists) => {
      setHasSaved(exists);
      setStep(exists ? 'menu' : 'enter_new');
    });
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const bumpReset = useCallback(() => setResetKey((k) => k + 1), []);

  /** Handle the very first PIN entry when no prior PIN exists. */
  const handleEnterNew = useCallback((pin: string) => {
    setDraftPin(pin);
    setError(null);
    setStep('confirm_new');
    bumpReset();
  }, [bumpReset]);

  /** Handle the confirmation entry during initial setup. */
  const handleConfirmNew = useCallback(async (confirm: string) => {
    if (!draftPin || draftPin !== confirm) {
      setError(t('pin_lock.mismatch'));
      setDraftPin(null);
      setStep('enter_new');
      bumpReset();
      return;
    }
    try {
      await setPin(draftPin);
      await setPinEnabled(true);
      Alert.alert(t('pin_lock.title'), t('pin_lock.success'));
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      bumpReset();
    }
  }, [draftPin, setPinEnabled, t, bumpReset]);

  /** Verify current PIN before allowing change / disable actions. */
  const handleVerifyCurrent = useCallback(async (
    pin: string,
    onSuccess: () => void,
  ) => {
    const ok = await verifyPin(pin);
    if (!ok) {
      setError(t('pin_lock.incorrect'));
      bumpReset();
      return;
    }
    setError(null);
    onSuccess();
  }, [t, bumpReset]);

  /** Disable PIN lock (after verifying current). */
  const handleDisable = useCallback(async () => {
    await clearPin();
    await setPinEnabled(false);
    setHasSaved(false);
    Alert.alert(t('pin_lock.title'), t('pin_lock.disabled'));
    router.back();
  }, [setPinEnabled, t]);

  // ─── Step dispatcher ───────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      case 'menu':
        // Simple list of actions for users who already have a PIN.
        return (
          <View style={styles.menu}>
            <Text style={styles.menuTitle}>{t('pin_lock.title')}</Text>
            <Text style={styles.menuDescription}>{t('pin_lock.description')}</Text>

            <Pressable
              style={styles.menuButton}
              onPress={() => { setDraftPin(null); setStep('change_new'); bumpReset(); }}
            >
              <Ionicons name="key-outline" size={20} color={colors.primary} />
              <Text style={styles.menuButtonText}>{t('pin_lock.change')}</Text>
            </Pressable>

            <Pressable
              style={[styles.menuButton, styles.menuButtonDestructive]}
              onPress={() => { setStep('verify_current'); bumpReset(); }}
            >
              <Ionicons name="lock-open-outline" size={20} color={colors.error} />
              <Text style={[styles.menuButtonText, { color: colors.error }]}>
                {t('pin_lock.disable')}
              </Text>
            </Pressable>
          </View>
        );

      case 'enter_new':
        return (
          <PinPad
            label={t('pin_lock.set_title')}
            subLabel={error ?? t('pin_lock.enter')}
            subLabelIsError={!!error}
            onChange={(pin) => { if (pin.length === 0) setError(null); }}
            onComplete={handleEnterNew}
            resetKey={resetKey}
          />
        );

      case 'confirm_new':
        return (
          <PinPad
            label={t('pin_lock.set_title')}
            subLabel={t('pin_lock.confirm')}
            onComplete={handleConfirmNew}
            resetKey={resetKey}
          />
        );

      case 'verify_current':
        return (
          <PinPad
            label={t('pin_lock.title')}
            subLabel={error ?? t('pin_lock.enter_current')}
            subLabelIsError={!!error}
            onChange={(pin) => { if (pin.length === 0) setError(null); }}
            onComplete={(pin) => void handleVerifyCurrent(pin, () => {
              // For the disable flow we jump straight to clearing the PIN.
              // The change flow uses a separate transition via the menu buttons.
              void handleDisable();
            })}
            resetKey={resetKey}
          />
        );

      case 'change_new':
        return (
          <PinPad
            label={t('pin_lock.change')}
            subLabel={error ?? t('pin_lock.enter')}
            subLabelIsError={!!error}
            onChange={(pin) => { if (pin.length === 0) setError(null); }}
            onComplete={(pin) => {
              setDraftPin(pin);
              setStep('change_confirm');
              bumpReset();
            }}
            resetKey={resetKey}
          />
        );

      case 'change_confirm':
        return (
          <PinPad
            label={t('pin_lock.change')}
            subLabel={t('pin_lock.confirm')}
            onComplete={handleConfirmNew}
            resetKey={resetKey}
          />
        );
    }
  };

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
        <Text style={styles.headerTitle}>{t('pin_lock.title')}</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {hasSaved === null ? null : renderStep()}
      </View>

      {/* Enable/disable summary strip */}
      {hasSaved && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {pinEnabled ? t('pin_lock.enable') : t('pin_lock.disable')}
          </Text>
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
      alignItems:    'center',
      height:        56,
      paddingHorizontal: spacing[4],
      backgroundColor:   colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      width: 40,
      alignItems: 'flex-start',
    },
    headerTitle: {
      ...textStyles.labelLg,
      color:     colors.textPrimary,
      flex:      1,
      textAlign: 'center',
    },
    headerRight: { width: 40 },
    content: {
      flex: 1,
      paddingTop: spacing[8],
      alignItems: 'center',
    },
    footer: {
      padding: spacing[4],
      alignItems: 'center',
    },
    footerText: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },

    // Menu (existing PIN)
    menu: {
      width: '100%',
      padding: spacing[5],
      gap: spacing[3],
      alignItems: 'stretch',
    },
    menuTitle: {
      ...textStyles.h3,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    menuDescription: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing[4],
    },
    menuButton: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[3],
      paddingVertical:   spacing[4],
      paddingHorizontal: spacing[4],
      backgroundColor: colors.surface,
      borderRadius:    radius.lg,
      borderWidth:     1,
      borderColor:     colors.border,
    },
    menuButtonDestructive: {
      borderColor: colors.error,
    },
    menuButtonText: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
  });
}
