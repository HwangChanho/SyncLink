/**
 * Onboarding screen — shown once after the very first sign-in.
 *
 * Lets the user set a display nickname before entering the app.
 * On completion (or skip), navigates to /(tabs).
 *
 * Full profile sync with Supabase: TASK-100.
 * Until then, the updateProfile stub will throw — the user can still skip.
 */

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { updateProfile } from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const NICKNAME_MAX_LENGTH = 20;

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [nickname, setNickname] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { setUser } = useAuthStore();

  // ─── Handlers ────────────────────────────────────────────────────────────

  /**
   * Saves the nickname via authService and proceeds to the main tabs.
   * If the service throws (stub not yet implemented), falls through to /(tabs)
   * with an error notice — user can always update nickname later in My tab.
   */
  async function handleConfirm() {
    const trimmed = nickname.trim();
    if (trimmed.length === 0) {
      setErrorMessage(t('profile.nickname_required'));
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const updatedUser = await updateProfile({ nickname: trimmed });
      setUser(updatedUser); // sync store with new nickname
    } catch {
      // Silently proceed — user can update nickname later in My tab (TASK-102)
    } finally {
      setIsSaving(false);
    }

    // TASK-101: replace with router.replace('/space/create') once Space screen exists
    router.replace('/(tabs)');
  }

  /** Skips nickname setup entirely — goes straight to the main app. */
  function handleSkip() {
    router.replace('/(tabs)');
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>

          {/* ── Header ───────────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('profile.onboarding_title')}</Text>
            <Text style={styles.subtitle}>{t('profile.onboarding_subtitle')}</Text>
          </View>

          {/* ── Nickname input ───────────────────────────────────────── */}
          <View style={styles.inputWrapper}>
            <TextInput
              style={[
                styles.input,
                errorMessage !== null && styles.inputError,
              ]}
              placeholder={t('profile.nickname_placeholder')}
              placeholderTextColor={colors.textPlaceholder}
              value={nickname}
              onChangeText={(text) => {
                setNickname(text);
                if (errorMessage !== null) setErrorMessage(null);
              }}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
              accessibilityLabel="닉네임 입력 필드"
            />
            {/* Character counter */}
            <Text style={styles.charCount}>
              {nickname.length}/{NICKNAME_MAX_LENGTH}
            </Text>
          </View>

          {/* ── Error ────────────────────────────────────────────────── */}
          {errorMessage !== null && (
            <Text style={styles.errorText}>{errorMessage}</Text>
          )}

          {/* ── CTA buttons ──────────────────────────────────────────── */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[
                styles.button,
                styles.confirmButton,
                isSaving && styles.buttonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={isSaving}
              accessibilityLabel="닉네임 설정 완료"
              accessibilityRole="button"
            >
              {isSaving ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={[styles.buttonText, styles.confirmButtonText]}>
                  {t('onboarding.start')}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              disabled={isSaving}
              accessibilityLabel={t('profile.onboarding_skip')}
              accessibilityRole="button"
            >
              <Text style={styles.skipText}>{t('profile.onboarding_skip')}</Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing[6],
    justifyContent: 'center',
  },

  // Header
  header: {
    marginBottom: spacing[10],
  },
  title: {
    ...textStyles.h2,
    color: colors.textPrimary,
    marginBottom: spacing[3],
  },
  subtitle: {
    ...textStyles.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },

  // Input
  inputWrapper: {
    marginBottom: spacing[2],
  },
  input: {
    height: componentHeight.inputField,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[4],
    ...textStyles.body,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.error,
  },
  charCount: {
    ...textStyles.caption,
    color: colors.textTertiary,
    textAlign: 'right',
    marginTop: spacing[1],
    marginRight: spacing[1],
  },

  // Error
  errorText: {
    ...textStyles.bodySm,
    color: colors.error,
    marginBottom: spacing[4],
  },

  // Buttons
  buttons: {
    marginTop: spacing[8],
    gap: spacing[3],
  },
  button: {
    width: '100%',
    height: componentHeight.button,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    ...textStyles.labelLg,
  },
  confirmButton: {
    backgroundColor: colors.primary,
  },
  confirmButtonText: {
    color: colors.textInverse,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  skipText: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  });
}
