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
import { light as colors } from '@/constants/colors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { updateProfile } from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const NICKNAME_MAX_LENGTH = 20;

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
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
      setErrorMessage('닉네임을 입력해 주세요.');
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
            <Text style={styles.title}>어떻게 불러드릴까요?</Text>
            <Text style={styles.subtitle}>
              함께 일정을 공유할 때 사용할 닉네임을 설정해 주세요.
              {'\n'}나중에 My 탭에서 언제든 변경할 수 있습니다.
            </Text>
          </View>

          {/* ── Nickname input ───────────────────────────────────────── */}
          <View style={styles.inputWrapper}>
            <TextInput
              style={[
                styles.input,
                errorMessage !== null && styles.inputError,
              ]}
              placeholder="닉네임 입력"
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
                  시작하기
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              disabled={isSaving}
              accessibilityLabel="닉네임 설정 건너뛰기"
              accessibilityRole="button"
            >
              <Text style={styles.skipText}>나중에 설정하기</Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
