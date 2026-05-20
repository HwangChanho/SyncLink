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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { updateProfile } from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { SUPPORTED_COUNTRIES, type CountryCode } from '@/services/holidayService';

// ─── Constants ────────────────────────────────────────────────────────────────

const NICKNAME_MAX_LENGTH = 20;
const DEFAULT_COUNTRY: CountryCode = 'KR';

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [nickname, setNickname] = useState('');
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
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
      // v1.1.4 — nickname + country_code 한 번에 저장. country 는 캘린더 공휴일·지역
      // 포맷에 즉시 반영. DB default 'KR' 이지만 명시 저장으로 setUser 가 받는
      // UserRow 도 최신 country 를 포함하게 함 (다른 화면이 reactive).
      const updatedUser = await updateProfile({
        nickname:     trimmed,
        country_code: country,
      });
      setUser(updatedUser);
    } catch {
      // Silently proceed — user can update later in My tab (TASK-102) / /settings/country
    } finally {
      setIsSaving(false);
    }

    // TASK-101: replace with router.replace('/space/create') once Space screen exists
    router.replace('/(tabs)');
  }

  /**
   * 닉네임을 건너뛰는 경우에도 선택한 country 는 보존 (skip 직전까지 사용자가
   * 직접 고른 값). 호출 실패해도 DB default 'KR' 가 살아있어 안전.
   */
  async function handleSkip() {
    if (isSaving) return;
    try {
      const updatedUser = await updateProfile({ country_code: country });
      setUser(updatedUser);
    } catch {
      // 무시 — /(tabs) 로 진입. 사용자는 나중에 /settings/country 에서 변경 가능.
    }
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
              accessibilityLabel={t('common.a11y_nickname_input')}
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

          {/* ── Country picker ───────────────────────────────────────── */}
          {/* v1.1.4 — 회원가입 시 국가 입력 → 캘린더 공휴일 즉시 적용.
              여행 등으로 변경하고 싶을 땐 /settings/country 에서 동일 UI. */}
          <View style={styles.countrySection}>
            <Text style={styles.countryLabel}>
              {t('profile.onboarding_country_label', { defaultValue: '캘린더 국가' })}
            </Text>
            <Text style={styles.countryHint}>
              {t('profile.onboarding_country_hint', {
                defaultValue: '선택한 국가의 공휴일이 캘린더에 표시돼요. 설정에서 언제든 변경할 수 있어요.',
              })}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.countryRow}
            >
              {SUPPORTED_COUNTRIES.map((opt) => {
                const active = opt.code === country;
                return (
                  <TouchableOpacity
                    key={opt.code}
                    onPress={() => setCountry(opt.code)}
                    style={[styles.countryChip, active && styles.countryChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`onboarding-country-${opt.code.toLowerCase()}`}
                  >
                    <Text style={[styles.countryChipText, active && styles.countryChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

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
              accessibilityLabel={t('common.a11y_nickname_done')}
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
              testID="profile-onboarding-button-skip"
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

  // Country picker
  countrySection: {
    marginTop: spacing[6],
  },
  countryLabel: {
    ...textStyles.bodySm,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  countryHint: {
    ...textStyles.caption,
    color: colors.textTertiary,
    marginBottom: spacing[3],
    lineHeight: 18,
  },
  countryRow: {
    gap: spacing[2],
    paddingRight: spacing[4],
  },
  countryChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  countryChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  countryChipText: {
    ...textStyles.bodySm,
    color: colors.textSecondary,
  },
  countryChipTextActive: {
    color: colors.textInverse,
    fontWeight: '600',
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
