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
import {
  TodoAttachmentSection,
  type PendingPhoto,
  type PendingVoice,
} from './TodoAttachmentSection';
import { uploadPhoto, uploadVoice } from '@/services/todoAttachmentService';
import { logError } from '@/lib/errorLogger';

const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high'];

export interface TodoCreateSheetProps {
  visible: boolean;
  categoryMap: Map<string, Category>;
  /** Category pre-selected when the sheet opens (inherited from the planner). */
  defaultCategoryId?: string | null;
  onClose: () => void;
  /** Returns the created Todo so the sheet can upload attachments against its id. */
  onCreate: (input: CreateTodoInput) => Promise<{ id: string } | null>;
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
  /** Build-65 — 시간 포함 마감 (있으면 dueDate 무시되고 dueAt 우선). */
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Attachment staging: items are kept in memory until handleCreate finalises
  // the parent todo and we know its id. Then they're uploaded sequentially.
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [pendingVoice,  setPendingVoice]  = useState<PendingVoice | null>(null);

  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  /** 시간 picker — dueAt 입력. allDay=false (DateTimeModal). */
  const [timeOpen, setTimeOpen] = useState(false);
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
      setDueAt(null);
      setIsSaving(false);
      setPendingPhotos([]);
      setPendingVoice(null);
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
      const created = await onCreate({
        title: title.trim(),
        contentType: 'todo',
        priority,
        ...(memo.trim() ? { content: memo.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        // dueAt 우선 — 시간 있으면 그것만 (service 가 due_date 도 자동 채움).
        // 시간 없으면 dueDate.
        ...(dueAt ? { dueAt } : (dueDate ? { dueDate } : {})),
      });

      // Upload staged attachments against the new todo id. Failures don't
      // block the close — the todo itself was saved; the user can retry
      // attachments from the edit screen.
      if (created?.id) {
        for (const p of pendingPhotos) {
          try {
            await uploadPhoto(created.id, p.localUri, p.base64, { width: p.width, height: p.height });
          } catch (err) {
            logError({ context: 'TodoCreateSheet.uploadPhoto', error: err });
          }
        }
        if (pendingVoice) {
          try {
            await uploadVoice(created.id, pendingVoice.localUri, pendingVoice.durationMs);
          } catch (err) {
            logError({ context: 'TodoCreateSheet.uploadVoice', error: err });
          }
        }
      }

      onClose();
    } catch {
      setIsSaving(false);
    }
  }, [title, memo, priority, categoryId, dueDate, dueAt, pendingPhotos, pendingVoice, onCreate, onClose, isSaving]);

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
                    testID="todo-create-date-chip"
                    style={[
                      styles.inlineChip,
                      (dueAt || dueDate) && { borderColor: colors.primary },
                    ]}
                    onPress={() => setDateOpen(true)}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={(dueAt || dueDate) ? colors.primary : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.inlineChipText,
                        (dueAt || dueDate) && { color: colors.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {(dueAt ?? dueDate)
                        ? `${(dueAt ?? dueDate)!.getMonth() + 1}/${(dueAt ?? dueDate)!.getDate()}`
                        : t('time.date')}
                    </Text>
                  </Pressable>

                  {/* Build-65 — 시간 입력 chip. dueDate 또는 dueAt 가 있을 때만
                      표시 (날짜 없이 시간만 있는 todo 는 의미 없음). */}
                  {(dueAt || dueDate) && (
                    <Pressable
                      testID="todo-create-time-chip"
                      style={[
                        styles.inlineChip,
                        dueAt && { borderColor: colors.primary },
                      ]}
                      onPress={() => setTimeOpen(true)}
                    >
                      <Ionicons
                        name="time-outline"
                        size={14}
                        color={dueAt ? colors.primary : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.inlineChipText,
                          dueAt && { color: colors.primary },
                        ]}
                        numberOfLines={1}
                      >
                        {dueAt
                          ? `${String(dueAt.getHours()).padStart(2, '0')}:${String(dueAt.getMinutes()).padStart(2, '0')}`
                          : t('time.time') /* fallback to existing key if defined */}
                      </Text>
                    </Pressable>
                  )}
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
                  placeholder={t('note.body_placeholder')}
                  placeholderTextColor={colors.textPlaceholder}
                  value={memo}
                  onChangeText={setMemo}
                  multiline
                />

                {/* Attachments — photo grid + voice recorder card. Items stay
                    local until handleCreate uploads them with the new todo id. */}
                <View style={styles.attachmentWrap}>
                  <TodoAttachmentSection
                    pendingPhotos={pendingPhotos}
                    pendingVoice={pendingVoice}
                    uploadedAttachments={[]}
                    onAddPhoto={(p) => setPendingPhotos(prev => [...prev, p])}
                    onAddVoice={(v) => setPendingVoice(v)}
                    onRemovePendingPhoto={(idx) =>
                      setPendingPhotos(prev => prev.filter((_, i) => i !== idx))}
                    onRemovePendingVoice={() => setPendingVoice(null)}
                    onRemoveUploaded={() => { /* not used during create */ }}
                  />
                </View>
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
      {/* Build-65 — 시간 picker. dueAt = 날짜(dueDate) + 선택한 시간. */}
      {timeOpen && (
        <DateTimeModal
          visible={timeOpen}
          initialValue={(() => {
            // 기존 dueAt 있으면 그것, 없으면 dueDate 의 일자 + 현재 시각 다음 30분.
            const base = dueAt ?? new Date(dueDate ?? Date.now());
            if (!dueAt) {
              const now = new Date();
              const m = now.getMinutes();
              const round = m < 30 ? 30 : 0;
              const off = m < 30 ? 0 : 1;
              base.setHours(now.getHours() + off, round, 0, 0);
            }
            return base;
          })()}
          allDay={false}
          onCancel={() => setTimeOpen(false)}
          onConfirm={(d) => {
            // dueAt 의 날짜 부분은 dueDate 와 같게 유지 (이미 picker 가 같은 일자
            // 기준으로 시간만 골랐을 가능성 높음). 안전하게 dueDate 의 Y/M/D 로 덮음.
            const merged = new Date(dueDate ?? d);
            merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
            setDueAt(merged);
            setTimeOpen(false);
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
      // Build-68 LEAD bug: 키보드 열림 시 sheet 와 키보드 사이 공백 제거.
      // sheetWrapper.paddingBottom=keyboardHeight 가 이미 sheet 를 들어올림.
      paddingBottom: spacing[2],
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
    scrollContent: { paddingBottom: 0 },
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
    attachmentWrap: {
      marginTop: spacing[3],
    },
  });
}
