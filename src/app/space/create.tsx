/**
 * Space creation screen.
 *
 * Allows the user to create a new Space by providing a name and type.
 * On success, navigates to the newly created Space's detail screen.
 *
 * Accessed via: router.push('/space/create')
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { showAlert } from '@/lib/webAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as spaceService from '@/services/spaceService';
import { useSpaceStore } from '@/stores/spaceStore';
import type { SpaceType } from '@/types';
import { logError } from '@/lib/errorLogger';

// ─── Space type options ────────────────────────────────────────────────────────

interface SpaceTypeOption {
  type: SpaceType;
  label: string;
  description: string;
  emoji: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateSpaceScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState<SpaceType>('couple');
  const [isLoading, setIsLoading] = useState(false);

  /** Space type options built from i18n translations. */
  const SPACE_TYPE_OPTIONS: SpaceTypeOption[] = [
    {
      type: 'couple',
      label: t('space.types.couple'),
      description: t('space.types.couple_desc'),
      emoji: '💑',
    },
    {
      type: 'group',
      label: t('space.types.group'),
      description: t('space.types.group_desc'),
      emoji: '👥',
    },
  ];

  const { fetchMySpaces, setActiveSpaceId, setSpaceDetail } = useSpaceStore();

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showAlert(t('space.need_name'), t('space.name_placeholder'));
      return;
    }

    setIsLoading(true);
    try {
      const space = await spaceService.createSpace({
        name: trimmedName,
        type: selectedType,
      });

      // 스토어 캐시 업데이트
      setSpaceDetail(space);
      setActiveSpaceId(space.id);

      // Sprint 27 R1 — IDEA-013 race fix:
      // 이전엔 fetchMySpaces() 를 await 없이 fire-and-forget 했더니, 사용자가
      // 곧바로 event/create 로 이동했을 때 useSpaceStore().spaces 가 아직 갱신
      // 전이라 신규 Space 가 "공유할 Space" 섹션에 안 떠 보이는 결함(F1)이
      // 발생했다. 갱신 완료를 기다린 후 navigate 하면 다음 화면이 항상 최신
      // spaces 를 본다. 네트워크 실패 시에도 캐시(setSpaceDetail) 가 있으므로
      // 사용자 경험은 보장됨 → catch 후 silently 진행.
      try {
        await fetchMySpaces();
      } catch {
        // Non-fatal — 다음 화면에서 재시도되거나 다음 mount 에서 자연스럽게 동기화됨.
      }

      // 생성된 Space 상세 화면으로 이동
      router.replace(`/space/${space.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('space.create_failed');
      void logError({ context: 'space.create.ui', error: err });
      console.error('[SpaceCreate] create failed:', err);
      showAlert(t('common.error'), message);
    } finally {
      setIsLoading(false);
    }
  };

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
            style={styles.cancelButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('space.create_title')}</Text>
          {/* Spacer to center title */}
          <View style={styles.cancelButton} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Space name */}
          <Text style={styles.label}>{t('space.name_label')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('space.name_placeholder')}
            placeholderTextColor={colors.textPlaceholder}
            value={name}
            onChangeText={setName}
            maxLength={30}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <Text style={styles.charCount}>{name.length}/30</Text>

          {/* Space type */}
          <Text style={[styles.label, styles.typeLabel]}>{t('space.type_label')}</Text>
          <View style={styles.typeContainer}>
            {SPACE_TYPE_OPTIONS.map((option) => {
              const isSelected = selectedType === option.type;
              return (
                <TouchableOpacity
                  key={option.type}
                  // testID pattern: space-type-couple | space-type-group
                  // Allows e2e tests to select type cards without relying on
                  // emoji text which differs per locale (IDEA-019 #6).
                  testID={`space-type-${option.type}`}
                  style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                  onPress={() => setSelectedType(option.type)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.typeEmoji}>{option.emoji}</Text>
                  <Text
                    style={[
                      styles.typeName,
                      isSelected && styles.typeNameSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[
                      styles.typeDescription,
                      isSelected && styles.typeDescriptionSelected,
                    ]}
                  >
                    {option.description}
                  </Text>
                  {/* Selection indicator */}
                  {isSelected && <View style={styles.typeCheckDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Create button */}
          <TouchableOpacity
            style={[
              styles.createButton,
              (isLoading || !name.trim()) && styles.createButtonDisabled,
            ]}
            onPress={handleCreate}
            disabled={isLoading || !name.trim()}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.createButtonText}>{t('space.create_button')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
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
  cancelButton: {
    minWidth: 44,
  },
  cancelText: {
    ...textStyles.body,
    color: colors.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
    paddingTop: spacing[6],
  },
  label: {
    ...textStyles.label,
    color: colors.textSecondary,
    marginBottom: spacing[2],
  },
  typeLabel: {
    marginTop: spacing[6],
  },
  input: {
    height: componentHeight.inputField,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing[4],
    ...textStyles.body,
    color: colors.textPrimary,
  },
  charCount: {
    ...textStyles.caption,
    color: colors.textTertiary,
    textAlign: 'right',
    marginTop: spacing[1],
  },
  typeContainer: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  typeCard: {
    flex: 1,
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    position: 'relative',
  },
  typeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  typeEmoji: {
    fontSize: 28,
    marginBottom: spacing[2],
  },
  typeName: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    marginBottom: spacing[1],
  },
  typeNameSelected: {
    color: colors.primary,
  },
  typeDescription: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  typeDescriptionSelected: {
    color: colors.primary,
  },
  typeCheckDot: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  createButton: {
    height: componentHeight.button,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[8],
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  });
}
