/**
 * Note detail/edit screen — view and edit a single note.
 *
 * Two modes:
 *  - View mode: renders markdown content with MarkdownDisplay
 *  - Edit mode: shows plain TextInput for editing
 *
 * Switching is toggled via the edit/save button in the header.
 *
 * Route: /note/[id]
 * TASK-402 (Sprint 4)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { light as colors } from '@/constants/colors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useTodoStore } from '@/stores/todoStore';
import type { Todo } from '@/types';

// ─── Component ────────────────────────────────────────────────────────────────

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { notes, editNote, removeNote } = useTodoStore();

  /** The note being viewed, loaded from store. */
  const [note, setNote] = useState<Todo | null>(null);
  /** True when in edit mode (TextInput shown). */
  const [isEditing, setIsEditing] = useState(false);
  /** Draft title while editing. */
  const [draftTitle, setDraftTitle] = useState('');
  /** Draft content while editing. */
  const [draftContent, setDraftContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // ── Load note from store ─────────────────────────────────────────────────

  useEffect(() => {
    const found = notes.find(n => n.id === id);
    setNote(found ?? null);
    if (found) {
      setDraftTitle(found.title);
      setDraftContent(found.content ?? '');
    }
  }, [id, notes]);

  // ── Edit / Save ──────────────────────────────────────────────────────────

  const handleStartEdit = useCallback(() => {
    if (!note) return;
    setDraftTitle(note.title);
    setDraftContent(note.content ?? '');
    setIsEditing(true);
  }, [note]);

  const handleSave = useCallback(async () => {
    if (!note) return;
    const trimmedTitle = draftTitle.trim();
    if (trimmedTitle.length === 0) {
      Alert.alert('오류', '노트 제목을 입력해 주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const trimmedContent = draftContent.trim();
      await editNote(note.id, {
        title:   trimmedTitle,
        // Pass content only when non-empty (exactOptionalPropertyTypes requires omitting undefined)
        ...(trimmedContent.length > 0 ? { content: trimmedContent } : {}),
      });
      setIsEditing(false);
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [note, draftTitle, draftContent, editNote]);

  const handleCancelEdit = useCallback(() => {
    if (!note) return;
    setDraftTitle(note.title);
    setDraftContent(note.content ?? '');
    setIsEditing(false);
  }, [note]);

  // ── Delete ───────────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!note) return;
    Alert.alert(
      '노트 삭제',
      `"${note.title}"을(를) 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            await removeNote(note.id);
            router.back();
          },
        },
      ],
    );
  }, [note, removeNote, router]);

  // ── Not found ────────────────────────────────────────────────────────────

  if (!note) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.notFoundText}>노트를 찾을 수 없습니다.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>돌아가기</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={isEditing ? handleCancelEdit : () => router.back()}
        >
          <Ionicons
            name={isEditing ? 'close' : 'chevron-back'}
            size={24}
            color={colors.textPrimary}
          />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {isEditing ? '노트 편집' : note.title}
        </Text>

        {/* Right actions */}
        <View style={styles.headerRight}>
          {isEditing ? (
            // Save button in edit mode
            <TouchableOpacity
              style={[styles.savePill, isSaving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Text style={styles.savePillText}>저장</Text>
              }
            </TouchableOpacity>
          ) : (
            // Edit + delete buttons in view mode
            <>
              <TouchableOpacity style={styles.headerBtn} onPress={handleStartEdit}>
                <Ionicons name="pencil-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerBtn} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Content */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {isEditing ? (
          // ── Edit mode ──────────────────────────────────────────────────
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              style={styles.titleInput}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="노트 제목"
              placeholderTextColor={colors.textPlaceholder}
              returnKeyType="next"
              autoFocus
            />
            <View style={styles.divider} />
            <TextInput
              style={styles.bodyInput}
              value={draftContent}
              onChangeText={setDraftContent}
              placeholder="내용을 입력하세요..."
              placeholderTextColor={colors.textPlaceholder}
              multiline
              textAlignVertical="top"
            />
          </ScrollView>
        ) : (
          // ── View mode ──────────────────────────────────────────────────
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.viewContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.viewTitle}>{note.title}</Text>
            <Text style={styles.viewDate}>
              수정: {formatDate(note.updatedAt)}
            </Text>
            <View style={styles.divider} />
            {/* Plain text rendering — markdown display kept simple for web/test compat */}
            <Text style={styles.viewBody}>
              {note.content ?? '(내용 없음)'}
            </Text>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a Date to a Korean date string.
 * e.g. "2026년 4월 20일 오전 10:30"
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const min = String(date.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${y}년 ${m}월 ${d}일 ${ampm} ${h12}:${min}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
  },
  notFoundText: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  backBtn: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backBtnText: {
    ...textStyles.label,
    color: colors.textSecondary,
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
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  savePill: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
    borderRadius: radius.full,
  },
  savePillText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  buttonDisabled: { opacity: 0.5 },

  // Editor (edit mode)
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
    marginTop: spacing[1],
  },
  bodyInput: {
    ...textStyles.body,
    color: colors.textPrimary,
    minHeight: 300,
    lineHeight: 24,
  },

  // Viewer (view mode)
  viewContent: {
    padding: spacing[5],
    paddingBottom: spacing[10],
  },
  viewTitle: {
    ...textStyles.h2,
    color: colors.textPrimary,
    marginBottom: spacing[1],
  },
  viewDate: {
    ...textStyles.caption,
    color: colors.textTertiary,
    marginBottom: spacing[4],
  },
  viewBody: {
    ...textStyles.bodyLg,
    color: colors.textPrimary,
    lineHeight: 26,
  },
});
