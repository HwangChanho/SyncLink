/**
 * TodoEditSheet — Bottom-sheet editor for a single todo.
 *
 * Replaces the legacy mid-screen EditTodoModal so the user can edit a todo
 * without the keyboard covering the inputs. Exposes title / memo / category
 * / due date fields, with auto-focus on the title when opened.
 *
 * Implemented with React Native Modal (slide-up) + KeyboardAvoidingView —
 * this keeps the bundle small and avoids the Reanimated/GestureHandler
 * configuration required by @gorhom/bottom-sheet. The visual result (slide
 * from bottom, lifts above the keyboard) is equivalent.
 *
 * Sprint 14 TASK-1412
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { radius, spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { Category, Todo, TodoPriority, UpdateTodoInput } from '@/types';
import { CategoryChip } from './CategoryChip';
import { CategoryPickerSheet } from './CategoryPickerSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TodoEditSheetProps {
  /** Todo to edit. When null, the sheet is hidden. */
  todo: Todo | null;

  /**
   * Map from categoryId to resolved Category so we can render the chip
   * without re-fetching. Passed in from the parent which already caches.
   */
  categoryMap: Map<string, Category>;

  /** Close without saving. */
  onClose: () => void;

  /** Persist the patch. Parent is responsible for the store/service call. */
  onSave: (id: string, patch: UpdateTodoInput) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high'];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A slide-up sheet that edits the given todo. Auto-focuses the title field
 * when opened. Save button is disabled until the title is non-empty.
 */
export function TodoEditSheet({
  todo,
  categoryMap,
  onClose,
  onSave,
}: TodoEditSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  // ── Local form state ───────────────────────────────────────────────────────

  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  /** Sub-sheet visibility for category picker. */
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  // Sync form state whenever the given todo changes (opens / switches).
  useEffect(() => {
    if (!todo) return;
    setTitle(todo.title);
    setMemo(todo.content ?? '');
    setPriority(todo.priority);
    setCategoryId(todo.categoryId);
  }, [todo]);

  // Title input autofocus — done imperatively because <TextInput autoFocus> in
  // a Modal may focus before the keyboard animation completes.
  const titleInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (todo) {
      // Short delay ensures the Modal has laid out before focusing.
      const id = setTimeout(() => titleInputRef.current?.focus(), 150);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [todo]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!todo || title.trim().length === 0 || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(todo.id, {
        title: title.trim(),
        content: memo.trim(),
        priority,
        categoryId,
      });
      onClose();
    } catch {
      // Parent already surfaces errors via its own UI; just release spinner.
      setIsSaving(false);
    }
  }, [todo, title, memo, priority, categoryId, onSave, onClose, isSaving]);

  /**
   * Auto-save on close — user asked to drop the explicit Save button so
   * the sheet feels like Apple Notes: edits persist as soon as you
   * dismiss. Only fires when there's a non-empty title and the content
   * actually diverges from the original.
   */
  const handleCloseWithSave = useCallback(() => {
    if (!todo) { onClose(); return; }
    const trimmed = title.trim();
    const memoTrim = memo.trim();
    const dirty =
      trimmed !== todo.title ||
      memoTrim !== (todo.content ?? '') ||
      priority !== todo.priority ||
      categoryId !== todo.categoryId;
    if (trimmed.length === 0 || !dirty) {
      onClose();
      return;
    }
    void handleSave();
  }, [todo, title, memo, priority, categoryId, handleSave, onClose]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const resolvedCategory = categoryId ? (categoryMap.get(categoryId) ?? null) : null;
  const visible = todo !== null;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={handleCloseWithSave}
      >
        <Pressable style={styles.overlay} onPress={handleCloseWithSave}>
          <Pressable
            style={styles.sheetWrapper}
            onPress={(e) => e.stopPropagation()}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.sheet}
            >
              {/* Grab handle */}
              <View style={styles.handle} />

              {/*
                Header — no explicit Save. Closing the sheet (tap outside,
                grab-handle, or back gesture) auto-saves. Right slot shows
                a spinner while a save is in-flight.
              */}
              <View style={styles.header}>
                <Pressable onPress={handleCloseWithSave} disabled={isSaving}>
                  <Text style={styles.headerCancel}>{t('common.close', '닫기')}</Text>
                </Pressable>
                <Text style={styles.headerTitle}>
                  {t('common.edit')} {t('todo.label')}
                </Text>
                <View style={{ minWidth: 40, alignItems: 'flex-end' }}>
                  {isSaving && (
                    <ActivityIndicator color={colors.primary} size="small" />
                  )}
                </View>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scrollContent}
              >
                {/* Category chip row */}
                <View style={styles.chipRow}>
                  <CategoryChip
                    category={resolvedCategory}
                    onPress={() => setCategoryPickerOpen(true)}
                  />
                </View>

                {/* Title */}
                <TextInput
                  ref={titleInputRef}
                  style={styles.titleInput}
                  placeholder={t('todo.label')}
                  placeholderTextColor={colors.textPlaceholder}
                  value={title}
                  onChangeText={setTitle}
                  returnKeyType="next"
                />

                {/* Priority chips */}
                <Text style={styles.sectionLabel}>
                  {t('todo.priority.label') ?? 'Priority'}
                </Text>
                <View style={styles.priorityRow}>
                  {PRIORITIES.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setPriority(p)}
                      style={[
                        styles.priorityChip,
                        priority === p && styles.priorityChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.priorityText,
                          priority === p && styles.priorityTextActive,
                        ]}
                      >
                        {t(`todo.priority.${p}`)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Memo */}
                <Text style={styles.sectionLabel}>
                  {t('note.label')}
                </Text>
                <TextInput
                  style={styles.memoInput}
                  placeholder={t('nl.placeholder')}
                  placeholderTextColor={colors.textPlaceholder}
                  value={memo}
                  onChangeText={setMemo}
                  multiline
                />
              </ScrollView>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Nested category picker — rendered outside the modal so it slides
          over the edit sheet without z-index conflicts. */}
      <CategoryPickerSheet
        visible={categoryPickerOpen}
        selectedId={categoryId}
        onClose={() => setCategoryPickerOpen(false)}
        onSelect={(id) => setCategoryId(id)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheetWrapper: {
      width: '100%',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing[5],
      paddingTop: spacing[2],
      paddingBottom: spacing[8],
      maxHeight: '90%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[3],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing[3],
    },
    headerTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    headerCancel: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    headerSave: {
      ...textStyles.labelLg,
      color: colors.primary,
    },
    disabled: {
      opacity: 0.4,
    },

    scrollContent: {
      gap: spacing[4],
      paddingBottom: spacing[4],
    },
    chipRow: {
      marginBottom: spacing[1],
    },
    titleInput: {
      ...textStyles.h4,
      color: colors.textPrimary,
      paddingVertical: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },

    sectionLabel: {
      ...textStyles.label,
      color: colors.textSecondary,
      marginTop: spacing[2],
    },

    priorityRow: {
      flexDirection: 'row',
      gap: spacing[2],
    },
    priorityChip: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    priorityChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
    },
    priorityText: {
      ...textStyles.labelSm,
      color: colors.textSecondary,
    },
    priorityTextActive: {
      color: colors.primary,
    },

    memoInput: {
      ...textStyles.body,
      color: colors.textPrimary,
      minHeight: 120,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
      textAlignVertical: 'top',
    },
  });
}

// Ensure Ionicons usage doesn't trigger a tree-shake warning.
void Ionicons;
