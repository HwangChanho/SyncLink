/**
 * Note creation screen — allows the user to write a new note.
 *
 * Presented as a modal from the Planner tab's Notes FAB.
 * Route: /note/new
 *
 * TASK-402 (Sprint 4)
 */

import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { light as colors } from '@/constants/colors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useTodoStore } from '@/stores/todoStore';

export default function NoteNewScreen() {
  const router = useRouter();
  const { addTodo } = useTodoStore();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Save the new note and navigate back.
   * Validates that title is non-empty.
   */
  const handleSave = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      Alert.alert('오류', '노트 제목을 입력해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const trimmedContent = content.trim();
      await addTodo({
        title: trimmedTitle,
        // Omit content when empty (exactOptionalPropertyTypes: content must be string, not undefined)
        ...(trimmedContent.length > 0 ? { content: trimmedContent } : {}),
        contentType: 'note',
      });
      router.back();
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : '노트 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [title, content, addTodo, router]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>새 노트</Text>
        <TouchableOpacity
          style={[styles.headerBtn, styles.saveBtn, isSaving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving
            ? <ActivityIndicator size="small" color={colors.textInverse} />
            : <Text style={styles.saveBtnText}>저장</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Editor */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.editorContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title input */}
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="노트 제목"
            placeholderTextColor={colors.textPlaceholder}
            multiline={false}
            returnKeyType="next"
            autoFocus
          />

          {/* Divider */}
          <View style={styles.divider} />

          {/* Body input — supports markdown syntax as plain text */}
          <TextInput
            style={styles.bodyInput}
            value={content}
            onChangeText={setContent}
            placeholder={`내용을 입력하세요...\n\n마크다운을 지원합니다:\n**굵게**, *이탤릭*\n- 목록\n- [ ] 체크리스트`}
            placeholderTextColor={colors.textPlaceholder}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: componentHeight.navHeader,
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing[2],
  },
  headerBtn: {
    padding: spacing[1],
  },
  headerTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
    borderRadius: radius.full,
  },
  saveBtnText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  buttonDisabled: { opacity: 0.5 },

  editorContent: {
    padding: spacing[4],
    flexGrow: 1,
  },
  titleInput: {
    ...textStyles.h3,
    color: colors.textPrimary,
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing[3],
  },
  bodyInput: {
    ...textStyles.body,
    color: colors.textPrimary,
    minHeight: 300,
    lineHeight: 24,
  },
});
