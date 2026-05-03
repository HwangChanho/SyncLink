/**
 * TodoCreateSheet — Full bottom-sheet for creating a new todo.
 *
 * Separate from TodoEditSheet because they have distinct life-cycles:
 *   - Edit sheet: driven by a `todo: Todo | null` prop, prefills state.
 *   - Create sheet: driven by `visible: boolean`, resets to empty on open.
 *
 * Replaces the inline quick-add bar that was getting occluded by the
 * on-screen keyboard in the planner tab. Implemented with Modal +
 * KeyboardAvoidingView so it behaves identically to TodoEditSheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
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
import type { Category, CreateTodoInput, TodoPriority } from '@/types';
import { CategoryChip } from './CategoryChip';
import { CategoryPickerSheet } from './CategoryPickerSheet';
import { DateTimeModal } from '@/components/common/DateTimeModal';

const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high'];

export interface TodoCreateSheetProps {
  visible: boolean;
  categoryMap: Map<string, Category>;
  /** Category pre-selected when the sheet opens (inherited from the planner). */
  defaultCategoryId?: string | null;
  onClose: () => void;
  onCreate: (input: CreateTodoInput) => Promise<void>;
}

export function TodoCreateSheet({
  visible,
  categoryMap,
  defaultCategoryId = null,
  onClose,
  onCreate,
}: TodoCreateSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [categoryId, setCategoryId] = useState<string | null>(defaultCategoryId);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  /**
   * Live keyboard height. Modal-hosted KeyboardAvoidingView is unreliable
   * on iOS — the inputs stayed under the keyboard. Tracking the height
   * imperatively via Keyboard events and lifting the sheet by that
   * amount works on both platforms.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(show, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hide, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Reset form every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setTitle('');
      setMemo('');
      setPriority('medium');
      setCategoryId(defaultCategoryId);
      setDueDate(null);
      setIsSaving(false);
    }
  }, [visible, defaultCategoryId]);

  const titleInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (visible) {
      const id = setTimeout(() => titleInputRef.current?.focus(), 200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [visible]);

  const handleCreate = useCallback(async () => {
    if (title.trim().length === 0 || isSaving) return;
    setIsSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        contentType: 'todo',
        priority,
        ...(memo.trim() ? { content: memo.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      onClose();
    } catch {
      setIsSaving(false);
    }
  }, [title, memo, priority, categoryId, dueDate, onCreate, onClose, isSaving]);

  const resolvedCategory = categoryId ? (categoryMap.get(categoryId) ?? null) : null;

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable
            style={[styles.sheetWrapper, { paddingBottom: keyboardHeight }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sheet}>
              <View style={styles.handle} />

              <View style={styles.header}>
                <Pressable onPress={onClose} disabled={isSaving}>
                  <Text style={styles.headerCancel}>{t('common.cancel')}</Text>
                </Pressable>
                <Text style={styles.headerTitle}>{t('todo.label')}</Text>
                <Pressable
                  testID="todo-create-save"
                  onPress={() => void handleCreate()}
                  disabled={isSaving || title.trim().length === 0}
                  style={(isSaving || title.trim().length === 0) && styles.disabled}
                >
                  {isSaving ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Text style={styles.headerSave}>{t('common.save')}</Text>
                  )}
                </Pressable>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scrollContent}
              >
                <View style={styles.chipRow}>
                  <CategoryChip
                    category={resolvedCategory}
                    onPress={() => setCategoryPickerOpen(true)}
                  />
                  <Pressable
                    style={[
                      styles.inlineChip,
                      dueDate && { borderColor: colors.primary },
                    ]}
                    onPress={() => setDateOpen(true)}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={dueDate ? colors.primary : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.inlineChipText,
                        dueDate && { color: colors.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {dueDate
                        ? `${dueDate.getMonth() + 1}/${dueDate.getDate()}`
                        : t('time.date')}
                    </Text>
                  </Pressable>
                </View>

                <TextInput
                  ref={titleInputRef}
                  testID="todo-create-title-input"
                  style={styles.titleInput}
                  placeholder={t('todo.label')}
                  placeholderTextColor={colors.textPlaceholder}
                  value={title}
                  onChangeText={setTitle}
                  returnKeyType="next"
                />

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

                <Text style={styles.sectionLabel}>{t('note.label')}</Text>
                <TextInput
                  style={styles.memoInput}
                  placeholder={t('nl.placeholder')}
                  placeholderTextColor={colors.textPlaceholder}
                  value={memo}
                  onChangeText={setMemo}
                  multiline
                />
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Nested sub-sheets — rendered outside the main modal so they stack
          cleanly on top with their own keyboard handling. */}
      <CategoryPickerSheet
        visible={categoryPickerOpen}
        selectedId={categoryId}
        onClose={() => setCategoryPickerOpen(false)}
        onSelect={(id) => setCategoryId(id)}
      />
      {dateOpen && (
        <DateTimeModal
          visible={dateOpen}
          initialValue={
            dueDate ??
            (() => {
              // LEAD 2026-04-28: 현재 시간 기준 (이전엔 09:00 고정).
              const d = new Date();
              const m = d.getMinutes();
              const round = m < 30 ? 30 : 0;
              const off = m < 30 ? 0 : 1;
              d.setHours(d.getHours() + off, round, 0, 0);
              return d;
            })()
          }
          allDay={true}
          onCancel={() => setDateOpen(false)}
          onConfirm={(d) => {
            setDueDate(d);
            setDateOpen(false);
          }}
        />
      )}
    </>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheetWrapper: { width: '100%' },
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
    headerTitle: { ...textStyles.labelLg, color: colors.textPrimary },
    headerCancel: { ...textStyles.body, color: colors.textSecondary },
    headerSave: { ...textStyles.labelLg, color: colors.primary },
    disabled: { opacity: 0.4 },
    scrollContent: { paddingBottom: spacing[6] },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
      marginBottom: spacing[3],
    },
    inlineChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing[3],
      height: 32,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
    },
    inlineChipText: { ...textStyles.caption, color: colors.textSecondary },
    titleInput: {
      ...textStyles.h3,
      color: colors.textPrimary,
      paddingVertical: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sectionLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: spacing[4],
      marginBottom: spacing[2],
    },
    priorityRow: { flexDirection: 'row', gap: spacing[2] },
    priorityChip: {
      paddingHorizontal: spacing[3],
      height: 32,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    priorityChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    priorityText: { ...textStyles.body, color: colors.textSecondary },
    priorityTextActive: { color: colors.textInverse, fontWeight: '600' },
    memoInput: {
      ...textStyles.body,
      color: colors.textPrimary,
      minHeight: 80,
      textAlignVertical: 'top',
      paddingVertical: spacing[2],
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing[3],
    },
  });
}
