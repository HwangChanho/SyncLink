/**
 * Space join screen — invite code entry.
 *
 * Accepts a 6-character invite code to join an existing Space.
 * Supports deep link prefill: synclink://join/XXXXXX is handled in _layout.tsx,
 * which navigates here with `?code=XXXXXX` query param.
 *
 * Accessed via:
 *  - router.push('/space/join')           — manual entry
 *  - router.push('/space/join?code=ABC')  — prefilled from deep link
 */

import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as spaceService from '@/services/spaceService';
import { useSpaceStore } from '@/stores/spaceStore';

// Invite code is always 6 characters
const CODE_LENGTH = 6;

// ─── Component ────────────────────────────────────────────────────────────────

export default function JoinSpaceScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const { fetchMySpaces, setActiveSpaceId, setSpaceDetail } = useSpaceStore();

  // Pre-fill code from deep link param
  useEffect(() => {
    if (params.code) {
      setCode(params.code.toUpperCase().slice(0, CODE_LENGTH));
    }
  }, [params.code]);

  const handleCodeChange = (text: string) => {
    // Uppercase, strip non-alphanumeric, limit to 6 chars
    const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
    setCode(cleaned);
  };

  const handleJoin = async () => {
    if (code.length !== CODE_LENGTH) {
      Alert.alert(t('space.code_error'), `초대 코드는 ${CODE_LENGTH}자리입니다.`);
      return;
    }

    setIsLoading(true);
    try {
      const space = await spaceService.joinSpaceByInviteCode(code);

      // 스토어 업데이트
      setSpaceDetail(space);
      setActiveSpaceId(space.id);
      fetchMySpaces().catch(() => undefined);

      // Space 상세 화면으로 이동
      router.replace(`/space/${space.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('space.join_failed');
      Alert.alert(t('space.join_fail_title'), message);
    } finally {
      setIsLoading(false);
    }
  };

  const isReady = code.length === CODE_LENGTH;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.backText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Space 참여하기</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.content}>
          {/* Description */}
          <Text style={styles.description}>
            초대받은 Space의 코드를 입력하세요.
          </Text>
          <Text style={styles.descriptionSub}>
            코드는 영문 대소문자와 숫자 6자리입니다.
          </Text>

          {/* Code input */}
          <TextInput
            ref={inputRef}
            style={[styles.codeInput, isReady && styles.codeInputReady]}
            placeholder="XXXXXX"
            placeholderTextColor={colors.textPlaceholder}
            value={code}
            onChangeText={handleCodeChange}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={CODE_LENGTH}
            returnKeyType="done"
            onSubmitEditing={handleJoin}
            keyboardType="default"
          />

          {/* Character count hint */}
          <Text style={styles.codeHint}>
            {code.length}/{CODE_LENGTH}
          </Text>

          {/* Join button */}
          <TouchableOpacity
            style={[
              styles.joinButton,
              (!isReady || isLoading) && styles.joinButtonDisabled,
            ]}
            onPress={handleJoin}
            disabled={!isReady || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.joinButtonText}>{t('space.join_button') || '참여하기'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...textStyles.h4,
    color: colors.textPrimary,
  },
  backButton: {
    minWidth: 44,
  },
  backText: {
    ...textStyles.body,
    color: colors.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing[6],
    paddingTop: spacing[10],
    alignItems: 'center',
  },
  description: {
    ...textStyles.bodyLg,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  descriptionSub: {
    ...textStyles.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing[8],
  },
  codeInput: {
    width: '100%',
    height: 64,
    backgroundColor: colors.inputBackground,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[4],
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  codeInputReady: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  codeHint: {
    ...textStyles.caption,
    color: colors.textTertiary,
    marginTop: spacing[2],
  },
  joinButton: {
    width: '100%',
    height: componentHeight.button,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[8],
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  });
}
